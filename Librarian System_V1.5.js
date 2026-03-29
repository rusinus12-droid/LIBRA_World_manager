//@name long_memory_ai_assistant
//@display-name Librarian System v6.0 (Hierarchical World)
//@author rusinus12@gmail.com
//@api 3.0
//@version 6.0.0

(async () => {
    // ══════════════════════════════════════════════════════════════
    // [CORE] Error Handler
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
        sessionCache: new Map(),
        isInitialized: false,
        currentTurn: 0,
        initVersion: 0,

        reset() {
            this.gcCursor = 0;
            this.hashIndex.clear();
            this.metaCache?.cache?.clear();
            this.simCache?.cache?.clear();
            this.sessionCache.clear();
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

        readUnlock() { this.readers--; this._next(); }
        writeUnlock() { this.writer = false; this._next(); }

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
            if (!this.cache.has(k)) { this.misses++; return undefined; }
            this.hits++;
            const v = this.cache.get(k);
            this.cache.delete(k);
            this.cache.set(k, v);
            return v;
        }

        peek(k) { return this.cache.get(k); }

        set(k, v) {
            if (this.cache.has(k)) this.cache.delete(k);
            if (this.cache.size >= this.maxSize) {
                this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(k, v);
        }

        has(k) { return this.cache.has(k); }
        delete(k) { return this.cache.delete(k); }
        clear() { this.cache.clear(); this.hits = 0; this.misses = 0; }
        get stats() {
            const total = this.hits + this.misses;
            return { size: this.cache.size, hitRate: total > 0 ? (this.hits / total).toFixed(3) : 0 };
        }
    }

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Tokenizer & Hash
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
            return`${simpleHash(t)}_${t.slice(0, 8)}_${t.slice(-4)}`;
        };

        const tokenize = (t) =>
            (t || "").toLowerCase()
                .replace(/[^\w가-힣\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 1);

        const getIndexKey = (text) => {
            const tokens = tokenize(text);
            const textLen = text.length;
            let combined;
            if (tokens.length <= 8) {
                combined = tokens.join("_");
            } else {
                combined = [...tokens.slice(0, 5), ...tokens.slice(-3)].join("_");
            }
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
    // [ENGINE] Embedding Queue
    // ══════════════════════════════════════════════════════════════
    const EmbeddingQueue = (() => {
        const q = [];
        const MAX_CONCURRENT = 2;
        let active = 0;
        let running = false;

        const run = async () => {
            if (running) return;
            running = true;
            try {
                while (q.length > 0 && active < MAX_CONCURRENT) {
                    active++;
                    const { task, resolve, reject } = q.shift();
                    try {
                        resolve(await task());
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
                run();
            }),
            get queueLength() { return q.length; },
            get activeCount() { return active; }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Emotion Analyzer
    // ══════════════════════════════════════════════════════════════
    const EmotionEngine = (() => {
        const NEGATION_WORDS = ['않', '안', '못', '말', '미', '노', '누', '구', '별로', '전혀', '절대'];
        const NEGATION_WINDOW = 5;

        const hasNegationNearby = (text, matchIndex) => {
            const start = Math.max(0, matchIndex - NEGATION_WINDOW);
            const end = Math.min(text.length, matchIndex + NEGATION_WINDOW);
            const context = text.slice(start, end);
            return NEGATION_WORDS.some(neg => context.includes(neg));
        };

        const analyze = (text) => {
            const lowerText = (text || "").toLowerCase();
            let score = 0;
            const emotions = { joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 };

            const keywords = {
                joy: ['기쁘', '행복', '좋아', '웃', '미소', '즐거'],
                sadness: ['슬프', '우울', '눈물', '울', '그리워'],
                anger: ['화나', '분노', '짜증', '열받'],
                fear: ['무서', '두려', '공포', '불안'],
                surprise: ['놀라', '충격', '깜짝'],
                disgust: ['역겨', '혐오', '싫어']
            };

            for (const [emotion, words] of Object.entries(keywords)) {
                for (const word of words) {
                    let idx = lowerText.indexOf(word);
                    while (idx !== -1) {
                        if (!hasNegationNearby(lowerText, idx)) {
                            emotions[emotion]++;
                            score++;
                        }
                        idx = lowerText.indexOf(word, idx + 1);
                    }
                }
            }

            const dominant = Object.entries(emotions).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0];
            return {
                scores: emotions,
                dominant: dominant ? dominant[0] : 'neutral',
                intensity: Math.min(1, score / 5)
            };
        };

        return { analyze, NEGATION_WORDS };
    })();

    // ══════════════════════════════════════════════════════════════
    // [API] LLM Provider
    // ══════════════════════════════════════════════════════════════
    const LLMProvider = (() => {
        const call = async (config, systemPrompt, userContent, options = {}) => {
            if (!config.useLLM || !config.llm?.key) {
                return { content: null, skipped: true, reason: 'LLM not configured' };
            }

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ];

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), config.llm.timeout || 15000);

                const response = await risuai.fetch(config.llm.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization':`Bearer ${config.llm.key}`
                    },
                    body: JSON.stringify({
                        model: config.llm.model,
                        messages: messages,
                        temperature: config.llm.temp || 0.3,
                        max_tokens: options.maxTokens || 1000
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    throw new LMAIError(`LLM API Error: ${response.status}`, 'API_ERROR');
                }

                const data = await response.json();
                return {
                    content: data.choices?.[0]?.message?.content || '',
                    usage: data.usage || {}
                };

            } catch (e) {
                console.error('[LMAI] LLM Provider Error:', e?.message || e);
                throw e;
            }
        };

        return { call };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] World Templates
    // ══════════════════════════════════════════════════════════════
    const WORLD_TEMPLATES = {
        modern_reality: {
            name: '현대 현실',
            description: '우리가 사는 현실 세계와 유사',
            rules: {
                exists: { magic: false, ki: false, technology: 'modern', supernatural: false, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: false }
            }
        },
        fantasy: {
            name: '판타지',
            description: '마법과 신화적 존재가 존재하는 세계',
            rules: {
                exists: { magic: true, ki: false, technology: 'medieval', supernatural: true, mythical_creatures: ['dragon', 'fairy', 'demon'], non_human_races: ['elf', 'dwarf', 'orc'] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: true, factions: true }
            }
        },
        wuxia: {
            name: '무협',
            description: '기와 무공이 존재하는 무림 세계',
            rules: {
                exists: { magic: false, ki: true, technology: 'medieval', supernatural: true, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: true, stats: false, classes: false, guilds: true, factions: true }
            }
        },
        game_isekai: {
            name: '게임 이세계',
            description: '레벨, 스킬, 스탯 시스템이 존재',
            rules: {
                exists: { magic: true, ki: false, technology: 'medieval', supernatural: true, mythical_creatures: ['dragon', 'demon'], non_human_races: ['elf', 'dwarf', 'beastkin'] },
                systems: { leveling: true, skills: true, stats: true, classes: true, guilds: true, factions: true }
            }
        },
        modern_fantasy: {
            name: '현대 판타지',
            description: '현대 배경에 초능력/마법이 공존',
            rules: {
                exists: { magic: true, ki: false, technology: 'modern', supernatural: true, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: true }
            }
        },
        sf: {
            name: 'SF',
            description: '고도로 발달한 과학 기술의 세계',
            rules: {
                exists: { magic: false, ki: false, technology: 'futuristic', supernatural: false, mythical_creatures: [], non_human_races: ['android', 'alien'] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: true }
            }
        },
        cyberpunk: {
            name: '사이버펑크',
            description: '첨단 기술과 디스토피아가 공존',
            rules: {
                exists: { magic: false, ki: false, technology: 'futuristic', supernatural: false, mythical_creatures: [], non_human_races: ['cyborg', 'android'] },
                systems: { leveling: false, skills: true, stats: true, classes: false, guilds: false, factions: true }
            }
        },
        post_apocalyptic: {
            name: '포스트 아포칼립스',
            description: '재앙 이후의 황폐한 세계',
            rules: {
                exists: { magic: false, ki: false, technology: 'modern', supernatural: true, mythical_creatures: [], non_human_races: ['mutant'] },
                systems: { leveling: false, skills: true, stats: false, classes: false, guilds: false, factions: true }
            }
        }
    };

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Hierarchical World Manager
    // ══════════════════════════════════════════════════════════════
    const HierarchicalWorldManager = (() => {
        let profile = null;
        const WORLD_GRAPH_COMMENT = "lmai_world_graph";
        const WORLD_NODE_COMMENT = "lmai_world_node";

        const createDefaultProfile = () => ({
            version: '6.0',
            rootId: null,
            global: { multiverse: false, dimensionTravel: false, timeTravel: false, metaNarrative: false },
            nodes: new Map(),
            activePath: [],
            interference: { level: 0, recentEvents: [] },
            meta: { created: Date.now(), updated: 0, complexity: 1 }
        });

        const createDefaultRootNode = () => ({
            id: 'world_main',
            name: '주요 세계',
            layer: 'dimension',
            parent: null,
            children: [],
            isActive: true,
            isPrimary: true,
            accessCondition: null,
            rules: {
                exists: { magic: false, ki: false, technology: 'modern', supernatural: false, mythical_creatures: [], non_human_races: [] },
                systems: { leveling: false, skills: false, stats: false, classes: false, guilds: false, factions: false },
                physics: { gravity: 'normal', time_flow: 'linear', space: 'three_dimensional', special_phenomena: [] },
                inheritance: { mode: 'extend', exceptions: [] }
            },
            dimensional: null,
            connections: [],
            meta: { created: Date.now(), updated: 0, source: 'default', notes: '' }
        });

        const deepMerge = (target, source) => {
            const result = { ...target };
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = deepMerge(result[key] || {}, source[key]);
                } else if (Array.isArray(source[key])) {
                    result[key] = [...new Set([...(result[key] || []), ...source[key]])];
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        };

        const deepClone = (obj) => {
            if (!obj) return obj;
            try {
                return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
            } catch {
                return obj;
            }
        };

        const loadWorldGraph = (lorebook) => {
            if (profile) return profile;

            const graphEntry = lorebook.find(e => e.comment === WORLD_GRAPH_COMMENT);
            if (graphEntry) {
                try {
                    const parsed = JSON.parse(graphEntry.content);
                    profile = { ...createDefaultProfile(), ...parsed, nodes: new Map(parsed.nodes || []) };
                } catch (e) {
                    console.warn('[LMAI] Failed to parse world graph:', e?.message);
                }
            }

            if (!profile) {
                profile = createDefaultProfile();
            }

            const nodeEntries = lorebook.filter(e => e.comment === WORLD_NODE_COMMENT);
            for (const entry of nodeEntries) {
                try {
                    const node = JSON.parse(entry.content);
                    profile.nodes.set(node.id, node);
                } catch (e) {
                    console.warn('[LMAI] Failed to parse world node:', e?.message);
                }
            }

            if (profile.nodes.size === 0) {
                const rootNode = createDefaultRootNode();
                profile.nodes.set(rootNode.id, rootNode);
                profile.rootId = rootNode.id;
                profile.activePath = [rootNode.id];
            }

            return profile;
        };

        const getEffectiveRules = (nodeId) => {
            const node = profile.nodes.get(nodeId);
            if (!node) return null;

            const parentChain = [];
            let currentId = node.parent;
            while (currentId) {
                const parentNode = profile.nodes.get(currentId);
                if (parentNode) {
                    parentChain.unshift(parentNode);
                    currentId = parentNode.parent;
                } else break;
            }

            let effectiveRules = { exists: {}, systems: {}, physics: {}, custom: {} };
            for (const parent of parentChain) {
                effectiveRules = mergeRules(effectiveRules, parent.rules, parent.rules?.inheritance?.mode || 'extend');
            }
            effectiveRules = mergeRules(effectiveRules, node.rules, node.rules?.inheritance?.mode || 'extend');
            return effectiveRules;
        };

        const mergeRules = (base, overlay, mode) => {
            if (!overlay) return base;
            if (mode === 'override' || mode === 'isolate') return deepClone(overlay);
            return deepMerge(base, overlay);
        };

        const getCurrentRules = () => {
            if (!profile || profile.activePath.length === 0) return null;
            const currentId = profile.activePath[profile.activePath.length - 1];
            return getEffectiveRules(currentId);
        };

        const changeActivePath = (newNodeId, transition = null) => {
            const node = profile.nodes.get(newNodeId);
            if (!node) return { success: false, reason: 'Node not found' };

            const oldPath = [...profile.activePath];
            profile.activePath.push(newNodeId);
            node.isActive = true;

            if (transition) {
                profile.interference.recentEvents.push({
                    type: 'dimension_shift',
                    from: oldPath,
                    to: profile.activePath,
                    method: transition.method,
                    turn: MemoryState.currentTurn
                });
                if (profile.interference.recentEvents.length > 10) {
                    profile.interference.recentEvents.shift();
                }
                profile.interference.level = Math.min(1, profile.interference.recentEvents.length / 10);
            }

            return { success: true, oldPath, newPath: profile.activePath, node };
        };

        const popActivePath = () => {
            if (profile.activePath.length <= 1) return { success: false, reason: 'Cannot pop root' };
            const removedId = profile.activePath.pop();
            const removedNode = profile.nodes.get(removedId);
            if (removedNode) removedNode.isActive = false;
            return { success: true, removedNode, currentPath: profile.activePath };
        };

        const createNode = (config) => {
            const id = config.id ||`node_${Date.now()}`;
            const parentId = config.parent;

            if (parentId) {
                const parent = profile.nodes.get(parentId);
                if (!parent) return { success: false, reason: 'Parent not found' };
            }

            const node = {
                id,
                name: config.name || '새로운 세계',
                layer: config.layer || 'dimension',
                parent: parentId,
                children: [],
                isActive: false,
                isPrimary: config.isPrimary || false,
                accessCondition: config.accessCondition || null,
                rules: config.rules || { exists: {}, systems: {}, physics: {}, inheritance: { mode: 'extend', exceptions: [] } },
                dimensional: config.dimensional || null,
                connections: config.connections || [],
                meta: { created: Date.now(), updated: 0, source: config.source || 'user', notes: config.notes || '' }
            };

            profile.nodes.set(id, node);
            if (parentId) {
                const parent = profile.nodes.get(parentId);
                if (parent) parent.children.push(id);
            }

            updateComplexity();
            return { success: true, node };
        };

        const updateNode = (nodeId, updates) => {
            const node = profile.nodes.get(nodeId);
            if (!node) return { success: false, reason: 'Node not found' };

            if (updates.name) node.name = updates.name;
            if (updates.rules) node.rules = deepMerge(node.rules, updates.rules);
            if (updates.dimensional) node.dimensional = { ...node.dimensional, ...updates.dimensional };
            if (updates.connections) node.connections = [...node.connections, ...updates.connections];
            node.meta.updated = Date.now();

            return { success: true, node };
        };

        const updateComplexity = () => {
            const nodeCount = profile.nodes.size;
            const connectionCount = Array.from(profile.nodes.values()).reduce((sum, n) => sum + (n.connections?.length || 0), 0);
            profile.meta.complexity = 1 + Math.log2(nodeCount + 1) + (connectionCount * 0.1);
        };

        const saveWorldGraph = async (char, chat, lorebook) => {
            profile.meta.updated = Date.now();
            const graphEntry = {
                key: 'world_graph',
                comment: WORLD_GRAPH_COMMENT,
                content: JSON.stringify({
                    version: profile.version,
                    rootId: profile.rootId,
                    global: profile.global,
                    activePath: profile.activePath,
                    interference: profile.interference,
                    meta: profile.meta,
                    nodes: Array.from(profile.nodes.entries())
                }),
                mode: 'normal',
                insertorder: 1,
                alwaysActive: true
            };

            const existingIdx = lorebook.findIndex(e => e.comment === WORLD_GRAPH_COMMENT);
            if (existingIdx >= 0) lorebook[existingIdx] = graphEntry;
            else lorebook.unshift(graphEntry);
        };

        const formatForPrompt = () => {
            if (!profile) return '';

            const parts = [];
            parts.push('【세계관 구조】');

            const globalFeatures = [];
            if (profile.global.multiverse) globalFeatures.push('멀티버스');
            if (profile.global.dimensionTravel) globalFeatures.push('차원 이동 가능');
            if (profile.global.timeTravel) globalFeatures.push('시간 여행 가능');
            if (profile.global.metaNarrative) globalFeatures.push('메타 서술');
            if (globalFeatures.length > 0) parts.push(`구조: ${globalFeatures.join(', ')}`);

            if (profile.activePath.length > 0) {
                parts.push('\n[현재 위치]');
                for (let i = 0; i < profile.activePath.length; i++) {
                    const node = profile.nodes.get(profile.activePath[i]);
                    if (node) {
                        const indent = '  '.repeat(i);
                        const active = i === profile.activePath.length - 1 ? ' ← 현재' : '';
                        parts.push(`${indent}${node.name}${active}`);
                    }
                }
            }

            const currentRules = getCurrentRules();
            if (currentRules) {
                parts.push('\n[현재 세계 규칙]');
                const exists = currentRules.exists || {};
                const existingElements = [];
                if (exists.magic) existingElements.push('마법');
                if (exists.ki) existingElements.push('기(氣)');
                if (exists.supernatural) existingElements.push('초자연');
                if (exists.mythical_creatures?.length > 0) existingElements.push(...exists.mythical_creatures);
                if (existingElements.length > 0) parts.push(`  존재: ${existingElements.join(', ')}`);

                const systems = currentRules.systems || {};
                const activeSystems = [];
                if (systems.leveling) activeSystems.push('레벨');
                if (systems.skills) activeSystems.push('스킬');
                if (systems.stats) activeSystems.push('스탯');
                if (activeSystems.length > 0) parts.push(`  시스템: ${activeSystems.join(', ')}`);
            }

            if (profile.interference.level > 0.5) {
                parts.push('\n⚠️ 차원 간섭도 높음 - 세계 간 영향 가능');
            }

            return parts.join('\n');
        };

        return {
            loadWorldGraph,
            getCurrentRules,
            getEffectiveRules,
            changeActivePath,
            popActivePath,
            createNode,
            updateNode,
            saveWorldGraph,
            formatForPrompt,
            getProfile: () => profile,
            getActivePath: () => profile?.activePath || [],
            WORLD_TEMPLATES
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Entity Manager
    // ══════════════════════════════════════════════════════════════
    const EntityManager = (() => {
        const entityCache = new Map();
        const relationCache = new Map();
        const ENTITY_COMMENT = "lmai_entity";
        const RELATION_COMMENT = "lmai_relation";

        const normalizeName = (name) => {
            if (!name) return '';
            const titles = ['씨', '님', '양', '군', '선생님', '교수님', '박사님'];
            let normalized = name.trim();
            for (const title of titles) {
                if (normalized.endsWith(title) && normalized.length > title.length + 1) {
                    normalized = normalized.slice(0, -title.length);
                }
            }
            return normalized;
        };

        const makeRelationId = (nameA, nameB) => {
            const sorted = [normalizeName(nameA), normalizeName(nameB)].sort();
            return`${sorted[0]}_${sorted[1]}`;
        };

        const getOrCreateEntity = (name, lorebook) => {
            const normalizedName = normalizeName(name);
            if (!normalizedName) return null;

            if (entityCache.has(normalizedName)) return entityCache.get(normalizedName);

            const existing = lorebook.find(e => e.comment === ENTITY_COMMENT && normalizeName(e.key || '') === normalizedName);
            if (existing) {
                try {
                    const profile = JSON.parse(existing.content);
                    entityCache.set(normalizedName, profile);
                    return profile;
                } catch {}
            }

            const newEntity = {
                id: TokenizerEngine.simpleHash(normalizedName),
                name: normalizedName,
                type: 'character',
                appearance: { features: [], distinctiveMarks: [], clothing: [] },
                personality: { traits: [], values: [], fears: [], likes: [], dislikes: [] },
                background: { origin: '', occupation: '', history: [], secrets: [] },
                status: { currentLocation: '', currentMood: '', healthStatus: '', lastUpdated: 0 },
                meta: { created: MemoryState.currentTurn, updated: 0, confidence: 0.5, source: '' }
            };

            entityCache.set(normalizedName, newEntity);
            return newEntity;
        };

        const getOrCreateRelation = (nameA, nameB, lorebook) => {
            const normalizedA = normalizeName(nameA);
            const normalizedB = normalizeName(nameB);
            if (!normalizedA || !normalizedB || normalizedA === normalizedB) return null;

            const relationId = makeRelationId(normalizedA, normalizedB);
            if (relationCache.has(relationId)) return relationCache.get(relationId);

            const existing = lorebook.find(e => e.comment === RELATION_COMMENT && e.key === relationId);
            if (existing) {
                try {
                    const relation = JSON.parse(existing.content);
                    relationCache.set(relationId, relation);
                    return relation;
                } catch {}
            }

            const newRelation = {
                id: relationId,
                entityA: normalizedA,
                entityB: normalizedB,
                relationType: '아는 사이',
                details: { howMet: '', duration: '', closeness: 0.3, trust: 0.5, events: [] },
                sentiments: { fromAtoB: '', fromBtoA: '', currentTension: 0, lastInteraction: MemoryState.currentTurn },
                meta: { created: MemoryState.currentTurn, updated: 0, confidence: 0.3 }
            };

            relationCache.set(relationId, newRelation);
            return newRelation;
        };

        const updateEntity = (name, updates, lorebook) => {
            const entity = getOrCreateEntity(name, lorebook);
            if (!entity) return null;

            const currentTurn = MemoryState.currentTurn;

            if (updates.appearance) {
                for (const key of ['features', 'distinctiveMarks', 'clothing']) {
                    if (updates.appearance[key]) {
                        const newItems = updates.appearance[key].filter(item => !entity.appearance[key].includes(item));
                        entity.appearance[key].push(...newItems);
                    }
                }
            }

            if (updates.personality) {
                for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes']) {
                    if (updates.personality[key]) {
                        const newItems = updates.personality[key].filter(item => !entity.personality[key].includes(item));
                        entity.personality[key].push(...newItems);
                    }
                }
            }

            if (updates.background) {
                if (updates.background.origin && !entity.background.origin) entity.background.origin = updates.background.origin;
                if (updates.background.occupation && !entity.background.occupation) entity.background.occupation = updates.background.occupation;
                if (updates.background.history) {
                    const newHistory = updates.background.history.filter(h => !entity.background.history.includes(h));
                    entity.background.history.push(...newHistory);
                }
            }

            if (updates.status) {
                if (updates.status.currentLocation) entity.status.currentLocation = updates.status.currentLocation;
                if (updates.status.currentMood) entity.status.currentMood = updates.status.currentMood;
                if (updates.status.healthStatus) entity.status.healthStatus = updates.status.healthStatus;
                entity.status.lastUpdated = currentTurn;
            }

            entity.meta.updated = currentTurn;
            if (updates.source) entity.meta.source = updates.source;
            entity.meta.confidence = Math.min(1, entity.meta.confidence + 0.1);

            return entity;
        };

        const updateRelation = (nameA, nameB, updates, lorebook) => {
            const relation = getOrCreateRelation(nameA, nameB, lorebook);
            if (!relation) return null;

            const currentTurn = MemoryState.currentTurn;

            if (updates.relationType) relation.relationType = updates.relationType;

            if (updates.details) {
                if (updates.details.howMet) relation.details.howMet = updates.details.howMet;
                if (updates.details.duration) relation.details.duration = updates.details.duration;
                if (typeof updates.details.closeness === 'number') relation.details.closeness = Math.max(0, Math.min(1, relation.details.closeness + updates.details.closeness * 0.1));
                if (typeof updates.details.trust === 'number') relation.details.trust = Math.max(0, Math.min(1, relation.details.trust + updates.details.trust * 0.1));
            }

            if (updates.sentiments) {
                if (updates.sentiments.fromAtoB) relation.sentiments.fromAtoB = updates.sentiments.fromAtoB;
                if (updates.sentiments.fromBtoA) relation.sentiments.fromBtoA = updates.sentiments.fromBtoA;
                if (typeof updates.sentiments.tension === 'number') relation.sentiments.currentTension = Math.max(0, Math.min(1, relation.sentiments.currentTension + updates.sentiments.tension));
            }

            if (updates.event) {
                relation.details.events.push({ turn: currentTurn, event: updates.event, sentiment: updates.eventSentiment || 'neutral' });
                if (relation.details.events.length > 20) relation.details.events = relation.details.events.slice(-15);
            }

            relation.meta.updated = currentTurn;
            relation.sentiments.lastInteraction = currentTurn;

            return relation;
        };

        const checkConsistency = (entityName, newInfo) => {
            const entity = entityCache.get(normalizeName(entityName));
            if (!entity) return { consistent: true, conflicts: [] };

            const conflicts = [];
            if (newInfo.appearance?.features) {
                const opposites = { '키가 큼': ['키가 작음'], '키가 작음': ['키가 큼'], '검은 머리': ['금발', '갈색 머리'], '금발': ['검은 머리', '갈색 머리'] };
                const currentFeatures = entity.appearance.features.join(' ');
                for (const feature of newInfo.appearance.features) {
                    if (opposites[feature]) {
                        for (const opp of opposites[feature]) {
                            if (currentFeatures.includes(opp)) {
                                conflicts.push({ type: 'appearance', existing: opp, new: feature, message:`외모 충돌: "${opp}" vs "${feature}"` });
                            }
                        }
                    }
                }
            }

            return { consistent: conflicts.length === 0, conflicts };
        };

        const formatEntityForPrompt = (entity) => {
            const parts = [];
            parts.push(`【${entity.name}】`);
            if (entity.appearance.features.length > 0 || entity.appearance.distinctiveMarks.length > 0) {
                parts.push(`  외모: ${[...entity.appearance.features, ...entity.appearance.distinctiveMarks].join(', ')}`);
            }
            if (entity.personality.traits.length > 0) parts.push(`  성격: ${entity.personality.traits.join(', ')}`);
            if (entity.personality.likes.length > 0) parts.push(`  좋아하는 것: ${entity.personality.likes.join(', ')}`);
            if (entity.personality.dislikes.length > 0) parts.push(`  싫어하는 것: ${entity.personality.dislikes.join(', ')}`);
            if (entity.background.origin) parts.push(`  출신: ${entity.background.origin}`);
            if (entity.background.occupation) parts.push(`  직업: ${entity.background.occupation}`);
            if (entity.status.currentMood) parts.push(`  현재 기분: ${entity.status.currentMood}`);
            if (entity.status.currentLocation) parts.push(`  현재 위치: ${entity.status.currentLocation}`);
            return parts.join('\n');
        };

        const formatRelationForPrompt = (relation) => {
            const parts = [];
            parts.push(`【${relation.entityA} ↔ ${relation.entityB}】`);
            parts.push(`  관계: ${relation.relationType}`);
            if (relation.details.closeness > 0.7) parts.push(`  친밀도: 매우 칼함`);
            else if (relation.details.closeness > 0.4) parts.push(`  친밀도: 보통`);
            else parts.push(`  친밀도: 어색함`);
            if (relation.sentiments.fromAtoB) parts.push(`    - ${relation.entityA} → ${relation.entityB}: ${relation.sentiments.fromAtoB}`);
            if (relation.sentiments.fromBtoA) parts.push(`    - ${relation.entityB} → ${relation.entityA}: ${relation.sentiments.fromBtoA}`);
            return parts.join('\n');
        };

        const clearCache = () => { entityCache.clear(); relationCache.clear(); };

        const rebuildCache = (lorebook) => {
            clearCache();
            for (const entry of lorebook) {
                try {
                    if (entry.comment === ENTITY_COMMENT) {
                        const entity = JSON.parse(entry.content);
                        entityCache.set(normalizeName(entity.name), entity);
                    } else if (entry.comment === RELATION_COMMENT) {
                        const relation = JSON.parse(entry.content);
                        relationCache.set(relation.id, relation);
                    }
                } catch {}
            }
        };

        const saveToLorebook = async (char, chat, lorebook) => {
            const entries = [...lorebook];
            const currentTurn = MemoryState.currentTurn;

            for (const [name, entity] of entityCache) {
                entity.meta.updated = currentTurn;
                const entry = {
                    key: name,
                    comment: ENTITY_COMMENT,
                    content: JSON.stringify(entity, null, 2),
                    mode: 'normal',
                    insertorder: 50,
                    alwaysActive: true
                };
                const existingIdx = entries.findIndex(e => e.comment === ENTITY_COMMENT && normalizeName(e.key || '') === name);
                if (existingIdx >= 0) entries[existingIdx] = entry;
                else entries.push(entry);
            }

            for (const [id, relation] of relationCache) {
                relation.meta.updated = currentTurn;
                const entry = {
                    key: id,
                    comment: RELATION_COMMENT,
                    content: JSON.stringify(relation, null, 2),
                    mode: 'normal',
                    insertorder: 60,
                    alwaysActive: true
                };
                const existingIdx = entries.findIndex(e => e.comment === RELATION_COMMENT && e.key === id);
                if (existingIdx >= 0) entries[existingIdx] = entry;
                else entries.push(entry);
            }

            MemoryEngine.setLorebook(char, chat, entries);
            await risuai.setCharacter(char);
        };

        return {
            normalizeName, makeRelationId, getOrCreateEntity, getOrCreateRelation,
            updateEntity, updateRelation, checkConsistency, formatEntityForPrompt,
            formatRelationForPrompt, clearCache, rebuildCache, saveToLorebook,
            getEntityCache: () => entityCache, getRelationCache: () => relationCache
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Memory Engine
    // ══════════════════════════════════════════════════════════════
    const MemoryEngine = (() => {
        const CONFIG = {
            maxLimit: 200,
            threshold: 5,
            simThreshold: 0.25,
            gcBatchSize: 5,
            tokenizerType: 'simple',
            weightMode: 'auto',
            weights: { importance: 0.3, similarity: 0.5, recency: 0.2 },
            debug: false,
            useLLM: true,
            worldAdjustmentMode: 'dynamic',
            llm: { provider: 'openai', url: '', key: '', model: 'gpt-4o-mini', temp: 0.3, timeout: 15000 },
            embed: { provider: 'openai', url: '', key: '', model: 'text-embedding-3-small' }
        };

        const getMetaCache = () => {
            if (!MemoryState.metaCache) MemoryState.metaCache = new LRUCache(2000);
            return MemoryState.metaCache;
        };

        const getSimCache = () => {
            if (!MemoryState.simCache) MemoryState.simCache = new LRUCache(5000);
            return MemoryState.simCache;
        };

        const GENRE_KEYWORDS = {
            action: ['공격', '회피', '기습', '위험', '비명', '달려', '총', '검', '폭발'],
            romance: ['사랑', '좋아', '키스', '안아', '입술', '눈물', '손잡', '두근', '설레'],
            mystery: ['단서', '증거', '범인', '비밀', '거짓말', '수상', '추리', '의심'],
            daily: ['밥', '날씨', '오늘', '일상', '학교', '회사', '집에', '친구']
        };

        const detectGenreWeights = (query) => {
            if (CONFIG.weightMode !== 'auto') return null;
            const text = (query || "").toLowerCase();
            const scores = { action: 0, romance: 0, mystery: 0, daily: 0 };

            for (const [genre, words] of Object.entries(GENRE_KEYWORDS)) {
                for (const word of words) {
                    if (text.includes(word)) scores[genre]++;
                }
            }

            if (CONFIG.emotionEnabled) {
                const emotion = EmotionEngine.analyze(text);
                if (emotion.dominant !== 'neutral' && emotion.intensity > 0.3) {
                    const mapping = { sadness: 'romance', anger: 'action', fear: 'mystery', joy: 'daily' };
                    if (mapping[emotion.dominant]) scores[mapping[emotion.dominant]] += emotion.intensity;
                }
            }

            const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
            if (top[1] < 1) return null;

            const presets = { action: { similarity: 0.4, importance: 0.2, recency: 0.4 }, romance: { similarity: 0.5, importance: 0.3, recency: 0.2 }, mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 }, daily: { similarity: 0.3, importance: 0.3, recency: 0.4 } };
            return presets[top[0]];
        };

        const calculateDynamicWeights = (query) => detectGenreWeights(query) || CONFIG.weights;
        const _log = (msg) => { if (CONFIG.debug) console.log(`[LMAI] ${msg}`); };
        const getSafeKey = (entry) => entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");

        const META_PATTERN = /
$$META:(\{[^}]+\})$$
/;
        const parseMeta = (raw) => {
            const def = { t: 0, ttl: 0, imp: 5, type: 'context', cat: 'personal', ent: [] };
            if (typeof raw !== 'string') return def;
            try {
                const m = raw.match(META_PATTERN);
                return m ? { ...def, ...JSON.parse(m[1]) } : def;
            } catch { return def; }
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
            const cKey = hA < hB ?`${hA}_${hB}` :`${hB}_${hA}`;
            const simCache = getSimCache();
            if (simCache.has(cKey)) return simCache.get(cKey);

            const lenA = textA.length, lenB = textB.length;
            if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.7) { simCache.set(cKey, 0); return 0; }

            const tA = new Set(TokenizerEngine.tokenize(textA));
            const tB = new Set(TokenizerEngine.tokenize(textB));
            let inter = 0;
            tA.forEach(w => { if (tB.has(w)) inter++; });
            const jaccard = (tA.size + tB.size) > 0 ? inter / (tA.size + tB.size - inter) : 0;

            if (jaccard < 0.1) { simCache.set(cKey, 0); return 0; }

            const vecA = await EmbeddingEngine.getEmbedding(textA);
            const vecB = await EmbeddingEngine.getEmbedding(textB);
            const score = (vecA && vecB) ? EmbeddingEngine.cosineSimilarity(vecA, vecB) * 0.7 + jaccard * 0.3 : jaccard * 0.7;
            simCache.set(cKey, score);
            return score;
        };

        const calcRecency = (turn, current) => Math.exp(-Math.max(0, current - turn) / 20);

        const EmbeddingEngine = (() => {
            return {
                getEmbedding: async (text) => {
                    const cache = getSimCache();
                    if (cache.has(text)) return Promise.resolve(cache.get(text));
                    return EmbeddingQueue.enqueue(async () => {
                        const m = CONFIG.embed;
                        if (!m?.url) return null;
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 15000);
                        try {
                            const res = await risuai.fetch(m.url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization':`Bearer ${m.key}` },
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
                            if (CONFIG.debug) console.warn('[LMAI] Embedding Error:', e?.message || e);
                            return null;
                        }
                    });
                },
                cosineSimilarity: (a, b) => {
                    if (!a || !b || a.length !== b.length) return 0;
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
                    return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
                }
            };
        })();

        const formatMemories = (memories) => {
            if (!memories || memories.length === 0) return '';
            return memories.map((m, i) => {
                const meta = getCachedMeta(m);
                const content = (m.content || "").replace(META_PATTERN, '').trim();
                return`[${i + 1}] (중요도:${meta.imp}/10) ${meta.summary || content.slice(0, 100)}`;
            }).join('\n');
        };

        const incrementalGC = (allEntries, currentTurn) => {
            const toDelete = new Set();
            if (allEntries.length === 0) return { entries: allEntries, deleted: 0 };

            for (let i = 0; i < CONFIG.gcBatchSize; i++) {
                const idx = (MemoryState.gcCursor + i) % allEntries.length;
                const entry = allEntries[idx];
                const meta = getCachedMeta(entry);
                if (meta.ttl !== -1 && (meta.t + meta.ttl) < currentTurn) toDelete.add(getSafeKey(entry));
            }
            MemoryState.gcCursor = (MemoryState.gcCursor + CONFIG.gcBatchSize) % Math.max(1, allEntries.length);

            const managed = allEntries.filter(e => e.comment === 'lmai_memory');
            if (managed.length > CONFIG.maxLimit) {
                managed.sort((a, b) => getCachedMeta(a).t - getCachedMeta(b).t)
                    .slice(0, managed.length - CONFIG.maxLimit)
                    .forEach(e => toDelete.add(getSafeKey(e)));
            }

            if (toDelete.size > 0) {
                MemoryState.hashIndex.forEach(set => toDelete.forEach(item => set.delete(item)));
                MemoryState.hashIndex.forEach((set, key) => { if (set.size === 0) MemoryState.hashIndex.delete(key); });
                return { entries: allEntries.filter(e => !toDelete.has(getSafeKey(e))), deleted: toDelete.size };
            }
            return { entries: allEntries, deleted: 0 };
        };

        return {
            CONFIG, getSafeKey, getCachedMeta, calcRecency, EmbeddingEngine, EmotionEngine,
            TokenizerEngine, formatMemories, incrementalGC, META_PATTERN, parseMeta,

            rebuildIndex: (lorebook) => {
                _log("Rebuilding Hash Index...");
                MemoryState.hashIndex.clear();
                const entries = Array.isArray(lorebook) ? lorebook : [];
                entries.forEach(entry => {
                    if (entry.comment === 'lmai_memory') {
                        try {
                            const content = (entry.content || "").replace(META_PATTERN, '').trim();
                            if (content.length < 5) return;
                            const key = getSafeKey(entry);
                            const idxKey = TokenizerEngine.getIndexKey(content);
                            if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                            MemoryState.hashIndex.get(idxKey).add(key);
                        } catch {}
                    }
                });
            },

            checkDuplication: async (content, existingList) => {
                const idxKey = TokenizerEngine.getIndexKey(content);
                const candidates = MemoryState.hashIndex.get(idxKey) || new Set();
                const map = new Map(existingList.map(e => [getSafeKey(e), e]));
                const checkPool = [...Array.from(candidates).map(k => map.get(k)).filter(Boolean), ...existingList.slice(-5)];
                const uniqueCheck = new Set(checkPool);

                for (const item of uniqueCheck) {
                    if (!item || !item.content) continue;
                    if (Math.abs(item.content.length - content.length) > content.length * 0.7) continue;
                    if (await calcSimilarity(item.content, content) > 0.75) return true;
                }
                return false;
            },

            prepareMemory: async (data, currentTurn, existingList, lorebook, char, chat) => {
                const { content, importance } = data;
                if (!content || content.length < 5) return null;

                const managed = MemoryEngine.getManagedEntries(lorebook);
                if (managed.length >= Math.floor(CONFIG.maxLimit * 0.95)) {
                    _log(`Early GC: ${managed.length}/${CONFIG.maxLimit}`);
                    const gcResult = MemoryEngine.incrementalGC(lorebook, currentTurn);
                    if (gcResult.deleted > 0) {
                        _log(`GC removed ${gcResult.deleted} entries`);
                        lorebook.length = 0;
                        lorebook.push(...gcResult.entries);
                        MemoryEngine.rebuildIndex(lorebook);
                        if (char && chat !== undefined) MemoryEngine.setLorebook(char, chat, lorebook);
                    }
                }

                const updatedList = lorebook || existingList;
                if (await MemoryEngine.checkDuplication(content, updatedList)) return null;

                const imp = importance || 5;
                const ttl = imp >= 9 ? -1 : 30;
                const meta = { t: currentTurn, ttl, imp, cat: 'personal', ent: [], summary: content.slice(0, 50) };

                const idxKey = TokenizerEngine.getIndexKey(content);
                if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                MemoryState.hashIndex.get(idxKey).add(TokenizerEngine.getSafeMapKey(content));

                return {
                    key: "", comment: 'lmai_memory',
                    content:`[META:${JSON.stringify(meta)}]\n${content}\n`,
                    mode: "normal", insertorder: 100, alwaysActive: true
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
                    const score = (sim * W.similarity) + (calcRecency(meta.t, currentTurn) * W.recency) + ((meta.imp / 10) * W.importance);
                    return { ...entry, _score: score };
                }));

                return results.filter(Boolean).sort((a, b) => b._score - a._score).slice(0, topK);
            },

            getLorebook: (char, chat) => Array.isArray(char.lorebook) ? char.lorebook : (chat?.localLore || []),
            setLorebook: (char, chat, data) => {
                if (Array.isArray(char.lorebook)) char.lorebook = data;
                else if (chat) chat.localLore = data;
            },
            getManagedEntries: (lorebook) => (Array.isArray(lorebook) ? lorebook : []).filter(e => e.comment === 'lmai_memory'),
            getCacheStats: () => ({ meta: getMetaCache().stats, sim: getSimCache().stats }),
            incrementTurn: () => { MemoryState.currentTurn++; return MemoryState.currentTurn; },
            getCurrentTurn: () => MemoryState.currentTurn,
            setTurn: (turn) => { MemoryState.currentTurn = turn; }
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Complex World Detector
    // ══════════════════════════════════════════════════════════════
    const ComplexWorldDetector = (() => {
        const COMPLEX_PATTERNS = {
            multiverse: [/차원/, /평행\s*우주/, /멀티버스/, /이세계/, /다른\s*세계/, /워프/, /포탈/, /귀환/, /소환/, /전생/],
            timeTravel: [/시간\s*여행/, /과거로/, /미래로/, /타임\s*머신/, /루프/, /회귀/, /타임\s*리프/],
            metaNarrative: [/작가/, /독자/, /4차\s*벽/, /픽션/, /이야기\s*속/, /메타/],
            virtualReality: [/가상\s*현실/, /VR/, /게임\s*속/, /시뮬레이션/, /로그\s*(인|아웃)/, /던전/],
            dreamWorld: [/꿈\s*속/, /몽중/, /무의식/, /악몽/]
        };

        const detectComplexIndicators = (text) => {
            const detected = {};
            for (const [type, patterns] of Object.entries(COMPLEX_PATTERNS)) {
                const matches = [];
                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match) matches.push({ pattern: pattern.source, matched: match[0] });
                }
                if (matches.length > 0) detected[type] = matches;
            }
            return detected;
        };

        const detectDimensionalShift = (text) => {
            const shifts = [];
            const movePatterns = [
                { pattern: /(.+?)에서\s+(.+?)으?로\s*(이동|넘어|건너)/, type: 'movement' },
                { pattern: /(.+?)을\s*통해\s+(.+?)에?\s*(도착|진입)/, type: 'portal' },
                { pattern: /(.+?)에?\s*소환되?어?\s+(.+?)에?\s*당도/, type: 'summon' },
                { pattern: /(.+?)에서\s+(.+?)으?로\s*(전생|환생|빙의)/, type: 'reincarnation' }
            ];
            for (const { pattern, type } of movePatterns) {
                const match = text.match(pattern);
                if (match) shifts.push({ type, from: match[1]?.trim() || '알 수 없음', to: match[2]?.trim() || '알 수 없음', matched: match[0] });
            }
            return shifts;
        };

        const analyze = (userMessage, aiResponse) => {
            const text =`${userMessage} ${aiResponse}`;
            const complexIndicators = detectComplexIndicators(text);
            const dimensionalShifts = detectDimensionalShift(text);

            let complexityScore = Object.keys(complexIndicators).length * 0.3 + dimensionalShifts.length * 0.5;

            return {
                hasComplexElements: complexityScore > 0,
                complexityScore: Math.min(1, complexityScore),
                indicators: complexIndicators,
                dimensionalShifts,
                requiresNewNode: dimensionalShifts.length > 0
            };
        };

        return { detectComplexIndicators, detectDimensionalShift, analyze };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity Extraction Prompt
    // ══════════════════════════════════════════════════════════════
    const EntityExtractionPrompt = `당신은 대화에서 인물 정보와 세계관 정보를 추출하는 전문가입니다.

[현재 저장된 정보]
{STORED_INFO}

[대화 내용]
{CONVERSATION}

[작업]
대화에서 다음 정보를 추출하여 JSON 형식으로 출력:

1. 인물 정보 (entities)
   - name: 이름
   - appearance: { features: [], distinctiveMarks: [], clothing: [] }
   - personality: { traits: [], likes: [], dislikes: [], fears: [] }
   - background: { origin: "", occupation: "", history: [] }
   - status: { currentMood: "", currentLocation: "" }

2. 관계 정보 (relations)
   - entityA, entityB: 인물 이름
   - relationType: 관계 유형
   - closenessDelta: 친밀도 변화 (-0.3 ~ 0.3)

3. 세계관 정보 (world)
   - classification: { primary: "modern_reality" | "fantasy" | "wuxia" | "game_isekai" | ... }
   - exists: { magic: true/false, ki: true/false, ... }
   - systems: { leveling: true/false, skills: true/false, ... }

[규칙]
- 명시적으로 언급된 정보만 추출
- 기존 정보와 충돌하면 conflict 필드에 표시

[출력]
{ "entities": [...], "relations": [...], "world": {...}, "conflicts": [...] }`;

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity-Aware Processor
    // ══════════════════════════════════════════════════════════════
    const EntityAwareProcessor = (() => {
        const extractFromConversation = async (userMsg, aiResponse, storedInfo, config) => {
            if (!config.useLLM) return { success: true, entities: [], relations: [], world: {}, conflicts: [] };

            const prompt = EntityExtractionPrompt.replace('{STORED_INFO}', storedInfo || '없음').replace('{CONVERSATION}',`[사용자]\n${userMsg}\n\n[응답]\n${aiResponse}`);

            try {
                const result = await LLMProvider.call(config, prompt, '', { maxTokens: 1500 });
                const content = result.content || '';
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error('No JSON found');
                const parsed = JSON.parse(jsonMatch[0]);
                return { success: true, entities: parsed.entities || [], relations: parsed.relations || [], world: parsed.world || {}, conflicts: parsed.conflicts || [] };
            } catch (e) {
                console.error('[LMAI] Entity extraction failed:', e?.message);
                return { success: false, entities: [], relations: [], world: {}, conflicts: [], error: e?.message };
            }
        };

        const applyExtractions = async (extractions, lorebook, config) => {
            const { entities, relations, world, conflicts } = extractions;
            const appliedChanges = [];

            for (const entityData of entities || []) {
                if (!entityData.name) continue;
                const consistency = EntityManager.checkConsistency(entityData.name, entityData);
                if (!consistency.consistent && config.debug) {
                    console.warn(`[LMAI] Entity consistency warning:`, consistency.conflicts);
                }
                const updated = EntityManager.updateEntity(entityData.name, {
                    appearance: entityData.appearance,
                    personality: entityData.personality,
                    background: entityData.background,
                    status: entityData.status,
                    source: 'conversation'
                }, lorebook);
                if (updated) appliedChanges.push(`Entity "${entityData.name}" updated`);
            }

            for (const relationData of relations || []) {
                if (!relationData.entityA || !relationData.entityB) continue;
                const updated = EntityManager.updateRelation(relationData.entityA, relationData.entityB, {
                    relationType: relationData.relationType,
                    details: { closeness: relationData.closenessDelta },
                    sentiments: relationData.sentiments,
                    event: relationData.event
                }, lorebook);
                if (updated) appliedChanges.push(`Relation "${relationData.entityA} ↔ ${relationData.entityB}" updated`);
            }

            if (world && world.classification) {
                const worldProfile = HierarchicalWorldManager.getProfile();
                if (worldProfile && worldProfile.nodes.size > 0) {
                    const currentNodeId = HierarchicalWorldManager.getActivePath()[HierarchicalWorldManager.getActivePath().length - 1];
                    if (currentNodeId) {
                        HierarchicalWorldManager.updateNode(currentNodeId, { rules: world });
                        appliedChanges.push('World rules updated');
                    }
                }
            }

            return { applied: appliedChanges, warnings: conflicts || [] };
        };

        const formatStoredInfo = (maxEntities = 10) => {
            const parts = [];
            const entities = Array.from(EntityManager.getEntityCache().values()).slice(0, maxEntities);
            if (entities.length > 0) {
                parts.push('[인물 정보]');
                for (const entity of entities) parts.push(EntityManager.formatEntityForPrompt(entity));
            }
            const relations = Array.from(EntityManager.getRelationCache().values()).slice(0, maxEntities * 2);
            if (relations.length > 0) {
                parts.push('\n[관계 정보]');
                for (const relation of relations) parts.push(EntityManager.formatRelationForPrompt(relation));
            }
            return parts.join('\n');
        };

        return { extractFromConversation, applyExtractions, formatStoredInfo };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] World Adjustment Manager
    // ══════════════════════════════════════════════════════════════
    const WorldAdjustmentManager = (() => {
        const analyzeUserIntent = (userMessage, conflictInfo) => {
            const text = userMessage.toLowerCase();
            const explicitChangePatterns = [/사실은