//@name long_memory_ai_assistant
//@display-name Librarian System V3.6 (Dynamic Core)
//@author rusinus12@gmail.com
//@api 3.0
//@version 3.6.0
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
 * =============================================================================
 * LONG MEMORY & AI ASSISTANT v3.6 (DYNAMIC CORE)
 * =============================================================================
 * [v3.6 Patch Notes]
 * 1. Dynamic Weights: 'auto' 모드 시 대화 텍스트(액션, 로맨스 등)를 분석해 가중치 자동 스위칭.
 * 2. Genre Presets: romance, action, mystery, daily 등 장르별 최적 가중치 프리셋 제공.
 * 3. Manual Override: 수동 파라미터 제어 기능 추가 (RisuAI 호환을 위해 string 인자 사용 후 숫자 변환).
 * 4. Stability (from v3.5): 15s Timeout AbortController, 에러 로깅, Incremental GC 개선.
 * =============================================================================
 */

(async () => {
    try {
        console.log('[LMAI] v3.6 Initializing...');

        // ─────────────────────────────────────────────
        // [UTILITY] LRU Cache
        // ─────────────────────────────────────────────
        class LRUCache {
            constructor(maxSize = 1000) { this.cache = new Map(); this.maxSize = maxSize; }
            get(k) { if (!this.cache.has(k)) return; const v = this.cache.get(k); this.cache.delete(k); this.cache.set(k, v); return v; }
            set(k, v) { if (this.cache.has(k)) this.cache.delete(k); if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value); this.cache.set(k, v); }
            has(k) { return this.cache.has(k); }
        }

        const sharedTokenCache = new LRUCache(2000);
        const sharedEmbedCache = new LRUCache(5000);

        // ─────────────────────────────────────────────
        // [ENGINE] Embedding Queue (Rate Limiting + Timeout)
        // ─────────────────────────────────────────────
        const EmbeddingQueue = (() => {
            const q = [], MAX = 2;
            let active = 0;

            const run = async () => {
                if (active >= MAX || q.length === 0) return;
                active++;
                const { task, resolve, reject } = q.shift();
                try { resolve(await task()); }
                catch (e) { reject(e); }
                finally { active--; run(); }
            };

            return { enqueue: (task) => new Promise((res, rej) => { q.push({ task, resolve: res, reject: rej }); run(); }) };
        })();

        // ─────────────────────────────────────────────
        // [ENGINE] Tokenizer & Hash
        // ─────────────────────────────────────────────
        const TokenizerEngine = (() => {
            const simpleHash = (s) => { let h = 0; for (let i = 0; i < (s||"").length; i++) h = Math.imul(31, h) ^ s.charCodeAt(i) | 0; return h; };
            const getSafeMapKey = (text) => {
                const t = text || "";
                return `${simpleHash(t)}_${t.slice(0, 8)}_${t.slice(-4)}`;
            };
            const tokenize = (t) => (t||"").toLowerCase().replace(/[^\w가-힣\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
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
                    if (cache.has(text)) return Promise.resolve(cache.get(text));

                    return EmbeddingQueue.enqueue(async () => {
                        const m = MemoryEngine?.CONFIG?.embedModel;
                        if (!m?.url) return null;

                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 15000); // 15s Timeout

                        try {
                            const res = await risuai.fetch(m.url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m.key}` },
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
                                console.warn(`[LMAI] Embedding Request Timeout (15s): "${text.slice(0,20)}..."`);
                            } else {
                                console.error(`[LMAI] Embedding API Error:`, e.message || e);
                            }
                            return null;
                        }
                    });
                },
                cosineSimilarity: (a, b) => {
                    if (!a || !b) return 0;
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
                    return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
                }
            };
        })();

        // ─────────────────────────────────────────────
        // [ENGINE] CBS Engine
        // ─────────────────────────────────────────────
        const CBSEngine = (() => {
            const R = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(".*?"|-?\d+\.?\d*)$/;
            const safeTrim = (v) => typeof v === "string" ? v.trim() : "";
            function parseDefaultVariables(raw) {
                return String(raw || "").split(/\r?\n/g).map(line => line.trim()).filter(Boolean).map(line => {
                    const eq = line.indexOf("="); if (eq === -1) return null;
                    return [line.slice(0, eq).trim(), line.slice(eq + 1)];
                }).filter(pair => pair && pair[0]);
            }
            function splitTopLevelCbsByDoubleColon(raw) {
                const src = String(raw || ""); const result = []; let current = "", braceDepth = 0, parenDepth = 0;
                for (let i = 0; i < src.length; i++) {
                    const two = src.slice(i, i + 2);
                    if (two === "{{") { braceDepth++; current += two; i++; continue; }
                    if (two === "}}" && braceDepth > 0) { braceDepth--; current += two; i++; continue; }
                    if (src[i] === "(") parenDepth++; if (src[i] === ")" && parenDepth > 0) parenDepth--;
                    if (two === "::" && braceDepth === 0 && parenDepth === 0) { result.push(current); current = ""; i++; continue; }
                    current += src[i];
                }
                result.push(current); return result;
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
                                if (depth === 0) return { start: i, end: j + 2, inner: src.substring(i + 2, j), raw: src.substring(i, j + 2) };
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
                    const tag = findNextCbsTag(text, cursor); if (!tag) break;
                    const inner = safeTrim(tag.inner);
                    if (inner.startsWith(`#${blockName} `)) depth++;
                    else if (inner === `/${blockName}`) { depth--; if (depth === 0) return { body: text.slice(startTag.end, elseTag ? elseTag.start : tag.start), elseBody: elseTag ? text.slice(elseTag.end, tag.start) : "", end: tag.end }; }
                    else if (inner === "else" && depth === 1 && blockName === "if") elseTag = tag;
                    cursor = tag.end;
                }
                return { body: text.slice(startTag.end), elseBody: "", end: text.length };
            }
            async function getStandaloneCbsRuntime() {
                const char = await risuai.getCharacter();
                const chat = (char && char.chats && char.chatPage !== undefined) ? char.chats[char.chatPage] : {};
                let db = null; try { db = await risuai.getDatabase(); } catch {}
                const vars = Object.create(null);
                for (const [k, v] of parseDefaultVariables(char?.defaultVariables)) vars[k] = String(v ?? "");
                for (const [k, v] of parseDefaultVariables(db?.templateDefaultVariables)) if (!(k in vars)) vars[k] = String(v ?? "");
                const scriptState = chat?.scriptstate && typeof chat.scriptstate === "object" ? chat.scriptstate : {};
                for (const [rawKey, value] of Object.entries(scriptState)) { const key = String(rawKey || ""); vars[key] = value == null ? "null" : String(value); }
                const globalVars = db?.globalChatVariables && typeof db.globalChatVariables === "object" ? db.globalChatVariables : {};
                const userName = safeTrim(db?.username || "User");
                const finalDb = { ...db, globalNote: chat?.localLore?.globalNote || db?.globalNote || "" };
                return { char, chat, db: finalDb, vars, globalVars, userName, functions: Object.create(null) };
            }
            function evalStandaloneCbsCalc(expression) {
                const src = String(expression || "").replace(/\s+/g, " ").trim();
                if (!src) return "";
                const looksConditional = /[<>=!&|]/.test(src);
                if (src.includes("{{") || src.includes("}}") || src.includes("[CBS_")) return looksConditional ? "0" : src;
                const whitelistRegex = /^[\d\s()+\-*/%<>=!&|.,'"_[\]]+$/;
                const blacklist = ["window", "process", "document", "risuai", "require", "import", "Function", "eval", "constructor", "prototype", "__proto__"];
                if (!whitelistRegex.test(src) || blacklist.some(k => src.includes(k))) return looksConditional ? "0" : src;
                try {
                    const result = Function(`"use strict"; return (${src});`)();
                    if (typeof result === "boolean") return result ? "1" : "0";
                    return result == null ? "" : String(result);
                } catch { return looksConditional ? "0" : src; }
            }
            function isStandaloneCbsTruthy(value) {
                const src = safeTrim(String(value ?? ""));
                if (!src || src === "0" || src.toLowerCase() === "false" || src.toLowerCase() === "null") return false;
                return true;
            }
            async function evalStandaloneCbsExpr(inner, runtime, args = []) {
                let expr = safeTrim(inner); if (!expr) return "";
                if (expr.includes("{{")) { expr = safeTrim(await renderStandaloneCbsText(expr, runtime, args)); if (!expr) return ""; }
                if (expr === "char" || expr === "Char") return safeTrim(runtime?.char?.name || "Char");
                if (expr === "user" || expr === "User") return runtime?.userName || "User";
                const parts = splitTopLevelCbsByDoubleColon(expr).map(s => String(s ?? ""));
                const head = safeTrim(parts[0] || "");
                if (head === "arg") { const index = Math.max(0, (parseInt(safeTrim(parts[1] || "1"), 10) || 1) - 1); return args[index] ?? "null"; }
                if (head === "getvar") { const keyRaw = parts.slice(1).join("::"); const key = safeTrim(await renderStandaloneCbsText(keyRaw, runtime, args)); if (!key) return "null"; if (Object.prototype.hasOwnProperty.call(runtime.vars, key)) return runtime.vars[key]; if (Object.prototype.hasOwnProperty.call(runtime.globalVars, key)) return runtime.globalVars[key]; return "null"; }
                if (head === "calc") { const expression = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return evalStandaloneCbsCalc(expression); }
                if (head === "none") return "";
                if (head === "random") { const choices = parts.slice(1); if (choices.length === 0) return ""; const randIdx = Math.floor(Math.random() * choices.length); return await renderStandaloneCbsText(choices[randIdx], runtime, args); }
                if (head === "token_count") { const text = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return String(TokenizerEngine.estimateTokens(text, MemoryEngine.CONFIG.tokenizerType)); }
                if (Object.prototype.hasOwnProperty.call(runtime.vars, expr)) return runtime.vars[expr];
                if (Object.prototype.hasOwnProperty.call(runtime.globalVars, expr)) return runtime.globalVars[expr];
                return expr;
            }
            async function renderStandaloneCbsText(text, runtime, args = []) {
                const src = String(text ?? ""); if (!src || !src.includes("{{")) return src;
                let out = "", cursor = 0;
                while (cursor < src.length) {
                    const tag = findNextCbsTag(src, cursor);
                    if (!tag) { out += src.slice(cursor); break; }
                    out += src.slice(cursor, tag.start);
                    const inner = safeTrim(tag.inner);
                    if (inner.startsWith("#if ")) { const conditionRaw = inner.slice(4); const block = extractCbsBlock(src, tag, "if"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                    if (inner === "else" || inner === "/if") { cursor = tag.end; continue; }
                    out += await evalStandaloneCbsExpr(inner, runtime, args); cursor = tag.end;
                }
                return out;
            }
            return {
                evalCondition: (cond, vars) => {
                    if (!cond) return true;
                    return cond.split('&&').every(p => {
                        const m = p.trim().match(R); if (!m) return false;
                        const [_, k, op, v] = m;
                        const left = vars[k];
                        const right = v.startsWith('"') ? v.slice(1, -1) : Number(v);
                        if (left === undefined) return false;
                        switch(op) {
                            case '>=': return left >= right; case '<=': return left <= right;
                            case '==': return left == right; case '!=': return left != right;
                            case '>': return left > right; case '<': return left < right;
                            default: return false;
                        }
                    });
                },
                parseVariables: (text, vars) => {
                    if (!text) return vars;
                    const n = { ...vars };
                    for (const m of text.matchAll(/\{\{(\w+)\s*=\s*(".*?"|-?\d+\.?\d*)\}\}/g)) n[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : Number(m[2]);
                    return n;
                },
                process: async (text) => {
                    if (!MemoryEngine.CONFIG.cbsEnabled) return text;
                    const src = String(text ?? ""); if (!src || !src.includes("{{")) return src;
                    try {
                        const runtime = await getStandaloneCbsRuntime();
                        return await renderStandaloneCbsText(src, runtime, []);
                    } catch (e) { console.error("[LMAI] CBS Error", e); return src; }
                },
                clean: (text) => typeof text === 'string' ? text.replace(//g, '').replace(//g, '').replace(/\{\{[\s\S]*?\}\}/g, '').trim() : ""
            };
        })();

        // ─────────────────────────────────────────────
        // [CORE] Memory Engine (v3.6 Dynamic)
        // ─────────────────────────────────────────────
        const MemoryEngine = (() => {
            const CONFIG = {
                maxLimit: 150, threshold: 5, simThreshold: 0.25,
                gcBatchSize: 5,
                tokenizerType: 'simple',
                weightMode: 'auto',
                weights: { importance: 0.3, similarity: 0.5, recency: 0.2 },
                debug: false,
                loreComment: "lmai_memory",
                mainModel: { format: "openai", url: "", key: "", model: "", temp: 0.7 },
                embedModel: { format: "openai", url: "", key: "", model: "text-embedding-3-small" }
            };

            const calculateDynamicWeights = (query) => {
                if (CONFIG.weightMode !== 'auto') return CONFIG.weights;

                const text = (query || "").toLowerCase();
                
                const isAction = /[!쾅윽피검총죽공격회피비명달려위험]/.test(text) || text.includes("기습");
                const isMystery = /[단서증거왜누가범인비밀거짓말수상추리]/.test(text);
                const isRomance = /[사랑좋아키스안아입술눈물손따뜻두근]/.test(text);

                let result = CONFIG.weights;
                let genre = 'default';

                if (isAction) { result = { similarity: 0.4, importance: 0.2, recency: 0.4 }; genre = 'action'; }
                else if (isMystery) { result = { similarity: 0.4, importance: 0.5, recency: 0.1 }; genre = 'mystery'; }
                else if (isRomance) { result = { similarity: 0.5, importance: 0.3, recency: 0.2 }; genre = 'romance'; }

                if (CONFIG.debug && genre !== 'default') {
                    console.log(`[LMAI] Auto Dynamic Weight [${genre.toUpperCase()}]: Sim(${result.similarity}) Imp(${result.importance}) Rec(${result.recency})`);
                }
                return result;
            };

            const metaCache = new LRUCache(2000);
            const simCache = new LRUCache(5000);
            const hashIndex = new Map();
            let gcCursor = 0;

            const _log = (msg) => { if (CONFIG.debug) console.log(`[LMAI] ${msg}`); };

            const getSafeKey = (entry) => entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");

            const parseMeta = (raw) => {
                const def = { t: 0, ttl: 0, imp: 5, type: 'context' };
                if (typeof raw !== 'string') return def;
                try { const m = raw.match(//); return m ? { ...def, ...JSON.parse(m[1]) } : def; } catch { return def; }
            };

            const getCachedMeta = (entry) => {
                const key = getSafeKey(entry);
                if (metaCache.has(key)) return metaCache.get(key);
                const m = parseMeta(entry.content);
                metaCache.set(key, m);
                return m;
            };

            const calcSimilarity = async (textA, textB) => {
                const hA = TokenizerEngine.simpleHash(textA);
                const hB = TokenizerEngine.simpleHash(textB);
                const cKey = hA < hB ? `${hA}_${hB}` : `${hB}_${hA}`;
                if (simCache.has(cKey)) return simCache.get(cKey);

                const lenA = textA.length, lenB = textB.length;
                if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.7) { simCache.set(cKey, 0); return 0; }

                const tA = new Set(TokenizerEngine.tokenize(textA));
                const tB = new Set(TokenizerEngine.tokenize(textB));
                let inter = 0; tA.forEach(w => { if(tB.has(w)) inter++; });
                const overlap = (tA.size + tB.size) > 0 ? inter / (tA.size + tB.size - inter) : 0;
                if (overlap < 0.1) { simCache.set(cKey, 0); return 0; }

                const vecA = await EmbeddingEngine.getEmbedding(textA);
                const vecB = await EmbeddingEngine.getEmbedding(textB);

                let score = overlap * 0.7;
                if (vecA && vecB) score = EmbeddingEngine.cosineSimilarity(vecA, vecB);

                simCache.set(cKey, score);
                return score;
            };

            const calcRecency = (turn, current) => Math.exp(-Math.max(0, current - turn) / 20);

            return {
                CONFIG, getSafeKey, getCachedMeta, calcRecency,

                rebuildIndex: (lorebook) => {
                    _log("Rebuilding Hash Index...");
                    hashIndex.clear();
                    const entries = Array.isArray(lorebook) ? lorebook : [];
                    entries.forEach(entry => {
                        if (entry.comment !== CONFIG.loreComment) return;
                        try {
                            const content = (entry.content || "").replace(//, '').trim();
                            if (content.length < 5) return;
                            const key = getSafeKey(entry);
                            const idxKey = TokenizerEngine.getIndexKey(content);
                            if (!hashIndex.has(idxKey)) hashIndex.set(idxKey, new Set());
                            hashIndex.get(idxKey).add(key);
                        } catch(e) { console.error("[LMAI] Index Build Error", e); }
                    });
                },

                registerIndex: (content) => {
                    const key = getSafeKey({ content });
                    const idxKey = TokenizerEngine.getIndexKey(content);
                    if (!hashIndex.has(idxKey)) hashIndex.set(idxKey, new Set());
                    hashIndex.get(idxKey).add(key);
                },

                checkDuplication: async (content, existingList) => {
                    const idxKey = TokenizerEngine.getIndexKey(content);
                    const candidates = hashIndex.get(idxKey) || new Set();
                    const map = new Map(existingList.map(e => [getSafeKey(e), e]));

                    const checkPool = [...Array.from(candidates).map(k => map.get(k)).filter(Boolean), ...existingList.slice(-5)];
                    const uniqueCheck = new Set(checkPool);

                    for (const item of uniqueCheck) {
                        if (!item || !item.content) continue;
                        if (Math.abs(item.content.length - content.length) > content.length * 0.7) continue;
                        const sim = await calcSimilarity(item.content, content);
                        if (sim > 0.75) return true;
                    }
                    return false;
                },

                prepareMemory: async (data, currentTurn, existingList, currentVars = {}) => {
                    const { content, importance } = data;
                    if (!content || content.length < 5) return null;

                    if (await MemoryEngine.checkDuplication(content, existingList)) return null;

                    const imp = importance || 5;
                    const ttl = imp >= 9 ? -1 : 30;
                    const meta = { t: currentTurn, ttl, imp };

                    MemoryEngine.registerIndex(content);

                    return {
                        key: "", comment: CONFIG.loreComment,
                        content: `\n${content}\n`,
                        mode: "normal", insertorder: 100, alwaysActive: true
                    };
                },

                retrieveMemories: async (query, currentTurn, candidates, vars, topK = 15) => {
                    const cleanQuery = query.trim();
                    const W = calculateDynamicWeights(cleanQuery); // Dynamic Weight Applier

                    const validCandidates = candidates.filter(entry => {
                        const meta = getCachedMeta(entry);
                        return meta.ttl === -1 || (meta.t + meta.ttl) >= currentTurn;
                    });

                    const results = await Promise.all(validCandidates.map(async (entry) => {
                        const meta = getCachedMeta(entry);
                        const text = (entry.content || "").replace(//, '').trim();
                        const sim = await calcSimilarity(cleanQuery, text);
                        if (sim < CONFIG.simThreshold) return null;
                        
                        const score = (sim * W.similarity) + (calcRecency(meta.t, currentTurn) * W.recency) + ((meta.imp / 10) * W.importance);
                        return { ...entry, _score: score };
                    }));

                    return results.filter(Boolean).sort((a, b) => b._score - a._score).slice(0, topK);
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
                        if (meta.ttl !== -1 && (meta.t + meta.ttl) < currentTurn) toDelete.add(getSafeKey(entry));
                    }

                    gcCursor = (gcCursor + batchSize) % totalEntries;

                    const managed = allEntries.filter(e => e.comment === CONFIG.loreComment);
                    if (managed.length > CONFIG.maxLimit) {
                        managed.sort((a,b) => getCachedMeta(a).t - getCachedMeta(b).t)
                              .slice(0, managed.length - CONFIG.maxLimit)
                              .forEach(e => toDelete.add(getSafeKey(e)));
                    }

                    if (toDelete.size > 0) {
                        const delSet = toDelete;
                        hashIndex.forEach((set, key) => {
                            set.forEach(item => { if(delSet.has(item)) set.delete(item); });
                            if (set.size === 0) hashIndex.delete(key);
                        });
                        return allEntries.filter(e => !delSet.has(getSafeKey(e)));
                    }
                    return allEntries;
                },

                getLorebook: (char, chat) => Array.isArray(char.lorebook) ? char.lorebook : (chat?.localLore || []),
                setLorebook: (char, chat, data) => { if(Array.isArray(char.lorebook)) char.lorebook=data; else if(chat) chat.localLore=data; },
                getManagedEntries: (lorebook) => (Array.isArray(lorebook) ? lorebook : []).filter(e => e.comment === CONFIG.loreComment)
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
            try { await cur; const c = await risuai.getCharacter(); const r = await f(JSON.parse(JSON.stringify(c))); return r ? await risuai.setCharacter(r) : false; }
            finally { if(rel) rel(); }
        };

        const updateConfigFromArgs = async () => {
            const cfg = MemoryEngine.CONFIG;
            let local = {};
            try {
                const saved = await risuai.pluginStorage.getItem('LMAI_Config');
                if (saved) local = typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) { /* fallback to default */ }

            const getVal = (key, argName, type, parent = null) => {
                let argVal; try { argVal = risuai.getArgument(argName); } catch {}
                let localVal = parent ? local[parent]?.[key] : local[key];

                if (localVal !== undefined) return type === 'number' ? Number(localVal) : localVal;
                if (argVal !== undefined) return type === 'number' ? Number(argVal) : argVal;
                return parent ? cfg[parent][key] : cfg[key];
            };

            cfg.maxLimit = getVal('maxLimit', 'max_limit', 'number');
            cfg.threshold = getVal('threshold', 'threshold', 'number');
            cfg.simThreshold = getVal('simThreshold', 'sim_threshold', 'number') ?? 0.25;
            cfg.debug = getVal('debug', 'debug', 'boolean');
            cfg.cbsEnabled = getVal('cbsEnabled', 'cbs_enabled', 'boolean');
            cfg.mainModel = {
                url: getVal('url', null, 'string', 'mainModel'),
                key: getVal('key', null, 'string', 'mainModel'),
                model: getVal('model', null, 'string', 'mainModel')
            };
            cfg.embedModel = {
                url: getVal('url', null, 'string', 'embedModel'),
                key: getVal('key', null, 'string', 'embedModel'),
                model: getVal('model', null, 'string', 'embedModel')
            };

            // V3.6 Dynamic Modes & Presets
            const mode = (getVal('weightMode', 'weight_mode', 'string') || 'auto').toLowerCase();
            cfg.weightMode = mode;

            // RisuAI 지원을 위해 헤더에서는 string으로 받고, 사용할 때는 내부에서 number로 변환
            const manualWeights = {
                similarity: getVal('w_sim', 'w_sim', 'number') ?? 0.5,
                importance: getVal('w_imp', 'w_imp', 'number') ?? 0.3,
                recency: getVal('w_rec', 'w_rec', 'number') ?? 0.2
            };

            const presets = {
                romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
                action:  { similarity: 0.4, importance: 0.2, recency: 0.4 },
                mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
                daily:   { similarity: 0.3, importance: 0.3, recency: 0.4 }
            };

            if (presets[mode]) {
                cfg.weights = presets[mode];
                if (cfg.debug) console.log(`[LMAI] Preset Loaded: ${mode.toUpperCase()}`);
            } else {
                cfg.weights = manualWeights; // fallback for 'auto' or 'manual' or undefined
            }
        };

        await updateConfigFromArgs();

        if (typeof risuai !== 'undefined') {
            try {
                const char = await risuai.getCharacter();
                const chat = char?.chats?.[char.chatPage];
                const lore = MemoryEngine.getLorebook(char, chat);
                MemoryEngine.rebuildIndex(lore);
            } catch(e) { console.error("[LMAI] Init Load Error", e); }
        }

        console.log("[LMAI] v3.6 Ready. (Dynamic Core)");

    } catch (e) { console.error("[LMAI] Init Error", e); }
})();
