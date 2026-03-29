//@name long_memory_ai_assistant
//@display-name Librarian System V3.6.1 (Dynamic Core)
//@author rusinus12@gmail.com
//@api 3.0
//@version 3.6.1
//@arg max_limit int Max number of memories (Default: 150)
//@arg threshold int Minimum importance to save (Default: 5)
//@arg gc_frequency int Run GC every N turns (Default: 10)
//@arg emotion_enabled string Enable Emotion Engine (true/false, Default: true)
//@arg summary_threshold int Threshold to start memory consolidation (Default: 100)
//@arg lorebook_inject string Enable lorebook chat injection (true/false, Default: true)
//@arg debug string Enable debug logging (true/false, Default: false)
//@arg cbs_enabled string Enable CBS syntax processing (true/false, Default: true)
//@arg sim_threshold string Minimum similarity to retrieve (Default: 0.25)
//@arg weight_mode string Mode (auto/manual/romance/action/mystery/daily, Default: auto)
//@arg w_sim string Manual Sim Weight (Default: 0.5)
//@arg w_imp string Manual Imp Weight (Default: 0.3)
//@arg w_rec string Manual Rec Weight (Default: 0.2)

/**

- =============================================================================
- LONG MEMORY & AI ASSISTANT v3.6.1 (DYNAMIC CORE)
- =============================================================================
- [v3.6.1 개선 사항]
- FIX-1.  한글 단어 감지: 문자 클래스 [] → includes() 배열 검색으로 교체
- ```
      (오탐률 제거, 정확한 다중 글자 단어 매칭)
  ```
- FIX-2.  parseMeta: 누락된 정규식 복원 → [META:{…}] 패턴으로 안전하게 파싱
- FIX-3.  LRUCache: has() 순서 미갱신 문제 해결, peek() 메서드 추가
- FIX-4.  calcSimilarity: 임베딩+overlap 하이브리드 스코어링 (코사인 0.7 + 자카드 0.3)
- FIX-5.  boolean 타입 처리: getVal()에 ‘boolean’ 분기 추가 (string “true”/“1” 포함)
- FIX-6.  safeModify: structuredClone 지원 시 사용, 폴백은 JSON 깊은 복사 유지
- FIX-7.  빈 catch 블록: 최소한의 경고 로그 추가
- FIX-8.  장르 감지: boolean → 점수 기반 신뢰도 시스템으로 교체
- FIX-9.  prepareMemory: 한계치 95% 도달 시 조기 GC 트리거
- FIX-10. getVal: parent 룩업 로직 명확화 및 타입 변환 안정화
- =============================================================================
  */

(async () => {
try {
console.log(’[LMAI] v3.6.1 Initializing…’);

```
    // ─────────────────────────────────────────────
    // [UTILITY] LRU Cache
    // ─────────────────────────────────────────────
    class LRUCache {
        constructor(maxSize = 1000) {
            this.cache = new Map();
            this.maxSize = maxSize;
        }

        get(k) {
            if (!this.cache.has(k)) return undefined;
            const v = this.cache.get(k);
            // 접근 시 순서 갱신 (LRU 핵심 동작)
            this.cache.delete(k);
            this.cache.set(k, v);
            return v;
        }

        // 순서 변경 없이 값만 확인 (hot-path peek)
        peek(k) {
            return this.cache.get(k);
        }

        set(k, v) {
            if (this.cache.has(k)) this.cache.delete(k);
            if (this.cache.size >= this.maxSize) {
                // 가장 오래된 항목(첫 번째) 제거
                this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(k, v);
        }

        // 존재 확인만 (순서 미갱신 — 의도적)
        has(k) {
            return this.cache.has(k);
        }

        delete(k) {
            return this.cache.delete(k);
        }

        get size() {
            return this.cache.size;
        }
    }

    const sharedTokenCache = new LRUCache(2000);
    const sharedEmbedCache = new LRUCache(5000);

    // ─────────────────────────────────────────────
    // [ENGINE] Embedding Queue (Rate Limiting + Timeout)
    // ─────────────────────────────────────────────
    const EmbeddingQueue = (() => {
        const q = [];
        const MAX_CONCURRENT = 2;
        let active = 0;

        const run = async () => {
            if (active >= MAX_CONCURRENT || q.length === 0) return;
            active++;
            const { task, resolve, reject } = q.shift();
            try {
                resolve(await task());
            } catch (e) {
                reject(e);
            } finally {
                active--;
                run();
            }
        };

        return {
            enqueue: (task) => new Promise((res, rej) => {
                q.push({ task, resolve: res, reject: rej });
                run();
            })
        };
    })();

    // ─────────────────────────────────────────────
    // [ENGINE] Tokenizer & Hash
    // ─────────────────────────────────────────────
    const TokenizerEngine = (() => {
        const simpleHash = (s) => {
            let h = 0;
            for (let i = 0; i < (s || "").length; i++) {
                h = Math.imul(31, h) ^ s.charCodeAt(i) | 0;
            }
            return h;
        };

        const getSafeMapKey = (text) => {
            const t = text || "";
            return `${simpleHash(t)}_${t.slice(0, 8)}_${t.slice(-4)}`;
        };

        const tokenize = (t) =>
            (t || "").toLowerCase()
                .replace(/[^\w가-힣\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 1);

        const getIndexKey = (text) => {
            const tokens = tokenize(text);
            const combined = [...tokens.slice(0, 3), ...tokens.slice(-2)];
            return simpleHash(combined.join("_") || text.slice(0, 10));
        };

        const estimateTokens = (text, type = 'simple') => {
            if (!text) return 0;
            const ratio = type === 'gpt4' ? 0.5 : 0.6;
            return Math.ceil(text.length * ratio) + (text.match(/\s/g) || []).length;
        };

        return { simpleHash, tokenize, getIndexKey, getSafeMapKey, estimateTokens };
    })();

    // ─────────────────────────────────────────────
    // [ENGINE] Embedding Engine (Safe & Timeout)
    // ─────────────────────────────────────────────
    const EmbeddingEngine = (() => {
        const cache = sharedEmbedCache;

        return {
            getEmbedding: (text) => {
                // peek()으로 순서 변경 없이 존재 확인 후, 실제 사용 시 get()
                if (cache.has(text)) return Promise.resolve(cache.get(text));

                return EmbeddingQueue.enqueue(async () => {
                    const m = MemoryEngine?.CONFIG?.embedModel;
                    if (!m?.url) return null;

                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 15000);

                    try {
                        const res = await risuai.fetch(m.url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${m.key}`
                            },
                            body: JSON.stringify({ input: [text], model: m.model }),
                            signal: controller.signal
                        });
                        clearTimeout(timeout);

                        const data = await res.json();
                        const vec = data?.data?.[0]?.embedding;
                        if (vec) cache.set(text, vec);
                        return vec;
                    } catch (e) {
                        clearTimeout(timeout);
                        if (e.name === 'AbortError') {
                            console.warn(`[LMAI] Embedding Timeout (15s): "${text.slice(0, 20)}..."`);
                        } else {
                            console.error(`[LMAI] Embedding API Error:`, e.message || e);
                        }
                        return null;
                    }
                });
            },

            cosineSimilarity: (a, b) => {
                if (!a || !b || a.length !== b.length) return 0;
                let dot = 0, normA = 0, normB = 0;
                for (let i = 0; i < a.length; i++) {
                    dot += a[i] * b[i];
                    normA += a[i] * a[i];
                    normB += b[i] * b[i];
                }
                return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
            }
        };
    })();

    // ─────────────────────────────────────────────
    // [ENGINE] CBS Engine
    // ─────────────────────────────────────────────
    const CBSEngine = (() => {
        const CONDITION_REGEX = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(".*?"|-?\d+\.?\d*)$/;
        const safeTrim = (v) => typeof v === "string" ? v.trim() : "";

        function parseDefaultVariables(raw) {
            return String(raw || "").split(/\r?\n/g)
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => {
                    const eq = line.indexOf("=");
                    if (eq === -1) return null;
                    return [line.slice(0, eq).trim(), line.slice(eq + 1)];
                })
                .filter(pair => pair && pair[0]);
        }

        function splitTopLevelCbsByDoubleColon(raw) {
            const src = String(raw || "");
            const result = [];
            let current = "", braceDepth = 0, parenDepth = 0;
            for (let i = 0; i < src.length; i++) {
                const two = src.slice(i, i + 2);
                if (two === "{{") { braceDepth++; current += two; i++; continue; }
                if (two === "}}" && braceDepth > 0) { braceDepth--; current += two; i++; continue; }
                if (src[i] === "(") parenDepth++;
                if (src[i] === ")" && parenDepth > 0) parenDepth--;
                if (two === "::" && braceDepth === 0 && parenDepth === 0) {
                    result.push(current); current = ""; i++; continue;
                }
                current += src[i];
            }
            result.push(current);
            return result;
        }

        function findNextCbsTag(text, startIndex) {
            const src = String(text || "");
            for (let i = startIndex; i < src.length - 1; i++) {
                if (src[i] === '{' && src[i + 1] === '{') {
                    let depth = 1, j = i + 2;
                    while (j < src.length - 1) {
                        if (src[j] === '{' && src[j + 1] === '{') { depth++; j++; }
                        else if (src[j] === '}' && src[j + 1] === '}') {
                            depth--;
                            if (depth === 0) return {
                                start: i, end: j + 2,
                                inner: src.substring(i + 2, j),
                                raw: src.substring(i, j + 2)
                            };
                            j++;
                        }
                        j++;
                    }
                    return null;
                }
            }
            return null;
        }

        function extractCbsBlock(text, startTag, blockName) {
            let depth = 1, cursor = startTag.end, elseTag = null;
            while (cursor < text.length) {
                const tag = findNextCbsTag(text, cursor);
                if (!tag) break;
                const inner = safeTrim(tag.inner);
                if (inner.startsWith(`#${blockName} `)) depth++;
                else if (inner === `/${blockName}`) {
                    depth--;
                    if (depth === 0) return {
                        body: text.slice(startTag.end, elseTag ? elseTag.start : tag.start),
                        elseBody: elseTag ? text.slice(elseTag.end, tag.start) : "",
                        end: tag.end
                    };
                } else if (inner === "else" && depth === 1 && blockName === "if") {
                    elseTag = tag;
                }
                cursor = tag.end;
            }
            return { body: text.slice(startTag.end), elseBody: "", end: text.length };
        }

        async function getStandaloneCbsRuntime() {
            const char = await risuai.getCharacter();
            const chat = (char && char.chats && char.chatPage !== undefined)
                ? char.chats[char.chatPage]
                : {};

            let db = null;
            try {
                db = await risuai.getDatabase();
            } catch (e) {
                // FIX-7: 빈 catch → 경고 로그 추가
                console.warn('[LMAI] DB load failed, using null fallback:', e?.message || e);
            }

            const vars = Object.create(null);
            for (const [k, v] of parseDefaultVariables(char?.defaultVariables)) {
                vars[k] = String(v ?? "");
            }
            for (const [k, v] of parseDefaultVariables(db?.templateDefaultVariables)) {
                if (!(k in vars)) vars[k] = String(v ?? "");
            }

            const scriptState = chat?.scriptstate && typeof chat.scriptstate === "object"
                ? chat.scriptstate : {};
            for (const [rawKey, value] of Object.entries(scriptState)) {
                const key = String(rawKey || "");
                vars[key] = value == null ? "null" : String(value);
            }

            const globalVars = db?.globalChatVariables && typeof db.globalChatVariables === "object"
                ? db.globalChatVariables : {};
            const userName = safeTrim(db?.username || "User");
            const finalDb = {
                ...db,
                globalNote: chat?.localLore?.globalNote || db?.globalNote || ""
            };

            return { char, chat, db: finalDb, vars, globalVars, userName, functions: Object.create(null) };
        }

        function evalStandaloneCbsCalc(expression) {
            const src = String(expression || "").replace(/\s+/g, " ").trim();
            if (!src) return "";
            const looksConditional = /[<>=!&|]/.test(src);
            if (src.includes("{{") || src.includes("}}") || src.includes("[CBS_")) {
                return looksConditional ? "0" : src;
            }
            const whitelistRegex = /^[\d\s()+\-*/%<>=!&|.,'"_[\]]+$/;
            const blacklist = ["window", "process", "document", "risuai", "require",
                "import", "Function", "eval", "constructor", "prototype", "__proto__"];
            if (!whitelistRegex.test(src) || blacklist.some(k => src.includes(k))) {
                return looksConditional ? "0" : src;
            }
            try {
                const result = Function(`"use strict"; return (${src});`)();
                if (typeof result === "boolean") return result ? "1" : "0";
                return result == null ? "" : String(result);
            } catch {
                return looksConditional ? "0" : src;
            }
        }

        function isStandaloneCbsTruthy(value) {
            const src = safeTrim(String(value ?? ""));
            if (!src || src === "0" || src.toLowerCase() === "false" || src.toLowerCase() === "null") return false;
            return true;
        }

        async function evalStandaloneCbsExpr(inner, runtime, args = []) {
            let expr = safeTrim(inner);
            if (!expr) return "";
            if (expr.includes("{{")) {
                expr = safeTrim(await renderStandaloneCbsText(expr, runtime, args));
                if (!expr) return "";
            }
            if (expr === "char" || expr === "Char") return safeTrim(runtime?.char?.name || "Char");
            if (expr === "user" || expr === "User") return runtime?.userName || "User";

            const parts = splitTopLevelCbsByDoubleColon(expr).map(s => String(s ?? ""));
            const head = safeTrim(parts[0] || "");

            if (head === "arg") {
                const index = Math.max(0, (parseInt(safeTrim(parts[1] || "1"), 10) || 1) - 1);
                return args[index] ?? "null";
            }
            if (head === "getvar") {
                const keyRaw = parts.slice(1).join("::");
                const key = safeTrim(await renderStandaloneCbsText(keyRaw, runtime, args));
                if (!key) return "null";
                if (Object.prototype.hasOwnProperty.call(runtime.vars, key)) return runtime.vars[key];
                if (Object.prototype.hasOwnProperty.call(runtime.globalVars, key)) return runtime.globalVars[key];
                return "null";
            }
            if (head === "calc") {
                const expression = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args);
                return evalStandaloneCbsCalc(expression);
            }
            if (head === "none") return "";
            if (head === "random") {
                const choices = parts.slice(1);
                if (choices.length === 0) return "";
                const randIdx = Math.floor(Math.random() * choices.length);
                return await renderStandaloneCbsText(choices[randIdx], runtime, args);
            }
            if (head === "token_count") {
                const text = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args);
                return String(TokenizerEngine.estimateTokens(text, MemoryEngine.CONFIG.tokenizerType));
            }
            if (Object.prototype.hasOwnProperty.call(runtime.vars, expr)) return runtime.vars[expr];
            if (Object.prototype.hasOwnProperty.call(runtime.globalVars, expr)) return runtime.globalVars[expr];
            return expr;
        }

        async function renderStandaloneCbsText(text, runtime, args = []) {
            const src = String(text ?? "");
            if (!src || !src.includes("{{")) return src;
            let out = "", cursor = 0;
            while (cursor < src.length) {
                const tag = findNextCbsTag(src, cursor);
                if (!tag) { out += src.slice(cursor); break; }
                out += src.slice(cursor, tag.start);
                const inner = safeTrim(tag.inner);
                if (inner.startsWith("#if ")) {
                    const conditionRaw = inner.slice(4);
                    const block = extractCbsBlock(src, tag, "if");
                    const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args);
                    out += await renderStandaloneCbsText(
                        isStandaloneCbsTruthy(condition) ? block.body : block.elseBody,
                        runtime, args
                    );
                    cursor = block.end; continue;
                }
                if (inner === "else" || inner === "/if") { cursor = tag.end; continue; }
                out += await evalStandaloneCbsExpr(inner, runtime, args);
                cursor = tag.end;
            }
            return out;
        }

        return {
            evalCondition: (cond, vars) => {
                if (!cond) return true;
                return cond.split('&&').every(p => {
                    const m = p.trim().match(CONDITION_REGEX);
                    if (!m) return false;
                    const [_, k, op, v] = m;
                    const left = vars[k];
                    const right = v.startsWith('"') ? v.slice(1, -1) : Number(v);
                    if (left === undefined) return false;
                    switch (op) {
                        case '>=': return left >= right;
                        case '<=': return left <= right;
                        case '==': return left == right;
                        case '!=': return left != right;
                        case '>':  return left > right;
                        case '<':  return left < right;
                        default:   return false;
                    }
                });
            },

            parseVariables: (text, vars) => {
                if (!text) return vars;
                const n = { ...vars };
                for (const m of text.matchAll(/\{\{(\w+)\s*=\s*(".*?"|-?\d+\.?\d*)\}\}/g)) {
                    n[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : Number(m[2]);
                }
                return n;
            },

            process: async (text) => {
                if (!MemoryEngine.CONFIG.cbsEnabled) return text;
                const src = String(text ?? "");
                if (!src || !src.includes("{{")) return src;
                try {
                    const runtime = await getStandaloneCbsRuntime();
                    return await renderStandaloneCbsText(src, runtime, []);
                } catch (e) {
                    console.error("[LMAI] CBS Processing Error:", e?.message || e);
                    return src;
                }
            },

            clean: (text) => typeof text === 'string'
                ? text.replace(/<[^>]+>/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').trim()
                : ""
        };
    })();

    // ─────────────────────────────────────────────
    // [CORE] Memory Engine (v3.6.1 Fixed Dynamic)
    // ─────────────────────────────────────────────
    const MemoryEngine = (() => {
        const CONFIG = {
            maxLimit: 150,
            threshold: 5,
            simThreshold: 0.25,
            gcBatchSize: 5,
            tokenizerType: 'simple',
            weightMode: 'auto',
            weights: { importance: 0.3, similarity: 0.5, recency: 0.2 },
            debug: false,
            cbsEnabled: true,
            loreComment: "lmai_memory",
            mainModel: { format: "openai", url: "", key: "", model: "", temp: 0.7 },
            embedModel: { format: "openai", url: "", key: "", model: "text-embedding-3-small" }
        };

        // ─────────────────────────────────────────
        // FIX-1 & FIX-8: 장르 감지 — 점수 기반 신뢰도 시스템
        //   기존: 문자 클래스 [] 안에 다중 글자 한글 단어 → 1글자씩 분리 매칭 (오탐)
        //   개선: includes() 배열 검색 + 점수 누적 → 가장 높은 장르 선택
        // ─────────────────────────────────────────
        const GENRE_KEYWORDS = {
            action:  ['공격', '회피', '기습', '위험', '비명', '달려', '총', '검', '폭발', '피격', '격투', '추격'],
            romance: ['사랑', '좋아', '키스', '안아', '입술', '눈물', '손잡', '두근', '설레', '고백', '포옹', '그리워'],
            mystery: ['단서', '증거', '범인', '비밀', '거짓말', '수상', '추리', '의심', '진실', '조사', '누가', '왜'],
            daily:   ['밥', '날씨', '오늘', '일상', '학교', '회사', '집에', '친구', '쇼핑', '영화', '산책']
        };

        const detectGenreWeights = (query) => {
            if (CONFIG.weightMode !== 'auto') return null;

            const text = (query || "").toLowerCase();
            const scores = { action: 0, romance: 0, mystery: 0, daily: 0 };

            for (const [genre, words] of Object.entries(GENRE_KEYWORDS)) {
                for (const word of words) {
                    if (text.includes(word)) scores[genre]++;
                }
                // 액션: 느낌표도 가산
                if (genre === 'action' && /!/.test(text)) scores.action += 0.5;
            }

            const topGenre = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

            // 최소 신뢰도 점수 미달 시 기본값 반환
            if (topGenre[1] < 1) return null;

            const PRESETS = {
                action:  { similarity: 0.4, importance: 0.2, recency: 0.4 },
                romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
                mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
                daily:   { similarity: 0.3, importance: 0.3, recency: 0.4 }
            };

            if (CONFIG.debug) {
                const scoreStr = Object.entries(scores).map(([g, s]) => `${g}:${s}`).join(', ');
                console.log(`[LMAI] Genre Detection [${topGenre[0].toUpperCase()}] scores={${scoreStr}}`);
            }

            return PRESETS[topGenre[0]];
        };

        const calculateDynamicWeights = (query) => {
            const detected = detectGenreWeights(query);
            return detected || CONFIG.weights;
        };

        const metaCache = new LRUCache(2000);
        const simCache  = new LRUCache(5000);
        const hashIndex = new Map();
        let gcCursor = 0;

        const _log = (msg) => { if (CONFIG.debug) console.log(`[LMAI] ${msg}`); };

        const getSafeKey = (entry) =>
            entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");

        // ─────────────────────────────────────────
        // FIX-2: parseMeta — 누락된 정규식 복원
        //   메타데이터 포맷: [META:{...}] 으로 저장 가정
        //   (실 환경에 맞게 패턴 교체 가능)
        // ─────────────────────────────────────────
        const META_PATTERN = /\[META:(\{[\s\S]*?\})\]/;

        const parseMeta = (raw) => {
            const def = { t: 0, ttl: 0, imp: 5, type: 'context' };
            if (typeof raw !== 'string') return def;
            try {
                const m = raw.match(META_PATTERN);
                return m ? { ...def, ...JSON.parse(m[1]) } : def;
            } catch (e) {
                console.warn('[LMAI] parseMeta JSON error:', e?.message);
                return def;
            }
        };

        const getCachedMeta = (entry) => {
            const key = getSafeKey(entry);
            // peek()으로 순서 변경 없이 캐시 확인
            const cached = metaCache.peek(key);
            if (cached !== undefined) return cached;
            const m = parseMeta(entry.content);
            metaCache.set(key, m);
            return m;
        };

        // ─────────────────────────────────────────
        // FIX-4: calcSimilarity — 하이브리드 스코어링
        //   기존: 임베딩 있으면 overlap 완전히 버림
        //   개선: cosineSim * 0.7 + jaccard * 0.3 혼합
        // ─────────────────────────────────────────
        const calcSimilarity = async (textA, textB) => {
            const hA = TokenizerEngine.simpleHash(textA);
            const hB = TokenizerEngine.simpleHash(textB);
            const cKey = hA < hB ? `${hA}_${hB}` : `${hB}_${hA}`;
            if (simCache.has(cKey)) return simCache.get(cKey);

            const lenA = textA.length, lenB = textB.length;
            if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.7) {
                simCache.set(cKey, 0); return 0;
            }

            const tA = new Set(TokenizerEngine.tokenize(textA));
            const tB = new Set(TokenizerEngine.tokenize(textB));
            let inter = 0;
            tA.forEach(w => { if (tB.has(w)) inter++; });
            const jaccard = (tA.size + tB.size) > 0
                ? inter / (tA.size + tB.size - inter)
                : 0;

            if (jaccard < 0.1) { simCache.set(cKey, 0); return 0; }

            const vecA = await EmbeddingEngine.getEmbedding(textA);
            const vecB = await EmbeddingEngine.getEmbedding(textB);

            // 임베딩이 있으면 혼합, 없으면 자카드만
            const score = (vecA && vecB)
                ? EmbeddingEngine.cosineSimilarity(vecA, vecB) * 0.7 + jaccard * 0.3
                : jaccard * 0.7;

            simCache.set(cKey, score);
            return score;
        };

        const calcRecency = (turn, current) =>
            Math.exp(-Math.max(0, current - turn) / 20);

        return {
            CONFIG,
            getSafeKey,
            getCachedMeta,
            calcRecency,

            rebuildIndex: (lorebook) => {
                _log("Rebuilding Hash Index...");
                hashIndex.clear();
                const entries = Array.isArray(lorebook) ? lorebook : [];
                entries.forEach(entry => {
                    if (entry.comment !== CONFIG.loreComment) return;
                    try {
                        const content = (entry.content || "")
                            .replace(META_PATTERN, '').trim();
                        if (content.length < 5) return;
                        const key = getSafeKey(entry);
                        const idxKey = TokenizerEngine.getIndexKey(content);
                        if (!hashIndex.has(idxKey)) hashIndex.set(idxKey, new Set());
                        hashIndex.get(idxKey).add(key);
                    } catch (e) {
                        console.error("[LMAI] Index Build Error:", e?.message || e);
                    }
                });
            },

            registerIndex: (content, key) => {
                const idxKey = TokenizerEngine.getIndexKey(content);
                if (!hashIndex.has(idxKey)) hashIndex.set(idxKey, new Set());
                hashIndex.get(idxKey).add(key || TokenizerEngine.getSafeMapKey(content));
            },

            checkDuplication: async (content, existingList) => {
                const idxKey = TokenizerEngine.getIndexKey(content);
                const candidates = hashIndex.get(idxKey) || new Set();
                const map = new Map(existingList.map(e => [getSafeKey(e), e]));

                const checkPool = [
                    ...Array.from(candidates).map(k => map.get(k)).filter(Boolean),
                    ...existingList.slice(-5)
                ];
                const uniqueCheck = new Set(checkPool);

                for (const item of uniqueCheck) {
                    if (!item || !item.content) continue;
                    if (Math.abs(item.content.length - content.length) > content.length * 0.7) continue;
                    const sim = await calcSimilarity(item.content, content);
                    if (sim > 0.75) return true;
                }
                return false;
            },

            // FIX-9: 한계치 95% 도달 시 조기 GC 트리거
            prepareMemory: async (data, currentTurn, existingList, lorebook, currentVars = {}) => {
                const { content, importance } = data;
                if (!content || content.length < 5) return null;

                // 조기 GC: 관리 항목이 maxLimit의 95% 이상이면 즉시 GC 실행
                const managed = MemoryEngine.getManagedEntries(lorebook);
                if (managed.length >= Math.floor(CONFIG.maxLimit * 0.95)) {
                    _log(`Early GC triggered: ${managed.length}/${CONFIG.maxLimit} entries`);
                    MemoryEngine.incrementalGC(lorebook, currentTurn);
                }

                if (await MemoryEngine.checkDuplication(content, existingList)) return null;

                const imp = importance || 5;
                const ttl = imp >= 9 ? -1 : 30;
                const meta = { t: currentTurn, ttl, imp };

                MemoryEngine.registerIndex(content);

                return {
                    key: "",
                    comment: CONFIG.loreComment,
                    content: `[META:${JSON.stringify(meta)}]\n${content}\n`,
                    mode: "normal",
                    insertorder: 100,
                    alwaysActive: true
                };
            },

            retrieveMemories: async (query, currentTurn, candidates, vars, topK = 15) => {
                const cleanQuery = query.trim();
                const W = calculateDynamicWeights(cleanQuery);

                const validCandidates = candidates.filter(entry => {
                    const meta = getCachedMeta(entry);
                    return meta.ttl === -1 || (meta.t + meta.ttl) >= currentTurn;
                });

                const results = await Promise.all(validCandidates.map(async (entry) => {
                    const meta = getCachedMeta(entry);
                    const text = (entry.content || "")
                        .replace(META_PATTERN, '').trim();
                    const sim = await calcSimilarity(cleanQuery, text);
                    if (sim < CONFIG.simThreshold) return null;

                    const score = (sim * W.similarity)
                        + (calcRecency(meta.t, currentTurn) * W.recency)
                        + ((meta.imp / 10) * W.importance);

                    return { ...entry, _score: score };
                }));

                return results
                    .filter(Boolean)
                    .sort((a, b) => b._score - a._score)
                    .slice(0, topK);
            },

            incrementalGC: (allEntries, currentTurn) => {
                const toDelete = new Set();
                const totalEntries = allEntries.length;
                if (totalEntries === 0) return allEntries;

                const batchSize = CONFIG.gcBatchSize;
                for (let i = 0; i < batchSize; i++) {
                    const idx = (gcCursor + i) % totalEntries;
                    const entry = allEntries[idx];
                    const meta = getCachedMeta(entry);
                    if (meta.ttl !== -1 && (meta.t + meta.ttl) < currentTurn) {
                        toDelete.add(getSafeKey(entry));
                    }
                }
                gcCursor = (gcCursor + batchSize) % Math.max(1, totalEntries);

                const managed = allEntries.filter(e => e.comment === CONFIG.loreComment);
                if (managed.length > CONFIG.maxLimit) {
                    managed
                        .sort((a, b) => getCachedMeta(a).t - getCachedMeta(b).t)
                        .slice(0, managed.length - CONFIG.maxLimit)
                        .forEach(e => toDelete.add(getSafeKey(e)));
                }

                if (toDelete.size > 0) {
                    hashIndex.forEach((set, key) => {
                        toDelete.forEach(item => set.delete(item));
                        if (set.size === 0) hashIndex.delete(key);
                    });
                    return allEntries.filter(e => !toDelete.has(getSafeKey(e)));
                }
                return allEntries;
            },

            getLorebook:  (char, chat) =>
                Array.isArray(char.lorebook) ? char.lorebook : (chat?.localLore || []),
            setLorebook:  (char, chat, data) => {
                if (Array.isArray(char.lorebook)) char.lorebook = data;
                else if (chat) chat.localLore = data;
            },
            getManagedEntries: (lorebook) =>
                (Array.isArray(lorebook) ? lorebook : [])
                    .filter(e => e.comment === CONFIG.loreComment)
        };
    })();

    // ─────────────────────────────────────────────
    // [MAIN] Initialization & Hooks
    // ─────────────────────────────────────────────
    let writeMutex = Promise.resolve();

    const safeModify = async (f) => {
        const cur = writeMutex;
        let rel;
        writeMutex = new Promise(r => rel = r);
        try {
            await cur;
            const c = await risuai.getCharacter();

            // FIX-6: structuredClone 우선 사용, 미지원 환경은 JSON 깊은 복사 폴백
            const copy = typeof structuredClone === 'function'
                ? structuredClone(c)
                : JSON.parse(JSON.stringify(c));

            const r = await f(copy);
            return r ? await risuai.setCharacter(r) : false;
        } finally {
            if (rel) rel();
        }
    };

    // ─────────────────────────────────────────────
    // FIX-5 & FIX-10: updateConfigFromArgs
    //   - boolean 타입 분기 추가 ("true"/"1"/true 모두 처리)
    //   - parent 룩업 로직 명확화
    //   - 숫자 변환 안정화 (NaN → 기본값 폴백)
    // ─────────────────────────────────────────────
    const updateConfigFromArgs = async () => {
        const cfg = MemoryEngine.CONFIG;
        let local = {};
        try {
            const saved = await risuai.pluginStorage.getItem('LMAI_Config');
            if (saved) local = typeof saved === 'string' ? JSON.parse(saved) : saved;
        } catch (e) {
            console.warn('[LMAI] Config load failed, using defaults:', e?.message || e);
        }

        /**
         * 값 우선순위: localStorage → args → CONFIG 기본값
         * @param {string} key       CONFIG 키 이름
         * @param {string|null} argName  risuai.getArgument 키 이름 (null이면 스킵)
         * @param {'number'|'boolean'|'string'} type
         * @param {string|null} parent   중첩 객체 부모 키 (예: 'mainModel')
         * @param {*} fallback       최종 기본값
         */
        const getVal = (key, argName, type, parent = null, fallback = undefined) => {
            // 1) localStorage 우선
            const localVal = parent ? local[parent]?.[key] : local[key];
            // 2) risuai arg
            let argVal;
            if (argName) {
                try { argVal = risuai.getArgument(argName); } catch { /* 인자 없음 */ }
            }
            // 3) CONFIG 기본값
            const configVal = parent ? cfg[parent]?.[key] : cfg[key];

            const raw = localVal !== undefined ? localVal
                : argVal  !== undefined ? argVal
                : configVal !== undefined ? configVal
                : fallback;

            if (raw === undefined || raw === null) return fallback;

            switch (type) {
                case 'number': {
                    const n = Number(raw);
                    return isNaN(n) ? (fallback ?? configVal) : n;
                }
                case 'boolean':
                    return raw === true || raw === 1 || raw === 'true' || raw === '1';
                default:
                    return String(raw);
            }
        };

        cfg.maxLimit      = getVal('maxLimit',      'max_limit',   'number',  null, 150);
        cfg.threshold     = getVal('threshold',     'threshold',   'number',  null, 5);
        cfg.simThreshold  = getVal('simThreshold',  'sim_threshold','number', null, 0.25);
        cfg.debug         = getVal('debug',         'debug',       'boolean', null, false);
        cfg.cbsEnabled    = getVal('cbsEnabled',    'cbs_enabled', 'boolean', null, true);

        cfg.mainModel = {
            url:   getVal('url',   null, 'string', 'mainModel', ''),
            key:   getVal('key',   null, 'string', 'mainModel', ''),
            model: getVal('model', null, 'string', 'mainModel', '')
        };
        cfg.embedModel = {
            url:   getVal('url',   null, 'string', 'embedModel', ''),
            key:   getVal('key',   null, 'string', 'embedModel', ''),
            model: getVal('model', null, 'string', 'embedModel', 'text-embedding-3-small')
        };

        // v3.6.1 — 가중치 모드 설정
        const mode = (getVal('weightMode', 'weight_mode', 'string', null, 'auto')).toLowerCase();
        cfg.weightMode = mode;

        // RisuAI string 인자 → number 변환
        const manualWeights = {
            similarity: getVal('w_sim', 'w_sim', 'number', null, 0.5),
            importance: getVal('w_imp', 'w_imp', 'number', null, 0.3),
            recency:    getVal('w_rec', 'w_rec', 'number', null, 0.2)
        };

        // 합계가 1이 아닐 경우 정규화
        const weightSum = Object.values(manualWeights).reduce((a, b) => a + b, 0);
        if (Math.abs(weightSum - 1.0) > 0.01 && weightSum > 0) {
            manualWeights.similarity /= weightSum;
            manualWeights.importance /= weightSum;
            manualWeights.recency    /= weightSum;
            if (cfg.debug) console.log(`[LMAI] Weights normalized (sum was ${weightSum.toFixed(3)})`);
        }

        const PRESETS = {
            romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
            action:  { similarity: 0.4, importance: 0.2, recency: 0.4 },
            mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
            daily:   { similarity: 0.3, importance: 0.3, recency: 0.4 }
        };

        if (PRESETS[mode]) {
            cfg.weights = PRESETS[mode];
            if (cfg.debug) console.log(`[LMAI] Preset Loaded: ${mode.toUpperCase()}`);
        } else {
            // 'auto' 또는 'manual' 또는 알 수 없는 모드 → 수동 가중치 사용
            cfg.weights = manualWeights;
        }
    };

    await updateConfigFromArgs();

    // 초기 로어북 인덱스 빌드
    if (typeof risuai !== 'undefined') {
        try {
            const char = await risuai.getCharacter();
            const chat = char?.chats?.[char.chatPage];
            const lore = MemoryEngine.getLorebook(char, chat);
            MemoryEngine.rebuildIndex(lore);
        } catch (e) {
            console.error("[LMAI] Init Lorebook Load Error:", e?.message || e);
        }
    }

    console.log(`[LMAI] v3.6.1 Ready. Mode=${MemoryEngine.CONFIG.weightMode} | Debug=${MemoryEngine.CONFIG.debug}`);

} catch (e) {
    console.error("[LMAI] Fatal Init Error:", e?.message || e, e?.stack);
}
```

})();