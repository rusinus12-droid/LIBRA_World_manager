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
            return `${simpleHash(t)}_${t.slice(0, 8)}_${t.slice(-4)}`;
        };

        const stripKoreanParticleForToken = (value = '') => String(value || '').trim()
            .replace(/(?:에게서|에게|한테서|한테|으로서|으로|로서|로|에서|부터|까지|처럼|보다|마다|라도|이라도|하고|이랑|랑|와|과|은|는|이|가|을|를|도|만|의)$/u, '')
            .trim();

        const tokenize = (t) => {
            const raw = String(t || '');
            try {
                if (typeof KoreanTextCore !== 'undefined' && KoreanTextCore?.tokenize) {
                    return KoreanTextCore.tokenize(raw, 768);
                }
            } catch (_) {}
            const base = raw.toLowerCase()
                .replace(/[^\w가-힣\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 1);
            const expanded = [];
            const seen = new Set();
            const push = (token) => {
                const v = String(token || '').trim();
                if (!v || v.length <= 1 || seen.has(v)) return;
                seen.add(v);
                expanded.push(v);
            };
            for (const token of base) {
                push(token);
                const stripped = stripKoreanParticleForToken(token);
                if (stripped && stripped !== token) push(stripped);
            }
            return expanded;
        };

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
            const cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/g) || []).length;
            const nonCjk = text.length - cjkCount;
            const ratio = type === 'gpt4' ? 0.45 : 0.55;
            return Math.ceil(nonCjk * ratio + cjkCount * 1.8) + (text.match(/\s/g) || []).length;
        };

        return { simpleHash, tokenize, getIndexKey, getSafeMapKey, estimateTokens };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] RE Companion Strengthened Sparse Jaccard
    // ══════════════════════════════════════════════════════════════
    const DEFAULT_RE_SCORING_PROFILE = 'balanced';
    const DEFAULT_RE_SCORING_WEIGHTS = Object.freeze({
        word: 0.34,
        char: 0.18,
        concept: 0.22,
        lexicalCoverage: 0.12,
        focus: 0.08,
        wordCoverageFactor: 0.72,
        charCoverageFactor: 0.54,
        conceptCoverageFactor: 0.74
    });
    const RE_SCORING_PROFILE_WEIGHTS = Object.freeze({
        default: DEFAULT_RE_SCORING_WEIGHTS,
        balanced: DEFAULT_RE_SCORING_WEIGHTS,
        lexical: Object.freeze({ word: 0.46, char: 0.20, concept: 0.10, lexicalCoverage: 0.18, focus: 0.06, wordCoverageFactor: 0.66, charCoverageFactor: 0.46, conceptCoverageFactor: 0.58 }),
        strict: Object.freeze({ word: 0.44, char: 0.18, concept: 0.14, lexicalCoverage: 0.18, focus: 0.06, wordCoverageFactor: 0.68, charCoverageFactor: 0.46, conceptCoverageFactor: 0.62 }),
        semantic: Object.freeze({ word: 0.24, char: 0.14, concept: 0.36, lexicalCoverage: 0.08, focus: 0.18, wordCoverageFactor: 0.78, charCoverageFactor: 0.56, conceptCoverageFactor: 0.84 }),
        salience: Object.freeze({ word: 0.28, char: 0.14, concept: 0.22, lexicalCoverage: 0.10, focus: 0.12, wordCoverageFactor: 0.72, charCoverageFactor: 0.52, conceptCoverageFactor: 0.78 }),
        recency: Object.freeze({ word: 0.26, char: 0.14, concept: 0.20, lexicalCoverage: 0.08, focus: 0.10, wordCoverageFactor: 0.70, charCoverageFactor: 0.52, conceptCoverageFactor: 0.76 }),
        entity_focus: Object.freeze({ word: 0.28, char: 0.16, concept: 0.22, lexicalCoverage: 0.10, focus: 0.20, wordCoverageFactor: 0.74, charCoverageFactor: 0.54, conceptCoverageFactor: 0.78 }),
        custom: DEFAULT_RE_SCORING_WEIGHTS
    });
    const clamp01 = (value, fallback = 0) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(0, Math.min(1, n));
    };
    const uniqLimit = (items = [], limit = 256) => {
        const out = [];
        const seen = new Set();
        for (const item of Array.isArray(items) ? items : []) {
            const v = String(item || '').trim();
            if (!v || seen.has(v)) continue;
            seen.add(v);
            out.push(v);
            if (out.length >= limit) break;
        }
        return out;
    };
    const normalizeREScoringProfile = (value) => {
        const raw = String(value || DEFAULT_RE_SCORING_PROFILE).trim().toLowerCase();
        if (raw === 'default') return 'balanced';
        return RE_SCORING_PROFILE_WEIGHTS[raw] ? raw : DEFAULT_RE_SCORING_PROFILE;
    };
    const normalizeREScoringWeights = (profile = DEFAULT_RE_SCORING_PROFILE, raw = {}) => {
        const preset = RE_SCORING_PROFILE_WEIGHTS[normalizeREScoringProfile(profile)] || DEFAULT_RE_SCORING_WEIGHTS;
        const read = (key) => {
            const n = Number(raw?.[key]);
            return Number.isFinite(n) && n >= 0 ? n : preset[key];
        };
        const weights = {
            word: read('word'),
            char: read('char'),
            concept: read('concept'),
            lexicalCoverage: read('lexicalCoverage'),
            focus: read('focus'),
            wordCoverageFactor: Number(raw?.wordCoverageFactor ?? preset.wordCoverageFactor),
            charCoverageFactor: Number(raw?.charCoverageFactor ?? preset.charCoverageFactor),
            conceptCoverageFactor: Number(raw?.conceptCoverageFactor ?? preset.conceptCoverageFactor)
        };
        const total = weights.word + weights.char + weights.concept + weights.lexicalCoverage + weights.focus;
        if (total > 0) {
            weights.word = Number((weights.word / total).toFixed(4));
            weights.char = Number((weights.char / total).toFixed(4));
            weights.concept = Number((weights.concept / total).toFixed(4));
            weights.lexicalCoverage = Number((weights.lexicalCoverage / total).toFixed(4));
            weights.focus = Number((weights.focus / total).toFixed(4));
        }
        weights.wordCoverageFactor = clamp01(weights.wordCoverageFactor, preset.wordCoverageFactor);
        weights.charCoverageFactor = clamp01(weights.charCoverageFactor, preset.charCoverageFactor);
        weights.conceptCoverageFactor = clamp01(weights.conceptCoverageFactor, preset.conceptCoverageFactor);
        return weights;
    };
    const ANALYSIS_EVIDENCE_MODE_ASSISTANT_ONLY = 'assistant_only';
    const ANALYSIS_EVIDENCE_MODE_USER_AND_ASSISTANT = 'user_and_assistant';
    const normalizeAnalysisEvidenceMode = (value) => {
        const mode = String(value || ANALYSIS_EVIDENCE_MODE_ASSISTANT_ONLY).trim().toLowerCase();
        return mode === ANALYSIS_EVIDENCE_MODE_USER_AND_ASSISTANT
            ? ANALYSIS_EVIDENCE_MODE_USER_AND_ASSISTANT
            : ANALYSIS_EVIDENCE_MODE_ASSISTANT_ONLY;
    };
    const getAnalysisEvidenceMode = (config = {}) => normalizeAnalysisEvidenceMode(config?.analysisEvidenceMode);
    const analysisIncludesUserInput = (config = {}) => getAnalysisEvidenceMode(config) === ANALYSIS_EVIDENCE_MODE_USER_AND_ASSISTANT;
    const getAnalysisEvidenceLabel = (config = {}) => analysisIncludesUserInput(config)
        ? 'Current Turn Evidence'
        : 'Canonical Assistant Evidence';
    const getAnalysisEvidencePolicy = (config = {}) => {
        if (!analysisIncludesUserInput(config)) return LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY;
        return [
            '[Current Turn Evidence Policy]',
            '- Treat the Current User Input and Canonical Assistant Evidence blocks as the current turn evidence.',
            '- User input can support user actions, user speech, directly introduced names, explicit intentions, and scene facts the user controls.',
            '- Assistant evidence can support assistant-controlled outcomes, reactions, state changes, world facts, and narrative progress.',
            '- If the two blocks conflict, preserve non-conflicting user evidence and prefer assistant evidence for assistant-controlled outcomes.'
        ].join('\n');
    };
    const getAnalysisEvidenceSystemOverride = (config = {}) => analysisIncludesUserInput(config)
        ? [
            '[Active Evidence Mode Override]',
            'For this request, Current User Input is factual current-turn evidence, not mere metadata.',
            'Promote facts only when directly supported by a span in Current User Input or Canonical Assistant Evidence.'
        ].join('\n')
        : '';
    const buildCurrentTurnAnalysisEvidence = (userMsg = '', aiResponse = '', config = {}) => {
        const userText = String(userMsg || '').trim();
        const assistantText = String(aiResponse || '').trim();
        const includeUser = analysisIncludesUserInput(config) && !!userText;
        const text = includeUser
            ? [
                `[Current User Input]\n${userText}`,
                `[Canonical Assistant Evidence]\n${assistantText || '(empty)'}`
            ].join('\n\n')
            : assistantText;
        return {
            mode: getAnalysisEvidenceMode(config),
            includeUser,
            label: getAnalysisEvidenceLabel(config),
            policy: getAnalysisEvidencePolicy(config),
            systemOverride: getAnalysisEvidenceSystemOverride(config),
            userText,
            assistantText,
            text: text.trim()
        };
    };
    const buildOptimizedHiddenSettingsDefaults = (options = {}) => {
        const coldStartScopePreset = ['all', 'recent100', 'recent200', 'recent500', 'custom'].includes(String(options.coldStartScopePreset || '').trim())
            ? String(options.coldStartScopePreset).trim()
            : 'all';
        const coldStartHistoryLimit = resolveColdStartHistoryLimit(coldStartScopePreset, Number(options.coldStartHistoryLimit || 0));
        const injectionBudgetMaxTokens = getInjectionBudgetPresetTokens('max');
        const scoringProfile = DEFAULT_RE_SCORING_PROFILE;
        const scoringPreset = RE_SCORING_PROFILE_WEIGHTS[scoringProfile] || DEFAULT_RE_SCORING_WEIGHTS;
        return {
            useLLM: true,
            cbsEnabled: true,
            bypassAuxRequests: true,
            responseStreamingCompatEnabled: true,
            useLorebookRAG: true,
            emotionEnabled: true,
            illustrationModuleCompatEnabled: true,
            nsfwEnabled: true,
            sectionWorldInferenceEnabled: true,
            secretKnowledgeEnabled: true,
            entityKnowledgeVaultEnabled: true,
            rpLongTermMemoryEnabled: true,
            rpLongTermLlmEnrichment: true,
            rpLongTermInjectionMaxChars: 2600,
            rpLongTermLongTtl: 720,
            rpLongTermMediumTtl: 240,
            characterSourceReflectionEnabled: true,
            personaBindingSyncEnabled: true,
            debug: false,
            // Realtime overlay dashboard is an intentional visible runtime aid.
            // Keep the historic default on; users can still disable it via the
            // activity_dashboard arg or saved common settings.
            activityDashboard: 'full',
            analysisEvidenceMode: normalizeAnalysisEvidenceMode(options.analysisEvidenceMode),
            backgroundMaintenanceDelayMs: 1500,
            afterRequestMaintenanceMode: DEFAULT_AFTER_REQUEST_MAINTENANCE_MODE,
            afterRequestForegroundTimeoutMs: 45000,
            // Freeze guard defaults: these paths perform full-lore snapshots or synchronous
            // scans. Keep them opt-in so normal generation is not pinned by rollback/secret sync.
            beforeRequestRollbackJournalEnabled: false,
            beforeRequestRollbackJournalPersist: false,
            rollbackJournalBaselineSnapshotsEnabled: false,
            runtimeRollbackSnapshotsEnabled: false,
            beforeRequestSyncMemoryEnabled: false,
            beforeRequestSecretIngestEnabled: false,
            beforeRequestEntitySecretBootstrapEnabled: false,
            persistRpBackfillEverySave: false,
            recallDetailCandidateMax: 48,
            memoryPreset: 'custom',
            maxLimit: 900,
            threshold: 2,
            simThreshold: 0.10,
            gcBatchSize: 16,
            coldStartScopePreset,
            coldStartHistoryLimit,
            injectionBudgetPreset: 'max',
            injectionBudgetMaxTokens,
            injectionBudgetTokens: injectionBudgetMaxTokens,
            weightMode: 'auto',
            weights: resolveWeightsForMode('auto', null),
            scoringProfile,
            scoringWeights: normalizeREScoringWeights(scoringProfile, scoringPreset),
            worldAdjustmentMode: 'dynamic',
            recallEvidenceGate: 'soft',
            recallAnchorBonus: 0.12,
            recallSentenceWindowEnabled: true,
            recallSentenceWindowChars: 260,
            recallScoringTextMaxChars: 800,
            recallScoringV2Enabled: true,
            recallDomainGuardEnabled: true,
            hybridMemoryEngineEnabled: true,
            hybridReadPathEnabled: true,
            hybridReadPathMaxRows: 48,
            hybridWritePathEnabled: true,
            hybridDuplicateFastEnabled: true,
            hybridDuplicateMaxHeavy: 12,
            hybridRollbackRowsEnabled: true,
            hybridScopeIndexEnabled: true,
            hmeAssociativeGraphMode: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode,
            hmeGraphMaxSeeds: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxSeeds,
            hmeGraphMaxCandidates: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxCandidates,
            hmeGraphMaxAdditions: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxAdditions,
            hmeGraphMaxNodes: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxNodes,
            hmeGraphMaxEdges: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxEdges,
            hmeGraphMaxHops: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxHops,
            hmeGraphBonusCap: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphBonusCap,
            hmeGraphMinRecallCandidates: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMinRecallCandidates,
            hmeGraphDebug: 'compact',
            libraInjectionMode: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode,
            libraProjectionAlwaysActive: true,
            libraProjectionMaxChars: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionMaxChars,
            libraProjectionRecallBundle: LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionRecallBundle
        };
    };
    const KoreanTextCore = (() => {
        const normalizeSpacing = (value = '') => String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        const hangulNgrams = (value = '', min = 2, max = 3, limit = 256) => {
            const source = String(value || '').replace(/[^가-힣]+/g, ' ');
            const grams = [];
            const seen = new Set();
            for (const word of source.split(/\s+/).filter(Boolean)) {
                const chars = Array.from(word);
                for (let size = min; size <= max; size += 1) {
                    if (chars.length < size) continue;
                    for (let i = 0; i <= chars.length - size; i += 1) {
                        const gram = chars.slice(i, i + size).join('');
                        if (seen.has(gram)) continue;
                        seen.add(gram);
                        grams.push(gram);
                        if (grams.length >= limit) return grams;
                    }
                }
            }
            return grams;
        };
        const stripParticles = (token = '') => String(token || '').trim()
            .replace(/(?:에게서|에게|한테서|한테|으로서|으로|로서|로|에서|부터|까지|처럼|보다|마다|라도|이라도|하고|이랑|랑|와|과|은|는|이|가|을|를|도|만|의)$/u, '')
            .trim();
        const wordTokens = (value = '', limit = 512) => {
            const base = String(value || '')
                .toLowerCase()
                .replace(/[^\p{L}\p{N}_가-힣ぁ-んァ-ヶ一-龯]+/gu, ' ')
                .split(/\s+/)
                .filter(token => token.length >= 2);
            const expanded = [];
            for (const token of base) {
                expanded.push(token);
                const stripped = stripParticles(token);
                if (stripped && stripped.length >= 2 && stripped !== token) expanded.push(stripped);
            }
            return uniqLimit(expanded, limit);
        };
        const tokenize = (value = '', limit = 768) => uniqLimit([
            ...wordTokens(value, limit),
            ...hangulNgrams(value, 2, 3, Math.floor(limit / 2))
        ], limit);
        return Object.freeze({ normalizeSpacing, tokenize });
    })();
    const StrengthenedJaccardCore = (() => {
        const ENGINE = 'libra_strengthened_jaccard_v1_re_companion_compat';
        const NORMALIZE_TOKEN_CACHE_LIMIT = 16384;
        const normalizeTokenCache = new Map();
        const rememberNormalizedToken = (key, value) => {
            normalizeTokenCache.set(key, value);
            if (normalizeTokenCache.size > NORMALIZE_TOKEN_CACHE_LIMIT) {
                let removed = 0;
                for (const cachedKey of normalizeTokenCache.keys()) {
                    normalizeTokenCache.delete(cachedKey);
                    removed += 1;
                    if (removed >= 1024) break;
                }
            }
            return value;
        };
        const normalizeToken = (value = '') => {
            const raw = String(value || '');
            if (normalizeTokenCache.has(raw)) return normalizeTokenCache.get(raw);
            const normalized = KoreanTextCore.normalizeSpacing(raw)
                .toLowerCase()
                .replace(/[^\p{L}\p{N}:._-]+/gu, '')
                .replace(/[_\s]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 120);
            return rememberNormalizedToken(raw, normalized);
        };
        const CHAR_NGRAM_CACHE_LIMIT = 4096;
        const charNgramCache = new Map();
        const rememberCharNgrams = (key, grams) => {
            charNgramCache.set(key, grams);
            if (charNgramCache.size > CHAR_NGRAM_CACHE_LIMIT) {
                let removed = 0;
                for (const cachedKey of charNgramCache.keys()) {
                    charNgramCache.delete(cachedKey);
                    removed += 1;
                    if (removed >= 512) break;
                }
            }
            return grams;
        };
        const charNgrams = (value = '', limit = 220) => {
            const cacheKey = `${limit}\0${String(value || '')}`;
            if (charNgramCache.has(cacheKey)) return charNgramCache.get(cacheKey);
            const cleaned = String(value || '')
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const grams = [];
            for (const part of cleaned.split(/\s+/).filter(Boolean)) {
                const chars = Array.from(part);
                if (chars.length < 2) continue;
                const min = chars.length <= 3 ? 2 : 3;
                const max = Math.min(4, chars.length);
                for (let size = min; size <= max; size += 1) {
                    for (let i = 0; i <= chars.length - size; i += 1) grams.push(chars.slice(i, i + size).join(''));
                }
            }
            return rememberCharNgrams(cacheKey, uniqLimit(grams, limit));
        };
        const registryTokens = (value = '') => {
            const body = String(value || '').toLowerCase();
            const registries = {
                'intent:memory': ['기억', '떠올', '회상', 'remember', 'memory', 'recall'],
                'intent:location': ['위치', '장소', '어디', 'where', 'location', 'place'],
                'intent:state': ['상태', '현재', '지금', 'current', 'state', 'status'],
                'intent:secret': ['비밀', '숨김', '드러', 'secret', 'hidden', 'reveal'],
                'relation:trust': ['믿', '신뢰', '의지', 'trust', 'rely'],
                'relation:distrust': ['불신', '의심', '배신', 'distrust', 'suspect', 'betray'],
                'relation:attachment': ['집착', '질투', '붙잡', 'cling', 'attached', 'jealous'],
                'emotion:fear': ['두려', '불안', '떨', 'fear', 'afraid', 'anxious'],
                'emotion:affection': ['애정', '사랑', '위로', 'affection', 'love', 'comfort'],
                'narrative:consequence': ['결과', '여파', '대가', 'consequence', 'aftermath', 'cost'],
                'narrative:unresolved': ['미해결', '아직', '보류', 'unresolved', 'pending'],
                'world:rule': ['규칙', '금지', '허용', 'rule', 'law', 'forbidden'],
                'time:recent': ['방금', '직전', '최근', 'now', 'recent', 'latest']
            };
            const out = [];
            for (const [token, phrases] of Object.entries(registries)) {
                if (phrases.some(phrase => body.includes(phrase))) out.push(token);
            }
            return uniqLimit(out, 80);
        };
        const tokenWeight = token => {
            const raw = String(token || '');
            const key = normalizeToken(raw);
            if (!key) return 0;
            let weight = 1;
            if (/^(?:intent|relation|emotion|narrative|world|time):/i.test(raw)) weight += 0.32;
            if (key.length >= 5) weight += 0.14;
            if (/^[가-힣A-Za-z][가-힣A-Za-z0-9_.:-]{1,32}$/.test(raw) && !/^(?:state|status|current|recent)$/i.test(raw)) weight += 0.08;
            return Math.max(0.7, Math.min(1.75, weight));
        };
        const exactStats = (queryTokens = [], bodyTokens = []) => {
            const left = new Set((queryTokens || []).map(normalizeToken).filter(Boolean));
            const right = new Set((bodyTokens || []).map(normalizeToken).filter(Boolean));
            if (!left.size || !right.size) return { jaccard: 0, coverage: 0, overlap: 0 };
            let overlap = 0;
            left.forEach(token => { if (right.has(token)) overlap += 1; });
            const union = left.size + right.size - overlap;
            return { jaccard: union > 0 ? overlap / union : 0, coverage: overlap / Math.max(1, left.size), overlap };
        };
        const TOKEN_SIM_CACHE_LIMIT = 8192;
        const tokenSimilarityCache = new Map();
        const rememberTokenSimilarity = (key, score) => {
            tokenSimilarityCache.set(key, score);
            if (tokenSimilarityCache.size > TOKEN_SIM_CACHE_LIMIT) {
                let removed = 0;
                for (const cachedKey of tokenSimilarityCache.keys()) {
                    tokenSimilarityCache.delete(cachedKey);
                    removed += 1;
                    if (removed >= 512) break;
                }
            }
            return score;
        };
        const tokenSimilarity = (a = '', b = '') => {
            const left = normalizeToken(a);
            const right = normalizeToken(b);
            if (!left || !right) return 0;
            if (left === right) return 1;
            if ((left.length >= 4 && right.includes(left)) || (right.length >= 4 && left.includes(right))) return 0.82;
            const key = left <= right ? `${left}␟${right}` : `${right}␟${left}`;
            if (tokenSimilarityCache.has(key)) return tokenSimilarityCache.get(key);
            const grams = exactStats(charNgrams(left, 40), charNgrams(right, 40));
            const score = grams.jaccard >= 0.42 ? Math.max(0, Math.min(0.78, grams.jaccard * 0.92)) : 0;
            return rememberTokenSimilarity(key, score);
        };
        const softWeighted = (queryTokens = [], bodyTokens = []) => {
            // V5.2.7 recall freeze guard: the previous 180x260 fuzzy matrix was
            // the hottest live-turn path. Keep exact coverage first and limit fuzzy
            // matching to a smaller unmatched frontier.
            const left = uniqLimit(queryTokens || [], 96);
            const right = uniqLimit(bodyTokens || [], 128);
            if (!left.length || !right.length) return { jaccard: 0, coverage: 0, overlap: 0 };
            let leftWeight = 0, rightWeight = 0, overlapWeight = 0, overlap = 0;
            const used = new Set();
            const rightInfo = right.map((token, index) => ({
                token,
                index,
                norm: normalizeToken(token),
                weight: tokenWeight(token)
            }));
            const rightByNorm = new Map();
            rightInfo.forEach(info => {
                if (!info.norm) return;
                const arr = rightByNorm.get(info.norm) || [];
                arr.push(info);
                rightByNorm.set(info.norm, arr);
                rightWeight += info.weight;
            });
            left.forEach(leftToken => {
                const lw = tokenWeight(leftToken);
                leftWeight += lw;
                const leftNorm = normalizeToken(leftToken);
                let best = { index: -1, sim: 0, weight: 0 };
                const exactMatches = leftNorm ? (rightByNorm.get(leftNorm) || []) : [];
                const exact = exactMatches.find(info => !used.has(info.index));
                if (exact) {
                    best = { index: exact.index, sim: 1, weight: exact.weight };
                } else {
                    for (const info of rightInfo) {
                        if (used.has(info.index)) continue;
                        const sim = tokenSimilarity(leftToken, info.token);
                        if (sim > best.sim) best = { index: info.index, sim, weight: info.weight };
                    }
                }
                if (best.index >= 0 && best.sim >= 0.58) {
                    used.add(best.index);
                    overlap += 1;
                    overlapWeight += Math.min(lw, best.weight) * best.sim;
                }
            });
            const unionWeight = leftWeight + rightWeight - overlapWeight;
            return { jaccard: unionWeight > 0 ? overlapWeight / unionWeight : 0, coverage: leftWeight > 0 ? overlapWeight / leftWeight : 0, overlap };
        };
        const signature = (value = '', limit = 220) => {
            const body = KoreanTextCore.normalizeSpacing(value);
            return { raw: body, tokens: KoreanTextCore.tokenize(body, limit), chars: charNgrams(body, limit), concepts: registryTokens(body) };
        };
        const normalizeComparable = (value = '') => KoreanTextCore.normalizeSpacing(value).toLowerCase();
        const includesLoose = (haystack = '', needle = '') => {
            const n = normalizeComparable(needle);
            if (!n || n.length < 2) return false;
            return normalizeComparable(haystack).includes(n);
        };
        const extractQuotedPhrases = (value = '', limit = 6) => {
            const src = String(value || '');
            const out = [];
            const seen = new Set();
            const patterns = [
                /["“”']([^"“”']{2,80})["“”']/g,
                /[‘’]([^‘’]{2,80})[‘’]/g,
                /[「『《〈]([^」』》〉]{2,80})[」』》〉]/g
            ];
            for (const re of patterns) {
                let m;
                while ((m = re.exec(src)) && out.length < limit) {
                    const phrase = KoreanTextCore.normalizeSpacing(m[1] || '').slice(0, 80);
                    const key = normalizeComparable(phrase);
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    out.push(phrase);
                }
            }
            return out;
        };
        const extractNumbers = (value = '', limit = 10) => uniqLimit(
            String(value || '').match(/(?:\b|[^\p{L}\p{N}])([+-]?\d+(?:\.\d+)?(?:\s?(?:년|월|일|시|분|초|층|번|개|명|살|km|m|cm|kg|%))?)/giu)?.map(v => String(v || '').replace(/^[^\p{L}\p{N}+-]+/u, '').trim()).filter(Boolean) || [],
            limit
        );
        const extractHardTokens = (value = '', limit = 32) => uniqLimit(
            String(value || '')
                .match(/[A-Z][A-Za-z0-9_.-]{1,31}|[가-힣]{2,12}|[ぁ-んァ-ヶ一-龯]{2,12}/g)?.map(v => String(v || '').trim()).filter(Boolean) || [],
            limit
        );
        const extractFocusNames = (meta = {}, options = {}) => uniqLimit([
            ...(Array.isArray(options.focusNames) ? options.focusNames : []),
            ...(Array.isArray(meta?.ent) ? meta.ent : []),
            ...(Array.isArray(meta?.entities) ? meta.entities : []),
            ...(Array.isArray(meta?.names) ? meta.names : []),
            ...(Array.isArray(meta?.recallHints?.names) ? meta.recallHints.names : []),
            ...(Array.isArray(meta?.recallHints?.tokens) ? meta.recallHints.tokens : [])
        ].map(v => String(v || '').trim()).filter(v => v.length >= 2), 24);
        const isContinuationQuery = (query = '') => /(계속|이어|이어서|방금|아까|직전|최근|그거|그 장면|다음|continue|continued|last|previous|just now|go on|carry on|what happened)/i.test(String(query || ''));
        const buildRecallHints = (value = '', options = {}) => {
            const tokens = extractHardTokens(value, 28)
                .filter(token => token.length >= 2 && !/^(그것|이것|저것|그리고|하지만|그러나|because|after|before)$/i.test(token))
                .slice(0, Math.max(0, Number(options.maxTokens || 10)));
            return {
                v: 1,
                tokens: uniqLimit(tokens, Number(options.maxTokens || 10)),
                numbers: extractNumbers(value, Number(options.maxNumbers || 4)),
                quotes: extractQuotedPhrases(value, Number(options.maxQuotes || 2))
            };
        };
        const evaluateEvidence = (query = '', body = '', options = {}, base = {}) => {
            const meta = options.meta || {};
            const queryQuotes = extractQuotedPhrases(query, 4);
            const bodyQuotes = extractQuotedPhrases(body, 6).concat(Array.isArray(meta?.recallHints?.quotes) ? meta.recallHints.quotes : []);
            const quoteHits = queryQuotes.filter(q => includesLoose(body, q) || bodyQuotes.some(b => includesLoose(b, q) || includesLoose(q, b))).slice(0, 4);
            const queryNumbers = extractNumbers(query, 8);
            const bodyNumbers = extractNumbers(body, 12).concat(Array.isArray(meta?.recallHints?.numbers) ? meta.recallHints.numbers : []);
            const bodyNumberSet = new Set(bodyNumbers.map(v => normalizeToken(v)).filter(Boolean));
            const numberHits = queryNumbers.filter(n => bodyNumberSet.has(normalizeToken(n))).slice(0, 6);
            const focusNames = extractFocusNames(meta, options);
            const hardNames = extractHardTokens(query, 24).filter(token => focusNames.some(name => normalizeComparable(name) === normalizeComparable(token)));
            const namePool = uniqLimit([...focusNames, ...hardNames], 28);
            const nameHits = namePool.filter(name => includesLoose(query, name) && includesLoose(body, name)).slice(0, 6);
            const currentTurn = Number(options.currentTurn || 0);
            const memoryTurn = Number(meta?.turnAnchorTurn ?? meta?.turnAnchor ?? meta?.finalizedTurn ?? meta?.lockedTurn ?? meta?.t ?? 0);
            const turnDelta = Number.isFinite(currentTurn) && Number.isFinite(memoryTurn) && currentTurn > 0 && memoryTurn > 0
                ? Math.max(0, currentTurn - memoryTurn)
                : Infinity;
            const continuationRecent = isContinuationQuery(query) && turnDelta <= 3;
            const lexicalEvidence = Number(base.coverage || 0) >= 0.18 && Number(base.overlap || 0) >= 1;
            const tokenEvidence = Number(base.wordOverlap || base.overlap || 0) >= 2 || Number(base.wordCoverage || 0) >= 0.22;
            const conceptEvidence = Number(base.conceptJaccard || 0) >= 0.14;
            const reasons = [];
            if (quoteHits.length) reasons.push(`quote:${quoteHits.length}`);
            if (nameHits.length) reasons.push(`name:${nameHits.slice(0, 3).join(',')}`);
            if (numberHits.length) reasons.push(`number:${numberHits.slice(0, 3).join(',')}`);
            if (lexicalEvidence) reasons.push('lexical');
            if (tokenEvidence) reasons.push('token');
            if (conceptEvidence) reasons.push('concept');
            if (continuationRecent) reasons.push(`recent:T-${turnDelta}`);
            const hardEvidence = quoteHits.length > 0 || nameHits.length > 0 || numberHits.length > 0 || continuationRecent;
            const passesGate = Boolean(hardEvidence || lexicalEvidence || tokenEvidence || conceptEvidence || Number(base.score || 0) >= 0.32);
            const rawBonus =
                Math.min(0.16, quoteHits.length * 0.08)
                + Math.min(0.12, nameHits.length * 0.055)
                + Math.min(0.07, numberHits.length * 0.035)
                + (lexicalEvidence ? 0.035 : 0)
                + (tokenEvidence ? 0.035 : 0)
                + (conceptEvidence ? 0.025 : 0)
                + (continuationRecent ? 0.13 : 0);
            const maxBonus = Number.isFinite(Number(options.anchorBonusLimit)) ? Number(options.anchorBonusLimit) : 0.14;
            return {
                passesGate,
                reasons: uniqLimit(reasons, 8),
                quoteHits,
                nameHits,
                numberHits,
                continuationRecent,
                turnDelta: Number.isFinite(turnDelta) ? turnDelta : null,
                anchorBonus: Math.max(0, Math.min(Math.max(0, maxBonus), rawBonus)),
                scoreFloor: continuationRecent ? 0.30 : 0
            };
        };
        const splitSentences = (value = '', limit = 80) => {
            const src = KoreanTextCore.normalizeSpacing(value);
            if (!src) return [];
            const normalized = src.replace(/([.!?。！？])\s+/g, '$1\n').replace(/\n+/g, '\n');
            const raw = normalized.split(/\n|(?<=[.!?。！？])\s+/u).map(v => v.trim()).filter(Boolean);
            if (raw.length <= 1) {
                return src.match(/.{1,180}(?:\s+|$)/g)?.map(v => v.trim()).filter(Boolean).slice(0, limit) || [src.slice(0, 180)];
            }
            return raw.slice(0, limit);
        };
        const selectBestWindow = (query = '', body = '', options = {}) => {
            const maxChars = Math.max(80, Math.min(800, Number(options.maxChars || 260)));
            const source = KoreanTextCore.normalizeSpacing(body);
            if (!source || source.length <= maxChars) return source;
            const sentences = splitSentences(source, 80);
            if (!sentences.length) return source.slice(0, maxChars).trim();
            const qSig = signature(query, 180);
            let bestIndex = 0;
            let bestScore = -1;
            sentences.forEach((sentence, index) => {
                const d = score(query, sentence, { ...options, querySignature: qSig, includeWindow: false });
                const scoreValue = Number(d?.score || 0) + (index >= sentences.length - 3 ? 0.015 : 0);
                if (scoreValue > bestScore) {
                    bestScore = scoreValue;
                    bestIndex = index;
                }
            });
            const radius = Math.max(0, Math.min(2, Number(options.radius ?? 1)));
            let start = Math.max(0, bestIndex - radius);
            let end = Math.min(sentences.length, bestIndex + radius + 1);
            let windowText = sentences.slice(start, end).join(' ').trim();
            while (windowText.length > maxChars && end - start > 1) {
                if (bestIndex - start > end - bestIndex - 1) start += 1;
                else end -= 1;
                windowText = sentences.slice(start, end).join(' ').trim();
            }
            if (windowText.length > maxChars) windowText = `${windowText.slice(0, maxChars).trim()}...`;
            return windowText || source.slice(0, maxChars).trim();
        };
        const score = (query = '', body = '', options = {}) => {
            const q = options.querySignature || signature(query, 180);
            const b = signature(body, 260);
            const lexical = exactStats(q.tokens, b.tokens);
            const word = softWeighted(q.tokens, b.tokens);
            // Character n-grams and concept registry labels are already normalized
            // matching features; exact set overlap avoids quadratic fuzzy re-scoring.
            const chars = exactStats(q.chars, b.chars);
            const concepts = exactStats(q.concepts, b.concepts);
            const focusNames = extractFocusNames(options.meta || {}, options);
            const focus = focusNames.some(name => name && String(body || '').includes(name)) ? 0.22 : 0;
            const weights = options.weights || DEFAULT_RE_SCORING_WEIGHTS;
            const baseScore = clamp01(
                Math.max(word.jaccard, word.coverage * weights.wordCoverageFactor, lexical.jaccard) * weights.word
                + Math.max(chars.jaccard, chars.coverage * weights.charCoverageFactor) * weights.char
                + Math.max(concepts.jaccard, concepts.coverage * weights.conceptCoverageFactor) * weights.concept
                + lexical.coverage * weights.lexicalCoverage
                + focus * weights.focus,
                0
            );
            const evidence = evaluateEvidence(query, body, options, {
                score: baseScore,
                coverage: lexical.coverage,
                overlap: lexical.overlap,
                wordOverlap: word.overlap,
                wordCoverage: word.coverage,
                conceptJaccard: concepts.jaccard
            });
            const scoreValue = clamp01(Math.max(baseScore + evidence.anchorBonus, evidence.scoreFloor), 0);
            const bestWindow = options.includeWindow ? selectBestWindow(query, body, options) : '';
            return {
                engine: ENGINE,
                score: scoreValue,
                baseScore,
                lexical: lexical.jaccard,
                coverage: lexical.coverage,
                wordJaccard: word.jaccard,
                charJaccard: chars.jaccard,
                conceptJaccard: concepts.jaccard,
                focus,
                overlap: lexical.overlap,
                wordOverlap: word.overlap,
                anchorBonus: evidence.anchorBonus,
                evidenceGate: evidence.passesGate,
                evidenceReasons: evidence.reasons,
                evidence: {
                    quoteHits: evidence.quoteHits,
                    nameHits: evidence.nameHits,
                    numberHits: evidence.numberHits,
                    continuationRecent: evidence.continuationRecent,
                    turnDelta: evidence.turnDelta
                },
                bestWindow
            };
        };
        return Object.freeze({ ENGINE, signature, score, buildRecallHints, selectBestWindow });
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Embedding Queue
    // ══════════════════════════════════════════════════════════════
    const EmbeddingQueue = (() => {
        const q = [];
        const MAX_CONCURRENT = 2;
        let active = 0;

        const run = () => {
            while (q.length > 0 && active < MAX_CONCURRENT) {
                active++;
                const { task, resolve, reject } = q.shift();
                task().then(resolve, reject).finally(() => {
                    active--;
                    run();
                });
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
        const NEGATION_WORDS_KO = ['않', '안 ', '안하', '안 해', '못', '없', '아니', '별로', '전혀', '절대'];
        const NEGATION_WORDS_EN = ['not', 'no', 'never', 'neither', 'hardly', 'barely', 'cannot', "can't", "don't", "doesn't", "didn't", "won't", "isn't", "aren't"];
        const NEGATION_WORDS_JA = ['ない', 'じゃない', 'ではない', 'ません', 'ぬ', 'ず', 'なかった', '嫌いじゃない'];
        const NEGATION_WINDOW = 10;
        const DOMINANT_PRIORITY = ['affection', 'joy', 'sadness', 'fear', 'surprise', 'anger', 'disgust'];
        const CONTRAST_MARKERS_KO = ['지만', '는데', '그러나', '하지만', '근데', '다만'];
        const CONTRAST_MARKERS_EN = ['but', 'however', 'though', 'although', 'yet', 'still'];
        const CONTRAST_MARKERS_JA = ['けど', 'けれど', 'しかし', 'でも', 'ただ'];

        const hasNegationNearby = (text, matchIndex) => {
            const start = Math.max(0, matchIndex - NEGATION_WINDOW);
            const end = Math.min(text.length, matchIndex + NEGATION_WINDOW);
            const context = text.slice(start, end);
            if (NEGATION_WORDS_KO.some(neg => context.includes(neg))) return true;
            if (NEGATION_WORDS_JA.some(neg => context.includes(neg))) return true;
            return NEGATION_WORDS_EN.some((neg) => {
                const escaped = neg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`\\b${escaped}\\b`, 'i').test(context);
            });
        };
        const findLatestContrastIndex = (text, matchIndex) => {
            const left = String(text || '').slice(0, Math.max(0, matchIndex));
            const markers = [...CONTRAST_MARKERS_KO, ...CONTRAST_MARKERS_EN, ...CONTRAST_MARKERS_JA];
            let latest = -1;
            for (const marker of markers) {
                const idx = left.lastIndexOf(marker);
                if (idx > latest) latest = idx;
            }
            return latest;
        };
        const applyContrastWeight = (text, matchIndex) => {
            const contrastIdx = findLatestContrastIndex(text, matchIndex);
            if (contrastIdx < 0) return 1;
            const distance = matchIndex - contrastIdx;
            if (distance <= 16) return 1.2;
            if (distance <= 36) return 1.1;
            return 1;
        };

        const analyze = (text) => {
            const lowerText = (text || "").toLowerCase();
            let score = 0;
            const emotions = { affection: 0, joy: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 };

            const keywords = {
                affection: ['애틋', '애절', '다정', '다정하', '따뜻', '포근', '소중', '아끼', '그리워', '보고 싶', '보고싶', '안아', '껴안', '손잡', '입맞', '키스', '사랑', '좋아하', '설레', '두근', '떨리', '애정', '위로', '보듬', '애증', '집착', '애달프', '애틋함', '애간장', '애잔', '울컥', '애써 웃', 'tender', 'affection', 'affectionate', 'longing', 'yearning', 'cherish', 'gentle', 'care for', 'caring', 'miss you', 'hold hands', 'hug', 'embrace', 'love', 'fond', 'obsess', 'obsession', 'achingly', 'yearn', 'pining', 'heart flutter', '切な', '愛し', '恋し', '会いた', '抱きし', '手を握', '優し', '大切', 'ぬくも', '恋'],
                joy: ['기쁘', '행복', '좋아', '웃', '미소', '즐거', '후련', '통쾌', '벅차', '안도', 'happy', 'joy', 'glad', 'smile', 'laugh', 'delighted', 'relieved', 'thrilled', 'uplifted', '嬉し', '幸せ', '好き', '笑', '楽しい', '喜び'],
                sadness: ['슬프', '우울', '눈물', '울', '먹먹', '허전', '허망', '쓸쓸', '비참', 'sad', 'depressed', 'tears', 'cry', 'miss', 'empty', 'hollow', 'heartbroken', 'grief', 'melancholy', '悲し', 'つら', '辛い', '涙', '泣', '寂し'],
                anger: ['화나', '분노', '짜증', '열받', '살기', '격분', '분개', '울분', 'angry', 'furious', 'rage', 'annoyed', 'irritated', 'livid', 'resentful', 'wrath', '怒', '腹立', '苛立', 'むかつ', 'イライラ'],
                fear: ['무서', '두려', '공포', '불안', '서늘', '오싹', '철렁', '섬뜩', '겁', 'scared', 'afraid', 'fear', 'anxious', 'terrified', 'uneasy', 'dread', 'chilling', 'ominous', '怖', '恐', '不安', '怯え', '震え'],
                surprise: ['놀라', '충격', '깜짝', '경악', '당혹', '멍해', 'surprised', 'shocked', 'astonished', 'startled', 'stunned', 'jaw dropped', 'taken aback', '驚', 'びっくり', '仰天', 'ショック'],
                disgust: ['역겨', '혐오', '싫어', '질색', '토나', '메스껍', '불쾌', 'disgusted', 'hate', 'loathe', 'revolted', 'gross', 'nauseous', 'repulsed', '嫌', '気持ち悪', 'うんざり', '吐き気', '最悪']
            };

            const keywordWeights = {
                affection: 1.2,
                joy: 1.0,
                sadness: 1.0,
                anger: 0.9,
                fear: 1.0,
                surprise: 0.9,
                disgust: 1.0
            };

            for (const [emotion, words] of Object.entries(keywords)) {
                for (const word of words) {
                    let idx = lowerText.indexOf(word);
                    while (idx !== -1) {
                        if (!hasNegationNearby(lowerText, idx)) {
                            const appliedWeight = (keywordWeights[emotion] || 1) * applyContrastWeight(lowerText, idx);
                            emotions[emotion] += appliedWeight;
                            score += appliedWeight;
                        }
                        idx = lowerText.indexOf(word, idx + 1);
                    }
                }
            }

            // 애틋함/그리움이 강한 문맥에서는 분노보다 관계 감정을 우선 반영
            if (emotions.affection > 0) {
                if (emotions.anger > 0 && emotions.affection >= emotions.anger) {
                    emotions.anger = Math.max(0, emotions.anger - (emotions.affection * 0.75));
                }
                emotions.joy += emotions.affection * 0.35;
                emotions.sadness += emotions.affection * 0.25;
            }
            if (emotions.fear > 0 && emotions.anger > 0) {
                emotions.surprise += Math.min(emotions.fear, emotions.anger) * 0.18;
            }
            if (emotions.sadness > 0 && emotions.affection > 0) {
                emotions.affection += emotions.sadness * 0.12;
            }

            const dominant = Object.entries(emotions)
                .filter(([, s]) => s > 0)
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1];
                    return DOMINANT_PRIORITY.indexOf(a[0]) - DOMINANT_PRIORITY.indexOf(b[0]);
                })[0];
            const sortedScores = Object.values(emotions).filter(v => v > 0).sort((a, b) => b - a);
            const diversityBonus = sortedScores.length >= 2 ? Math.min(0.15, (sortedScores[1] / Math.max(sortedScores[0], 0.001)) * 0.15) : 0;
            return {
                scores: emotions,
                dominant: dominant ? dominant[0] : 'neutral',
                intensity: Math.min(1, (score / 5) + diversityBonus)
            };
        };

        const formatSummary = (result, threshold = 0.35) => {
            if (!result || result.dominant === 'neutral' || (result.intensity || 0) < threshold) return '';
            return `Emotion: ${result.dominant} (${(result.intensity || 0).toFixed(2)})`;
        };

        const boostImportance = (baseImportance, result) => {
            const base = Math.max(1, Math.min(10, parseInt(baseImportance, 10) || 5));
            if (!result || result.dominant === 'neutral') return base;
            let bonus = 0;
            if ((result.intensity || 0) >= 0.35) bonus += 1;
            if ((result.intensity || 0) >= 0.65) bonus += 1;
            if (['fear', 'anger', 'surprise', 'sadness', 'affection'].includes(result.dominant)) bonus += 1;
            return Math.max(1, Math.min(10, base + bonus));
        };

        return { analyze, formatSummary, boostImportance, NEGATION_WORDS_KO, NEGATION_WORDS_EN, NEGATION_WORDS_JA };
    })();

    // ══════════════════════════════════════════════════════════════
    // [API] LLM Provider
    // ══════════════════════════════════════════════════════════════
    const isProviderProfileConfigured = (cfg = {}) => {
        const provider = String(cfg?.provider || 'openai').trim().toLowerCase();
        const modelOk = !!String(cfg?.model || '').trim();
        const keyOk = providerAllowsEmptyKey(provider) || !!String(cfg?.key || '').trim();
        const urlOk = !providerRequiresUrl(provider) || !!String(cfg?.url || '').trim();
        return modelOk && keyOk && urlOk;
    };
    const getLLMProfileConfig = (config, profile = 'primary') => {
        const baseConfig = config || {};
        const primary = baseConfig.llm || {};
        const aux = (baseConfig.auxLlm && baseConfig.auxLlm.enabled) ? baseConfig.auxLlm : {};
        const wantsAux = String(profile || 'primary').toLowerCase() === 'aux';
        const hasAux = wantsAux && isProviderProfileConfigured({ ...primary, ...aux, provider: aux.provider || primary.provider, model: aux.model || primary.model });
        const selected = hasAux
            ? {
                ...primary,
                ...aux,
                provider: aux.provider || primary.provider,
                url: aux.url || primary.url,
                key: aux.key || primary.key,
                model: aux.model || primary.model
            }
            : primary;
        return {
            config: { ...baseConfig, llm: { ...selected } },
            profile: hasAux ? 'aux' : 'primary'
        };
    };
    const isLLMProfileConfigured = (config, profile = 'primary') => {
        if (!config?.useLLM) return false;
        const resolved = getLLMProfileConfig(config, profile);
        return isProviderProfileConfigured(resolved?.config?.llm || {});
    };
    const LLMProvider = (() => {
        const call = async (config, systemPrompt, userContent, options = {}) => {
            const resolved = getLLMProfileConfig(config, options.profile || 'primary');
            const activeConfig = resolved.config;
            let providerDebugCallId = '';
            if (!activeConfig.useLLM || !isProviderProfileConfigured(activeConfig.llm || {})) {
                try {
                    ActivityDashboardCore?.recordSkippedCall?.('llm', options.debugLabel || options.label || 'not_configured');
                } catch (_) {}
                return { content: null, skipped: true, reason: 'LLM not configured' };
            }

            try {
                const providerName = activeConfig.llm.provider || 'openai';
                const provider = AutoProvider.get(providerName);
                const debugLabel = options.debugLabel || options.label || `${resolved.profile}-generic`;
                const guardedPrompt = appendInternalDataLanguageGuard(systemPrompt, activeConfig, { ...options, label: debugLabel });
                const effectiveSystemPrompt = guardedPrompt.systemPrompt;
                const effectiveOptions = guardedPrompt.applied
                    ? { ...options, internalDataLanguageGuardApplied: true, internalDataLanguageTarget: guardedPrompt.target }
                    : options;
                const startAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const flexPolicy = FlexTierPolicy.resolve(activeConfig, { ...effectiveOptions, label: debugLabel, __maintenanceTaskName: FlexTierRuntime.currentLabel?.() || '' }, resolved.profile);
                activeConfig.llm = { ...activeConfig.llm, timeout: flexPolicy.timeoutMs || activeConfig.llm.timeout, __flexPolicy: flexPolicy };
                providerDebugCallId = DebugExportManager.recordProviderCallStart({
                    profile: resolved.profile,
                    provider: providerName,
                    model: activeConfig.llm.model || '',
                    label: debugLabel,
                    domain: options.domain || options.featureDomain || 'llm',
                    streamRequested: activeConfig.llm.stream === true,
                    serviceTier: flexPolicy.serviceTier || '',
                    flexApplied: flexPolicy.flexApplied === true,
                    systemPrompt: effectiveSystemPrompt,
                    userContent
                });
                if (activeConfig.debug) {
                    recordRuntimeDebug('log', 
                        `[LIBRA][LLM] start | label=${debugLabel} | profile=${resolved.profile} | provider=${providerName} | model=${activeConfig.llm.model || ''} | url=${activeConfig.llm.url || ''} | systemChars=${String(effectiveSystemPrompt || '').length} | userChars=${String(userContent || '').length} | serviceTier=${flexPolicy.serviceTier || 'none'} | flex=${flexPolicy.flexApplied ? 'yes' : 'no'} | internalLang=${guardedPrompt.applied ? guardedPrompt.target : 'off'}`
                    );
                    recordRuntimeDebug('log', '[LIBRA][Flex] resolved service tier', FlexTierPolicy.publicTrace(flexPolicy));
                }
                try {
                    const result = await provider.callLLM(activeConfig, effectiveSystemPrompt, userContent, effectiveOptions);
                    if (result && typeof result === 'object') {
                        result.flex = FlexTierPolicy.publicTrace(flexPolicy, { actualServiceTier: result.serviceTier || '' });
                        result.stream = {
                            requested: activeConfig.llm.stream === true,
                            used: result.streamed === true,
                            provider: providerName,
                            profile: resolved.profile,
                            meta: result.streamMeta || {}
                        };
                    }
                    if (activeConfig.debug) {
                        const endAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        recordRuntimeDebug('log', 
                            `[LIBRA][LLM] success | label=${debugLabel} | profile=${resolved.profile} | provider=${providerName} | duration=${Math.max(0, Math.round(endAt - startAt))}ms | contentChars=${String(result?.content || '').length} | serviceTier=${result?.serviceTier || flexPolicy.serviceTier || 'none'} | stream=${result?.streamed === true ? 'yes' : (activeConfig.llm.stream === true ? 'requested' : 'no')}`
                        );
                    }
                    DebugExportManager.recordProviderCallFinish(providerDebugCallId, {
                        status: 'success',
                        content: DebugExportManager.textDigest(result?.content || ''),
                        usage: result?.usage || {},
                        streamUsed: result?.streamed === true,
                        streamMeta: result?.streamMeta || {},
                        serviceTier: result?.serviceTier || flexPolicy.serviceTier || ''
                    });
                    try {
                        ActivityDashboardCore?.recordLLM?.(resolved.profile, result?.usage || {}, {
                            label: debugLabel,
                            domain: options.domain || options.featureDomain || 'llm',
                            reason: options.reason || options.label || debugLabel,
                            foreground: options.dashboardForeground
                        });
                    } catch (_) {}
                    return result;
                } catch (firstError) {
                    if (!(flexPolicy.flexApplied && flexPolicy.fallbackToStandard && FlexTierPolicy.isTransientFlexError(firstError))) throw firstError;
                    const fallbackPolicy = FlexTierPolicy.withStandardFallback(flexPolicy);
                    const fallbackConfig = {
                        ...activeConfig,
                        llm: {
                            ...activeConfig.llm,
                            timeout: Math.max(Number(config?.llm?.timeout || activeConfig.llm.timeout || 120000), 120000),
                            __flexPolicy: fallbackPolicy
                        }
                    };
                    recordRuntimeDebug('warn', '[LIBRA][Flex] Flex request failed; retrying once without Flex.', FlexTierPolicy.publicTrace(flexPolicy, { error: firstError?.message || String(firstError || '') }));
                    const fallbackResult = await provider.callLLM(fallbackConfig, effectiveSystemPrompt, userContent, effectiveOptions);
                    if (fallbackResult && typeof fallbackResult === 'object') {
                        fallbackResult.flex = FlexTierPolicy.publicTrace(fallbackPolicy, { fallbackFrom: flexPolicy.serviceTier || 'flex', actualServiceTier: fallbackResult.serviceTier || '' });
                        fallbackResult.stream = {
                            requested: activeConfig.llm.stream === true,
                            used: fallbackResult.streamed === true,
                            provider: providerName,
                            profile: resolved.profile,
                            meta: fallbackResult.streamMeta || {}
                        };
                    }
                    try {
                        ActivityDashboardCore?.recordLLM?.(resolved.profile, fallbackResult?.usage || {}, {
                            label: `${debugLabel} fallback`,
                            domain: options.domain || options.featureDomain || 'llm',
                            reason: options.reason || options.label || debugLabel,
                            foreground: options.dashboardForeground
                        });
                    } catch (_) {}
                    DebugExportManager.recordProviderCallFinish(providerDebugCallId, {
                        status: 'success_fallback_standard',
                        fallbackFrom: flexPolicy.serviceTier || 'flex',
                        firstError: firstError?.message || String(firstError || ''),
                        content: DebugExportManager.textDigest(fallbackResult?.content || ''),
                        usage: fallbackResult?.usage || {},
                        streamUsed: fallbackResult?.streamed === true,
                        streamMeta: fallbackResult?.streamMeta || {},
                        serviceTier: fallbackResult?.serviceTier || fallbackPolicy.serviceTier || ''
                    });
                    return fallbackResult;
                }
            } catch (e) {
                try {
                    ActivityDashboardCore?.recordLLM?.(resolved.profile, {}, {
                        label: options.debugLabel || options.label || `${resolved.profile}-generic`,
                        domain: options.domain || options.featureDomain || 'llm',
                        reason: options.reason || options.label || 'failed',
                        foreground: options.dashboardForeground,
                        failed: true
                    });
                } catch (_) {}
                if (activeConfig.debug) {
                    recordRuntimeDebug('warn', 
                        `[LIBRA][LLM] fail | profile=${resolved.profile} | provider=${activeConfig.llm?.provider || 'openai'} | model=${activeConfig.llm?.model || ''} | url=${activeConfig.llm?.url || ''} | error=${e?.message || e}`
                    );
                }
                DebugExportManager.recordProviderCallFinish(providerDebugCallId, {
                    status: 'failed',
                    error: e?.message || String(e || ''),
                    errorName: e?.name || e?.code || ''
                });
                recordRuntimeDebug('error', '[LIBRA] LLM Provider Error:', e?.message || e);
                throw e;
            }
        };

        return { call, isConfigured: isLLMProfileConfigured };
    })();

    const LLMProviderCallTest = (() => {
        const EXPECTED_TOKEN = 'LIBRA_PROVIDER_TEST_OK';
        const TEST_TIMEOUT_MIN_MS = 5000;
        const TEST_TIMEOUT_MAX_MS = 60000;
        const now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
        const clampTimeout = (value, fallback = 30000) => {
            const n = Number(value || fallback);
            if (!Number.isFinite(n) || n <= 0) return fallback;
            return Math.max(TEST_TIMEOUT_MIN_MS, Math.min(TEST_TIMEOUT_MAX_MS, Math.floor(n)));
        };
        const cleanText = (value, limit = 180) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
        };
        const prepareConfig = (sourceConfig = {}, profile = 'primary') => {
            const cfg = safeClone(sourceConfig && typeof sourceConfig === 'object' ? sourceConfig : {}) || {};
            cfg.useLLM = true;
            cfg.llm = { ...(cfg.llm || {}) };
            cfg.auxLlm = { ...(cfg.auxLlm || {}) };
            cfg.llm.timeout = clampTimeout(cfg.llm.timeout, 30000);
            cfg.auxLlm.timeout = clampTimeout(cfg.auxLlm.timeout, 30000);
            cfg.flexTimeoutMs = TEST_TIMEOUT_MAX_MS;
            if (String(profile || 'primary').toLowerCase() === 'aux') {
                const primary = cfg.llm || {};
                const aux = cfg.auxLlm || {};
                cfg.auxLlm = {
                    ...aux,
                    enabled: true,
                    provider: aux.provider || primary.provider || 'openai',
                    url: aux.url || primary.url || '',
                    key: aux.key || primary.key || '',
                    model: aux.model || primary.model || ''
                };
            }
            return cfg;
        };
        const describeMissing = (llm = {}) => {
            const provider = String(llm.provider || 'openai').trim().toLowerCase();
            const missing = [];
            if (!String(llm.model || '').trim()) missing.push('model');
            if (!providerAllowsEmptyKey(provider) && !String(llm.key || '').trim()) missing.push('api key');
            if (providerRequiresUrl(provider) && !String(llm.url || '').trim()) missing.push('url');
            return missing;
        };
        const run = async (sourceConfig = {}, profile = 'primary') => {
            const requestedProfile = String(profile || 'primary').toLowerCase() === 'aux' ? 'aux' : 'primary';
            const testConfig = prepareConfig(sourceConfig, requestedProfile);
            const resolved = getLLMProfileConfig(testConfig, requestedProfile);
            const llm = resolved?.config?.llm || {};
            const provider = String(llm.provider || 'openai').trim().toLowerCase();
            const model = String(llm.model || '').trim();
            const missing = describeMissing(llm);
            if (!isProviderProfileConfigured(llm)) {
                return {
                    ok: false,
                    skipped: true,
                    profile: resolved?.profile || requestedProfile,
                    requestedProfile,
                    provider,
                    model,
                    error: `LLM 설정이 완성되지 않았습니다: ${missing.join(', ') || 'unknown'}`
                };
            }

            const startedAt = now();
            try {
                ActivityDashboardCore?.updateFeatureAnalysis?.({
                    domain: 'provider_test',
                    reason: requestedProfile,
                    status: 'running',
                    detail: `${provider}/${model}`,
                    source: 'llm'
                });
            } catch (_) {}
            try {
                const testMaxTokens = /ollama|glm|kimi|deepseek|gemma|qwen|gpt-oss/i.test(`${provider} ${model}`) ? 256 : 96;
                const result = await LLMProvider.call(
                    testConfig,
                    'You are a connectivity test endpoint. Put exactly LIBRA_PROVIDER_TEST_OK in the final answer. Do not include reasoning, explanations, markdown, or extra words.',
                    'Final answer only: LIBRA_PROVIDER_TEST_OK',
                    {
                        maxTokens: testMaxTokens,
                        profile: requestedProfile,
                        label: `provider-test-${requestedProfile}`,
                        debugLabel: `provider-test-${requestedProfile}`,
                        domain: 'provider_test',
                        reason: requestedProfile,
                        dashboardForeground: false,
                        realtime: true
                    }
                );
                const durationMs = Math.max(0, Math.round(now() - startedAt));
                const content = String(result?.content || '').trim();
                const ok = !result?.skipped && content.toUpperCase().includes(EXPECTED_TOKEN);
                const stream = result?.stream || {
                    requested: llm.stream === true,
                    used: result?.streamed === true,
                    provider,
                    profile: resolved?.profile || requestedProfile,
                    meta: result?.streamMeta || {}
                };
                try {
                    ActivityDashboardCore?.updateFeatureAnalysis?.({
                        domain: 'provider_test',
                        reason: requestedProfile,
                        status: ok ? 'done' : 'failed',
                        detail: ok ? `${provider}/${model} ${durationMs}ms` : cleanText(content || result?.reason || 'unexpected response', 120),
                        source: 'llm'
                    });
                } catch (_) {}
                return {
                    ok,
                    skipped: result?.skipped === true,
                    profile: stream.profile || resolved?.profile || requestedProfile,
                    requestedProfile,
                    provider: stream.provider || provider,
                    model,
                    durationMs,
                    content,
                    preview: cleanText(content, 180),
                    usage: result?.usage || {},
                    stream,
                    flex: result?.flex || {},
                    serviceTier: result?.serviceTier || result?.flex?.serviceTier || '',
                    fallbackEndpoint: result?.fallbackEndpoint || '',
                    error: ok ? '' : (result?.skipped ? result?.reason || 'LLM not configured' : '테스트 토큰이 응답에 포함되지 않았습니다.')
                };
            } catch (error) {
                const durationMs = Math.max(0, Math.round(now() - startedAt));
                const cause = error?.cause && typeof error.cause === 'object' ? error.cause : {};
                const diagnostic = Array.isArray(cause.ollamaDiagnostics)
                    ? cause.ollamaDiagnostics
                        .map(item => [
                            item?.label || '',
                            item?.done_reason ? `reason=${item.done_reason}` : '',
                            `content=${Number(item?.contentChars || 0)}`,
                            Number(item?.thinkingChars || 0) ? `thinking=${Number(item.thinkingChars || 0)}` : '',
                            Number(item?.evalCount || 0) ? `eval=${Number(item.evalCount || 0)}` : '',
                            item?.error ? `error=${item.error}` : ''
                        ].filter(Boolean).join(' '))
                        .join(' | ')
                    : '';
                try {
                    ActivityDashboardCore?.updateFeatureAnalysis?.({
                        domain: 'provider_test',
                        reason: requestedProfile,
                        status: 'failed',
                        detail: cleanText(error?.message || error, 120),
                        source: 'llm'
                    });
                } catch (_) {}
                return {
                    ok: false,
                    profile: resolved?.profile || requestedProfile,
                    requestedProfile,
                    provider,
                    model,
                    durationMs,
                    fallbackEndpoint: cause.fallbackEndpoint || '',
                    diagnostic: cleanText(diagnostic, 220),
                    error: error?.message || String(error || 'unknown error')
                };
            }
        };

        return { run, EXPECTED_TOKEN };
    })();
