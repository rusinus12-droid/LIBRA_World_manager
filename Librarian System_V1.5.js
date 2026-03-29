//@name long_memory_ai_assistant
//@display-name Librarian System v3.7.1 (Bug Fix & Optimization)
//@author rusinus12@gmail.com
//@api 3.0
//@version 3.7.1

(async () => {
    // ══════════════════════════════════════════════════════════════
    // [CORE] Global Error Handler
    // ══════════════════════════════════════════════════════════════
    class LMAIError extends Error {
        constructor(message, code, cause = null) {
            super(message);
            this.name = 'LMAIError';
            this.code = code;
            this.cause = cause;
            this.timestamp = Date.now();
        }
    }

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] State Management
    // ══════════════════════════════════════════════════════════════
    const MemoryState = {
        gcCursor: 0,
        hashIndex: new Map(),
        metaCache: null,
        simCache: null,
        isInitialized: false,
        initVersion: 0,

        reset() {
            this.gcCursor = 0;
            this.hashIndex.clear();
            this.metaCache?.cache?.clear();
            this.simCache?.cache?.clear();
            this.initVersion++;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] RWLock
    // ══════════════════════════════════════════════════════════════
    class RWLock {
        constructor() {
            this.readers = 0;
            this.writer = false;
            this.queue = [];
        }

        async readLock() {
            return new Promise(resolve => {
                if (!this.writer && this.queue.length === 0) {
                    this.readers++;
                    resolve();
                } else {
                    this.queue.push({ type: 'read', resolve });
                }
            });
        }

        async writeLock() {
            return new Promise(resolve => {
                if (!this.writer && this.readers === 0) {
                    this.writer = true;
                    resolve();
                } else {
                    this.queue.push({ type: 'write', resolve });
                }
            });
        }

        readUnlock() {
            this.readers--;
            this._next();
        }

        writeUnlock() {
            this.writer = false;
            this._next();
        }

        _next() {
            while (this.queue.length > 0) {
                const next = this.queue[0];
                if (next.type === 'write') {
                    if (this.readers === 0) {
                        this.queue.shift();
                        this.writer = true;
                        next.resolve();
                        return;
                    }
                    break;
                } else if (next.type === 'read') {
                    if (!this.writer) {
                        this.queue.shift();
                        this.readers++;
                        next.resolve();
                        continue;
                    }
                    break;
                }
            }
        }
    }

    const loreLock = new RWLock();

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] LRU Cache
    // ══════════════════════════════════════════════════════════════
    class LRUCache {
        constructor(maxSize = 1000) {
            this.cache = new Map();
            this.maxSize = maxSize;
            this.hits = 0;
            this.misses = 0;
        }

        get(k) {
            if (!this.cache.has(k)) {
                this.misses++;
                return undefined;
            }
            this.hits++;
            const v = this.cache.get(k);
            this.cache.delete(k);
            this.cache.set(k, v);
            return v;
        }

        peek(k) {
            return this.cache.get(k);
        }

        set(k, v) {
            if (this.cache.has(k)) this.cache.delete(k);
            if (this.cache.size >= this.maxSize) {
                this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(k, v);
        }

        has(k) { return this.cache.has(k); }
        delete(k) { return this.cache.delete(k); }
        clear() {
            this.cache.clear();
            this.hits = 0;
            this.misses = 0;
        }

        get stats() {
            const total = this.hits + this.misses;
            return {
                size: this.cache.size,
                hitRate: total > 0 ? (this.hits / total).toFixed(3) : 0
            };
        }
    }

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Tokenizer & Hash
    // [FIX-3] 해시 충돌 방지를 위해 토큰 참조 개수 증가 + 텍스트 길이 반영
    // ══════════════════════════════════════════════════════════════
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

        // [FIX-3] 개선된 인덱스 키 생성
        // - 처음 5개 + 마지막 3개 토큰 사용 (기존: 3 + 2)
        // - 전체 텍스트 길이를 해시에 포함하여 유사 길이 문장 구분
        // - 토큰이 부족하면 전체 토큰 사용
        const getIndexKey = (text) => {
            const tokens = tokenize(text);
            const textLen = text.length;

            let combined;
            if (tokens.length <= 8) {
                combined = tokens.join("_");
            } else {
                combined = [...tokens.slice(0, 5), ...tokens.slice(-3)].join("_");
            }

            // 텍스트 길이를 포함하여 유사 문장 구분 강화
            return simpleHash(`${combined}_${textLen}`);
        };

        const estimateTokens = (text, type = 'simple') => {
            if (!text) return 0;
            const ratio = type === 'gpt4' ? 0.5 : 0.6;
            return Math.ceil(text.length * ratio) + (text.match(/\s/g) || []).length;
        };

        return { simpleHash, tokenize, getIndexKey, getSafeMapKey, estimateTokens };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Safe Expression Evaluator
    // ══════════════════════════════════════════════════════════════
    const SafeEvaluator = (() => {
        const OPERATORS = {
            '+': (a, b) => a + b,
            '-': (a, b) => a - b,
            '*': (a, b) => a * b,
            '/': (a, b) => b !== 0 ? a / b : 0,
            '%': (a, b) => a % b,
            '>': (a, b) => a > b,
            '<': (a, b) => a < b,
            '>=': (a, b) => a >= b,
            '<=': (a, b) => a <= b,
            '==': (a, b) => a == b,
            '!=': (a, b) => a != b,
            '&&': (a, b) => a && b,
            '||': (a, b) => a || b
        };

        const PRECEDENCE = {
            '||': 1, '&&': 2,
            '==': 3, '!=': 3,
            '>': 4, '<': 4, '>=': 4, '<=': 4,
            '+': 5, '-': 5,
            '*': 6, '/': 6, '%': 6
        };

        const tokenize = (expr) => {
            const tokens = [];
            let i = 0;
            while (i < expr.length) {
                const ch = expr[i];
                if (/\s/.test(ch)) { i++; continue; }

                if (/\d/.test(ch) || (ch === '-' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
                    let num = '';
                    if (ch === '-') { num += ch; i++; }
                    while (i < expr.length && /[\d.]/.test(expr[i])) {
                        num += expr[i++];
                    }
                    tokens.push({ type: 'number', value: parseFloat(num) });
                    continue;
                }

                if (ch === '"' || ch === "'") {
                    const quote = ch;
                    let str = '';
                    i++;
                    while (i < expr.length && expr[i] !== quote) {
                        str += expr[i++];
                    }
                    i++;
                    tokens.push({ type: 'string', value: str });
                    continue;
                }

                const twoChar = expr.slice(i, i + 2);
                if (OPERATORS[twoChar]) {
                    tokens.push({ type: 'operator', value: twoChar });
                    i += 2;
                    continue;
                }

                if (OPERATORS[ch]) {
                    tokens.push({ type: 'operator', value: ch });
                    i++;
                    continue;
                }

                if (ch === '(' || ch === ')') {
                    tokens.push({ type: 'paren', value: ch });
                    i++;
                    continue;
                }

                i++;
            }
            return tokens;
        };

        const parse = (tokens) => {
            let pos = 0;

            const parseAtom = () => {
                const token = tokens[pos];
                if (!token) return null;

                if (token.type === 'number' || token.type === 'string') {
                    pos++;
                    return { type: 'literal', value: token.value };
                }

                if (token.type === 'paren' && token.value === '(') {
                    pos++;
                    const expr = parseExpression();
                    if (tokens[pos]?.value === ')') pos++;
                    return expr;
                }

                return null;
            };

            const parseBinary = (leftPrec) => {
                let left = parseAtom();
                if (!left) return null;

                while (true) {
                    const op = tokens[pos];
                    if (!op || op.type !== 'operator') break;
                    const prec = PRECEDENCE[op.value];
                    if (prec === undefined || prec <= leftPrec) break;

                    pos++;
                    const right = parseBinary(prec);
                    if (!right) break;

                    left = { type: 'binary', op: op.value, left, right };
                }

                return left;
            };

            const parseExpression = () => parseBinary(0);
            return parseExpression();
        };

        const evaluate = (ast, vars = {}) => {
            if (!ast) return '';

            if (ast.type === 'literal') return ast.value;

            if (ast.type === 'binary') {
                const left = evaluate(ast.left, vars);
                const right = evaluate(ast.right, vars);
                const op = OPERATORS[ast.op];

                if (!op) return 0;
                const result = op(left, right);
                return typeof result === 'boolean' ? (result ? 1 : 0) : result;
            }

            return '';
        };

        return {
            evaluate: (expr, vars = {}) => {
                try {
                    const tokens = tokenize(String(expr || ''));
                    const ast = parse(tokens);
                    if (!ast) return expr || '';
                    const result = evaluate(ast, vars);
                    return result == null ? '' : String(result);
                } catch {
                    return '';
                }
            }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [FIX-4] Embedding Queue - 재귀 제거, while 루프 기반으로 변경
    // ══════════════════════════════════════════════════════════════
    const EmbeddingQueue = (() => {
        const q = [];
        const MAX_CONCURRENT = 2;
        let active = 0;
        let running = false;

        const run = async () => {
            // 이미 실행 중이면 중복 실행 방지
            if (running) return;
            running = true;

            try {
                // while 루프로 변경: 재귀 호출 제거
                while (q.length > 0 && active < MAX_CONCURRENT) {
                    active++;
                    const { task, resolve, reject } = q.shift();

                    try {
                        const result = await task();
                        resolve(result);
                    } catch (e) {
                        reject(e);
                    } finally {
                        active--;
                    }
                }
            } finally {
                running = false;
            }
        };

        return {
            enqueue: (task) => new Promise((res, rej) => {
                q.push({ task, resolve: res, reject: rej });
                run(); // 큐에 추가 후 실행 트리거
            }),

            get queueLength() { return q.length; },
            get activeCount() { return active; }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [FIX-2] Emotion Analyzer - 부정어 처리 및 오탐지 방지
    // ══════════════════════════════════════════════════════════════
    const EmotionEngine = (() => {
        // 부정어 목록 (한글)
        const NEGATION_WORDS = ['않', '안', '못', '말', '미', '노', '누', '구', '별로', '전혀', '절대'];

        // 부정어 감지 윈도우 (키워드 앞뒤 몇 글자 내에 부정어가 있으면 무시)
        const NEGATION_WINDOW = 5;

        const EMOTION_KEYWORDS = {
            joy: ['기쁘', '행복', '좋아', '웃', '미소', '즐거', '환한', '밝게', '설레', '감사', '기뻐', '좋아하'],
            sadness: ['슬프', '우울', '눈물', '울', '흐느끼', '비통', '애도', '그리워', '외로', '서운', '속상'],
            anger: ['화나', '분노', '짜증', '열받', '억울', '폭발', '소리치', '으르렁', '성가', '화가'],
            fear: ['무서', '두려', '공포', '불안', '겁', '떨', '긴장', '위험', '무서워'],
            surprise: ['놀라', '충격', '예상치', '돌발', '어이없', '깜짝', '놀라워'],
            disgust: ['역겨', '혐오', '싫어', '지긋지긋', '구역질', '恶心', '징그러']
        };

        // 부정어가 키워드 근처에 있는지 확인
        const hasNegationNearby = (text, matchIndex, keyword) => {
            const start = Math.max(0, matchIndex - NEGATION_WINDOW - keyword.length);
            const end = Math.min(text.length, matchIndex + NEGATION_WINDOW);
            const context = text.slice(start, end);

            for (const negWord of NEGATION_WORDS) {
                if (context.includes(negWord)) {
                    return true;
                }
            }
            return false;
        };

        const analyze = (text) => {
            const scores = {};
            let total = 0;
            const lowerText = text.toLowerCase();
            const detectedKeywords = [];

            for (const [emotion, words] of Object.entries(EMOTION_KEYWORDS)) {
                let score = 0;
                for (const word of words) {
                    let searchPos = 0;
                    while (true) {
                        const idx = lowerText.indexOf(word, searchPos);
                        if (idx === -1) break;

                        // [FIX-2] 부정어 검사
                        if (!hasNegationNearby(lowerText, idx, word)) {
                            score++;
                            detectedKeywords.push({ emotion, word, index: idx });
                        }
                        searchPos = idx + 1;
                    }
                }
                scores[emotion] = score;
                total += score;
            }

            // [FIX-2] 토큰 기반 정밀 검사 (보조)
            // 공백으로 분리된 완전 일치 단어에 가중치 부여
            const tokens = TokenizerEngine.tokenize(text);
            for (const token of tokens) {
                for (const [emotion, words] of Object.entries(EMOTION_KEYWORDS)) {
                    if (words.some(w => token === w || token.startsWith(w))) {
                        // 부정어가 토큰 자체에 포함되어 있는지 확인
                        const hasNegation = NEGATION_WORDS.some(neg => token.includes(neg));
                        if (!hasNegation) {
                            scores[emotion] += 0.5; // 추가 가중치
                        }
                    }
                }
            }

            const dominant = Object.entries(scores)
                .filter(([, s]) => s > 0)
                .sort((a, b) => b[1] - a[1])[0];

            return {
                scores,
                dominant: dominant ? dominant[0] : 'neutral',
                intensity: total > 0 ? Math.min(1, total / 5) : 0,
                keywords: detectedKeywords
            };
        };

        return { analyze, NEGATION_WORDS, EMOTION_KEYWORDS };
    })();

    // ══════════════════════════════════════════════════════════════
    // [CORE] Memory Engine (v3.7.1 - Bug Fixed)
    // ══════════════════════════════════════════════════════════════
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
            emotionEnabled: true,
            loreComment: "lmai_memory",
            mainModel: { format: "openai", url: "", key: "", model: "", temp: 0.7 },
            embedModel: { format: "openai", url: "", key: "", model: "text-embedding-3-small" }
        };

        const getMetaCache = () => {
            if (!MemoryState.metaCache) {
                MemoryState.metaCache = new LRUCache(2000);
            }
            return MemoryState.metaCache;
        };

        const getSimCache = () => {
            if (!MemoryState.simCache) {
                MemoryState.simCache = new LRUCache(5000);
            }
            return MemoryState.simCache;
        };

        // ═══════════════════════════════════════════════════════════
        // [FIX-2] Genre Detection - 부정어 처리 및 정교화
        // ═══════════════════════════════════════════════════════════
        const GENRE_KEYWORDS = {
            action: ['공격', '회피', '기습', '위험', '비명', '달려', '총', '검', '폭발', '피격', '격투', '추격', '싸움', '전투'],
            romance: ['사랑', '좋아', '키스', '안아', '입술', '눈물', '손잡', '두근', '설레', '고백', '포옹', '그리워', '연인', '키스해'],
            mystery: ['단서', '증거', '범인', '비밀', '거짓말', '수상', '추리', '의심', '진실', '조사', '누가', '왜', '범죄'],
            daily: ['밥', '날씨', '오늘', '일상', '학교', '회사', '집에', '친구', '쇼핑', '영화', '산책', '점심', '아침']
        };

        // 감정-장르 매핑 (보조)
        const EMOTION_GENRE_MAP = {
            sadness: 'romance',
            anger: 'action',
            fear: 'mystery',
            joy: 'daily',
            surprise: 'action'
        };

        const detectGenreWeights = (query) => {
            if (CONFIG.weightMode !== 'auto') return null;

            const text = (query || "").toLowerCase();
            const scores = { action: 0, romance: 0, mystery: 0, daily: 0 };
            const matchedKeywords = [];

            for (const [genre, words] of Object.entries(GENRE_KEYWORDS)) {
                for (const word of words) {
                    let searchPos = 0;
                    while (true) {
                        const idx = text.indexOf(word, searchPos);
                        if (idx === -1) break;

                        // [FIX-2] 부정어 검사
                        const hasNegation = EmotionEngine.NEGATION_WORDS.some(neg => {
                            const start = Math.max(0, idx - EmotionEngine.NEGATION_WINDOW);
                            const end = Math.min(text.length, idx + word.length + EmotionEngine.NEGATION_WINDOW);
                            return text.slice(start, end).includes(neg);
                        });

                        if (!hasNegation) {
                            scores[genre]++;
                            matchedKeywords.push({ genre, word });
                        }
                        searchPos = idx + 1;
                    }
                }

                // 액션: 느낌표 가산
                if (genre === 'action' && /!/.test(text)) scores.action += 0.5;
            }

            // [FIX-2] 감정 기반 장르 보정
            if (CONFIG.emotionEnabled) {
                const emotion = EmotionEngine.analyze(text);
                if (emotion.dominant !== 'neutral' && emotion.intensity > 0.3) {
                    const mappedGenre = EMOTION_GENRE_MAP[emotion.dominant];
                    if (mappedGenre && scores[mappedGenre] !== undefined) {
                        scores[mappedGenre] += emotion.intensity * 0.5;
                    }
                }
            }

            const topGenre = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
            if (topGenre[1] < 1) return null;

            const PRESETS = {
                action: { similarity: 0.4, importance: 0.2, recency: 0.4 },
                romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
                mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
                daily: { similarity: 0.3, importance: 0.3, recency: 0.4 }
            };

            if (CONFIG.debug) {
                const scoreStr = Object.entries(scores).map(([g, s]) => `${g}:${s.toFixed(1)}`).join(', ');
                console.log(`[LMAI] Genre Detection [${topGenre[0].toUpperCase()}] scores={${scoreStr}}`);
            }

            return PRESETS[topGenre[0]];
        };

        const calculateDynamicWeights = (query) => {
            const detected = detectGenreWeights(query);
            return detected || CONFIG.weights;
        };

        const _log = (msg) => { if (CONFIG.debug) console.log(`[LMAI] ${msg}`); };

        const getSafeKey = (entry) =>
            entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");

        const META_PATTERN = /\[META:(\{[^}]+\})\]/;

        const parseMeta = (raw) => {
            const def = { t: 0, ttl: 0, imp: 5, type: 'context' };
            if (typeof raw !== 'string') return def;
            try {
                const m = raw.match(META_PATTERN);
                return m ? { ...def, ...JSON.parse(m[1]) } : def;
            } catch (e) {
                if (CONFIG.debug) console.warn('[LMAI] parseMeta error:', e?.message);
                return def;
            }
        };

        const getCachedMeta = (entry) => {
            const key = getSafeKey(entry);
            const cache = getMetaCache();
            const cached = cache.peek(key);
            if (cached !== undefined) return cached;
            const m = parseMeta(entry.content);
            cache.set(key, m);
            return m;
        };

        const calcSimilarity = async (textA, textB) => {
            const hA = TokenizerEngine.simpleHash(textA);
            const hB = TokenizerEngine.simpleHash(textB);
            const cKey = hA < hB ? `${hA}_${hB}` : `${hB}_${hA}`;

            const simCache = getSimCache();
            if (simCache.has(cKey)) return simCache.get(cKey);

            const lenA = textA.length, lenB = textB.length;
            if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.7) {
                simCache.set(cKey, 0);
                return 0;
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

            const score = (vecA && vecB)
                ? EmbeddingEngine.cosineSimilarity(vecA, vecB) * 0.7 + jaccard * 0.3
                : jaccard * 0.7;

            simCache.set(cKey, score);
            return score;
        };

        const calcRecency = (turn, current) =>
            Math.exp(-Math.max(0, current - turn) / 20);

        // ═══════════════════════════════════════════════════════════
        // Embedding Engine
        // ═══════════════════════════════════════════════════════════
        const EmbeddingEngine = (() => {
            return {
                getEmbedding: async (text) => {
                    const cache = getSimCache();
                    if (cache.has(text)) return Promise.resolve(cache.get(text));

                    return EmbeddingQueue.enqueue(async () => {
                        const m = CONFIG.embedModel;
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
                                console.warn(`[LMAI] Embedding Timeout: "${text.slice(0, 20)}..."`);
                            } else {
                                console.error(`[LMAI] Embedding Error:`, e?.message || e);
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

        // ═══════════════════════════════════════════════════════════
        // CBS Engine
        // ═══════════════════════════════════════════════════════════
        const CBSEngine = (() => {
            const safeTrim = (v) => typeof v === "string" ? v.trim() : "";

            return {
                process: async (text) => {
                    if (!CONFIG.cbsEnabled) return text;
                    return text;
                },
                clean: (text) => typeof text === 'string'
                    ? text.replace(/<[^>]+>/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').trim()
                    : ""
            };
        })();

        // ═══════════════════════════════════════════════════════════
        // [FIX-1] incrementalGC - 반환값 활용 및 상태 업데이트
        // ═══════════════════════════════════════════════════════════
        const incrementalGC = (allEntries, currentTurn) => {
            const toDelete = new Set();
            const totalEntries = allEntries.length;
            if (totalEntries === 0) return { entries: allEntries, deleted: 0 };

            const batchSize = CONFIG.gcBatchSize;
            for (let i = 0; i < batchSize; i++) {
                const idx = (MemoryState.gcCursor + i) % totalEntries;
                const entry = allEntries[idx];
                const meta = getCachedMeta(entry);
                if (meta.ttl !== -1 && (meta.t + meta.ttl) < currentTurn) {
                    toDelete.add(getSafeKey(entry));
                }
            }
            MemoryState.gcCursor = (MemoryState.gcCursor + batchSize) % Math.max(1, totalEntries);

            const managed = allEntries.filter(e => e.comment === CONFIG.loreComment);
            if (managed.length > CONFIG.maxLimit) {
                managed
                    .sort((a, b) => getCachedMeta(a).t - getCachedMeta(b).t)
                    .slice(0, managed.length - CONFIG.maxLimit)
                    .forEach(e => toDelete.add(getSafeKey(e)));
            }

            if (toDelete.size > 0) {
                MemoryState.hashIndex.forEach((set, key) => {
                    toDelete.forEach(item => set.delete(item));
                    if (set.size === 0) MemoryState.hashIndex.delete(key);
                });
                // [FIX-1] 결과 객체 반환 (entries + 삭제 카운트)
                return {
                    entries: allEntries.filter(e => !toDelete.has(getSafeKey(e))),
                    deleted: toDelete.size
                };
            }
            return { entries: allEntries, deleted: 0 };
        };

        // Public API
        return {
            CONFIG,
            getSafeKey,
            getCachedMeta,
            calcRecency,
            EmbeddingEngine,
            EmotionEngine,
            SafeEvaluator,
            TokenizerEngine,

            rebuildIndex: (lorebook) => {
                _log("Rebuilding Hash Index...");
                MemoryState.hashIndex.clear();
                const entries = Array.isArray(lorebook) ? lorebook : [];
                entries.forEach(entry => {
                    if (entry.comment !== CONFIG.loreComment) return;
                    try {
                        const content = (entry.content || "").replace(META_PATTERN, '').trim();
                        if (content.length < 5) return;
                        const key = getSafeKey(entry);
                        const idxKey = TokenizerEngine.getIndexKey(content);
                        if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                        MemoryState.hashIndex.get(idxKey).add(key);
                    } catch (e) {
                        console.error("[LMAI] Index Error:", e?.message || e);
                    }
                });
            },

            checkDuplication: async (content, existingList) => {
                const idxKey = TokenizerEngine.getIndexKey(content);
                const candidates = MemoryState.hashIndex.get(idxKey) || new Set();
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

            // ═══════════════════════════════════════════════════════
            // [FIX-1] prepareMemory - GC 결과 반영 및 원본 업데이트
            // ═══════════════════════════════════════════════════════
            prepareMemory: async (data, currentTurn, existingList, lorebook, char, chat) => {
                const { content, importance } = data;
                if (!content || content.length < 5) return null;

                // 조기 GC 체크
                const managed = MemoryEngine.getManagedEntries(lorebook);
                if (managed.length >= Math.floor(CONFIG.maxLimit * 0.95)) {
                    _log(`Early GC triggered: ${managed.length}/${CONFIG.maxLimit}`);

                    // [FIX-1] GC 실행 및 결과 받기
                    const gcResult = MemoryEngine.incrementalGC(lorebook, currentTurn);

                    // [FIX-1] 삭제된 항목이 있으면 원본 lorebook 업데이트
                    if (gcResult.deleted > 0) {
                        _log(`GC removed ${gcResult.deleted} entries`);

                        // lorebook 배열 직접 업데이트 (RisuAI 방식)
                        lorebook.length = 0;
                        lorebook.push(...gcResult.entries);

                        // 인덱스 재구축
                        MemoryEngine.rebuildIndex(lorebook);

                        // [FIX-1] 캐릭터 상태 저장
                        if (char && chat !== undefined) {
                            MemoryEngine.setLorebook(char, chat, lorebook);
                        }
                    }
                }

                // 중복 체크는 업데이트된 lorebook 기준으로
                const updatedList = lorebook || existingList;
                if (await MemoryEngine.checkDuplication(content, updatedList)) return null;

                const imp = importance || 5;
                const ttl = imp >= 9 ? -1 : 30;
                const meta = { t: currentTurn, ttl, imp };

                const idxKey = TokenizerEngine.getIndexKey(content);
                if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                MemoryState.hashIndex.get(idxKey).add(TokenizerEngine.getSafeMapKey(content));

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
                    const text = (entry.content || "").replace(META_PATTERN, '').trim();
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

            // [FIX-1] 외부에서도 호출 가능하도록 노출
            incrementalGC,

            getLorebook: (char, chat) =>
                Array.isArray(char.lorebook) ? char.lorebook : (chat?.localLore || []),

            setLorebook: (char, chat, data) => {
                if (Array.isArray(char.lorebook)) char.lorebook = data;
                else if (chat) chat.localLore = data;
            },

            getManagedEntries: (lorebook) =>
                (Array.isArray(lorebook) ? lorebook : [])
                    .filter(e => e.comment === CONFIG.loreComment),

            getCacheStats: () => ({
                meta: getMetaCache().stats,
                sim: getSimCache().stats
            }),

            getState: () => ({ ...MemoryState })
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MAIN] Initialization
    // ══════════════════════════════════════════════════════════════
    const safeModify = async (f) => {
        await loreLock.writeLock();
        try {
            const c = await risuai.getCharacter();
            const copy = typeof structuredClone === 'function'
                ? structuredClone(c)
                : JSON.parse(JSON.stringify(c));
            const r = await f(copy);
            return r ? await risuai.setCharacter(r) : false;
        } finally {
            loreLock.writeUnlock();
        }
    };

    const updateConfigFromArgs = async () => {
        const cfg = MemoryEngine.CONFIG;
        let local = {};
        try {
            const saved = await risuai.pluginStorage.getItem('LMAI_Config');
            if (saved) local = typeof saved === 'string' ? JSON.parse(saved) : saved;
        } catch (e) {
            console.warn('[LMAI] Config load failed:', e?.message || e);
        }

        const getVal = (key, argName, type, parent = null, fallback = undefined) => {
            const localVal = parent ? local[parent]?.[key] : local[key];
            let argVal;
            if (argName) {
                try { argVal = risuai.getArgument(argName); } catch { }
            }
            const configVal = parent ? cfg[parent]?.[key] : cfg[key];

            const raw = localVal !== undefined ? localVal
                : argVal !== undefined ? argVal
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

        cfg.maxLimit = getVal('maxLimit', 'max_limit', 'number', null, 150);
        cfg.threshold = getVal('threshold', 'threshold', 'number', null, 5);
        cfg.simThreshold = getVal('simThreshold', 'sim_threshold', 'number', null, 0.25);
        cfg.debug = getVal('debug', 'debug', 'boolean', null, false);
        cfg.cbsEnabled = getVal('cbsEnabled', 'cbs_enabled', 'boolean', null, true);
        cfg.emotionEnabled = getVal('emotionEnabled', 'emotion_enabled', 'boolean', null, true);

        cfg.mainModel = {
            url: getVal('url', null, 'string', 'mainModel', ''),
            key: getVal('key', null, 'string', 'mainModel', ''),
            model: getVal('model', null, 'string', 'mainModel', '')
        };
        cfg.embedModel = {
            url: getVal('url', null, 'string', 'embedModel', ''),
            key: getVal('key', null, 'string', 'embedModel', ''),
            model: getVal('model', null, 'string', 'embedModel', 'text-embedding-3-small')
        };

        const mode = (getVal('weightMode', 'weight_mode', 'string', null, 'auto')).toLowerCase();
        cfg.weightMode = mode;

        const manualWeights = {
            similarity: getVal('w_sim', 'w_sim', 'number', null, 0.5),
            importance: getVal('w_imp', 'w_imp', 'number', null, 0.3),
            recency: getVal('w_rec', 'w_rec', 'number', null, 0.2)
        };

        const weightSum = Object.values(manualWeights).reduce((a, b) => a + b, 0);
        if (Math.abs(weightSum - 1.0) > 0.01 && weightSum > 0) {
            manualWeights.similarity /= weightSum;
            manualWeights.importance /= weightSum;
            manualWeights.recency /= weightSum;
            if (cfg.debug) console.log(`[LMAI] Weights normalized`);
        }

        const PRESETS = {
            romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
            action: { similarity: 0.4, importance: 0.2, recency: 0.4 },
            mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
            daily: { similarity: 0.3, importance: 0.3, recency: 0.4 }
        };

        if (PRESETS[mode]) {
            cfg.weights = PRESETS[mode];
            if (cfg.debug) console.log(`[LMAI] Preset: ${mode.toUpperCase()}`);
        } else {
            cfg.weights = manualWeights;
        }
    };

    // Initialize
    try {
        console.log('[LMAI] v3.7.1 Initializing...');
        await updateConfigFromArgs();

        if (typeof risuai !== 'undefined') {
            const char = await risuai.getCharacter();
            const chat = char?.chats?.[char.chatPage];
            const lore = MemoryEngine.getLorebook(char, chat);
            MemoryEngine.rebuildIndex(lore);
        }

        MemoryState.isInitialized = true;
        console.log(`[LMAI] v3.7.1 Ready. Mode=${MemoryEngine.CONFIG.weightMode} | Debug=${MemoryEngine.CONFIG.debug}`);
    } catch (e) {
        console.error("[LMAI] Init Error:", e?.message || e, e?.stack);
    }

    // Export
    if (typeof globalThis !== 'undefined') {
        globalThis.LMAI = MemoryEngine;
    }

})();