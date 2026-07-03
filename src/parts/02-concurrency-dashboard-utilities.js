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
            if (this.readers <= 0) {
                this.readers = 0;
                if (isLibraDebugEnabled()) {
                    recordRuntimeDebug('warn', '[LIBRA][RWLock] readUnlock called with no active readers');
                }
                this._next();
                return;
            }
            this.readers--;
            this._next();
        }
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
    // [UTILITY] Async Task Queue
    // ══════════════════════════════════════════════════════════════
    class AsyncTaskQueue {
        constructor(maxConcurrent = 1, label = 'AsyncTaskQueue') {
            this.maxConcurrent = Math.max(1, maxConcurrent);
            this.label = label;
            this.queue = [];
            this.active = 0;
        }

        _isDebugEnabled() {
            return isLibraDebugEnabled();
        }

        _now() {
            try {
                return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            } catch {
                return Date.now();
            }
        }

        _log(message) {
            if (this._isDebugEnabled()) {
                recordRuntimeDebug('log', `[LIBRA][${this.label}] ${message}`);
            }
        }

        _notifyDashboard() {
            try {
                ActivityDashboardCore?.updateQueues?.(this.label, this.active, this.queue.length);
            } catch (_) {}
        }

        _drain() {
            while (this.active < this.maxConcurrent && this.queue.length > 0) {
                const item = this.queue.shift();
                this.active += 1;
                this._notifyDashboard();
                const startedAt = this._now();
                const queuedFor = Math.max(0, Math.round(startedAt - item.enqueuedAt));
                this._log(`start ${item.name} | queued=${queuedFor}ms | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length}`);
                Promise.resolve()
                    .then(item.task)
                    .then(item.resolve)
                    .catch(item.reject)
                    .finally(() => {
                        const finishedAt = this._now();
                        const ranFor = Math.max(0, Math.round(finishedAt - startedAt));
                        this.active -= 1;
                        this._log(`finish ${item.name} | ran=${ranFor}ms | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length}`);
                        this._notifyDashboard();
                        this._drain();
                    });
            }
        }

        enqueue(task, name = 'task') {
            return new Promise((resolve, reject) => {
                const item = { task, resolve, reject, name, enqueuedAt: this._now() };
                this.queue.push(item);
                this._log(`enqueue ${item.name} | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length}`);
                this._notifyDashboard();
                this._drain();
            });
        }

        clearPending(reason = 'cleared') {
            const dropped = this.queue.splice(0, this.queue.length);
            const normalizedReason = String(reason || 'cleared').trim() || 'cleared';
            for (const item of dropped) {
                try { item.resolve({ skipped: true, reason: normalizedReason }); } catch (_) {}
            }
            this._log(`clear pending | dropped=${dropped.length} | active=${this.active}/${this.maxConcurrent} | pending=${this.queue.length} | reason=${normalizedReason}`);
            this._notifyDashboard();
            return dropped.length;
        }

        get pendingCount() { return this.queue.length; }
        get activeCount() { return this.active; }
    }

    const FlexTierRuntime = (() => {
        const stack = [];
        const enter = (label = '') => {
            const token = { label: String(label || ''), startedAt: Date.now() };
            stack.push(token);
            return token;
        };
        const leave = (token = null) => {
            if (!stack.length) return;
            const idx = token ? stack.lastIndexOf(token) : stack.length - 1;
            if (idx >= 0) stack.splice(idx, 1);
            else stack.pop();
        };
        const currentLabel = () => stack.length ? String(stack[stack.length - 1]?.label || '') : '';
        return Object.freeze({ enter, leave, currentLabel });
    })();

    const MaintenanceLLMQueue = new AsyncTaskQueue(3, 'MaintenanceLLMQueue');
    const BackgroundMaintenanceQueue = new AsyncTaskQueue(1, 'BackgroundMaintenanceQueue');
    const runMaintenanceLLM = (task, name = 'maintenance-llm') => MaintenanceLLMQueue.enqueue(async () => {
        const token = FlexTierRuntime.enter(name);
        try {
            return await task();
        } finally {
            FlexTierRuntime.leave(token);
        }
    }, name);
    const resolveAnalysisProfile = (config = MemoryEngine?.CONFIG || {}) => {
        if (LLMProvider?.isConfigured?.(config, 'primary')) return 'primary';
        if (LLMProvider?.isConfigured?.(config, 'aux')) return 'aux';
        return 'primary';
    };
    const buildFastAnalysisProfile = (config = MemoryEngine?.CONFIG || {}, options = {}) => {
        const {
            maxCompletionTokens = 2200
        } = options || {};
        const nextConfig = safeClone(config || {});
        const targetProfile = resolveAnalysisProfile(config);
        const targetKey = targetProfile === 'aux' ? 'auxLlm' : 'llm';
        const currentProfile = (nextConfig && nextConfig[targetKey] && typeof nextConfig[targetKey] === 'object')
            ? nextConfig[targetKey]
            : {};
        nextConfig[targetKey] = {
            ...currentProfile,
            reasoningPreset: 'custom',
            reasoningEffort: 'none',
            reasoningBudgetTokens: 0,
            glmThinkingType: 'disabled',
            maxCompletionTokens: Math.min(
                maxCompletionTokens,
                Math.max(800, parseInt(currentProfile.maxCompletionTokens, 10) || maxCompletionTokens)
            )
        };
        return {
            config: nextConfig,
            profile: targetProfile
        };
    };

    const toSerializableClone = (value, seen = new WeakMap()) => {
        if (value == null) return value;
        const valueType = typeof value;
        if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value;
        if (valueType === 'bigint') return Number(value);
        if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') return undefined;
        if (seen.has(value)) return seen.get(value);
        if (value instanceof Date) return new Date(value.getTime()).toISOString();
        if (value instanceof RegExp) return String(value);
        if (Array.isArray(value)) {
            const arr = [];
            seen.set(value, arr);
            for (const item of value) {
                const cloned = toSerializableClone(item, seen);
                arr.push(cloned === undefined ? null : cloned);
            }
            return arr;
        }
        if (value instanceof Map) {
            const obj = {};
            seen.set(value, obj);
            for (const [entryKey, entryValue] of value.entries()) {
                const key = String(entryKey ?? '');
                const cloned = toSerializableClone(entryValue, seen);
                if (cloned !== undefined) obj[key] = cloned;
            }
            return obj;
        }
        if (value instanceof Set) {
            const arr = [];
            seen.set(value, arr);
            for (const entryValue of value.values()) {
                const cloned = toSerializableClone(entryValue, seen);
                if (cloned !== undefined) arr.push(cloned);
            }
            return arr;
        }
        const tag = Object.prototype.toString.call(value);
        if (/\[object (Window|HTML.+Element|Document|Event|MessagePort)\]/.test(tag)) return undefined;
        const output = {};
        seen.set(value, output);
        for (const key of Object.keys(value)) {
            const cloned = toSerializableClone(value[key], seen);
            if (cloned !== undefined) output[key] = cloned;
        }
        return output;
    };
    const safeClone = (value) => {
        if (value == null || typeof value !== 'object') return value;
        try {
            return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
        } catch (cloneError) {
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (jsonError) {
                if (isLibraDebugEnabled()) {
                    recordRuntimeDebug('warn', '[LIBRA] safeClone fallback to serializable clone', cloneError?.message || cloneError, jsonError?.message || jsonError);
                }
                return toSerializableClone(value);
            }
        }
    };
    const cloneForMutation = (value) => {
        const cloned = safeClone(value);
        if (cloned !== value || value == null || typeof value !== 'object') return cloned;
        if (Array.isArray(value)) {
            return value.map(item => safeClone(item));
        }
        return { ...value };
    };
    const DEFAULT_ACTIVITY_DASHBOARD = 'compact';
    const ACTIVITY_DASHBOARD_MODES = new Set(['off', 'compact', 'full']);
    const normalizeActivityDashboard = (value, fallback = DEFAULT_ACTIVITY_DASHBOARD) => {
        const raw = String(value || '').trim().toLowerCase();
        if (ACTIVITY_DASHBOARD_MODES.has(raw)) return raw;
        return ACTIVITY_DASHBOARD_MODES.has(String(fallback || '').trim().toLowerCase())
            ? String(fallback).trim().toLowerCase()
            : DEFAULT_ACTIVITY_DASHBOARD;
    };
    const DEFAULT_AFTER_REQUEST_MAINTENANCE_MODE = 'background';
    const AFTER_REQUEST_MAINTENANCE_MODES = new Set(['foreground', 'background']);
    const normalizeAfterRequestMaintenanceMode = (value, fallback = DEFAULT_AFTER_REQUEST_MAINTENANCE_MODE) => {
        const raw = String(value || '').trim().toLowerCase();
        if (AFTER_REQUEST_MAINTENANCE_MODES.has(raw)) return raw;
        const fb = String(fallback || '').trim().toLowerCase();
        return AFTER_REQUEST_MAINTENANCE_MODES.has(fb) ? fb : DEFAULT_AFTER_REQUEST_MAINTENANCE_MODE;
    };
    const normalizeAfterRequestForegroundTimeoutMs = (value, fallback = 45000) => {
        // V5.2.7 freeze guard: foreground afterRequest is now an opt-in compatibility mode.
        // Do not let legacy 20-minute waits pin the request pipeline or UI thread.
        const n = Number(value);
        const base = Number.isFinite(n) ? n : Number(fallback || 45000);
        return Math.max(1000, Math.min(120000, Math.round(base || 45000)));
    };
    const DEFAULT_INJECTION_BUDGET_MIN_TOKENS = 12000;
    const DEFAULT_INJECTION_BUDGET_MAX_TOKENS = 32000;
    const CUSTOM_INJECTION_BUDGET_MAX_TOKENS = 32000;
    const normalizeInjectionBudgetPreset = (value) => {
        const key = String(value || '').trim().toLowerCase();
        if (key === 'small') return 'compact';
        if (key === 'medium') return 'balanced';
        if (key === 'high') return 'large';
        if (key === 'xlarge' || key === 'ultra') return 'max';
        if (key === 'compact' || key === 'balanced' || key === 'large' || key === 'max' || key === 'custom') return key;
        return 'compact';
    };
    const clampInjectionBudgetMax = (value, options = {}) => {
        const allowExtended = options.allowExtended === true;
        const upperBound = allowExtended ? CUSTOM_INJECTION_BUDGET_MAX_TOKENS : DEFAULT_INJECTION_BUDGET_MAX_TOKENS;
        const num = Math.floor(Number(value));
        if (!Number.isFinite(num)) return upperBound;
        return Math.max(DEFAULT_INJECTION_BUDGET_MIN_TOKENS, Math.min(upperBound, num));
    };
    const getInjectionBudgetPresetTokens = (preset) => {
        const normalized = normalizeInjectionBudgetPreset(preset);
        const presetMap = {
            compact: 12000,
            balanced: 15000,
            large: 20000,
            max: 32000
        };
        return clampInjectionBudgetMax(presetMap[normalized] || DEFAULT_INJECTION_BUDGET_MAX_TOKENS);
    };
    const resolveEffectiveInjectionBudgetPreset = (config = null) => {
        const active = config || MemoryEngine?.CONFIG || {};
        return normalizeInjectionBudgetPreset(active?.injectionBudgetPreset || 'compact');
    };
    const resolveInjectionBudgetMaxTokens = (config = null) => {
        const active = config || MemoryEngine?.CONFIG || {};
        const preset = resolveEffectiveInjectionBudgetPreset(active);
        if (preset === 'custom') {
            return clampInjectionBudgetMax(active?.injectionBudgetMaxTokens ?? active?.injectionBudgetTokens, { allowExtended: true });
        }
        return getInjectionBudgetPresetTokens(preset);
    };
    const ActivityDashboardCore = (() => {
        const makeDashboardMetrics = () => ({
            runId: 0,
            currentTurn: 0,
            overallProgress: 0,
            backgroundProgress: 0,
            backgroundLabel: '대기 중',
            postprocessPhase: '',
            postprocessDetail: '',
            mainLlmCalls: 0,
            auxLlmCalls: 0,
            llmCallsThisTurn: 0,
            embeddingCalls: 0,
            tokens: { input: 0, output: 0, reasoning: 0, total: 0 },
            injectedSections: [],
            injectedPreview: [],
            queue: { llmActive: 0, llmPending: 0, bgActive: 0, bgPending: 0 },
            activeTask: '',
            backgroundTask: '',
            injectionStats: {
                usedTokens: 0,
                budgetTokens: 0,
                requiredDemand: 0,
                rankedDemand: 0,
                injectedCount: 0,
                skippedCount: 0,
                coreUsedTokens: 0,
                extensionUsedTokens: 0,
                coreRequiredDemand: 0,
                extensionRequiredDemand: 0,
                coreInjectedCount: 0,
                extensionInjectedCount: 0
            },
            plannerInjectionAudit: {
                storyAuthor: false,
                director: false,
                worldManager: false,
                patternGuard: false
            },
            featureAnalysis: {
                active: 0,
                completed: 0,
                failed: 0,
                lastKey: '',
                lastLabel: '',
                lastStatus: 'idle',
                lastDetail: '',
                lastReason: '',
                updatedAt: 0,
                modules: {}
            },
            reusedCaches: [],
            invalidatedCaches: [],
            dirtyDomains: [],
            skippedCalls: [],
            llmCallDomains: [],
            llmCallReasons: [],
            sectionBudgetTrimmed: [],
            heartbeatTick: 0
        });
        const ensureDashboardShape = (current = {}) => {
            const defaults = makeDashboardMetrics();
            for (const [key, value] of Object.entries(defaults)) {
                if (current[key] === undefined || current[key] === null) {
                    current[key] = safeClone(value);
                }
            }
            current.tokens = { ...defaults.tokens, ...(current.tokens && typeof current.tokens === 'object' ? current.tokens : {}) };
            current.queue = { ...defaults.queue, ...(current.queue && typeof current.queue === 'object' ? current.queue : {}) };
            current.injectionStats = { ...defaults.injectionStats, ...(current.injectionStats && typeof current.injectionStats === 'object' ? current.injectionStats : {}) };
            current.plannerInjectionAudit = { ...defaults.plannerInjectionAudit, ...(current.plannerInjectionAudit && typeof current.plannerInjectionAudit === 'object' ? current.plannerInjectionAudit : {}) };
            current.featureAnalysis = { ...defaults.featureAnalysis, ...(current.featureAnalysis && typeof current.featureAnalysis === 'object' ? current.featureAnalysis : {}) };
            current.overallProgress = Number(current.overallProgress || current.progress || 0);
            current.progress = Number(current.progress || current.overallProgress || 0);
            return current;
        };
        const resetRunMetrics = (current = {}) => {
            const defaults = makeDashboardMetrics();
            const previousRunId = Number(current.runId || 0);
            Object.assign(current, safeClone(defaults));
            current.runId = previousRunId + 1;
            try { current.currentTurn = Number(MemoryEngine?.getCurrentTurn?.() || MemoryState.currentTurn || 0); } catch (_) { current.currentTurn = Number(MemoryState.currentTurn || 0); }
            return current;
        };
        const state = () => {
            if (!MemoryState.activityDashboard || typeof MemoryState.activityDashboard !== 'object') {
                MemoryState.activityDashboard = {};
            }
            return ensureDashboardShape(MemoryState.activityDashboard);
        };
        const nowMs = () => Date.now();
        const clampPercent = (value, fallback = 0) => {
            const n = Number(value);
            const base = Number.isFinite(n) ? n : Number(fallback || 0);
            return Math.max(0, Math.min(100, Math.round(base)));
        };
        const text = (value = '') => String(value == null ? '' : value);
        const compactText = (value = '', limit = 180) => truncateForLLM(text(value).replace(/\s+/g, ' ').trim(), limit, '...');
        const escapeHtml = (value = '') => text(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const formatMetricCount = (value) => {
            const n = Number(value || 0);
            if (!Number.isFinite(n)) return '0';
            if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return String(Math.max(0, Math.round(n)));
        };
        const FEATURE_ANALYSIS_LABELS = Object.freeze({
            integrated_world: 'IWE Provider',
            extraction: 'Entity/Identity 분석',
            repair: 'Entity 추출 복구',
            cold_start: '통합 분석',
            knowledge_import: '지식 가져오기',
            storyAuthor: 'Story Author',
            director: 'Director',
            turnMaintenance: '턴 유지보수',
            narrative_summary: '내러티브 요약',
            entity_consolidation: '엔티티 상태 요약',
            world_consolidation: '월드 상태 요약',
            embedding: 'Embedding',
            llm: 'LLM 분석'
        });
        const normalizeFeatureAnalysisStatus = (status = '') => {
            const key = String(status || '').trim().toLowerCase();
            if (['running', 'analyzing', 'active', 'requesting'].includes(key)) return 'running';
            if (['done', 'complete', 'completed', 'success', 'succeeded', 'ok'].includes(key)) return 'done';
            if (['failed', 'fail', 'error'].includes(key)) return 'failed';
            if (['skipped', 'skip'].includes(key)) return 'skipped';
            return key || 'idle';
        };
        const getFeatureAnalysisLabel = (payload = {}) => {
            const domain = String(payload.domain || '').trim();
            const reason = String(payload.reason || '').trim();
            const key = String(payload.key || '').trim();
            return String(
                payload.label
                || FEATURE_ANALYSIS_LABELS[domain]
                || FEATURE_ANALYSIS_LABELS[reason]
                || FEATURE_ANALYSIS_LABELS[key]
                || (domain ? domain.replace(/[_-]+/g, ' ') : '')
                || (reason ? reason.replace(/[_-]+/g, ' ') : '')
                || 'LLM 분석'
            ).replace(/\s+/g, ' ').trim().slice(0, 80);
        };
        const extractUsageTokens = (usage = {}) => {
            const input = Number(
                usage.prompt_tokens
                ?? usage.input_tokens
                ?? usage.promptTokenCount
                ?? usage.inputTokenCount
                ?? usage.promptTokens
                ?? 0
            ) || 0;
            const output = Number(
                usage.completion_tokens
                ?? usage.output_tokens
                ?? usage.candidatesTokenCount
                ?? usage.outputTokenCount
                ?? usage.completionTokens
                ?? 0
            ) || 0;
            const reasoning = Number(
                usage.reasoning_tokens
                ?? usage.reasoningTokenCount
                ?? usage.thoughts_token_count
                ?? usage.thinking_tokens
                ?? usage.cached_content_token_count
                ?? 0
            ) || 0;
            const total = Number(usage.total_tokens ?? usage.totalTokenCount ?? usage.totalTokens ?? (input + output + reasoning)) || 0;
            return { input, output, reasoning, total };
        };
        const notifyRender = (current = state()) => {
            current.updatedAt = nowMs();
            current.heartbeatTick = Number(current.heartbeatTick || 0) + 1;
            render();
            if (current.visible) startTicker();
            return safeClone(current);
        };
        const readMode = (context = {}, forced = '') => {
            let configuredMode = '';
            try { configuredMode = MemoryEngine?.CONFIG?.activityDashboard || ''; } catch (_) {}
            return normalizeActivityDashboard(
                forced || context.activityDashboard || context.settings?.activityDashboard || configuredMode || state().mode,
                DEFAULT_ACTIVITY_DASHBOARD
            );
        };
        const isEnabled = (context = {}) => readMode(context) !== 'off';
        const createDefaultSteps = () => ([
            { name: '준비', status: 'pending', at: 0 },
            { name: '분석', status: 'pending', at: 0 },
            { name: '반영', status: 'pending', at: 0 },
            { name: '정리', status: 'pending', at: 0 }
        ]);
        const stepsForFlow = (flow = '') => {
            const key = text(flow).toLowerCase();
            if (/before|context|주입/.test(key)) {
                return [
                    { name: '요청 감지', status: 'pending', at: 0 },
                    { name: '스코프 동기화', status: 'pending', at: 0 },
                    { name: '리콜 검색', status: 'pending', at: 0 },
                    { name: '컨텍스트 주입', status: 'pending', at: 0 }
                ];
            }
            if (/after|commit|저장/.test(key)) {
                return [
                    { name: '응답 수집', status: 'pending', at: 0 },
                    { name: '턴 앵커', status: 'pending', at: 0 },
                    { name: '턴 안정화', status: 'pending', at: 0 },
                    { name: '커밋 저장', status: 'pending', at: 0 },
                    { name: '후처리 분석', status: 'pending', at: 0 },
                    { name: '최종 저장', status: 'pending', at: 0 }
                ];
            }
            if (/cold|reanalysis|재분석|초기/.test(key)) {
                return [
                    { name: '대화 수집', status: 'pending', at: 0 },
                    { name: '청크 분석', status: 'pending', at: 0 },
                    { name: '계층 합성', status: 'pending', at: 0 },
                    { name: '데이터 반영', status: 'pending', at: 0 }
                ];
            }
            return createDefaultSteps();
        };
        const formatPhaseLabel = (phase = '') => {
            const key = text(phase).trim();
            const labels = {
                beforeRequest: '주입 준비',
                afterRequest: '응답 후처리',
                'afterRequest:stabilize': '응답 안정화',
                'afterRequest:commit': '턴 커밋',
                'afterRequest:maintenance': '후처리 분석',
                done: '완료',
                error: '오류',
                idle: '대기'
            };
            return labels[key] || key || '대기';
        };
        const css = `
          <style>
          #libra-activity-overlay{position:fixed;right:12px;top:12px;z-index:2147483647;width:min(388px,calc(100vw - 24px));font-family:var(--risu-font-family,'Segoe UI',Inter,system-ui,sans-serif);color:#eef5ff;pointer-events:auto}
          #libra-activity-overlay .lra-card{background:linear-gradient(180deg,rgba(17,24,39,.97),rgba(8,14,26,.97));border:1px solid rgba(148,163,184,.26);border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.42),0 0 0 1px rgba(255,255,255,.04);overflow:hidden;backdrop-filter:blur(10px)}
          #libra-activity-overlay .lra-head{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;padding:9px 11px;background:linear-gradient(135deg,rgba(79,70,229,.18),rgba(14,165,233,.09));border-bottom:1px solid rgba(148,163,184,.18)}
          #libra-activity-overlay .lra-title{font-weight:850;font-size:13px;letter-spacing:0;color:#f8fbff}
          #libra-activity-overlay .lra-sub{font-size:10px;color:#93a6bf;margin-top:3px;line-height:1.28}
          #libra-activity-overlay .lra-buttons{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex:0 0 auto}
          #libra-activity-overlay button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:50px;min-height:25px;border:1px solid rgba(148,163,184,.24);border-radius:7px;background:rgba(15,23,42,.82);color:#dbeafe;font-weight:800;font-size:11px;line-height:1;padding:5px 8px;white-space:nowrap;word-break:keep-all;cursor:pointer}
          #libra-activity-overlay button:hover{border-color:rgba(56,189,248,.55);background:rgba(56,189,248,.16);color:#fff}
          #libra-activity-overlay .lra-body{padding:9px 11px 10px;display:grid;gap:8px}
          #libra-activity-overlay .lra-main{display:flex;justify-content:space-between;gap:9px;align-items:center}
          #libra-activity-overlay .lra-phase{font-weight:850;font-size:14px;color:#fff;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          #libra-activity-overlay .lra-status{border-radius:999px;background:rgba(148,163,184,.14);color:#cbd5e1;border:1px solid rgba(148,163,184,.22);padding:3px 7px;font-size:10px;font-weight:850;white-space:nowrap}
          #libra-activity-overlay .lra-status.running{background:rgba(56,189,248,.13);color:#bae6fd;border-color:rgba(56,189,248,.26)}
          #libra-activity-overlay .lra-status.ok{background:rgba(34,197,94,.13);color:#86efac;border-color:rgba(34,197,94,.28)}
          #libra-activity-overlay .lra-status.failed{background:rgba(248,113,113,.13);color:#fecaca;border-color:rgba(248,113,113,.32)}
          #libra-activity-overlay .lra-status.waiting{background:rgba(251,191,36,.13);color:#fde68a;border-color:rgba(251,191,36,.28)}
          #libra-activity-overlay .lra-bar{height:6px;border-radius:999px;background:rgba(28,42,64,.95);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.22)}
          #libra-activity-overlay .lra-bar span{display:block;height:100%;background:linear-gradient(90deg,#4f46e5,#0ea5e9,#14b8a6);width:0%;transition:width .18s ease}
          #libra-activity-overlay .lra-message{font-size:12px;color:#cbd5e1;line-height:1.34;overflow-wrap:anywhere}
          #libra-activity-overlay .lra-steps{display:grid;gap:5px}
          #libra-activity-overlay .lra-step{display:flex;justify-content:space-between;gap:7px;font-size:11px;color:#93a6bf;border:1px solid rgba(148,163,184,.13);background:rgba(8,14,26,.45);border-radius:7px;padding:5px 7px}
          #libra-activity-overlay .lra-step b{color:#dbeafe}
          #libra-activity-overlay .lra-step.done b,#libra-activity-overlay .lra-step.ok b{color:#86efac}
          #libra-activity-overlay .lra-step.running b{color:#bae6fd}
          #libra-activity-overlay .lra-step.failed b{color:#fecaca}
          #libra-activity-overlay .lra-injection{border-top:1px solid rgba(148,163,184,.18);padding-top:7px;display:grid;gap:6px}
          #libra-activity-overlay .lra-injection-head{display:flex;justify-content:space-between;gap:7px;align-items:center;font-size:11px;color:#b8c7da;font-weight:850}
          #libra-activity-overlay .lra-chipbar{display:flex;flex-wrap:wrap;gap:4px}
          #libra-activity-overlay .lra-chip{border:1px solid rgba(56,189,248,.22);background:rgba(56,189,248,.08);color:#dbeafe;border-radius:999px;padding:3px 6px;font-size:10px;font-weight:750}
          #libra-activity-overlay .lra-preview{display:grid;gap:4px}
          #libra-activity-overlay .lra-preview-item{border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.56);border-radius:7px;padding:6px 7px;font-size:10px;line-height:1.32;color:#b8c7da;word-break:keep-all;overflow-wrap:anywhere}
          #libra-activity-overlay .lra-preview-item b{display:block;color:#eef5ff;margin-bottom:2px}
          #libra-activity-overlay .lra-events{display:grid;gap:3px;border-top:1px solid rgba(148,163,184,.18);padding-top:6px}
          #libra-activity-overlay .lra-event{font-size:10px;color:#93a6bf;line-height:1.3;word-break:break-word}
          #libra-activity-overlay .lra-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
          #libra-activity-overlay.full .lra-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
          #libra-activity-overlay .lra-metric{border:1px solid rgba(148,163,184,.16);background:rgba(15,23,42,.58);border-radius:7px;padding:6px}
          #libra-activity-overlay .lra-k{font-size:9px;color:#93a6bf;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
          #libra-activity-overlay .lra-v{margin-top:2px;color:#eef5ff;font-size:13px;font-weight:900;line-height:1.12;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          #libra-activity-overlay .lra-row{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#93a6bf;line-height:1.3}
          #libra-activity-overlay .lra-row b{color:#dbeafe;text-align:right;min-width:0;overflow-wrap:anywhere}
          #libra-activity-overlay .lra-panel{border-top:1px solid rgba(148,163,184,.18);padding-top:6px;display:grid;gap:4px}
          #libra-activity-overlay .lra-panel-title{font-size:10px;color:#b8c7da;font-weight:900;letter-spacing:.06em;text-transform:uppercase}
          #libra-activity-overlay.compact .lra-events,#libra-activity-overlay.compact .lra-steps .lra-step:nth-child(n+5),#libra-activity-overlay.compact .lra-preview{display:none}
          #libra-activity-overlay.compact .lra-panel.lra-full-only{display:none}
          #libra-activity-overlay.collapsed .lra-body{display:none}
          @media(max-width:560px){#libra-activity-overlay{left:8px;right:8px;top:8px;width:auto}}
          </style>`;
        const ACTIVITY_DASHBOARD_STYLE_ID = 'libra-activity-overlay-style';
        const ensureActivityDashboardStyle = () => {
            if (typeof document === 'undefined') return false;
            if (document.getElementById(ACTIVITY_DASHBOARD_STYLE_ID)) return true;
            const host = document.head || document.body;
            if (!host) return false;
            const holder = document.createElement('div');
            holder.innerHTML = String(css || '').trim().replace(/^<style>/i, `<style id="${ACTIVITY_DASHBOARD_STYLE_ID}">`);
            const style = holder.firstElementChild;
            if (!style) return false;
            host.appendChild(style);
            return true;
        };
        let _containerRequested = false;
        const requestContainerVisible = async (mode = 'fullscreen') => {
            try {
                const runtime = RisuCompat.host('showContainer') || RisuCompat.api();
                if (typeof runtime?.showContainer === 'function') {
                    await runtime.showContainer(mode);
                    _containerRequested = true;
                }
            } catch (error) {
                if (MemoryEngine?.CONFIG?.debug) {
                    recordRuntimeDebug('warn', '[LIBRA] Activity dashboard container show failed:', error?.message || error);
                }
            }
        };
        const releaseContainerIfIdle = async () => {
            if (!_containerRequested) return;
            try {
                if (typeof document !== 'undefined') {
                    if (document.getElementById('lmai-overlay')) {
                        _containerRequested = false;
                        return;
                    }
                    if (document.getElementById('libra-activity-overlay')) return;
                }
                if (state()?.visible === true) return;
                const runtime = RisuCompat.host('hideContainer') || RisuCompat.api();
                if (typeof runtime?.hideContainer === 'function') {
                    await runtime.hideContainer();
                }
                _containerRequested = false;
            } catch (error) {
                if (MemoryEngine?.CONFIG?.debug) {
                    recordRuntimeDebug('warn', '[LIBRA] Activity dashboard container release failed:', error?.message || error);
                }
            }
        };
        const ensureNode = () => {
            if (typeof document === 'undefined' || !document.body) return null;
            ensureActivityDashboardStyle();
            let node = document.getElementById('libra-activity-overlay');
            if (node) return node;
            node = document.createElement('div');
            node.id = 'libra-activity-overlay';
            document.body.appendChild(node);
            return node;
        };
        const classForStatus = (value = '') => {
            const raw = text(value).toLowerCase();
            if (/fail|error|warn|degrad/.test(raw)) return 'failed';
            if (/ok|done|complete|settled|committed|ready|finalized|skip/.test(raw)) return 'ok';
            if (/wait|pending|queue/.test(raw)) return 'waiting';
            if (/run|start|ing|capture|build|update|analysis|commit|write|read/.test(raw)) return 'running';
            return '';
        };
        const recordEvent = (message = '') => {
            const clean = compactText(message, 160);
            if (!clean) return;
            const current = state();
            current.events = [{ at: nowMs(), message: clean }, ...(current.events || [])].slice(0, 8);
        };
        const setStep = (name = '', status = 'running') => {
            const label = compactText(name, 60);
            if (!label) return;
            const current = state();
            const list = Array.isArray(current.steps) ? [...current.steps] : [];
            const index = list.findIndex(item => item?.name === label);
            const entry = { name: label, status, at: nowMs() };
            if (index >= 0) list[index] = { ...list[index], ...entry };
            else list.push(entry);
            current.steps = list.slice(-10);
        };
        const settleOpenSteps = (status = 'done') => {
            const current = state();
            if (!Array.isArray(current.steps)) return;
            const terminal = /warn|degraded/i.test(status) ? 'warn'
                : /fail|error/i.test(status) ? 'failed'
                : /skip|cancel/i.test(status) ? 'skipped'
                : 'done';
            current.steps = current.steps.map(step => {
                const stepStatus = text(step?.status || '').toLowerCase();
                if (!step || !/run|start|ing|queue|wait|pending/.test(stepStatus)) return step;
                return { ...step, status: terminal, at: step.at || nowMs() };
            });
        };
        const stopTicker = () => {
            if (MemoryState.activityDashboardTicker) {
                clearInterval(MemoryState.activityDashboardTicker);
                MemoryState.activityDashboardTicker = null;
            }
        };
        const startTicker = () => {
            if (MemoryState.activityDashboardTicker) return;
            MemoryState.activityDashboardTicker = setInterval(() => {
                const current = state();
                if (!current.visible) {
                    stopTicker();
                    return;
                }
                render();
            }, 1000);
        };
        const hide = () => {
            const current = state();
            current.visible = false;
            current.forceVisible = false;
            if (MemoryState.activityDashboardTimer) {
                clearTimeout(MemoryState.activityDashboardTimer);
                MemoryState.activityDashboardTimer = null;
            }
            stopTicker();
            try {
                const node = typeof document !== 'undefined' ? document.getElementById('libra-activity-overlay') : null;
                if (node?.parentNode) node.remove();
            } catch (_) {}
            void releaseContainerIfIdle();
            return selfCheck();
        };
        const render = () => {
            const current = state();
            if (!current.visible) return hide();
            if (!_containerRequested) {
                void requestContainerVisible('fullscreen');
            }
            const node = ensureNode();
            if (!node) return null;
            const mode = normalizeActivityDashboard(current.mode);
            const progress = clampPercent(current.progress, 0);
            const statusClass = classForStatus(current.status);
            const elapsed = current.startedAt ? Math.max(0, Math.round((nowMs() - current.startedAt) / 1000)) : 0;
            const steps = (current.steps || []).slice(-7).map(step => `
              <div class="lra-step ${escapeHtml(classForStatus(step.status))}">
                <b>${escapeHtml(step.name)}</b><span>${escapeHtml(step.status || '')}</span>
              </div>`).join('');
            const injection = current.injection && typeof current.injection === 'object' ? current.injection : null;
            const injectionSections = Array.isArray(injection?.sections) ? injection.sections.slice(0, mode === 'full' ? 10 : 7) : [];
            const injectionChips = injectionSections.length
                ? injectionSections.map(section => `<span class="lra-chip">${escapeHtml(section.title || section.key || 'section')} · ${Number(section.chars || 0)}자</span>`).join('')
                : '<span class="lra-chip">이번 요청 주입 없음</span>';
            const injectionHtml = injection ? `
                  <div class="lra-injection">
                    <div class="lra-injection-head">
                      <span>주입 내용</span>
                      <span>${Number(injection.totalChars || 0)}자 · ${Number(injection.sectionCount || 0)}섹션</span>
                    </div>
                    <div class="lra-chipbar">${injectionChips}</div>
                  </div>` : '';
            const events = (current.events || []).slice(0, mode === 'full' ? 8 : 4).map(event => `
              <div class="lra-event">${escapeHtml(new Date(event.at || nowMs()).toLocaleTimeString())} · ${escapeHtml(event.message)}</div>`).join('');
            const stats = current.injectionStats || {};
            const tokens = current.tokens || {};
            const queue = current.queue || {};
            const feature = current.featureAnalysis || {};
            const totalLlmCalls = Number(current.mainLlmCalls || 0) + Number(current.auxLlmCalls || 0);
            const tokenLabel = formatMetricCount(tokens.total || (Number(tokens.input || 0) + Number(tokens.output || 0) + Number(tokens.reasoning || 0)));
            const foregroundActive = Number(MemoryState.afterRequestForegroundTasksByScope?.size || 0) || 0;
            const queueLabel = `LLM ${Number(queue.llmActive || 0)}+${Number(queue.llmPending || 0)} · FG ${foregroundActive} · BG ${Number(queue.bgActive || 0)}+${Number(queue.bgPending || 0)}`;
            const budgetLabel = Number(stats.budgetTokens || 0) > 0
                ? `${formatMetricCount(stats.usedTokens || 0)} / ${formatMetricCount(stats.budgetTokens || 0)}`
                : formatMetricCount(stats.usedTokens || injection?.totalTokens || 0);
            const splitBudgetLabel = `본체 ${formatMetricCount(stats.coreUsedTokens || 0)} · 서브 ${formatMetricCount(stats.extensionUsedTokens || 0)}`;
            const splitCountLabel = `본체 ${formatMetricCount(stats.coreInjectedCount || 0)} · 서브 ${formatMetricCount(stats.extensionInjectedCount || 0)}`;
            const featureLabel = feature.lastLabel
                ? `${feature.lastLabel} · ${feature.lastStatus || 'idle'}`
                : '대기';
            const plannerAudit = current.plannerInjectionAudit || {};
            const plannerLabel = `작가 ${plannerAudit.storyAuthor ? 'ON' : 'OFF'} · 감독 ${plannerAudit.director ? 'ON' : 'OFF'} · 월드 ${plannerAudit.worldManager ? 'ON' : 'OFF'} · 패턴 ${plannerAudit.patternGuard ? 'ON' : 'OFF'}`;
            const metricsHtml = `
                  <div class="lra-metrics">
                    <div class="lra-metric"><div class="lra-k">Progress</div><div class="lra-v">${progress}%</div></div>
                    <div class="lra-metric"><div class="lra-k">LLM</div><div class="lra-v">${totalLlmCalls}</div></div>
                    <div class="lra-metric"><div class="lra-k">Tokens</div><div class="lra-v">${escapeHtml(tokenLabel)}</div></div>
                    <div class="lra-metric"><div class="lra-k">Embedding</div><div class="lra-v">${Number(current.embeddingCalls || 0)}</div></div>
                    <div class="lra-metric"><div class="lra-k">Queue</div><div class="lra-v">${escapeHtml(queueLabel)}</div></div>
                    <div class="lra-metric"><div class="lra-k">Injection</div><div class="lra-v">${escapeHtml(budgetLabel)}</div></div>
                  </div>
                  <div class="lra-panel">
                    <div class="lra-panel-title">실시간 작업</div>
                    <div class="lra-row"><span>활성 작업</span><b>${escapeHtml(current.activeTask || current.backgroundTask || '없음')}</b></div>
                    <div class="lra-row"><span>후처리</span><b>${escapeHtml([current.postprocessPhase, current.postprocessDetail].filter(Boolean).join(' · ') || '없음')}</b></div>
                    <div class="lra-row"><span>백그라운드</span><b>${escapeHtml(current.backgroundLabel || '대기 중')} · ${clampPercent(current.backgroundProgress || 0)}%</b></div>
                    <div class="lra-row"><span>LLM 분석</span><b>${escapeHtml(featureLabel)}</b></div>
                  </div>
                  <div class="lra-panel lra-full-only">
                    <div class="lra-panel-title">주입/캐시 세부</div>
                    <div class="lra-row"><span>주입 토큰</span><b>${escapeHtml(splitBudgetLabel)}</b></div>
                    <div class="lra-row"><span>주입 섹션</span><b>${escapeHtml(splitCountLabel)}</b></div>
                    <div class="lra-row"><span>작가/감독/월드/패턴</span><b>${escapeHtml(plannerLabel)}</b></div>
                    <div class="lra-row"><span>재사용 캐시</span><b>${Number((current.reusedCaches || []).length)}</b></div>
                    <div class="lra-row"><span>스킵 호출</span><b>${Number((current.skippedCalls || []).length)}</b></div>
                    <div class="lra-row"><span>무효화 캐시</span><b>${Number((current.invalidatedCaches || []).length)}</b></div>
                  </div>`;
            node.className = `${mode === 'full' ? 'full' : 'compact'}${current.collapsed ? ' collapsed' : ''}`;
            ensureActivityDashboardStyle();
            node.innerHTML = `
              <div class="lra-card">
                <div class="lra-head">
                  <div>
                    <div class="lra-title">LIBRA Activity</div>
                    <div class="lra-sub">${escapeHtml(compactText(current.scopeKey || 'scope pending', 58))} · ${elapsed}s</div>
                  </div>
                  <div class="lra-buttons">
                    <button type="button" data-lra="toggle">${current.collapsed ? '펼치기' : '접기'}</button>
                    <button type="button" data-lra="hide">닫기</button>
                  </div>
                </div>
                <div class="lra-body">
                  <div class="lra-main">
                    <div class="lra-phase">${escapeHtml(formatPhaseLabel(current.phase || 'idle'))}</div>
                    <div class="lra-status ${statusClass}">${escapeHtml(current.status || 'idle')}</div>
                  </div>
                  <div class="lra-bar"><span style="width:${progress}%"></span></div>
                  <div class="lra-message"${current.message ? '' : ' style="display:none"'}>${escapeHtml(current.message || '')}</div>
                  ${metricsHtml}
                  ${steps ? `<div class="lra-steps">${steps}</div>` : ''}
                  ${injectionHtml}
                  ${events ? `<div class="lra-events">${events}</div>` : ''}
                </div>
              </div>`;
            node.querySelector('[data-lra="hide"]')?.addEventListener('click', hide);
            node.querySelector('[data-lra="toggle"]')?.addEventListener('click', () => {
                current.collapsed = !current.collapsed;
                render();
            });
            return node;
        };
        const update = (context = {}, patch = {}) => {
            const current = state();
            if (patch.forceVisible === true) current.forceVisible = true;
            const requestedMode = readMode(context, patch.mode);
            current.mode = requestedMode === 'off' && current.forceVisible === true ? 'compact' : requestedMode;
            if (requestedMode === 'off' && current.forceVisible !== true) return hide();
            if (MemoryState.activityDashboardTimer) {
                clearTimeout(MemoryState.activityDashboardTimer);
                MemoryState.activityDashboardTimer = null;
            }
            current.visible = true;
            current.scopeKey = context.scopeKey || current.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '';
            current.requestId = patch.requestId || current.requestId || '';
            current.phase = patch.phase || current.phase || 'running';
            current.status = patch.status || current.status || 'running';
            current.message = patch.message == null ? current.message : compactText(patch.message, 220);
            current.progress = patch.progress == null ? current.progress : clampPercent(patch.progress, current.progress || 0);
            current.overallProgress = patch.overallProgress == null
                ? clampPercent(current.overallProgress || current.progress || 0, current.progress || 0)
                : clampPercent(patch.overallProgress, current.overallProgress || current.progress || 0);
            current.progress = Math.max(clampPercent(current.progress, 0), clampPercent(current.overallProgress, 0));
            if (Object.prototype.hasOwnProperty.call(patch, 'activeTask')) current.activeTask = compactText(patch.activeTask || '', 120);
            if (Object.prototype.hasOwnProperty.call(patch, 'backgroundTask')) current.backgroundTask = compactText(patch.backgroundTask || '', 120);
            if (Object.prototype.hasOwnProperty.call(patch, 'backgroundLabel')) current.backgroundLabel = compactText(patch.backgroundLabel || '', 120) || current.backgroundLabel;
            if (Object.prototype.hasOwnProperty.call(patch, 'backgroundProgress')) current.backgroundProgress = clampPercent(patch.backgroundProgress, current.backgroundProgress || 0);
            if (Object.prototype.hasOwnProperty.call(patch, 'postprocessPhase')) current.postprocessPhase = compactText(patch.postprocessPhase || '', 80);
            if (Object.prototype.hasOwnProperty.call(patch, 'postprocessDetail')) current.postprocessDetail = compactText(patch.postprocessDetail || '', 140);
            current.startedAt = current.startedAt || nowMs();
            current.updatedAt = nowMs();
            current.heartbeatTick = Number(current.heartbeatTick || 0) + 1;
            current.finishedAt = /ok|done|complete|failed|skipped|warn/i.test(current.status) ? nowMs() : 0;
            if (patch.step) setStep(patch.step, patch.stepStatus || current.status);
            if (patch.event || patch.message) recordEvent(patch.event || patch.message);
            render();
            startTicker();
            return safeClone(current);
        };
        const beginRequest = (payload = {}, context = {}) => {
            const current = state();
            const flow = text(payload.flow || payload.requestType || payload.phase || '').trim();
            const startedAt = Number(payload.startedAt || payload.startAt || 0) || nowMs();
            const previousCollapsed = current.collapsed === true;
            const previousForceVisible = current.forceVisible === true;
            resetRunMetrics(current);
            current.visible = true;
            current.forceVisible = payload.forceVisible === true || previousForceVisible;
            const requestedMode = readMode(context, payload.mode);
            current.mode = requestedMode === 'off' && current.forceVisible === true ? 'compact' : requestedMode;
            if (requestedMode === 'off' && current.forceVisible !== true) return hide();
            current.phase = flow || 'manual';
            current.status = payload.status || 'running';
            current.message = compactText(payload.stageLabel || payload.title || '작업을 준비합니다.', 220);
            current.scopeKey = context.scopeKey || payload.scopeKey || MemoryState._activeScopeKey || MemoryState._activeChatId || '';
            current.requestId = payload.requestType || payload.id || current.requestId || '';
            current.progress = clampPercent(payload.progress ?? 4, 4);
            current.overallProgress = clampPercent(payload.overallProgress ?? current.progress, current.progress);
            current.startedAt = startedAt;
            current.updatedAt = nowMs();
            current.finishedAt = 0;
            current.injection = null;
            current.activeTask = compactText(payload.activeTask || payload.stageLabel || payload.title || '', 120);
            current.postprocessPhase = compactText(payload.postprocessPhase || flow || '', 80);
            current.postprocessDetail = compactText(payload.postprocessDetail || payload.stageLabel || '', 140);
            current.backgroundLabel = payload.backgroundLabel || '대기 중';
            current.collapsed = payload.collapsed === true ? true : previousCollapsed;
            current.steps = stepsForFlow(flow || payload.title).map((step, index) => ({
                ...step,
                status: index === 0 ? 'running' : 'pending',
                at: index === 0 ? startedAt : 0
            }));
            current.events = [];
            recordEvent(current.message);
            render();
            startTicker();
            return safeClone(current);
        };
        const setStage = (label = '', progress = 0, patch = {}, context = {}) => update(context, {
            phase: patch.phase || state().phase || 'manual',
            status: patch.status || 'running',
            progress,
            step: patch.activeTask || label,
            stepStatus: patch.stepStatus || 'running',
            message: label,
            event: patch.event,
            forceVisible: patch.forceVisible === true
        });
        const recordInjection = (context = {}, summary = {}) => {
            const current = state();
            current.injection = summary && typeof summary === 'object' ? safeClone(summary) : null;
            if (!current.injection) return null;
            const sections = Array.isArray(current.injection.sections) ? current.injection.sections : [];
            current.injectedSections = Array.isArray(current.injection.sectionTitles)
                ? current.injection.sectionTitles.slice(0, 18)
                : sections.map(section => section?.title || section?.key || '').filter(Boolean).slice(0, 18);
            current.injectedPreview = sections
                .filter(section => section?.preview)
                .slice(0, 8)
                .map(section => ({
                    title: section.title || section.key || 'section',
                    preview: compactText(section.preview || '', 240)
                }));
            const injectedStats = current.injection.injectionStats && typeof current.injection.injectionStats === 'object'
                ? current.injection.injectionStats
                : {};
            current.injectionStats = {
                ...current.injectionStats,
                ...injectedStats,
                usedTokens: Number(injectedStats.usedTokens || current.injection.totalTokens || current.injection.usedTokens || current.injectionStats.usedTokens || 0),
                budgetTokens: Number(injectedStats.budgetTokens || current.injection.budgetTokens || current.injectionStats.budgetTokens || 0),
                injectedCount: Number(injectedStats.injectedCount || current.injection.sectionCount || sections.length || current.injectionStats.injectedCount || 0),
                skippedCount: current.injection.skipped
                    ? Number(injectedStats.skippedCount || current.injectionStats.skippedCount || 0) + 1
                    : Number(injectedStats.skippedCount || current.injectionStats.skippedCount || 0)
            };
            if (current.injection.plannerInjectionAudit && typeof current.injection.plannerInjectionAudit === 'object') {
                current.plannerInjectionAudit = {
                    ...current.plannerInjectionAudit,
                    storyAuthor: current.injection.plannerInjectionAudit.storyAuthor === true,
                    director: current.injection.plannerInjectionAudit.director === true,
                    worldManager: current.injection.plannerInjectionAudit.worldManager === true,
                    patternGuard: current.injection.plannerInjectionAudit.patternGuard === true
                };
            }
            return update(context, {
                progress: Math.max(92, Number(current.progress || 0)),
                overallProgress: Math.max(92, Number(current.overallProgress || 0)),
                step: '주입 내용',
                stepStatus: current.injection.skipped ? 'skipped' : 'done',
                message: current.injection.skipped
                    ? `주입 없음: ${current.injection.reason || '건너뜀'}`
                    : `실제 주입: ${current.injection.totalChars || 0}자, ${current.injection.sectionCount || 0}개 섹션`,
                event: current.injection.skipped
                    ? `주입 없음: ${current.injection.reason || '건너뜀'}`
                    : `주입 섹션: ${(current.injection.sectionTitles || []).slice(0, 5).join(', ') || '없음'}`
            });
        };
        const show = (payload = {}, context = {}) => {
            const current = state();
            if (!Number(current.runId || 0) || !current.visible) {
                beginRequest({
                    requestType: payload.requestType || payload.flow || 'manual-dashboard',
                    title: payload.title || '실시간 오버레이',
                    stageLabel: payload.stageLabel || payload.message || '실시간 오버레이가 준비되었습니다.',
                    progress: payload.progress ?? 8,
                    forceVisible: payload.forceVisible === true
                }, context);
            }
            return update(context, {
                phase: payload.phase || state().phase || 'manual',
                status: payload.status || state().status || 'running',
                progress: payload.progress ?? state().progress,
                message: payload.stageLabel || payload.message || state().message || '실시간 오버레이',
                activeTask: payload.activeTask || state().activeTask || '대시보드 표시',
                forceVisible: payload.forceVisible === true
            });
        };
        const setContext = (payload = {}, context = {}) => {
            const current = state();
            const rawSections = Array.isArray(payload.sections) ? payload.sections : [];
            const sections = rawSections.map((section, index) => {
                if (section && typeof section === 'object') {
                    return {
                        title: String(section.title || section.key || `section-${index + 1}`).trim(),
                        key: String(section.key || section.title || `section-${index + 1}`).trim(),
                        chars: Number(section.chars || section.length || String(section.preview || section.content || '').length || 0),
                        preview: compactText(section.preview || section.content || '', 240)
                    };
                }
                const title = String(section || '').trim();
                return { title, key: title, chars: 0, preview: '' };
            }).filter(section => section.title || section.preview).slice(0, 18);
            const preview = Array.isArray(payload.preview)
                ? payload.preview.slice(0, 8).map(item => {
                    if (item && typeof item === 'object') {
                        return {
                            title: String(item.title || item.key || 'section').trim(),
                            preview: compactText(item.preview || item.content || '', 240)
                        };
                    }
                    return { title: 'section', preview: compactText(item || '', 240) };
                }).filter(item => item.preview)
                : sections.filter(section => section.preview).slice(0, 8);
            current.injectedSections = sections.map(section => section.title || section.key).filter(Boolean).slice(0, 18);
            current.injectedPreview = preview;
            current.injection = {
                ...(current.injection && typeof current.injection === 'object' ? current.injection : {}),
                sections,
                sectionTitles: current.injectedSections,
                sectionCount: sections.length,
                totalChars: sections.reduce((sum, section) => sum + Number(section.chars || 0), 0),
                totalTokens: Number(payload.injectionStats?.usedTokens || current.injectionStats?.usedTokens || 0)
            };
            if (payload.injectionStats && typeof payload.injectionStats === 'object') {
                current.injectionStats = {
                    ...current.injectionStats,
                    usedTokens: Number(payload.injectionStats.usedTokens || 0),
                    budgetTokens: Number(payload.injectionStats.budgetTokens || 0),
                    requiredDemand: Number(payload.injectionStats.requiredDemand || 0),
                    rankedDemand: Number(payload.injectionStats.rankedDemand || 0),
                    injectedCount: Number(payload.injectionStats.injectedCount || sections.length || 0),
                    skippedCount: Number(payload.injectionStats.skippedCount || 0),
                    coreUsedTokens: Number(payload.injectionStats.coreUsedTokens || 0),
                    extensionUsedTokens: Number(payload.injectionStats.extensionUsedTokens || 0),
                    coreRequiredDemand: Number(payload.injectionStats.coreRequiredDemand || 0),
                    extensionRequiredDemand: Number(payload.injectionStats.extensionRequiredDemand || 0),
                    coreInjectedCount: Number(payload.injectionStats.coreInjectedCount || 0),
                    extensionInjectedCount: Number(payload.injectionStats.extensionInjectedCount || 0)
                };
            }
            if (payload.plannerInjectionAudit && typeof payload.plannerInjectionAudit === 'object') {
                current.plannerInjectionAudit = {
                    storyAuthor: payload.plannerInjectionAudit.storyAuthor === true,
                    director: payload.plannerInjectionAudit.director === true,
                    worldManager: payload.plannerInjectionAudit.worldManager === true,
                    patternGuard: payload.plannerInjectionAudit.patternGuard === true
                };
            }
            if (Array.isArray(payload.sectionBudgetTrimmed)) {
                current.sectionBudgetTrimmed = payload.sectionBudgetTrimmed.slice(0, 24);
            }
            return update(context, {
                phase: payload.phase || current.phase || 'before-request',
                status: payload.status || 'running',
                progress: Math.max(Number(current.progress || 0), Number(payload.progress ?? 28)),
                overallProgress: Math.max(Number(current.overallProgress || 0), Number(payload.progress ?? 28)),
                step: payload.step || '컨텍스트 주입',
                stepStatus: 'done',
                message: payload.stageLabel || '컨텍스트 주입 완료',
                activeTask: payload.activeTask || '메인 응답 생성'
            });
        };
        const updateQueues = (label = '', activeCount = 0, pendingCount = 0) => {
            const current = state();
            const queueLabel = String(label || '').trim();
            if (queueLabel === 'MaintenanceLLMQueue') {
                current.queue.llmActive = Number(activeCount || 0);
                current.queue.llmPending = Number(pendingCount || 0);
            } else if (queueLabel === 'BackgroundMaintenanceQueue') {
                current.queue.bgActive = Number(activeCount || 0);
                current.queue.bgPending = Number(pendingCount || 0);
            } else if (/llm/i.test(queueLabel)) {
                current.queue.llmActive = Number(activeCount || 0);
                current.queue.llmPending = Number(pendingCount || 0);
            } else {
                current.queue.bgActive = Number(activeCount || 0);
                current.queue.bgPending = Number(pendingCount || 0);
            }
            const queueBusy = (current.queue.llmActive + current.queue.llmPending + current.queue.bgActive + current.queue.bgPending) > 0;
            if (isEnabled() && queueBusy) {
                current.visible = true;
                current.status = current.status || 'running';
                current.phase = current.phase || 'queue';
                current.message = current.message || '큐 작업 진행 중';
            }
            return notifyRender(current);
        };
        const updateFeatureAnalysis = (payload = {}) => {
            const current = state();
            const prev = current.featureAnalysis && typeof current.featureAnalysis === 'object' ? current.featureAnalysis : makeDashboardMetrics().featureAnalysis;
            const domain = String(payload.domain || '').trim();
            const reason = String(payload.reason || '').trim();
            const rawKey = String(payload.key || [domain || 'llm', reason || payload.detail || payload.profile || payload.source || 'analysis'].filter(Boolean).join(':')).trim();
            const key = rawKey.replace(/[^\w:.-]+/g, '_').slice(0, 96) || 'llm:analysis';
            const modules = { ...(prev.modules && typeof prev.modules === 'object' ? prev.modules : {}) };
            const oldModule = modules[key] && typeof modules[key] === 'object' ? modules[key] : {};
            const status = normalizeFeatureAnalysisStatus(payload.status || oldModule.status || 'running');
            const nowTs = nowMs();
            const label = getFeatureAnalysisLabel({ ...payload, domain, reason, key });
            const detail = compactText(payload.detail || oldModule.detail || '', 120);
            const nextModule = {
                ...oldModule,
                key,
                label,
                domain,
                reason,
                profile: String(payload.profile || oldModule.profile || '').trim(),
                source: String(payload.source || oldModule.source || '').trim(),
                status,
                detail,
                startedAt: status === 'running' ? (oldModule.startedAt || nowTs) : (oldModule.startedAt || 0),
                updatedAt: nowTs,
                endedAt: ['done', 'failed', 'skipped'].includes(status) ? nowTs : 0
            };
            modules[key] = nextModule;
            const limitedEntries = Object.values(modules)
                .filter(entry => entry && typeof entry === 'object')
                .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
                .slice(0, 12);
            const nextModules = {};
            limitedEntries.forEach(entry => { nextModules[entry.key] = entry; });
            const active = limitedEntries.filter(entry => normalizeFeatureAnalysisStatus(entry.status) === 'running').length;
            const completed = limitedEntries.filter(entry => normalizeFeatureAnalysisStatus(entry.status) === 'done').length;
            const failed = limitedEntries.filter(entry => normalizeFeatureAnalysisStatus(entry.status) === 'failed').length;
            const latest = limitedEntries[0] || nextModule;
            current.featureAnalysis = {
                active,
                completed,
                failed,
                lastKey: latest.key || key,
                lastLabel: latest.label || label,
                lastStatus: latest.status || status,
                lastDetail: latest.detail || detail,
                lastReason: compactText(latest.reason || reason || '', 120),
                updatedAt: nowTs,
                modules: nextModules
            };
            if (payload.label || payload.detail) current.activeTask = compactText(payload.label || payload.detail, 120);
            if (isEnabled() && (current.visible === true || ['running', 'failed'].includes(status) || payload.show === true)) {
                current.visible = true;
            }
            return notifyRender(current);
        };
        const recordLLM = (profile = 'primary', usage = {}, meta = {}) => {
            const current = state();
            const profileKey = String(profile || 'primary').trim().toLowerCase();
            const isForeground = meta.foreground === true || (profileKey !== 'aux' && meta.foreground !== false);
            current.llmCallsThisTurn = Number(current.llmCallsThisTurn || 0) + 1;
            if (meta.domain) current.llmCallDomains = dedupeTextArray([...(current.llmCallDomains || []), String(meta.domain || '')]).slice(-12);
            if (meta.reason || meta.label) current.llmCallReasons = dedupeTextArray([...(current.llmCallReasons || []), String(meta.reason || meta.label || '')]).slice(-16);
            if (meta.domain || meta.reason || meta.label) {
                updateFeatureAnalysis({
                    domain: meta.domain || 'llm',
                    reason: meta.reason || '',
                    status: meta.failed ? 'failed' : 'done',
                    detail: meta.label || '',
                    profile: profileKey,
                    source: 'llm'
                });
            }
            if (isForeground) {
                if (profileKey === 'aux') current.auxLlmCalls = Number(current.auxLlmCalls || 0) + 1;
                else current.mainLlmCalls = Number(current.mainLlmCalls || 0) + 1;
                const tokens = extractUsageTokens(usage);
                current.tokens.input = Number(current.tokens.input || 0) + tokens.input;
                current.tokens.output = Number(current.tokens.output || 0) + tokens.output;
                current.tokens.reasoning = Number(current.tokens.reasoning || 0) + tokens.reasoning;
                current.tokens.total = Number(current.tokens.total || 0) + tokens.total;
                current.activeTask = meta.label ? compactText(meta.label, 120) : (profileKey === 'aux' ? '보조 LLM 작업' : '메인 LLM 작업');
                current.status = meta.failed ? 'failed' : 'running';
                if (isEnabled()) current.visible = true;
            }
            return notifyRender(current);
        };
        const recordEmbedding = (meta = {}) => {
            const current = state();
            const isForeground = meta.foreground !== false;
            if (isForeground) {
                current.embeddingCalls = Number(current.embeddingCalls || 0) + 1;
                current.activeTask = compactText(meta.label || 'Embedding', 120);
                if (isEnabled()) current.visible = true;
            }
            updateFeatureAnalysis({
                domain: 'embedding',
                reason: meta.cacheHit ? 'cache' : 'provider',
                status: meta.failed ? 'failed' : (meta.cacheHit ? 'skipped' : 'done'),
                detail: meta.label || '',
                source: 'embedding',
                show: isForeground && meta.cacheHit !== true
            });
            return notifyRender(current);
        };
        const recordCacheReuse = (domain = 'cache', reason = 'reused', meta = {}) => {
            const current = state();
            const label = [domain, reason].filter(Boolean).join(':');
            current.reusedCaches = dedupeTextArray([...(current.reusedCaches || []), label]).slice(-16);
            if (meta?.dirtyDomain) current.dirtyDomains = dedupeTextArray([...(current.dirtyDomains || []), String(meta.dirtyDomain)]).slice(-16);
            return notifyRender(current);
        };
        const recordSkippedCall = (domain = 'llm', reason = 'skipped', meta = {}) => {
            const current = state();
            const label = [domain, reason].filter(Boolean).join(':');
            current.skippedCalls = dedupeTextArray([...(current.skippedCalls || []), label]).slice(-16);
            if (meta?.dirtyDomain) current.dirtyDomains = dedupeTextArray([...(current.dirtyDomains || []), String(meta.dirtyDomain)]).slice(-16);
            return notifyRender(current);
        };
        const recordInvalidatedCache = (domain = 'cache', reason = 'invalidated') => {
            const current = state();
            const label = [domain, reason].filter(Boolean).join(':');
            current.invalidatedCaches = dedupeTextArray([...(current.invalidatedCaches || []), label]).slice(-16);
            return notifyRender(current);
        };
        const updateBackground = (label = '', progress = 0, taskName = null) => {
            const current = state();
            const pct = clampPercent(progress, current.backgroundProgress || 0);
            current.backgroundLabel = compactText(label || current.backgroundLabel || '백그라운드 작업', 120);
            current.backgroundProgress = pct;
            if (taskName) {
                current.backgroundTask = compactText(taskName, 120);
                current.activeTask = compactText(taskName, 120);
            }
            current.postprocessPhase = 'background';
            current.postprocessDetail = taskName ? compactText(taskName, 140) : '후속 유지보수 진행 중';
            if (pct >= 100) {
                current.status = 'done';
                current.progress = 100;
                current.overallProgress = 100;
                if (normalizeActivityDashboard(current.mode) === 'compact') {
                    if (MemoryState.activityDashboardTimer) clearTimeout(MemoryState.activityDashboardTimer);
                    MemoryState.activityDashboardTimer = setTimeout(() => hide(), 8000);
                }
            } else {
                current.status = 'background';
                current.progress = Math.max(Number(current.progress || 0), 84 + Math.round(pct * 0.15));
                current.overallProgress = current.progress;
            }
            if (isEnabled()) current.visible = true;
            return notifyRender(current);
        };
        const refresh = () => render();
        const getState = () => safeClone(state());
        const finish = (context = {}, status = 'ok', message = '완료') => {
            const current = state();
            const requestedMode = readMode(context);
            if (requestedMode === 'off' && current.forceVisible !== true) return hide();
            current.status = status;
            current.phase = /fail|error|warn|degraded/i.test(status) ? 'error' : 'done';
            current.message = compactText(message, 220);
            current.progress = status === 'failed' ? current.progress : 100;
            current.overallProgress = current.progress;
            if (/ok|done|complete|committed|ready/i.test(status)) {
                current.backgroundProgress = Math.max(Number(current.backgroundProgress || 0), 100);
                current.backgroundLabel = message || current.backgroundLabel || '완료';
            }
            current.updatedAt = nowMs();
            current.heartbeatTick = Number(current.heartbeatTick || 0) + 1;
            current.finishedAt = nowMs();
            settleOpenSteps(status);
            recordEvent(message);
            render();
            if (normalizeActivityDashboard(current.mode) === 'compact') {
                MemoryState.activityDashboardTimer = setTimeout(() => hide(), 8000);
            }
            return safeClone(current);
        };
        const complete = (message = '완료', context = {}) => finish(context, 'ok', message);
        const fail = (message = '실패', context = {}) => finish(context, 'failed', message);
        const reset = () => {
            const previousRunId = Number(state().runId || 0);
            MemoryState.activityDashboard = {
                ...safeClone(makeDashboardMetrics()),
                runId: previousRunId + 1,
                visible: false,
                mode: DEFAULT_ACTIVITY_DASHBOARD,
                phase: 'idle',
                status: 'idle',
                message: '',
                scopeKey: '',
                requestId: '',
                startedAt: 0,
                updatedAt: 0,
                finishedAt: 0,
                progress: 0,
                steps: [],
                events: [],
                injection: null,
                forceVisible: false
            };
            return hide();
        };
        const selfCheck = (context = {}) => {
            const current = state();
            const normalizedMode = readMode(context);
            const mode = normalizedMode === 'off' && current.forceVisible === true ? 'compact' : normalizedMode;
            return {
                enabled: mode !== 'off',
                visible: current.visible === true,
                mode,
                phase: current.phase || 'idle',
                status: current.status || 'idle',
                progress: clampPercent(current.progress, 0),
                scopeKey: current.scopeKey || '',
                startedAt: current.startedAt || 0,
                updatedAt: current.updatedAt || 0,
                elapsedSeconds: current.startedAt ? Math.max(0, Math.round((nowMs() - current.startedAt) / 1000)) : 0,
                eventCount: current.events?.length || 0,
                stepCount: current.steps?.length || 0,
                queue: safeClone(current.queue || {}),
                llmCallsThisTurn: Number(current.llmCallsThisTurn || 0),
                mainLlmCalls: Number(current.mainLlmCalls || 0),
                auxLlmCalls: Number(current.auxLlmCalls || 0),
                embeddingCalls: Number(current.embeddingCalls || 0),
                tokens: safeClone(current.tokens || {}),
                backgroundProgress: clampPercent(current.backgroundProgress || 0, 0),
                backgroundLabel: current.backgroundLabel || '',
                featureAnalysis: safeClone(current.featureAnalysis || {}),
                hasInjectionSummary: !!current.injection,
                lastInjectionChars: Number(current.injection?.totalChars || 0),
                lastInjectionSections: Array.isArray(current.injection?.sections) ? current.injection.sections.map(section => section.title || section.key).slice(0, 12) : []
            };
        };
        return Object.freeze({
            isEnabled,
            beginRequest,
            show,
            setContext,
            setStage,
            complete,
            fail,
            update,
            updateQueues,
            recordLLM,
            recordEmbedding,
            recordCacheReuse,
            recordSkippedCall,
            recordInvalidatedCache,
            updateFeatureAnalysis,
            updateBackground,
            recordInjection,
            finish,
            hide,
            reset,
            refresh,
            getState,
            render,
            selfCheck
        });
    })();
    try {
        if (typeof globalThis !== 'undefined') globalThis.LIBRA_ActivityDashboard = ActivityDashboardCore;
    } catch (_) {}
    const LIBRA_SPEECH_TONE_OPTIONS = [
        { value: '', label: '미지정' },
        { value: 'formal', label: '격식적' },
        { value: 'polite', label: '공손함' },
        { value: 'casual', label: '편안함' },
        { value: 'blunt', label: '직설적' },
        { value: 'playful', label: '장난스러움' },
        { value: 'cold', label: '차가움' },
        { value: 'gentle', label: '부드러움' }
    ];
    const LIBRA_HONORIFIC_STYLE_OPTIONS = [
        { value: '', label: '미지정' },
        { value: 'mostly_honorific', label: '주로 존댓말' },
        { value: 'mostly_casual', label: '주로 반말' },
        { value: 'mixed_by_hierarchy', label: '관계 따라 혼용' },
        { value: 'switches_by_mood', label: '기분 따라 바뀜' }
    ];
    const LIBRA_RELATION_SPEECH_OPTIONS = [
        { value: '', label: '미지정' },
        { value: 'formal_polite', label: '공손한 존댓말' },
        { value: 'measured_polite', label: '차분한 존댓말' },
        { value: 'casual_friendly', label: '편한 반말' },
        { value: 'playful_casual', label: '장난스러운 반말' },
        { value: 'blunt_casual', label: '직설적인 반말' },
        { value: 'gentle_caring', label: '다정하고 부드러움' },
        { value: 'commanding', label: '지시형 말투' }
    ];
    const SPEECH_FIELD_OPTION_MAP = {
        defaultTone: LIBRA_SPEECH_TONE_OPTIONS,
        honorificStyle: LIBRA_HONORIFIC_STYLE_OPTIONS,
        toSuperiors: LIBRA_RELATION_SPEECH_OPTIONS,
        toSubordinates: LIBRA_RELATION_SPEECH_OPTIONS,
        toPeers: LIBRA_RELATION_SPEECH_OPTIONS,
        toYounger: LIBRA_RELATION_SPEECH_OPTIONS
    };
    const normalizeSpeechSelectValue = (options, value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if ((options || []).some(option => option.value === raw)) return raw;
        const lower = raw.toLowerCase().replace(/[\s-]+/g, '_');
        if ((options || []).some(option => option.value === lower)) return lower;
        if (options === LIBRA_SPEECH_TONE_OPTIONS) {
            if (/formal|격식|정중/i.test(raw)) return 'formal';
            if (/polite|공손|존댓|높임/i.test(raw)) return 'polite';
            if (/casual|informal|편안|편한|반말/i.test(raw)) return 'casual';
            if (/blunt|direct|직설|무뚝뚝/i.test(raw)) return 'blunt';
            if (/playful|teas|jok|장난|농담/i.test(raw)) return 'playful';
            if (/cold|cool|차가|냉담/i.test(raw)) return 'cold';
            if (/gentle|soft|warm|부드럽|다정|상냥/i.test(raw)) return 'gentle';
        }
        if (options === LIBRA_HONORIFIC_STYLE_OPTIONS) {
            if (/mood|기분|감정/i.test(raw)) return 'switches_by_mood';
            if (/hierarchy|rank|status|superior|subordinate|관계|서열|상하|위계/i.test(raw)) return 'mixed_by_hierarchy';
            if (/honorific|존댓|높임|polite speech|formal speech/i.test(raw)) return 'mostly_honorific';
            if (/casual|informal|반말/i.test(raw)) return 'mostly_casual';
        }
        if (options === LIBRA_RELATION_SPEECH_OPTIONS) {
            if (/command|order|authoritative|지시|명령/i.test(raw)) return 'commanding';
            if (/gentle|caring|soft|warm|다정|부드럽|상냥/i.test(raw)) return 'gentle_caring';
            if (/playful|teas|jok|장난|농담/i.test(raw)) return 'playful_casual';
            if (/blunt|direct|직설|무뚝뚝/i.test(raw)) return 'blunt_casual';
            if (/measured|calm|reserved|차분|절제/i.test(raw)) return 'measured_polite';
            if (/casual|informal|friendly|friend|편한|친근|반말/i.test(raw)) return 'casual_friendly';
            if (/formal|polite|honorific|격식|공손|존댓|높임/i.test(raw)) return 'formal_polite';
        }
        return raw;
    };
    const normalizeSpeechStyleField = (key, value) => normalizeSpeechSelectValue(SPEECH_FIELD_OPTION_MAP[key] || [], value);
    const normalizeBiologicalSex = (value = '') => {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        const normalized = raw.toLowerCase().replace(/[\s_\-]+/g, '');
        if (/^(male|m|man|boy|masculine|남성|남자|소년|남학생|남아)$/.test(normalized)) return 'male';
        if (/^(female|f|woman|girl|feminine|여성|여자|소녀|여학생|여아)$/.test(normalized)) return 'female';
        return '';
    };
    const extractBiologicalSexFromEntityPayload = (entity = {}) => {
        const candidates = [
            entity?.sex,
            entity?.biologicalSex,
            entity?.biological_sex,
            entity?.gender,
            entity?.appearance?.sex,
            entity?.appearance?.biologicalSex,
            entity?.profile?.sex
        ];
        for (const candidate of candidates) {
            const normalized = normalizeBiologicalSex(candidate);
            if (normalized) return normalized;
        }
        return '';
    };
    const normalizeSpeechStyleObject = (speechStyle = {}) => {
        const source = speechStyle && typeof speechStyle === 'object' ? speechStyle : {};
        const normalized = {};
        const preservedNotes = Array.isArray(source.notes)
            ? source.notes.map(String).map(v => v.trim()).filter(Boolean)
            : [];
        for (const key of ['defaultTone', 'honorificStyle', 'toSuperiors', 'toSubordinates', 'toPeers', 'toYounger']) {
            const raw = String(source[key] || '').trim();
            const nextValue = normalizeSpeechStyleField(key, raw);
            normalized[key] = nextValue;
            const isKnownValue = !raw || (SPEECH_FIELD_OPTION_MAP[key] || []).some(option => option.value === raw);
            if (raw && nextValue && nextValue !== raw && !isKnownValue) {
                preservedNotes.push(`${key}: ${raw}`);
            }
        }
        normalized.notes = dedupeTextArray(preservedNotes);
        return normalized;
    };
    const renderSpeechSelectOptions = (options, currentValue) => {
        const current = String(currentValue || '').trim();
        const escOption = (value) => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const html = options.map(option => `<option value="${escOption(option.value)}"${option.value === current ? ' selected' : ''}>${escOption(option.label)}</option>`);
        if (current && !options.some(option => option.value === current)) {
            html.push(`<option value="${escOption(current)}" selected>현재 값: ${escOption(current)}</option>`);
        }
        return html.join('');
    };
    const unwrapStructuredJsonCarrier = (value) => {
        if (typeof value === 'string') return value;
        if (!value || typeof value !== 'object') return value;
        const keys = Object.keys(value);
        const providerLike = Array.isArray(value.choices)
            || Array.isArray(value.content)
            || Object.prototype.hasOwnProperty.call(value, 'output_text')
            || Object.prototype.hasOwnProperty.call(value, 'generated_text')
            || Object.prototype.hasOwnProperty.call(value, 'completion')
            || (keys.length <= 2 && (typeof value.text === 'string' || typeof value.content === 'string'));
        if (!providerLike) return value;
        const choice = Array.isArray(value.choices) ? value.choices[0] : null;
        const message = choice?.message && typeof choice.message === 'object' ? choice.message : null;
        const candidates = [
            message?.content,
            choice?.text,
            value.output_text,
            value.generated_text,
            value.completion,
            value.text,
            value.content
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) return candidate;
            if (Array.isArray(candidate)) {
                const joined = candidate
                    .map(part => typeof part === 'string' ? part : (part?.text || part?.content || ''))
                    .filter(Boolean)
                    .join('\n');
                if (joined.trim()) return joined;
            }
        }
        return value;
    };

    const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const stripUnsafeJsonKeys = (value, depth = 0) => {
        if (depth > 24) return undefined;
        if (Array.isArray(value)) {
            return value
                .map(item => stripUnsafeJsonKeys(item, depth + 1))
                .filter(item => item !== undefined);
        }
        if (value && typeof value === 'object') {
            const out = {};
            for (const [key, nested] of Object.entries(value)) {
                if (UNSAFE_JSON_KEYS.has(key)) continue;
                const cleaned = stripUnsafeJsonKeys(nested, depth + 1);
                if (cleaned !== undefined) out[key] = cleaned;
            }
            return out;
        }
        return value;
    };

    const extractJson = (text) => {
        if (!text || typeof text !== 'string') return null;
        const cleaned = Utils.stripLLMThinkingTags(text).trim();

        const sanitizeJsonCandidate = (value) => String(value || '')
            .replace(/^\uFEFF/, '')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/,\s*([}\]])/g, '$1')
            .trim();

        const parseCandidate = (candidate) => {
            const normalized = sanitizeJsonCandidate(candidate);
            if (!normalized) return null;
            try {
                const parsed = JSON.parse(normalized);
                if (typeof parsed === 'string' && /^[\s]*[\[{]/.test(parsed)) {
                    try { return JSON.parse(sanitizeJsonCandidate(parsed)); } catch {}
                }
                return parsed;
            } catch {
                return null;
            }
        };

        const findBalancedJsonValue = (source, openChar = '{', closeChar = '}') => {
            const raw = String(source || '');
            let start = -1;
            let depth = 0;
            let inString = false;
            let escaped = false;
            for (let i = 0; i < raw.length; i++) {
                const ch = raw[i];
                if (start < 0) {
                    if (ch === openChar) {
                        start = i;
                        depth = 1;
                    }
                    continue;
                }
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === '"') {
                        inString = false;
                    }
                    continue;
                }
                if (ch === '"') {
                    inString = true;
                    continue;
                }
                if (ch === openChar) depth += 1;
                else if (ch === closeChar) {
                    depth -= 1;
                    if (depth === 0) return raw.slice(start, i + 1);
                }
            }
            if (start >= 0 && depth > 0) return raw.slice(start);
            return '';
        };
        const findBalancedJsonObject = (source) => findBalancedJsonValue(source, '{', '}');
        const findBalancedJsonArray = (source) => findBalancedJsonValue(source, '[', ']');

        const tryRepairTruncatedJson = (candidate) => {
            let normalized = sanitizeJsonCandidate(candidate);
            if (!normalized.startsWith('{') && !normalized.startsWith('[')) return null;

            let inString = false;
            let escaped = false;
            let braceDepth = 0;
            let bracketDepth = 0;
            for (let i = 0; i < normalized.length; i++) {
                const ch = normalized[i];
                if (inString) {
                    if (escaped) escaped = false;
                    else if (ch === '\\') escaped = true;
                    else if (ch === '"') inString = false;
                    continue;
                }
                if (ch === '"') inString = true;
                else if (ch === '{') braceDepth += 1;
                else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
                else if (ch === '[') bracketDepth += 1;
                else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            }

            if (inString) normalized += '"';
            normalized += ']'.repeat(bracketDepth);
            normalized += '}'.repeat(braceDepth);
            normalized = normalized.replace(/,\s*([}\]])/g, '$1');
            return parseCandidate(normalized);
        };

        const direct = parseCandidate(cleaned);
        if (direct) return direct;

        const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlock) {
            const parsedCodeBlock = parseCandidate(codeBlock[1]);
            if (parsedCodeBlock) return parsedCodeBlock;
            const balancedCodeBlock = findBalancedJsonObject(codeBlock[1]);
            const repairedCodeBlock = parseCandidate(balancedCodeBlock) || tryRepairTruncatedJson(balancedCodeBlock);
            if (repairedCodeBlock) return repairedCodeBlock;
            const balancedArrayCodeBlock = findBalancedJsonArray(codeBlock[1]);
            const repairedArrayCodeBlock = parseCandidate(balancedArrayCodeBlock) || tryRepairTruncatedJson(balancedArrayCodeBlock);
            if (repairedArrayCodeBlock) return repairedArrayCodeBlock;
        }

        const balanced = findBalancedJsonObject(cleaned);
        const repairedObject = parseCandidate(balanced) || tryRepairTruncatedJson(balanced);
        if (repairedObject) return repairedObject;
        const balancedArray = findBalancedJsonArray(cleaned);
        return parseCandidate(balancedArray) || tryRepairTruncatedJson(balancedArray) || null;
    };
    const extractStructuredJson = (value) => {
        const unwrapped = unwrapStructuredJsonCarrier(value);
        const parsed = extractJson(unwrapped) || parseLooseJson(unwrapped);
        return stripUnsafeJsonKeys(parsed);
    };

    const isMeaningfulJsonContractValue = (value, depth = 0) => {
        if (value == null) return false;
        if (typeof value === 'string') {
            const text = value.trim();
            return !!text && !/^(?:none|null|undefined|unknown|n\/a|na|없음|해당 없음|정보 없음|알 수 없음|미상|no change|no changes|unchanged)$/i.test(text);
        }
        if (typeof value === 'number') return Number.isFinite(value);
        if (typeof value === 'boolean') return true;
        if (Array.isArray(value)) return value.some(item => isMeaningfulJsonContractValue(item, depth + 1));
        if (typeof value === 'object') {
            const keys = Object.keys(value).filter(key => value[key] !== undefined);
            if (keys.length === 0) return false;
            if (depth >= 8) return true;
            return keys.some(key => isMeaningfulJsonContractValue(value[key], depth + 1));
        }
        return false;
    };

    const parseValidatedStructuredJson = (text, expectedKeys = [], options = {}) => {
        const parsed = extractStructuredJson(text);
        if (!parsed || typeof parsed !== 'object') return null;
        if (Array.isArray(parsed)) {
            return options.allowArray === true && parsed.some(item => isMeaningfulJsonContractValue(item)) ? parsed : null;
        }
        const keys = Object.keys(parsed);
        if (keys.length === 0) return null;
        if (!isMeaningfulJsonContractValue(parsed)) return null;
        const expected = (Array.isArray(expectedKeys) ? expectedKeys : [])
            .map(key => String(key || '').trim())
            .filter(Boolean);
        if (expected.length > 0 && !expected.some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return null;
        return parsed;
    };

    const hasObjectShape = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const hasArrayShape = (value) => Array.isArray(value);

    const validateTurnMaintenanceJson = (parsed, includeRpLongTermLlm = false) => {
        if (!hasObjectShape(parsed)) return null;
        const allowedKeys = ['narrativeBrief', 'correction', 'storyAuthor', 'director'];
        if (includeRpLongTermLlm) allowedKeys.push('longTermMemory');
        if (!allowedKeys.some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return null;
        if (!isMeaningfulJsonContractValue(parsed)) return null;
        if (parsed.correction != null && !hasObjectShape(parsed.correction)) return null;
        if (parsed.storyAuthor != null && !hasObjectShape(parsed.storyAuthor)) return null;
        if (parsed.director != null && !hasObjectShape(parsed.director)) return null;
        if (parsed.longTermMemory != null && !hasObjectShape(parsed.longTermMemory)) return null;
        return parsed;
    };

    const parseTurnMaintenanceJson = (text, includeRpLongTermLlm = false) => validateTurnMaintenanceJson(
        parseValidatedStructuredJson(text, ['narrativeBrief', 'correction', 'storyAuthor', 'director', 'longTermMemory']),
        includeRpLongTermLlm
    );

    const validateCanonicalAnalysisPacketJson = (packet) => {
        if (!hasObjectShape(packet)) return null;
        const allowedPacketKeys = [
            'meta', 'memory', 'entity', 'world', 'narrative',
            'guidance', 'guards', 'importance'
        ];
        if (!allowedPacketKeys.some(key => Object.prototype.hasOwnProperty.call(packet, key))) return null;
        if (!isMeaningfulJsonContractValue(packet)) return null;
        for (const key of allowedPacketKeys) {
            if (packet[key] != null && !hasObjectShape(packet[key])) return null;
        }
        return packet;
    };

    const validateUnifiedAfterRequestJson = (parsed) => {
        if (!hasObjectShape(parsed)) return null;
        const compat = hasObjectShape(parsed.compat) ? parsed.compat : {};
        const canonicalPacket = validateCanonicalAnalysisPacketJson(parsed.canonicalPacket)
            || validateCanonicalAnalysisPacketJson(parsed.packet)
            || validateCanonicalAnalysisPacketJson(parsed.packet_patch)
            || validateCanonicalAnalysisPacketJson(parsed.canonical_packet)
            || validateCanonicalAnalysisPacketJson(parsed);
        const entityExtraction = parsed.entityExtraction || compat.entityExtraction;
        const maintenance = parsed.maintenance || compat.maintenance;
        if (canonicalPacket) return parsed;
        if (!hasObjectShape(entityExtraction) || !hasObjectShape(maintenance)) return null;
        const entityShapeOk = hasArrayShape(entityExtraction.entities)
            || hasArrayShape(entityExtraction.relations)
            || hasArrayShape(entityExtraction.spans)
            || hasObjectShape(entityExtraction.world);
        if (!entityShapeOk) return null;
        if (!validateTurnMaintenanceJson(maintenance, true)) return null;
        return parsed;
    };

    const parseUnifiedAfterRequestJson = (text) => validateUnifiedAfterRequestJson(
        parseValidatedStructuredJson(text, [
            'canonicalPacket', 'canonical_packet', 'packet', 'packet_patch',
            'entityExtraction', 'maintenance', 'compat',
            'meta', 'memory', 'entity', 'world', 'narrative', 'guidance', 'guards', 'importance'
        ])
    );

    const getEmbeddingDebugSnapshotSafe = () => {
        let engine = null;
        try {
            engine = MemoryEngine?.EmbeddingEngine || null;
        } catch {
            engine = null;
        }
        if (!engine || typeof engine.getDebugSnapshot !== 'function') {
            return {
                totalCalls: 0,
                cacheHits: 0,
                providerCalls: 0,
                lastProvider: '',
                lastModel: '',
                lastDims: 0,
                lastStatus: 'unavailable'
            };
        }
        try {
            return engine.getDebugSnapshot();
        } catch {
            return {
                totalCalls: 0,
                cacheHits: 0,
                providerCalls: 0,
                lastProvider: '',
                lastModel: '',
                lastDims: 0,
                lastStatus: 'error'
            };
        }
    };

    const extractLibraMetaJsonString = (raw = '') => {
        const text = String(raw || '');
        const marker = '[META:';
        const start = text.indexOf(marker);
        if (start < 0) return '';
        const jsonStart = text.indexOf('{', start + marker.length);
        if (jsonStart < 0) return '';
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = jsonStart; i < text.length; i += 1) {
            const ch = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') depth += 1;
            else if (ch === '}') {
                depth -= 1;
                if (depth === 0) return text.slice(jsonStart, i + 1);
            }
        }
        return '';
    };

    const parseLibraMetaObject = (raw = '', fallback = {}) => {
        const def = (fallback && typeof fallback === 'object') ? fallback : {};
        try {
            const metaJson = extractLibraMetaJsonString(raw);
            if (!metaJson) return { ...def };
            const parsed = JSON.parse(metaJson);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? { ...def, ...parsed }
                : { ...def };
        } catch (_) {
            return { ...def };
        }
    };

    const deriveMaxTurnFromLorebook = (lorebook) => {
        const managed = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])
            .filter(entry => entry?.comment && String(entry.comment).startsWith('lmai_'))
            .filter(entry => !['lmai_rollback_journal', 'lmai_rollback_snapshot'].includes(String(entry.comment || '').trim()));
        let maxTurn = 0;
        const consider = (value) => {
            const num = Number(value);
            if (Number.isFinite(num) && num >= 0 && num < 1000000) maxTurn = Math.max(maxTurn, Math.floor(num));
        };
        const considerObjectFields = (obj = null) => {
            if (!obj || typeof obj !== 'object') return;
            consider(obj.turn);
            consider(obj.t);
            consider(obj.currentTurn);
            consider(obj.upToTurn);
            consider(obj.lastSummaryTurn);
            consider(obj.lastConsolidationTurn);
            consider(obj.firstTurn);
            consider(obj.lastTurn);
            consider(obj.lockedTurn);
            consider(obj.finalizedTurn);
            consider(obj.turnAnchorTurn);
            consider(obj.originalTurn);
            consider(obj.maxTurn);
        };
        const considerRecentArrayObjects = (items = [], limit = 64) => {
            if (!Array.isArray(items) || !items.length) return;
            const start = Math.max(0, items.length - Math.max(1, Number(limit || 64) || 64));
            for (let i = start; i < items.length; i += 1) considerObjectFields(items[i]);
        };
        const parseJsonLike = (content = '') => {
            const text = String(content || '').trim();
            if (!text || (text[0] !== '{' && text[0] !== '[')) return null;
            try { return JSON.parse(text); } catch { return null; }
        };

        for (const entry of managed) {
            const comment = String(entry?.comment || '').trim();
            const content = String(entry?.content || '');
            if (comment === 'lmai_memory') {
                try { considerObjectFields(parseLibraMetaObject(content, {})); } catch { /* ignore malformed meta */ }
                continue;
            }
            const parsed = parseJsonLike(content);
            if (!parsed) continue;
            if (Array.isArray(parsed)) {
                considerRecentArrayObjects(parsed, 64);
                continue;
            }
            considerObjectFields(parsed);
            considerObjectFields(parsed.meta);
            considerObjectFields(parsed.state);
            considerObjectFields(parsed.source);
            considerObjectFields(parsed.stats);
            considerRecentArrayObjects(parsed.turnLog, 80);
            considerRecentArrayObjects(parsed.rows, 80);
            considerRecentArrayObjects(parsed.memories, 80);
            considerRecentArrayObjects(parsed.logs, 80);
            considerRecentArrayObjects(parsed.consolidated, 40);
            if (Array.isArray(parsed.storylines)) {
                for (const storyline of parsed.storylines.slice(-16)) {
                    considerObjectFields(storyline);
                    considerRecentArrayObjects(storyline.recentEvents, 24);
                    considerRecentArrayObjects(storyline.summaries, 24);
                    const turns = Array.isArray(storyline.turns) ? storyline.turns.slice(-24) : [];
                    for (const turn of turns) consider(turn);
                }
            }
            if (parsed.histories && typeof parsed.histories === 'object') {
                for (const history of Object.values(parsed.histories).slice(-24)) {
                    considerObjectFields(history);
                    considerRecentArrayObjects(history?.logs, 24);
                    considerRecentArrayObjects(history?.turnLog, 24);
                    considerRecentArrayObjects(history?.consolidated, 12);
                }
            }
        }

        return maxTurn;
    };
