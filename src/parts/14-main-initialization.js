// ══════════════════════════════════════════════════════════════
// [MAIN] Initialization
// ══════════════════════════════════════════════════════════════
const updateConfigFromArgs = async () => {
    const cfg = MemoryEngine.CONFIG;
    let local = {};

    try {
        const saved = await readCommonPluginSettings();
        if (saved) local = (() => { try { const p = typeof saved === 'string' ? JSON.parse(saved) : saved; return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch (_) { return {}; } })();
    } catch (e) {
        recordRuntimeDebug('warn', '[LIBRA] Config load failed:', e?.message || e);
    }

    const getVal = async (key, argName, type, parent, fallback) => {
        const localVal = parent ? local[parent]?.[key] : local[key];
        let argVal;
        try {
            argVal = await RisuCompat.getArgument(argName);
        } catch {}
        const configVal = parent ? cfg[parent]?.[key] : cfg[key];
        const hasArgVal = argVal !== undefined && argVal !== null && argVal !== '';
        const raw = hasArgVal ? argVal : localVal !== undefined ? localVal : configVal !== undefined ? configVal : fallback;

        if (raw === undefined || raw === null) return fallback;

        switch (type) {
            case 'number': { const n = Number(raw); return Number.isFinite(n) ? n : (fallback ?? configVal); }
            case 'boolean': return parseRuntimeBoolean(raw, parseRuntimeBoolean(localVal, parseRuntimeBoolean(configVal, fallback)));
            default: return String(raw);
        }
    };
    const readRuntimeArg = async (argName) => {
        try {
            const value = await RisuCompat.getArgument(argName);
            return value !== undefined && value !== null && String(value).trim() !== '' ? value : undefined;
        } catch {
            return undefined;
        }
    };
    const hasRuntimeArgValue = async (argName) => await readRuntimeArg(argName) !== undefined;
    const parseRuntimeBoolean = (raw, fallback) => {
        if (raw === undefined || raw === null) return fallback;
        if (raw === true || raw === 1) return true;
        if (raw === false || raw === 0) return false;
        const text = String(raw).trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on', 'enable', 'enabled'].includes(text)) return true;
        if (['false', '0', 'no', 'n', 'off', 'disable', 'disabled'].includes(text)) return false;
        return fallback;
    };
    const parseRuntimeNumber = (raw, fallback) => {
        if (raw === undefined || raw === null) return fallback;
        const n = Number(String(raw).trim().replace(/,/g, ''));
        return Number.isFinite(n) ? n : fallback;
    };
    const parseRuntimeRatio = (raw, fallback, options = {}) => {
        if (raw === undefined || raw === null) return fallback;
        const text = String(raw).trim();
        const hasPercent = /%$/.test(text);
        const n = parseRuntimeNumber(text.replace(/%$/, ''), NaN);
        const allowZero = options.allowZero === true;
        if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return fallback;
        if (n === 0) return 0;
        if (hasPercent) return n <= 100 ? n / 100 : fallback;
        if (n >= 1) return n <= 100 ? n / 100 : fallback;
        return n;
    };
    const normalizeRuntimeInjectionBudgetPreset = (value, fallback) => {
        const key = String(value || '').trim().toLowerCase();
        if (!key) return fallback;
        if (['small', 'compact'].includes(key)) return 'compact';
        if (['medium', 'balanced'].includes(key)) return 'balanced';
        if (['high', 'large'].includes(key)) return 'large';
        if (['xlarge', 'ultra', 'max'].includes(key)) return 'max';
        if (key === 'custom') return 'custom';
        return fallback;
    };
    const getRuntimeArgVal = async (argName, type, fallback) => {
        const raw = await readRuntimeArg(argName);
        if (raw === undefined || raw === null) return fallback;
        switch (type) {
            case 'number':
                return parseRuntimeNumber(raw, fallback);
            case 'boolean':
                return parseRuntimeBoolean(raw, fallback);
            default:
                return String(raw);
        }
    };
    const normalizeStringOption = (value, allowed, fallback) => {
        const raw = String(value || '').trim().toLowerCase();
        return allowed.includes(raw) ? raw : fallback;
    };
    const clampRuntimeNumber = (value, fallback, min, max) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    };
    const clampRuntimeInt = (value, fallback, min, max) => {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    };

    cfg.coldStartScopePreset = await getVal('coldStartScopePreset', 'cold_start_scope_preset', 'string', null, 'all');
    cfg.coldStartHistoryLimit = await getVal('coldStartHistoryLimit', 'cold_start_history_limit', 'number', null, 0);
    Object.assign(cfg, buildOptimizedHiddenSettingsDefaults({
        coldStartScopePreset: cfg.coldStartScopePreset,
        coldStartHistoryLimit: cfg.coldStartHistoryLimit
    }));
    cfg.analysisEvidenceMode = normalizeAnalysisEvidenceMode(await getVal('analysisEvidenceMode', 'analysis_evidence_mode', 'string', null, cfg.analysisEvidenceMode));
    cfg.manualOocPause = await getVal('manualOocPause', 'manual_ooc_pause', 'boolean', null, false);
    cfg.entityBlocklist = normalizeEntityBlocklistCollection(await getVal('entityBlocklist', 'entity_blocklist', 'string', null, ''));
    cfg.storyAuthorEnabled = await getVal('storyAuthorEnabled', 'story_author_enabled', 'boolean', null, false);
    cfg.storyAuthorMode = await getVal('storyAuthorMode', 'story_author_mode', 'string', null, 'disabled');
    cfg.directorEnabled = await getVal('directorEnabled', 'director_enabled', 'boolean', null, false);
    cfg.directorMode = await getVal('directorMode', 'director_mode', 'string', null, 'disabled');
    if (!cfg.storyAuthorEnabled || String(cfg.storyAuthorMode || '').toLowerCase() === 'disabled') {
        cfg.storyAuthorEnabled = false;
        cfg.storyAuthorMode = 'disabled';
    } else {
        cfg.storyAuthorEnabled = true;
    }
    if (!cfg.directorEnabled || String(cfg.directorMode || '').toLowerCase() === 'disabled') {
        cfg.directorEnabled = false;
        cfg.directorMode = 'disabled';
    } else {
        cfg.directorEnabled = true;
    }
    sanitizeMemoryRetentionConfig(cfg, 'config-load');
    {
        let activityDashboardArg;
        try { activityDashboardArg = await RisuCompat.getArgument('activity_dashboard'); } catch (_) {}
        const hasActivityDashboardArg = activityDashboardArg !== undefined && activityDashboardArg !== null && String(activityDashboardArg).trim() !== '';
        const hasSavedActivityDashboard = local && Object.prototype.hasOwnProperty.call(local, 'activityDashboard');
        const rawActivityDashboard = hasActivityDashboardArg
            ? activityDashboardArg
            : hasSavedActivityDashboard
                ? local.activityDashboard
                : 'full';
        cfg.activityDashboard = normalizeActivityDashboard(rawActivityDashboard, 'full');
    }
    cfg.internalDataLanguageMode = normalizeInternalDataLanguageMode(await getVal('internalDataLanguageMode', 'internal_data_language_mode', 'string', null, 'off'));
    cfg.internalDataLanguageDebug = await getVal('internalDataLanguageDebug', 'internal_data_language_debug', 'boolean', null, false);
    cfg.flexRoutingMode = FlexTierPolicy.normalizeRoutingMode(await getVal('flexRoutingMode', 'flex_routing_mode', 'string', null, 'off'));
    cfg.flexTimeoutMs = FlexTierPolicy.normalizeTimeout(await getVal('flexTimeoutMs', 'flex_timeout_ms', 'number', null, 600000));
    cfg.flexFallbackToStandard = await getVal('flexFallbackToStandard', 'flex_fallback_to_standard', 'boolean', null, false);
    cfg.vertexFlexMode = FlexTierPolicy.normalizeVertexFlexMode(await getVal('vertexFlexMode', 'vertex_flex_mode', 'string', null, 'provisioned_then_flex'));
    cfg.customServiceTierPassthrough = await getVal('customServiceTierPassthrough', 'custom_service_tier_passthrough', 'boolean', null, false);
    cfg.backendHosting = normalizeBackendHostingConfig({
        ...(cfg.backendHosting || {}),
        ...(local.backendHosting && typeof local.backendHosting === 'object' && !Array.isArray(local.backendHosting) ? local.backendHosting : {}),
        mode: await getVal('mode', 'backend_hosting_mode', 'string', 'backendHosting', cfg.backendHosting?.mode || 'off'),
        url: await getVal('url', 'backend_hosting_url', 'string', 'backendHosting', cfg.backendHosting?.url || ''),
        token: await getVal('token', 'backend_hosting_token', 'string', 'backendHosting', cfg.backendHosting?.token || ''),
        autoDetected: await getVal('autoDetected', 'backend_hosting_auto_detected', 'boolean', 'backendHosting', cfg.backendHosting?.autoDetected === true),
        lastDetectedAt: await getVal('lastDetectedAt', 'backend_hosting_last_detected_at', 'string', 'backendHosting', cfg.backendHosting?.lastDetectedAt || '')
    });

    cfg.llm = {
        provider: await getVal('provider', 'llm_provider', 'string', 'llm', 'openai'),
        url: await getVal('url', 'llm_url', 'string', 'llm', ''),
        key: await getVal('key', 'llm_key', 'string', 'llm', ''),
        model: await getVal('model', 'llm_model', 'string', 'llm', 'gpt-4o-mini'),
        temp: await getVal('temp', 'llm_temp', 'number', 'llm', 0.3),
        timeout: await getVal('timeout', 'llm_timeout_ms', 'number', 'llm', await getVal('timeout', 'llm_timeout', 'number', 'llm', 120000)),
        serviceTier: FlexTierPolicy.normalizeServiceTier(await getVal('serviceTier', 'llm_service_tier', 'string', 'llm', 'off')),
        reasoningPreset: await getVal('reasoningPreset', 'llm_reasoning_preset', 'string', 'llm', 'auto'),
        reasoningEffort: await getVal('reasoningEffort', 'llm_reasoning_effort', 'string', 'llm', 'none'),
        reasoningBudgetTokens: await getVal('reasoningBudgetTokens', 'llm_reasoning_budget_tokens', 'number', 'llm', DEFAULT_REASONING_BUDGET_TOKENS),
        maxCompletionTokens: await getVal('maxCompletionTokens', 'llm_max_completion_tokens', 'number', 'llm', DEFAULT_MAX_COMPLETION_TOKENS),
        glmThinkingType: await getVal('glmThinkingType', 'llm_glm_thinking', 'string', 'llm', await getVal('glmThinkingType', 'llm_glm_thinking_type', 'string', 'llm', 'enabled')),
        stream: await getVal('stream', 'llm_stream', 'boolean', 'llm', false)
    };
    cfg.auxLlm = {
        enabled: await getVal('enabled', 'aux_llm_enabled', 'boolean', 'auxLlm', false),
        provider: await getVal('provider', 'aux_llm_provider', 'string', 'auxLlm', cfg.llm.provider || 'openai'),
        url: await getVal('url', 'aux_llm_url', 'string', 'auxLlm', cfg.llm.url || ''),
        key: await getVal('key', 'aux_llm_key', 'string', 'auxLlm', ''),
        model: await getVal('model', 'aux_llm_model', 'string', 'auxLlm', cfg.llm.model || 'gpt-4o-mini'),
        temp: await getVal('temp', 'aux_llm_temp', 'number', 'auxLlm', 0.2),
        timeout: await getVal('timeout', 'aux_llm_timeout_ms', 'number', 'auxLlm', await getVal('timeout', 'aux_llm_timeout', 'number', 'auxLlm', 90000)),
        serviceTier: FlexTierPolicy.normalizeServiceTier(await getVal('serviceTier', 'aux_llm_service_tier', 'string', 'auxLlm', 'off')),
        reasoningPreset: await getVal('reasoningPreset', 'aux_llm_reasoning_preset', 'string', 'auxLlm', 'auto'),
        reasoningEffort: await getVal('reasoningEffort', 'aux_llm_reasoning_effort', 'string', 'auxLlm', 'none'),
        reasoningBudgetTokens: await getVal('reasoningBudgetTokens', 'aux_llm_reasoning_budget_tokens', 'number', 'auxLlm', DEFAULT_REASONING_BUDGET_TOKENS),
        maxCompletionTokens: await getVal('maxCompletionTokens', 'aux_llm_max_completion_tokens', 'number', 'auxLlm', DEFAULT_AUX_MAX_COMPLETION_TOKENS),
        glmThinkingType: await getVal('glmThinkingType', 'aux_llm_glm_thinking', 'string', 'auxLlm', await getVal('glmThinkingType', 'aux_llm_glm_thinking_type', 'string', 'auxLlm', 'enabled')),
        stream: await getVal('stream', 'aux_llm_stream', 'boolean', 'auxLlm', false)
    };
    if (!cfg.auxLlm.enabled || !isProviderProfileConfigured(cfg.auxLlm)) {
        cfg.auxLlm.enabled = false;
    }

    const embedProviderFallback = await getVal('provider', 'embed_provider', 'string', 'embed', 'openai');
    const embedUrlFallback = await getVal('url', 'embed_url', 'string', 'embed', '');
    const embedKeyFallback = await getVal('key', 'embed_key', 'string', 'embed', '');
    const embedModelFallback = await getVal('model', 'embed_model', 'string', 'embed', 'text-embedding-3-small');
    const embedTimeoutFallback = await getVal('timeout', 'embed_timeout', 'number', 'embed', 120000);
    cfg.embed = {
        enabled: await getVal('enabled', 'embedding_enabled', 'boolean', 'embed', true),
        provider: await getVal('provider', 'embedding_provider', 'string', 'embed', embedProviderFallback),
        url: await getVal('url', 'embedding_url', 'string', 'embed', embedUrlFallback),
        key: await getVal('key', 'embedding_key', 'string', 'embed', embedKeyFallback),
        model: await getVal('model', 'embedding_model', 'string', 'embed', embedModelFallback),
        timeout: await getVal('timeout', 'embedding_timeout_ms', 'number', 'embed', embedTimeoutFallback)
    };
    cfg.debug = await getRuntimeArgVal('debug', 'boolean', cfg.debug);
    cfg.cbsEnabled = await getRuntimeArgVal('cbs_enabled', 'boolean', cfg.cbsEnabled);
    cfg.bypassAuxRequests = await getRuntimeArgVal('bypass_aux_requests', 'boolean', cfg.bypassAuxRequests);
    cfg.responseStreamingCompatEnabled = await getRuntimeArgVal('response_streaming_compat_enabled', 'boolean', cfg.responseStreamingCompatEnabled);
    cfg.useLorebookRAG = await getRuntimeArgVal('use_lorebook_rag', 'boolean', cfg.useLorebookRAG);
    cfg.nsfwEnabled = await getRuntimeArgVal('nsfw_enabled', 'boolean', cfg.nsfwEnabled);
    cfg.sectionWorldInferenceEnabled = await getRuntimeArgVal('section_world_inference_enabled', 'boolean', cfg.sectionWorldInferenceEnabled);
    cfg.secretKnowledgeEnabled = await getRuntimeArgVal('secret_knowledge_enabled', 'boolean', cfg.secretKnowledgeEnabled);
    cfg.entityKnowledgeVaultEnabled = await getRuntimeArgVal('entity_knowledge_vault_enabled', 'boolean', cfg.entityKnowledgeVaultEnabled);
    cfg.rpLongTermMemoryEnabled = await getRuntimeArgVal('rp_long_term_memory_enabled', 'boolean', cfg.rpLongTermMemoryEnabled);
    cfg.rpLongTermLlmEnrichment = await getRuntimeArgVal('rp_long_term_llm_enrichment', 'boolean', cfg.rpLongTermLlmEnrichment);
    cfg.rpLongTermInjectionMaxChars = clampRuntimeInt(await getRuntimeArgVal('rp_long_term_injection_max_chars', 'number', cfg.rpLongTermInjectionMaxChars), cfg.rpLongTermInjectionMaxChars, 400, 12000);
    cfg.rpLongTermLongTtl = clampRuntimeInt(await getRuntimeArgVal('rp_long_term_long_ttl', 'number', cfg.rpLongTermLongTtl), cfg.rpLongTermLongTtl, 120, 100000);
    cfg.rpLongTermMediumTtl = clampRuntimeInt(await getRuntimeArgVal('rp_long_term_medium_ttl', 'number', cfg.rpLongTermMediumTtl), cfg.rpLongTermMediumTtl, 60, 50000);
    cfg.characterSourceReflectionEnabled = await getRuntimeArgVal('character_source_reflection_enabled', 'boolean', cfg.characterSourceReflectionEnabled);
    cfg.personaBindingSyncEnabled = await getRuntimeArgVal('persona_binding_sync_enabled', 'boolean', cfg.personaBindingSyncEnabled);
    cfg.backgroundMaintenanceDelayMs = clampRuntimeInt(await getRuntimeArgVal('background_maintenance_delay_ms', 'number', cfg.backgroundMaintenanceDelayMs), cfg.backgroundMaintenanceDelayMs, 0, 600000);
    cfg.maxLimit = await getRuntimeArgVal('max_limit', 'number', cfg.maxLimit);
    cfg.threshold = await getRuntimeArgVal('threshold', 'number', cfg.threshold);
    cfg.simThreshold = parseRuntimeRatio(await readRuntimeArg('sim_threshold'), cfg.simThreshold);
    cfg.gcBatchSize = await getRuntimeArgVal('gc_batch_size', 'number', cfg.gcBatchSize);
    sanitizeMemoryRetentionConfig(cfg, 'runtime-arg-override');
    cfg.worldAdjustmentMode = normalizeStringOption(
        await getRuntimeArgVal('world_adjustment_mode', 'string', cfg.worldAdjustmentMode),
        ['off', 'static', 'soft', 'dynamic', 'strict', 'hard'],
        cfg.worldAdjustmentMode || 'dynamic'
    );

    const injectionPresetArg = await readRuntimeArg('injection_budget_preset');
    const injectionMaxArg = await readRuntimeArg('injection_budget_max_tokens');
    const injectionTokensArg = injectionMaxArg === undefined ? await readRuntimeArg('injection_budget_tokens') : undefined;
    if (injectionPresetArg !== undefined) {
        cfg.injectionBudgetPreset = normalizeRuntimeInjectionBudgetPreset(injectionPresetArg, cfg.injectionBudgetPreset);
    }
    let injectionBudgetOverrideApplied = false;
    if (injectionMaxArg !== undefined || injectionTokensArg !== undefined) {
        const parsedInjectionBudget = parseRuntimeNumber(injectionMaxArg ?? injectionTokensArg, NaN);
        if (Number.isFinite(parsedInjectionBudget)) {
            cfg.injectionBudgetMaxTokens = clampInjectionBudgetMax(parsedInjectionBudget, { allowExtended: true });
            cfg.injectionBudgetTokens = cfg.injectionBudgetMaxTokens;
            if (injectionPresetArg === undefined) cfg.injectionBudgetPreset = 'custom';
            injectionBudgetOverrideApplied = true;
        }
    }
    if (!injectionBudgetOverrideApplied && cfg.injectionBudgetPreset !== 'custom') {
        cfg.injectionBudgetMaxTokens = getInjectionBudgetPresetTokens(cfg.injectionBudgetPreset);
        cfg.injectionBudgetTokens = cfg.injectionBudgetMaxTokens;
    }

    const scoringProfileArg = await readRuntimeArg('scoring_profile');
    const scoringWeightOverrides = {};
    const scoringWeightArgMap = {
        word: 'scoring_word_weight',
        char: 'scoring_char_weight',
        concept: 'scoring_concept_weight',
        lexicalCoverage: 'scoring_lexical_coverage_weight',
        focus: 'scoring_focus_weight'
    };
    for (const [key, argName] of Object.entries(scoringWeightArgMap)) {
        const raw = await readRuntimeArg(argName);
        if (raw === undefined) continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) scoringWeightOverrides[key] = n;
    }
    if (scoringProfileArg !== undefined || Object.keys(scoringWeightOverrides).length > 0) {
        cfg.scoringProfile = normalizeREScoringProfile(scoringProfileArg ?? cfg.scoringProfile);
        cfg.scoringWeights = normalizeREScoringWeights(cfg.scoringProfile, scoringWeightOverrides);
    }
    cfg.recallEvidenceGate = normalizeStringOption(
        await getRuntimeArgVal('recall_evidence_gate', 'string', cfg.recallEvidenceGate),
        ['off', 'soft', 'strict'],
        cfg.recallEvidenceGate || 'soft'
    );
    cfg.recallAnchorBonus = clampRuntimeNumber(parseRuntimeRatio(await readRuntimeArg('recall_anchor_bonus'), cfg.recallAnchorBonus, { allowZero: true }), cfg.recallAnchorBonus, 0, 1);
    cfg.recallSentenceWindowEnabled = await getRuntimeArgVal('recall_sentence_window', 'boolean', cfg.recallSentenceWindowEnabled);
    cfg.recallSentenceWindowChars = clampRuntimeInt(await getRuntimeArgVal('recall_sentence_window_chars', 'number', cfg.recallSentenceWindowChars), cfg.recallSentenceWindowChars, 80, 1200);
    cfg.recallScoringTextMaxChars = clampRuntimeInt(await getRuntimeArgVal('recall_scoring_text_max_chars', 'number', cfg.recallScoringTextMaxChars), cfg.recallScoringTextMaxChars, 160, 4000);
    cfg.recallScoringV2Enabled = await getRuntimeArgVal('recall_scoring_v2', 'boolean', cfg.recallScoringV2Enabled);
    cfg.recallDomainGuardEnabled = await getRuntimeArgVal('recall_domain_guard', 'boolean', cfg.recallDomainGuardEnabled);
    cfg.hybridMemoryEngineEnabled = await getRuntimeArgVal('hybrid_memory_engine', 'boolean', cfg.hybridMemoryEngineEnabled);
    cfg.hybridReadPathEnabled = await getRuntimeArgVal('hybrid_read_path', 'boolean', cfg.hybridReadPathEnabled);
    cfg.hybridReadPathMaxRows = clampRuntimeInt(await getRuntimeArgVal('hybrid_read_path_max_rows', 'number', cfg.hybridReadPathMaxRows), cfg.hybridReadPathMaxRows, 1, 256);
    cfg.hybridWritePathEnabled = await getRuntimeArgVal('hybrid_write_path', 'boolean', cfg.hybridWritePathEnabled);
    cfg.hybridDuplicateFastEnabled = await getRuntimeArgVal('hybrid_duplicate_fast', 'boolean', cfg.hybridDuplicateFastEnabled);
    cfg.hybridDuplicateMaxHeavy = clampRuntimeInt(await getRuntimeArgVal('hybrid_duplicate_max_heavy', 'number', cfg.hybridDuplicateMaxHeavy), cfg.hybridDuplicateMaxHeavy, 0, 200);
    cfg.hybridRollbackRowsEnabled = await getRuntimeArgVal('hybrid_rollback_rows', 'boolean', cfg.hybridRollbackRowsEnabled);
    cfg.hybridScopeIndexEnabled = await getRuntimeArgVal('hybrid_scope_index', 'boolean', cfg.hybridScopeIndexEnabled);
    cfg.libraInjectionMode = normalizeLibraInjectionMode(await getRuntimeArgVal('libra_injection_mode', 'string', cfg.libraInjectionMode));
    cfg.libraProjectionAlwaysActive = await getRuntimeArgVal('libra_projection_always_active', 'boolean', cfg.libraProjectionAlwaysActive);
    cfg.libraProjectionMaxChars = clampRuntimeInt(await getRuntimeArgVal('libra_projection_max_chars', 'number', cfg.libraProjectionMaxChars), cfg.libraProjectionMaxChars, 400, 20000);
    cfg.libraProjectionRecallBundle = normalizeLibraProjectionRecallBundle(await getRuntimeArgVal('libra_projection_recall_bundle', 'string', cfg.libraProjectionRecallBundle));
    cfg.hmeAssociativeGraphMode = normalizeStringOption(
        await getRuntimeArgVal('hme_associative_graph', 'string', cfg.hmeAssociativeGraphMode),
        ['off', 'light', 'balanced', 'deep'],
        cfg.hmeAssociativeGraphMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode
    );
    cfg.hmeGraphMaxSeeds = clampRuntimeInt(await getRuntimeArgVal('hme_graph_max_seeds', 'number', cfg.hmeGraphMaxSeeds), cfg.hmeGraphMaxSeeds, 0, 32);
    cfg.hmeGraphMaxCandidates = clampRuntimeInt(await getRuntimeArgVal('hme_graph_max_candidates', 'number', cfg.hmeGraphMaxCandidates), cfg.hmeGraphMaxCandidates, 0, 96);
    cfg.hmeGraphMaxNodes = clampRuntimeInt(await getRuntimeArgVal('hme_graph_max_nodes', 'number', cfg.hmeGraphMaxNodes), cfg.hmeGraphMaxNodes, 64, 2400);
    cfg.hmeGraphMaxEdges = clampRuntimeInt(await getRuntimeArgVal('hme_graph_max_edges', 'number', cfg.hmeGraphMaxEdges), cfg.hmeGraphMaxEdges, 128, 4096);
    cfg.hmeGraphMaxHops = clampRuntimeInt(await getRuntimeArgVal('hme_graph_max_hops', 'number', cfg.hmeGraphMaxHops), cfg.hmeGraphMaxHops, 0, 2);
    cfg.hmeGraphBonusCap = clampRuntimeNumber(parseRuntimeRatio(await readRuntimeArg('hme_graph_bonus_cap'), cfg.hmeGraphBonusCap, { allowZero: true }), cfg.hmeGraphBonusCap, 0, 0.24);
    // Hidden advanced defaults are intentionally not exposed in the GUI.
    // If an old exported/local config still carries the previous hidden defaults
    // (direct/projection_only/HME graph off), migrate them to the operational
    // default profile unless the user explicitly supplied a Risu arg.
    if (!await hasRuntimeArgValue('libra_injection_mode') && cfg.libraInjectionMode === 'direct') {
        cfg.libraInjectionMode = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode;
    }
    if (!await hasRuntimeArgValue('libra_projection_recall_bundle') && cfg.libraProjectionRecallBundle === 'projection_only') {
        cfg.libraProjectionRecallBundle = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionRecallBundle;
    }
    if (!await hasRuntimeArgValue('libra_projection_max_chars') && Number(cfg.libraProjectionMaxChars || 0) < 6400) {
        cfg.libraProjectionMaxChars = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionMaxChars;
    }
    if (!await hasRuntimeArgValue('hme_associative_graph') && cfg.hmeAssociativeGraphMode === 'off') {
        cfg.hmeAssociativeGraphMode = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeAssociativeGraphMode;
    }
    if (!await hasRuntimeArgValue('hme_graph_max_seeds') && Number(cfg.hmeGraphMaxSeeds || 0) <= 8) {
        cfg.hmeGraphMaxSeeds = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxSeeds;
    }
    if (!await hasRuntimeArgValue('hme_graph_max_candidates') && Number(cfg.hmeGraphMaxCandidates || 0) <= 16) {
        cfg.hmeGraphMaxCandidates = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxCandidates;
    }
    if (!await hasRuntimeArgValue('hme_graph_max_hops') && Number(cfg.hmeGraphMaxHops || 0) <= 1) {
        cfg.hmeGraphMaxHops = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxHops;
    }
    if (!await hasRuntimeArgValue('hme_graph_bonus_cap') && Number(cfg.hmeGraphBonusCap || 0) <= 0.15) {
        cfg.hmeGraphBonusCap = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphBonusCap;
    }
    if (!await hasRuntimeArgValue('hme_graph_max_nodes') && Number(cfg.hmeGraphMaxNodes || 0) <= 1600) {
        cfg.hmeGraphMaxNodes = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxNodes;
    }
    if (!await hasRuntimeArgValue('hme_graph_max_edges') && Number(cfg.hmeGraphMaxEdges || 0) <= 8000) {
        cfg.hmeGraphMaxEdges = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.hmeGraphMaxEdges;
    }

    cfg.hypaV3AutoReflectEnabled = await getVal('hypaV3AutoReflectEnabled', 'hypa_v3_auto_reflect_enabled', 'boolean', null, false);
    cfg.moduleLorebookReflectionEnabled = await getVal('moduleLorebookReflectionEnabled', 'module_lorebook_reflection_enabled', 'boolean', null, false);
    cfg.moduleLorebookSelectedIds = await getVal('moduleLorebookSelectedIds', 'module_lorebook_selected_ids', 'string', null, '');
};

// Initialize
(async () => {
    try {
        recordRuntimeDebug('log', '[LIBRA] LIBRA World Manager V5.3.1 Initializing...');
        await updateConfigFromArgs();
        syncManualOocPauseConfig(MemoryEngine.CONFIG, { reason: 'init' });

        if (RisuCompat.api()) {
            const char = await RisuCompat.getCharacter();
            if (char) {
                const chat = await getActiveChatForCharacter(char);
                const initialScopeKey = getChatRuntimeScopeKey(chat, char);
                // 세션 ID 생성
                MemoryState.currentSessionId = buildScopedSessionId(initialScopeKey);
                MemoryState._activeChatId = chat?.id || null;
                MemoryState._activeScopeKey = initialScopeKey;

                if (chat) {
                    const lore = MemoryEngine.getLorebook(char, chat);
                    if (Array.isArray(lore)) {
                        MemoryEngine.rebuildIndex(lore);
                        SecretKnowledgeCore.loadState(lore, {
                            scopeKey: initialScopeKey,
                            chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                        });
                        EntityKnowledgeVaultCore.loadState(lore, {
                            scopeKey: initialScopeKey,
                            chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                        });
                        TimeEngine.loadState(lore, {
                            scopeKey: initialScopeKey,
                            chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                        });
                        HierarchicalWorldManager.loadWorldGraph(lore);
                        EntityManager.rebuildCache(lore);
                        NarrativeTracker.loadState(lore);
                        StoryAuthor.loadState(lore);
                        Director.loadState(lore);
                        CharacterStateTracker.loadState(lore);
                        WorldStateTracker.loadState(lore);
                        // 저장된 메모리 중 가장 최신 턴으로 setTurn 초기화
                        const managed = MemoryEngine.getManagedEntries(lore);
                        const maxTurn = deriveMaxTurnFromLorebook(lore);
                        MemoryEngine.setTurn(maxTurn);
                    }
                }
            }
        }

        MemoryState.isInitialized = true;
        // V4.2-hybrid commits turns from afterRequest immediately and retries pending anchors in beforeRequest.
            const activeCfg = MemoryEngine.CONFIG;
        const embedStatus = isProviderProfileConfigured(activeCfg.embed || {}) ? `${activeCfg.embed.provider}/${activeCfg.embed.model}` : 'disabled (fallback to strengthened Jaccard)';
        recordRuntimeDebug('log', `[LIBRA] LIBRA World Manager V5.3.1 Ready. LLM=${activeCfg.useLLM} | Mode=${activeCfg.weightMode} | MemoryLimit=${activeCfg.maxLimit} | GC=${activeCfg.gcBatchSize} | Embed=${embedStatus}`);
        
        // Memory Carry-Over 및 Cold Start 감지 실행
        if (RisuCompat.api() && !isLibraManualOocPauseEnabled(MemoryEngine.CONFIG)) {
            setTimeout(async () => {
                if (isLibraManualOocPauseEnabled(MemoryEngine.CONFIG)) return;

                await ColdStartManager.check();
            }, 2000);
        } else if (RisuCompat.api() && MemoryEngine.CONFIG?.debug) {
            recordRuntimeDebug('log', '[LIBRA] ColdStart timer skipped: manual OOC pause');
        }
    } catch (e) {
        recordRuntimeDebug('error', "[LIBRA] Init Error:", e?.message || e);
    }
})();
