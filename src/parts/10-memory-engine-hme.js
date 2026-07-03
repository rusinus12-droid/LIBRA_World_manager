    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Memory Engine
    // ══════════════════════════════════════════════════════════════
    const MemoryEngine = (() => {
        const CONFIG = {
            ...buildOptimizedHiddenSettingsDefaults(),
            tokenizerType: 'simple',
            hypaV3AutoReflectEnabled: false,
            moduleLorebookReflectionEnabled: false,
            moduleLorebookSelectedIds: '',
            entityBlocklist: [],
            storyAuthorEnabled: false,
            storyAuthorMode: 'disabled',
            directorEnabled: false,
            directorMode: 'disabled',
            internalDataLanguageMode: 'off',
            internalDataLanguageDebug: false,
            flexRoutingMode: 'off',
            flexTimeoutMs: 600000,
            flexFallbackToStandard: false,
            vertexFlexMode: 'provisioned_then_flex',
            customServiceTierPassthrough: false,
            backendHosting: { mode: 'off', url: '', token: '', autoDetected: false, lastDetectedAt: '', lastManifest: null },
            llm: { provider: 'openai', url: '', key: '', model: 'gpt-4o-mini', temp: 0.3, timeout: 120000, serviceTier: 'off', reasoningPreset: 'auto', reasoningEffort: 'none', reasoningBudgetTokens: DEFAULT_REASONING_BUDGET_TOKENS, maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS, glmThinkingType: 'enabled' },
            auxLlm: { enabled: false, provider: 'openai', url: '', key: '', model: 'gpt-4o-mini', temp: 0.2, timeout: 90000, serviceTier: 'off', reasoningPreset: 'auto', reasoningEffort: 'none', reasoningBudgetTokens: DEFAULT_REASONING_BUDGET_TOKENS, maxCompletionTokens: DEFAULT_AUX_MAX_COMPLETION_TOKENS, glmThinkingType: 'enabled' },
            embeddingCacheMaxEntries: 768,
            embeddingCacheMaxTextChars: 8000,
            recallEmbeddingCandidateMax: 8,
            recallEmbeddingPrefilterMinSparse: 0.10,
            recallDetailCandidateMax: 32,
            embed: { enabled: true, provider: 'openai', url: '', key: '', model: 'text-embedding-3-small', timeout: 120000 }
        };

        const getMetaCache = () => {
            if (!MemoryState.metaCache) MemoryState.metaCache = new LRUCache(2000);
            return MemoryState.metaCache;
        };

        const getSimCache = () => {
            if (!MemoryState.simCache) MemoryState.simCache = new LRUCache(2500);
            return MemoryState.simCache;
        };
        const getEmbeddingCache = () => {
            const maxEntries = Math.max(128, Math.min(2048, Math.floor(Number(CONFIG.embeddingCacheMaxEntries || 768)) || 768));
            if (!MemoryState.embeddingCache || MemoryState.embeddingCache.maxSize !== maxEntries) MemoryState.embeddingCache = new LRUCache(maxEntries);
            return MemoryState.embeddingCache;
        };
        const shouldCacheEmbeddingText = (text = '') => {
            const len = String(text || '').length;
            const maxChars = Math.max(256, Math.min(32000, Number(CONFIG.embeddingCacheMaxTextChars || 8000) || 8000));
            return len >= 12 && len <= maxChars;
        };
        const getEmbeddingCacheKey = (providerName = '', model = '', text = '') => {
            const source = String(text || '');
            const checksumSource = `${source.slice(0, 32)}\u0000${source.slice(-16)}\u0000${source.length}`;
            return `emb:${String(providerName || '').trim().toLowerCase()}:${String(model || '').trim()}:${source.length}:${TokenizerEngine.simpleHash(source)}:${TokenizerEngine.simpleHash(checksumSource)}`;
        };
        const normalizeEmbeddingDebugSource = (source = '') => String(source || 'general')
            .trim()
            .replace(/[^\w:.-]+/g, '_')
            .slice(0, 48) || 'general';
        const bumpEmbeddingDebugSource = (stats, source = 'general', field = 'total') => {
            if (!stats || typeof stats !== 'object') return;
            const key = normalizeEmbeddingDebugSource(source);
            if (!stats.sources || typeof stats.sources !== 'object') stats.sources = {};
            if (!stats.sources[key]) stats.sources[key] = { total: 0, cacheHits: 0, providerCalls: 0, empty: 0, error: 0 };
            stats.sources[key][field] = Number(stats.sources[key][field] || 0) + 1;
        };
        const getStandardLoreTokenCache = () => {
            if (!MemoryState.standardLoreTokenCache) MemoryState.standardLoreTokenCache = new LRUCache(512);
            return MemoryState.standardLoreTokenCache;
        };
        const getHybridRowCache = () => {
            if (!MemoryState.hybridRowCache) MemoryState.hybridRowCache = new LRUCache(2500);
            return MemoryState.hybridRowCache;
        };
        const safeClearMemoryCache = (label = 'cache', cacheGetter = null, fallbackGetter = null, context = {}) => {
            let cleared = false;
            try {
                const cache = typeof cacheGetter === 'function' ? cacheGetter() : cacheGetter;
                if (cache && typeof cache.clear === 'function') {
                    cache.clear();
                    cleared = true;
                }
            } catch (error) {
                recordSuppressedRuntimeError(`hme.clear_cache.${label}`, error, context);
            }
            if (cleared || !fallbackGetter) return cleared;
            try {
                const fallback = typeof fallbackGetter === 'function' ? fallbackGetter() : fallbackGetter;
                if (fallback && typeof fallback.clear === 'function') {
                    fallback.clear();
                    return true;
                }
            } catch (fallbackError) {
                recordSuppressedRuntimeError(`hme.clear_cache.${label}_fallback`, fallbackError, context);
            }
            return false;
        };

        const GENRE_KEYWORD_PROFILES = Object.freeze({});
        const GENRE_LANGUAGE_WEIGHTS = Object.freeze({});
        const GENRE_KEYWORDS = Object.freeze({});
        const escapeGenreKeywordRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matchesGenreKeyword = (text = '', keyword = '') => {
            const raw = String(keyword || '').trim();
            if (!raw) return false;
            const word = raw.toLowerCase();
            if (/^[a-z0-9][a-z0-9\s'_-]*$/i.test(word)) {
                try { return new RegExp(`\\b${escapeGenreKeywordRegex(word)}\\b`, 'i').test(text); }
                catch (_) { return text.includes(word); }
            }
            return text.includes(word);
        };

        const RECALL_INTENT_PATTERNS = Object.freeze({
            origin: /처음|처음부터|시작|계기|왜|원래|배경|어렸|origin|beginning|setup|why/,
            transition: /이후|때문|전환|바뀌|계기로|trigger|turning|after|because/,
            current: /지금|현재|방금|이어|계속|다음|current|now|continue|carry/,
            relationship: /관계|감정|연인|고백|좋아|사랑|relationship|romance/,
            worldRule: /세계관|규칙|금지|학교|조직|시스템|레벨|마법|world|rule|system/,
            aftermath: /$^/
        });

        const detectGenreWeights = (query) => null;
        const calculateDynamicWeights = (query) => detectGenreWeights(query) || CONFIG.weights;
        const _log = (msg) => { if (CONFIG.debug) recordRuntimeDebug('log', `[LIBRA] ${msg}`); };
        const memoryEntryMetaHeadCache = new WeakMap();
        const memoryEntrySafeKeyCache = new WeakMap();
        const memoryEntryHashCache = new WeakMap();
        const parseMemoryMetaHead = (entry = null) => {
            try {
                if (!entry || typeof entry !== 'object' || String(entry?.comment || '') !== 'lmai_memory') return null;
                const cached = memoryEntryMetaHeadCache.get(entry);
                if (cached !== undefined) return cached;
                const raw = String(entry?.content || '');
                const marker = raw.indexOf('[META:');
                if (marker < 0 || marker > 64) {
                    memoryEntryMetaHeadCache.set(entry, null);
                    return null;
                }
                const jsonStart = raw.indexOf('{', marker);
                if (jsonStart < 0 || jsonStart > 2048) {
                    memoryEntryMetaHeadCache.set(entry, null);
                    return null;
                }
                let depth = 0;
                let inString = false;
                let escaped = false;
                let jsonEnd = -1;
                const maxScan = Math.min(raw.length, jsonStart + 4096);
                for (let i = jsonStart; i < maxScan; i++) {
                    const ch = raw[i];
                    if (inString) {
                        if (escaped) escaped = false;
                        else if (ch === '\\') escaped = true;
                        else if (ch === '"') inString = false;
                        continue;
                    }
                    if (ch === '"') {
                        inString = true;
                    } else if (ch === '{') {
                        depth++;
                    } else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                            jsonEnd = i;
                            break;
                        }
                    }
                }
                if (jsonEnd < jsonStart) {
                    memoryEntryMetaHeadCache.set(entry, null);
                    return null;
                }
                const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
                const meta = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
                memoryEntryMetaHeadCache.set(entry, meta);
                return meta;
            } catch (_) {
                try { if (entry && typeof entry === 'object') memoryEntryMetaHeadCache.set(entry, null); } catch (_) {}
                return null;
            }
        };
        const getMemoryMetaHeadField = (entry = null, field = '') => {
            const key = String(field || '').trim();
            if (!key) return '';
            const meta = parseMemoryMetaHead(entry);
            const value = meta && Object.prototype.hasOwnProperty.call(meta, key) ? meta[key] : '';
            if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean).join('|');
            return String(value || '').trim();
        };
        const getEntryContentHash = (entry = null) => {
            if (entry && typeof entry === 'object') {
                const cached = memoryEntryHashCache.get(entry);
                if (cached !== undefined) return cached;
            }
            const content = String(entry?.content || '');
            if (!content) return '0';
            const sourceHash = getMemoryMetaHeadField(entry, 'sourceHash');
            const hash = sourceHash
                ? `${sourceHash}:${TokenizerEngine.simpleHash(content.slice(0, 1600))}:${content.length}`
                : String(TokenizerEngine.simpleHash(content));
            try { if (entry && typeof entry === 'object') memoryEntryHashCache.set(entry, hash); } catch (_) {}
            return hash;
        };
        const getSafeKey = (entry) => {
            if (!entry) return TokenizerEngine.getSafeMapKey('');
            if (entry && typeof entry === 'object') {
                const cached = memoryEntrySafeKeyCache.get(entry);
                if (cached !== undefined) return cached;
            }
            const explicit = String(entry.id || entry.key || '').trim();
            const turnKey = !explicit ? getMemoryMetaHeadField(entry, 'turnKey') : '';
            const sourceHash = (!explicit && !turnKey) ? getMemoryMetaHeadField(entry, 'sourceHash') : '';
            const messageId = (!explicit && !turnKey && !sourceHash) ? getMemoryMetaHeadField(entry, 'm_id') : '';
            const key = explicit
                || (turnKey ? `memory_turn:${turnKey}` : '')
                || (sourceHash ? `memory_source:${sourceHash}` : '')
                || (messageId ? `memory_msg:${messageId}` : '')
                || TokenizerEngine.getSafeMapKey(entry.content || "");
            try { if (entry && typeof entry === 'object') memoryEntrySafeKeyCache.set(entry, key); } catch (_) {}
            return key;
        };
        let lastRetrievalDebug = null;

        const META_PATTERN = /\[META:(\{[\s\S]*?\})\]\s*/;
        const extractMetaJsonString = (raw = '') => {
            return extractLibraMetaJsonString(raw);
        };
        const parseMeta = (raw) => {
            const def = { t: 0, ttl: 0, imp: 5, type: 'context', cat: 'personal', ent: [] };
            if (typeof raw !== 'string') return def;
            try {
                const metaJson = extractMetaJsonString(raw);
                return metaJson ? { ...def, ...JSON.parse(metaJson) } : def;
            } catch { return def; }
        };

        const getCachedMeta = (entry) => {
            const key = getSafeKey(entry);
            const cache = getMetaCache();
            const cached = cache.get(key);
            if (cached !== undefined) return cached;
            const m = parseMeta(entry.content);
            cache.set(key, m);
            return m;
        };

        const ADAPTIVE_SEMANTIC_RECALL_POLICY = Object.freeze({
            version: 'libra_adaptive_semantic_recall_v1',
            legacySparseWeight: 0.82,
            legacyEmbeddingWeight: 0.18,
            directSparseWeight: 0.75,
            directEmbeddingWeight: 0.25,
            bridgeSparseWeight: 0.55,
            bridgeEmbeddingWeight: 0.45,
            bridgeCosineGate: 0.62,
            weakSparseMax: 0.28,
            minEntityOverlap: 2,
            aliasBridgeBonus: 0.055,
            semanticFloor: 0.26
        });
        const stripSemanticKoParticle = (value = '') => String(value || '').trim()
            .replace(/(?:에게서|에게|한테서|한테|으로|로서|로|에서|부터|까지|처럼|보다|마다|라도|이라도|하고|이랑|랑|와|과|은|는|이|가|을|를|도|만|의)$/u, '')
            .trim();
        const normalizeSemanticText = (value = '') => String(value || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_가-힣ぁ-んァ-ヶ一-龯]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const extractSemanticEntityTokens = (value = '') => {
            const raw = String(value || '');
            const stop = new Set(['그때', '장면', '단둘', '단둘이', '처음', '원점', '기억', '회수', '연결', '감정', '마음', '부담', '식사', '분식', '규칙', '회사', '소속', '소속사', '연애', '금지', '공개', '갈등', '관계', '현재', '지금', 'because', 'scene', 'memory', 'recall']);
            const out = [];
            const push = (token) => {
                const stripped = stripSemanticKoParticle(token);
                const normalized = normalizeSemanticText(stripped).replace(/\s+/g, '');
                if (!normalized || normalized.length < 2 || normalized.length > 18 || stop.has(normalized)) return;
                if (!out.includes(normalized)) out.push(normalized);
            };
            (raw.match(/[가-힣]{2,8}/g) || []).forEach(push);
            (raw.match(/[A-Za-z][A-Za-z0-9_.-]{1,32}/g) || []).forEach(push);
            return out.slice(0, 32);
        };
        const countSemanticEntityOverlap = (query = '', body = '') => {
            const q = extractSemanticEntityTokens(query);
            const bodyNorm = normalizeSemanticText(body).replace(/\s+/g, '');
            const hits = q.filter(token => token && bodyNorm.includes(token));
            return { count: hits.length, hits: hits.slice(0, 8) };
        };
        const SEMANTIC_ALIAS_BRIDGES = Object.freeze([]);
        const getSemanticAliasBridgeHits = (query = '', body = '') => {
            const q = normalizeSemanticText(query);
            const b = normalizeSemanticText(body);
            if (!q || !b) return [];
            return SEMANTIC_ALIAS_BRIDGES
                .filter(rule => rule.query.some(re => re.test(q)) && rule.body.some(re => re.test(b)))
                .map(rule => rule.label)
                .slice(0, 8);
        };
        const hasDirectSparseEvidence = (sparse = {}) => {
            const coverage = Number(sparse?.coverage || 0);
            const lexical = Number(sparse?.lexical || 0);
            const overlap = Number(sparse?.overlap || 0);
            const wordJaccard = Number(sparse?.wordJaccard || 0);
            const conceptJaccard = Number(sparse?.conceptJaccard || 0);
            return coverage >= 0.24 || lexical >= 0.08 || wordJaccard >= 0.10 || conceptJaccard >= 0.12 || overlap >= 2 || !!sparse?.evidenceGate;
        };
        const inferAdaptiveSemanticRecall = (query = '', body = '', sparse = {}, cosine = 0, embeddingUsed = false) => {
            const entity = countSemanticEntityOverlap(query, body);
            const aliasBridgeHits = getSemanticAliasBridgeHits(query, body);
            const sparseScore = Number(sparse?.score || 0);
            const directSparseEvidence = hasDirectSparseEvidence(sparse);
            const weakSparseStrongEmbedding = embeddingUsed
                && sparseScore <= ADAPTIVE_SEMANTIC_RECALL_POLICY.weakSparseMax
                && cosine >= ADAPTIVE_SEMANTIC_RECALL_POLICY.bridgeCosineGate
                && entity.count >= ADAPTIVE_SEMANTIC_RECALL_POLICY.minEntityOverlap;
            const aliasBridge = aliasBridgeHits.length > 0 && entity.count >= Math.max(1, ADAPTIVE_SEMANTIC_RECALL_POLICY.minEntityOverlap - 1);
            const assist = aliasBridge || weakSparseStrongEmbedding;
            const sparseWeight = assist
                ? ADAPTIVE_SEMANTIC_RECALL_POLICY.bridgeSparseWeight
                : directSparseEvidence
                    ? ADAPTIVE_SEMANTIC_RECALL_POLICY.directSparseWeight
                    : ADAPTIVE_SEMANTIC_RECALL_POLICY.legacySparseWeight;
            const embeddingWeight = assist
                ? ADAPTIVE_SEMANTIC_RECALL_POLICY.bridgeEmbeddingWeight
                : directSparseEvidence
                    ? ADAPTIVE_SEMANTIC_RECALL_POLICY.directEmbeddingWeight
                    : ADAPTIVE_SEMANTIC_RECALL_POLICY.legacyEmbeddingWeight;
            const reasons = [];
            if (aliasBridge) reasons.push(`alias:${aliasBridgeHits.join('/')}`);
            if (weakSparseStrongEmbedding) reasons.push(`semantic-entity:${entity.hits.join('/') || entity.count}`);
            if (directSparseEvidence) reasons.push('direct-sparse-evidence');
            const floor = aliasBridge ? ADAPTIVE_SEMANTIC_RECALL_POLICY.semanticFloor : 0;
            return {
                policyVersion: ADAPTIVE_SEMANTIC_RECALL_POLICY.version,
                assist,
                aliasBridge,
                weakSparseStrongEmbedding,
                directSparseEvidence,
                sparseWeight,
                embeddingWeight,
                entityOverlap: entity.count,
                entityHits: entity.hits,
                aliasBridgeHits,
                semanticGate: assist || (embeddingUsed && cosine >= 0.70 && entity.count >= ADAPTIVE_SEMANTIC_RECALL_POLICY.minEntityOverlap),
                semanticFloor: floor,
                reasons: uniqLimit(reasons, 8)
            };
        };
        const calcSimilarityDetailed = async (textA, textB, options = {}) => {
            const cleanA = String(textA || '').trim();
            const cleanB = String(textB || '').trim();
            if (!cleanA || !cleanB) {
                return { similarity: 0, sparseScore: 0, baseScore: 0, embedding: 0, embeddingUsed: false, evidenceGate: false, evidenceReasons: [], anchorBonus: 0, bestWindow: '', semanticAssist: false, semanticGate: false, semanticReasons: [] };
            }
            const sparse = StrengthenedJaccardCore.score(cleanA, cleanB, {
                weights: CONFIG.scoringWeights || DEFAULT_RE_SCORING_WEIGHTS,
                focusNames: options.focusNames || [],
                meta: options.meta || {},
                currentTurn: options.currentTurn || 0,
                anchorBonusLimit: Number(CONFIG.recallAnchorBonus ?? 0.12),
                includeWindow: !!options.includeWindow,
                maxChars: Number(options.maxWindowChars || CONFIG.recallSentenceWindowChars || 260)
            });
            const sparseScore = Number(sparse?.score || 0);
            const engine = EmbeddingEngine;
            let cosine = 0;
            let embeddingUsed = false;
            const embeddingAllowed = options.embeddingAllowed !== false;
            if (embeddingAllowed && engine && typeof engine.getEmbedding === 'function' && typeof engine.cosineSimilarity === 'function') {
                const hasSuppliedVecA = Object.prototype.hasOwnProperty.call(options, 'queryEmbedding')
                    || Object.prototype.hasOwnProperty.call(options, 'embeddingA');
                const vecA = hasSuppliedVecA
                    ? (options.queryEmbedding || options.embeddingA || null)
                    : await engine.getEmbedding(cleanA, { source: options.embeddingSourceA || options.embeddingSource || 'similarity_query' });
                const vecB = vecA ? await engine.getEmbedding(cleanB, { source: options.embeddingSourceB || options.embeddingSource || 'similarity_candidate' }) : null;
                cosine = (vecA && vecB) ? Math.max(0, engine.cosineSimilarity(vecA, vecB)) : 0;
                embeddingUsed = !!(vecA && vecB);
            }
            const semantic = inferAdaptiveSemanticRecall(cleanA, cleanB, sparse, cosine, embeddingUsed);
            const mixed = embeddingUsed
                ? (sparseScore * semantic.sparseWeight) + (cosine * semantic.embeddingWeight)
                : sparseScore;
            const aliasBridgeBonus = semantic.aliasBridge ? ADAPTIVE_SEMANTIC_RECALL_POLICY.aliasBridgeBonus : 0;
            const semanticFloor = semantic.semanticGate ? semantic.semanticFloor : 0;
            const similarity = embeddingUsed
                ? Math.max(sparseScore, mixed + aliasBridgeBonus, semanticFloor)
                : Math.max(sparseScore + aliasBridgeBonus, semanticFloor, sparseScore);
            const evidenceReasons = uniqLimit([
                ...(Array.isArray(sparse?.evidenceReasons) ? sparse.evidenceReasons : []),
                ...semantic.reasons.map(reason => `semantic:${reason}`)
            ], 10);
            return {
                similarity,
                sparseScore,
                baseScore: Number(sparse?.baseScore || sparseScore || 0),
                embedding: cosine,
                embeddingUsed,
                embeddingSkipped: !embeddingAllowed,
                embeddingSkipReason: embeddingAllowed ? '' : String(options.embeddingSkipReason || 'disabled').trim(),
                evidenceGate: !!sparse?.evidenceGate || !!semantic.semanticGate,
                evidenceReasons,
                anchorBonus: Number(sparse?.anchorBonus || 0),
                lexical: Number(sparse?.lexical || 0),
                coverage: Number(sparse?.coverage || 0),
                wordJaccard: Number(sparse?.wordJaccard || 0),
                charJaccard: Number(sparse?.charJaccard || 0),
                conceptJaccard: Number(sparse?.conceptJaccard || 0),
                overlap: Number(sparse?.overlap || 0),
                evidence: sparse?.evidence || {},
                bestWindow: String(sparse?.bestWindow || '').trim(),
                semanticAssist: !!semantic.assist,
                semanticGate: !!semantic.semanticGate,
                semanticAliasBridge: !!semantic.aliasBridge,
                semanticReasons: semantic.reasons,
                semanticPolicy: semantic.policyVersion,
                semanticSparseWeight: semantic.sparseWeight,
                semanticEmbeddingWeight: semantic.embeddingWeight,
                semanticEntityOverlap: semantic.entityOverlap,
                semanticEntityHits: semantic.entityHits,
                semanticAliasBridgeHits: semantic.aliasBridgeHits
            };
        };

        const calcSimilarity = async (textA, textB) => {
            const hA = TokenizerEngine.simpleHash(textA);
            const hB = TokenizerEngine.simpleHash(textB);
            const scoringKey = `${CONFIG.scoringProfile || DEFAULT_RE_SCORING_PROFILE}:${TokenizerEngine.simpleHash(JSON.stringify(CONFIG.scoringWeights || {}))}:evidence-v2:adaptive-semantic-v1:${CONFIG.recallAnchorBonus}`;
            const cKey = hA < hB ? `${scoringKey}_${hA}_${hB}` : `${scoringKey}_${hB}_${hA}`;
            const simCache = getSimCache();
            const cachedScore = simCache.get(cKey);
            if (cachedScore !== undefined) return cachedScore;
            const detail = await calcSimilarityDetailed(textA, textB, {});
            const score = Number(detail?.similarity || 0);
            simCache.set(cKey, score);
            return score;
        };

        const calcRecency = (turn, current) => Math.exp(-Math.max(0, current - turn) / 20);
        const classifyRecallIntent = (query = '') => {
            const q = String(query || '').toLowerCase();
            const intent = {
                origin: RECALL_INTENT_PATTERNS.origin.test(q),
                transition: RECALL_INTENT_PATTERNS.transition.test(q),
                current: RECALL_INTENT_PATTERNS.current.test(q),
                relationship: RECALL_INTENT_PATTERNS.relationship.test(q),
                worldRule: RECALL_INTENT_PATTERNS.worldRule.test(q),
                aftermath: RECALL_INTENT_PATTERNS.aftermath.test(q)
            };
            intent.any = Object.values(intent).some(Boolean);
            intent.labels = Object.entries(intent).filter(([key, value]) => key !== 'any' && value).map(([key]) => key);
            return intent;
        };
        const getRecallPayload = (entry = null) => {
            try { return CompactMemoryCodec.parsePayloadFromEntry(entry) || {}; } catch (_) { return {}; }
        };
        const hybridArrayFromValue = (value) => Array.isArray(value)
            ? value.map(v => typeof v === 'string' ? v : (v?.name || v?.id || v?.label || v?.ref || v?.text || v?.summary || '')).map(v => String(v || '').trim()).filter(Boolean)
            : String(value || '').split(/[\n,|;/]+/g).map(v => v.trim()).filter(Boolean);
        const getLedgerProjectionParts = (payload = {}) => {
            if (!CompactMemoryCodec.isLedgerPayload?.(payload)) {
                return { text: [], entities: [], tags: [], relation: [], world: [], narrative: [], scene: [], unresolved: [] };
            }
            const facts = Array.isArray(payload.facts) ? payload.facts : [];
            const canonicalEntities = hybridArrayFromValue(payload?.participants?.canonicalEntities);
            const unresolved = Array.isArray(payload?.participants?.unresolvedMentions)
                ? payload.participants.unresolvedMentions.flatMap(item => [item?.label, item?.role, item?.evidence]).filter(Boolean)
                : [];
            const groups = Array.isArray(payload?.participants?.groups)
                ? payload.participants.groups.flatMap(item => [item?.label, item?.role, item?.evidence]).filter(Boolean)
                : [];
            const factTexts = facts.flatMap(item => [
                item?.type,
                item?.text,
                ...(Array.isArray(item?.entities) ? item.entities : []),
                ...(Array.isArray(item?.subjects) ? item.subjects.flatMap(ref => [ref?.label, ref?.role]) : []),
                ...(Array.isArray(item?.observerEntities) ? item.observerEntities : []),
                ...(Array.isArray(item?.evidence) ? item.evidence.map(ev => ev?.text || ev).filter(Boolean) : [])
            ]).filter(Boolean);
            const openThreads = Array.isArray(payload?.continuity?.openThreads) ? payload.continuity.openThreads : [];
            const relationSignals = Array.isArray(payload?.continuity?.relationSignals) ? payload.continuity.relationSignals : [];
            const worldChanges = Array.isArray(payload?.continuity?.worldChanges) ? payload.continuity.worldChanges : [];
            const narrative = openThreads.flatMap(item => [
                item?.label,
                item?.text,
                item?.status,
                ...(Array.isArray(item?.entities) ? item.entities : []),
                ...(Array.isArray(item?.subjectRefs) ? item.subjectRefs.flatMap(ref => [ref?.label, ref?.role]) : []),
                ...(Array.isArray(item?.resolutionCriteria) ? item.resolutionCriteria : [])
            ]).filter(Boolean);
            const relation = relationSignals.flatMap(item => [item?.text, item?.status, ...(Array.isArray(item?.entities) ? item.entities : [])]).filter(Boolean);
            const world = worldChanges.flatMap(item => [item?.type, item?.text, item?.summary, ...(Array.isArray(item?.tags) ? item.tags : [])]).filter(Boolean);
            const scene = payload.scene && typeof payload.scene === 'object'
                ? [payload.scene.time, payload.scene.location, payload.scene.summary].filter(Boolean)
                : [];
            const summaryV2 = payload.summaryV2 && typeof payload.summaryV2 === 'object'
                ? [payload.summaryV2.oneLine, payload.summaryV2.continuity, payload.summaryV2.recall].filter(Boolean)
                : [];
            const sceneCore = payload.sceneCore && typeof payload.sceneCore === 'object'
                ? [
                    payload.sceneCore.time,
                    payload.sceneCore.location,
                    payload.sceneCore.locationStatus,
                    payload.sceneCore.scenePhase,
                    payload.sceneCore.activeProblem,
                    payload.sceneCore.nextPhysicalAction
                ].filter(Boolean)
                : [];
            const beats = Array.isArray(payload.beats)
                ? payload.beats.flatMap(item => [item?.type, item?.summary, ...(Array.isArray(item?.entities) ? item.entities : [])]).filter(Boolean)
                : [];
            const evidence = Array.isArray(payload.evidence)
                ? payload.evidence.flatMap(item => [item?.source, item?.kind, item?.text]).filter(Boolean)
                : [];
            const relationDeltas = Array.isArray(payload.relationDeltas)
                ? payload.relationDeltas.flatMap(item => [item?.delta, item?.trigger, ...(Array.isArray(item?.pair) ? item.pair : [])]).filter(Boolean)
                : [];
            const entityStates = payload.entityStates && typeof payload.entityStates === 'object'
                ? Object.entries(payload.entityStates).flatMap(([name, state]) => [
                    name,
                    ...(Array.isArray(state?.visibleState) ? state.visibleState : []),
                    ...(Array.isArray(state?.inferredState) ? state.inferredState : [])
                ]).filter(Boolean)
                : [];
            const audit = [
                ...(Array.isArray(payload?.audit?.cautions) ? payload.audit.cautions : []),
                ...(Array.isArray(payload?.audit?.overpromotionRisks) ? payload.audit.overpromotionRisks : [])
            ];
            const factTypes = facts.map(item => item?.type).filter(Boolean);
            const tags = dedupeTextArray([
                ...(Array.isArray(payload.tags) ? payload.tags : []),
                ...(Array.isArray(payload.recallKeywords) ? payload.recallKeywords : []),
                ...factTypes.map(type => `fact:${type}`),
                ...worldChanges.flatMap(item => Array.isArray(item?.tags) ? item.tags : []),
                ...beats.filter(value => /^(?:state|realization|reaction|relation_delta|next_action|open_thread)$/i.test(String(value || ''))).map(value => `beat:${value}`),
                ...(relationSignals.length ? ['ledger_relation_signal'] : []),
                ...(openThreads.length ? ['ledger_open_thread'] : []),
                ...(worldChanges.length ? ['ledger_world_change'] : [])
            ].map(v => String(v || '').trim()).filter(Boolean)).slice(0, 32);
            const entities = dedupeTextArray([
                ...canonicalEntities,
                ...facts.flatMap(item => Array.isArray(item?.entities) ? item.entities : []),
                ...facts.flatMap(item => Array.isArray(item?.observerEntities) ? item.observerEntities : [])
            ].map(v => String(v || '').trim()).filter(Boolean)).slice(0, 32);
            return {
                text: dedupeTextArray([
                    payload.summary,
                    ...summaryV2,
                    ...factTexts,
                    ...scene,
                    ...sceneCore,
                    ...narrative,
                    ...relation,
                    ...relationDeltas,
                    ...world,
                    ...beats,
                    ...evidence,
                    ...entityStates,
                    ...audit,
                    ...groups,
                    ...unresolved
                ].map(v => String(v || '').trim()).filter(Boolean)).slice(0, 180),
                entities,
                tags,
                relation,
                world,
                narrative,
                scene: dedupeTextArray([...scene, ...sceneCore].map(v => String(v || '').trim()).filter(Boolean)).slice(0, 64),
                unresolved
            };
        };
        const getHybridPayloadProjectionText = (payload = {}, meta = {}, extraText = '') => {
            const ledger = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            return dedupeTextArray([
                String(extraText || '').trim(),
                payload.summary,
                payload.arcKey,
                payload.arcRole,
                payload.causalRole,
                ...(isLedger ? [] : [
                    payload.primaryConflict,
                    payload.relationDelta,
                    ...(Array.isArray(payload.tags) ? payload.tags : []),
                    ...(Array.isArray(payload.mentionedEntityNames) ? payload.mentionedEntityNames : []),
                    ...(Array.isArray(payload.entityRefs) ? payload.entityRefs : [])
                ]),
                ...ledger.text,
                ...ledger.tags,
                ...(Array.isArray(meta?.tags) ? meta.tags : []),
                ...(isLedger ? [] : [
                    ...(Array.isArray(meta?.ent) ? meta.ent : []),
                    ...(Array.isArray(meta?.entities) ? meta.entities : [])
                ])
            ].map(v => String(v || '').trim()).filter(Boolean)).join('\n');
        };
        const getHybridPayloadEntityRefs = (payload = {}, meta = {}, persistentHybrid = {}) => {
            const ledger = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            return dedupeTextArray([
                ...(isLedger ? [] : [
                    ...hybridArrayFromValue(persistentHybrid?.subjects),
                    ...hybridArrayFromValue(persistentHybrid?.aliases),
                    ...hybridArrayFromValue(meta?.ent),
                    ...hybridArrayFromValue(meta?.entities),
                    ...hybridArrayFromValue(payload?.mentionedEntityNames),
                    ...hybridArrayFromValue(payload?.entityRefs)
                ]),
                ...ledger.entities
            ].map(v => String(v || '').trim()).filter(Boolean)).slice(0, 32);
        };
        const getHybridPayloadTagSeeds = (payload = {}, meta = {}, persistentHybrid = {}, retrospectiveClass = '') => {
            const ledger = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            return dedupeTextArray([
                ...(isLedger ? [] : [
                    ...hybridArrayFromValue(persistentHybrid?.tags),
                    ...hybridArrayFromValue(payload?.tags),
                    ...hybridArrayFromValue(meta?.tags),
                    ...hybridArrayFromValue(payload?.arcKey),
                    ...hybridArrayFromValue(payload?.arcRole),
                    ...hybridArrayFromValue(payload?.causalRole)
                ]),
                ...ledger.tags,
                ...CompactMemoryCodec.getRetrospectiveTags(retrospectiveClass)
            ].map(v => String(v || '').trim()).filter(Boolean)).slice(0, 32);
        };
        const classifyRecallBucket = (payload = {}, intent = {}, meta = {}, currentTurn = 0) => {
            const retrospectiveClass = CompactMemoryCodec.normalizeRetrospectiveClass(
                payload?.retrospectiveClass || payload?.hybridRow?.retrospectiveClass || payload?.hme?.retrospectiveClass || meta?.hme?.retrospectiveClass || ''
            );
            if (retrospectiveClass || CompactMemoryCodec.isContinuityOnlyRecallProfile(payload)) return 'retrospective';
            const projectionText = getHybridPayloadProjectionText(payload, meta);
            const arcRole = String(payload.arcRole || '').toLowerCase();
            const causalRole = String(payload.causalRole || '').toLowerCase();
            const arcKey = String(payload.arcKey || '').toLowerCase();
            if (arcRole === 'origin' || causalRole === 'cause' || /setup|origin/.test(arcKey) || /원점|기원|첫\s*만남|시작점|origin|beginning|setup/i.test(projectionText)) return 'origin';
            if (arcRole === 'transition' || causalRole === 'trigger' || /transition|turning/.test(arcKey) || /전환|계기|transition|trigger|turning/i.test(projectionText)) return 'transition';
            if (arcRole === 'aftermath' || causalRole === 'result' || /aftermath|repair|rupture|post_/.test(arcKey)) return 'aftermath';
            const worldSignalProfile = getHybridWorldSignalProfile(payload, meta);
            if (intent.relationship && getLedgerProjectionParts(payload).relation.length > 0) return 'relationship';
            if (intent.worldRule && worldSignalProfile.dedicatedRow) return 'world';
            const turn = Number(payload.turn || meta.t || 0);
            if (Number.isFinite(turn) && currentTurn && Math.max(0, currentTurn - turn) <= 3) return 'current';
            return 'general';
        };
        const calcRecallIntentBonus = (payload = {}, intent = {}, meta = {}, currentTurn = 0) => {
            if (!intent?.any) return 0;
            let bonus = 0;
            const bucket = classifyRecallBucket(payload, intent, meta, currentTurn);
            const ledger = getLedgerProjectionParts(payload);
            const projectionText = getHybridPayloadProjectionText(payload, meta);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const arcRole = String(payload.arcRole || '').toLowerCase();
            const causalRole = String(payload.causalRole || '').toLowerCase();
            const hasConflict = !isLedger && !!String(payload.primaryConflict || '').trim();
            const hasDelta = ledger.relation.length > 0 || (!isLedger && !!String(payload.relationDelta || '').trim());
            const worldSignalProfile = getHybridWorldSignalProfile(payload, meta);
            if (intent.origin && (bucket === 'origin' || arcRole === 'origin' || causalRole === 'cause')) bonus += 0.18;
            if (intent.transition && (bucket === 'transition' || arcRole === 'transition' || causalRole === 'trigger' || causalRole === 'escalation')) bonus += 0.16;
            if (intent.relationship && (bucket === 'relationship' || hasDelta)) bonus += 0.10;
            if (intent.worldRule && (bucket === 'world' || worldSignalProfile.dedicatedRow)) bonus += 0.10;
            if (intent.aftermath && (bucket === 'aftermath' || causalRole === 'result')) bonus += 0.10;
            if ((intent.origin || intent.transition) && hasConflict) bonus += 0.05;
            if ((intent.relationship || intent.transition) && hasDelta) bonus += 0.05;
            return Math.min(0.32, bonus);
        };


        // Recall Scoring V2 parity layer.
        // This is deliberately layered *above* the strengthened Jaccard core.  The sparse
        // engine still computes lexical/semantic similarity, while this layer decides
        // whether a candidate has enough direct evidence to receive positive bonuses.
        const RECALL_SCORING_V2_POLICY = Object.freeze({
            version: 'libra_recall_scoring_v2_parity_20260617',
            minSparseGate: 0.18,
            minWeakSparseGate: 0.10,
            maxPositiveBonus: 0.42,
            hardMismatchPenalty: 0.55,
            genericAnchorPenalty: 0.10,
            directAnchorBonus: 0.11,
            entityBonus: 0.07,
            semanticBonus: 0.055,
            bucketBonus: 0.075,
            directEvidenceBonus: 0.06,
            salienceWeight: 0.12,
            stalePenalty: 0.08
        });
        const RECALL_SCORING_DOMAIN_ANCHORS = new Set([]);
        const RECALL_SCORING_GENERIC_ANCHORS = new Set([
            '회수','기억','장면','관련','연결','정리','요약','정보','현재','지금','처음','원점부터','필요','필요해','다시','어떻게','무엇','왜','그때','이후','이전','계속','갈등','관계','상황','상태','단둘','단둘이','먹었던','먹은','먹던','먹고','식사','마음','부담','생긴','흔들린','부분','규칙','회사','계획','계획이야','일정','동선','동선을','숙소','관광','여행','하카타','고쿠라성','카페','라멘','축제','상관없는','상관','무관','제외','말고','아이돌','연습생','회수해줘','뭐였는지','막았는지','공개적','공개적으로','어떤','무슨','이유','때문','때문에','롤백','롤백된','삭제','삭제된','테스트','테스트야'
        ]);
        const RECALL_EXTERNAL_DOMAIN_RE = /고쿠라성|하카타|관광|숙소|호텔|동선|여행|일정|항공|비행|교통|맛집|카페|라멘|축제|온천|박물관|성터|후쿠오카|오사카|도쿄|나가사키|유후인|벳푸/i;
        const RECALL_STRONG_RP_RE = /a^/i;
        const RECALL_LATE_FAMILY_RE = /가족|자녀|아들(?=$|[\s,.;!?'"”’)\]}]|은|는|이|가|을|를|에게|과|와|의)|딸(?=$|[\s,.;!?'"”’)\]}]|은|는|이|가|을|를|에게|과|와|의)|부부|후일담|출산|육아/u;
        const RECALL_ORIGIN_QUERY_CUE_RE = /원점|어렸을\s*때|첫\s*만남|처음(?:에|부터)?|기원|초반|why|origin|beginning/u;
        const RECALL_EARLY_ORIGIN_SCENE_RE = /원점|어렸을\s*때|첫\s*만남|처음\s*(?:만났|사귀|좋아하게|끌렸|연애하게)|처음부터/u;
        const RECALL_GLOBAL_RECAP_RE = /스토리\s*전체\s*평가|전체\s*구조|전체적\s*흐름|장대한|대중들\s*포함해서|첫째를\s*가졌|가족\s*탄생/u;
        const normalizeRecallScoringAnchor = (value = '') => normalizeRecallAnchor(stripRecallAnchorParticles(normalizeRecallAnchor(value)));
        const normalizeRecallNameKey = (value = '') => normalizeRecallScoringAnchor(value).replace(/\s+/g, '');
        const isExternalRecallAnchor = (anchor = '') => RECALL_EXTERNAL_DOMAIN_RE.test(normalizeRecallScoringAnchor(anchor));
        const isGenericRecallAnchor = (anchor = '') => {
            const a = normalizeRecallScoringAnchor(anchor);
            return !a
                || RECALL_EXACT_ANCHOR_STOPWORDS.has(a)
                || RECALL_SCORING_GENERIC_ANCHORS.has(a)
                || /^(?:회수|기억|장면|관련|정보|정리|요약|필요|현재|지금|뭐|무엇|어떤|무슨|왜|이유|때문|공개적|롤백|삭제|테스트)/.test(a)
                || /(?:었던|했던|하던|먹던|먹은|먹고|생긴|흔들린|느낀|막았|막았는지|만나는|했던지|뭐였는지|해줘)$/.test(a);
        };
        const isScoringStrongRecallAnchor = (anchor = '') => {
            const a = normalizeRecallScoringAnchor(anchor);
            if (!a || a.length < 2) return false;
            if (RECALL_SCORING_DOMAIN_ANCHORS.has(a)) return true;
            if (isGenericRecallAnchor(a) || isExternalRecallAnchor(a)) return false;
            // Unknown proper nouns / rare concrete anchors are allowed, but generic short
            // Korean nouns are not promoted to direct evidence.
            return a.length >= 3 && !/^(계획|일정|동선|관광|숙소|여행|상관|제외|말고)/u.test(a);
        };
        const splitRecallAnchorsByEntity = (anchors = [], names = []) => {
            const nameKeys = new Set((Array.isArray(names) ? names : []).map(normalizeRecallNameKey).filter(Boolean));
            const entityAnchors = [];
            const sceneAnchors = [];
            for (const anchor of Array.isArray(anchors) ? anchors : []) {
                const normalized = normalizeRecallNameKey(anchor);
                if (!normalized) continue;
                if (nameKeys.has(normalized)) entityAnchors.push(normalizeRecallScoringAnchor(anchor));
                else sceneAnchors.push(normalizeRecallScoringAnchor(anchor));
            }
            return {
                entityAnchors: uniqLimit(entityAnchors, 16),
                sceneAnchors: uniqLimit(sceneAnchors, 16)
            };
        };
        const recallQueryNeedsStrictOriginScene = (queryPlan = {}, recallIntent = {}) => {
            if (!recallIntent?.origin) return false;
            const raw = String(queryPlan?.raw || '');
            if (RECALL_ORIGIN_QUERY_CUE_RE.test(raw)) return true;
            return (Array.isArray(queryPlan?.strongAnchors) ? queryPlan.strongAnchors : []).some(anchor => RECALL_ORIGIN_QUERY_CUE_RE.test(String(anchor || '')));
        };
        const getOriginSceneCueHits = (text = '', payload = {}) => {
            const raw = [
                String(text || ''),
                getHybridPayloadProjectionText(payload),
                String(payload?.summary || ''),
                String(payload?.arcKey || ''),
                String(payload?.arcRole || ''),
                ...(Array.isArray(payload?.tags) ? payload.tags : [])
            ].join('\n');
            const hits = [];
            if (/원점|출발점|시작점/u.test(raw)) hits.push('원점');
            if (/어렸을\s*때/u.test(raw)) hits.push('어렸을 때');
            if (/첫\s*만남/u.test(raw)) hits.push('첫 만남');
            if (/처음\s*(?:만났|사귀|좋아하게|끌렸|연애하게)|처음부터/u.test(raw)) hits.push('처음 관계');
            return uniqLimit(hits, 8);
        };
        const getOriginSceneCueProfile = (text = '', payload = {}) => {
            const hits = getOriginSceneCueHits(text, payload);
            const strongHits = hits.slice();
            return {
                hits,
                strongHits,
                weakHits: [],
                totalCount: hits.length,
                strongCount: strongHits.length,
                weakCount: 0
            };
        };
        const detectOriginLateFamilyLeak = ({ text = '', payload = {}, recallIntent = {}, queryPlan = {}, entityNames = [], matchedAnchors = [] } = {}) => {
            if (!recallIntent?.origin) return false;
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const raw = [
                String(text || ''),
                getHybridPayloadProjectionText(payload),
                String(payload?.arcKey || ''),
                String(payload?.arcRole || ''),
                String(payload?.causalRole || ''),
                ...(isLedger ? [] : [
                    String(payload?.relationDelta || ''),
                    ...(Array.isArray(payload?.tags) ? payload.tags : [])
                ])
            ].join('\n');
            if (!RECALL_LATE_FAMILY_RE.test(raw) && !RECALL_GLOBAL_RECAP_RE.test(raw)) return false;
            if (RECALL_EARLY_ORIGIN_SCENE_RE.test(raw)) return false;
            const queryAnchorSplit = splitRecallAnchorsByEntity(queryPlan?.strongAnchors || [], entityNames);
            if (!recallQueryNeedsStrictOriginScene(queryPlan, recallIntent) && !queryAnchorSplit.sceneAnchors.some(anchor => RECALL_EARLY_ORIGIN_SCENE_RE.test(anchor))) return false;
            const matchedAnchorSplit = splitRecallAnchorsByEntity(matchedAnchors || [], entityNames);
            return matchedAnchorSplit.sceneAnchors.length === 0;
        };
        const getHybridWorldSignalProfile = (payload = {}, meta = {}, text = '') => {
            const ledger = getLedgerProjectionParts(payload);
            const payloadWorld = payload?.world && typeof payload.world === 'object' && !Array.isArray(payload.world) ? payload.world : {};
            const payloadHybrid = payload?.hybridRow && typeof payload.hybridRow === 'object' ? payload.hybridRow : {};
            const metaHybrid = meta?.hme && typeof meta.hme === 'object' ? meta.hme : {};
            const payloadCustomRules = normalizeWorldCustomRules(payloadWorld?.custom || payload?.custom);
            const facts = Array.isArray(payload?.facts) ? payload.facts : [];
            const ledgerWorldChange = ledger.world.length > 0 || facts.some(item => {
                const type = String(item?.type || item?.kind || '').trim().toLowerCase();
                return ['world', 'world_rule', 'worldrule', 'world_delta', 'world_change'].includes(type);
            });
            const hasStructuredWorldPayload = !!(
                String(payload?.worldSummary || meta?.worldSummary || meta?.classification || payload?.classification || payloadWorld?.classification?.primary || '').trim()
                || (payloadWorld?.exists && Object.keys(payloadWorld.exists).length > 0)
                || (payloadWorld?.systems && Object.keys(payloadWorld.systems).length > 0)
                || (payloadWorld?.physics && Object.keys(payloadWorld.physics).length > 0)
                || Object.keys(payloadCustomRules).length > 0
                || ledgerWorldChange
            );
            const hybridSource = String(payloadHybrid?.source || metaHybrid?.source || '').trim().toLowerCase();
            const storedPrimaryKind = String(payloadHybrid?.primaryKind || payloadHybrid?.kind || metaHybrid?.kind || '').trim().toLowerCase();
            const explicitWorldSnapshot = String(payload?.arcKey || '').trim().toLowerCase() === 'world_rule_snapshot';
            const narrativeSignals = ledger.narrative.length > 0 || storedPrimaryKind === 'narrative';
            const relationshipSignals = ledger.relation.length > 0 || storedPrimaryKind === 'relationship' || storedPrimaryKind === 'relation';
            const worldOnlyStructure = !narrativeSignals && !relationshipSignals;
            const dedicatedRow = explicitWorldSnapshot
                || ledgerWorldChange
                || hybridSource === 'world_recall_seed'
                || (worldOnlyStructure && hasStructuredWorldPayload)
                || (worldOnlyStructure && storedPrimaryKind === 'world' && hasStructuredWorldPayload);
            const strongDefinition = hasStructuredWorldPayload;
            return {
                strongDefinition,
                dedicatedRow,
                hasStructuredWorldPayload,
                worldLabelHits: 0,
                worldLexiconHits: 0,
                constraintHits: 0,
                narrativeSignals,
                relationshipSignals,
                ledgerWorldChange,
                hybridSource,
                storedPrimaryKind,
                sourcePolicy: 'structured_world_payload_only'
            };
        };
        const RECALL_NEGATIVE_CLAUSE_RE = /(상관\s*없\w*|무관\w*|관련\s*없\w*|관계\s*없\w*|제외\w*|빼고|말고|unrelated|not\s+related|excluding|except(?:\s+for)?|without)/i;
        const RECALL_NEGATIVE_META_TERMS = new Set(['상관', '상관없', '무관', '관련', '관계', '제외', '빼고', '말고', '없는', '없음', 'unrelated', 'related', 'excluding', 'except', 'without', 'not']);
        const RECALL_EXPLICIT_MEMORY_SCOPE_RE = /(?:이|현재|지금|방금|우리)\s*(?:챗|채팅|대화)\s*(?:안|내|에서)?|(?:저장된|기록된)\s*(?:기억|메모리)|(?:리브라|LIBRA)\s*(?:기억|메모리|리콜)|(?:chat|conversation)\s+(?:memory|recall)/i;
        const normalizeRecallSuppressionTerm = (value = '') => normalizeRecallScoringAnchor(value).replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
        const cleanNegativeRecallClause = (chunk = '') => String(chunk || '')
            .replace(RECALL_NEGATIVE_CLAUSE_RE, ' ')
            .replace(/(?:와|과|랑|하고|에)?(?:는|은)?\s*$/u, ' ')
            .replace(/^(?:그리고|또는|혹은|다만|하지만|그러나)\s+/u, ' ')
            .replace(/["'“”‘’`()[\]{}<>]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const splitNegativeRecallTerms = (chunk = '') => {
            const cleaned = cleanNegativeRecallClause(chunk);
            if (!cleaned) return [];
            const terms = [];
            const phrase = normalizeRecallSuppressionTerm(cleaned);
            if (phrase && phrase.length >= 2 && phrase.length <= 80) terms.push(phrase);
            for (const token of TokenizerEngine.tokenize(cleaned)) {
                const term = normalizeRecallSuppressionTerm(stripRecallAnchorParticles(token));
                if (!term || term.length < 2) continue;
                if (RECALL_NEGATIVE_META_TERMS.has(term)) continue;
                if (typeof RECALL_EXACT_ANCHOR_STOPWORDS !== 'undefined' && RECALL_EXACT_ANCHOR_STOPWORDS.has(term)) continue;
                terms.push(term);
            }
            return uniqLimit(terms, 24);
        };
        const extractNegativeRecallTerms = (query = '') => {
            const raw = String(query || '');
            const chunks = [];
            const koRelationPatterns = [
                /([^\n.!?。！？]{2,120}?)(?:와|과|랑|하고|에)?(?:는|은)?\s*(?:상관\s*없\w*|무관\w*|관련\s*없\w*|관계\s*없\w*)/giu,
                /([^\n.!?。！？]{2,120}?)(?:은|는|이|가|을|를)?\s*(?:제외\w*|빼고|말고)/giu
            ];
            const enRelationPatterns = [
                /(?:not\s+related\s+to|unrelated\s+to|excluding|except(?:\s+for)?|without)\s+([^\n.!?。！？]{2,120})/giu
            ];
            for (const pattern of [...koRelationPatterns, ...enRelationPatterns]) {
                let match;
                while ((match = pattern.exec(raw))) {
                    const chunk = String(match[1] || '').trim();
                    if (chunk) chunks.push(chunk);
                }
            }
            return uniqLimit(chunks.flatMap(splitNegativeRecallTerms), 32);
        };
        const recallSuppressionTermKeys = (terms = []) => new Set((Array.isArray(terms) ? terms : [])
            .map(term => normalizeRecallNameKey(term))
            .filter(Boolean));
        const recallSuppressionTermKeyCache = new WeakMap();
        const getRecallSuppressionTermKeySet = (plan = {}) => {
            if (!plan || typeof plan !== 'object') return recallSuppressionTermKeys([]);
            const terms = Array.isArray(plan.excludedTerms) ? plan.excludedTerms : [];
            const signature = terms.join('\u0000');
            const cached = recallSuppressionTermKeyCache.get(plan);
            if (cached && cached.signature === signature) return cached.keys;
            const keys = recallSuppressionTermKeys(terms);
            recallSuppressionTermKeyCache.set(plan, { signature, keys });
            return keys;
        };
        const matchesRecallSuppressionText = (value = '', plan = {}) => {
            const terms = Array.isArray(plan?.excludedTerms) ? plan.excludedTerms : [];
            if (!terms.length) return false;
            const normalized = normalizeSemanticText(value);
            const compact = normalized.replace(/\s+/g, '');
            return terms.some(term => {
                const t = normalizeSemanticText(term);
                if (!t || t.length < 2) return false;
                return normalized.includes(t) || compact.includes(t.replace(/\s+/g, ''));
            });
        };
        const buildRecallSuppressionPlan = (query = '', queryPlan = null, recallIntent = {}) => {
            const raw = String(query || '');
            const plan = queryPlan || buildRecallQueryPlan(raw, extractExactRecallAnchors(raw), recallIntent || classifyRecallIntent(raw));
            const excludedTerms = uniqLimit([...(Array.isArray(plan?.excludedTerms) ? plan.excludedTerms : []), ...extractNegativeRecallTerms(raw)], 32);
            const explicitMemoryScope = RECALL_EXPLICIT_MEMORY_SCOPE_RE.test(raw);
            const unrelatedExternal = !!(plan?.externalMismatch && !explicitMemoryScope);
            const negativeClause = excludedTerms.length > 0;
            return {
                version: 'libra.query_scope_guard.v1',
                raw,
                explicitMemoryScope,
                unrelatedExternal,
                negativeClause,
                suppressMemoryRecall: unrelatedExternal,
                suppressMemoryBackfill: unrelatedExternal,
                suppressActiveContext: unrelatedExternal,
                excludedTerms,
                reason: unrelatedExternal ? 'external_domain_query' : (negativeClause ? 'negative_recall_clause' : '')
            };
        };
        const normalizeRecallSuppressionPlan = (provided = null, query = '', queryPlan = null, recallIntent = {}) => {
            if (provided && typeof provided === 'object' && provided.version === 'libra.query_scope_guard.v1') {
                const localTerms = extractNegativeRecallTerms(query);
                return {
                    ...provided,
                    excludedTerms: uniqLimit([...(Array.isArray(provided.excludedTerms) ? provided.excludedTerms : []), ...localTerms], 32)
                };
            }
            return buildRecallSuppressionPlan(query, queryPlan, recallIntent);
        };
        const buildRecallQueryPlan = (query = '', exactAnchors = [], recallIntent = {}) => {
            const raw = String(query || '');
            const normalized = normalizeSemanticText(raw);
            const excludedTerms = extractNegativeRecallTerms(raw);
            const excludedTermKeys = recallSuppressionTermKeys(excludedTerms);
            const anchors = uniqLimit((Array.isArray(exactAnchors) ? exactAnchors : [])
                .map(normalizeRecallScoringAnchor)
                .filter(Boolean)
                .filter(anchor => !excludedTermKeys.has(normalizeRecallNameKey(anchor))), 16);
            const strongAnchors = anchors.filter(isScoringStrongRecallAnchor).slice(0, 10);
            const genericAnchors = anchors.filter(a => !strongAnchors.includes(a)).slice(0, 10);
            const externalHits = uniqLimit((normalized.match(RECALL_EXTERNAL_DOMAIN_RE) || []).map(v => String(v || '').trim()).filter(Boolean), 8);
            const explicitUnrelated = RECALL_NEGATIVE_CLAUSE_RE.test(normalized);
            const hasRpNamedAnchor = RECALL_STRONG_RP_RE.test(normalized) || strongAnchors.some(a => RECALL_SCORING_DOMAIN_ANCHORS.has(a));
            const hasRecallEvidenceIntent = !!(recallIntent?.origin || recallIntent?.transition || recallIntent?.relationship || recallIntent?.worldRule || recallIntent?.aftermath);
            const externalMismatch = externalHits.length > 0 && !hasRpNamedAnchor && !hasRecallEvidenceIntent;
            const explicitExternalMismatch = externalHits.length > 0 && explicitUnrelated && !hasRpNamedAnchor;
            return {
                version: RECALL_SCORING_V2_POLICY.version,
                raw,
                normalized,
                anchors,
                strongAnchors,
                genericAnchors,
                excludedTerms,
                externalHits,
                explicitUnrelated,
                hasRpNamedAnchor,
                hasRecallEvidenceIntent,
                externalMismatch: !!(externalMismatch || explicitExternalMismatch),
                labels: uniqLimit([
                    ...(strongAnchors.length ? ['strong-anchor'] : []),
                    ...(genericAnchors.length ? ['generic-anchor'] : []),
                    ...(excludedTerms.length ? ['negative-anchor'] : []),
                    ...(externalHits.length ? ['external-domain'] : []),
                    ...(explicitUnrelated ? ['explicit-unrelated'] : []),
                    ...(hasRecallEvidenceIntent ? ['recall-intent'] : [])
                ], 12)
            };
        };
        const collectRecallEntityEvidence = (query = '', payload = {}, meta = {}, focusNames = []) => {
            const ledger = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const names = uniqLimit([
                ...(Array.isArray(focusNames) ? focusNames : []),
                ...(isLedger ? [] : [
                    ...(Array.isArray(meta?.ent) ? meta.ent : []),
                    ...(Array.isArray(meta?.entities) ? meta.entities : []),
                    ...(Array.isArray(payload?.mentionedEntityNames) ? payload.mentionedEntityNames : []),
                    ...(Array.isArray(payload?.entityRefs) ? payload.entityRefs.map(x => x?.name || x?.id || x).filter(Boolean) : [])
                ]),
                ...ledger.entities
            ].map(v => String(v || '').trim()).filter(v => v.length >= 2), 32);
            const q = normalizeSemanticText(query).replace(/\s+/g, '');
            const hits = names.filter(name => q.includes(normalizeSemanticText(name).replace(/\s+/g, ''))).slice(0, 8);
            return { names, hits, count: hits.length };
        };
        const bucketMatchesIntent = (bucket = '', intent = {}) => {
            const b = String(bucket || 'general');
            return !!((intent?.origin && b === 'origin')
                || (intent?.transition && b === 'transition')
                || (intent?.relationship && b === 'relationship')
                || (intent?.worldRule && b === 'world')
                || (intent?.aftermath && b === 'aftermath')
                || (intent?.current && b === 'current'));
        };
        const scoreRecallItemV2 = ({ detail = {}, queryPlan = {}, recallIntent = {}, payload = {}, meta = {}, currentTurn = 0, recency = 0, effectiveRecency = 0, importance = 0, intentBonus = 0, recallBucket = 'general', W = {}, text = '', query = '', focusNames = [], hmeGraphBoostInfo = null, hmeGraphBoost = 0 } = {}) => {
            const evidenceMode = String(CONFIG.recallEvidenceGate || 'soft').toLowerCase();
            const sim = Number(detail?.similarity || 0);
            const sparse = Number(detail?.sparseScore || detail?.baseScore || 0);
            const strongAnchorHits = getExactAnchorHits(queryPlan.strongAnchors || [], text).filter(isScoringStrongRecallAnchor).slice(0, 8);
            const genericAnchorHits = getExactAnchorHits(queryPlan.genericAnchors || [], text).filter(a => !strongAnchorHits.includes(a)).slice(0, 8);
            const excludedAnchorHits = getExactAnchorHits(queryPlan.excludedTerms || [], text).slice(0, 8);
            const excludedAnchorKeySet = getRecallSuppressionTermKeySet(queryPlan);
            const positiveStrongAnchorHits = strongAnchorHits.filter(anchor => !excludedAnchorKeySet.has(normalizeRecallNameKey(anchor)));
            const entity = collectRecallEntityEvidence(query, payload, meta, focusNames);
            const semanticEvidence = !!(detail?.semanticAliasBridge || (detail?.semanticGate && Number(detail?.semanticEntityOverlap || 0) >= 1));
            const directEvidence = !!(detail?.evidence?.quoteHits?.length || detail?.evidence?.nameHits?.length || detail?.evidence?.numberHits?.length || strongAnchorHits.length || entity.count);
            const intentAligned = bucketMatchesIntent(recallBucket, recallIntent) || intentBonus >= 0.14;
            const graphRelation = String(hmeGraphBoostInfo?.relation || '').trim();
            const graphLayer = String(hmeGraphBoostInfo?.edgeLayer || '').trim();
            const graphConfidence = Number(hmeGraphBoostInfo?.confidence || 0);
            const graphBoostValue = Math.max(0, Number(hmeGraphBoost || hmeGraphBoostInfo?.boost || 0));
            const graphFocusSeed = graphRelation === 'focus_entity_seed' || graphLayer === 'focus';
            const graphEvidence = !!(hmeGraphBoostInfo && graphBoostValue > 0 && !['turn_proximity'].includes(graphRelation));
            const graphStrongEvidence = !!(graphEvidence && (
                graphFocusSeed
                || graphLayer === 'meaning'
                || !['shared_entity', 'same_source_ref', 'associated_with'].includes(graphRelation)
                || graphConfidence >= 0.35
            ));
            const negativeAnchorHardReject = excludedAnchorHits.length > 0 && positiveStrongAnchorHits.length === 0 && !semanticEvidence && !intentAligned;
            const worldSignalProfile = getHybridWorldSignalProfile(payload, meta, text);
            const worldPrimaryMatch = recallIntent?.worldRule && worldSignalProfile.dedicatedRow;
            const originFamilyMismatch = recallIntent?.origin
                && RECALL_LATE_FAMILY_RE.test(String(text || ''))
                && !RECALL_EARLY_ORIGIN_SCENE_RE.test(String(text || ''));
            const originLateFamilyLeak = detectOriginLateFamilyLeak({
                text,
                payload,
                recallIntent,
                queryPlan,
                entityNames: entity.names,
                matchedAnchors: strongAnchorHits
            });
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const originCueProfile = strictOriginQuery ? getOriginSceneCueProfile(text, payload) : { hits: [], strongHits: [], weakHits: [], totalCount: 0, strongCount: 0, weakCount: 0 };
            const sparseGate = sim >= RECALL_SCORING_V2_POLICY.minSparseGate || sparse >= RECALL_SCORING_V2_POLICY.minSparseGate;
            const weakSparseGate = (sim >= RECALL_SCORING_V2_POLICY.minWeakSparseGate || sparse >= RECALL_SCORING_V2_POLICY.minWeakSparseGate) && (semanticEvidence || directEvidence || intentAligned);
            const relevanceGate = !!(sparseGate || weakSparseGate || directEvidence || semanticEvidence || intentAligned || graphStrongEvidence);
            const domainMismatchHardReject = !!(CONFIG.recallDomainGuardEnabled !== false && queryPlan.externalMismatch && !directEvidence && !semanticEvidence && !intentAligned);
            const positiveAllowed = relevanceGate && !domainMismatchHardReject && !negativeAnchorHardReject;
            let positiveBonus = 0;
            if (positiveAllowed) {
                positiveBonus += Math.min(0.22, strongAnchorHits.length * RECALL_SCORING_V2_POLICY.directAnchorBonus);
                positiveBonus += Math.min(0.14, entity.count * RECALL_SCORING_V2_POLICY.entityBonus);
                if (semanticEvidence) positiveBonus += RECALL_SCORING_V2_POLICY.semanticBonus;
                if (intentAligned) positiveBonus += RECALL_SCORING_V2_POLICY.bucketBonus;
                if (directEvidence) positiveBonus += RECALL_SCORING_V2_POLICY.directEvidenceBonus;
                if (graphStrongEvidence) positiveBonus += Math.min(0.12, (graphBoostValue * 0.7) + (graphFocusSeed ? 0.055 : 0.025));
                if (worldPrimaryMatch) positiveBonus += 0.18;
                if (strictOriginQuery && recallIntent?.origin && originCueProfile.totalCount > 0) {
                    positiveBonus += Math.min(0.26, (originCueProfile.strongCount * 0.12) + (originCueProfile.weakCount * 0.05));
                }
                positiveBonus += Math.min(0.10, Math.max(0, importance) * RECALL_SCORING_V2_POLICY.salienceWeight);
                positiveBonus = Math.min(RECALL_SCORING_V2_POLICY.maxPositiveBonus, positiveBonus);
            }
            let penalty = 0;
            if (domainMismatchHardReject || (queryPlan.externalMismatch && !directEvidence)) penalty += RECALL_SCORING_V2_POLICY.hardMismatchPenalty;
            if (excludedAnchorHits.length > 0) penalty += Math.min(0.48, 0.28 + (excludedAnchorHits.length * 0.08));
            if (!strongAnchorHits.length && genericAnchorHits.length > 0 && !semanticEvidence && !entity.count) penalty += RECALL_SCORING_V2_POLICY.genericAnchorPenalty;
            if (originFamilyMismatch) penalty += 0.34;
            if (originLateFamilyLeak) penalty += 0.28;
            if (strictOriginQuery && recallIntent?.origin && originCueProfile.strongCount === 0 && originCueProfile.weakCount > 0) penalty += 0.09;
            const turn = Number(meta?.t || payload?.turn || 0);
            const age = Number.isFinite(turn) && currentTurn ? Math.max(0, currentTurn - turn) : 0;
            if (!recallIntent?.origin && !recallIntent?.transition && age > 24 && !directEvidence && !semanticEvidence) penalty += RECALL_SCORING_V2_POLICY.stalePenalty;
            const recencyTerm = positiveAllowed ? (Number(effectiveRecency || recency || 0) * Number(W.recency ?? 0.2)) : Math.min(0.025, Number(recency || 0) * 0.025);
            const importanceTerm = positiveAllowed ? (Number(importance || 0) * Number(W.importance ?? 0.3)) : 0;
            const baseScore = (sim * Number(W.similarity ?? 0.5)) + recencyTerm + importanceTerm;
            const finalScore = Math.max(0, baseScore + (positiveAllowed ? intentBonus : 0) + positiveBonus - penalty);
            const thresholdPass = !domainMismatchHardReject && !negativeAnchorHardReject && (
                finalScore >= Math.max(0.18, CONFIG.simThreshold * 0.72)
                || sim >= CONFIG.simThreshold
                || (directEvidence && sim >= CONFIG.simThreshold * 0.45)
                || (semanticEvidence && sim >= CONFIG.simThreshold * 0.45)
                || (intentAligned && sim >= CONFIG.simThreshold * 0.50)
                || (graphStrongEvidence && (sim >= CONFIG.simThreshold * 0.25 || sparse >= RECALL_SCORING_V2_POLICY.minWeakSparseGate * 0.55 || graphBoostValue >= 0.045))
            );
            const gatePass = !domainMismatchHardReject && !negativeAnchorHardReject && (relevanceGate || evidenceMode === 'off');
            return {
                version: RECALL_SCORING_V2_POLICY.version,
                enabled: CONFIG.recallScoringV2Enabled !== false,
                finalScore,
                baseScore,
                positiveBonus,
                penalty,
                thresholdPass,
                gatePass,
                relevanceGate,
                domainMismatchHardReject,
                directEvidence,
                semanticEvidence,
                intentAligned,
                graphEvidence,
                graphStrongEvidence,
                sparseGate,
                weakSparseGate,
                strongAnchorHits,
                genericAnchorHits,
                excludedAnchorHits,
                negativeAnchorHardReject,
                entityHits: entity.hits,
                externalHits: queryPlan.externalHits || [],
                reasons: uniqLimit([
                    ...(relevanceGate ? ['relevance_gate'] : ['no_relevance_gate']),
                    ...(strongAnchorHits.length ? [`anchor:${strongAnchorHits.slice(0, 3).join('/')}`] : []),
                    ...(genericAnchorHits.length ? [`generic:${genericAnchorHits.slice(0, 3).join('/')}`] : []),
                    ...(excludedAnchorHits.length ? [`excluded:${excludedAnchorHits.slice(0, 3).join('/')}`] : []),
                    ...(negativeAnchorHardReject ? ['negative_anchor_hard_reject'] : []),
                    ...(entity.hits.length ? [`entity:${entity.hits.slice(0, 3).join('/')}`] : []),
                    ...(semanticEvidence ? ['semantic'] : []),
                    ...(intentAligned ? [`bucket:${recallBucket}`] : []),
                    ...(graphStrongEvidence ? [`hme-graph:${graphLayer || 'signal'}:${graphRelation || 'associated'}`] : []),
                    ...(worldPrimaryMatch ? ['world-primary-match'] : []),
                    ...(strictOriginQuery && recallIntent?.origin && originCueProfile.strongCount > 0 ? [`origin-cue:${originCueProfile.strongHits.slice(0, 2).join('/')}`] : []),
                    ...(strictOriginQuery && recallIntent?.origin && originCueProfile.strongCount === 0 && originCueProfile.weakCount > 0 ? ['origin-strong-cue-miss'] : []),
                    ...(originLateFamilyLeak ? ['origin-late-family-leak'] : []),
                    ...(originFamilyMismatch ? ['origin-family-mismatch'] : []),
                    ...(domainMismatchHardReject ? ['domain_mismatch_hard_reject'] : [])
                ], 12)
            };
        };
        // Patch A follow-up: exact-anchor recall backfill.
        // Purpose: when a long-chat query names a rare concrete anchor (e.g. an item, place,
        // rule, or guilt beat), at least one memory containing that exact anchor should survive
        // prefiltering and diversity selection even if recent high-pressure scenes dominate scores.
        const RECALL_EXACT_BACKFILL_MAX = 4;
        const RECALL_EXACT_ANCHOR_STOPWORDS = new Set([
            '사용자','응답','대화','장면','현재','지금','기억','관련','회수','회수해줘','필요','필요해','연결','갈등','정보','요약','정리','계속','다음','이번','저번','처음에','왜','무엇','어떻게','그리고','하지만','그러나','때문','부터','까지','같이','중요','원점부터'
        ]);
        const stripRecallAnchorParticles = (token = '') => {
            let out = String(token || '').trim();
            for (let i = 0; i < 3; i += 1) {
                const normalizedOut = normalizeRecallAnchor(out);
                if (RECALL_SCORING_DOMAIN_ANCHORS.has(normalizedOut)) break;
                const next = out.replace(/(에게서|에게|에서|으로부터|부터|까지|이라서|라서|이라는|라는|이라도|라도|으로|로|은|는|이|가|을|를|과|와|의|도|만|에)$/u, '').trim();
                if (next === out) break;
                out = next;
                if (RECALL_SCORING_DOMAIN_ANCHORS.has(normalizeRecallAnchor(out))) break;
            }
            return out;
        };
        const normalizeRecallAnchor = (value = '') => String(value || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[^\w가-힣\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const RECALL_EXACT_ANCHOR_PRIORITY = new Set([]);
        const isPriorityRecallAnchor = (anchor = '') => RECALL_EXACT_ANCHOR_PRIORITY.has(normalizeRecallAnchor(anchor));
        const pushRecallAnchor = (anchors, value = '') => {
            const normalizedRaw = normalizeRecallAnchor(value);
            const normalized = normalizeRecallAnchor(stripRecallAnchorParticles(normalizedRaw));
            if (!normalized || normalized.length < 2) return;
            if (RECALL_EXACT_ANCHOR_STOPWORDS.has(normalized)) return;
            if (typeof isGenericRecallAnchor === 'function' && isGenericRecallAnchor(normalized)) return;
            anchors.push(normalized);
        };
        const extractExactRecallAnchors = (query = '') => {
            const raw = String(query || '');
            const lower = raw.normalize('NFKC').toLowerCase();
            const anchors = [];
            const phraseRules = [
                ['원점', /원점|처음|origin|beginning/i]
            ];
            phraseRules.forEach(([anchor, pattern]) => { if (pattern.test(lower)) pushRecallAnchor(anchors, anchor); });
            const hardQueryTokens = raw.match(/[A-Za-z][A-Za-z0-9_.-]{1,32}|[가-힣]{2,12}|[ぁ-んァ-ヶ一-龯]{2,12}/g) || [];
            for (const token of hardQueryTokens) {
                const variants = [token, stripRecallAnchorParticles(token)];
                for (const variant of variants) pushRecallAnchor(anchors, variant);
            }
            const seen = new Set();
            return anchors
                .map(normalizeRecallAnchor)
                .filter(anchor => {
                    if (!anchor || seen.has(anchor)) return false;
                    seen.add(anchor);
                    return true;
                })
                .sort((a, b) => b.length - a.length)
                .slice(0, 10);
        };
        const getExactAnchorHits = (anchors = [], text = '') => {
            const normalizedText = normalizeRecallAnchor(text);
            if (!normalizedText) return [];
            return (Array.isArray(anchors) ? anchors : [])
                .filter(anchor => {
                    const normalizedAnchor = normalizeRecallAnchor(anchor);
                    return normalizedAnchor && normalizedText.includes(normalizedAnchor);
                });
        };
        const getRecallItemKey = (item = null) => {
            const entry = item?.entry || item;
            try { return getSafeKey(entry) || TokenizerEngine.getSafeMapKey(JSON.stringify(entry || {})); }
            catch (_) { return TokenizerEngine.getSafeMapKey(String(entry?.content || item?.text || '')); }
        };
        const buildExactAnchorBackfillItem = (item = null, hits = [], recallIntent = {}, currentTurn = 0) => {
            if (!item) return null;
            const entry = { ...(item.entry || {}) };
            const meta = item.meta || getCachedMeta(entry);
            const payload = item.payload || getRecallPayload(entry);
            const text = item.text || CompactMemoryCodec.buildSearchTextFromEntry(entry);
            const detail = item.detail && typeof item.detail === 'object' ? { ...item.detail } : {};
            const reason = `exact_anchor:${hits.slice(0, 3).join('/')}`;
            detail.evidenceGate = true;
            detail.exactAnchorBackfill = true;
            detail.exactAnchorHits = hits.slice(0, 8);
            detail.evidenceReasons = uniqLimit([...(Array.isArray(detail.evidenceReasons) ? detail.evidenceReasons : []), reason], 8);
            if (!detail.bestWindow) {
                try {
                    detail.bestWindow = StrengthenedJaccardCore.selectBestWindow(hits.join(' '), text, {
                        meta,
                        currentTurn,
                        maxChars: CONFIG.recallSentenceWindowChars || 260,
                        radius: 1
                    });
                } catch (_) { detail.bestWindow = ''; }
            }
            const boostedScore = Math.max(Number(item.finalScore || 0), Number(item.similarity || 0)) + 0.28 + Math.min(0.18, hits.length * 0.04);
            const originCueProfile = recallIntent?.origin ? getOriginSceneCueProfile(text, payload || {}) : { strongCount: 0 };
            const hybridBuckets = item?.hybridRow?.hybridLite?.buckets || item?.entry?._hybridBuckets || [];
            const backfillOriginFit = Boolean(recallIntent?.origin && (
                item.recallBucket === 'origin'
                || (Array.isArray(hybridBuckets) && hybridBuckets.includes('origin'))
                || String(payload?.arcRole || '').trim() === 'origin'
                || String(payload?.causalRole || '').trim() === 'cause'
                || Number(originCueProfile.strongCount || 0) > 0
            ));
            const recallBucket = backfillOriginFit
                ? 'origin'
                : (item.recallBucket || classifyRecallBucket(payload, recallIntent, meta, currentTurn) || 'general');
            entry._score = boostedScore;
            entry._recallDetail = detail;
            entry._recallWindow = detail.bestWindow || item.entry?._recallWindow || '';
            entry._recallBucket = recallBucket;
            entry._recallIntentBonus = Math.max(Number(item.intentBonus || 0), 0.18);
            entry._recallIntentLabels = Array.isArray(recallIntent?.labels) ? recallIntent.labels.slice(0, 6) : [];
            entry._recallExactAnchorBackfill = hits.slice(0, 8);
            return {
                ...item,
                entry,
                accepted: true,
                exactAnchorBackfill: true,
                exactAnchorHits: hits.slice(0, 8),
                recallBucket,
                finalScore: boostedScore,
                detail,
                meta,
                payload,
                text
            };
        };
        const applyExactAnchorBackfill = (selectedItems = [], scoredResults = [], exactAnchors = [], topK = 15, recallIntent = {}, currentTurn = 0) => {
            const anchors = Array.isArray(exactAnchors) ? exactAnchors.filter(Boolean) : [];
            if (!anchors.length || !Array.isArray(scoredResults) || !scoredResults.length) return selectedItems;
            const limit = Math.max(1, Number(topK || 15));
            const selected = Array.isArray(selectedItems) ? selectedItems.slice() : [];
            const selectedKeys = new Set(selected.map(getRecallItemKey).filter(Boolean));
            const covered = new Set();
            for (let idx = 0; idx < selected.length; idx += 1) {
                const item = selected[idx];
                const text = [item?.text, item?.entry?.content, CompactMemoryCodec.buildSearchTextFromEntry(item?.entry)].filter(Boolean).join('\n');
                const hits = getExactAnchorHits(anchors, text);
                hits.forEach(anchor => covered.add(anchor));
                const priorityHits = hits.filter(isPriorityRecallAnchor);
                if (priorityHits.length > 0 && !(item?.exactAnchorBackfill || item?.entry?._recallExactAnchorBackfill)) {
                    const promoted = buildExactAnchorBackfillItem(item, priorityHits, recallIntent, currentTurn);
                    if (promoted) selected[idx] = promoted;
                }
            }
            const candidates = scoredResults
                .map(item => {
                    const text = [item?.text, item?.entry?.content, CompactMemoryCodec.buildSearchTextFromEntry(item?.entry)].filter(Boolean).join('\n');
                    const hits = getExactAnchorHits(anchors, text);
                    return { item, hits };
                })
                .filter(row => row.hits.length > 0)
                .sort((a, b) => {
                    const acceptedA = a.item?.accepted ? 1 : 0;
                    const acceptedB = b.item?.accepted ? 1 : 0;
                    return (b.hits.length - a.hits.length)
                        || (acceptedB - acceptedA)
                        || (Number(b.item?.finalScore || 0) - Number(a.item?.finalScore || 0))
                        || (Number(b.item?.meta?.t || 0) - Number(a.item?.meta?.t || 0));
                });
            let added = 0;
            for (const anchor of anchors) {
                if (covered.has(anchor) || added >= RECALL_EXACT_BACKFILL_MAX) continue;
                const row = candidates.find(candidate => candidate.hits.includes(anchor) && !selectedKeys.has(getRecallItemKey(candidate.item)));
                if (!row) continue;
                const backfill = buildExactAnchorBackfillItem(row.item, row.hits, recallIntent, currentTurn);
                if (!backfill) continue;
                const key = getRecallItemKey(backfill);
                if (!key || selectedKeys.has(key)) continue;
                selected.push(backfill);
                selectedKeys.add(key);
                row.hits.forEach(hit => covered.add(hit));
                added += 1;
            }
            if (selected.length <= limit) return selected;
            const backfill = selected.filter(item => item?.exactAnchorBackfill || item?.entry?._recallExactAnchorBackfill);
            const regular = selected.filter(item => !(item?.exactAnchorBackfill || item?.entry?._recallExactAnchorBackfill));
            const out = [];
            const seen = new Set();
            const add = (item) => {
                const key = getRecallItemKey(item);
                if (!key || seen.has(key) || out.length >= limit) return;
                seen.add(key);
                out.push(item);
            };
            backfill.forEach(add);
            regular.forEach(add);
            return out;
        };
        const getRecallItemText = (item = null) => {
            if (!item) return '';
            return String(item.text || item.entry?._recallWindow || CompactMemoryCodec.buildSearchTextFromEntry(item.entry || {}) || '');
        };
        const getRecallItemEntityNames = (item = null) => {
            const payload = item?.payload || {};
            const meta = item?.meta || {};
            const ledger = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const toNames = (value) => (Array.isArray(value) ? value : [])
                .map(v => typeof v === 'string' ? v : (v?.name || v?.id || v?.label || v?.ref || ''))
                .map(v => String(v || '').trim())
                .filter(Boolean);
            return uniqLimit([
                ...(isLedger ? [] : [
                    ...toNames(meta?.ent),
                    ...toNames(meta?.entities),
                    ...toNames(payload?.mentionedEntityNames),
                    ...toNames(payload?.entityRefs),
                    ...toNames(item?.hybridRow?.subjects)
                ]),
                ...ledger.entities
            ], 24);
        };
        const annotateOriginSelectionCandidate = (item = null, queryPlan = {}, recallIntent = {}) => {
            if (!item) return null;
            const text = getRecallItemText(item);
            const entityNames = getRecallItemEntityNames(item);
            const matchedAnchors = getExactAnchorHits(queryPlan?.strongAnchors || [], text).filter(isScoringStrongRecallAnchor).slice(0, 12);
            const anchorSplit = splitRecallAnchorsByEntity(matchedAnchors, entityNames);
            const sceneHits = anchorSplit.sceneAnchors.filter(anchor => RECALL_EARLY_ORIGIN_SCENE_RE.test(anchor));
            const originCueProfile = getOriginSceneCueProfile(text, item.payload || {});
            const originCueHits = originCueProfile.hits;
            const retrospective = Boolean(
                item?.payload?.retrospectiveClass
                || String(item?.payload?.arcRole || '').trim() === 'retrospective'
                || String(item?.payload?.recallProfile || '').trim() === 'continuity_only'
            );
            const leak = detectOriginLateFamilyLeak({
                text,
                payload: item.payload || {},
                recallIntent,
                queryPlan,
                entityNames,
                matchedAnchors
            });
            return {
                item,
                text,
                entityNames,
                matchedAnchors,
                sceneHits,
                originCueHits,
                originCueProfile,
                retrospective,
                leak,
                exactBackfill: Boolean(item?.exactAnchorBackfill || item?.entry?._recallExactAnchorBackfill)
            };
        };
        const rebalanceSelectedRecallItemsForIntent = (selectedItems = [], scoredResults = [], queryPlan = {}, recallIntent = {}, topK = 15, currentTurn = 0) => {
            if (!recallIntent?.origin || !Array.isArray(selectedItems) || selectedItems.length === 0) return selectedItems;
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const sceneQueryAnchors = splitRecallAnchorsByEntity(queryPlan?.strongAnchors || [], []).sceneAnchors
                .filter(anchor => RECALL_EARLY_ORIGIN_SCENE_RE.test(anchor));
            if (!strictOriginQuery && sceneQueryAnchors.length === 0) return selectedItems;
            const limit = Math.max(1, Number(topK || selectedItems.length || 1));
            const keyOf = (item) => getRecallItemKey(item);
            const selectedKeys = new Set(selectedItems.map(keyOf).filter(Boolean));
            const annotatedSelected = selectedItems.map(item => annotateOriginSelectionCandidate(item, queryPlan, recallIntent)).filter(Boolean);
            const minSceneCount = strictOriginQuery
                ? 2
                : Math.min(3, Math.max(1, sceneQueryAnchors.length >= 2 ? 2 : 1));
            const minStrongOriginCount = strictOriginQuery ? 1 : 0;
            const acceptedCandidates = (Array.isArray(scoredResults) ? scoredResults : [])
                .filter(item => item?.accepted)
                .map(item => annotateOriginSelectionCandidate(item, queryPlan, recallIntent))
                .filter(Boolean)
                .filter(candidate => {
                    const key = keyOf(candidate.item);
                    return key && !selectedKeys.has(key);
                })
                .filter(candidate => !candidate.leak && (candidate.sceneHits.length > 0 || candidate.originCueHits.length > 0 || candidate.item?.recallBucket === 'origin'))
                .sort((a, b) => {
                    const exactDiff = Number(b.exactBackfill) - Number(a.exactBackfill);
                    if (exactDiff) return exactDiff;
                    const retrospectiveDiff = Number(a.retrospective) - Number(b.retrospective);
                    if (retrospectiveDiff) return retrospectiveDiff;
                    const strongCueDiff = Number(b.originCueProfile?.strongCount || 0) - Number(a.originCueProfile?.strongCount || 0);
                    if (strongCueDiff) return strongCueDiff;
                    const cueDiff = b.originCueHits.length - a.originCueHits.length;
                    if (cueDiff) return cueDiff;
                    const sceneDiff = b.sceneHits.length - a.sceneHits.length;
                    if (sceneDiff) return sceneDiff;
                    const turnDiff = Number(a.item?.meta?.t || a.item?.payload?.turn || 0) - Number(b.item?.meta?.t || b.item?.payload?.turn || 0);
                    if (strictOriginQuery && turnDiff) return turnDiff;
                    return Number(b.item?.finalScore || 0) - Number(a.item?.finalScore || 0);
                });
            if (acceptedCandidates.length === 0) return selectedItems;
            const takeReplacement = (predicate = null) => {
                if (typeof predicate !== 'function') return acceptedCandidates.shift() || null;
                const index = acceptedCandidates.findIndex(predicate);
                if (index < 0) return acceptedCandidates.shift() || null;
                const [picked] = acceptedCandidates.splice(index, 1);
                return picked || null;
            };
            const replaceAt = (index, replacement) => {
                if (!replacement || index < 0 || index >= annotatedSelected.length) return false;
                const oldKey = keyOf(annotatedSelected[index]?.item);
                const newKey = keyOf(replacement.item);
                if (!newKey || selectedKeys.has(newKey)) return false;
                if (oldKey) selectedKeys.delete(oldKey);
                selectedKeys.add(newKey);
                annotatedSelected[index] = replacement;
                return true;
            };
            const countStrongOriginSelected = () => annotatedSelected.reduce((acc, candidate) => acc + (((candidate.originCueProfile?.strongCount || 0) > 0 && !candidate.retrospective) ? 1 : 0), 0);
            annotatedSelected
                .map((candidate, index) => ({ candidate, index }))
                .filter(({ candidate }) => candidate.leak && candidate.sceneHits.length === 0 && candidate.originCueHits.length === 0)
                .sort((a, b) => Number(a.candidate.item?.finalScore || 0) - Number(b.candidate.item?.finalScore || 0))
                .forEach(({ index }) => {
                    const replacement = takeReplacement();
                    if (replacement) replaceAt(index, replacement);
                });
            const hasNonRetrospectiveStrongOrigin = strictOriginQuery && (
                annotatedSelected.some(candidate => !candidate.retrospective && Number(candidate.originCueProfile?.strongCount || 0) > 0)
                || acceptedCandidates.some(candidate => !candidate.retrospective && Number(candidate.originCueProfile?.strongCount || 0) > 0)
            );
            if (hasNonRetrospectiveStrongOrigin) {
                annotatedSelected
                    .map((candidate, index) => ({ candidate, index }))
                    .filter(({ candidate }) => candidate.retrospective)
                    .sort((a, b) => Number(a.candidate.item?.finalScore || 0) - Number(b.candidate.item?.finalScore || 0))
                    .forEach(({ index }) => {
                        const replacement = takeReplacement(candidate => !candidate.retrospective);
                        if (replacement) replaceAt(index, replacement);
                    });
            }
            while (countStrongOriginSelected() < minStrongOriginCount) {
                const replacement = takeReplacement(candidate => Number(candidate.originCueProfile?.strongCount || 0) > 0 && !candidate.retrospective);
                if (!replacement) break;
                const removable = annotatedSelected
                    .map((candidate, index) => ({ candidate, index }))
                    .filter(({ candidate }) => Number(candidate.originCueProfile?.strongCount || 0) === 0 || candidate.retrospective)
                    .sort((a, b) => {
                        const retrospectiveDiff = Number(b.candidate.retrospective) - Number(a.candidate.retrospective);
                        if (retrospectiveDiff) return retrospectiveDiff;
                        const weakCueDiff = Number(a.candidate.originCueHits.length || 0) - Number(b.candidate.originCueHits.length || 0);
                        if (weakCueDiff) return weakCueDiff;
                        const leakDiff = Number(b.candidate.leak) - Number(a.candidate.leak);
                        if (leakDiff) return leakDiff;
                        const exactDiff = Number(a.candidate.exactBackfill) - Number(b.candidate.exactBackfill);
                        if (exactDiff) return exactDiff;
                        return Number(a.candidate.item?.finalScore || 0) - Number(b.candidate.item?.finalScore || 0);
                    })[0];
                if (!removable) break;
                replaceAt(removable.index, replacement);
            }
            const countSceneSelected = () => annotatedSelected.reduce((acc, candidate) => acc + ((candidate.sceneHits.length > 0 || candidate.originCueHits.length > 0) ? 1 : 0), 0);
            while (countSceneSelected() < minSceneCount) {
                const replacement = takeReplacement();
                if (!replacement) break;
                const removable = annotatedSelected
                    .map((candidate, index) => ({ candidate, index }))
                    .filter(({ candidate }) => candidate.sceneHits.length === 0 && candidate.originCueHits.length === 0)
                    .sort((a, b) => {
                        const leakDiff = Number(b.candidate.leak) - Number(a.candidate.leak);
                        if (leakDiff) return leakDiff;
                        const exactDiff = Number(a.candidate.exactBackfill) - Number(b.candidate.exactBackfill);
                        if (exactDiff) return exactDiff;
                        return Number(a.candidate.item?.finalScore || 0) - Number(b.candidate.item?.finalScore || 0);
                    })[0];
                if (!removable) break;
                replaceAt(removable.index, replacement);
            }
            const strictFiltered = annotatedSelected.filter(candidate => !(candidate.leak && candidate.sceneHits.length === 0 && candidate.originCueHits.length === 0));
            let activeSet = strictFiltered.length > 0 && strictFiltered.some(candidate => candidate.sceneHits.length > 0 || candidate.originCueHits.length > 0)
                ? strictFiltered
                : annotatedSelected;
            if (strictOriginQuery) {
                const nonRetrospective = activeSet.filter(candidate => !candidate.retrospective);
                const hasStrongNonRetrospectiveOrigin = nonRetrospective.some(candidate => Number(candidate.originCueProfile?.strongCount || 0) > 0);
                if (hasStrongNonRetrospectiveOrigin && nonRetrospective.length > 0) {
                    activeSet = nonRetrospective;
                }
            }
            const orderedSet = strictOriginQuery
                ? activeSet.slice().sort((a, b) => {
                    const retrospectiveDiff = Number(a.retrospective) - Number(b.retrospective);
                    if (retrospectiveDiff) return retrospectiveDiff;
                    const strongCueDiff = Number(b.originCueProfile?.strongCount || 0) - Number(a.originCueProfile?.strongCount || 0);
                    if (strongCueDiff) return strongCueDiff;
                    const cueDiff = Number(b.originCueHits.length || 0) - Number(a.originCueHits.length || 0);
                    if (cueDiff) return cueDiff;
                    return Number(b.item?.finalScore || 0) - Number(a.item?.finalScore || 0);
                })
                : activeSet;
            return orderedSet
                .slice(0, limit)
                .map(candidate => candidate.item);
        };
        const selectRecallDiverse = (accepted = [], topK = 15, intent = {}) => {
            const limit = Math.max(1, Number(topK || 15));
            const selected = [];
            const seen = new Set();
            const arcCounts = new Map();
            const keyOf = (item) => MemoryEngine.getSafeKey(item?.entry || item) || TokenizerEngine.getSafeMapKey(JSON.stringify(item?.entry || item || {}));
            const arcOf = (item) => String(item?.payload?.arcKey || item?.meta?.arcKey || 'no_arc').trim() || 'no_arc';
            const canAdd = (item, relaxed = false) => {
                const key = keyOf(item);
                if (!key || seen.has(key)) return false;
                if (!relaxed) {
                    const count = arcCounts.get(arcOf(item)) || 0;
                    if (count >= 2 && selected.length < Math.max(3, limit - 1)) return false;
                }
                return true;
            };
            const add = (item, relaxed = false) => {
                if (!item || !canAdd(item, relaxed)) return false;
                const key = keyOf(item);
                seen.add(key);
                arcCounts.set(arcOf(item), (arcCounts.get(arcOf(item)) || 0) + 1);
                const entry = item.entry || item;
                entry._recallBucket = item.recallBucket || 'general';
                entry._recallIntentBonus = Number(item.intentBonus || 0);
                entry._recallIntentLabels = Array.isArray(intent.labels) ? intent.labels.slice(0, 6) : [];
                selected.push(item);
                return selected.length >= limit;
            };
            const desired = [];
            if (intent.origin) desired.push('origin');
            if (intent.transition) desired.push('transition');
            if (intent.relationship) desired.push('relationship');
            if (intent.worldRule) desired.push('world');
            if (intent.aftermath) desired.push('aftermath');
            if (intent.current) desired.push('current');
            for (const bucket of [...new Set(desired)]) {
                const item = accepted.find(candidate => candidate.recallBucket === bucket && canAdd(candidate, true));
                if (item && add(item, true)) return selected;
            }
            for (const item of accepted) {
                if (add(item, false)) return selected;
            }
            for (const item of accepted) {
                if (add(item, true)) return selected;
            }
            return selected.slice(0, limit);
        };
        // World Manager Hybrid Memory Engine skeleton (read-path only).
        // The write path remains unchanged: existing memory/entity/world/narrative generation still
        // creates the source lorebook rows.  This adapter normalizes existing lmai_memory rows into
        // typed read rows, then uses bucket-preserving V2-lite scoring before expensive Jaccard work.
        const HYBRID_MEMORY_ENGINE_POLICY = Object.freeze({
            version: 'libra_world_hybrid_rollback_rows_v1_20260617',
            maxHeavyRowsDefault: 12,
            maxHeavyRowsHardCap: 8,
            heavyTextCostLimit: 60000,
            minRowsBeforeLimit: 8,
            quotas: Object.freeze({
                exact: 14,
                entity: 12,
                world: 10,
                narrative: 12,
                relationship: 10,
                origin: 10,
                current: 8,
                recentImportant: 10,
                memory: 12,
                fallback: 8
            })
        });
        const asHybridArray = (value) => Array.isArray(value)
            ? value.map(v => typeof v === 'string' ? v : (v?.name || v?.id || v?.label || v?.ref || '')).map(v => String(v || '').trim()).filter(Boolean)
            : String(value || '').split(/[\n,|;/]+/g).map(v => v.trim()).filter(Boolean);
        const normalizeHybridToken = (value = '') => normalizeSemanticText(String(value || '')).replace(/\s+/g, ' ').trim();
        const normalizeHybridRollbackState = (value = '') => {
            const v = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (!v) return 'active';
            if (['candidate_deleted','deleted_candidate','tombstone','tombstoned','deleted','rollback_deleted','inactive'].includes(v)) return 'candidate_deleted';
            if (['restored','rollback_restored','active'].includes(v)) return v === 'active' ? 'active' : 'restored';
            if (['superseded','stale'].includes(v)) return v;
            return v;
        };
        const isHybridRollbackTombstoned = (meta = {}, payload = {}, hme = {}) => {
            const ph = payload && typeof payload.hybridRow === 'object' ? payload.hybridRow : {};
            const mh = meta && typeof meta.hme === 'object' ? meta.hme : {};
            const state = normalizeHybridRollbackState(hme?.rollbackState || ph?.rollbackState || mh?.rollbackState || meta?.rollbackState || 'active');
            return state === 'candidate_deleted' || Boolean(hme?.rollbackTombstone || ph?.rollbackTombstone || mh?.rollbackTombstone || meta?.rollbackDeleted || meta?.rollbackTombstone);
        };
        const getHybridTextSignature = (entry = null) => [entry?.comment || '', entry?.key || '', getEntryContentHash(entry)].join('::');
        const classifyHybridKinds = (payload = {}, meta = {}, text = '', currentTurn = 0) => {
            const ledger = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const raw = `${getHybridPayloadProjectionText(payload, meta, text)}\n${JSON.stringify(payload || {})}\n${JSON.stringify(meta || {})}`;
            const kinds = new Set(['memory']);
            const worldSignalProfile = getHybridWorldSignalProfile(payload, meta, text);
            const retrospectiveClass = CompactMemoryCodec.normalizeRetrospectiveClass(
                payload?.retrospectiveClass || payload?.hybridRow?.retrospectiveClass || meta?.hme?.retrospectiveClass || CompactMemoryCodec.detectRetrospectiveClass(text, payload?.summary)
            );
            const entityRefs = getHybridPayloadEntityRefs(payload, meta);
            if (entityRefs.length > 0) kinds.add('entity');
            if (worldSignalProfile.dedicatedRow) kinds.add('world');
            if (/(기원|복선|미해결|내러티브|narrative|foreshadow|unresolved|arc)/i.test(raw)
                || payload?.arcRole || payload?.causalRole || (!isLedger && payload?.primaryConflict) || ledger.narrative.length > 0) kinds.add('narrative');
            if (retrospectiveClass) kinds.add('retrospective');
            if (/(relationship|romance)/i.test(raw) || (!isLedger && payload?.relationDelta) || ledger.relation.length > 0) kinds.add('relationship');
            let bucket = classifyRecallBucket(payload, { worldRule: true, relationship: true }, meta, currentTurn);
            const worldDedicated = worldSignalProfile.dedicatedRow === true;
            if (retrospectiveClass && bucket !== 'world') bucket = 'retrospective';
            let primaryKind = 'memory';
            if (bucket === 'origin' || bucket === 'transition' || bucket === 'aftermath' || kinds.has('narrative')) primaryKind = 'narrative';
            else if (kinds.has('relationship')) primaryKind = 'relationship';
            else if (kinds.has('entity')) primaryKind = 'entity';
            else if (bucket === 'world' || worldDedicated) primaryKind = 'world';
            if (retrospectiveClass && !worldDedicated) primaryKind = 'narrative';
            return { kinds: Array.from(kinds), primaryKind, bucket, worldDedicated, retrospectiveClass };
        };
        const buildHybridMemoryRow = (entry = null, index = 0, currentTurn = 0) => {
            if (!entry || String(entry?.comment || '') !== 'lmai_memory') return null;
            const signature = getHybridTextSignature(entry);
            const cache = getHybridRowCache();
            const cached = cache.get(signature);
            if (cached) return { ...cached, entry, index };
            const meta = getCachedMeta(entry) || {};
            const payload = getRecallPayload(entry) || CompactMemoryCodec.parsePayloadFromEntry(entry) || {};
            const persistentHybrid = (payload && typeof payload.hybridRow === 'object') ? payload.hybridRow : ((meta && typeof meta.hme === 'object') ? meta.hme : ((payload && typeof payload.hme === 'object') ? payload.hme : {}));
            const rollbackState = normalizeHybridRollbackState(persistentHybrid?.rollbackState || meta?.hme?.rollbackState || meta?.rollbackState || 'active');
            const rollbackTombstoned = isHybridRollbackTombstoned(meta, payload, persistentHybrid);
            const text = CompactMemoryCodec.buildSearchTextFromEntry(entry);
            if (!text || Utils.shouldExcludeStoredMemoryContent(text)) return null;
            const worldSignalProfile = getHybridWorldSignalProfile(payload, meta, text);
            const retrospectiveClass = CompactMemoryCodec.normalizeRetrospectiveClass(
                persistentHybrid?.retrospectiveClass || payload?.retrospectiveClass || meta?.hme?.retrospectiveClass || CompactMemoryCodec.detectRetrospectiveClass(text, payload?.summary)
            );
            const recallProfile = String(persistentHybrid?.recallProfile || payload?.recallProfile || (retrospectiveClass ? 'continuity_only' : '')).trim();
            const ledgerProjection = getLedgerProjectionParts(payload);
            const entityRefs = getHybridPayloadEntityRefs(payload, meta, persistentHybrid);
            const tags = getHybridPayloadTagSeeds(payload, meta, persistentHybrid, retrospectiveClass);
            const rawTagText = `${text}\n${getHybridPayloadProjectionText(payload, meta, text)}\n${tags.join(' ')}`;
            const persistentSceneTags = retrospectiveClass ? [] : asHybridArray(persistentHybrid?.sceneTags);
            const sceneTags = uniqLimit([...persistentSceneTags], 12);
            const emotionTags = uniqLimit([
                ...asHybridArray(persistentHybrid?.emotionTags)
            ], 12);
            const relationTags = uniqLimit([
                ...asHybridArray(persistentHybrid?.relationTags),
                ...( ledgerProjection.relation.length ? ['관계 신호'] : [] )
            ], 12);
            const worldTags = uniqLimit([
                ...asHybridArray(persistentHybrid?.worldTags),
                ...( worldSignalProfile.strongDefinition ? ['세계 규칙'] : [] ),
                ...( ledgerProjection.world.length ? ['세계 변화'] : [] )
            ], 12);
            const persistentNarrativeTags = asHybridArray(persistentHybrid?.narrativeTags).filter(tag => {
                if (!retrospectiveClass) return true;
                const normalized = String(tag || '').trim().toLowerCase();
                return !['origin', 'transition', 'aftermath'].includes(normalized);
            });
            const narrativeTags = uniqLimit([
                ...persistentNarrativeTags,
                ...( retrospectiveClass
                    ? ['retrospective', retrospectiveClass === 'family_postscript' ? 'family-postscript' : 'global-recap']
                    : [
                        ...( ledgerProjection.narrative.length ? ['open-thread'] : [] )
                    ])
            ], 12);
            const kindInfo = classifyHybridKinds(payload, meta, text, currentTurn);
            const persistentKinds = uniqLimit([...asHybridArray(persistentHybrid?.kinds), ...asHybridArray(persistentHybrid?.kind), ...asHybridArray(persistentHybrid?.primaryKind)], 8);
            const persistentPrimaryKind = String(persistentHybrid?.primaryKind || persistentHybrid?.kind || '').trim();
            const worldDedicated = Boolean(persistentHybrid?.worldDedicated || kindInfo.worldDedicated || worldSignalProfile.dedicatedRow);
            const mergedKinds = uniqLimit([...persistentKinds, ...(kindInfo.kinds || [])], 10).filter(kind => kind !== 'world' || worldDedicated);
            const resolvedPrimaryKind = retrospectiveClass && !worldDedicated
                ? 'narrative'
                : (persistentPrimaryKind === 'world' && !worldDedicated
                    ? kindInfo.primaryKind
                    : (persistentPrimaryKind || kindInfo.primaryKind));
            const persistentBaseBucket = String(persistentHybrid?.baseBucket || '').trim();
            const resolvedBaseBucket = retrospectiveClass
                ? 'retrospective'
                : (persistentBaseBucket === 'world' && !worldDedicated
                    ? String(kindInfo.bucket || '').trim()
                    : (persistentBaseBucket || String(kindInfo.bucket || '').trim()));
            const turn = Number(meta?.t || payload?.turn || persistentHybrid?.turn || 0);
            const row = {
                id: getSafeKey(entry) || signature,
                signature,
                entry,
                index,
                meta,
                payload,
                text,
                contentChars: String(text || '').length,
                turn,
                importance: Math.max(0, Math.min(1, Number(meta?.imp || payload?.importance || 5) / 10)),
                subjects: entityRefs,
                aliases: entityRefs,
                tags,
                sceneTags,
                emotionTags,
                relationTags,
                worldTags,
                narrativeTags,
                arcKey: String(persistentHybrid?.arcKey || payload?.arcKey || '').trim(),
                arcRole: String(persistentHybrid?.arcRole || payload?.arcRole || '').trim(),
                causalRole: String(persistentHybrid?.causalRole || payload?.causalRole || '').trim(),
                primaryKind: resolvedPrimaryKind,
                kinds: mergedKinds.length ? mergedKinds : kindInfo.kinds,
                baseBucket: resolvedBaseBucket,
                retrospectiveClass,
                recallProfile,
                worldDedicated,
                sourceTurnIds: uniqLimit([...asHybridArray(persistentHybrid?.sourceTurnIds).map(v => Number(v)).filter(v => Number.isFinite(v)), Number(meta?.t || payload?.turn || 0)].filter(Boolean), 16),
                rollbackState,
                rollbackTombstone: rollbackTombstoned,
                rollbackTombstoneInfo: persistentHybrid?.rollbackTombstone || meta?.hme?.rollbackTombstone || null,
                hiddenFromPrompt: Boolean(persistentHybrid?.hiddenFromPrompt || meta?.hme?.hiddenFromPrompt || meta?.hiddenFromPrompt),
                stale: Boolean(persistentHybrid?.stale || meta?.hme?.stale || meta?.stale),
                supersededBy: String(persistentHybrid?.supersededBy || '').trim(),
                staleCandidateIds: asHybridArray(persistentHybrid?.staleCandidateIds || persistentHybrid?.supersedesCandidateIds).slice(0, 8),
                persistedHybrid: Boolean(persistentHybrid?.schema || persistentHybrid?.engineVersion || persistentHybrid?.kind)
            };
            const cachedRow = { ...row, entry: null, index: 0 };
            cache.set(signature, cachedRow);
            return row;
        };

        const HME_SCOPE_INDEX_COMMENT = 'lmai_hme_index';
        const HME_SCOPE_INDEX_SCHEMA = 'libra.hme.scope_index.v1';
        const HME_SCOPE_INDEX_VERSION = 1;
        const HME_SCOPE_INDEX_MAX_TERMS = 36;
        const HME_SCOPE_INDEX_PRESELECT_HARD_CAP = 64;
        const HME_SCOPE_INDEX_INVERTED_BUCKET_LIMIT = 64;

        const getHybridScopeKey = (scopeKey = '') => String(scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
        const getHybridScopeHash = (scopeKey = '') => stableHash(getHybridScopeKey(scopeKey));
        const normalizeHmeIndexTerm = (value = '') => normalizeRecallAnchor(String(value || '')).replace(/\s+/g, ' ').trim();
        const expandHmeIndexTerms = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return [];
            return uniqLimit([
                normalizeHmeIndexTerm(raw),
                ...TokenizerEngine.tokenize(raw).map(normalizeHmeIndexTerm)
            ].filter(Boolean), 12);
        };
        const compactHmeIndexArray = (value = [], limit = 16) => uniqLimit(asHybridArray(value).map(v => String(v || '').trim()).filter(Boolean), limit);
        const hmeIndexRows = (index = null) => Array.isArray(index?.rows) ? index.rows : [];
        const hmeIndexEntryKey = (scopeKey = '') => `lmai_hme_index::${getHybridScopeHash(scopeKey)}`;

        // ─────────────────────────────────────────────────────────────
        // [HME] LIBRA-internal Associative Graph Adapter
        // Derived retrieval index only. No HAYAKU dependency, no canon,
        // no raw LiveChat storage, and no standalone memory authority.
        // ─────────────────────────────────────────────────────────────
        const HME_GRAPH_INDEX_COMMENT = 'lmai_hme_graph_index';
        const HME_GRAPH_INDEX_SCHEMA_V1 = 'libra.hme.graph_index.v1';
        const HME_GRAPH_INDEX_SCHEMA = 'libra.hme.graph_index.v2';
        const HME_GRAPH_INDEX_VERSION = 2;
        const HME_GRAPH_ONLY_MAX_SCORE = 0.58;
        const HME_GRAPH_BUCKET_LIMIT = 40;
        const HME_GRAPH_EDGE_LIMIT_PER_NODE = 8;
        const HME_GRAPH_MEANING_THRESHOLD = 0.72;
        const HME_GRAPH_SIGNAL_THRESHOLD = 0.35;
        const HME_GRAPH_GENERIC_TOPICS = new Set([
            '사건', '대화', '장소', '물건', '관계', '장소 단서', '물건 단서', '관계 단서',
            'fact:user_turn', 'fact:scene_result', 'narrative', 'current', 'world',
            'memory', 'general', 'entity', 'relationship', 'open-thread', 'ledger_open_thread',
            'ledger_relation_signal', 'ledger_world_change', '세계 변화', '세계 규칙', '관계 신호'
        ].map(value => normalizeHmeIndexTerm(String(value || ''))).filter(Boolean));
        const HME_GRAPH_STALE_EDGE_POLICY = Object.freeze({
            enabled: true,
            pruneEnabled: true,
            rebuildEnabled: true,
            rebuildRatio: 0.15,
            minEdges: 12,
            cooldownMs: 60000
        });
        const HME_GRAPH_MODE_PRESETS = Object.freeze({
            off: Object.freeze({ enabled: false, maxSeeds: 0, maxCandidates: 0, maxAdditions: 0, maxHops: 0, edgeWeightMin: 1, bonusCap: 0 }),
            light: Object.freeze({ enabled: true, maxSeeds: 6, maxCandidates: 10, maxAdditions: 4, maxHops: 1, edgeWeightMin: 0.28, bonusCap: 0.10 }),
            balanced: Object.freeze({ enabled: true, maxSeeds: 14, maxCandidates: 28, maxAdditions: 8, maxHops: 2, edgeWeightMin: 0.20, bonusCap: 0.18 }),
            deep: Object.freeze({ enabled: true, maxSeeds: 14, maxCandidates: 28, maxAdditions: 8, maxHops: 2, edgeWeightMin: 0.16, bonusCap: 0.18 })
        });
        const normalizeHmeGraphMode = (value = '') => {
            const mode = String(value || '').trim().toLowerCase();
            return HME_GRAPH_MODE_PRESETS[mode] ? mode : 'off';
        };
        const getHmeGraphPreset = () => {
            const mode = normalizeHmeGraphMode(CONFIG.hmeAssociativeGraphMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode);
            const base = HME_GRAPH_MODE_PRESETS[mode] || HME_GRAPH_MODE_PRESETS.off;
            const operationalNumber = (value, fallback, migrateIfAtOrBelow = null) => {
                const n = Number(value);
                if (!Number.isFinite(n) || n <= 0) return fallback;
                if (migrateIfAtOrBelow !== null && n <= Number(migrateIfAtOrBelow)) return fallback;
                return n;
            };
            return Object.freeze({
                ...base,
                mode,
                maxSeeds: Math.max(0, Math.min(32, operationalNumber(CONFIG.hmeGraphMaxSeeds, LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxSeeds, 8))),
                maxCandidates: Math.max(0, Math.min(96, operationalNumber(CONFIG.hmeGraphMaxCandidates, LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxCandidates, 16))),
                maxNodes: Math.max(64, Math.min(2400, operationalNumber(CONFIG.hmeGraphMaxNodes, LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxNodes, 1600))),
                maxEdges: Math.max(128, Math.min(4096, operationalNumber(CONFIG.hmeGraphMaxEdges, LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxEdges, 8000))),
                maxAdditions: Math.max(0, Math.min(24, Number(CONFIG.hmeGraphMaxAdditions || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxAdditions || base.maxAdditions) || base.maxAdditions || 0)),
                maxHops: Math.max(0, Math.min(2, Number(CONFIG.hmeGraphMaxHops || base.maxHops) || base.maxHops || 0)),
                bonusCap: Math.max(0, Math.min(0.24, Number(CONFIG.hmeGraphBonusCap || base.bonusCap) || base.bonusCap || 0))
            });
        };
        const isHmeGraphEnabled = () => CONFIG.hybridMemoryEngineEnabled !== false
            && CONFIG.hybridScopeIndexEnabled !== false
            && getHmeGraphPreset().enabled === true;
        const hmeGraphEntryKey = (scopeKey = '') => `lmai_hme_graph_index::${getHybridScopeHash(scopeKey)}`;
        const hmeGraphNodes = graph => Array.isArray(graph?.nodes) ? graph.nodes : [];
        const hmeGraphEdges = graph => Array.isArray(graph?.edges) ? graph.edges : [];
        const isHmeGraphIndexSchema = (schema = '') => [HME_GRAPH_INDEX_SCHEMA, HME_GRAPH_INDEX_SCHEMA_V1].includes(String(schema || '').trim());
        const normalizeHmeGraphToken = (value = '') => normalizeHmeIndexTerm(String(value || '')).replace(/\s+/g, ' ').trim();
        const expandHmeEntityNameVariants = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return [];
            const repaired = raw.includes('(') && !raw.includes(')') ? `${raw})` : raw;
            const strippedParen = repaired.replace(/\([^)]*\)/g, '').trim();
            const insideParen = Array.from(repaired.matchAll(/\(([^)]{1,80})\)/g)).map(match => match[1]).filter(Boolean);
            const compactParen = repaired.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
            const tokens = [
                ...(repaired.match(/[가-힣]{2,8}/g) || []),
                ...(repaired.match(/[A-Za-z][A-Za-z0-9_.-]{1,32}/g) || [])
            ];
            return uniqLimit([
                raw,
                repaired,
                strippedParen,
                compactParen,
                ...insideParen,
                ...tokens
            ].map(item => String(item || '').trim()).filter(item => item.length >= 2), 12);
        };
        const normalizeHmeEntityNameList = (items = [], limit = 32) => compactHmeIndexArray(
            asHybridArray(items).flatMap(expandHmeEntityNameVariants),
            Math.max(1, limit)
        );
        const hmeEntityMatchKeys = (items = []) => new Set(normalizeHmeEntityNameList(items, 64)
            .flatMap(value => [normalizeHmeIndexTerm(value), normalizeHmeGraphToken(value), normalizeSemanticText(value).replace(/\s+/g, '')])
            .map(value => String(value || '').trim())
            .filter(Boolean));
        const countHmeEntityFocusMatches = (row = {}, focusNames = []) => {
            const focusKeys = focusNames instanceof Set ? focusNames : hmeEntityMatchKeys(focusNames);
            if (!focusKeys || focusKeys.size === 0) return 0;
            const rowKeys = hmeEntityMatchKeys([
                ...(row?.subjects || []),
                ...(row?.aliases || []),
                ...flattenHmeGraphEntityRoles(row?.entityRoles || {})
            ]);
            let count = 0;
            for (const key of rowKeys) {
                if (focusKeys.has(key)) count += 1;
                if (count >= 8) break;
            }
            return count;
        };
        const normalizeHmeGraphList = (value = [], limit = 16) => compactHmeIndexArray(value, limit).map(v => String(v || '').trim()).filter(Boolean);
        const isHmeGraphGenericTopic = (value = '') => {
            const normalized = normalizeHmeGraphToken(value);
            if (!normalized) return true;
            return HME_GRAPH_GENERIC_TOPICS.has(normalized)
                || /^fact:(?:user_turn|scene_result|summary|current)$/i.test(normalized)
                || /^(?:kind|bucket):?(?:memory|entity|world|narrative|current|general)$/i.test(normalized);
        };
        const normalizeHmeGraphSpecificList = (items = [], limit = 16) => normalizeHmeGraphList(items, limit * 2)
            .filter(value => !isHmeGraphGenericTopic(value))
            .slice(0, limit);
        const hmeGraphTextKey = (value = '') => normalizeHmeGraphToken(value).replace(/\s+/g, ' ').trim();
        const hmeGraphObjectText = (item = null) => {
            if (!item) return '';
            if (typeof item === 'string') return item;
            return String(item.text || item.summary || item.label || item.name || item.delta || item.trigger || item.location || item.signature || item.type || '').trim();
        };
        const hmeGraphObjectList = (items = [], limit = 16) => normalizeHmeGraphSpecificList(
            (Array.isArray(items) ? items : [items])
                .flatMap(item => {
                    if (!item) return [];
                    if (typeof item === 'string') return [item];
                    return [
                        hmeGraphObjectText(item),
                        ...(Array.isArray(item.entities) ? item.entities : []),
                        ...(Array.isArray(item.pair) ? item.pair : []),
                        ...(Array.isArray(item.tags) ? item.tags : []),
                        ...(Array.isArray(item.resolutionCriteria) ? item.resolutionCriteria : [])
                    ];
                })
                .filter(Boolean),
            limit
        );
        const normalizeHmeGraphEntityRoles = (roles = {}) => ({
            primary: normalizeHmeGraphList(roles?.primary || [], 24),
            observer: normalizeHmeGraphList(roles?.observer || [], 20),
            mention: normalizeHmeGraphList(roles?.mention || [], 24),
            inferred: normalizeHmeGraphList(roles?.inferred || [], 16)
        });
        const mergeHmeGraphEntityRoles = (...roleSets) => {
            const merged = { primary: [], observer: [], mention: [], inferred: [] };
            for (const roles of roleSets) {
                const normalized = normalizeHmeGraphEntityRoles(roles || {});
                for (const key of Object.keys(merged)) merged[key].push(...normalized[key]);
            }
            return {
                primary: normalizeHmeGraphList(merged.primary, 24),
                observer: normalizeHmeGraphList(merged.observer, 20),
                mention: normalizeHmeGraphList(merged.mention, 24),
                inferred: normalizeHmeGraphList(merged.inferred, 16)
            };
        };
        const flattenHmeGraphEntityRoles = (roles = {}) => {
            const normalized = normalizeHmeGraphEntityRoles(roles);
            return normalizeHmeGraphList([
                ...normalized.primary,
                ...normalized.observer,
                ...normalized.mention,
                ...normalized.inferred
            ], 32);
        };
        const buildHmeGraphRowSignals = (payload = {}, meta = {}, row = {}, recallHints = {}, ledgerProjection = null) => {
            const ledger = ledgerProjection || getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const facts = Array.isArray(payload?.facts) ? payload.facts : [];
            const beats = Array.isArray(payload?.beats) ? payload.beats : [];
            const participants = payload?.participants && typeof payload.participants === 'object' && !Array.isArray(payload.participants) ? payload.participants : {};
            const continuity = payload?.continuity && typeof payload.continuity === 'object' && !Array.isArray(payload.continuity) ? payload.continuity : {};
            const payloadWorld = payload?.world && typeof payload.world === 'object' && !Array.isArray(payload.world) ? payload.world : {};
            const relationDeltas = Array.isArray(payload?.relationDeltas) ? payload.relationDeltas : [];
            const worldRuleHighlights = normalizeHmeGraphSpecificList([
                ...(Array.isArray(payloadWorld?.ruleHighlights) ? payloadWorld.ruleHighlights : []),
                ...(Array.isArray(payload?.ruleHighlights) ? payload.ruleHighlights : []),
                ...(Array.isArray(meta?.worldRuleHighlights) ? meta.worldRuleHighlights : [])
            ], 12);
            const worldSignature = normalizeHmeGraphSpecificList([
                payload?.worldSignature,
                payloadWorld?.signature,
                payloadWorld?.classification?.primary,
                payloadWorld?.worldSignature,
                ...(Array.isArray(continuity.worldChanges) ? continuity.worldChanges.map(item => item?.signature || item?.type || item?.text || item?.summary) : [])
            ], 6);
            const scenePlaces = normalizeHmeGraphSpecificList([
                payload?.scene?.location,
                payload?.sceneCore?.location,
                ...(Array.isArray(continuity.places) ? continuity.places : [])
            ], 8);
            const objectContinuity = normalizeHmeGraphSpecificList([
                ...(Array.isArray(continuity.objects) ? continuity.objects : []),
                ...(Array.isArray(payload?.objects) ? payload.objects : []),
                ...(Array.isArray(payload?.sceneCore?.objects) ? payload.sceneCore.objects : [])
            ], 8);
            const openThreads = hmeGraphObjectList(continuity.openThreads || ledger.narrative || [], 16);
            const relationSignals = hmeGraphObjectList([
                ...(Array.isArray(continuity.relationSignals) ? continuity.relationSignals : []),
                ...relationDeltas,
                payload?.relationDelta
            ], 16);
            const worldChanges = hmeGraphObjectList(continuity.worldChanges || ledger.world || [], 16);
            const primaryConflict = normalizeHmeGraphSpecificList([
                payload?.primaryConflict,
                row?.primaryConflict,
                ...(Array.isArray(continuity.openThreads) ? continuity.openThreads.map(item => item?.text || item?.label) : [])
            ], 6);
            const relationDelta = normalizeHmeGraphSpecificList([
                payload?.relationDelta,
                row?.relationDelta,
                ...relationDeltas.map(item => item?.delta || item?.text || item?.trigger),
                ...(Array.isArray(continuity.relationSignals) ? continuity.relationSignals.map(item => item?.text || item?.status) : [])
            ], 8);
            const primaryEntities = normalizeHmeGraphList([
                ...(row?.subjects || []),
                ...(isLedger ? ledger.entities : []),
                ...facts.flatMap(item => [
                    ...(Array.isArray(item?.entities) ? item.entities : []),
                    ...(Array.isArray(item?.subjects) ? item.subjects.flatMap(ref => [ref?.label, ref?.name, ref?.ref]).filter(Boolean) : [])
                ]),
                ...beats.flatMap(item => Array.isArray(item?.entities) ? item.entities : []),
                ...Object.keys(payload?.entityStates && typeof payload.entityStates === 'object' ? payload.entityStates : {})
            ], 24);
            const observerEntities = normalizeHmeGraphList([
                ...facts.flatMap(item => Array.isArray(item?.observerEntities) ? item.observerEntities : []),
                ...(Array.isArray(participants?.canonicalEntities) ? participants.canonicalEntities : [])
            ], 20);
            const mentionEntities = normalizeHmeGraphList([
                ...(Array.isArray(payload?.mentionedEntityNames) ? payload.mentionedEntityNames : []),
                ...(Array.isArray(meta?.ent) ? meta.ent : []),
                ...(Array.isArray(meta?.entities) ? meta.entities : []),
                ...(Array.isArray(recallHints?.names) ? recallHints.names : [])
            ], 24);
            const inferredEntities = normalizeHmeGraphList([
                ...(row?.aliases || []),
                ...(Array.isArray(payload?.entityRefs) ? payload.entityRefs : [])
            ], 16).filter(name => !primaryEntities.includes(name) && !observerEntities.includes(name) && !mentionEntities.includes(name));
            return {
                entityRoles: mergeHmeGraphEntityRoles({
                    primary: primaryEntities,
                    observer: observerEntities,
                    mention: mentionEntities,
                    inferred: inferredEntities
                }),
                arcKey: normalizeHmeGraphSpecificList([row?.arcKey, payload?.arcKey], 4)[0] || '',
                arcRole: String(row?.arcRole || payload?.arcRole || '').trim(),
                causalRole: String(row?.causalRole || payload?.causalRole || '').trim(),
                primaryConflict,
                relationDelta,
                openThreads,
                relationSignals,
                worldChanges,
                worldSignature,
                worldRuleHighlights,
                objectContinuity,
                placeContinuity: scenePlaces,
                recallKeywords: normalizeHmeGraphSpecificList(payload?.recallKeywords || [], 16),
                summaryContinuity: normalizeHmeGraphSpecificList([
                    payload?.summaryV2?.continuity,
                    payload?.summaryV2?.recall
                ], 6)
            };
        };
        const isHmeGraphRowBlocked = row => !row?.id
            || row.hiddenFromPrompt
            || row.rollbackTombstone
            || row.stale
            || ['candidate_deleted', 'superseded'].includes(normalizeHybridRollbackState(row.rollbackState || 'active'));
        const graphCanUseNode = node => !!node?.rowId
            && !node.hiddenFromPrompt
            && !node.rollbackTombstone
            && !node.stale
            && node.active !== false
            && !['candidate_deleted', 'superseded'].includes(normalizeHybridRollbackState(node.rollbackState || 'active'));
        const compareHmeGraphNodeRetention = (a, b) => {
            const turnDelta = Number(b?.turn || 0) - Number(a?.turn || 0);
            if (turnDelta) return turnDelta;
            return Number(b?.importance || 0) - Number(a?.importance || 0);
        };
        const compactHmeGraphNodes = (nodes = [], preset = getHmeGraphPreset()) => {
            const maxNodes = Math.max(128, Number(preset.maxNodes || 1200) || 1200);
            if (!Array.isArray(nodes) || nodes.length <= maxNodes) return Array.isArray(nodes) ? nodes : [];
            const tombstoneReserve = Math.min(80, Math.max(8, Math.floor(maxNodes * 0.08)));
            const inactive = nodes.filter(node => !graphCanUseNode(node)).sort(compareHmeGraphNodeRetention).slice(0, tombstoneReserve);
            const activeBudget = Math.max(0, maxNodes - inactive.length);
            const active = nodes.filter(graphCanUseNode).sort(compareHmeGraphNodeRetention).slice(0, activeBudget);
            return [...active, ...inactive].sort((a, b) => Number(a?.turn || 0) - Number(b?.turn || 0));
        };
        const buildHmeGraphNodeFromRow = (row = null) => {
            if (!row?.id) return null;
            const entityRoles = normalizeHmeGraphEntityRoles(row.entityRoles || {});
            const entities = normalizeHmeGraphList([
                ...flattenHmeGraphEntityRoles(entityRoles),
                ...(row.subjects || []),
                ...(row.aliases || [])
            ], 32);
            const topics = normalizeHmeGraphList([
                ...(row.tags || []), ...(row.sceneTags || []), ...(row.emotionTags || []),
                ...(row.relationTags || []), ...(row.worldTags || []), ...(row.narrativeTags || []),
                ...(row.recallKeywords || []), ...(row.summaryContinuity || []),
                row.primaryKind, row.baseBucket
            ], 36);
            const specificTopics = normalizeHmeGraphSpecificList(topics, 24);
            const sourceTurnIds = uniqLimit([row.turn, ...(row.sourceTurnIds || [])].map(Number).filter(v => Number.isFinite(v) && v > 0), 16);
            return {
                id: `g_node_${stableHash(`${row.id}:${row.contentHash || ''}:${row.rollbackState || ''}:${row.stale ? 1 : 0}`)}`,
                rowId: String(row.id || '').trim(),
                version: 2,
                kind: String(row.primaryKind || 'memory').trim() || 'memory',
                kinds: normalizeHmeGraphList(row.kinds || [], 10),
                contentHash: String(row.contentHash || '').trim(),
                summaryHash: stableHash([row.id, row.contentHash, ...entities.slice(0, 4), ...topics.slice(0, 6)].join('|')),
                entityRoles,
                entities,
                topics,
                specificTopics,
                tags: normalizeHmeGraphList(row.tags || [], 20),
                narrativeTags: normalizeHmeGraphList(row.narrativeTags || [], 16),
                arcKey: String(row.arcKey || '').trim(),
                arcRole: String(row.arcRole || '').trim(),
                causalRole: String(row.causalRole || '').trim(),
                primaryConflict: normalizeHmeGraphSpecificList(row.primaryConflict || [], 8),
                relationDelta: normalizeHmeGraphSpecificList(row.relationDelta || [], 8),
                openThreads: normalizeHmeGraphSpecificList(row.openThreads || [], 12),
                relationSignals: normalizeHmeGraphSpecificList(row.relationSignals || [], 12),
                worldChanges: normalizeHmeGraphSpecificList(row.worldChanges || [], 12),
                worldSignature: normalizeHmeGraphSpecificList(row.worldSignature || [], 6),
                worldRuleHighlights: normalizeHmeGraphSpecificList(row.worldRuleHighlights || [], 12),
                objectContinuity: normalizeHmeGraphSpecificList(row.objectContinuity || [], 8),
                placeContinuity: normalizeHmeGraphSpecificList(row.placeContinuity || [], 8),
                sourceRefs: sourceTurnIds.map(turn => `turn:${turn}`),
                sourceTurnIds,
                turn: normalizeLegacyMemoryTurnAnchor(row.turn || 0) || 0,
                importance: Math.max(0, Math.min(1, Number(row.importance || 0.5))),
                baseBucket: String(row.baseBucket || '').trim(),
                rollbackState: normalizeHybridRollbackState(row.rollbackState || 'active'),
                rollbackTombstone: Boolean(row.rollbackTombstone),
                hiddenFromPrompt: Boolean(row.hiddenFromPrompt),
                stale: Boolean(row.stale),
                active: !isHmeGraphRowBlocked(row),
                updatedAt: Date.now()
            };
        };
        const hmeGraphIntersect = (a = [], b = [], limit = 8) => {
            const set = new Set((Array.isArray(a) ? a : []).map(normalizeHmeGraphToken).filter(Boolean));
            const out = [];
            for (const raw of Array.isArray(b) ? b : []) {
                const key = normalizeHmeGraphToken(raw);
                if (key && set.has(key) && !out.includes(key)) out.push(key);
                if (out.length >= limit) break;
            }
            return out;
        };
        const buildHmeGraphEntityDocumentFrequency = (nodes = []) => {
            const frequency = new Map();
            for (const node of Array.isArray(nodes) ? nodes : []) {
                const seen = new Set((node?.entities || []).map(hmeGraphTextKey).filter(Boolean));
                for (const entity of seen) frequency.set(entity, (frequency.get(entity) || 0) + 1);
            }
            return frequency;
        };
        const hmeGraphEntityRoleWeight = (fromRoles = {}, toRoles = {}, entity = '') => {
            const key = hmeGraphTextKey(entity);
            const has = (roles, role) => (roles?.[role] || []).some(value => hmeGraphTextKey(value) === key);
            if (has(fromRoles, 'primary') && has(toRoles, 'primary')) return { weight: 1.0, role: 'primary-primary' };
            if ((has(fromRoles, 'primary') && has(toRoles, 'observer')) || (has(fromRoles, 'observer') && has(toRoles, 'primary'))) return { weight: 0.62, role: 'primary-observer' };
            if (has(fromRoles, 'observer') && has(toRoles, 'observer')) return { weight: 0.35, role: 'observer-observer' };
            if ((has(fromRoles, 'primary') && has(toRoles, 'mention')) || (has(fromRoles, 'mention') && has(toRoles, 'primary'))) return { weight: 0.25, role: 'primary-mention' };
            if (has(fromRoles, 'mention') && has(toRoles, 'mention')) return { weight: 0.12, role: 'mention-mention' };
            if (has(fromRoles, 'inferred') || has(toRoles, 'inferred')) return { weight: 0.08, role: 'inferred' };
            return { weight: 0.10, role: 'entity' };
        };
        const scoreHmeGraphEntityOverlap = (from = null, to = null, entityDf = new Map()) => {
            const sharedEntities = hmeGraphIntersect(from?.entities || [], to?.entities || [], 8);
            const evidence = [];
            const rolePairs = [];
            let score = 0;
            let commonOnly = sharedEntities.length > 0;
            for (const entity of sharedEntities) {
                const key = hmeGraphTextKey(entity);
                const df = Math.max(1, Number(entityDf?.get?.(key) || 1));
                const role = hmeGraphEntityRoleWeight(from?.entityRoles || {}, to?.entityRoles || {}, entity);
                const entityWeight = role.weight / Math.sqrt(df);
                if (df <= 3 || role.weight >= 0.62) commonOnly = false;
                score += entityWeight;
                evidence.push(`entity:${entity}:df${df}:${role.role}`);
                rolePairs.push(role.role);
            }
            return {
                score: Math.min(1, score),
                sharedEntities,
                evidence,
                rolePairs,
                commonOnly
            };
        };
        const hmeGraphRelationDeltaKey = (value = '') => hmeGraphTextKey(value).replace(/^(?:관계|relation|delta)[:\s-]*/i, '').trim();
        const hmeGraphEdgeSignal = (from = null, to = null, context = {}) => {
            const entityOverlap = scoreHmeGraphEntityOverlap(from, to, context.entityDf || new Map());
            const sharedEntities = entityOverlap.sharedEntities;
            const sharedTopics = hmeGraphIntersect(from?.specificTopics || [], to?.specificTopics || [], 8);
            const sharedRefs = hmeGraphIntersect(from?.sourceRefs || [], to?.sourceRefs || [], 4);
            const sharedThreadTags = hmeGraphIntersect(from?.narrativeTags || [], to?.narrativeTags || [], 4);
            const sharedOpenThreads = hmeGraphIntersect(from?.openThreads || [], to?.openThreads || [], 6);
            const sharedArc = from?.arcKey && to?.arcKey && hmeGraphTextKey(from.arcKey) === hmeGraphTextKey(to.arcKey) && !isHmeGraphGenericTopic(from.arcKey)
                ? [from.arcKey]
                : [];
            const sharedConflict = hmeGraphIntersect(from?.primaryConflict || [], to?.primaryConflict || [], 4);
            const sharedRelationDelta = hmeGraphIntersect(
                (from?.relationDelta || []).map(hmeGraphRelationDeltaKey),
                (to?.relationDelta || []).map(hmeGraphRelationDeltaKey),
                4
            );
            const sharedRelationSignals = hmeGraphIntersect(from?.relationSignals || [], to?.relationSignals || [], 4);
            const sharedWorldSignature = hmeGraphIntersect(from?.worldSignature || [], to?.worldSignature || [], 4);
            const sharedWorldRules = hmeGraphIntersect(from?.worldRuleHighlights || [], to?.worldRuleHighlights || [], 4);
            const sharedObjects = hmeGraphIntersect(from?.objectContinuity || [], to?.objectContinuity || [], 4);
            const sharedPlaces = hmeGraphIntersect(from?.placeContinuity || [], to?.placeContinuity || [], 4);
            const turnGap = Number(from?.turn || 0) > 0 && Number(to?.turn || 0) > 0 ? Math.abs(Number(from.turn) - Number(to.turn)) : Infinity;
            const turnSignal = Number.isFinite(turnGap) && turnGap <= 6 ? Math.max(0, 1 - (turnGap / 7)) : 0;
            const genericTopicPenalty = hmeGraphIntersect(from?.topics || [], to?.topics || [], 8).filter(isHmeGraphGenericTopic).length > 0 && sharedTopics.length === 0 ? 0.12 : 0;
            const stalePenalty = (from?.stale || to?.stale ? 0.08 : 0)
                + (String(from?.rollbackState || '') === 'superseded' || String(to?.rollbackState || '') === 'superseded' ? 0.16 : 0);
            const protagonistOnlyPenalty = entityOverlap.commonOnly && !sharedTopics.length && !sharedArc.length && !sharedOpenThreads.length && !sharedConflict.length && !sharedRelationDelta.length ? 0.20 : 0;
            const entityScore = entityOverlap.score;
            const specificTopicScore = Math.min(1, (sharedTopics.length * 0.22) + (sharedObjects.length * 0.18) + (sharedPlaces.length * 0.18) + (sharedWorldRules.length * 0.22));
            const arcScore = sharedArc.length ? 1 : ((from?.arcRole && to?.arcRole && from.arcRole === to.arcRole && (sharedConflict.length || sharedOpenThreads.length)) ? 0.35 : 0);
            const threadScore = Math.min(1, (sharedOpenThreads.length * 0.42) + (sharedThreadTags.length * 0.16));
            const conflictScore = Math.min(1, sharedConflict.length * 0.70);
            const relationDeltaScore = Math.min(1, (sharedRelationDelta.length * 0.82) + (sharedRelationSignals.length * 0.40));
            const worldScore = Math.min(1, (sharedWorldSignature.length * 0.70) + (sharedWorldRules.length * 0.45));
            const causalPair = [
                `${String(from?.causalRole || '').toLowerCase()}->${String(to?.causalRole || '').toLowerCase()}`,
                `${String(to?.causalRole || '').toLowerCase()}->${String(from?.causalRole || '').toLowerCase()}`
            ].some(value => /(?:cause|trigger|setup|origin)->(?:result|aftermath|resolution|resolved|consequence)/i.test(value));
            const causalScore = causalPair && (sharedArc.length || sharedConflict.length || sharedOpenThreads.length) && turnSignal > 0 ? 0.85 : 0;
            const rawScore = (entityScore * 0.25)
                + (specificTopicScore * 0.15)
                + (Math.max(arcScore, conflictScore, causalScore) * 0.20)
                + (threadScore * 0.20)
                + (Math.max(relationDeltaScore, worldScore) * 0.15)
                + (turnSignal * 0.05);
            const rawFinalScore = Math.max(0, Math.min(1, rawScore - genericTopicPenalty - protagonistOnlyPenalty - stalePenalty));
            const weakSignalFloor = (sharedEntities.length || sharedRefs.length || sharedThreadTags.length || turnSignal > 0)
                ? HME_GRAPH_SIGNAL_THRESHOLD
                : 0;
            const score = Math.max(rawFinalScore, weakSignalFloor);
            if (score < HME_GRAPH_SIGNAL_THRESHOLD) {
                return {
                    weight: 0,
                    score: rawFinalScore,
                    layer: 'none',
                    relation: 'below_threshold',
                    evidence: [],
                    penalties: ['below_signal_threshold'],
                    explanation: 'No graph edge: combined meaning/signal score below threshold.'
                };
            }
            let relation = 'associated_with';
            if (worldScore >= 0.70) relation = [from, to].some(node => /contradict|contradiction|충돌|모순|위반|반박/i.test([...(node.worldChanges || []), ...(node.worldRuleHighlights || [])].join(' '))) ? 'world_rule_contradicts' : 'world_rule_reinforces';
            else if (sharedRelationDelta.length || sharedRelationSignals.length) relation = 'relation_delta';
            else if (causalScore > 0) relation = 'causal_followup';
            else if (sharedConflict.length) relation = 'same_primary_conflict';
            else if (sharedArc.length) relation = 'same_arc';
            else if (sharedOpenThreads.length) relation = /resolved|closed|해소|종결|완료/i.test([...(from.openThreads || []), ...(to.openThreads || [])].join(' ')) ? 'resolves_thread' : 'continues_thread';
            else if (sharedObjects.length) relation = 'same_object_continuity';
            else if (sharedPlaces.length) relation = 'same_place_continuity';
            else if (sharedThreadTags.length) relation = 'same_thread';
            else if (sharedRefs.length) relation = 'same_source_ref';
            else if (sharedEntities.length) relation = 'shared_entity';
            else if (sharedTopics.length) relation = 'shared_topic';
            else if (turnSignal > 0) relation = 'turn_proximity';
            const strongEvidence = sharedArc.length || sharedConflict.length || sharedOpenThreads.length || sharedRelationDelta.length || sharedRelationSignals.length || sharedWorldSignature.length || sharedWorldRules.length || sharedObjects.length || sharedPlaces.length || causalScore > 0;
            const layer = score >= HME_GRAPH_MEANING_THRESHOLD && strongEvidence ? 'meaning' : 'signal';
            const weight = layer === 'meaning'
                ? score
                : Math.min(0.64, score * (relation === 'shared_entity' ? 0.72 : 0.86));
            const penalties = uniqLimit([
                ...(entityOverlap.commonOnly && sharedEntities.length ? ['penalty:common_entity_only'] : []),
                ...(genericTopicPenalty > 0 ? ['penalty:generic_topic_only'] : []),
                ...(protagonistOnlyPenalty > 0 ? ['penalty:protagonist_or_common_entity_only'] : []),
                ...(stalePenalty > 0 ? ['penalty:stale_or_superseded'] : [])
            ], 8);
            const evidence = uniqLimit([
                ...entityOverlap.evidence,
                ...sharedTopics.map(v => `topic:${v}`),
                ...sharedRefs.map(v => `source:${v}`),
                ...sharedThreadTags.map(v => `thread_tag:${v}`),
                ...sharedOpenThreads.map(v => `thread:${v}`),
                ...sharedArc.map(v => `arc:${v}`),
                ...sharedConflict.map(v => `conflict:${v}`),
                ...sharedRelationDelta.map(v => `relation_delta:${v}`),
                ...sharedWorldSignature.map(v => `world_signature:${v}`),
                ...sharedWorldRules.map(v => `world_rule:${v}`),
                ...sharedObjects.map(v => `object:${v}`),
                ...sharedPlaces.map(v => `place:${v}`),
                ...(turnSignal > 0 ? [`turn_gap:${turnGap}`] : [])
            ], 18);
            const explanation = [
                `${layer}:${relation}`,
                strongEvidence ? 'structured evidence present' : 'weak associative signal only',
                penalties.length ? penalties.join(',') : ''
            ].filter(Boolean).join(' | ');
            return {
                weight,
                score,
                layer,
                relation,
                confidence: Math.min(1, score + (layer === 'meaning' ? 0.08 : 0.02)),
                evidence,
                penalties,
                explanation,
                usedForRecall: false,
                components: {
                    entityScore: Number(entityScore.toFixed(4)),
                    specificTopicScore: Number(specificTopicScore.toFixed(4)),
                    arcScore: Number(Math.max(arcScore, conflictScore, causalScore).toFixed(4)),
                    threadScore: Number(threadScore.toFixed(4)),
                    relationDeltaScore: Number(Math.max(relationDeltaScore, worldScore).toFixed(4)),
                    turnProximityScore: Number(turnSignal.toFixed(4)),
                    genericTopicPenalty: Number(genericTopicPenalty.toFixed(4)),
                    protagonistOnlyPenalty: Number(protagonistOnlyPenalty.toFixed(4)),
                    stalePenalty: Number(stalePenalty.toFixed(4))
                }
            };
        };
        const buildHmeGraphBuckets = (nodes = []) => {
            const byRowId = {}, byEntity = {}, byTopic = {}, bySourceRef = {}, byThread = {}, bySourceTurn = {}, byArc = {}, byWorldSignature = {}, byRelationDelta = {}, byTurn = {};
            const add = (bucket, key, id) => {
                const normalized = normalizeHmeGraphToken(key);
                if (!normalized || !id) return;
                if (!bucket[normalized]) bucket[normalized] = [];
                if (!bucket[normalized].includes(id) && bucket[normalized].length < HME_GRAPH_BUCKET_LIMIT) bucket[normalized].push(id);
            };
            for (const node of nodes) {
                if (!node?.id || !node?.rowId) continue;
                byRowId[node.rowId] = node.id;
                if (!graphCanUseNode(node)) continue;
                (node.entities || []).forEach(value => add(byEntity, value, node.id));
                (node.topics || []).forEach(value => add(byTopic, value, node.id));
                (node.sourceRefs || []).forEach(value => add(bySourceRef, value, node.id));
                (node.narrativeTags || []).forEach(value => add(byThread, value, node.id));
                (node.sourceTurnIds || []).forEach(value => add(bySourceTurn, String(value), node.id));
                (node.openThreads || []).forEach(value => add(byThread, value, node.id));
                if (node.arcKey) add(byArc, node.arcKey, node.id);
                (node.worldSignature || []).forEach(value => add(byWorldSignature, value, node.id));
                (node.relationDelta || []).forEach(value => add(byRelationDelta, value, node.id));
                if (node.turn) add(byTurn, String(node.turn), node.id);
            }
            return { byRowId, byEntity, byTopic, bySourceRef, byThread, bySourceTurn, byArc, byWorldSignature, byRelationDelta, byTurn };
        };
        const buildHmeGraphEdgeBuckets = (edges = []) => {
            const byLayer = {}, byRelation = {};
            const add = (bucket, key, id) => {
                const normalized = String(key || '').trim() || 'unknown';
                if (!id) return;
                if (!bucket[normalized]) bucket[normalized] = [];
                if (!bucket[normalized].includes(id) && bucket[normalized].length < HME_GRAPH_BUCKET_LIMIT * 4) bucket[normalized].push(id);
            };
            for (const edge of Array.isArray(edges) ? edges : []) {
                if (!edge?.id) continue;
                add(byLayer, edge.layer || 'signal', edge.id);
                add(byRelation, edge.relation || 'associated_with', edge.id);
            }
            return { byLayer, byRelation };
        };
        const buildHmeGraphStats = (nodes = [], edges = [], staleEdgeCount = 0) => {
            const relationCounts = {};
            const layerCounts = {};
            for (const edge of Array.isArray(edges) ? edges : []) {
                const relation = String(edge?.relation || 'associated_with').trim();
                const layer = String(edge?.layer || 'signal').trim();
                relationCounts[relation] = (relationCounts[relation] || 0) + 1;
                layerCounts[layer] = (layerCounts[layer] || 0) + 1;
            }
            const nodeCount = Array.isArray(nodes) ? nodes.length : 0;
            const edgeCount = Array.isArray(edges) ? edges.length : 0;
            return {
                nodeCount,
                edgeCount,
                meaningEdgeCount: Number(layerCounts.meaning || 0),
                signalEdgeCount: Number(layerCounts.signal || 0),
                activeNodeCount: (Array.isArray(nodes) ? nodes : []).filter(graphCanUseNode).length,
                tombstoneNodeCount: (Array.isArray(nodes) ? nodes : []).filter(node => node.rollbackTombstone || normalizeHybridRollbackState(node.rollbackState || 'active') === 'candidate_deleted').length,
                staleEdgeCount: Number(staleEdgeCount || 0),
                relationCounts,
                layerCounts,
                averageDegree: nodeCount ? Number(((edgeCount * 2) / nodeCount).toFixed(4)) : 0,
                density: nodeCount > 1 ? Number((edgeCount / ((nodeCount * (nodeCount - 1)) / 2)).toFixed(6)) : 0
            };
        };
        const collectHmeGraphNeighbors = (node = null, buckets = {}) => {
            const out = new Set();
            const collect = (bucket, values = []) => {
                for (const value of values) {
                    const list = bucket?.[normalizeHmeGraphToken(value)];
                    if (Array.isArray(list)) list.forEach(id => { if (id && id !== node?.id) out.add(id); });
                    if (out.size >= HME_GRAPH_BUCKET_LIMIT) return;
                }
            };
            collect(buckets.byEntity, node?.entities || []);
            collect(buckets.bySourceRef, node?.sourceRefs || []);
            collect(buckets.byThread, node?.narrativeTags || []);
            collect(buckets.byThread, node?.openThreads || []);
            collect(buckets.byTopic, node?.specificTopics || node?.topics || []);
            collect(buckets.byArc, node?.arcKey ? [node.arcKey] : []);
            collect(buckets.byWorldSignature, node?.worldSignature || []);
            collect(buckets.byRelationDelta, node?.relationDelta || []);
            (node?.sourceTurnIds || []).forEach(turn => [-1, 0, 1].forEach(delta => collect(buckets.bySourceTurn, [String(Number(turn) + delta)])));
            return Array.from(out).slice(0, HME_GRAPH_BUCKET_LIMIT);
        };
        const buildHmeGraphIndexFromScopeIndex = (scopeIndex = null, options = {}) => {
            if (!scopeIndex || scopeIndex.schema !== HME_SCOPE_INDEX_SCHEMA) return null;
            const scopeKey = getHybridScopeKey(options.scopeKey || scopeIndex.scopeKey);
            const preset = getHmeGraphPreset();
            let nodes = hmeIndexRows(scopeIndex).map(buildHmeGraphNodeFromRow).filter(Boolean);
            nodes = compactHmeGraphNodes(nodes, preset);
            const nodeById = new Map(nodes.map(node => [node.id, node]));
            const buckets = buildHmeGraphBuckets(nodes);
            const entityDf = buildHmeGraphEntityDocumentFrequency(nodes);
            const edges = [];
            const seen = new Set();
            const adjacentByNode = {};
            const nodeVersionById = {};
            nodes.forEach(node => { nodeVersionById[node.id] = Number(node.version || 1); });
            for (const node of nodes) {
                if (!graphCanUseNode(node)) continue;
                const localEdges = [];
                for (const otherId of collectHmeGraphNeighbors(node, buckets)) {
                    const other = nodeById.get(otherId);
                    if (!other || !graphCanUseNode(other)) continue;
                    const pair = [node.id, other.id].sort().join('::');
                    if (seen.has(pair)) continue;
                    const signal = hmeGraphEdgeSignal(node, other, { entityDf });
                    const edgeWeightMin = signal.layer === 'signal'
                        ? Math.min(Number(preset.edgeWeightMin || 0), HME_GRAPH_SIGNAL_THRESHOLD * 0.72)
                        : Number(preset.edgeWeightMin || 0);
                    if (signal.weight < edgeWeightMin) continue;
                    localEdges.push({ other, pair, signal });
                }
                localEdges
                    .sort((a, b) => Number(b.signal.weight || 0) - Number(a.signal.weight || 0))
                    .slice(0, Math.min(HME_GRAPH_EDGE_LIMIT_PER_NODE, Math.max(0, Number(preset.maxEdges || 6000) - edges.length)))
                    .forEach(({ other, pair, signal }) => {
                        seen.add(pair);
                        if (edges.length >= Number(preset.maxEdges || 6000)) return;
                        const edge = {
                            id: `g_edge_${stableHash(pair)}`,
                            from: node.id,
                            to: other.id,
                            fromVersion: Number(node.version || 1),
                            toVersion: Number(other.version || 1),
                            layer: signal.layer || 'signal',
                            relation: signal.relation,
                            weight: Number(signal.weight.toFixed(4)),
                            confidence: Number(Math.min(1, signal.confidence || signal.weight + 0.08).toFixed(4)),
                            evidence: signal.evidence,
                            penalties: signal.penalties || [],
                            explanation: signal.explanation || '',
                            usedForRecall: false,
                            score: Number((signal.score || signal.weight || 0).toFixed(4)),
                            components: signal.components || {},
                            boundaryClass: 'public',
                            updatedAt: Date.now()
                        };
                        edges.push(edge);
                        if (!adjacentByNode[edge.from]) adjacentByNode[edge.from] = [];
                        if (!adjacentByNode[edge.to]) adjacentByNode[edge.to] = [];
                        adjacentByNode[edge.from].push(edge.id);
                        adjacentByNode[edge.to].push(edge.id);
                    });
            }
            const edgeBuckets = buildHmeGraphEdgeBuckets(edges);
            return {
                schema: HME_GRAPH_INDEX_SCHEMA,
                version: HME_GRAPH_INDEX_VERSION,
                source: {
                    derivedFrom: HME_SCOPE_INDEX_COMMENT,
                    hmeScopeIndexDigest: String(scopeIndex.digest || ''),
                    hmeScopeIndexSchema: HME_SCOPE_INDEX_SCHEMA,
                    rebuiltAt: Date.now()
                },
                scopeKey,
                scopeHash: getHybridScopeHash(scopeKey),
                updatedAt: Date.now(),
                stats: buildHmeGraphStats(nodes, edges, 0),
                nodes,
                edges,
                ...buckets,
                ...edgeBuckets,
                adjacentByNode,
                nodeVersionById,
                policy: {
                    rawRetention: 'signals_only',
                    authority: 'retrieval_hint_only',
                    meaningThreshold: HME_GRAPH_MEANING_THRESHOLD,
                    signalThreshold: HME_GRAPH_SIGNAL_THRESHOLD,
                    defaultInjection: 'merge_existing_sections',
                    maxSeeds: preset.maxSeeds,
                    maxCandidates: preset.maxCandidates,
                    maxNodes: preset.maxNodes,
                    maxEdges: preset.maxEdges,
                    maxHops: preset.maxHops,
                    bonusCap: preset.bonusCap
                }
            };
        };
        const rebuildHmeGraphRuntimeShape = (graph = null) => {
            if (!graph || !isHmeGraphIndexSchema(graph.schema) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
            Object.assign(graph, buildHmeGraphBuckets(graph.nodes || []));
            Object.assign(graph, buildHmeGraphEdgeBuckets(graph.edges || []));
            graph.adjacentByNode = {};
            graph.nodeVersionById = {};
            graph.nodes.forEach(node => {
                if (node?.id) graph.nodeVersionById[node.id] = Number(node.version || 1);
            });
            graph.edges.forEach(edge => {
                if (!edge?.id || !edge.from || !edge.to) return;
                if (!edge.layer) edge.layer = ['shared_entity', 'shared_topic', 'same_source_ref', 'turn_proximity', 'associated_with'].includes(String(edge.relation || '')) ? 'signal' : 'meaning';
                if (!Array.isArray(edge.penalties)) edge.penalties = [];
                if (!edge.explanation) edge.explanation = `${edge.layer || 'signal'}:${edge.relation || 'associated_with'}`;
                edge.usedForRecall = edge.usedForRecall === true;
                if (!graph.adjacentByNode[edge.from]) graph.adjacentByNode[edge.from] = [];
                if (!graph.adjacentByNode[edge.to]) graph.adjacentByNode[edge.to] = [];
                graph.adjacentByNode[edge.from].push(edge.id);
                graph.adjacentByNode[edge.to].push(edge.id);
            });
            graph.stats = {
                ...(graph.stats || {}),
                ...buildHmeGraphStats(graph.nodes || [], graph.edges || [], Number(graph.stats?.staleEdgeCount || 0)),
                lastStaleEdgeCount: Number(graph.stats?.lastStaleEdgeCount || graph.stats?.rebuiltFromStaleEdgeCount || 0),
                lastStaleEdgeRatio: Number(graph.stats?.lastStaleEdgeRatio || graph.stats?.rebuiltFromStaleEdgeRatio || 0)
            };
            return graph;
        };
        const ensureHmeGraphRuntimeShape = (graph = null) => {
            if (!graph || !isHmeGraphIndexSchema(graph.schema) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
            if (!graph.byRowId || !graph.adjacentByNode || !graph.nodeVersionById || !graph.byLayer || !graph.byRelation) return rebuildHmeGraphRuntimeShape(graph);
            return graph;
        };
        const isHmeGraphEdgeFresh = (edge = null, graph = null) => {
            if (!edge || !graph?.nodeVersionById) return false;
            const fromVersion = graph.nodeVersionById[edge.from];
            const toVersion = graph.nodeVersionById[edge.to];
            return fromVersion !== undefined
                && toVersion !== undefined
                && Number(fromVersion) === Number(edge.fromVersion)
                && Number(toVersion) === Number(edge.toVersion);
        };
        const analyzeHmeGraphStaleEdges = (graph = null) => {
            const runtimeGraph = ensureHmeGraphRuntimeShape(graph);
            const edges = hmeGraphEdges(runtimeGraph);
            let staleCount = 0;
            let missingNodeCount = 0;
            let versionMismatchCount = 0;
            let invalidEdgeCount = 0;
            for (const edge of edges) {
                if (!edge?.from || !edge?.to) {
                    staleCount += 1;
                    invalidEdgeCount += 1;
                    continue;
                }
                const fromVersion = runtimeGraph?.nodeVersionById?.[edge.from];
                const toVersion = runtimeGraph?.nodeVersionById?.[edge.to];
                if (fromVersion === undefined || toVersion === undefined) {
                    staleCount += 1;
                    missingNodeCount += 1;
                    continue;
                }
                if (Number(fromVersion) !== Number(edge.fromVersion) || Number(toVersion) !== Number(edge.toVersion)) {
                    staleCount += 1;
                    versionMismatchCount += 1;
                }
            }
            return {
                total: edges.length,
                staleCount,
                staleRatio: edges.length ? staleCount / edges.length : 0,
                missingNodeCount,
                versionMismatchCount,
                invalidEdgeCount
            };
        };
        const pruneStaleHmeGraphEdges = (graph = null, analysis = null) => {
            const runtimeGraph = ensureHmeGraphRuntimeShape(graph);
            if (!runtimeGraph) return { graph, changed: false, analysis: analysis || analyzeHmeGraphStaleEdges(graph) };
            const staleAnalysis = analysis || analyzeHmeGraphStaleEdges(runtimeGraph);
            if (!staleAnalysis.staleCount) {
                runtimeGraph.stats = { ...(runtimeGraph.stats || {}), staleEdgeCount: 0 };
                return { graph: runtimeGraph, changed: false, analysis: staleAnalysis };
            }
            const freshEdges = hmeGraphEdges(runtimeGraph).filter(edge => isHmeGraphEdgeFresh(edge, runtimeGraph));
            const now = Date.now();
            const pruned = {
                ...runtimeGraph,
                updatedAt: now,
                source: {
                    ...(runtimeGraph.source || {}),
                    staleEdgePrunedAt: now,
                    staleEdgePruneReason: 'stale_edge_policy'
                },
                stats: {
                    ...(runtimeGraph.stats || {}),
                    edgeCount: freshEdges.length,
                    staleEdgeCount: 0,
                    lastStaleEdgeCount: staleAnalysis.staleCount,
                    lastStaleEdgeRatio: Number(staleAnalysis.staleRatio.toFixed(4)),
                    staleEdgePrunedCount: Math.max(0, hmeGraphEdges(runtimeGraph).length - freshEdges.length)
                },
                edges: freshEdges
            };
            return { graph: rebuildHmeGraphRuntimeShape(pruned), changed: true, analysis: staleAnalysis };
        };
        const getHmeGraphStaleRebuildMap = () => {
            if (!MemoryState.hmeGraphStaleRebuildByScope || typeof MemoryState.hmeGraphStaleRebuildByScope.get !== 'function') {
                MemoryState.hmeGraphStaleRebuildByScope = new Map();
            }
            return MemoryState.hmeGraphStaleRebuildByScope;
        };
        const shouldRebuildHmeGraphForStaleEdges = (analysis = null, scopeKey = '') => {
            const policy = HME_GRAPH_STALE_EDGE_POLICY;
            if (!policy.enabled || !policy.rebuildEnabled) return false;
            if (!analysis || Number(analysis.total || 0) < policy.minEdges) return false;
            if (Number(analysis.staleRatio || 0) < policy.rebuildRatio) return false;
            const map = getHmeGraphStaleRebuildMap();
            const key = getHybridScopeHash(scopeKey);
            const last = map.get(key);
            const now = Date.now();
            if (last && Number(MemoryState.currentTurn || 0) > 0 && Number(last.turn || 0) === Number(MemoryState.currentTurn || 0)) return false;
            if (last && (now - Number(last.at || 0)) < policy.cooldownMs) return false;
            return true;
        };
        const markHmeGraphStaleRebuild = (scopeKey = '', analysis = null) => {
            const map = getHmeGraphStaleRebuildMap();
            map.set(getHybridScopeHash(scopeKey), {
                at: Date.now(),
                turn: MemoryState.currentTurn || 0,
                staleCount: Number(analysis?.staleCount || 0),
                staleRatio: Number(Number(analysis?.staleRatio || 0).toFixed(4))
            });
            while (map.size > 48) map.delete(map.keys().next().value);
        };
        const parseHmeGraphIndexEntry = (entry = null) => {
            if (!entry || String(entry?.comment || '').trim() !== HME_GRAPH_INDEX_COMMENT) return null;
            try { return ensureHmeGraphRuntimeShape(JSON.parse(String(entry.content || '{}'))); } catch (error) { if (CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA][HMEGraph] parse failed:', error?.message || error); return null; }
        };
        const findHmeGraphIndexInLore = (lorebook = [], scopeKey = '') => {
            const scope = getHybridScopeKey(scopeKey);
            const scopeHash = getHybridScopeHash(scope);
            const candidates = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])
                .filter(entry => String(entry?.comment || '').trim() === HME_GRAPH_INDEX_COMMENT)
                .map(parseHmeGraphIndexEntry)
                .filter(Boolean);
            return candidates
                .filter(graph => !scopeHash || String(graph.scopeHash || '') === scopeHash || String(graph.scopeKey || '') === scope)
                .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
        };
        const compactHmeGraphNodeForPersistence = (node = null) => {
            if (!node || typeof node !== 'object') return null;
            return {
                id: String(node.id || ''),
                rowId: String(node.rowId || ''),
                memoryKey: String(node.memoryKey || ''),
                turn: Number(node.turn || 0) || 0,
                version: Number(node.version || 1) || 1,
                importance: Number(node.importance || 0) || 0,
                confidence: Number(node.confidence || 0) || 0,
                kind: String(node.kind || ''),
                bucket: String(node.bucket || ''),
                arcKey: String(node.arcKey || ''),
                summary: String(node.summary || '').slice(0, 360),
                entities: compactHmeIndexArray(node.entities, 8),
                primaryEntities: compactHmeIndexArray(node.primaryEntities, 6),
                topics: compactHmeIndexArray(node.topics, 8),
                specificTopics: compactHmeIndexArray(node.specificTopics, 8),
                narrativeTags: compactHmeIndexArray(node.narrativeTags, 6),
                relationDelta: compactHmeIndexArray(node.relationDelta, 6),
                worldSignature: compactHmeIndexArray(node.worldSignature, 6),
                openThreads: compactHmeIndexArray(node.openThreads, 6),
                sourceRefs: compactHmeIndexArray(node.sourceRefs, 6),
                sourceTurnIds: compactHmeIndexArray(node.sourceTurnIds, 6)
            };
        };
        const compactHmeGraphEdgeForPersistence = (edge = null) => {
            if (!edge || typeof edge !== 'object') return null;
            return {
                id: String(edge.id || ''),
                from: String(edge.from || ''),
                to: String(edge.to || ''),
                fromVersion: Number(edge.fromVersion || 0) || 0,
                toVersion: Number(edge.toVersion || 0) || 0,
                layer: String(edge.layer || ''),
                relation: String(edge.relation || ''),
                weight: Number(Number(edge.weight || 0).toFixed(4)),
                confidence: Number(Number(edge.confidence || 0).toFixed(4)),
                score: Number(Number(edge.score || edge.weight || 0).toFixed(4)),
                evidence: compactHmeIndexArray(edge.evidence, 4),
                penalties: compactHmeIndexArray(edge.penalties, 3),
                explanation: String(edge.explanation || '').slice(0, 180),
                usedForRecall: edge.usedForRecall === true,
                updatedAt: Number(edge.updatedAt || 0) || 0
            };
        };
        const compactHmeGraphForPersistence = (graph = null) => {
            if (!graph || graph.schema !== HME_GRAPH_INDEX_SCHEMA) return graph;
            const preset = getHmeGraphPreset();
            const maxNodes = Math.max(64, Math.min(2400, Number(preset.maxNodes || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxNodes || 800) || 800));
            const maxEdges = Math.max(128, Math.min(4096, Number(preset.maxEdges || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxEdges || 1024) || 1024));
            const nodes = hmeGraphNodes(graph).slice(0, maxNodes).map(compactHmeGraphNodeForPersistence).filter(Boolean);
            const nodeIds = new Set(nodes.map(node => node.id).filter(Boolean));
            const edges = hmeGraphEdges(graph)
                .filter(edge => nodeIds.has(String(edge?.from || '')) && nodeIds.has(String(edge?.to || '')))
                .sort((a, b) => Number(b.weight || b.score || 0) - Number(a.weight || a.score || 0))
                .slice(0, maxEdges)
                .map(compactHmeGraphEdgeForPersistence)
                .filter(Boolean);
            return {
                schema: HME_GRAPH_INDEX_SCHEMA,
                version: HME_GRAPH_INDEX_VERSION,
                source: graph.source || {},
                scopeKey: graph.scopeKey || '',
                scopeHash: graph.scopeHash || getHybridScopeHash(graph.scopeKey || ''),
                updatedAt: graph.updatedAt || Date.now(),
                stats: buildHmeGraphStats(nodes, edges, Number(graph.stats?.staleEdgeCount || 0)),
                nodes,
                edges,
                policy: {
                    ...(graph.policy || {}),
                    persistedShape: 'compact_runtime_rebuild',
                    maxSeeds: preset.maxSeeds,
                    maxCandidates: preset.maxCandidates,
                    maxNodes: preset.maxNodes,
                    maxEdges: preset.maxEdges,
                    maxHops: preset.maxHops,
                    bonusCap: preset.bonusCap
                }
            };
        };
        const upsertHmeGraphIndexEntry = (entries = [], graph = null) => {
            if (!Array.isArray(entries) || !graph || graph.schema !== HME_GRAPH_INDEX_SCHEMA) return false;
            for (let i = entries.length - 1; i >= 0; i -= 1) {
                if (String(entries[i]?.comment || '').trim() === HME_GRAPH_INDEX_COMMENT) entries.splice(i, 1);
            }
            entries.push({
                key: hmeGraphEntryKey(graph.scopeKey),
                comment: HME_GRAPH_INDEX_COMMENT,
                content: JSON.stringify(compactHmeGraphForPersistence(graph)),
                mode: 'constant',
                insertorder: 3,
                alwaysActive: false
            });
            return true;
        };
        const cacheHmeGraphIndex = (graph = null, scopeKey = '') => {
            const runtimeGraph = ensureHmeGraphRuntimeShape(graph);
            if (!runtimeGraph) return;
            const scope = getHybridScopeKey(scopeKey || runtimeGraph.scopeKey);
            MemoryState.hmeGraphIndexByScope.set(scope, runtimeGraph);
            MemoryState.hmeGraphIndexByScope.set(`hash:${runtimeGraph.scopeHash || getHybridScopeHash(scope)}`, runtimeGraph);
            while (MemoryState.hmeGraphIndexByScope.size > 48) MemoryState.hmeGraphIndexByScope.delete(MemoryState.hmeGraphIndexByScope.keys().next().value);
        };
        const getCachedHmeGraphIndex = (scopeKey = '') => {
            const scope = getHybridScopeKey(scopeKey);
            return MemoryState.hmeGraphIndexByScope.get(scope)
                || MemoryState.hmeGraphIndexByScope.get(`hash:${getHybridScopeHash(scope)}`)
                || null;
        };
        const hmeGraphNeedsSemanticV2Rebuild = (graph = null) => !graph
            || String(graph.schema || '') !== HME_GRAPH_INDEX_SCHEMA
            || Number(graph.version || 0) < HME_GRAPH_INDEX_VERSION
            || !graph.byLayer
            || !graph.byRelation
            || !graph.stats?.layerCounts;
        const ensureHmeGraphIndex = (lorebook = [], options = {}) => {
            if (!isHmeGraphEnabled()) return { ok: false, reason: 'disabled' };
            if (!Array.isArray(lorebook)) return { ok: false, reason: 'invalid_lore' };
            const scopeKey = getHybridScopeKey(options.scopeKey);
            const entries = LibraLoreConsolidator.unpack(lorebook);
            const hmeIndex = options.scopeIndex || findHybridScopeIndexInLore(entries, scopeKey) || getCachedHybridScopeIndex(scopeKey);
            if (!hmeIndex) return { ok: false, reason: 'missing_hme_index' };
            const existing = options.force ? null : (findHmeGraphIndexInLore(entries, scopeKey) || getCachedHmeGraphIndex(scopeKey));
            if (existing && String(existing?.source?.hmeScopeIndexDigest || '') === String(hmeIndex.digest || '')) {
                const runtimeExisting = ensureHmeGraphRuntimeShape(existing);
                const staleAnalysis = analyzeHmeGraphStaleEdges(runtimeExisting);
                if (hmeGraphNeedsSemanticV2Rebuild(runtimeExisting)) {
                    const rebuilt = buildHmeGraphIndexFromScopeIndex(hmeIndex, { scopeKey });
                    if (rebuilt) {
                        rebuilt.source = {
                            ...(rebuilt.source || {}),
                            rebuildReason: 'semantic_graph_v2_schema',
                            previousSchema: String(runtimeExisting?.schema || ''),
                            previousVersion: Number(runtimeExisting?.version || 0) || 0,
                            previousEdgeCount: hmeGraphEdges(runtimeExisting).length
                        };
                        upsertHmeGraphIndexEntry(entries, rebuilt);
                        lorebook.length = 0;
                        lorebook.push(...entries);
                        cacheHmeGraphIndex(rebuilt, scopeKey);
                        return { ok: true, graph: rebuilt, changed: true, mode: 'rebuilt_for_semantic_graph_v2', staleEdgeAnalysis: staleAnalysis };
                    }
                }
                if (shouldRebuildHmeGraphForStaleEdges(staleAnalysis, scopeKey)) {
                    const rebuilt = buildHmeGraphIndexFromScopeIndex(hmeIndex, { scopeKey });
                    if (rebuilt) {
                        const ratio = Number(staleAnalysis.staleRatio.toFixed(4));
                        rebuilt.source = {
                            ...(rebuilt.source || {}),
                            rebuildReason: 'stale_edge_ratio',
                            previousUpdatedAt: Number(runtimeExisting?.updatedAt || 0) || 0,
                            previousEdgeCount: staleAnalysis.total,
                            previousStaleEdgeCount: staleAnalysis.staleCount,
                            previousStaleEdgeRatio: ratio
                        };
                        rebuilt.stats = {
                            ...(rebuilt.stats || {}),
                            staleEdgeCount: 0,
                            rebuiltFromStaleEdgeCount: staleAnalysis.staleCount,
                            rebuiltFromStaleEdgeRatio: ratio
                        };
                        upsertHmeGraphIndexEntry(entries, rebuilt);
                        lorebook.length = 0;
                        lorebook.push(...entries);
                        cacheHmeGraphIndex(rebuilt, scopeKey);
                        markHmeGraphStaleRebuild(scopeKey, staleAnalysis);
                        if (CONFIG.debug) recordRuntimeDebug('log', '[LIBRA][HMEGraph] rebuilt stale graph edges', { scopeHash: getHybridScopeHash(scopeKey), staleEdgeCount: staleAnalysis.staleCount, staleEdgeRatio: ratio });
                        return { ok: true, graph: rebuilt, changed: true, mode: 'rebuilt_for_stale_edges', staleEdgeAnalysis: staleAnalysis };
                    }
                }
                if (HME_GRAPH_STALE_EDGE_POLICY.enabled && HME_GRAPH_STALE_EDGE_POLICY.pruneEnabled && staleAnalysis.staleCount > 0) {
                    const pruned = pruneStaleHmeGraphEdges(runtimeExisting, staleAnalysis);
                    if (pruned.changed && pruned.graph) {
                        upsertHmeGraphIndexEntry(entries, pruned.graph);
                        lorebook.length = 0;
                        lorebook.push(...entries);
                        cacheHmeGraphIndex(pruned.graph, scopeKey);
                        if (CONFIG.debug) recordRuntimeDebug('log', '[LIBRA][HMEGraph] pruned stale graph edges', { scopeHash: getHybridScopeHash(scopeKey), staleEdgeCount: staleAnalysis.staleCount, staleEdgeRatio: Number(staleAnalysis.staleRatio.toFixed(4)) });
                        return { ok: true, graph: pruned.graph, changed: true, mode: 'pruned_stale_edges', staleEdgeAnalysis: staleAnalysis };
                    }
                }
                cacheHmeGraphIndex(runtimeExisting || existing, scopeKey);
                return { ok: true, graph: runtimeExisting || existing, changed: false, mode: 'reused', staleEdgeAnalysis: staleAnalysis };
            }
            const graph = buildHmeGraphIndexFromScopeIndex(hmeIndex, { scopeKey });
            if (!graph) return { ok: false, reason: 'graph_build_failed' };
            upsertHmeGraphIndexEntry(entries, graph);
            lorebook.length = 0;
            lorebook.push(...entries);
            cacheHmeGraphIndex(graph, scopeKey);
            return { ok: true, graph, changed: true, mode: 'rebuilt_from_hme_scope_index' };
        };
        const hydrateHmeGraphIndexFromLore = (lorebook = [], options = {}) => {
            if (!isHmeGraphEnabled()) return false;
            const graph = findHmeGraphIndexInLore(lorebook, getHybridScopeKey(options.scopeKey));
            if (!graph) return false;
            cacheHmeGraphIndex(graph, options.scopeKey);
            return true;
        };
        const getHmeGraphEntryBoost = (entry = null, graphContext = null) => {
            const key = String(getSafeKey(entry) || '').trim();
            return key ? graphContext?.boostByKey?.get?.(key) || null : null;
        };
        const expandHmeGraphRecallCandidates = (filteredEntries = [], allEntriesByKey = new Map(), options = {}) => {
            const preset = getHmeGraphPreset();
            if (!preset.enabled || preset.maxCandidates <= 0 || preset.maxSeeds <= 0) return { ok: false, reason: 'disabled' };
            const scopeKey = getHybridScopeKey(options.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '');
            let graph = getCachedHmeGraphIndex(scopeKey);
            if (!graph) {
                const scopeIndex = getCachedHybridScopeIndex(scopeKey);
                if (scopeIndex) {
                    graph = buildHmeGraphIndexFromScopeIndex(scopeIndex, { scopeKey });
                    cacheHmeGraphIndex(graph, scopeKey);
                }
            } else {
                const scopeIndex = getCachedHybridScopeIndex(scopeKey);
                const digestMismatch = scopeIndex && String(graph?.source?.hmeScopeIndexDigest || '') !== String(scopeIndex.digest || '');
                if (scopeIndex && (digestMismatch || hmeGraphNeedsSemanticV2Rebuild(graph))) {
                    const rebuilt = buildHmeGraphIndexFromScopeIndex(scopeIndex, { scopeKey });
                    if (rebuilt) {
                        rebuilt.source = {
                            ...(rebuilt.source || {}),
                            rebuildReason: digestMismatch ? 'scope_index_digest_runtime_recall' : 'semantic_graph_v2_runtime_recall',
                            previousSchema: String(graph?.schema || ''),
                            previousVersion: Number(graph?.version || 0) || 0,
                            previousScopeIndexDigest: String(graph?.source?.hmeScopeIndexDigest || '')
                        };
                        cacheHmeGraphIndex(rebuilt, scopeKey);
                        graph = rebuilt;
                    }
                }
            }
            graph = ensureHmeGraphRuntimeShape(graph);
            if (!graph) return { ok: false, reason: 'missing_graph' };
            const nodesById = new Map(hmeGraphNodes(graph).map(node => [node.id, node]));
            const edgesById = new Map(hmeGraphEdges(graph).map(edge => [edge.id, edge]));
            const seedKeys = uniqLimit((filteredEntries || []).map(entry => String(getSafeKey(entry) || '').trim()).filter(Boolean), Math.max(1, preset.maxSeeds));
            const existingKeys = new Set((filteredEntries || []).map(entry => String(getSafeKey(entry) || '').trim()).filter(Boolean));
            const directFocusNames = normalizeHmeEntityNameList(options.directFocusNames || options.focusNames || [], 24);
            const relatedFocusNames = normalizeHmeEntityNameList(options.relatedFocusNames || [], 32);
            const narrativeArcKeys = normalizeHmeGraphSpecificList(options.narrativeArcKeys || [], 12);
            const seedItemsByNodeId = new Map();
            const addSeed = (node = null, score = 0.5, reason = '', chain = []) => {
                if (!graphCanUseNode(node)) return;
                const prev = seedItemsByNodeId.get(node.id);
                const nextScore = Math.max(Number(prev?.score || 0), Number(score || 0));
                seedItemsByNodeId.set(node.id, {
                    node,
                    score: nextScore,
                    reason: reason || prev?.reason || 'seed',
                    chain: chain.length ? chain : (prev?.chain || [`seed:${node.rowId}`]),
                    focusSeed: Boolean(prev?.focusSeed || /^focus:/.test(reason || ''))
                });
            };
            seedKeys.forEach(rowId => addSeed(nodesById.get(graph.byRowId?.[rowId] || ''), 0.62, 'seed:filtered', [`seed:${rowId}`]));
            const addEntitySeeds = (names = [], score = 0.5, reasonPrefix = 'focus') => {
                for (const name of normalizeHmeEntityNameList(names, 48)) {
                    const normalized = normalizeHmeGraphToken(name);
                    const list = graph.byEntity?.[normalized];
                    if (!Array.isArray(list)) continue;
                    list
                        .map(nodeId => nodesById.get(nodeId))
                        .filter(graphCanUseNode)
                        .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0) || Number(b.turn || 0) - Number(a.turn || 0))
                        .slice(0, 8)
                        .forEach(node => {
                            const recencyBoost = Math.min(0.16, Math.max(0, Number(node.turn || 0)) * 0.004);
                            addSeed(node, score + (Number(node.importance || 0) * 0.18) + recencyBoost, `${reasonPrefix}:${name}`, [`focus:${name}`, `seed:${node.rowId}`]);
                        });
                }
            };
            const addArcSeeds = (arcKeys = [], score = 0.48) => {
                for (const arcKey of arcKeys) {
                    const normalized = normalizeHmeGraphToken(arcKey);
                    const list = graph.byArc?.[normalized];
                    if (!Array.isArray(list)) continue;
                    list
                        .map(nodeId => nodesById.get(nodeId))
                        .filter(graphCanUseNode)
                        .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0) || Number(b.turn || 0) - Number(a.turn || 0))
                        .slice(0, 6)
                        .forEach(node => addSeed(node, score + (Number(node.importance || 0) * 0.14), `focus:arc:${arcKey}`, [`arc:${arcKey}`, `seed:${node.rowId}`]));
                }
            };
            addEntitySeeds(directFocusNames, 0.74, 'focus:direct-entity');
            addEntitySeeds(relatedFocusNames, 0.50, 'focus:related-entity');
            addArcSeeds(narrativeArcKeys, 0.48);
            const seedItems = Array.from(seedItemsByNodeId.values())
                .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.node?.turn || 0) - Number(a.node?.turn || 0))
                .slice(0, preset.maxSeeds);
            const seeds = seedItems.map(item => item.node).filter(graphCanUseNode);
            if (!seeds.length) return { ok: false, reason: 'empty_seeds' };
            const candidatesByKey = new Map();
            const traces = [];
            const push = (node, score, reason, chain = [], edgeMeta = null) => {
                if (!graphCanUseNode(node)) return;
                const rowId = String(node.rowId || '').trim();
                if (!rowId || !allEntriesByKey.has(rowId)) return;
                const boost = Math.min(preset.bonusCap, Math.max(0, Number(score || 0)));
                if (boost <= 0) return;
                const prev = candidatesByKey.get(rowId);
                candidatesByKey.set(rowId, {
                    rowId,
                    nodeId: node.id,
                    boost: Math.max(prev?.boost || 0, boost),
                    graphOnly: !existingKeys.has(rowId),
                    reasons: uniqLimit([...(prev?.reasons || []), reason].filter(Boolean), 8),
                    edgeChain: chain.length ? chain : (prev?.edgeChain || []),
                    edgeLayer: edgeMeta?.layer || prev?.edgeLayer || '',
                    relation: edgeMeta?.relation || prev?.relation || '',
                    confidence: Math.max(Number(prev?.confidence || 0), Number(edgeMeta?.confidence || 0)),
                    graphReason: edgeMeta?.explanation || prev?.graphReason || ''
                });
                if (traces.length < 12) traces.push({
                    rowId,
                    nodeId: node.id,
                    boost: Number(boost.toFixed(4)),
                    reason,
                    edgeChain: chain,
                    viaGraph: true,
                    usedForRecall: true,
                    edgeLayer: edgeMeta?.layer || '',
                    relation: edgeMeta?.relation || '',
                    confidence: Number(Number(edgeMeta?.confidence || 0).toFixed(4)),
                    penalties: edgeMeta?.penalties || [],
                    explanation: edgeMeta?.explanation || ''
                });
            };
            for (const seedItem of seedItems) {
                const seed = seedItem.node;
                if (seedItem.focusSeed) {
                    push(seed, Math.min(preset.bonusCap, Math.max(0.06, Number(seedItem.score || 0) * 0.18)), seedItem.reason || 'focus:seed', seedItem.chain || [`seed:${seed.rowId}`], {
                        layer: 'focus',
                        relation: 'focus_entity_seed',
                        confidence: Math.min(1, Math.max(0.35, Number(seedItem.score || 0))),
                        penalties: [],
                        explanation: 'focus-seeded graph recall'
                    });
                }
                const frontier = [{ node: seed, score: Math.max(0.25, Number(seedItem.score || seed.importance || 0.5)), hop: 0, chain: seedItem.chain || [`seed:${seed.rowId}`] }];
                const visited = new Set([seed.id]);
                while (frontier.length) {
                    const item = frontier.shift();
                    if (!item || item.hop >= Math.max(1, preset.maxHops)) continue;
                    const adjacentEdges = (graph.adjacentByNode?.[item.node.id] || [])
                        .map(edgeId => edgesById.get(edgeId))
                        .filter(Boolean)
                        .sort((a, b) => {
                            const layerDelta = (a.layer === 'meaning' ? 1 : 0) - (b.layer === 'meaning' ? 1 : 0);
                            if (layerDelta) return -layerDelta;
                            return Number(b.weight || 0) - Number(a.weight || 0);
                        });
                    for (const edge of adjacentEdges) {
                        if (!isHmeGraphEdgeFresh(edge, graph)) continue;
                        const nextId = edge.from === item.node.id ? edge.to : edge.from;
                        const nextNode = nodesById.get(nextId);
                        if (!nextNode || visited.has(nextNode.id) || !graphCanUseNode(nextNode)) continue;
                        visited.add(nextNode.id);
                        const hop = item.hop + 1;
                        const layer = String(edge.layer || 'signal');
                        const spreadFactor = layer === 'meaning'
                            ? (hop === 1 ? 0.52 : 0.34)
                            : (hop === 1 ? 0.18 : 0.10);
                        const spread = item.score * Number(edge.weight || 0) * spreadFactor;
                        const reason = `graph:${layer}:${edge.relation}:${(edge.evidence || []).slice(0, 3).join(',')}`;
                        const chain = [...item.chain, `${layer}:${edge.relation}:${nextNode.rowId}`].slice(-5);
                        const edgeMeta = {
                            layer,
                            relation: edge.relation || '',
                            confidence: edge.confidence || 0,
                            penalties: edge.penalties || [],
                            explanation: edge.explanation || ''
                        };
                        push(nextNode, spread, reason, chain, edgeMeta);
                        if (hop < preset.maxHops && preset.maxHops > 1 && layer === 'meaning') frontier.push({ node: nextNode, score: spread, hop, chain });
                    }
                }
            }
            const graphCandidates = Array.from(candidatesByKey.values()).sort((a, b) => Number(b.boost || 0) - Number(a.boost || 0)).slice(0, preset.maxCandidates);
            const boostByKey = new Map(graphCandidates.map(candidate => [candidate.rowId, candidate]));
            const maxGraphAdditions = Math.max(0, Math.min(Number(preset.maxAdditions || 0) || 0, preset.maxCandidates || 0));
            const graphAdditions = graphCandidates.filter(candidate => candidate.graphOnly).slice(0, maxGraphAdditions);
            const merged = [...filteredEntries];
            for (const candidate of graphAdditions) {
                if (!existingKeys.has(candidate.rowId)) {
                    const entry = allEntriesByKey.get(candidate.rowId);
                    if (entry) {
                        merged.push(entry);
                        existingKeys.add(candidate.rowId);
                    }
                }
            }
            return {
                ok: true,
                entries: merged,
                boostByKey,
                debug: {
                    enabled: true,
                    schema: HME_GRAPH_INDEX_SCHEMA,
                    version: HME_GRAPH_INDEX_VERSION,
                    mode: preset.mode,
                    scopeHash: graph.scopeHash || '',
                    nodeCount: graph.stats?.nodeCount || hmeGraphNodes(graph).length,
                    edgeCount: graph.stats?.edgeCount || hmeGraphEdges(graph).length,
                    meaningEdgeCount: Number(graph.stats?.meaningEdgeCount || 0),
                    signalEdgeCount: Number(graph.stats?.signalEdgeCount || 0),
                    staleEdgeCount: Number(graph.stats?.staleEdgeCount || 0),
                    lastStaleEdgeCount: Number(graph.stats?.lastStaleEdgeCount || graph.stats?.rebuiltFromStaleEdgeCount || 0),
                    relationCounts: graph.stats?.relationCounts || {},
                    layerCounts: graph.stats?.layerCounts || {},
                    seedCount: seeds.length,
                    candidateCount: graphCandidates.length,
                    addedCandidates: graphAdditions.length,
                    bonusCap: preset.bonusCap,
                    graphOnlyMaxScore: HME_GRAPH_ONLY_MAX_SCORE,
                    focusSeedCount: seedItems.filter(item => item.focusSeed).length,
                    directFocusNames,
                    relatedFocusNames,
                    narrativeArcKeys,
                    traces
                }
            };
        };

        const buildHybridScopeIndexRow = (entry = null, index = 0, currentTurn = 0) => {
            if (!entry || String(entry?.comment || '') !== 'lmai_memory') return null;
            try {
                const contentHash = String(getEntryContentHash(entry));
                const meta = getCachedMeta(entry) || {};
                const payload = getRecallPayload(entry) || CompactMemoryCodec.parsePayloadFromEntry(entry) || {};
                const text = CompactMemoryCodec.buildSearchTextFromEntry(entry);
                if (!text || Utils.shouldExcludeStoredMemoryContent(text)) return null;
                const row = buildHybridMemoryRow(entry, index, currentTurn) || {};
                let recallHints = meta?.recallHints && typeof meta.recallHints === 'object' ? meta.recallHints : null;
                if (!recallHints) {
                    try { recallHints = StrengthenedJaccardCore.buildRecallHints(text, { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 }); }
                    catch (_) { recallHints = {}; }
                }
                const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
                const ledgerProjection = getLedgerProjectionParts(payload);
                const subjects = normalizeHmeEntityNameList([
                    ...(row.subjects || []),
                    ...(row.aliases || []),
                    ...(isLedger ? ledgerProjection.entities : [
                        ...asHybridArray(payload?.mentionedEntityNames),
                        ...asHybridArray(meta?.ent),
                        ...asHybridArray(meta?.entities)
                    ])
                ], 32);
                const aliases = normalizeHmeEntityNameList([
                    ...(row.aliases || []),
                    ...(row.subjects || []),
                    ...subjects
                ], 32);
                const tags = compactHmeIndexArray([
                    ...(row.tags || []),
                    ...(isLedger ? ledgerProjection.tags : [
                        ...asHybridArray(payload?.tags),
                        payload?.arcKey,
                        payload?.arcRole,
                        payload?.causalRole
                    ]),
                    ...asHybridArray(meta?.tags)
                ], 24);
                const sceneTags = compactHmeIndexArray(row.sceneTags || [], 12);
                const emotionTags = compactHmeIndexArray(row.emotionTags || [], 12);
                const relationTags = compactHmeIndexArray(row.relationTags || [], 12);
                const worldTags = compactHmeIndexArray(row.worldTags || [], 12);
                const narrativeTags = compactHmeIndexArray(row.narrativeTags || [], 12);
                const graphSignals = buildHmeGraphRowSignals(payload, meta, {
                    ...row,
                    subjects,
                    aliases,
                    tags,
                    sceneTags,
                    emotionTags,
                    relationTags,
                    worldTags,
                    narrativeTags
                }, recallHints, ledgerProjection);
                const hintTokens = [
                    ...asHybridArray(recallHints?.tokens),
                    ...asHybridArray(recallHints?.names),
                    ...asHybridArray(recallHints?.numbers),
                    ...asHybridArray(recallHints?.quotes).flatMap(v => TokenizerEngine.tokenize(v).slice(0, 4))
                ];
                const indexTerms = uniqLimit([
                    ...TokenizerEngine.tokenize(text).slice(0, 32),
                    ...hintTokens,
                    ...subjects,
                    ...tags,
                    ...sceneTags,
                    ...emotionTags,
                    ...relationTags,
                    ...worldTags,
                    ...narrativeTags,
                    row.primaryKind,
                    row.baseBucket
                ].flatMap(expandHmeIndexTerms).filter(Boolean), HME_SCOPE_INDEX_MAX_TERMS);
                const turn = normalizeLegacyMemoryTurnAnchor(meta?.t || payload?.turn || row.turn || 0) || 0;
                const ttl = Number(meta?.ttl);
                const primaryKind = String(row.primaryKind || payload?.hybridRow?.primaryKind || meta?.hme?.kind || 'memory').trim() || 'memory';
                const kinds = compactHmeIndexArray([...(row.kinds || []), primaryKind], 10);
                const baseBucket = String(row.baseBucket || payload?.hybridRow?.baseBucket || '').trim();
                return {
                    id: String(getSafeKey(entry) || row.id || contentHash).trim(),
                    contentHash,
                    idxKey: TokenizerEngine.getIndexKey(text),
                    turn,
                    ttl: Number.isFinite(ttl) ? ttl : 0,
                    entityAliasVersion: 2,
                    importance: Math.max(0, Math.min(1, Number(row.importance || meta?.imp / 10 || payload?.importance / 10 || 0.5))),
                    subjects,
                    aliases,
                    entityRoles: graphSignals.entityRoles,
                    tags,
                    sceneTags,
                    emotionTags,
                    relationTags,
                    worldTags,
                    narrativeTags,
                    primaryKind,
                    kinds,
                    baseBucket,
                    worldDedicated: Boolean(row.worldDedicated),
                    sourceTurnIds: uniqLimit([turn, ...(row.sourceTurnIds || [])].map(Number).filter(v => Number.isFinite(v) && v > 0), 16),
                    rollbackState: normalizeHybridRollbackState(row.rollbackState || meta?.hme?.rollbackState || meta?.rollbackState || 'active'),
                    rollbackTombstone: Boolean(row.rollbackTombstone || meta?.rollbackTombstone || meta?.rollbackDeleted),
                    hiddenFromPrompt: Boolean(row.hiddenFromPrompt || meta?.hme?.hiddenFromPrompt || meta?.hiddenFromPrompt),
                    stale: Boolean(row.stale || meta?.hme?.stale || meta?.stale),
                    arcKey: graphSignals.arcKey || String(row.arcKey || payload?.arcKey || '').trim(),
                    arcRole: graphSignals.arcRole || String(row.arcRole || payload?.arcRole || '').trim(),
                    causalRole: graphSignals.causalRole || String(row.causalRole || payload?.causalRole || '').trim(),
                    primaryConflict: graphSignals.primaryConflict,
                    relationDelta: graphSignals.relationDelta,
                    openThreads: graphSignals.openThreads,
                    relationSignals: graphSignals.relationSignals,
                    worldChanges: graphSignals.worldChanges,
                    worldSignature: graphSignals.worldSignature,
                    worldRuleHighlights: graphSignals.worldRuleHighlights,
                    objectContinuity: graphSignals.objectContinuity,
                    placeContinuity: graphSignals.placeContinuity,
                    recallKeywords: graphSignals.recallKeywords,
                    summaryContinuity: graphSignals.summaryContinuity,
                    indexTerms
                };
            } catch (error) {
                if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA][HMEIndex] row build failed:', error?.message || error);
                return null;
            }
        };
        const isHybridScopeIndexRowGraphV2Ready = (row = null) => !!row
            && Number(row.entityAliasVersion || 0) >= 2
            && row.entityRoles && typeof row.entityRoles === 'object'
            && Array.isArray(row.entities || row.subjects)
            && (
                Array.isArray(row.openThreads)
                || Array.isArray(row.relationDelta)
                || Array.isArray(row.primaryConflict)
                || Array.isArray(row.worldSignature)
                || Array.isArray(row.recallKeywords)
                || String(row.arcKey || '').trim()
            );

        const rebuildHybridScopeIndexInverted = (rows = []) => {
            const inverted = { token: {}, subject: {}, kind: {}, bucket: {}, turnBucket: {} };
            const add = (bucket, key, id) => {
                const normalized = bucket === 'kind' || bucket === 'bucket'
                    ? String(key || '').trim()
                    : normalizeHmeIndexTerm(key);
                if (!normalized || !id || !inverted[bucket]) return;
                if (!inverted[bucket][normalized]) inverted[bucket][normalized] = [];
                if (!inverted[bucket][normalized].includes(id) && inverted[bucket][normalized].length < HME_SCOPE_INDEX_INVERTED_BUCKET_LIMIT) {
                    inverted[bucket][normalized].push(id);
                }
            };
            for (const row of Array.isArray(rows) ? rows : []) {
                const id = String(row?.id || '').trim();
                if (!id) continue;
                (row.subjects || []).forEach(term => add('subject', term, id));
                (row.aliases || []).forEach(term => add('subject', term, id));
                (row.indexTerms || []).slice(0, HME_SCOPE_INDEX_MAX_TERMS).forEach(term => add('token', term, id));
                (row.kinds || []).forEach(kind => add('kind', kind, id));
                add('kind', row.primaryKind || 'memory', id);
                add('bucket', row.baseBucket || 'memory', id);
                (row.narrativeTags || []).forEach(tag => {
                    const normalized = String(tag || '').toLowerCase();
                    if (['origin', 'transition', 'aftermath'].includes(normalized)) add('bucket', normalized, id);
                });
                const turn = normalizeLegacyMemoryTurnAnchor(row.turn || 0);
                if (turn) add('turnBucket', String(Math.floor(turn / 10) * 10), id);
            }
            return inverted;
        };

        const ensureHybridScopeIndexRuntimeShape = (index = null) => {
            if (!index || index.schema !== HME_SCOPE_INDEX_SCHEMA || !Array.isArray(index.rows)) return null;
            if (!index.inverted || typeof index.inverted !== 'object' || !index.inverted.token) {
                index.inverted = rebuildHybridScopeIndexInverted(index.rows);
            }
            return index;
        };

        const buildPersistedHybridScopeIndex = (index = null) => {
            if (!index || index.schema !== HME_SCOPE_INDEX_SCHEMA) return null;
            const persisted = { ...index };
            delete persisted.inverted;
            return persisted;
        };

        const buildHybridScopeIndexFromEntries = (entries = [], options = {}) => {
            const scopeKey = getHybridScopeKey(options.scopeKey);
            const currentTurn = Number(options.currentTurn || MemoryState.currentTurn || 0) || 0;
            const memoryEntries = (Array.isArray(entries) ? entries : []).filter(entry => String(entry?.comment || '') === 'lmai_memory');
            const rows = memoryEntries
                .map((entry, index) => buildHybridScopeIndexRow(entry, index, currentTurn))
                .filter(Boolean);
            const maxTurn = rows.reduce((max, row) => Math.max(max, normalizeLegacyMemoryTurnAnchor(row.turn || 0) || 0), 0);
            const digest = String(TokenizerEngine.simpleHash(rows.map(row => `${row.id}:${row.contentHash}:${row.rollbackState}:${row.stale ? 1 : 0}`).sort().join('|')));
            return {
                schema: HME_SCOPE_INDEX_SCHEMA,
                version: HME_SCOPE_INDEX_VERSION,
                engineVersion: HYBRID_MEMORY_ENGINE_POLICY.version,
                source: 'hybrid_write_path_scope_index',
                scopeKey,
                scopeHash: getHybridScopeHash(scopeKey),
                builtAt: Date.now(),
                updatedAt: Date.now(),
                rowCount: rows.length,
                sourceMemoryCount: memoryEntries.length,
                maxTurn,
                digest,
                rows,
                inverted: rebuildHybridScopeIndexInverted(rows),
                policy: {
                    maxTerms: HME_SCOPE_INDEX_MAX_TERMS,
                    preselectHardCap: HME_SCOPE_INDEX_PRESELECT_HARD_CAP,
                    rawRetention: 'signals_only'
                }
            };
        };

        const parseHybridScopeIndexEntry = (entry = null) => {
            if (!entry || String(entry?.comment || '').trim() !== HME_SCOPE_INDEX_COMMENT) return null;
            try {
                const parsed = JSON.parse(String(entry.content || '{}'));
                if (!parsed || parsed.schema !== HME_SCOPE_INDEX_SCHEMA || !Array.isArray(parsed.rows)) return null;
                return ensureHybridScopeIndexRuntimeShape(parsed);
            } catch (_) {
                return null;
            }
        };

        const findHybridScopeIndexInLore = (lorebook = [], scopeKey = '') => {
            const scope = getHybridScopeKey(scopeKey);
            const scopeHash = getHybridScopeHash(scope);
            const candidates = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])
                .filter(entry => String(entry?.comment || '').trim() === HME_SCOPE_INDEX_COMMENT)
                .map(parseHybridScopeIndexEntry)
                .filter(Boolean);
            if (!candidates.length) return null;
            return candidates
                .filter(index => !scopeHash || String(index.scopeHash || '') === scopeHash || String(index.scopeKey || '') === scope)
                .sort((a, b) => Number(b.updatedAt || b.builtAt || 0) - Number(a.updatedAt || a.builtAt || 0))[0] || null;
        };

        const upsertHybridScopeIndexEntry = (entries = [], index = null) => {
            if (!Array.isArray(entries) || !index || index.schema !== HME_SCOPE_INDEX_SCHEMA) return false;
            const persisted = buildPersistedHybridScopeIndex(index);
            if (!persisted) return false;
            for (let i = entries.length - 1; i >= 0; i -= 1) {
                if (String(entries[i]?.comment || '').trim() === HME_SCOPE_INDEX_COMMENT) entries.splice(i, 1);
            }
            entries.push({
                key: hmeIndexEntryKey(index.scopeKey),
                comment: HME_SCOPE_INDEX_COMMENT,
                content: JSON.stringify(persisted),
                mode: 'constant',
                insertorder: 2,
                alwaysActive: false
            });
            return true;
        };

        const cacheHybridScopeIndex = (index = null, scopeKey = '') => {
            const runtimeIndex = ensureHybridScopeIndexRuntimeShape(index);
            if (!runtimeIndex || runtimeIndex.schema !== HME_SCOPE_INDEX_SCHEMA) return;
            const scope = getHybridScopeKey(scopeKey || index.scopeKey);
            MemoryState.hmeScopeIndexByScope.set(scope, runtimeIndex);
            MemoryState.hmeScopeIndexByScope.set(`hash:${runtimeIndex.scopeHash || getHybridScopeHash(scope)}`, runtimeIndex);
            while (MemoryState.hmeScopeIndexByScope.size > 48) {
                const key = MemoryState.hmeScopeIndexByScope.keys().next().value;
                MemoryState.hmeScopeIndexByScope.delete(key);
            }
        };

        const getCachedHybridScopeIndex = (scopeKey = '') => {
            const scope = getHybridScopeKey(scopeKey);
            return MemoryState.hmeScopeIndexByScope.get(scope)
                || MemoryState.hmeScopeIndexByScope.get(`hash:${getHybridScopeHash(scope)}`)
                || null;
        };

        const hydrateHashIndexFromHybridScopeIndex = (index = null) => {
            const rows = hmeIndexRows(index);
            if (!rows.length) return false;
            MemoryState.hashIndex.clear();
            for (const row of rows) {
                if (!row?.id || row.idxKey === undefined || row.idxKey === null) continue;
                if (['candidate_deleted', 'superseded'].includes(normalizeHybridRollbackState(row.rollbackState || 'active')) || row.rollbackTombstone || row.hiddenFromPrompt || row.stale) continue;
                if (!MemoryState.hashIndex.has(row.idxKey)) MemoryState.hashIndex.set(row.idxKey, new Set());
                MemoryState.hashIndex.get(row.idxKey).add(String(row.id));
            }
            return true;
        };

        const reconcileHybridScopeIndexEntries = (entries = [], existingIndex = null, options = {}) => {
            if (!existingIndex || existingIndex.schema !== HME_SCOPE_INDEX_SCHEMA) {
                return { index: buildHybridScopeIndexFromEntries(entries, options), changed: true, mode: 'full_build' };
            }
            const scopeKey = getHybridScopeKey(options.scopeKey || existingIndex.scopeKey);
            const currentTurn = Number(options.currentTurn || MemoryState.currentTurn || 0) || 0;
            const memoryEntries = (Array.isArray(entries) ? entries : []).filter(entry => String(entry?.comment || '') === 'lmai_memory');
            const oldRows = new Map(hmeIndexRows(existingIndex).map(row => [String(row?.id || ''), row]).filter(([id]) => id));
            const rows = [];
            let changed = Number(existingIndex.sourceMemoryCount || existingIndex.rowCount || 0) !== memoryEntries.length;
            memoryEntries.forEach((entry, index) => {
                const id = String(getSafeKey(entry) || '').trim();
                const contentHash = String(getEntryContentHash(entry));
                const old = id ? oldRows.get(id) : null;
                if (old && String(old.contentHash || '') === contentHash && isHybridScopeIndexRowGraphV2Ready(old)) {
                    rows.push(old);
                    oldRows.delete(id);
                    return;
                }
                const row = buildHybridScopeIndexRow(entry, index, currentTurn);
                if (row) rows.push(row);
                changed = true;
                if (id) oldRows.delete(id);
            });
            if (oldRows.size > 0) changed = true;
            if (!changed) return { index: existingIndex, changed: false, mode: 'reused' };
            const maxTurn = rows.reduce((max, row) => Math.max(max, normalizeLegacyMemoryTurnAnchor(row.turn || 0) || 0), 0);
            const digest = String(TokenizerEngine.simpleHash(rows.map(row => `${row.id}:${row.contentHash}:${row.rollbackState}:${row.stale ? 1 : 0}`).sort().join('|')));
            return {
                changed: true,
                mode: 'incremental_reconcile',
                index: {
                    ...existingIndex,
                    schema: HME_SCOPE_INDEX_SCHEMA,
                    version: HME_SCOPE_INDEX_VERSION,
                    engineVersion: HYBRID_MEMORY_ENGINE_POLICY.version,
                    source: 'hybrid_write_path_scope_index',
                    scopeKey,
                    scopeHash: getHybridScopeHash(scopeKey),
                    updatedAt: Date.now(),
                    rowCount: rows.length,
                    sourceMemoryCount: memoryEntries.length,
                    maxTurn,
                    digest,
                    rows,
                    inverted: rebuildHybridScopeIndexInverted(rows),
                    policy: {
                        ...(existingIndex.policy || {}),
                        maxTerms: HME_SCOPE_INDEX_MAX_TERMS,
                        preselectHardCap: HME_SCOPE_INDEX_PRESELECT_HARD_CAP,
                        rawRetention: 'signals_only'
                    }
                }
            };
        };

        const ensureHybridScopeIndex = (lorebook = [], options = {}) => {
            if (CONFIG.hybridMemoryEngineEnabled === false || CONFIG.hybridScopeIndexEnabled === false) {
                return { ok: false, reason: 'disabled' };
            }
            if (!Array.isArray(lorebook)) return { ok: false, reason: 'invalid_lore' };
            const scopeKey = getHybridScopeKey(options.scopeKey);
            const entries = LibraLoreConsolidator.unpack(lorebook);
            const existing = options.force ? null : findHybridScopeIndexInLore(entries, scopeKey);
            const reconciled = reconcileHybridScopeIndexEntries(entries, existing, {
                scopeKey,
                currentTurn: options.currentTurn || MemoryState.currentTurn || 0
            });
            const index = reconciled.index;
            if (!index) return { ok: false, reason: 'index_build_failed' };
            if (reconciled.changed || !existing || options.force) {
                upsertHybridScopeIndexEntry(entries, index);
                lorebook.length = 0;
                lorebook.push(...entries);
            }
            cacheHybridScopeIndex(index, scopeKey);
            hydrateHashIndexFromHybridScopeIndex(index);
            let graphResult = null;
            try { graphResult = ensureHmeGraphIndex(lorebook, { scopeKey, scopeIndex: index, force: Boolean(reconciled.changed || !existing || options.force) }); } catch (error) { if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA][HMEGraph] ensure graph failed:', error?.message || error); }
            return {
                ok: true,
                index,
                changed: Boolean(reconciled.changed || !existing || options.force || graphResult?.changed),
                graphChanged: Boolean(graphResult?.changed),
                graphMode: graphResult?.mode || '',
                mode: reconciled.mode || 'unknown'
            };
        };

        const upsertHybridScopeIndexRows = (lorebook = [], changedEntries = [], options = {}) => {
            if (CONFIG.hybridMemoryEngineEnabled === false || CONFIG.hybridScopeIndexEnabled === false) {
                return { ok: false, reason: 'disabled' };
            }
            if (!Array.isArray(lorebook)) return { ok: false, reason: 'invalid_lore' };
            const entriesToUpsert = (Array.isArray(changedEntries) ? changedEntries : [changedEntries])
                .filter(entry => entry && String(entry?.comment || '') === 'lmai_memory');
            if (!entriesToUpsert.length) return { ok: false, reason: 'empty_entries' };
            const scopeKey = getHybridScopeKey(options.scopeKey);
            const entries = LibraLoreConsolidator.unpack(lorebook);
            let index = findHybridScopeIndexInLore(entries, scopeKey) || getCachedHybridScopeIndex(scopeKey);
            if (!index || !hmeIndexRows(index).length) {
                return ensureHybridScopeIndex(lorebook, { ...options, scopeKey, reason: options.reason || 'index-row-upsert-bootstrap' });
            }
            const rowsById = new Map(hmeIndexRows(index).map(row => [String(row?.id || ''), row]).filter(([id]) => id));
            let changed = false;
            entriesToUpsert.forEach((entry, idx) => {
                const row = buildHybridScopeIndexRow(entry, hmeIndexRows(index).length + idx, options.currentTurn || MemoryState.currentTurn || 0);
                if (!row?.id) return;
                const prev = rowsById.get(String(row.id));
                if (!prev || String(prev.contentHash || '') !== String(row.contentHash || '') || String(prev.rollbackState || '') !== String(row.rollbackState || '')) {
                    rowsById.set(String(row.id), row);
                    changed = true;
                }
            });
            if (!changed) {
                cacheHybridScopeIndex(index, scopeKey);
                hydrateHashIndexFromHybridScopeIndex(index);
                let graphResult = null;
                try { graphResult = ensureHmeGraphIndex(lorebook, { scopeKey, scopeIndex: index, force: false }); } catch (error) { if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA][HMEGraph] noop graph sync failed:', error?.message || error); }
                return {
                    ok: true,
                    index,
                    changed: Boolean(graphResult?.changed),
                    graphChanged: Boolean(graphResult?.changed),
                    graphMode: graphResult?.mode || '',
                    mode: graphResult?.changed ? 'row_upsert_noop_graph_maintenance' : 'row_upsert_noop'
                };
            }
            const rows = Array.from(rowsById.values())
                .filter(row => row && row.id)
                .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || String(a.id).localeCompare(String(b.id)));
            const maxTurn = rows.reduce((max, row) => Math.max(max, normalizeLegacyMemoryTurnAnchor(row.turn || 0) || 0), 0);
            const digest = String(TokenizerEngine.simpleHash(rows.map(row => `${row.id}:${row.contentHash}:${row.rollbackState}:${row.stale ? 1 : 0}`).sort().join('|')));
            index = {
                ...index,
                schema: HME_SCOPE_INDEX_SCHEMA,
                version: HME_SCOPE_INDEX_VERSION,
                engineVersion: HYBRID_MEMORY_ENGINE_POLICY.version,
                source: 'hybrid_write_path_scope_index',
                scopeKey,
                scopeHash: getHybridScopeHash(scopeKey),
                updatedAt: Date.now(),
                rowCount: rows.length,
                sourceMemoryCount: rows.length,
                maxTurn,
                digest,
                rows,
                inverted: rebuildHybridScopeIndexInverted(rows)
            };
            upsertHybridScopeIndexEntry(entries, index);
            lorebook.length = 0;
            lorebook.push(...entries);
            cacheHybridScopeIndex(index, scopeKey);
            hydrateHashIndexFromHybridScopeIndex(index);
            let graphResult = null;
            try { graphResult = ensureHmeGraphIndex(lorebook, { scopeKey, scopeIndex: index, force: true }); } catch (error) { if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA][HMEGraph] row upsert graph sync failed:', error?.message || error); }
            return { ok: true, index, changed: true, graphChanged: Boolean(graphResult?.changed), graphMode: graphResult?.mode || '', mode: 'row_upsert' };
        };

        const hydrateHybridScopeIndexFromLore = (lorebook = [], options = {}) => {
            if (CONFIG.hybridMemoryEngineEnabled === false || CONFIG.hybridScopeIndexEnabled === false) return false;
            const scopeKey = getHybridScopeKey(options.scopeKey);
            const index = findHybridScopeIndexInLore(lorebook, scopeKey);
            if (!index || !hmeIndexRows(index).length) return false;
            cacheHybridScopeIndex(index, scopeKey);
            try { hydrateHmeGraphIndexFromLore(lorebook, { scopeKey }); } catch (error) {
                recordSuppressedRuntimeError('hme.hydrate_graph_index_from_lore', error, { scopeKey });
            }
            return hydrateHashIndexFromHybridScopeIndex(index);
        };

        const queryHybridScopeIndex = (entries = [], options = {}) => {
            if (CONFIG.hybridMemoryEngineEnabled === false || CONFIG.hybridScopeIndexEnabled === false) {
                return { ok: false, reason: 'disabled' };
            }
            const sourceEntries = Array.isArray(entries) ? entries : [];
            if (!sourceEntries.length) return { ok: false, reason: 'empty_entries' };
            const scopeKey = getHybridScopeKey(options.scopeKey);
            let index = getCachedHybridScopeIndex(scopeKey);
            if (!index || !hmeIndexRows(index).length) return { ok: false, reason: 'missing_index' };
            if (Number(index.sourceMemoryCount || index.rowCount || 0) !== sourceEntries.length) {
                const reconciled = reconcileHybridScopeIndexEntries(sourceEntries, index, {
                    scopeKey,
                    currentTurn: options.currentTurn || MemoryState.currentTurn || 0
                });
                index = reconciled.index || index;
                cacheHybridScopeIndex(index, scopeKey);
            }
            const entryByKey = new Map(sourceEntries.map(entry => [String(getSafeKey(entry) || '').trim(), entry]).filter(([key]) => key));
            const rows = hmeIndexRows(index).filter(row => row?.id && entryByKey.has(String(row.id)));
            if (!rows.length) return { ok: false, reason: 'index_entries_not_found' };
            const currentTurn = Number(options.currentTurn || MemoryState.currentTurn || 0) || 0;
            const queryPlan = options.queryPlan || {};
            const recallIntent = options.recallIntent || {};
            const kindPlan = options.kindPlan || {};
            const raw = String(queryPlan.raw || options.query || '').trim();
            const directFocusNames = normalizeHmeEntityNameList(options.directFocusNames || options.focusNames || [], 24);
            const relatedFocusNames = normalizeHmeEntityNameList(options.relatedFocusNames || [], 24);
            const focusNames = normalizeHmeEntityNameList([
                ...directFocusNames,
                ...relatedFocusNames,
                ...(Array.isArray(options.focusNames) ? options.focusNames : [])
            ], 40);
            const focusKeySet = hmeEntityMatchKeys(focusNames);
            const queryTerms = new Set(uniqLimit([
                ...(Array.isArray(options.queryTokens) ? options.queryTokens : TokenizerEngine.tokenize(raw)),
                ...(queryPlan.strongAnchors || []),
                ...(queryPlan.exactAnchors || []),
                ...focusNames,
                ...(recallIntent.labels || [])
            ].flatMap(expandHmeIndexTerms).filter(Boolean), 96));
            const wantedKinds = uniqLimit([...(kindPlan.primaryKinds || []), ...(kindPlan.wants || []), ...(kindPlan.bundleOrder || [])].map(v => String(v || '').trim()).filter(Boolean), 24);
            const wantedBuckets = uniqLimit([
                ...(recallIntent.origin ? ['origin'] : []),
                ...(recallIntent.transition ? ['transition'] : []),
                ...(recallIntent.aftermath ? ['aftermath'] : []),
                ...(recallIntent.current ? ['current'] : []),
                ...(recallIntent.relationship ? ['relationship'] : []),
                ...(recallIntent.worldRule ? ['world'] : []),
                ...(kindPlan.preserveBuckets || [])
            ], 24);
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const candidateIds = new Set();
            const addIndexed = (bucket, key) => {
                const normalized = bucket === 'kind' || bucket === 'bucket'
                    ? String(key || '').trim()
                    : normalizeHmeIndexTerm(key);
                const list = index?.inverted?.[bucket]?.[normalized];
                if (Array.isArray(list)) list.forEach(id => candidateIds.add(String(id)));
            };
            queryTerms.forEach(term => {
                addIndexed('token', term);
                addIndexed('subject', term);
            });
            wantedKinds.forEach(kind => addIndexed('kind', kind));
            wantedBuckets.forEach(bucket => addIndexed('bucket', bucket));
            const focusSubjectHitByRowId = new Map();
            if (focusKeySet.size > 0) {
                rows.forEach(row => {
                    const hits = countHmeEntityFocusMatches(row, focusKeySet);
                    if (hits > 0) {
                        focusSubjectHitByRowId.set(String(row.id), hits);
                        candidateIds.add(String(row.id));
                    }
                });
            }
            const preselectLimit = Math.max(24, Math.min(
                HME_SCOPE_INDEX_PRESELECT_HARD_CAP,
                Number(options.preselectLimit || 0)
                    || Math.max(Number(options.topK || 10) * 3, 28)
            ));
            const fallbackRows = rows
                .filter(row => {
                    const rollbackState = normalizeHybridRollbackState(row.rollbackState || 'active');
                    return rollbackState !== 'candidate_deleted'
                        && rollbackState !== 'superseded'
                        && !row.rollbackTombstone
                        && !row.hiddenFromPrompt
                        && !row.stale;
                })
                .slice()
                .sort((a, b) => Number(b.turn || 0) - Number(a.turn || 0) || Number(b.importance || 0) - Number(a.importance || 0))
                .slice(0, 32);
            const fallbackSeedTarget = Math.max(12, Math.min(24, preselectLimit));
            fallbackRows.forEach((row, index) => {
                if (index < fallbackSeedTarget || candidateIds.size < fallbackSeedTarget) candidateIds.add(String(row.id));
            });
            const poolIds = new Set(Array.from(candidateIds).filter(Boolean));
            const pool = rows.filter(row => poolIds.has(String(row?.id || '')));
            const scored = pool.map(row => {
                const rollbackState = normalizeHybridRollbackState(row.rollbackState || 'active');
                if (rollbackState === 'candidate_deleted' || rollbackState === 'superseded' || row.rollbackTombstone || row.hiddenFromPrompt || row.stale) return null;
                const ttl = Number(row.ttl);
                const turn = Number(row.turn || 0);
                if (!(ttl === -1 || !Number.isFinite(ttl) || ttl <= 0 || (Number.isFinite(turn) && (turn + ttl) >= currentTurn))) return null;
                const rowTerms = new Set(Array.isArray(row.indexTerms) ? row.indexTerms : []);
                let tokenHits = 0;
                queryTerms.forEach(term => { if (rowTerms.has(term)) tokenHits += 1; });
                const subjectHits = (row.subjects || []).filter(subject => queryTerms.has(normalizeHmeIndexTerm(subject))).length;
                const focusSubjectHits = Number(focusSubjectHitByRowId.get(String(row.id)) || 0);
                const kindHits = wantedKinds.filter(kind => (row.kinds || []).includes(kind) || row.primaryKind === kind).length;
                const bucketHits = wantedBuckets.filter(bucket => row.baseBucket === bucket || (row.narrativeTags || []).map(v => String(v || '').toLowerCase()).includes(bucket)).length;
                const anchorHits = getExactAnchorHits(queryPlan.strongAnchors || [], [
                    ...(row.subjects || []),
                    ...(row.tags || []),
                    ...(row.sceneTags || []),
                    ...(row.emotionTags || []),
                    ...(row.relationTags || []),
                    ...(row.worldTags || []),
                    ...(row.narrativeTags || []),
                    ...(row.indexTerms || [])
                ].join(' '));
                const recency = calcRecency(row.turn || 0, currentTurn);
                const originCueProfile = strictOriginQuery ? getOriginSceneCueProfile(row.text || '', row.payload || {}) : { hits: [], strongHits: [], weakHits: [], totalCount: 0, strongCount: 0, weakCount: 0 };
                const originBucketSignal = strictOriginQuery && (
                    row.baseBucket === 'origin'
                    || row.arcRole === 'origin'
                    || row.causalRole === 'cause'
                    || (Array.isArray(row.narrativeTags) && row.narrativeTags.map(v => String(v || '').toLowerCase()).includes('origin'))
                ) ? 1 : 0;
                const originAgeBias = strictOriginQuery && originCueProfile.strongCount > 0 && Number.isFinite(currentTurn) && Number.isFinite(row.turn)
                    ? Math.min(0.9, Math.max(0, currentTurn - row.turn) * 0.015)
                    : 0;
                const score = (tokenHits * 0.9)
                    + (subjectHits * 2.6)
                    + (focusSubjectHits * 3.2)
                    + (kindHits * 2.0)
                    + (bucketHits * 1.8)
                    + (anchorHits.length * 4.0)
                    + (Number(row.importance || 0) * 1.2)
                    + (recency * 0.7)
                    + (strictOriginQuery ? ((originCueProfile.strongCount * 6.2) + (originCueProfile.weakCount * 1.4) + (originBucketSignal * 1.8) + originAgeBias) : 0);
                return { row, score, tokenHits, subjectHits, focusSubjectHits, kindHits, bucketHits, anchorHits, originCueProfile, originBucketSignal, originAgeBias };
            }).filter(Boolean)
                .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.row?.turn || 0) - Number(a.row?.turn || 0));
            const selectedRows = [];
            const selectedRowIds = new Set();
            const addSelectedRow = (item = null) => {
                const rowId = String(item?.row?.id || '').trim();
                if (!rowId || selectedRowIds.has(rowId) || selectedRows.length >= preselectLimit) return;
                selectedRowIds.add(rowId);
                selectedRows.push(item.row);
            };
            if (strictOriginQuery) {
                const seedLimit = Math.max(2, Math.min(6, Math.ceil(preselectLimit / 6)));
                scored
                    .filter(item => Number(item.originCueProfile?.strongCount || 0) > 0 || Number(item.originBucketSignal || 0) > 0)
                    .sort((a, b) => {
                        const strongCueDiff = Number(b.originCueProfile?.strongCount || 0) - Number(a.originCueProfile?.strongCount || 0);
                        if (strongCueDiff) return strongCueDiff;
                        const bucketDiff = Number(b.originBucketSignal || 0) - Number(a.originBucketSignal || 0);
                        if (bucketDiff) return bucketDiff;
                        const turnDiff = Number(a.row?.turn || 0) - Number(b.row?.turn || 0);
                        if (turnDiff) return turnDiff;
                        return Number(b.score || 0) - Number(a.score || 0);
                    })
                    .slice(0, seedLimit)
                    .forEach(addSelectedRow);
            }
            scored.forEach(addSelectedRow);
            const selectedEntries = selectedRows.map(row => entryByKey.get(String(row.id))).filter(Boolean);
            if (!selectedEntries.length) return { ok: false, reason: 'empty_selection' };
            return {
                ok: true,
                entries: selectedEntries,
                selectedKeys: new Set(selectedRows.map(row => String(row.id))),
                index,
                debug: {
                    enabled: true,
                    schema: HME_SCOPE_INDEX_SCHEMA,
                    version: HME_SCOPE_INDEX_VERSION,
                    scopeHash: index.scopeHash || '',
                    rowCount: rows.length,
                    sourceCandidates: sourceEntries.length,
                    poolRows: pool.length,
                    candidateIds: candidateIds.size,
                    selectedRows: selectedRows.length,
                    preselectLimit,
                    digest: index.digest || '',
                    mode: 'scope_index_preselect',
                    topRows: scored.slice(0, 8).map(item => ({
                        id: item.row.id,
                        kind: item.row.primaryKind,
                        turn: item.row.turn || 0,
                        score: Number((item.score || 0).toFixed(3)),
                        tokenHits: item.tokenHits,
                        subjectHits: item.subjectHits,
                        focusSubjectHits: item.focusSubjectHits,
                        kindHits: item.kindHits,
                        bucketHits: item.bucketHits,
                        anchorHits: item.anchorHits || [],
                        originCueStrong: Number(item.originCueProfile?.strongCount || 0),
                        originCueWeak: Number(item.originCueProfile?.weakCount || 0),
                        originBucketSignal: Number(item.originBucketSignal || 0)
                    }))
                }
            };
        };

        const getHybridScopeIndexStats = () => {
            const scopeKey = getHybridScopeKey();
            const index = getCachedHybridScopeIndex(scopeKey);
            return {
                enabled: CONFIG.hybridMemoryEngineEnabled !== false && CONFIG.hybridScopeIndexEnabled !== false,
                cachedScopes: MemoryState.hmeScopeIndexByScope.size,
                scopeHash: index?.scopeHash || '',
                rowCount: Number(index?.rowCount || 0),
                sourceMemoryCount: Number(index?.sourceMemoryCount || 0),
                maxTurn: Number(index?.maxTurn || 0),
                digest: index?.digest || ''
            };
        };

        const getHmeGraphIndexStats = () => {
            const scopeKey = getHybridScopeKey();
            const graph = getCachedHmeGraphIndex(scopeKey);
            return {
                enabled: isHmeGraphEnabled(),
                mode: normalizeHmeGraphMode(CONFIG.hmeAssociativeGraphMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode),
                cachedScopes: MemoryState.hmeGraphIndexByScope.size,
                scopeHash: graph?.scopeHash || '',
                nodeCount: Number(graph?.stats?.nodeCount || hmeGraphNodes(graph).length || 0),
                edgeCount: Number(graph?.stats?.edgeCount || hmeGraphEdges(graph).length || 0),
                meaningEdgeCount: Number(graph?.stats?.meaningEdgeCount || 0),
                signalEdgeCount: Number(graph?.stats?.signalEdgeCount || 0),
                staleEdgeCount: Number(graph?.stats?.staleEdgeCount || 0),
                lastStaleEdgeCount: Number(graph?.stats?.lastStaleEdgeCount || graph?.stats?.rebuiltFromStaleEdgeCount || 0),
                lastStaleEdgeRatio: Number(graph?.stats?.lastStaleEdgeRatio || graph?.stats?.rebuiltFromStaleEdgeRatio || 0),
                activeNodeCount: Number(graph?.stats?.activeNodeCount || 0),
                relationCounts: graph?.stats?.relationCounts || {},
                layerCounts: graph?.stats?.layerCounts || {},
                staleRebuildScopes: Number(MemoryState.hmeGraphStaleRebuildByScope?.size || 0),
                sourceDigest: String(graph?.source?.hmeScopeIndexDigest || '')
            };
        };

        const buildHybridWritePathMetadata = (payload = {}, meta = {}, searchText = '', currentTurn = 0, options = {}) => {
            const tempEntry = {
                key: '',
                comment: 'lmai_memory',
                content: `[META:${JSON.stringify(meta || {})}]\n${CompactMemoryCodec.serialize(payload || {})}\n`
            };
            let row = null;
            try { row = buildHybridMemoryRow(tempEntry, 0, currentTurn); } catch (_) { row = null; }
            const fallbackKindInfo = classifyHybridKinds(payload || {}, meta || {}, searchText || '', currentTurn);
            const sourceTurns = uniqLimit([
                currentTurn,
                meta?.t,
                meta?.turnAnchorTurn,
                payload?.turn,
                payload?.firstSeenTurn,
                ...(Array.isArray(options.sourceTurnIds) ? options.sourceTurnIds : [])
            ].map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0), 12);
            const kind = String(row?.primaryKind || fallbackKindInfo.primaryKind || 'memory').trim() || 'memory';
            const retrospectiveClass = CompactMemoryCodec.normalizeRetrospectiveClass(
                row?.retrospectiveClass || payload?.retrospectiveClass || meta?.hme?.retrospectiveClass || fallbackKindInfo.retrospectiveClass || ''
            );
            const recallProfile = String(row?.recallProfile || payload?.recallProfile || (retrospectiveClass ? 'continuity_only' : '')).trim();
            const ledgerProjection = getLedgerProjectionParts(payload);
            const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
            const compatSubjects = isLedger ? ledgerProjection.entities : [...asHybridArray(payload?.mentionedEntityNames), ...asHybridArray(meta?.ent)];
            const compatTags = isLedger ? ledgerProjection.tags : [...asHybridArray(payload?.tags), payload?.arcKey, payload?.arcRole, payload?.causalRole];
            return {
                schema: 'libra.hme.typed_row_meta.v1',
                version: 1,
                engineVersion: HYBRID_MEMORY_ENGINE_POLICY.version,
                source: 'write_path_adapter',
                kind,
                primaryKind: kind,
                kinds: uniqLimit([...(row?.kinds || []), ...(fallbackKindInfo.kinds || []), kind], 10),
                baseBucket: String(row?.baseBucket || (retrospectiveClass ? 'retrospective' : fallbackKindInfo.bucket) || '').trim(),
                subjects: uniqLimit([...(row?.subjects || []), ...compatSubjects, ...ledgerProjection.entities], 32),
                aliases: uniqLimit([...(row?.aliases || []), ...compatSubjects, ...ledgerProjection.entities], 32),
                tags: uniqLimit([...(row?.tags || []), ...compatTags, ...ledgerProjection.tags], 32),
                sceneTags: uniqLimit(row?.sceneTags || [], 16),
                emotionTags: uniqLimit(row?.emotionTags || [], 16),
                relationTags: uniqLimit(row?.relationTags || [], 16),
                worldTags: uniqLimit(row?.worldTags || [], 16),
                narrativeTags: uniqLimit(row?.narrativeTags || [], 16),
                retrospectiveClass,
                recallProfile,
                arcKey: String(row?.arcKey || payload?.arcKey || '').trim(),
                arcRole: String(row?.arcRole || payload?.arcRole || '').trim(),
                causalRole: String(row?.causalRole || payload?.causalRole || '').trim(),
                sourceTurnIds: sourceTurns,
                firstSeenTurn: Number(payload?.firstSeenTurn || sourceTurns[0] || currentTurn || 0) || 0,
                turn: Number(payload?.turn || meta?.t || currentTurn || 0) || 0,
                importance: Math.max(0, Math.min(1, Number(meta?.imp || payload?.importance || 5) / 10)),
                salience: Math.max(0, Math.min(1, Number(payload?.impression || 0.5) || 0.5)),
                confidence: 0.78,
                worldDedicated: Boolean(row?.worldDedicated || fallbackKindInfo.worldDedicated),
                stale: false,
                supersededBy: '',
                staleCandidateIds: uniqLimit(asHybridArray(options.staleCandidateIds), 8),
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
        };

        const duplicateTokenSet = (text = '') => new Set(TokenizerEngine.tokenize(String(text || '')).filter(token => token && token.length >= 2));
        const duplicateOverlapScore = (a = '', b = '') => {
            const A = duplicateTokenSet(a);
            const B = duplicateTokenSet(b);
            if (!A.size || !B.size) return 0;
            let inter = 0;
            for (const t of A) if (B.has(t)) inter += 1;
            return inter / Math.max(1, Math.min(A.size, B.size));
        };
        const scoreDuplicateCandidateFast = (existingContent = '', newContent = '') => {
            const a = String(existingContent || '').replace(/\s+/g, ' ').trim();
            const b = String(newContent || '').replace(/\s+/g, ' ').trim();
            if (!a || !b) return { score: 0, reject: true, accept: false, reason: 'empty' };
            if (a === b) return { score: 1, reject: false, accept: true, reason: 'exact' };
            const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length, 1);
            if (lenRatio < 0.34) return { score: 0, reject: true, accept: false, reason: 'length_mismatch' };
            const idxA = TokenizerEngine.getIndexKey(a);
            const idxB = TokenizerEngine.getIndexKey(b);
            const indexMatch = idxA && idxB && idxA === idxB;
            const overlap = duplicateOverlapScore(a, b);
            const anchorA = extractExactRecallAnchors(a);
            const anchorB = extractExactRecallAnchors(b);
            const anchorOverlap = anchorA.filter(x => anchorB.includes(x)).length;
            const score = Math.min(1, (overlap * 0.72) + (lenRatio * 0.14) + (indexMatch ? 0.10 : 0) + Math.min(0.18, anchorOverlap * 0.06));
            return {
                score,
                reject: score < 0.18 && !indexMatch,
                accept: score >= 0.92 || (indexMatch && score >= 0.82),
                reason: indexMatch ? 'index_match' : 'token_overlap',
                overlap,
                lenRatio,
                anchorOverlap
            };
        };
        const buildHybridRollbackTombstone = (criteria = {}, options = {}) => ({
            schema: 'libra.hme.rollback_tombstone.v1',
            state: 'candidate_deleted',
            reason: String(options?.reason || 'rollback-long-delete-candidate').trim() || 'rollback-long-delete-candidate',
            ts: Date.now(),
            fallbackId: String(options?.fallbackId || '').trim(),
            candidateTurns: asHybridArray(criteria.turns).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0).slice(0, 30),
            candidateHashes: asHybridArray(criteria.hashes).slice(0, 30),
            candidateTurnKeys: asHybridArray(criteria.turnKeys).slice(0, 30),
            candidateMessageIds: normalizeCanonicalMessageIds(criteria.ids || criteria.messageIds || []).slice(0, 30),
            mode: 'tombstone_preserve_row_audit'
        });

        const hybridMetaMatchesRollbackCriteria = (meta = {}, payload = {}, criteria = {}) => {
            const turns = new Set(asHybridArray(criteria.turns).map(v => normalizeLegacyMemoryTurnAnchor(v)).filter(Boolean));
            const hashes = new Set(asHybridArray(criteria.hashes).map(v => String(v || '').trim()).filter(Boolean));
            const turnKeys = new Set(asHybridArray(criteria.turnKeys).map(v => String(v || '').trim()).filter(Boolean));
            const ids = new Set(normalizeCanonicalMessageIds(criteria.ids || criteria.messageIds || []));
            const hme = payload?.hybridRow || payload?.hme || meta?.hme || {};
            const sourceTurns = [meta?.turn, meta?.t, meta?.finalizedTurn, meta?.turnAnchorTurn, payload?.turn, ...(asHybridArray(hme?.sourceTurnIds))]
                .map(normalizeLegacyMemoryTurnAnchor)
                .filter(Boolean);
            if (sourceTurns.some(turn => turns.has(turn))) return true;
            const sourceHashes = [meta?.sourceHash, meta?.aiHash, meta?.responseHash, payload?.sourceHash].map(v => String(v || '').trim()).filter(Boolean);
            if (sourceHashes.some(hash => hashes.has(hash))) return true;
            const entryTurnKey = String(meta?.turnKey || '').trim();
            if (entryTurnKey && turnKeys.has(entryTurnKey)) return true;
            const entryIds = normalizeCanonicalMessageIds([meta?.m_id, meta?.m_ids, meta?.messageId, meta?.sourceMessageIds, meta?.liveMessageIds, payload?.sourceMessageIds]);
            return entryIds.some(id => ids.has(id));
        };

        const markHybridRollbackTombstones = (lorebook = [], criteria = {}, options = {}) => {
            const result = { ok: true, tombstonedMemoryCount: 0, rowIds: [], affectedTurns: [], affectedKinds: {}, reason: String(options?.reason || 'rollback-long-delete-candidate').trim() || 'rollback-long-delete-candidate' };
            if (!Array.isArray(lorebook)) return result;
            const tombstone = buildHybridRollbackTombstone(criteria, options);
            for (const entry of lorebook) {
                if (!entry || String(entry.comment || '') !== 'lmai_memory') continue;
                const meta = getCachedMeta(entry) || {};
                let payload = getRecallPayload(entry) || CompactMemoryCodec.parsePayloadFromEntry(entry) || null;
                if (!payload || typeof payload !== 'object') continue;
                if (!hybridMetaMatchesRollbackCriteria(meta, payload, criteria)) continue;
                const text = CompactMemoryCodec.buildSearchTextFromEntry(entry);
                const existingHybrid = payload.hybridRow && typeof payload.hybridRow === 'object'
                    ? payload.hybridRow
                    : buildHybridWritePathMetadata(payload, meta, text, Number(meta?.t || payload?.turn || 0) || 0, { sourceTurnIds: [meta?.t || payload?.turn || 0] });
                const sourceTurnIds = uniqLimit([...(asHybridArray(existingHybrid.sourceTurnIds).map(v => Number(v)).filter(Boolean)), Number(meta?.t || payload?.turn || 0)].filter(Boolean), 16);
                const nextHybrid = {
                    ...existingHybrid,
                    sourceTurnIds,
                    rollbackState: 'candidate_deleted',
                    rollbackTombstone: tombstone,
                    rollbackHistory: [...(Array.isArray(existingHybrid.rollbackHistory) ? existingHybrid.rollbackHistory : []), tombstone].slice(-12),
                    hiddenFromPrompt: true,
                    stale: true,
                    staleReason: 'rollback_candidate_deleted'
                };
                if (CompactMemoryCodec.isLedgerPayload?.(payload)) {
                    payload = {
                        ...payload,
                        audit: {
                            ...(payload.audit && typeof payload.audit === 'object' ? payload.audit : {}),
                            rollbackState: 'candidate_deleted',
                            rollbackTombstone: tombstone,
                            stale: true,
                            staleReason: 'rollback_candidate_deleted',
                            cautions: dedupeTextArray([
                                ...asHybridArray(payload?.audit?.cautions),
                                'rollback_candidate_deleted'
                            ]).slice(0, 12)
                        }
                    };
                    meta.projection = {
                        ...(meta.projection && typeof meta.projection === 'object' ? meta.projection : {}),
                        rollbackState: 'candidate_deleted',
                        sourceTurnIds,
                        hiddenFromPrompt: true,
                        stale: true,
                        staleReason: 'rollback_candidate_deleted'
                    };
                } else {
                    payload = { ...payload, hybridRow: nextHybrid };
                    meta.hme = meta.hme && typeof meta.hme === 'object' ? meta.hme : {};
                    meta.hme = {
                        ...meta.hme,
                        schema: nextHybrid.schema || meta.hme.schema || 'libra.hme.typed_row_meta.v1',
                        engineVersion: nextHybrid.engineVersion || HYBRID_MEMORY_ENGINE_POLICY.version,
                        kind: nextHybrid.kind || nextHybrid.primaryKind || meta.hme.kind || 'memory',
                        kinds: nextHybrid.kinds || meta.hme.kinds || ['memory'],
                        sourceTurnIds,
                        rollbackState: 'candidate_deleted',
                        rollbackTombstone: tombstone,
                        hiddenFromPrompt: true,
                        stale: true,
                        staleReason: 'rollback_candidate_deleted'
                    };
                }
                meta.rollbackDirty = true;
                meta.needsReanalysis = true;
                meta.rollbackDeleted = true;
                meta.rollbackTombstone = tombstone;
                meta.rollbackDeleteCandidates = Array.isArray(meta.rollbackDeleteCandidates) ? meta.rollbackDeleteCandidates : [];
                meta.rollbackDeleteCandidates.push({ ...tombstone, kind: 'hybrid_memory_row' });
                meta.rollbackDeleteCandidates = meta.rollbackDeleteCandidates.slice(-12);
                entry.content = `[META:${JSON.stringify(meta)}]
${CompactMemoryCodec.serialize(payload)}
`;
                result.tombstonedMemoryCount += 1;
                result.rowIds.push(String(nextHybrid.id || getSafeKey(entry) || '').trim());
                sourceTurnIds.forEach(turn => { if (turn) result.affectedTurns.push(turn); });
                const kind = String(nextHybrid.kind || nextHybrid.primaryKind || 'memory').trim() || 'memory';
                result.affectedKinds[kind] = (result.affectedKinds[kind] || 0) + 1;
            }
            result.rowIds = uniqLimit(result.rowIds.filter(Boolean), 80);
            result.affectedTurns = uniqLimit(result.affectedTurns.map(Number).filter(Boolean), 80).sort((a, b) => a - b);
            safeClearMemoryCache('rollback_tombstone.meta_cache', getMetaCache, () => MemoryState.metaCache?.cache, {
                scopeKey: options?.scopeKey || '',
                turn: options?.currentTurn || 0
            });
            safeClearMemoryCache('rollback_tombstone.hybrid_row_cache', getHybridRowCache, () => MemoryState.hybridRowCache?.cache, {
                scopeKey: options?.scopeKey || '',
                turn: options?.currentTurn || 0
            });
            try { ensureHybridScopeIndex(lorebook, { scopeKey: options?.scopeKey, currentTurn: options?.currentTurn, force: true, reason: 'rollback-tombstone' }); } catch (error) {
                recordSuppressedRuntimeError('hme.rollback_tombstone.ensure_hybrid_scope_index', error, {
                    scopeKey: options?.scopeKey || '',
                    turn: options?.currentTurn || 0
                });
            }
            return result;
        };

        const findHybridStaleCandidates = (content = '', existingList = [], limit = 6) => {
            const ranked = [];
            const pool = Array.isArray(existingList) ? existingList.slice(-80) : [];
            for (const item of pool) {
                if (!item || String(item.comment || '') !== 'lmai_memory') continue;
                const existingContent = CompactMemoryCodec.buildSearchTextFromEntry(item);
                if (!existingContent) continue;
                const fast = scoreDuplicateCandidateFast(existingContent, content);
                if (fast.score >= 0.48 && fast.score < 0.92) {
                    ranked.push({ id: getSafeKey(item), score: fast.score, reason: fast.reason });
                }
            }
            return ranked.sort((a, b) => b.score - a.score).slice(0, Math.max(0, Number(limit || 0))).map(item => item.id).filter(Boolean);
        };

        const queryHasHybridEntity = (query = '', names = []) => {
            const q = normalizeHybridToken(query).replace(/\s+/g, '');
            return (Array.isArray(names) ? names : []).filter(name => {
                const n = normalizeHybridToken(name).replace(/\s+/g, '');
                return n && q.includes(n);
            }).slice(0, 8);
        };
        const isHybridWorldPrimary = (row = {}) => {
            const kinds = new Set(Array.isArray(row?.kinds) ? row.kinds : []);
            return row?.worldDedicated === true
                || String(row?.baseBucket || '').trim() === 'world'
                || (String(row?.primaryKind || '').trim() === 'world' && !kinds.has('relationship') && !kinds.has('narrative'));
        };
        const hybridKindMatchesIntent = (row = {}, recallIntent = {}, queryPlan = {}) => {
            const kinds = new Set(Array.isArray(row.kinds) ? row.kinds : []);
            const primary = String(row.primaryKind || 'memory');
            const matches = [];
            if ((recallIntent?.worldRule || (queryPlan.strongAnchors || []).some(a => /규칙|금지|세계관|시스템/.test(a))) && isHybridWorldPrimary(row)) matches.push('world');
            if ((recallIntent?.origin || recallIntent?.transition || recallIntent?.aftermath) && (kinds.has('narrative') || primary === 'narrative')) matches.push('narrative');
            if (recallIntent?.relationship && (kinds.has('relationship') || primary === 'relationship')) matches.push('relationship');
            if (recallIntent?.current && primary === 'memory') matches.push('memory');
            return matches;
        };
        const buildHybridKindPlan = (queryPlan = {}, recallIntent = {}) => {
            const raw = String(queryPlan.raw || '');
            const anchors = Array.isArray(queryPlan.strongAnchors) ? queryPlan.strongAnchors : [];
            const wants = new Set();
            const bundleOrder = [];
            const push = (kind) => { if (!kind || wants.has(kind)) return; wants.add(kind); bundleOrder.push(kind); };

            if (recallIntent?.worldRule || anchors.some(a => /규칙|금지|세계관|시스템/.test(a)) || /왜\s*못|세계\s*규칙|제약/.test(raw)) push('world');
            if (recallIntent?.origin || RECALL_ORIGIN_QUERY_CUE_RE.test(raw) || /왜\s*흔들/.test(raw)) push('origin');
            if (recallIntent?.transition || /전환|계기|바뀐|이후/.test(raw)) push('transition');
            if (recallIntent?.relationship || /관계|감정|연인|사랑|relationship|romance/i.test(raw)) push('relationship');
            if (recallIntent?.aftermath) push('aftermath');
            if (recallIntent?.current || /최근|현재|방금|이어/.test(raw)) push('current');
            if (queryPlan.hasRpNamedAnchor) push('entity');
            if (anchors.length) push('exact');
            push('narrative');
            push('memory');

            const kindWeights = {
                exact: wants.has('exact') ? 1.0 : 0.55,
                entity: wants.has('entity') ? 0.92 : 0.35,
                world: wants.has('world') ? 1.0 : 0.28,
                narrative: (wants.has('origin') || wants.has('transition') || wants.has('aftermath')) ? 0.88 : 0.42,
                relationship: wants.has('relationship') ? 0.94 : 0.36,
                origin: wants.has('origin') ? 1.0 : 0.32,
                transition: wants.has('transition') ? 0.9 : 0.26,
                current: wants.has('current') ? 0.82 : 0.24,
                aftermath: wants.has('aftermath') ? 0.86 : 0.22,
                memory: 0.45
            };
            const primaryKinds = Array.from(wants).filter(k => !['exact','origin','transition','current','aftermath','memory'].includes(k));
            return {
                version: HYBRID_MEMORY_ENGINE_POLICY.version,
                wants: Array.from(wants),
                bundleOrder: uniqLimit(bundleOrder, 12),
                kindWeights,
                primaryKinds: primaryKinds.length ? primaryKinds : ['memory'],
                preserveBuckets: uniqLimit(['exact', ...bundleOrder, 'recentImportant', 'memory'], 16)
            };
        };
        const hybridRowTagHits = (row = {}, queryPlan = {}) => {
            const q = normalizeHybridToken(queryPlan.raw || '');
            const fields = {
                scene: row.sceneTags || [],
                emotion: row.emotionTags || [],
                relation: row.relationTags || [],
                world: row.worldTags || [],
                narrative: row.narrativeTags || [],
                tag: row.tags || []
            };
            const hits = {};
            Object.entries(fields).forEach(([name, list]) => {
                const matched = (Array.isArray(list) ? list : []).filter(tag => {
                    const t = normalizeHybridToken(tag);
                    if (!t) return false;
                    if (q.includes(t)) return true;
                    if (/origin|원점/.test(t) && RECALL_ORIGIN_QUERY_CUE_RE.test(q)) return true;
                    return false;
                }).slice(0, 6);
                if (matched.length) hits[name] = matched;
            });
            const flat = Object.values(hits).flat();
            return { hits, flat, count: flat.length };
        };
        const getHybridKindAlignment = (row = {}, kindPlan = {}, queryPlan = {}, recallIntent = {}) => {
            const buckets = new Set(Array.isArray(row.hybridLite?.buckets) ? row.hybridLite.buckets : []);
            const kinds = new Set(Array.isArray(row.kinds) ? row.kinds : []);
            const weights = kindPlan.kindWeights || {};
            let score = 0;
            const reasons = [];
            const add = (key, amount, reason) => {
                const value = Number(amount || 0);
                if (value <= 0) return;
                score += value;
                if (reason) reasons.push(reason);
            };
            ['exact','entity','world','narrative','relationship','origin','transition','current','aftermath','memory'].forEach(key => {
                const keyMatched = key === 'world'
                    ? (buckets.has('world') || isHybridWorldPrimary(row))
                    : (buckets.has(key) || kinds.has(key) || row.primaryKind === key || row.baseBucket === key);
                if (keyMatched) {
                    add(key, Number(weights[key] || 0), `align:${key}`);
                }
            });
            if (recallIntent?.worldRule && isHybridWorldPrimary(row)) add('world-intent', 0.55, 'intent:world');
            if (recallIntent?.origin && (buckets.has('origin') || row.baseBucket === 'origin' || row.narrativeTags?.includes('origin'))) add('origin-intent', 0.58, 'intent:origin');
            if (recallIntent?.relationship && (kinds.has('relationship') || row.primaryKind === 'relationship')) add('relationship-intent', 0.52, 'intent:relationship');
            const tagHits = hybridRowTagHits(row, queryPlan);
            if (tagHits.count) add('tag-hit', Math.min(0.75, tagHits.count * 0.18), `tag:${tagHits.flat.slice(0, 3).join('/')}`);
            const directKind = hybridKindMatchesIntent(row, recallIntent, queryPlan);
            if (directKind.length) add('direct-kind', Math.min(0.6, directKind.length * 0.24), `kind:${directKind.join('/')}`);
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const originCueProfile = strictOriginQuery ? getOriginSceneCueProfile(row.text || '', row.payload || {}) : { hits: [], strongHits: [], weakHits: [], totalCount: 0, strongCount: 0, weakCount: 0 };
            if (originCueProfile.totalCount) add('origin-scene', Math.min(1.28, (originCueProfile.strongCount * 0.42) + (originCueProfile.weakCount * 0.16)), `scene:${originCueProfile.hits.slice(0, 3).join('/')}`);
            return { score: Number(score.toFixed(4)), reasons: uniqLimit(reasons, 12), tagHits: tagHits.hits, bundleOrder: kindPlan.bundleOrder || [] };
        };
        const resolveHybridRecallBucket = (payload = {}, recallIntent = {}, meta = {}, currentTurn = 0, hybridRow = null, queryPlan = {}, kindPlan = {}) => {
            const legacy = classifyRecallBucket(payload, recallIntent, meta, currentTurn);
            if (!hybridRow) return legacy;
            const buckets = new Set(Array.isArray(hybridRow.hybridLite?.buckets) ? hybridRow.hybridLite.buckets : []);
            const kinds = new Set(Array.isArray(hybridRow.kinds) ? hybridRow.kinds : []);
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const originCueProfile = strictOriginQuery ? getOriginSceneCueProfile(hybridRow.text || '', payload || {}) : { strongCount: 0 };
            if (recallIntent?.origin && strictOriginQuery && ((originCueProfile.strongCount || 0) > 0 || buckets.has('origin') || hybridRow.baseBucket === 'origin')) return 'origin';
            if ((queryPlan.strongAnchors || []).length && buckets.has('exact')) return 'exact';
            if (recallIntent?.worldRule && isHybridWorldPrimary(hybridRow)) return 'world';
            if (recallIntent?.origin && (buckets.has('origin') || hybridRow.baseBucket === 'origin')) return 'origin';
            if (recallIntent?.transition && (hybridRow.baseBucket === 'transition' || hybridRow.narrativeTags?.includes('transition'))) return 'transition';
            if (recallIntent?.relationship && (kinds.has('relationship') || hybridRow.primaryKind === 'relationship')) return 'relationship';
            if (recallIntent?.aftermath && (hybridRow.baseBucket === 'aftermath' || hybridRow.narrativeTags?.includes('aftermath'))) return 'aftermath';
            if (recallIntent?.current && buckets.has('current')) return 'current';
            if (isHybridWorldPrimary(hybridRow)) return 'world';
            if (hybridRow.primaryKind === 'relationship') return 'relationship';
            if (hybridRow.primaryKind === 'entity' && (queryPlan.hasRpNamedAnchor || (queryPlan.strongAnchors || []).length)) return 'entity';
            if (hybridRow.primaryKind === 'narrative') {
                if (buckets.has('origin')) return 'origin';
                return 'narrative';
            }
            return legacy;
        };
        const scoreHybridRowLite = (row = {}, queryPlan = {}, recallIntent = {}, currentTurn = 0, queryTokens = [], focusNames = [], kindPlan = {}) => {
            const text = String(row.text || '');
            const anchorHits = getExactAnchorHits(queryPlan.strongAnchors || [], text).filter(isScoringStrongRecallAnchor).slice(0, 8);
            const entityHits = uniqLimit([...queryHasHybridEntity(queryPlan.raw || '', row.subjects || []), ...queryHasHybridEntity(queryPlan.raw || '', focusNames || [])], 8);
            const kindMatches = hybridKindMatchesIntent(row, recallIntent, queryPlan);
            const tokenSet = new Set(TokenizerEngine.tokenize(text).slice(0, 300));
            let tokenOverlap = 0;
            for (const token of Array.isArray(queryTokens) ? queryTokens : []) if (tokenSet.has(token)) tokenOverlap += 1;
            const turn = Number(row.turn || 0);
            const recency = calcRecency(turn, currentTurn);
            const intentBonus = calcRecallIntentBonus(row.payload || {}, recallIntent, row.meta || {}, currentTurn);
            const isRecentImportant = recency > 0.58 && Number(row.importance || 0) >= 0.62;
            const tagHits = hybridRowTagHits(row, queryPlan);
            const worldPrimaryMatch = recallIntent?.worldRule && isHybridWorldPrimary(row);
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const originCueProfile = strictOriginQuery ? getOriginSceneCueProfile(text, row.payload || {}) : { hits: [], strongHits: [], weakHits: [], totalCount: 0, strongCount: 0, weakCount: 0 };
            const originSceneCueHits = originCueProfile.hits;
            const familyOriginMismatch = recallIntent?.origin
                && RECALL_LATE_FAMILY_RE.test(text)
                && originSceneCueHits.length === 0;
            const originLateFamilyLeak = detectOriginLateFamilyLeak({
                text,
                payload: row.payload || {},
                recallIntent,
                queryPlan,
                entityNames: uniqLimit([...(Array.isArray(row.subjects) ? row.subjects : []), ...(Array.isArray(focusNames) ? focusNames : [])], 16),
                matchedAnchors: anchorHits
            });
            const weakOriginFit = strictOriginQuery
                && recallIntent?.origin
                && originSceneCueHits.length === 0
                && !anchorHits.some(anchor => RECALL_EARLY_ORIGIN_SCENE_RE.test(anchor))
                && row.baseBucket !== 'origin'
                && row.baseBucket !== 'transition';
            const buckets = new Set(['memory']);
            if (anchorHits.length) buckets.add('exact');
            if (entityHits.length || (row.subjects || []).length) buckets.add('entity');
            if (isHybridWorldPrimary(row)) buckets.add('world');
            if ((row.kinds || []).includes('narrative')) buckets.add('narrative');
            if ((row.kinds || []).includes('relationship')) buckets.add('relationship');
            if (row.baseBucket === 'origin' || row.narrativeTags?.includes('origin')) buckets.add('origin');
            if (row.baseBucket === 'transition' || row.narrativeTags?.includes('transition')) buckets.add('transition');
            if (row.baseBucket === 'aftermath' || row.narrativeTags?.includes('aftermath')) buckets.add('aftermath');
            if (row.baseBucket === 'current' || recency > 0.72) buckets.add('current');
            if (isRecentImportant) buckets.add('recentImportant');
            if (tagHits.count) buckets.add('tag');
            const alignment = getHybridKindAlignment({ ...row, hybridLite: { buckets: Array.from(buckets) } }, kindPlan, queryPlan, recallIntent);
            const score = (anchorHits.length * 5.0)
                + (entityHits.length * 3.0)
                + (kindMatches.length * 2.8)
                + Math.min(5, tokenOverlap * 0.55)
                + (intentBonus * 7.0)
                + (Number(row.importance || 0) * 1.4)
                + (recency * 0.9)
                + (worldPrimaryMatch ? 3.2 : 0)
                + ((row.baseBucket === 'origin' && recallIntent?.origin) ? 2.2 : 0)
                + ((row.baseBucket === 'transition' && recallIntent?.transition) ? 1.8 : 0)
                + (tagHits.count * 0.9)
                + Math.min(4.2, (originCueProfile.strongCount * 2.1) + (originCueProfile.weakCount * 1.0))
                + (Number(alignment.score || 0) * 2.1)
                - (familyOriginMismatch ? 3.6 : 0)
                - (originLateFamilyLeak ? 2.0 : 0)
                - (weakOriginFit ? 0.9 : 0)
                - (strictOriginQuery && recallIntent?.origin && originCueProfile.strongCount === 0 && originCueProfile.weakCount > 0 ? 0.38 : 0);
            const reasons = uniqLimit([
                ...(anchorHits.length ? [`anchor:${anchorHits.join('/')}`] : []),
                ...(entityHits.length ? [`entity:${entityHits.join('/')}`] : []),
                ...(kindMatches.length ? [`kind:${kindMatches.join('/')}`] : []),
                ...(alignment.reasons || []),
                ...(tagHits.count ? [`tag:${tagHits.flat.slice(0, 3).join('/')}`] : []),
                ...(originSceneCueHits.length ? [`scene:${originSceneCueHits.slice(0, 3).join('/')}`] : []),
                ...(strictOriginQuery && recallIntent?.origin && originCueProfile.strongCount === 0 && originCueProfile.weakCount > 0 ? ['origin-strong-scene-miss'] : []),
                ...(worldPrimaryMatch ? ['world-primary-match'] : []),
                ...(originLateFamilyLeak ? ['origin-late-family-leak'] : []),
                ...(familyOriginMismatch ? ['origin-family-mismatch'] : []),
                ...(weakOriginFit ? ['origin-scene-miss'] : []),
                ...(intentBonus > 0 ? [`intent:${intentBonus.toFixed(2)}`] : []),
                ...(tokenOverlap > 0 ? [`token:${tokenOverlap}`] : []),
                ...(isRecentImportant ? ['recent-important'] : [])
            ], 16);
            return { score, buckets: Array.from(buckets), anchorHits, entityHits, kindMatches, tokenOverlap, intentBonus, recency, tagHits: tagHits.hits, alignment, reasons };
        };
        const addHybridRowsByBucket = (target = [], seen = new Set(), rows = [], bucket = 'memory', limit = 8, maxTotal = Infinity) => {
            rows
                .filter(row => Array.isArray(row?.hybridLite?.buckets) && row.hybridLite.buckets.includes(bucket))
                .sort((a, b) => Number(b.hybridLite?.score || 0) - Number(a.hybridLite?.score || 0) || Number(b.turn || 0) - Number(a.turn || 0))
                .slice(0, Math.max(0, Number(limit || 0)))
                .forEach(row => {
                    if (target.length >= maxTotal) return;
                    if (!row?.id || seen.has(row.id)) return;
                    seen.add(row.id);
                    target.push(row);
                });
        };
        const hybridReadPathShortlist = (entries = [], { queryPlan = {}, recallIntent = {}, currentTurn = 0, queryTokens = [], focusNames = [], topK = 15, kindPlan: suppliedKindPlan = null, scopeIndexDebug = null } = {}) => {
            const sourceEntries = Array.isArray(entries) ? entries : [];
            const kindPlan = suppliedKindPlan || buildHybridKindPlan(queryPlan, recallIntent);
            const rows = sourceEntries
                .map((entry, index) => buildHybridMemoryRow(entry, index, currentTurn))
                .filter(Boolean)
                .map(row => ({ ...row, hybridLite: scoreHybridRowLite(row, queryPlan, recallIntent, currentTurn, queryTokens, focusNames, kindPlan) }));
            const rowByKey = new Map();
            rows.forEach(row => { if (row.id) rowByKey.set(row.id, row); });
            const bucketCounts = {};
            rows.forEach(row => (row.hybridLite?.buckets || ['memory']).forEach(bucket => { bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1; }));
            const totalTextCost = rows.reduce((sum, row) => sum + Math.max(1, row.contentChars || 0) * Math.max(1, Math.min(8, Math.ceil(String(queryPlan.raw || '').length / 80))), 0);
            const configuredMaxRows = Number(CONFIG.hybridReadPathMaxRows || HYBRID_MEMORY_ENGINE_POLICY.maxHeavyRowsDefault);
            const maxRows = Math.max(6, Math.min(Number(HYBRID_MEMORY_ENGINE_POLICY.maxHeavyRowsHardCap || 8), Number.isFinite(configuredMaxRows) ? configuredMaxRows : HYBRID_MEMORY_ENGINE_POLICY.maxHeavyRowsDefault));
            const strictOriginQuery = recallQueryNeedsStrictOriginScene(queryPlan, recallIntent);
            const shouldLimit = rows.length > maxRows
                || rows.length >= HYBRID_MEMORY_ENGINE_POLICY.minRowsBeforeLimit
                || (rows.length >= 4 && totalTextCost > HYBRID_MEMORY_ENGINE_POLICY.heavyTextCostLimit);
            if (!shouldLimit) {
                return {
                    entries: sourceEntries,
                    rows,
                    rowByKey,
                    debug: {
                        enabled: true,
                        version: HYBRID_MEMORY_ENGINE_POLICY.version,
                        readPathOnly: true,
                        integration: 'kind_alignment_v2',
                        scopeIndex: scopeIndexDebug || null,
                        kindPlan,
                        limited: false,
                        reason: 'within_budget',
                        originalRows: rows.length,
                        selectedRows: rows.length,
                        maxRows,
                        totalTextCost,
                        bucketCounts,
                        selectedBucketCounts: bucketCounts
                    }
                };
            }
            const quotas = HYBRID_MEMORY_ENGINE_POLICY.quotas;
            const selectedRows = [];
            const seen = new Set();
            const addSelectedRow = (row = null) => {
                if (!row?.id || seen.has(row.id) || selectedRows.length >= maxRows) return false;
                seen.add(row.id);
                selectedRows.push(row);
                return true;
            };
            if (strictOriginQuery) {
                rows
                    .slice()
                    .map(row => ({ row, originCueProfile: getOriginSceneCueProfile(row.text || '', row.payload || {}) }))
                    .filter(({ row, originCueProfile }) => Number(originCueProfile.strongCount || 0) > 0 || row.baseBucket === 'origin' || row.arcRole === 'origin' || row.causalRole === 'cause')
                    .sort((a, b) => {
                        const strongCueDiff = Number(b.originCueProfile?.strongCount || 0) - Number(a.originCueProfile?.strongCount || 0);
                        if (strongCueDiff) return strongCueDiff;
                        const turnDiff = Number(a.row?.turn || 0) - Number(b.row?.turn || 0);
                        if (turnDiff) return turnDiff;
                        return Number(b.row?.hybridLite?.score || 0) - Number(a.row?.hybridLite?.score || 0);
                    })
                    .slice(0, Math.min(3, maxRows))
                    .forEach(({ row }) => addSelectedRow(row));
            }
            const bucketOrder = uniqLimit([
                ...(strictOriginQuery ? ['origin', 'relationship', 'entity', 'exact'] : []),
                ...(kindPlan.preserveBuckets || []),
                'transition', 'aftermath', 'tag', 'entity', 'world', 'narrative', 'relationship', 'origin', 'current', 'recentImportant', 'memory'
            ], 24);
            bucketOrder.forEach(bucket => {
                addHybridRowsByBucket(selectedRows, seen, rows, bucket, quotas[bucket] || (bucket === 'tag' ? 8 : 6), maxRows);
            });
            rows
                .slice()
                .sort((a, b) => Number(b.hybridLite?.score || 0) - Number(a.hybridLite?.score || 0) || Number(b.turn || 0) - Number(a.turn || 0))
                .forEach(row => {
                    if (selectedRows.length >= maxRows) return;
                    if (!row.id || seen.has(row.id)) return;
                    seen.add(row.id);
                    selectedRows.push(row);
                });
            const selectedBucketCounts = {};
            selectedRows.forEach(row => (row.hybridLite?.buckets || ['memory']).forEach(bucket => { selectedBucketCounts[bucket] = (selectedBucketCounts[bucket] || 0) + 1; }));
            const selectedIds = new Set(selectedRows.map(row => row.id));
            return {
                entries: sourceEntries.filter(entry => selectedIds.has(getSafeKey(entry))),
                rows,
                rowByKey,
                debug: {
                    enabled: true,
                    version: HYBRID_MEMORY_ENGINE_POLICY.version,
                    readPathOnly: true,
                    integration: 'kind_alignment_v2',
                    scopeIndex: scopeIndexDebug || null,
                    kindPlan,
                    limited: true,
                    reason: rows.length > maxRows ? 'row_cap' : 'text_cost',
                    originalRows: rows.length,
                    selectedRows: selectedRows.length,
                    maxRows,
                    totalTextCost,
                    bucketCounts,
                    selectedBucketCounts,
                    topRows: selectedRows.slice(0, 8).map(row => ({
                        id: row.id,
                        kind: row.primaryKind,
                        kinds: row.kinds,
                        buckets: row.hybridLite?.buckets || [],
                        score: Number((row.hybridLite?.score || 0).toFixed(3)),
                        turn: row.turn || 0,
                        reasons: row.hybridLite?.reasons || [],
                        preview: String(row.text || '').replace(/\s+/g, ' ').slice(0, 100)
                    }))
                }
            };
        };

        const normalizeLoreKeywords = (raw) => {
            if (Array.isArray(raw)) return raw.map(v => String(v || '').trim()).filter(Boolean);
            return String(raw || '')
                .split(/[\n,|]/g)
                .map(v => v.trim())
                .filter(Boolean);
        };

        const isStandardLoreActive = (entry, text) => {
            if (!entry) return false;
            if (entry.alwaysActive) return true;

            const primary = normalizeLoreKeywords(entry.key);
            const secondary = normalizeLoreKeywords(entry.secondkey);
            const keywords = [...new Set([...primary, ...secondary])];
            if (keywords.length === 0) return true;

            const haystack = String(text || '').toLowerCase();
            const matches = (keyword) => haystack.includes(String(keyword || '').toLowerCase());
            const mode = String(entry.mode || '').toLowerCase();

            if (mode.includes('and')) return keywords.every(matches);
            if (mode.includes('not')) return keywords.every(keyword => !matches(keyword));
            return keywords.some(matches);
        };

        const prefilterStandardLore = (query, entries, limit = 24) => {
            const queryTokens = new Set(TokenizerEngine.tokenize(query || ''));
            const tokenCache = getStandardLoreTokenCache();
            const scored = (Array.isArray(entries) ? entries : []).map((entry) => {
                const cacheKey = getLoreSignature(entry);
                let tokenized = tokenCache.peek(cacheKey);
                if (!tokenized) {
                    const keys = normalizeLoreKeywords(entry.key).concat(normalizeLoreKeywords(entry.secondkey));
                    tokenized = {
                        keyTokens: new Set(keys.flatMap(token => TokenizerEngine.tokenize(token))),
                        contentTokens: new Set(TokenizerEngine.tokenize(entry.content || ''))
                    };
                    tokenCache.set(cacheKey, tokenized);
                }
                const keyTokens = tokenized.keyTokens;
                const contentTokens = tokenized.contentTokens;
                let keyOverlap = 0;
                let contentOverlap = 0;
                queryTokens.forEach((token) => {
                    if (keyTokens.has(token)) keyOverlap++;
                    if (contentTokens.has(token)) contentOverlap++;
                });
                const score = (keyOverlap * 4) + contentOverlap + (entry.alwaysActive ? 0.25 : 0);
                return { entry, score };
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, Math.max(3, limit))
                .map(item => item.entry);
        };

        const isLibraManagedEntry = (entry) => Boolean(entry?.comment && String(entry.comment).startsWith('lmai_'));

        const getLoreSignature = (entry) => {
            const comment = String(entry?.comment || '').trim();
            const key = String(entry?.key || '').trim();
            if (comment === 'lmai_memory') {
                const memoryKey = String(getSafeKey(entry) || '').trim();
                if (memoryKey) return `${comment}::${memoryKey}`;
            }
            if (comment.startsWith('lmai_') && key) return `${comment}::${key}`;
            return [comment, key, getEntryContentHash(entry)].join('::');
        };
        const getLoreOverrideKey = (entry) => {
            const comment = String(entry?.comment || '').trim();
            const key = String(entry?.key || '').trim();
            if (!comment && !key) return null;
            return `${comment}::${key}`;
        };
        const getLoreSourceArray = (value) => {
            if (Array.isArray(value)) return LibraLoreConsolidator.unpack(value);
            if (!value || typeof value !== 'object') return [];
            if (Array.isArray(value.entries)) return LibraLoreConsolidator.unpack(value.entries);
            if (Array.isArray(value.lorebook)) return LibraLoreConsolidator.unpack(value.lorebook);
            if (Array.isArray(value.lore)) return LibraLoreConsolidator.unpack(value.lore);
            if (Array.isArray(value.globalLore)) return LibraLoreConsolidator.unpack(value.globalLore);
            if (Array.isArray(value.data)) return LibraLoreConsolidator.unpack(value.data);
            return [];
        };
        const dedupeLoreEntries = (entries = []) => {
            const seen = new Set();
            const out = [];
            for (const entry of Array.isArray(entries) ? entries : []) {
                if (!entry || typeof entry !== 'object') continue;
                const signature = getLoreSignature(entry);
                if (seen.has(signature)) continue;
                seen.add(signature);
                out.push(entry);
            }
            return out;
        };
        const getCharacterLoreSources = (char = null) => dedupeLoreEntries([
            ...getLoreSourceArray(char?.lorebook),
            ...getLoreSourceArray(char?.lore),
            ...getLoreSourceArray(char?.characterLore),
            ...getLoreSourceArray(char?.rawCharacterLore),
            ...getLoreSourceArray(char?.globalLore),
            ...getLoreSourceArray(char?.data),
            ...getLoreSourceArray(char?.data?.lorebook),
            ...getLoreSourceArray(char?.data?.lore),
            ...getLoreSourceArray(char?.data?.globalLore),
            ...getLoreSourceArray(char?.card),
            ...getLoreSourceArray(char?.card?.data),
            ...getLoreSourceArray(char?.spec),
            ...getLoreSourceArray(char?.spec?.data)
        ]);
        const getChatLoreSources = (chat = null) => dedupeLoreEntries([
            ...getLoreSourceArray(chat?.localLore),
            ...getLoreSourceArray(chat?.lorebook),
            ...getLoreSourceArray(chat?.lore)
        ]);

        const getEffectiveLorebook = (char, chat) => {
            const globalLore = getCharacterLoreSources(char);
            const localLore = getChatLoreSources(chat);
            if (localLore.length === 0) return globalLore;
            if (globalLore.length === 0) return localLore;

            const merged = [];
            const seen = new Set();
            const localOverrideKeys = new Set(
                localLore
                    .map(getLoreOverrideKey)
                    .filter(Boolean)
            );
            const mark = (entry) => {
                const key = getLoreSignature(entry);
                if (seen.has(key)) return;
                seen.add(key);
                merged.push(entry);
            };

            globalLore
                .filter(entry => {
                    const overrideKey = getLoreOverrideKey(entry);
                    return !overrideKey || !localOverrideKeys.has(overrideKey);
                })
                .forEach(mark);
            localLore.forEach(mark);
            return merged;
        };

        const normalizeLoreStorage = async (char, chat) => {
            const globalLore = Array.isArray(char?.lorebook) ? char.lorebook : [];
            if (!chat) return false;
            const localLore = Array.isArray(chat?.localLore) ? chat.localLore : [];

            const unpackedGlobalLore = LibraLoreConsolidator.unpack(globalLore);
            const unpackedLocalLore = LibraLoreConsolidator.unpack(localLore);
            const localNeedsContainerPacking = localLore.some(entry => {
                const comment = String(entry?.comment || '').trim();
                return !LibraLoreConsolidator.isContainer(entry) && (comment === 'lmai_memory' || comment === 'lmai_entity' || comment === 'lmai_relation');
            });
            let localMemoryCompacted = false;
            let compactedLocalLore = unpackedLocalLore.map(entry => {
                const migrated = CompactMemoryCodec.migrateEntry(entry);
                if (migrated?.changed) localMemoryCompacted = true;
                return migrated?.entry || entry;
            });
            const compactedGlobalLore = unpackedGlobalLore.map(entry => {
                const migrated = CompactMemoryCodec.migrateEntry(entry);
                return migrated?.entry || entry;
            });
            let characterLoreCueIndexChanged = false;
            try {
                const withoutCharacterLoreCueIndex = compactedLocalLore.filter(entry => String(entry?.comment || '') !== CharacterLoreCueIndex.COMMENT);
                const existingCueEntry = compactedLocalLore.find(entry => String(entry?.comment || '') === CharacterLoreCueIndex.COMMENT);
                const hasManagedRuntimeLore = withoutCharacterLoreCueIndex.some(entry => isLibraManagedEntry(entry))
                    || compactedGlobalLore.some(entry => isLibraManagedEntry(entry));
                if (!hasManagedRuntimeLore) {
                    if (existingCueEntry) {
                        compactedLocalLore = withoutCharacterLoreCueIndex;
                        characterLoreCueIndexChanged = true;
                    }
                } else {
                    const builtCueIndex = CharacterLoreCueIndex.buildLoreEntry(char, { ...chat, localLore: withoutCharacterLoreCueIndex });
                    if (builtCueIndex?.entry) {
                        const existingPayload = CharacterLoreCueIndex.parsePayload(existingCueEntry);
                        characterLoreCueIndexChanged = !existingCueEntry || existingPayload?.sourceHash !== builtCueIndex.payload?.sourceHash || String(existingCueEntry?.content || '') !== String(builtCueIndex.entry.content || '');
                        compactedLocalLore = characterLoreCueIndexChanged ? [...withoutCharacterLoreCueIndex, builtCueIndex.entry] : compactedLocalLore;
                    } else if (existingCueEntry) {
                        compactedLocalLore = withoutCharacterLoreCueIndex;
                        characterLoreCueIndexChanged = true;
                    }
                }
            } catch (error) {
                if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA] Character lore cue index normalize failed:', error?.message || error);
            }

            const globalLibra = compactedGlobalLore.filter(isLibraManagedEntry);
            if (globalLibra.length === 0 && !localNeedsContainerPacking && !localMemoryCompacted && !characterLoreCueIndexChanged) return false;

            const localSeen = new Set(compactedLocalLore.map(getLoreSignature));
            const migrated = [];
            for (const entry of globalLibra) {
                const signature = getLoreSignature(entry);
                if (localSeen.has(signature)) continue;
                localSeen.add(signature);
                migrated.push(entry);
            }

            char.lorebook = compactedGlobalLore.filter(entry => !isLibraManagedEntry(entry));
            chat.localLore = migrated.length > 0 ? [...compactedLocalLore, ...migrated] : [...compactedLocalLore];
            return migrated.length > 0 || globalLibra.length > 0 || localNeedsContainerPacking || localMemoryCompacted || characterLoreCueIndexChanged;
        };

        const EmbeddingEngine = (() => {
            const debugStats = {
                totalCalls: 0,
                cacheHits: 0,
                providerCalls: 0,
                lastProvider: '',
                lastModel: '',
                lastDims: 0,
                lastStatus: 'idle',
                sources: {}
            };
            return {
                getEmbedding: async (text, options = {}) => {
                    const source = normalizeEmbeddingDebugSource(options?.source || options?.label || 'general');
                    debugStats.totalCalls += 1;
                    bumpEmbeddingDebugSource(debugStats, source, 'total');
                    const mForCache = CONFIG.embed || {};
                    const providerForCache = mForCache?.provider || 'openai';
                    const modelForCache = mForCache?.model || '';
                    const cacheable = shouldCacheEmbeddingText(text);
                    const cacheKey = cacheable ? getEmbeddingCacheKey(providerForCache, modelForCache, text) : '';
                    const cache = getEmbeddingCache();
                    if (cacheKey && cache.has(cacheKey)) {
                        const cachedVec = cache.get(cacheKey);
                        debugStats.cacheHits += 1;
                        debugStats.lastProvider = providerForCache;
                        debugStats.lastModel = modelForCache;
                        debugStats.lastDims = Array.isArray(cachedVec) ? cachedVec.length : 0;
                        debugStats.lastStatus = 'cache-hit';
                        bumpEmbeddingDebugSource(debugStats, source, 'cacheHits');
                        try {
                            ActivityDashboardCore?.recordEmbedding?.({
                                label: 'Embedding cache',
                                cacheHit: true,
                                foreground: false
                            });
                        } catch (_) {}
                        if (CONFIG.debug) {
                            recordRuntimeDebug('log', `[LIBRA][EMBED] cache-hit | source=${source} | provider=${providerForCache} | model=${modelForCache} | chars=${String(text || '').length}`);
                        }
                        return Promise.resolve(cachedVec);
                    }
                    return EmbeddingQueue.enqueue(async () => {
                        const m = CONFIG.embed;
                        if (m?.enabled === false) return null;
                        const providerName = m?.provider || 'openai';
                        const providerKeyRequired = !providerAllowsEmptyKey(providerName);
                        const providerUrlRequired = providerRequiresUrl(providerName);
                        if (!m?.model || (providerKeyRequired && !String(m?.key || '').trim()) || (providerUrlRequired && !String(m?.url || '').trim())) {
                            try { ActivityDashboardCore?.recordSkippedCall?.('embedding', 'not_configured'); } catch (_) {}
                            return null;
                        }

                        try {
                            const provider = AutoProvider.get(providerName);
                            debugStats.providerCalls += 1;
                            bumpEmbeddingDebugSource(debugStats, source, 'providerCalls');
                            debugStats.lastProvider = providerName;
                            debugStats.lastModel = m.model || '';
                            debugStats.lastStatus = 'start';
                            try {
                                ActivityDashboardCore?.updateFeatureAnalysis?.({
                                    domain: 'embedding',
                                    reason: providerName,
                                    status: 'running',
                                    detail: m.model || '',
                                    source: 'embedding'
                                });
                            } catch (_) {}
                            const startAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                            if (CONFIG.debug) {
                                recordRuntimeDebug('log', 
                                    `[LIBRA][EMBED] start | source=${source} | provider=${providerName} | model=${m.model || ''} | url=${m.url || ''} | chars=${String(text || '').length} | queuePending=${EmbeddingQueue.pendingCount || 0}`
                                );
                            }
                            const vec = await provider.getEmbedding(CONFIG, text);

                            if (vec && cacheKey) cache.set(cacheKey, vec);
                            debugStats.lastDims = Array.isArray(vec) ? vec.length : 0;
                            debugStats.lastStatus = vec ? 'success' : 'empty';
                            if (!vec) bumpEmbeddingDebugSource(debugStats, source, 'empty');
                            try {
                                ActivityDashboardCore?.recordEmbedding?.({
                                    label: vec ? `Embedding ${providerName}` : `Embedding empty ${providerName}`,
                                    provider: providerName,
                                    failed: !vec
                                });
                            } catch (_) {}
                            if (CONFIG.debug) {
                                const endAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                                recordRuntimeDebug('log', 
                                    `[LIBRA][EMBED] ${vec ? 'success' : 'empty'} | source=${source} | provider=${providerName} | duration=${Math.max(0, Math.round(endAt - startAt))}ms | dims=${Array.isArray(vec) ? vec.length : 0}`
                                );
                            }
                            return vec;
                        } catch (e) {
                            debugStats.lastStatus = 'error';
                            bumpEmbeddingDebugSource(debugStats, source, 'error');
                            try {
                                ActivityDashboardCore?.recordEmbedding?.({
                                    label: 'Embedding failed',
                                    failed: true
                                });
                            } catch (_) {}
                            if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA] Embedding Error:', e?.message || e);
                            return null;
                        }
                    });
                },
                getDebugSnapshot: () => ({
                    ...debugStats,
                    sources: Object.fromEntries(Object.entries(debugStats.sources || {}).map(([key, value]) => [key, { ...value }]))
                }),
                cosineSimilarity: (a, b) => {
                    if (!a || !b || a.length !== b.length) return 0;
                    let dot = 0, normA = 0, normB = 0;
                    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
                    return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
                }
            };
        })();

        const formatMemories = (memories, query = '') => {
            if (!memories || memories.length === 0) return '';
            const groupLabels = {
                exact: 'Exact Anchor / 직접 앵커',
                origin: 'Origin / 기원',
                transition: 'Transition / 전환점',
                relationship: 'Relationship Carryover / 관계 연결',
                world: 'World/Rule Cause / 세계 규칙',
                narrative: 'Narrative Pressure / 서사 압력',
                entity: 'Entity/Subject Carryover / 엔티티 연결',
                current: 'Current Carryover / 현재 연결',
                aftermath: 'Aftermath / 후속 여파',
                general: 'Related / 관련 기억'
            };
            const renderIntent = classifyRecallIntent(query || '');
            const order = renderIntent?.origin
                ? ['origin', 'exact', 'world', 'relationship', 'narrative', 'entity', 'transition', 'current', 'aftermath', 'general']
                : ['exact', 'origin', 'world', 'relationship', 'narrative', 'entity', 'transition', 'current', 'aftermath', 'general'];
            const rows = memories.map((m, i) => {
                const meta = getCachedMeta(m);
                const content = CompactMemoryCodec.buildSearchTextFromEntry(m);
                const displayContent = CompactMemoryCodec.buildDisplayTextFromEntry(m, 340);
                const originLabel = /^(summary_only|summary_and_structured_evidence)$/.test(String(meta.rawRetention || '')) ? '압축 기억' : (meta.source === 'narrative_source_record' ? '서사 근거 원문' : '원문 기억');
                const detail = m?._recallDetail || {};
                const reasons = Array.isArray(detail.evidenceReasons) ? detail.evidenceReasons.slice(0, 3).join('+') : '';
                const scoreLabel = Number.isFinite(Number(m?._score)) ? ` / 점수:${Number(m._score).toFixed(2)}` : '';
                const bonusLabel = Number(m?._recallIntentBonus || 0) > 0 ? ` / 의도보너스:${Number(m._recallIntentBonus).toFixed(2)}` : '';
                const hybridLabel = m?._hybridKind ? ` / HME:${String(m._hybridKind || 'memory')}` : '';
                const reasonLabel = reasons ? ` / 근거:${reasons}` : '';
                const compactPayload = CompactMemoryCodec.parsePayloadFromEntry(m);
                let excerpt = compactPayload ? displayContent : String(m?._recallWindow || detail.bestWindow || '').trim();
                if (!excerpt && CONFIG.recallSentenceWindowEnabled && query) {
                    excerpt = StrengthenedJaccardCore.selectBestWindow(query, content, {
                        meta,
                        currentTurn: MemoryEngine.getCurrentTurn(),
                        maxChars: CONFIG.recallSentenceWindowChars || 260,
                        radius: 1
                    });
                }
                if (!excerpt) excerpt = displayContent || content.slice(0, 220);
                const exactBackfill = Array.isArray(m?._recallExactAnchorBackfill) && m._recallExactAnchorBackfill.length > 0;
                const maxChars = exactBackfill
                    ? 190
                    : Math.max(120, Math.min(520, Number(CONFIG.recallSentenceWindowChars || 260)));
                if (excerpt.length > maxChars) excerpt = `${excerpt.slice(0, maxChars).trim()}...`;
                const storedBucket = String(m?._recallBucket || '').trim();
                const bucket = exactBackfill && (!storedBucket || storedBucket === 'general')
                    ? 'exact'
                    : (storedBucket || (exactBackfill ? 'exact' : 'general'));
                return {
                    index: i,
                    bucket: groupLabels[bucket] ? bucket : 'general',
                    score: Number(m?._score || 0),
                    turn: Number(meta.t || 0),
                    line: `[${i + 1}] (${originLabel} / 중요도:${meta.imp}/10${scoreLabel}${bonusLabel}${hybridLabel}${reasonLabel}) ${excerpt}`
                };
            });
            const hasStructured = rows.some(row => row.bucket !== 'general');
            if (!hasStructured) return rows.map(row => row.line).join('\n');
            const lines = ['[Retrieved Continuity Bundle / 회수 연속성 묶음]'];
            const queryStrongAnchors = buildRecallQueryPlan(query, extractExactRecallAnchors(query), classifyRecallIntent(query)).strongAnchors.slice(0, 12);
            const directAnchors = queryStrongAnchors
                .filter(anchor => memories.some(memory => getExactAnchorHits([anchor], CompactMemoryCodec.buildSearchTextFromEntry(memory)).length > 0))
                .slice(0, 8);
            if (directAnchors.length > 0) {
                lines.push(`- Direct Anchor Coverage / 직접 앵커 커버리지: ${directAnchors.join(', ')}`);
            }
            const selectedKinds = uniqLimit(rows.map(row => {
                const m = memories[row.index || 0];
                return String(m?._hybridKind || '').trim();
            }).filter(Boolean), 8);
            if (selectedKinds.length > 0) {
                lines.push(`- Hybrid Kind Coverage / 하이브리드 종류 커버리지: ${selectedKinds.join(', ')}`);
            }
            for (const bucket of order) {
                const group = rows
                    .filter(row => row.bucket === bucket)
                    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(a.turn || 0) - Number(b.turn || 0));
                if (group.length === 0) continue;
                lines.push(`- ${groupLabels[bucket]}`);
                group.slice(0, 4).forEach(row => lines.push(`  ${row.line}`));
            }
            return lines.join('\n');
        };

        const incrementalGC = (allEntries, currentTurn) => {
            sanitizeMemoryRetentionConfig(CONFIG, 'gc');
            const toDelete = new Set();
            if (!Array.isArray(allEntries) || allEntries.length === 0) return { entries: Array.isArray(allEntries) ? allEntries : [], deleted: 0 };

            // TTL 검사는 lmai_memory 엔트리만 대상으로 함 (시스템 엔트리 보호)
            const memoryEntries = allEntries.filter(e => e.comment === 'lmai_memory');
            const gcBatchSize = Math.max(1, Math.floor(Number(CONFIG.gcBatchSize) || MEMORY_PRESETS.general.gcBatchSize));
            const maxLimit = Math.max(MEMORY_RETENTION_GUARD.minMaxLimit, Math.floor(Number(CONFIG.maxLimit) || MEMORY_PRESETS.general.maxLimit));
            if (memoryEntries.length > 0) {
                for (let i = 0; i < gcBatchSize; i++) {
                    const idx = (MemoryState.gcCursor + i) % memoryEntries.length;
                    const entry = memoryEntries[idx];
                    const meta = getCachedMeta(entry);
                    const ttl = Number(meta.ttl);
                    const turn = Number(meta.t);
                    const rpProtected = CONFIG.rpLongTermMemoryEnabled !== false && RPContinuityCore.isEntryProtected(entry);
                    if (!rpProtected && ttl !== -1 && Number.isFinite(turn) && Number.isFinite(ttl) && (turn + ttl) < currentTurn) {
                        toDelete.add(getSafeKey(entry));
                    }
                }
                MemoryState.gcCursor = (MemoryState.gcCursor + gcBatchSize) % Math.max(1, memoryEntries.length);
            }

            const managed = memoryEntries;
            if (managed.length > maxLimit) {
                const overflowCount = managed.length - maxLimit;
                const ranked = [...managed].sort((a, b) => {
                    const retentionA = CONFIG.rpLongTermMemoryEnabled !== false ? RPContinuityCore.entryRetentionRank(a) : 0;
                    const retentionB = CONFIG.rpLongTermMemoryEnabled !== false ? RPContinuityCore.entryRetentionRank(b) : 0;
                    if (retentionA !== retentionB) return retentionA - retentionB;
                    const metaA = getCachedMeta(a);
                    const metaB = getCachedMeta(b);
                    const belowThresholdA = (metaA.imp || 0) < CONFIG.threshold ? 0 : 1;
                    const belowThresholdB = (metaB.imp || 0) < CONFIG.threshold ? 0 : 1;
                    if (belowThresholdA !== belowThresholdB) return belowThresholdA - belowThresholdB;
                    if ((metaA.imp || 0) !== (metaB.imp || 0)) return (metaA.imp || 0) - (metaB.imp || 0);
                    return (metaA.t || 0) - (metaB.t || 0);
                });
                ranked
                    .filter(entry => CONFIG.rpLongTermMemoryEnabled === false || RPContinuityCore.entryRetentionRank(entry) < 3)
                    .slice(0, overflowCount)
                    .forEach(e => toDelete.add(getSafeKey(e)));
            }

            if (toDelete.size > 0) {
                MemoryState.hashIndex.forEach(set => toDelete.forEach(item => set.delete(item)));
                const emptyKeys = [];
                MemoryState.hashIndex.forEach((set, key) => { if (set.size === 0) emptyKeys.push(key); });
                emptyKeys.forEach(key => MemoryState.hashIndex.delete(key));
                const remainingMemoryCount = allEntries.filter(e => e?.comment === 'lmai_memory' && !toDelete.has(getSafeKey(e))).length;
                MemoryState.gcCursor = remainingMemoryCount > 0 ? (MemoryState.gcCursor % remainingMemoryCount) : 0;
                return { entries: allEntries.filter(e => !toDelete.has(getSafeKey(e))), deleted: toDelete.size };
            }
            return { entries: allEntries, deleted: 0 };
        };


        const scheduleDeferredMemoryGc = (char, chat, currentTurn = 0, reason = 'prepareMemory-threshold') => {
            const scopeKey = String(getChatMemoryScopeKey(chat, char) || chat?.id || 'global').trim() || 'global';
            if (!chat || typeof setTimeout !== 'function') return false;
            const existing = MemoryState.deferredGcByScope?.get?.(scopeKey);
            const now = Date.now();
            if (existing && (now - Number(existing.scheduledAt || 0)) < 60000) return false;
            const timer = setTimeout(async () => {
                MemoryState.deferredGcByScope?.delete?.(scopeKey);
                await loreLock.writeLock();
                try {
                    const freshLore = MemoryEngine.getLorebook(char, chat);
                    if (!Array.isArray(freshLore) || freshLore.length === 0) return;
                    const gcResult = MemoryEngine.incrementalGC(freshLore, currentTurn);
                    if (!gcResult || Number(gcResult.deleted || 0) <= 0) return;
                    freshLore.length = 0;
                    freshLore.push(...gcResult.entries);
                    ensureHybridScopeIndex(freshLore, {
                        scopeKey: getChatRuntimeScopeKey(chat, char),
                        currentTurn,
                        force: true,
                        reason
                    });
                    MemoryEngine.rebuildIndex(freshLore);
                    MemoryEngine.setLorebook(char, chat, freshLore);
                    await persistLoreToActiveChat(chat, freshLore, {});
                    if (CONFIG.debug) recordRuntimeDebug('log', `[LIBRA] Deferred GC removed ${gcResult.deleted} entries | scope=${stableHash(scopeKey)} | reason=${reason}`);
                } catch (e) {
                    if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA] Deferred GC failed:', e?.message || e);
                } finally {
                    loreLock.writeUnlock();
                }
            }, 750);
            MemoryState.deferredGcByScope?.set?.(scopeKey, { timer, scheduledAt: now, reason });
            return true;
        };

        const renameEntityReferencesInLore = (lorebook = [], oldName = '', newName = '', options = {}) => {
            if (!Array.isArray(lorebook)) return { changed: false, entriesChanged: 0, reason: 'invalid_lore' };
            const oldText = String(oldName || '').trim();
            const newText = String(newName || '').trim();
            if (!oldText || !newText) return { changed: false, entriesChanged: 0, reason: 'empty_name' };
            const normalizeRefKey = (value = '') => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
            const oldKeys = new Set([oldText, ...(Array.isArray(options.previousNames) ? options.previousNames : [])].map(normalizeRefKey).filter(Boolean));
            const replaceName = (value = '') => oldKeys.has(normalizeRefKey(value)) ? newText : String(value || '').trim();
            const entityArrayKeys = new Set(['mentionedEntityNames', 'entityRefs', 'canonicalEntities', 'entities', 'observerEntities', 'pair', 'subjects', 'subjectRefs', 'visibleTo', 'visibleToEntityNames', 'knownBy', 'unknownTo']);
            if (options.rewriteAliases !== false) entityArrayKeys.add('aliases');
            const entityScalarKeys = new Set(['entityA', 'entityB', 'ownerEntityName', 'subject', 'owner', 'target', 'entity']);
            const rewriteEntityArray = (items = [], arrayKey = '') => {
                let changed = false;
                const next = [];
                for (const item of Array.isArray(items) ? items : []) {
                    if (typeof item === 'string') {
                        const renamed = replaceName(item);
                        if (renamed !== item) changed = true;
                        if (renamed && !next.includes(renamed)) next.push(renamed);
                    } else if (item && typeof item === 'object') {
                        const rewritten = rewriteStructuredRefs(item, arrayKey);
                        if (rewritten.changed) changed = true;
                        next.push(rewritten.value);
                    }
                }
                return { value: next, changed };
            };
            const rewriteEntityStates = (states = {}) => {
                let changed = false;
                const next = {};
                for (const [key, value] of Object.entries(states && typeof states === 'object' && !Array.isArray(states) ? states : {})) {
                    const nextKey = replaceName(key);
                    if (nextKey !== key) changed = true;
                    const rewritten = rewriteStructuredRefs(value, '');
                    if (rewritten.changed) changed = true;
                    if (next[nextKey] && typeof next[nextKey] === 'object' && rewritten.value && typeof rewritten.value === 'object') {
                        next[nextKey] = { ...next[nextKey], ...rewritten.value };
                    } else {
                        next[nextKey] = rewritten.value;
                    }
                }
                return { value: next, changed };
            };
            function rewriteStructuredRefs(value, key = '') {
                if (Array.isArray(value)) {
                    if (entityArrayKeys.has(key)) return rewriteEntityArray(value, key);
                    let changed = false;
                    const next = value.map(item => {
                        const rewritten = rewriteStructuredRefs(item, '');
                        if (rewritten.changed) changed = true;
                        return rewritten.value;
                    });
                    return { value: next, changed };
                }
                if (!value || typeof value !== 'object') {
                    if (typeof value === 'string' && entityScalarKeys.has(key)) {
                        const renamed = replaceName(value);
                        return { value: renamed, changed: renamed !== value };
                    }
                    return { value, changed: false };
                }
                if (key === 'entityStates') return rewriteEntityStates(value);
                let changed = false;
                const next = {};
                const entityRefObject = ['subjects', 'subjectRefs'].includes(key)
                    || /^(?:entity|person|character|mention)$/i.test(String(value.type || value.kind || value.refType || ''));
                for (const [childKey, childValue] of Object.entries(value)) {
                    if (childKey === 'entityStates' && childValue && typeof childValue === 'object' && !Array.isArray(childValue)) {
                        const rewritten = rewriteEntityStates(childValue);
                        next[childKey] = rewritten.value;
                        changed = changed || rewritten.changed;
                        continue;
                    }
                    if (entityScalarKeys.has(childKey) && typeof childValue === 'string') {
                        const renamed = replaceName(childValue);
                        next[childKey] = renamed;
                        changed = changed || renamed !== childValue;
                        continue;
                    }
                    if (entityRefObject && childKey === 'label' && typeof childValue === 'string') {
                        const renamed = replaceName(childValue);
                        next[childKey] = renamed;
                        changed = changed || renamed !== childValue;
                        continue;
                    }
                    const rewritten = rewriteStructuredRefs(childValue, childKey);
                    next[childKey] = rewritten.value;
                    changed = changed || rewritten.changed;
                }
                return { value: next, changed };
            }

            let entriesChanged = 0;
            const entries = LibraLoreConsolidator.unpack(lorebook);
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (!entry || String(entry.comment || '') !== 'lmai_memory') continue;
                const payload = CompactMemoryCodec.parsePayloadFromEntry(entry);
                const meta = parseMeta(entry.content, {});
                let changed = false;
                let nextPayload = payload;
                let nextMeta = meta;
                if (payload && typeof payload === 'object') {
                    const rewrittenPayload = rewriteStructuredRefs(payload, '');
                    nextPayload = rewrittenPayload.value;
                    changed = changed || rewrittenPayload.changed;
                }
                if (meta && typeof meta === 'object') {
                    const rewrittenMeta = rewriteStructuredRefs(meta, '');
                    nextMeta = rewrittenMeta.value;
                    changed = changed || rewrittenMeta.changed;
                }
                if (!changed || !nextPayload) continue;
                try { nextMeta.recallHints = StrengthenedJaccardCore.buildRecallHints(CompactMemoryCodec.buildSearchTextFromPayload(nextPayload), { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 }); } catch (_) {}
                entries[i] = {
                    ...entry,
                    content: `[META:${JSON.stringify(nextMeta)}]\n${CompactMemoryCodec.serialize(nextPayload)}\n`
                };
                entriesChanged += 1;
            }
            if (!entriesChanged) return { changed: false, entriesChanged: 0 };
            lorebook.length = 0;
            lorebook.push(...entries);
            safeClearMemoryCache('entity_rename.hybrid_row_cache', () => MemoryState.hybridRowCache, () => MemoryState.hybridRowCache?.cache, {
                scopeKey: options.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                turn: options.currentTurn || MemoryState.currentTurn || 0
            });
            safeClearMemoryCache('entity_rename.scope_index', () => MemoryState.hmeScopeIndexByScope, null, {
                scopeKey: options.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                turn: options.currentTurn || MemoryState.currentTurn || 0
            });
            safeClearMemoryCache('entity_rename.graph_index', () => MemoryState.hmeGraphIndexByScope, null, {
                scopeKey: options.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                turn: options.currentTurn || MemoryState.currentTurn || 0
            });
            try {
                ensureHybridScopeIndex(lorebook, {
                    scopeKey: options.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                    currentTurn: options.currentTurn || MemoryState.currentTurn || 0,
                    force: true,
                    reason: 'entity-rename'
                });
            } catch (error) {
                if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA][HMEIndex] entity rename rebuild failed:', error?.message || error);
            }
            return { changed: true, entriesChanged };
        };

        return {
            CONFIG, getSafeKey, getCachedMeta, calcRecency, EmbeddingEngine, EmotionEngine,
            TokenizerEngine, formatMemories, incrementalGC, META_PATTERN, parseMeta,

            rebuildIndex: (lorebook) => {
                _log("Rebuilding Hash Index...");
                if (hydrateHybridScopeIndexFromLore(lorebook, { scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || '' })) {
                    if (CONFIG.debug) recordRuntimeDebug('debug', { engine: 'HME_SCOPE_INDEX', action: 'hydrate_hash_index', stats: getHybridScopeIndexStats() }, { __libraDebugMeta: true, label: 'hme-scope-index' });
                    return;
                }
                MemoryState.hashIndex.clear();
                const entries = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : []);
                entries.forEach(entry => {
                    if (entry.comment === 'lmai_memory') {
                        try {
                            const content = CompactMemoryCodec.buildSearchTextFromEntry(entry);
                            if (content.length < 5) return;
                            if (Utils.shouldExcludeStoredMemoryContent(content)) return;
                            const key = getSafeKey(entry);
                            const idxKey = TokenizerEngine.getIndexKey(content);
                            if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                            MemoryState.hashIndex.get(idxKey).add(key);
                        } catch (e) {
                            if (CONFIG.debug) {
                                recordRuntimeDebug('warn', '[LIBRA] rebuildIndex entry error:', e?.message);
                            }
                        }
                    }
                });
            },

            checkDuplication: async (content, existingList) => {
                const idxKey = TokenizerEngine.getIndexKey(content);
                const candidates = MemoryState.hashIndex.get(idxKey) || new Set();
                const map = new Map(existingList.map(e => [getSafeKey(e), e]));
                const checkPool = [...Array.from(candidates).map(k => map.get(k)).filter(Boolean), ...existingList.slice(-12)];
                const uniqueCheck = Array.from(new Set(checkPool));
                let heavyChecks = 0;
                const maxHeavy = CONFIG.hybridDuplicateFastEnabled === false
                    ? Infinity
                    : Math.max(0, Number(CONFIG.hybridDuplicateMaxHeavy || 12) || 0);
                let fastAccepted = 0;
                let fastRejected = 0;

                for (const item of uniqueCheck) {
                    if (!item || !item.content) continue;
                    const existingContent = CompactMemoryCodec.buildSearchTextFromEntry(item);
                    if (!existingContent) continue;
                    const fast = CONFIG.hybridDuplicateFastEnabled === false
                        ? { reject: false, accept: false, score: 0, reason: 'legacy' }
                        : scoreDuplicateCandidateFast(existingContent, content);
                    if (fast.accept) {
                        fastAccepted += 1;
                        if (CONFIG.debug) recordRuntimeDebug('debug', { engine: 'DuplicateScoringFast', accepted: true, score: fast.score, reason: fast.reason }, { __libraDebugMeta: true, label: 'memory-duplicate-fast' });
                        return true;
                    }
                    if (fast.reject) { fastRejected += 1; continue; }
                    if (Math.abs(existingContent.length - content.length) > content.length * 0.7 && Number(fast.score || 0) < 0.48) continue;
                    if (heavyChecks >= maxHeavy) continue;
                    heavyChecks += 1;
                    if (await calcSimilarity(existingContent, content) > 0.75) {
                        if (CONFIG.debug) recordRuntimeDebug('debug', { engine: 'DuplicateScoringFast', accepted: true, via: 'heavy_similarity', heavyChecks, fastScore: fast.score }, { __libraDebugMeta: true, label: 'memory-duplicate-heavy' });
                        return true;
                    }
                }
                if (CONFIG.debug) recordRuntimeDebug('debug', { engine: 'DuplicateScoringFast', accepted: false, checked: uniqueCheck.length, heavyChecks, fastAccepted, fastRejected, maxHeavy }, { __libraDebugMeta: true, label: 'memory-duplicate-summary' });
                return false;
            },

            markHybridRollbackTombstones,
            ensureHybridScopeIndex,
            upsertHybridScopeIndexRows,
            hydrateHybridScopeIndexFromLore,

            prepareMemory: async (data, currentTurn, existingList, lorebook, char, chat, m_id = null, metaExtra = {}) => {
                const rawInputContent = Utils.getMemorySourceText(data?.content || '');
                const importance = data?.importance;
                let payload = CompactMemoryCodec.parsePayloadFromContent(rawInputContent);
                if (!payload) payload = CompactMemoryCodec.buildPayloadFromLegacyContent(rawInputContent, { imp: importance, t: currentTurn, sourceHash: metaExtra?.sourceHash, sourceMessageIds: metaExtra?.sourceMessageIds || metaExtra?.liveMessageIds || m_id });
                if (payload) payload = CompactMemoryCodec.normalizePayloadForWrite(payload, {
                    imp: importance,
                    t: currentTurn,
                    sourceHash: metaExtra?.sourceHash,
                    sourceMessageIds: metaExtra?.sourceMessageIds || metaExtra?.liveMessageIds || m_id
                });
                let payloadToStore = payload ? {
                    ...payload,
                    turn: normalizeLegacyMemoryTurnAnchor(payload.turn || currentTurn) || currentTurn,
                    importance: Math.max(1, Math.min(10, Number(importance || payload.importance || 5) || 5)),
                    sourceHash: String(metaExtra?.sourceHash || payload.sourceHash || '').trim(),
                    sourceMessageIds: normalizeCanonicalMessageIds(metaExtra?.sourceMessageIds || metaExtra?.liveMessageIds || payload.sourceMessageIds || m_id)
                } : null;
                if (payloadToStore && CompactMemoryCodec.isLedgerPayload?.(payloadToStore)) {
                    payloadToStore.source = {
                        ...(payloadToStore.source && typeof payloadToStore.source === 'object' ? payloadToStore.source : {}),
                        turn: normalizeLegacyMemoryTurnAnchor(payloadToStore.turn || currentTurn) || currentTurn,
                        firstSeenTurn: normalizeLegacyMemoryTurnAnchor(payloadToStore.firstSeenTurn || payloadToStore.source?.firstSeenTurn || payloadToStore.turn || currentTurn) || currentTurn,
                        sourceHash: String(metaExtra?.sourceHash || payloadToStore.sourceHash || payloadToStore.source?.sourceHash || '').trim(),
                        sourceMessageIds: normalizeCanonicalMessageIds(metaExtra?.sourceMessageIds || metaExtra?.liveMessageIds || payloadToStore.sourceMessageIds || payloadToStore.source?.sourceMessageIds || m_id),
                        rawRetention: 'hash_summary_and_structured_evidence_only'
                    };
                }
                let content = payloadToStore ? CompactMemoryCodec.serialize(payloadToStore) : rawInputContent;
                let searchContent = CompactMemoryCodec.buildSearchTextFromContent(content);
                if (!searchContent || searchContent.length < 5) return null;
                if (Utils.shouldExcludeStoredMemoryContent(searchContent)) return null;

                sanitizeMemoryRetentionConfig(CONFIG, 'prepareMemory');
                const managed = MemoryEngine.getManagedEntries(lorebook);
                const safeMaxLimit = Math.max(MEMORY_RETENTION_GUARD.minMaxLimit, Math.floor(Number(CONFIG.maxLimit) || MEMORY_PRESETS.general.maxLimit));
                const earlyGcThreshold = Math.max(1, Math.floor(safeMaxLimit * 0.95));
                if (managed.length >= earlyGcThreshold) {
                    _log(`Deferred GC scheduled: ${managed.length}/${safeMaxLimit}`);
                    scheduleDeferredMemoryGc(char, chat, currentTurn, 'prepareMemory-deferred-gc');
                }

                const updatedList = lorebook || existingList;
                if (data?.forceCreate !== true && await MemoryEngine.checkDuplication(searchContent, updatedList)) return null;
                const hybridStaleCandidateIds = (CONFIG.hybridMemoryEngineEnabled !== false && CONFIG.hybridWritePathEnabled !== false)
                    ? findHybridStaleCandidates(searchContent, updatedList, 6)
                    : [];

                const imp = Math.max(1, Math.min(10, Number(importance || payloadToStore?.importance || 5) || 5));
                const rpRetention = (CONFIG.rpLongTermMemoryEnabled !== false && payloadToStore?.rpLongTerm)
                    ? RPContinuityCore.getRetentionPolicy(payloadToStore.rpLongTerm, imp, CONFIG)
                    : null;
                const ttl = rpRetention?.ttl ?? (imp >= Math.max(9, CONFIG.threshold + 2) ? -1 : (imp >= CONFIG.threshold ? 60 : 30));
                const anchorTurn = normalizeLegacyMemoryTurnAnchor(metaExtra?.turnAnchorTurn || metaExtra?.turnAnchor || currentTurn) || currentTurn;
                const sourceMessageIds = normalizeCanonicalMessageIds(metaExtra?.sourceMessageIds || metaExtra?.liveMessageIds || m_id);
                const meta = { 
                    t: anchorTurn, ttl, imp, cat: 'personal', ent: [], 
                    summary: '',
                    source: String(metaExtra?.source || 'narrative_source_record').trim() || 'narrative_source_record',
                    sourceHint: String(metaExtra?.sourceHint || 'Used as source evidence for narrative summaries.').trim() || 'Used as source evidence for narrative summaries.',
                    s_id: MemoryState.currentSessionId,
                    m_id: getPrimaryCanonicalMessageId(sourceMessageIds, true) || m_id,
                    sourceMessageIds,
                    liveMessageIds: normalizeCanonicalMessageIds(metaExtra?.liveMessageIds || sourceMessageIds),
                    sourceHash: String(metaExtra?.sourceHash || '').trim(),
                    userTurnKey: String(metaExtra?.userTurnKey || '').trim(),
                    turnKey: String(metaExtra?.turnKey || '').trim(),
                    messageSignature: compactTurnMessageSignature(metaExtra?.messageSignature || ''),
                    messageCount: Number(metaExtra?.messageCount || 0),
                    firstTurn: anchorTurn,
                    originalTurn: anchorTurn,
                    lockedTurn: anchorTurn,
                    finalizedTurn: anchorTurn,
                    turnAnchorTurn: anchorTurn,
                    turnAnchor: anchorTurn,
                    turnLocked: true,
                    turnAnchorReason: String(metaExtra?.turnAnchorReason || 'v4.2-finalized-turn').trim() || 'v4.2-finalized-turn',
                    chatId: String(metaExtra?.chatId || chat?.id || '').trim(),
                    recallHints: StrengthenedJaccardCore.buildRecallHints(searchContent, { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 }),
                    rawRetention: 'summary_and_structured_evidence',
                    rawDiscarded: true,
                    rpRetention: rpRetention ? {
                        schema: RPContinuityCore.TURN_SCHEMA,
                        protected: rpRetention.protected === true,
                        durability: rpRetention.durability,
                        reasons: rpRetention.reasons || []
                    } : undefined
                };

                if (payloadToStore && CONFIG.hybridMemoryEngineEnabled !== false && CONFIG.hybridWritePathEnabled !== false) {
                    meta.projection = {
                        schema: 'libra.memory.projection_pointer.v1',
                        hmeDerivedAtReadTime: true,
                        sourceTurnIds: [anchorTurn],
                        staleCandidateIds: hybridStaleCandidateIds,
                        hiddenFromPrompt: false
                    };
                    content = CompactMemoryCodec.serialize(payloadToStore);
                    searchContent = CompactMemoryCodec.buildSearchTextFromContent(content);
                    try { meta.recallHints = StrengthenedJaccardCore.buildRecallHints(searchContent, { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 }); }
                    catch (error) {
                        recordSuppressedRuntimeError('hme.memory_projection.recall_hints_failed', error, {
                            turn: anchorTurn,
                            contentChars: String(searchContent || '').length
                        });
                    }
                }

                const entryContent = `[META:${JSON.stringify(meta)}]\n${content}\n`;
                const strippedContent = CompactMemoryCodec.buildSearchTextFromContent(entryContent);
                const idxKey = TokenizerEngine.getIndexKey(strippedContent);
                const safeKey = TokenizerEngine.getSafeMapKey(entryContent);
                if (!MemoryState.hashIndex.has(idxKey)) MemoryState.hashIndex.set(idxKey, new Set());
                MemoryState.hashIndex.get(idxKey).add(safeKey);

                return {
                    key: "", comment: 'lmai_memory',
                    content: entryContent,
                    mode: "normal", insertorder: 100, alwaysActive: false
                };
            },

            retrieveMemories: async (query, currentTurn, candidates, vars, topK = 15) => {
                const cleanQuery = query.trim();
                const queryTokens = TokenizerEngine.tokenize(cleanQuery);
                const exactAnchors = extractExactRecallAnchors(cleanQuery);
                const recallIntent = classifyRecallIntent(cleanQuery);
                const queryPlan = buildRecallQueryPlan(cleanQuery, exactAnchors, recallIntent);
                const suppressionPlan = normalizeRecallSuppressionPlan(vars?.suppressionPlan || null, cleanQuery, queryPlan, recallIntent);
                queryPlan.suppressionPlan = suppressionPlan;
                const hybridKindPlan = buildHybridKindPlan(queryPlan, recallIntent);
                const scoringAnchors = (CONFIG.recallScoringV2Enabled === false) ? exactAnchors : (queryPlan.strongAnchors || []);
                const W = calculateDynamicWeights(cleanQuery);
                const originalCandidateCount = Array.isArray(candidates) ? candidates.length : 0;
                if (CONFIG.recallDomainGuardEnabled !== false && suppressionPlan.suppressMemoryRecall) {
                    lastRetrievalDebug = {
                        query: cleanQuery,
                        recallIntent: recallIntent.labels || [],
                        queryPlan,
                        suppressionPlan,
                        hybridKindPlan,
                        originalCandidates: originalCandidateCount,
                        filteredCandidates: 0,
                        selectedCount: 0,
                        exactAnchors,
                        scoringAnchors,
                        scoringV2: { enabled: CONFIG.recallScoringV2Enabled !== false, version: RECALL_SCORING_V2_POLICY.version },
                        domainGuardBlocked: true,
                        rejectedReason: suppressionPlan.reason || 'query_domain_mismatch'
                    };
                    if (CONFIG.debug) recordRuntimeDebug('debug', lastRetrievalDebug, { __libraDebugMeta: true, label: 'memory-recall-domain-guard', turn: currentTurn });
                    return [];
                }

                let scopeIndexDebug = null;
                let candidatePool = Array.isArray(candidates) ? candidates : [];
                const allCandidatesByKey = new Map(candidatePool
                    .map(entry => [String(getSafeKey(entry) || '').trim(), entry])
                    .filter(([key]) => key));
                if (CONFIG.hybridMemoryEngineEnabled !== false && CONFIG.hybridReadPathEnabled !== false && CONFIG.hybridScopeIndexEnabled !== false) {
                    const scopeIndexed = queryHybridScopeIndex(candidatePool, {
                        query: cleanQuery,
                        queryPlan,
                        recallIntent,
                        currentTurn,
                        queryTokens,
                        focusNames: uniqLimit(vars?.focusNames || [], 24),
                        directFocusNames: uniqLimit(vars?.directFocusNames || vars?.focusNames || [], 24),
                        relatedFocusNames: uniqLimit(vars?.relatedFocusNames || [], 24),
                        narrativeArcKeys: uniqLimit(vars?.narrativeArcKeys || [], 12),
                        topK,
                        kindPlan: hybridKindPlan,
                        scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || ''
                    });
                    scopeIndexDebug = scopeIndexed?.debug || { enabled: true, schema: HME_SCOPE_INDEX_SCHEMA, mode: 'scope_index_preselect', ok: false, reason: scopeIndexed?.reason || 'unavailable' };
                    if (scopeIndexed?.ok && Array.isArray(scopeIndexed.entries) && scopeIndexed.entries.length > 0 && scopeIndexed.entries.length < candidatePool.length) {
                        candidatePool = scopeIndexed.entries;
                    }
                }

                let filtered = candidatePool.filter(entry => {
                    const meta = getCachedMeta(entry);
                    const payload = getRecallPayload(entry) || {};
                    const hme = payload?.hybridRow || payload?.hme || meta?.hme || {};
                    if (CONFIG.hybridRollbackRowsEnabled !== false && isHybridRollbackTombstoned(meta, payload, hme)) return false;
                    const ttl = Number(meta.ttl);
                    const turn = Number(meta.t);
                    if (!(ttl === -1 || (Number.isFinite(turn) && Number.isFinite(ttl) && (turn + ttl) >= currentTurn))) return false;
                    const content = CompactMemoryCodec.buildRecallScoringTextFromEntry(entry, CONFIG.recallScoringTextMaxChars || 800) || CompactMemoryCodec.buildSearchTextFromEntry(entry);
                    if (Utils.shouldExcludeStoredMemoryContent(content)) return false;
                    return true;
                });

                let hybridReadPathDebug = null;
                let hybridRowsByKey = new Map();
                if (CONFIG.hybridMemoryEngineEnabled !== false && CONFIG.hybridReadPathEnabled !== false) {
                    const hybridResult = hybridReadPathShortlist(filtered, { queryPlan, recallIntent, currentTurn, queryTokens, focusNames: uniqLimit(vars?.focusNames || [], 24), topK, kindPlan: hybridKindPlan, scopeIndexDebug });
                    filtered = hybridResult.entries || filtered;
                    hybridRowsByKey = hybridResult.rowByKey || new Map();
                    hybridReadPathDebug = hybridResult.debug || null;
                }

                let hmeGraphRecallDebug = null;
                let hmeGraphBoostByKey = new Map();
                if (isHmeGraphEnabled()) {
                    const minGraphRecallCandidates = Math.max(0, Number(CONFIG.hmeGraphMinRecallCandidates ?? LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMinRecallCandidates ?? 24) || 0);
                    if (minGraphRecallCandidates > 0 && filtered.length < minGraphRecallCandidates) {
                        hmeGraphRecallDebug = { enabled: true, schema: HME_GRAPH_INDEX_SCHEMA, mode: normalizeHmeGraphMode(CONFIG.hmeAssociativeGraphMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode), ok: false, reason: 'candidate_gate', candidateCount: filtered.length, minCandidates: minGraphRecallCandidates };
                    } else {
                    const graphResult = expandHmeGraphRecallCandidates(filtered, allCandidatesByKey, {
                        query: cleanQuery,
                        queryPlan,
                        recallIntent,
                        currentTurn,
                        queryTokens,
                        topK,
                        focusNames: uniqLimit(vars?.focusNames || [], 24),
                        directFocusNames: uniqLimit(vars?.directFocusNames || vars?.focusNames || [], 24),
                        relatedFocusNames: uniqLimit(vars?.relatedFocusNames || [], 24),
                        narrativeArcKeys: uniqLimit(vars?.narrativeArcKeys || [], 12),
                        scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || ''
                    });
                    if (graphResult?.ok) {
                        filtered = graphResult.entries || filtered;
                        hmeGraphBoostByKey = graphResult.boostByKey || new Map();
                        hmeGraphRecallDebug = graphResult.debug || null;
                    } else {
                        hmeGraphRecallDebug = { enabled: isHmeGraphEnabled(), schema: HME_GRAPH_INDEX_SCHEMA, ok: false, reason: graphResult?.reason || 'unavailable' };
                    }
                    }
                }

                // Optimization: Pre-filter by keyword overlap if too many candidates,
                // but keep recency/importance/origin backstops so paraphrased or
                // "why/how it started" RP recall queries do not lose old causal memories.
                if (filtered.length > 50 && queryTokens.length >= 2) {
                    const ranked = filtered.map(entry => {
                        const content = CompactMemoryCodec.buildRecallScoringTextFromEntry(entry, CONFIG.recallScoringTextMaxChars || 800) || CompactMemoryCodec.buildSearchTextFromEntry(entry);
                        const contentTokens = new Set(TokenizerEngine.tokenize(content));
                        let overlap = 0;
                        for (const token of queryTokens) {
                            if (contentTokens.has(token)) overlap++;
                        }
                        const meta = getCachedMeta(entry);
                        const payload = getRecallPayload(entry);
                        const exactAnchorHits = getExactAnchorHits(scoringAnchors, content);
                        const intentBonus = calcRecallIntentBonus(payload, recallIntent, meta, currentTurn);
                        const fallbackRank = (calcRecency(meta.t, currentTurn) * 0.45) + ((meta.imp / 10) * 0.35) + (intentBonus * 0.8) + Math.min(0.5, exactAnchorHits.length * 0.16);
                        return { entry, overlap, exactAnchorHits, fallbackRank, intentBonus };
                    });

                    const maxOverlap = ranked.reduce((max, item) => Math.max(max, item.overlap), 0);
                    if (maxOverlap > 0) {
                        const selected = new Set();
                        const overlapTop = ranked
                            .slice()
                            .sort((a, b) => b.overlap - a.overlap || b.intentBonus - a.intentBonus || b.fallbackRank - a.fallbackRank)
                            .slice(0, 60);
                        overlapTop.forEach(item => selected.add(item.entry));

                        const fallbackTop = ranked
                            .slice()
                            .sort((a, b) => b.fallbackRank - a.fallbackRank || b.intentBonus - a.intentBonus || b.overlap - a.overlap)
                            .slice(0, 28);
                        fallbackTop.forEach(item => selected.add(item.entry));

                        const exactAnchorTop = ranked
                            .filter(item => Array.isArray(item.exactAnchorHits) && item.exactAnchorHits.length > 0)
                            .sort((a, b) => b.exactAnchorHits.length - a.exactAnchorHits.length || b.fallbackRank - a.fallbackRank || b.overlap - a.overlap)
                            .slice(0, 32);
                        exactAnchorTop.forEach(item => selected.add(item.entry));

                        // Origin/transition queries need at least a few old cause candidates.
                        if (recallIntent.origin || recallIntent.transition) {
                            ranked
                                .filter(item => item.intentBonus > 0)
                                .sort((a, b) => b.intentBonus - a.intentBonus || b.fallbackRank - a.fallbackRank)
                                .slice(0, 16)
                                .forEach(item => selected.add(item.entry));
                        }
                        filtered = Array.from(selected);
                    }
                }

                let belowThresholdCount = 0;
                let gateRejectedCount = 0;
                const evidenceGateMode = String(CONFIG.recallEvidenceGate || 'soft').toLowerCase();
                const focusNames = uniqLimit(vars?.focusNames || [], 24);
                const embeddingEngine = EmbeddingEngine;
                const semanticEmbeddingAvailable = !!(embeddingEngine && typeof embeddingEngine.getEmbedding === 'function' && typeof embeddingEngine.cosineSimilarity === 'function');
                const candidateEmbeddingMax = Math.max(0, Math.min(64, Math.floor(Number(CONFIG.recallEmbeddingCandidateMax ?? 8)) || 0));
                const candidateEmbeddingMinSparse = Math.max(0, Math.min(1, Number(CONFIG.recallEmbeddingPrefilterMinSparse ?? RECALL_SCORING_V2_POLICY.minWeakSparseGate) || RECALL_SCORING_V2_POLICY.minWeakSparseGate));
                let preparedCandidates = filtered.map((entry, index) => {
                    const meta = getCachedMeta(entry);
                    const payload = getRecallPayload(entry);
                    const text = CompactMemoryCodec.buildRecallScoringTextFromEntry(entry, CONFIG.recallScoringTextMaxChars || 800) || CompactMemoryCodec.buildSearchTextFromEntry(entry);
                    const hybridRow = hybridRowsByKey.get(getSafeKey(entry)) || null;
                    const recency = calcRecency(meta.t, currentTurn);
                    const importance = (meta.imp / 10);
                    const intentBonus = calcRecallIntentBonus(payload, recallIntent, meta, currentTurn);
                    const recallBucket = resolveHybridRecallBucket(payload, recallIntent, meta, currentTurn, hybridRow, queryPlan, hybridKindPlan);
                    const effectiveRecency = (recallIntent.origin || recallIntent.transition)
                        ? Math.min(recency, 0.72)
                        : recency;
                    const hybridAlignment = hybridRow?.hybridLite?.alignment || null;
                    const hybridBoost = (CONFIG.hybridMemoryEngineEnabled !== false && hybridRow?.hybridLite)
                        ? Math.min(0.20, (Math.max(0, Number(hybridRow.hybridLite.score || 0)) * 0.010) + (Math.max(0, Number(hybridAlignment?.score || 0)) * 0.035))
                        : 0;
                    const hmeGraphBoostInfo = getHmeGraphEntryBoost(entry, { boostByKey: hmeGraphBoostByKey });
                    const hmeGraphPreset = getHmeGraphPreset();
                    const hmeGraphBoost = hmeGraphBoostInfo
                        ? Math.min(hmeGraphPreset.bonusCap || 0, Math.max(0, Number(hmeGraphBoostInfo.boost || 0)))
                        : 0;
                    return {
                        index,
                        entry,
                        meta,
                        payload,
                        text,
                        hybridRow,
                        recency,
                        importance,
                        intentBonus,
                        recallBucket,
                        effectiveRecency,
                        hybridAlignment,
                        hybridBoost,
                        hmeGraphBoostInfo,
                        hmeGraphPreset,
                        hmeGraphBoost
                    };
                });
                const configuredDetailCap = Number(CONFIG.recallDetailCandidateMax ?? CONFIG.recallDetailedCandidateCap ?? Math.max(32, topK * 4));
                const detailCandidateLimit = Math.max(
                    topK,
                    Math.min(96, Math.floor(configuredDetailCap) || Math.max(32, topK * 4))
                );
                const originalPreparedCandidateCount = preparedCandidates.length;
                if (preparedCandidates.length > detailCandidateLimit) {
                    const queryTokenSet = new Set(queryTokens);
                    const fastRankedCandidates = preparedCandidates.map(item => {
                        const tokenSet = new Set(TokenizerEngine.tokenize(String(item.text || '').slice(0, CONFIG.recallScoringTextMaxChars || 800)));
                        let overlap = 0;
                        for (const token of queryTokenSet) {
                            if (tokenSet.has(token)) overlap++;
                        }
                        const exactHits = getExactAnchorHits(scoringAnchors, item.text);
                        const score = (overlap * 1.35)
                            + (Math.min(4, exactHits.length) * 1.15)
                            + (Math.max(0, Number(item.intentBonus || 0)) * 4)
                            + (Math.max(0, Number(item.hmeGraphBoost || 0)) * 3)
                            + (Math.max(0, Number(item.hybridBoost || 0)) * 3)
                            + (Math.max(0, Number(item.importance || 0)) * 0.55)
                            + (Math.max(0, Number(item.effectiveRecency || item.recency || 0)) * 0.35);
                        item.fastPrefilter = { overlap, exactAnchorHits: exactHits, score };
                        return { item, score, overlap, exactHits };
                    });
                    preparedCandidates = fastRankedCandidates
                        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
                            || Number(b.overlap || 0) - Number(a.overlap || 0)
                            || Number(b.exactHits?.length || 0) - Number(a.exactHits?.length || 0)
                            || Number(b.item?.meta?.t || 0) - Number(a.item?.meta?.t || 0))
                        .slice(0, detailCandidateLimit)
                        .map(row => row.item);
                }
                const cheapDetails = await Promise.all(preparedCandidates.map(item => calcSimilarityDetailed(cleanQuery, item.text, {
                    meta: item.meta,
                    currentTurn,
                    focusNames,
                    embeddingAllowed: false,
                    embeddingSkipReason: 'semantic_prefilter_probe',
                    includeWindow: false,
                    maxWindowChars: CONFIG.recallSentenceWindowChars || 260
                })));
                for (let detailIndex = 0; detailIndex < preparedCandidates.length; detailIndex++) {
                    const item = preparedCandidates[detailIndex];
                    item.cheapDetail = cheapDetails[detailIndex] || {
                        similarity: 0,
                        sparseScore: 0,
                        baseScore: 0,
                        embedding: 0,
                        embeddingUsed: false,
                        evidenceGate: false,
                        evidenceReasons: [],
                        anchorBonus: 0,
                        bestWindow: ''
                    };
                    item.exactAnchorHits = getExactAnchorHits(scoringAnchors, item.text);
                    const detail = item.cheapDetail;
                    const sparse = Number(detail?.sparseScore || 0);
                    const baseSparse = Number(detail?.baseScore || 0);
                    const entityHits = Array.isArray(detail?.semanticEntityHits) ? detail.semanticEntityHits : [];
                    const directEvidence = !!(detail?.evidenceGate
                        || Number(detail?.anchorBonus || 0) > 0
                        || Number(detail?.overlap || 0) >= 2
                        || hasDirectSparseEvidence(detail)
                        || item.exactAnchorHits.length > 0
                        || entityHits.length > 0);
                    const intentAligned = !!(bucketMatchesIntent(item.recallBucket, recallIntent) || Number(item.intentBonus || 0) >= 0.14);
                    const graphSignal = !!item.hmeGraphBoostInfo;
                    const hybridSignal = !!(item.hybridRow?.hybridLite && (
                        Number(item.hybridRow.hybridLite.score || 0) > 0
                        || Number(item.hybridAlignment?.score || 0) > 0
                    ));
                    const sparseEligible = sparse >= candidateEmbeddingMinSparse || baseSparse >= candidateEmbeddingMinSparse;
                    const eligible = !!(semanticEmbeddingAvailable && candidateEmbeddingMax > 0 && (
                        sparseEligible
                        || directEvidence
                        || intentAligned
                        || graphSignal
                        || hybridSignal
                    ));
                    const reasons = uniqLimit([
                        ...(sparseEligible ? ['sparse'] : []),
                        ...(directEvidence ? ['direct_evidence'] : []),
                        ...(entityHits.length ? ['entity_overlap'] : []),
                        ...(item.exactAnchorHits.length ? ['exact_anchor'] : []),
                        ...(intentAligned ? ['intent'] : []),
                        ...(graphSignal ? ['hme_graph'] : []),
                        ...(hybridSignal ? ['hybrid'] : [])
                    ], 8);
                    item.embeddingPrefilter = {
                        eligible,
                        reasons,
                        sparse,
                        baseSparse,
                        score: (sparse * 4)
                            + (baseSparse * 2)
                            + (Math.min(0.4, Number(detail?.anchorBonus || 0)) * 3)
                            + (Math.min(3, entityHits.length) * 0.24)
                            + (Math.min(3, item.exactAnchorHits.length) * 0.28)
                            + (Number(item.intentBonus || 0) * 2)
                            + (Number(item.hmeGraphBoost || 0) * 2)
                            + (Math.max(0, Number(item.hybridRow?.hybridLite?.score || 0)) * 0.018)
                            + (Math.max(0, Number(item.hybridAlignment?.score || 0)) * 0.04)
                            + (Math.max(0, Number(item.importance || 0)) * 0.16)
                            + (Math.max(0, Number(item.recency || 0)) * 0.06)
                    };
                }
                const embeddingEligible = preparedCandidates
                    .filter(item => item.embeddingPrefilter?.eligible)
                    .sort((a, b) => Number(b.embeddingPrefilter?.score || 0) - Number(a.embeddingPrefilter?.score || 0)
                        || Number(b.meta?.t || 0) - Number(a.meta?.t || 0));
                const embeddingSelectedSet = new Set(embeddingEligible.slice(0, candidateEmbeddingMax).map(item => item.index));
                const embeddingPrefilterDebug = {
                    enabled: semanticEmbeddingAvailable,
                    candidateMax: candidateEmbeddingMax,
                    minSparse: candidateEmbeddingMinSparse,
                    candidateCount: preparedCandidates.length,
                    originalCandidateCount: originalPreparedCandidateCount,
                    detailCandidateLimit,
                    eligibleCount: embeddingEligible.length,
                    selectedCandidateCount: embeddingSelectedSet.size,
                    skippedCandidateCount: Math.max(0, preparedCandidates.length - embeddingSelectedSet.size),
                    queryEmbedded: false,
                    embeddedCandidateCount: 0
                };
                let queryEmbedding = undefined;
                if (embeddingSelectedSet.size > 0 && semanticEmbeddingAvailable) {
                    queryEmbedding = await embeddingEngine.getEmbedding(cleanQuery, { source: 'memory_recall_query' });
                    embeddingPrefilterDebug.queryEmbedded = !!queryEmbedding;
                }
                if (queryEmbedding) embeddingPrefilterDebug.embeddedCandidateCount = embeddingSelectedSet.size;
                const scoredResults = await Promise.all(preparedCandidates.map(async (item) => {
                    const {
                        entry,
                        meta,
                        payload,
                        text,
                        hybridRow,
                        recency,
                        importance,
                        intentBonus,
                        recallBucket,
                        effectiveRecency,
                        hybridAlignment,
                        hybridBoost,
                        hmeGraphBoostInfo,
                        hmeGraphPreset,
                        hmeGraphBoost
                    } = item;
                    const shouldEmbedCandidate = !!(queryEmbedding && embeddingSelectedSet.has(item.index));
                    const detail = shouldEmbedCandidate
                        ? await calcSimilarityDetailed(cleanQuery, text, {
                            meta,
                            currentTurn,
                            focusNames,
                            queryEmbedding,
                            embeddingAllowed: true,
                            embeddingSourceB: 'memory_recall_candidate',
                            includeWindow: false,
                            maxWindowChars: CONFIG.recallSentenceWindowChars || 260
                        })
                        : { ...item.cheapDetail };
                    detail.embeddingPrefilter = {
                        selected: shouldEmbedCandidate,
                        eligible: !!item.embeddingPrefilter?.eligible,
                        reasons: item.embeddingPrefilter?.reasons || [],
                        sparse: Number(item.embeddingPrefilter?.sparse || 0),
                        score: Number(item.embeddingPrefilter?.score || 0),
                        skippedReason: shouldEmbedCandidate ? '' : (item.embeddingPrefilter?.eligible ? (queryEmbedding ? 'candidate_embedding_cap' : 'query_embedding_unavailable') : 'low_signal')
                    };
                    const sim = Number(detail?.similarity || 0);
                    const legacyScore = (sim * W.similarity) + (effectiveRecency * W.recency) + (importance * W.importance) + intentBonus;
                    const scoringV2 = scoreRecallItemV2({
                        detail,
                        queryPlan,
                        recallIntent,
                        payload,
                        meta,
                        currentTurn,
                        recency,
                        effectiveRecency,
                        importance,
                        intentBonus,
                        recallBucket,
                        W,
                        text,
                        query: cleanQuery,
                        focusNames,
                        hmeGraphBoostInfo,
                        hmeGraphBoost
                    });
                    if (hmeGraphBoostInfo) {
                        scoringV2.hmeGraphRecall = {
                            schema: HME_GRAPH_INDEX_SCHEMA,
                            mode: hmeGraphPreset.mode,
                            boost: hmeGraphBoost,
                            graphOnly: !!hmeGraphBoostInfo.graphOnly,
                            graphOnlyMaxScore: HME_GRAPH_ONLY_MAX_SCORE,
                            reasons: hmeGraphBoostInfo.reasons || [],
                            edgeChain: hmeGraphBoostInfo.edgeChain || [],
                            edgeLayer: hmeGraphBoostInfo.edgeLayer || '',
                            relation: hmeGraphBoostInfo.relation || '',
                            confidence: Number(hmeGraphBoostInfo.confidence || 0),
                            graphReason: hmeGraphBoostInfo.graphReason || ''
                        };
                    }
                    if (hybridRow?.hybridLite) {
                        scoringV2.hybridReadPath = {
                            version: HYBRID_MEMORY_ENGINE_POLICY.version,
                            kind: hybridRow.primaryKind || 'memory',
                            kinds: hybridRow.kinds || ['memory'],
                            buckets: hybridRow.hybridLite.buckets || [],
                            liteScore: Number(hybridRow.hybridLite.score || 0),
                            boost: hybridBoost,
                            alignment: hybridAlignment,
                            kindPlan: hybridKindPlan,
                            reasons: hybridRow.hybridLite.reasons || []
                        };
                    }
                    const rawScore = CONFIG.recallScoringV2Enabled === false ? legacyScore : (scoringV2.finalScore + hybridBoost + hmeGraphBoost);
                    const score = (CONFIG.recallScoringV2Enabled !== false && hmeGraphBoostInfo?.graphOnly)
                        ? Math.min(rawScore, HME_GRAPH_ONLY_MAX_SCORE)
                        : rawScore;
                    const thresholdPass = CONFIG.recallScoringV2Enabled === false
                        ? (sim >= CONFIG.simThreshold
                            || (intentBonus >= 0.12 && sim >= (CONFIG.simThreshold * 0.58))
                            || (detail.semanticGate && sim >= (CONFIG.simThreshold * 0.68))
                            || (detail.semanticAliasBridge && sim >= (CONFIG.simThreshold * 0.58))
                            || (evidenceGateMode === 'soft' && detail.evidenceGate && sim >= (CONFIG.simThreshold * 0.82))
                            || (evidenceGateMode === 'soft' && detail.evidence?.continuationRecent && sim >= 0.24))
                        : scoringV2.thresholdPass;
                    const gatePass = CONFIG.recallScoringV2Enabled === false
                        ? (evidenceGateMode === 'off'
                            || detail.evidenceGate
                            || detail.semanticGate
                            || intentBonus >= 0.14
                            || sim >= (CONFIG.simThreshold + (evidenceGateMode === 'strict' ? 0.08 : 0.04))
                            || (importance >= 0.85 && sim >= CONFIG.simThreshold * 0.75))
                        : scoringV2.gatePass;
                    detail.scoringV2 = scoringV2;
                    detail.scoringV2Breakdown = scoringV2;
                    if (!thresholdPass || !gatePass) {
                        if (!thresholdPass) belowThresholdCount += 1;
                        if (!gatePass) gateRejectedCount += 1;
                        return {
                            entry,
                            accepted: false,
                            similarity: sim,
                            recency,
                            effectiveRecency,
                            importance,
                            intentBonus,
                            recallBucket,
                            finalScore: score,
                            meta,
                            payload,
                            text,
                            detail,
                            scoringV2,
                            hybridRow,
                            exactAnchorHits: item.exactAnchorHits || [],
                            rejectReason: scoringV2?.domainMismatchHardReject ? 'domain_mismatch' : (!gatePass ? 'evidence_gate' : 'similarity_threshold')
                        };
                    }
                    return {
                        entry: { ...entry, _score: score, _recallDetail: detail, _recallWindow: detail.bestWindow || '', _recallBucket: recallBucket, _recallIntentBonus: intentBonus, _recallIntentLabels: recallIntent.labels || [], _hybridKind: hybridRow?.primaryKind || '', _hybridKinds: hybridRow?.kinds || [], _hybridBuckets: hybridRow?.hybridLite?.buckets || [], _hybridReasons: hybridRow?.hybridLite?.reasons || [], _hybridKindAlignment: hybridAlignment, _hybridKindPlan: hybridKindPlan, _hmeGraphBoost: hmeGraphBoost, _hmeGraphReasons: hmeGraphBoostInfo?.reasons || [], _hmeGraphOnly: !!hmeGraphBoostInfo?.graphOnly },
                        accepted: true,
                        similarity: sim,
                        recency,
                        effectiveRecency,
                        importance,
                        intentBonus,
                        recallBucket,
                        finalScore: score,
                        meta,
                        payload,
                        text,
                        detail,
                        scoringV2,
                        hybridRow,
                        exactAnchorHits: item.exactAnchorHits || []
                    };
                }));

                const accepted = scoredResults.filter(item => item && item.accepted).sort((a, b) => b.finalScore - a.finalScore);
                const selectedDiverseItems = selectRecallDiverse(accepted, topK, recallIntent);
                const selectedItems = rebalanceSelectedRecallItemsForIntent(
                    applyExactAnchorBackfill(selectedDiverseItems, scoredResults, scoringAnchors, topK, recallIntent, currentTurn),
                    scoredResults,
                    queryPlan,
                    recallIntent,
                    topK,
                    currentTurn
                );
                const selected = selectedItems.map(item => item.entry || item);
                const rejected = scoredResults.filter(item => item && !item.accepted);
                lastRetrievalDebug = {
                    query: cleanQuery,
                    recallIntent: recallIntent.labels || [],
                    originalCandidates: originalCandidateCount,
                    filteredCandidates: filtered.length,
                    selectedCount: selected.length,
                    exactAnchors,
                    scoringAnchors,
                    queryPlan,
                    suppressionPlan,
                    hybridKindPlan,
                    scoringV2: { enabled: CONFIG.recallScoringV2Enabled !== false, version: RECALL_SCORING_V2_POLICY.version },
                    hybridMemoryEngine: hybridReadPathDebug || { enabled: CONFIG.hybridMemoryEngineEnabled !== false, readPathOnly: true, limited: false, originalRows: filtered.length, selectedRows: filtered.length },
                    hmeAssociativeGraph: hmeGraphRecallDebug || { enabled: isHmeGraphEnabled(), schema: HME_GRAPH_INDEX_SCHEMA, mode: normalizeHmeGraphMode(CONFIG.hmeAssociativeGraphMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode), ok: false, reason: isHmeGraphEnabled() ? 'not_run' : 'disabled' },
                    embeddingPrefilter: embeddingPrefilterDebug,
                    exactAnchorBackfillCount: selectedItems.filter(item => item?.exactAnchorBackfill || item?.entry?._recallExactAnchorBackfill).length,
                    belowThresholdCount,
                    gateRejectedCount,
                    evidenceGateMode,
                    simThreshold: CONFIG.simThreshold,
                    threshold: CONFIG.threshold,
                    weights: { ...W },
                    detailed: CONFIG.debug === true,
                    topEntries: CONFIG.debug === true ? accepted.slice(0, Math.min(6, accepted.length)).map(item => ({
                        importance: Number(item.importance.toFixed(3)),
                        similarity: Number(item.similarity.toFixed(3)),
                        sparse: Number((item.detail?.sparseScore || 0).toFixed(3)),
                        baseSparse: Number((item.detail?.baseScore || 0).toFixed(3)),
                        anchorBonus: Number((item.detail?.anchorBonus || 0).toFixed(3)),
                        intentBonus: Number((item.intentBonus || 0).toFixed(3)),
                        recallBucket: item.recallBucket || 'general',
                        arcKey: item.payload?.arcKey || '',
                        arcRole: item.payload?.arcRole || '',
                        causalRole: item.payload?.causalRole || '',
                        embedding: Number((item.detail?.embedding || 0).toFixed(3)),
                        semanticAssist: !!item.detail?.semanticAssist,
                        semanticGate: !!item.detail?.semanticGate,
                        semanticWeights: `${Number(item.detail?.semanticSparseWeight || 0).toFixed(2)}/${Number(item.detail?.semanticEmbeddingWeight || 0).toFixed(2)}`,
                        semanticReasons: item.detail?.semanticReasons || [],
                        evidenceGate: !!item.detail?.evidenceGate,
                        evidenceReasons: item.detail?.evidenceReasons || [],
                        recency: Number(item.recency.toFixed(3)),
                        effectiveRecency: Number(item.effectiveRecency.toFixed(3)),
                        finalScore: Number(item.finalScore.toFixed(3)),
                        scoringV2: item.scoringV2 ? {
                            relevanceGate: !!item.scoringV2.relevanceGate,
                            directEvidence: !!item.scoringV2.directEvidence,
                            semanticEvidence: !!item.scoringV2.semanticEvidence,
                            intentAligned: !!item.scoringV2.intentAligned,
                            positiveBonus: Number((item.scoringV2.positiveBonus || 0).toFixed(3)),
                            penalty: Number((item.scoringV2.penalty || 0).toFixed(3)),
                            reasons: item.scoringV2.reasons || [],
                            hybridReadPath: item.scoringV2.hybridReadPath || null,
                            hmeGraphRecall: item.scoringV2.hmeGraphRecall || null
                        } : null,
                        hybrid: item.hybridRow ? {
                            kind: item.hybridRow.primaryKind || 'memory',
                            kinds: item.hybridRow.kinds || [],
                            buckets: item.hybridRow.hybridLite?.buckets || [],
                            alignment: item.hybridRow.hybridLite?.alignment || null,
                            reasons: item.hybridRow.hybridLite?.reasons || []
                        } : null,
                        turn: item.meta?.t || 0,
                        preview: String(item.entry?._recallWindow || item.text || '').slice(0, 120)
                    })) : [],
                    selectedBuckets: CONFIG.debug === true ? selectedItems.map(item => ({
                        bucket: item.recallBucket || 'general',
                        arcKey: item.payload?.arcKey || '',
                        turn: item.meta?.t || 0,
                        score: Number((item.finalScore || 0).toFixed(3)),
                        exactAnchorBackfill: Boolean(item?.exactAnchorBackfill || item?.entry?._recallExactAnchorBackfill),
                        exactAnchorHits: item?.exactAnchorHits || item?.entry?._recallExactAnchorBackfill || [],
                        hybridKind: item?.hybridRow?.primaryKind || item?.entry?._hybridKind || '',
                        hybridBuckets: item?.hybridRow?.hybridLite?.buckets || item?.entry?._hybridBuckets || [],
                        hmeGraphBoost: Number(item?.entry?._hmeGraphBoost || 0),
                        hmeGraphOnly: !!item?.entry?._hmeGraphOnly
                    })) : [],
                    rejectedSamples: CONFIG.debug === true ? rejected.slice(0, Math.min(3, rejected.length)).map(item => ({
                        reason: item.rejectReason || 'rejected',
                        similarity: Number(item.similarity.toFixed(3)),
                        intentBonus: Number((item.intentBonus || 0).toFixed(3)),
                        anchorBonus: Number((item.detail?.anchorBonus || 0).toFixed(3)),
                        semanticAssist: !!item.detail?.semanticAssist,
                        semanticReasons: item.detail?.semanticReasons || [],
                        evidenceReasons: item.detail?.evidenceReasons || [],
                        scoringV2: item.scoringV2 ? { reasons: item.scoringV2.reasons || [], penalty: Number((item.scoringV2.penalty || 0).toFixed(3)), relevanceGate: !!item.scoringV2.relevanceGate, hybridReadPath: item.scoringV2.hybridReadPath || null } : null,
                        hybrid: item.hybridRow ? { kind: item.hybridRow.primaryKind || '', buckets: item.hybridRow.hybridLite?.buckets || [], reasons: item.hybridRow.hybridLite?.reasons || [] } : null,
                        turn: item.meta?.t || 0,
                        preview: String(item.text || '').slice(0, 80)
                    })) : []
                };
                if (CONFIG.debug) {
                    recordRuntimeDebug('debug', lastRetrievalDebug, { __libraDebugMeta: true, label: 'memory-recall', turn: currentTurn });
                }
                return selected;
            },

            getLorebook: (char, chat) => LibraLoreConsolidator.unpack(
                Array.isArray(chat?.localLore) ? chat.localLore : (Array.isArray(char?.lorebook) ? char.lorebook : [])
            ),
            renameEntityReferencesInLore,
            getEffectiveLorebook,
            normalizeLoreStorage,
            isStandardLoreActive,
            prefilterStandardLore,
            setLorebook: (char, chat, data) => {
                const target = Array.isArray(chat?.localLore) ? chat.localLore
                    : Array.isArray(char?.lorebook) ? char.lorebook : null;
                try {
                    const hasHmeScopeIndex = Array.isArray(data) && data.some(entry => String(entry?.comment || '').trim() === 'lmai_hme_index');
                    if (!hasHmeScopeIndex) {
                        ensureHybridScopeIndex(data, {
                            scopeKey: getChatRuntimeScopeKey(chat, char),
                            currentTurn: MemoryState.currentTurn,
                            reason: 'setLorebook-bootstrap'
                        });
                    }
                } catch (error) {
                    if (CONFIG.debug) recordRuntimeDebug('warn', '[LIBRA][HMEIndex] setLorebook index update failed:', error?.message || error);
                }
                const externalEntries = Array.isArray(target)
                    ? target.filter(e => !e.comment || !String(e.comment).startsWith('lmai_'))
                    : [];
                const libraEntries = LibraLoreConsolidator.unpack(Array.isArray(data) ? data : [])
                    .filter(e => e.comment && String(e.comment).startsWith('lmai_'))
                    .map(e => safeClone(e));
                const merged = [...externalEntries, ...libraEntries];
                if (Array.isArray(chat?.localLore)) chat.localLore = merged;
                else if (Array.isArray(char?.lorebook)) char.lorebook = merged;
                else if (chat) chat.localLore = merged;
                else if (char) char.lorebook = merged;
            },
            getManagedEntries: (lorebook) => LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : []).filter(e => e.comment === 'lmai_memory'),
            buildRecallSuppressionPlan: (query = '') => buildRecallSuppressionPlan(query, buildRecallQueryPlan(query, extractExactRecallAnchors(query), classifyRecallIntent(query)), classifyRecallIntent(query)),
            matchesRecallSuppressionText: (value = '', plan = {}) => matchesRecallSuppressionText(value, plan),
            getLastRetrievalDebug: () => lastRetrievalDebug ? safeClone(lastRetrievalDebug) : null,
            getCacheStats: () => ({ meta: getMetaCache().stats, sim: getSimCache().stats, hybridRows: getHybridRowCache().stats, hmeScopeIndex: getHybridScopeIndexStats(), hmeGraphIndex: getHmeGraphIndexStats() }),
            incrementTurn: () => { MemoryState.currentTurn++; return MemoryState.currentTurn; },
            getCurrentTurn: () => MemoryState.currentTurn,
            setTurn: (turn) => { MemoryState.currentTurn = turn; }
        };
    })();
