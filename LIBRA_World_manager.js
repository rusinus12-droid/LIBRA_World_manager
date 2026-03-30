//@name libra_world_manager
//@display-name LIBRA World Manager
//@author rusinus12@gmail.com
//@api 3.0
//@version 2.4.0

(async () => {
    // ══════════════════════════════════════════════════════════════
    // [CORE] Error Handler
    // ══════════════════════════════════════════════════════════════
    class LIBRAError extends Error {
        constructor(message, code, cause = null) {
            super(message);
            this.name = 'LIBRAError';
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
        rollbackTracker: new Map(), // { msg_id: [lore_keys] }
        currentSessionId: null,
        isSessionRestored: false,
        ignoredGreetingId: null,
        isInitialized: false,
        currentTurn: 0,
        initVersion: 0,

        reset() {
            this.gcCursor = 0;
            this.hashIndex.clear();
            this.metaCache?.cache?.clear();
            this.simCache?.cache?.clear();
            this.sessionCache.clear();
            this.rollbackTracker.clear();
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
    // [UTILITY] Global Utilities
    // ══════════════════════════════════════════════════════════════
    const Utils = {
        confirmEx: (msg) => new Promise(res => {
            setTimeout(() => res(window.confirm(msg)), 0);
        }),
        alertEx: (msg) => new Promise(res => {
            setTimeout(() => { window.alert(msg); res(); }, 0);
        }),
        sleep: (ms) => new Promise(res => setTimeout(res, ms)),
        
        sanitizeForLibra: (text) => {
            if (!MemoryEngine.CONFIG.enableModuleCompat || !text) return text;
            
            let clean = String(text);
            
            // 1. GigaTrans 제거
            clean = clean.replace(/<GT-SEP\/>/gi, '');
            clean = clean.replace(/<GigaTrans>[\s\S]*?<\/GigaTrans>/gi, '');
            
            // 2. 라이트보드 제거
            clean = clean.replace(/\[LBDATA START\][\s\S]*?\[LBDATA END\]/gi, '');
            clean = clean.replace(/\[Lightboard Platform Managed\]/gi, '');
            
            const result = clean.trim();
            if (MemoryEngine.CONFIG.debug && result !== text.trim()) {
                console.log(`[LIBRA] Text sanitized (Module compatibility active)`);
            }
            return result;
        }
    };

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Cold Start Manager
    // ══════════════════════════════════════════════════════════════
    const ColdStartManager = (() => {
        let isProcessing = false;

        const ColdStartSummaryPrompt = `당신은 과거 대화 내역을 분석하여 핵심 요약을 생성하는 전문가입니다.
제공된 대화 청크를 분석하여 다음 정보를 JSON 형식으로 추출하십시오.

{
    "events": ["주요 사건 리스트"],
    "characters": [
        { "name": "이름", "details": "외모/성격/배경 요약" }
    ],
    "relationships": [
        { "pair": ["A", "B"], "status": "관계 요약" }
    ],
    "world_rules": ["감지된 세계관 규칙"]
}

주의: 반드시 유효한 JSON 구조만 반환하십시오. 다른 설명은 생략하십시오.`;

        const FinalSynthesisPrompt = `당신은 여러 개의 대화 요약본을 하나로 통합하는 마스터 편집자입니다.
분할된 요약 데이터들을 바탕으로, 이 채팅방의 현재 상태를 정의하는 최종 보고서를 JSON 형식으로 작성하십시오.

반환 형식:
{
    "narrative": "전체 줄거리 요약",
    "entities": [ { "name": "이름", "appearance": "외모", "personality": "성격", "background": "배경" } ],
    "relations": [ { "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태" } ],
    "world": { "tech": "기술수준", "rules": ["규칙들"] }
}

주의: 반드시 JSON만 반환하십시오.`;

        const check = async () => {
            if (isProcessing) return;
            
            const char = await risuai.getCharacter();
            if (!char) return;

            const chat = char.chats?.[char.chatPage];
            if (!chat || !chat.msgs || chat.msgs.length < 5) return;

            const lore = chat.localLore || char.lorebook || [];
            const hasLibraData = lore.some(e => 
                e.comment === "lmai_world_graph" || 
                e.comment === "lmai_narrative_tracker"
            );

            if (!hasLibraData) {
                const confirmed = await Utils.confirmEx(
                    "이 채팅방에서 LIBRA가 처음 실행되었습니다.\n과거 대화 내역을 분석하여 초기 메모리와 세계관을 구축하시겠습니까?\n(LLM 토큰이 소모됩니다)"
                );
                if (confirmed) {
                    await startAutoSummarization();
                }
            }
        };

        const extractJson = (text) => {
            try {
                const match = text.match(/\{[\s\S]*\}/);
                return match ? JSON.parse(match[0]) : null;
            } catch { return null; }
        };

        const applyFinalData = async (finalData) => {
            await loreLock.writeLock();
            try {
                const char = await risuai.getCharacter();
                const chat = char.chats?.[char.chatPage];
                let lore = (chat.localLore) || char.lorebook || [];
                
                LMAI_GUI.toast("데이터 반영 중...");

                // 1. Narrative 반영
                const narrative = NarrativeTracker.getState();
                narrative.storylines = [{
                    id: 1,
                    name: "Initial Storyline",
                    entities: finalData.entities.map(e => e.name),
                    turns: [0],
                    firstTurn: 0,
                    lastTurn: 0,
                    recentEvents: [{ turn: 0, brief: "Cold Start: Initial summary applied." }],
                    summaries: [{ upToTurn: 0, summary: finalData.narrative, keyPoints: [], timestamp: Date.now() }],
                    currentContext: finalData.narrative,
                    keyPoints: []
                }];

                // 2. Entities & Relations 반영
                for (const ent of finalData.entities) {
                    EntityManager.updateEntity(ent.name, {
                        appearance: { features: [ent.appearance] },
                        personality: { traits: [ent.personality] },
                        background: { origin: ent.background },
                        source: 'cold_start',
                        s_id: 'baseline'
                    }, lore);
                }

                for (const rel of finalData.relations) {
                    EntityManager.updateRelation(rel.entityA, rel.entityB, {
                        relationType: rel.type,
                        sentiments: { fromAtoB: rel.sentiment },
                        s_id: 'baseline'
                    }, lore);
                }

                // 3. World Rules 반영 (Root Node)
                const profile = HierarchicalWorldManager.getProfile();
                const rootNode = profile.nodes.get(profile.rootId);
                if (rootNode) {
                    rootNode.rules.exists.technology = finalData.world.tech;
                    rootNode.rules.physics.special_phenomena = finalData.world.rules;
                    rootNode.meta.notes = "Updated via Cold Start";
                    rootNode.meta.s_id = 'baseline';
                }

                // 4. 모든 매니저의 상태를 하나의 로어북 배열로 통합
                // (EntityManager.saveToLorebook 내부적으로 MemoryEngine.setLorebook와 risuai.setCharacter를 호출하므로 주의)
                // 여기서는 각 saveState를 호출하여 'lore' 배열을 업데이트한 후 최종 저장합니다.
                
                await HierarchicalWorldManager.saveWorldGraph(char, chat, lore);
                await NarrativeTracker.saveState(lore);
                await CharacterStateTracker.saveState(lore);
                await WorldStateTracker.saveState(lore);
                
                // EntityManager의 캐시를 로어북 엔트리로 변환하여 병합
                const currentTurn = MemoryState.currentTurn;
                for (const [name, entity] of EntityManager.getEntityCache()) {
                    entity.meta.s_id = entity.meta.s_id || 'baseline';
                    const entry = {
                        key: name,
                        comment: "lmai_entity",
                        content: JSON.stringify(entity, null, 2),
                        mode: 'normal',
                        insertorder: 50,
                        alwaysActive: true
                    };
                    const existingIdx = lore.findIndex(e => e.comment === "lmai_entity" && EntityManager.normalizeName(e.key || '') === name);
                    if (existingIdx >= 0) lore[existingIdx] = entry;
                    else lore.push(entry);
                }

                for (const [id, relation] of EntityManager.getRelationCache()) {
                    relation.meta.s_id = relation.meta.s_id || 'baseline';
                    const entry = {
                        key: id,
                        comment: "lmai_relation",
                        content: JSON.stringify(relation, null, 2),
                        mode: 'normal',
                        insertorder: 60,
                        alwaysActive: true
                    };
                    const existingIdx = lore.findIndex(e => e.comment === "lmai_relation" && e.key === id);
                    if (existingIdx >= 0) lore[existingIdx] = entry;
                    else lore.push(entry);
                }

                // 최종 저장
                if (chat) {
                    chat.localLore = lore;
                } else {
                    char.lorebook = lore;
                }
                await risuai.setCharacter(char);

                LMAI_GUI.toast("✨ LIBRA 초기 메모리 구축이 완료되었습니다!");
                delete MemoryState.pendingColdStartData;

            } catch (e) {
                console.error("[LIBRA] Cold Start Apply Error:", e);
                LMAI_GUI.toast("❌ 데이터 반영 중 오류 발생");
            } finally {
                loreLock.writeUnlock();
            }
        };

        const startAutoSummarization = async () => {
            isProcessing = true;
            try {
                const char = await risuai.getCharacter();
                const chat = char.chats?.[char.chatPage];
                // 인사말 필터링 적용
                const msgs = chat.msgs.slice(-100).filter(m => m.text && m.id !== MemoryState.ignoredGreetingId);
                
                if (msgs.length === 0) throw new Error("분석할 대화 내역이 없습니다.");

                const chunks = [];
                const chunkSize = 25;
                for (let i = 0; i < msgs.length; i += chunkSize) {
                    chunks.push(msgs.slice(i, i + chunkSize));
                }

                LMAI_GUI.toast(`총 ${chunks.length}개 청크 분석 시작...`);
                const chunkSummaries = [];

                for (let i = 0; i < chunks.length; i++) {
                    LMAI_GUI.toast(`대화 분석 중... (${i + 1}/${chunks.length})`);
                    const chunkText = chunks[i].map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n\n');
                    
                    const result = await LLMProvider.call(MemoryEngine.CONFIG, ColdStartSummaryPrompt, chunkText, { maxTokens: 1500 });
                    if (result.content) {
                        const parsed = extractJson(result.content);
                        if (parsed) chunkSummaries.push(parsed);
                    }
                }

                if (chunkSummaries.length === 0) throw new Error("분석 결과 생성 실패");

                LMAI_GUI.toast("최종 데이터 합성 중...");
                const synthesisResult = await LLMProvider.call(
                    MemoryEngine.CONFIG, 
                    FinalSynthesisPrompt, 
                    JSON.stringify(chunkSummaries), 
                    { maxTokens: 2000 }
                );

                const finalData = extractJson(synthesisResult.content);
                if (!finalData) throw new Error("최종 합성 실패");

                if (MemoryEngine.CONFIG.debug) console.log("[LIBRA] Cold Start Synthesis Data:", finalData);
                
                // 데이터 반영 실행
                await applyFinalData(finalData);

            } catch (e) {
                console.error("[LIBRA] Cold Start Error:", e);
                LMAI_GUI.toast(`❌ 분석 실패: ${e.message || e}`);
            } finally {
                isProcessing = false;
            }
        };

        return { check, startAutoSummarization };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Transition Manager
    // ══════════════════════════════════════════════════════════════
    const TransitionManager = (() => {
        const BUFFER_KEY = 'LIBRA_TRANSITION_BUFFER';
        const SCENE_CONTEXT_KEY = 'LIBRA_SCENE_CONTEXT';

        const TransitionSummaryPrompt = `당신은 대화 세션 전환을 돕는 맥락 브릿지 전문가입니다.
제공된 마지막 대화 내역을 바탕으로, 새 채팅방에서 대화를 자연스럽게 이어갈 수 있도록 현재 상황을 요약하십시오.

[필수 포함 내용]
1. 현재 장소 및 시간적 배경
2. 주요 등장인물들이 직전에 수행하던 구체적인 행동
3. 현재 대화의 핵심 분위기와 진행 중인 사건의 긴박함 정도

요약은 1~2문단으로 간결하고 명확하게 작성하십시오.`;

        const prepareTransition = async () => {
            await loreLock.writeLock();
            try {
                const char = await risuai.getCharacter();
                const chat = char.chats?.[char.chatPage];
                const lore = (chat?.localLore) || char.lorebook || [];

                LMAI_GUI.toast("데이터 패키징 중...");

                // 1. 직전 상황 요약 생성 (Graceful Degradation 적용)
                let sceneSummary = "";
                try {
                    // 인사말 필터링 적용
                    const lastMsgs = chat.msgs.slice(-10).filter(m => m.text && m.id !== MemoryState.ignoredGreetingId);
                    if (lastMsgs.length > 0) {
                        LMAI_GUI.toast("직전 상황 요약 중...");
                        const contextText = lastMsgs.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n\n');
                        const result = await LLMProvider.call(MemoryEngine.CONFIG, TransitionSummaryPrompt, contextText, { maxTokens: 800 });
                        if (result.content) sceneSummary = result.content.trim();
                    }
                } catch (summaryError) {
                    console.warn("[LIBRA] Transition Summary generation failed, but continuing transition:", summaryError);
                }

                // 2. 데이터 패키징
                const libraComments = [
                    "lmai_world_graph", "lmai_world_node", "lmai_entity", 
                    "lmai_relation", "lmai_narrative", "lmai_char_states", 
                    "lmai_world_states"
                ];

                const transitionData = {
                    loreEntries: lore.filter(e => libraComments.includes(e.comment)),
                    sceneSummary: sceneSummary,
                    memoryState: {
                        gcCursor: MemoryState.gcCursor,
                        currentTurn: MemoryState.currentTurn
                    },
                    timestamp: Date.now(),
                    sourceChatId: chat?.id
                };

                await risuai.pluginStorage.setItem(BUFFER_KEY, JSON.stringify(transitionData));
                console.log("[LIBRA] Transition data prepared with summary.");
                return true;
            } catch (e) {
                console.error("[LIBRA] Prepare Transition Error:", e);
                return false;
            } finally {
                loreLock.writeUnlock();
            }
        };

        const restoreTransition = async () => {
            let buffer;
            try {
                const saved = await risuai.pluginStorage.getItem(BUFFER_KEY);
                if (!saved) return false;
                buffer = typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) {
                console.error("[LIBRA] Restore Parse Error:", e);
                return false;
            }

            if (!buffer || !buffer.loreEntries) return false;

            await loreLock.writeLock();
            try {
                const char = await risuai.getCharacter();
                const chat = char.chats?.[char.chatPage];
                let currentLore = (chat?.localLore) || char.lorebook || [];

                LMAI_GUI.toast("이전 기억 복구 중...");

                const libraComments = [
                    "lmai_world_graph", "lmai_world_node", "lmai_entity", 
                    "lmai_relation", "lmai_narrative", "lmai_char_states", 
                    "lmai_world_states", SCENE_CONTEXT_KEY
                ];
                
                let updatedLore = currentLore.filter(e => !libraComments.includes(e.comment) && e.key !== SCENE_CONTEXT_KEY);
                
                // 1. 핵심 LIBRA 노드 주입
                const baselineEntries = buffer.loreEntries.map(e => {
                    try {
                        const content = JSON.parse(e.content);
                        if (content.meta) content.meta.s_id = 'baseline';
                        else if (e.comment === 'lmai_world_graph') content.meta = { s_id: 'baseline' };
                        return { ...e, content: JSON.stringify(content) };
                    } catch { return e; }
                });
                updatedLore = [...baselineEntries, ...updatedLore];

                // 2. 직전 상황 요약(Scene Context) 주입
                if (buffer.sceneSummary) {
                    const meta = { imp: 10, t: 0, ttl: -1, cat: 'system', summary: 'Previous Scene Context', s_id: 'baseline' };
                    const sceneEntry = {
                        key: SCENE_CONTEXT_KEY,
                        comment: "lmai_memory",
                        content: `[META:${JSON.stringify(meta)}]\n【직전 상황 요약 / Previous Scene Context】\n${buffer.sceneSummary}`,
                        mode: 'normal',
                        insertorder: 10,
                        alwaysActive: true
                    };
                    updatedLore.unshift(sceneEntry);
                }

                // 3. 상태 복구
                if (buffer.memoryState) {
                    MemoryState.gcCursor = buffer.memoryState.gcCursor || 0;
                    MemoryState.currentTurn = buffer.memoryState.currentTurn || 0;
                }

                // 저장 및 엔진 재로드
                if (chat) chat.localLore = updatedLore;
                else char.lorebook = updatedLore;
                
                await risuai.setCharacter(char);
                
                HierarchicalWorldManager.loadWorldGraph(updatedLore);
                EntityManager.rebuildCache(updatedLore);
                NarrativeTracker.loadState(updatedLore);
                CharacterStateTracker.loadState(updatedLore);
                WorldStateTracker.loadState(updatedLore);

                MemoryState.isSessionRestored = true;
                await identifyGreeting();

                LMAI_GUI.toast("✨ 이전 기억과 마지막 맥락이 복구되었습니다!");
                return true;
            } catch (e) {
                console.error("[LIBRA] Restore Transition Error:", e);
                return false;
            } finally {
                await risuai.pluginStorage.removeItem(BUFFER_KEY);
                loreLock.writeUnlock();
            }
        };

        const identifyGreeting = async () => {
            if (!MemoryState.isSessionRestored) return;
            
            try {
                const char = await risuai.getCharacter();
                const chat = char?.chats?.[char.chatPage];
                
                if (chat && Array.isArray(chat.msgs) && chat.msgs.length === 1) {
                    const firstMsg = chat.msgs[0];
                    if (firstMsg && firstMsg.role !== 'user') {
                        MemoryState.ignoredGreetingId = firstMsg.id;
                        console.log(`[LIBRA] Initial greeting identified and will be isolated: ${firstMsg.id}`);
                    }
                }
            } catch (e) {
                console.warn("[LIBRA] Failed to identify greeting:", e);
            }
        };

        return { prepareTransition, restoreTransition, identifyGreeting };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Sync & Rollback Engine
    // ══════════════════════════════════════════════════════════════
    const SyncEngine = (() => {
        const syncMemory = async (char, chat, lore) => {
            // Fail-safe: chat.msgs가 유효하지 않으면 롤백 건너뜀 (대량 삭제 방지)
            if (!chat || !Array.isArray(chat.msgs) || chat.msgs.length === 0 || MemoryState.rollbackTracker.size === 0) {
                return false;
            }

            const currentMsgIds = new Set(chat.msgs.map(m => m.id).filter(Boolean));
            const trackedMsgIds = Array.from(MemoryState.rollbackTracker.keys());
            const deletedMsgIds = trackedMsgIds.filter(id => !currentMsgIds.has(id));

            if (deletedMsgIds.length === 0) return false;

            await loreLock.writeLock();
            try {
                let changed = false;
                let removedCount = 0;
                const currentSession = MemoryState.currentSessionId;

                for (const m_id of deletedMsgIds) {
                    // 1. 로어북 스캔 및 조건부 삭제
                    for (let i = lore.length - 1; i >= 0; i--) {
                        const entry = lore[i];
                        try {
                            const metaMatch = entry.content?.match(/\[META:(\{.*?\})\]/);
                            if (metaMatch) {
                                const meta = JSON.parse(metaMatch[1]);
                                // 방어 로직: 현재 세션이 아니거나 baseline인 경우 절대 삭제 안함
                                if (meta.m_id === m_id && meta.s_id === currentSession && meta.s_id !== 'baseline') {
                                    lore.splice(i, 1);
                                    changed = true;
                                    removedCount++;
                                }
                            }
                        } catch (e) { continue; }
                    }

                    // 2. 트래커에서 제거
                    MemoryState.rollbackTracker.delete(m_id);
                }

                if (changed) {
                    // 캐시 재구축
                    EntityManager.rebuildCache(lore);
                    HierarchicalWorldManager.loadWorldGraph(lore);
                    NarrativeTracker.loadState(lore);
                    CharacterStateTracker.loadState(lore);
                    WorldStateTracker.loadState(lore);
                    
                    MemoryEngine.setLorebook(char, chat, lore);
                    await risuai.setCharacter(char);
                    
                    // Unobtrusive feedback
                    console.log(`[LIBRA] 🔄 Phantom memory synced (removed ${removedCount} entries linked to deleted messages)`);
                }
                return changed;
            } catch (e) {
                console.error("[LIBRA] Sync Error:", e);
                return false;
            } finally {
                loreLock.writeUnlock();
            }
        };

        return { syncMemory };
    })();

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
    // [API] Providers
    // ══════════════════════════════════════════════════════════════
    class BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) { throw new Error('Not implemented'); }
        async getEmbedding(config, text) { throw new Error('Not implemented'); }
        
        _checkKey(key) {
            if (!key || key.trim() === '') {
                throw new LIBRAError('API Key is missing. Please check your settings.', 'MISSING_KEY');
            }
        }

        async _fetch(url, headers, body, timeoutMs = 15000) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await risuai.nativeFetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                if (!response.ok) {
                    const errorBody = await response.text().catch(() => 'No error body');
                    throw new LIBRAError(`API Error: ${response.status} - ${errorBody}`, 'API_ERROR');
                }
                return await response.json();
            } finally {
                clearTimeout(timeout);
            }
        }
    }

    class OpenAIProvider extends BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            const headers = { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.llm.key}`
            };
            const provider = (config.llm.provider || 'openai').toLowerCase();
            if (provider === 'openrouter') {
                headers['HTTP-Referer'] = 'https://risuai.xyz';
                headers['X-Title'] = 'Librarian System';
            } else if (provider === 'copilot') {
                headers['Editor-Version'] = 'vscode/1.85.0';
            }

            const body = {
                model: config.llm.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature: config.llm.temp || 0.3,
                max_tokens: options.maxTokens || 1000
            };

            const data = await this._fetch(config.llm.url, headers, body, config.llm.timeout);
            return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || {} };
        }

        async getEmbedding(config, text) {
            this._checkKey(config.embed.key);
            const headers = { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.embed.key}`
            };
            const body = { input: [text], model: config.embed.model };
            const data = await this._fetch(config.embed.url, headers, body);
            return data?.data?.[0]?.embedding;
        }
    }

    class AnthropicProvider extends BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            let url = config.llm.url;
            if (!url.includes('/v1/')) url = url.replace(/\/$/, '') + '/v1/messages';
            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': config.llm.key,
                'anthropic-version': '2023-06-01'
            };
            const body = {
                model: config.llm.model,
                system: systemPrompt,
                messages: [{ role: 'user', content: userContent }],
                max_tokens: options.maxTokens || 1000,
                temperature: config.llm.temp || 0.3
            };
            const data = await this._fetch(url, headers, body, config.llm.timeout);
            return { content: data.content?.[0]?.text || '', usage: data.usage || {} };
        }
    }

    class GeminiProvider extends BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            const url = `${config.llm.url.replace(/\/$/, '')}/models/${config.llm.model}:generateContent?key=${config.llm.key}`;
            const body = {
                contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userContent }] }],
                generationConfig: {
                    temperature: config.llm.temp || 0.3,
                    maxOutputTokens: options.maxTokens || 1000
                }
            };
            const data = await this._fetch(url, { 'Content-Type': 'application/json' }, body, config.llm.timeout);
            return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '', usage: data.usage || {} };
        }

        async getEmbedding(config, text) {
            this._checkKey(config.embed.key);
            const url = `${config.embed.url.replace(/\/$/, '')}/models/${config.embed.model}:embedContent?key=${config.embed.key}`;
            const body = {
                model: `models/${config.embed.model}`,
                content: { parts: [{ text: text }] }
            };
            const data = await this._fetch(url, { 'Content-Type': 'application/json' }, body);
            return data?.embedding?.values;
        }
    }

    class VertexAIProvider extends BaseProvider {
        async callLLM(config, systemPrompt, userContent, options) {
            this._checkKey(config.llm.key);
            const body = {
                contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userContent }] }],
                generationConfig: { temperature: config.llm.temp || 0.3, maxOutputTokens: options.maxTokens || 1000 }
            };
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.llm.key}` };
            const data = await this._fetch(config.llm.url, headers, body, config.llm.timeout);
            return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '', usage: data.usage || {} };
        }

        async getEmbedding(config, text) {
            this._checkKey(config.embed.key);
            const body = { instances: [{ content: text }] };
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.embed.key}` };
            const data = await this._fetch(config.embed.url, headers, body);
            return data?.predictions?.[0]?.embeddings?.values;
        }
    }

    const AutoProvider = (() => {
        const providers = {
            openai: new OpenAIProvider(),
            anthropic: new AnthropicProvider(),
            claude: new AnthropicProvider(),
            gemini: new GeminiProvider(),
            vertex: new VertexAIProvider(),
            openrouter: new OpenAIProvider(),
            copilot: new OpenAIProvider()
        };

        return {
            get: (name) => providers[(name || 'openai').toLowerCase()] || providers.openai
        };
    })();

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
        const NEGATION_WORDS = ['않', '안', '못', '말', '미', '노', '누', '구', '별로', '전혀', '절대', 'not', 'no', 'never', 'neither', 'hardly', 'barely', 'cannot'];
        // Extended from 5 to 10 to accommodate English words which are longer and have greater typical distance from negated terms
        const NEGATION_WINDOW = 10;

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
                joy: ['기쁘', '행복', '좋아', '웃', '미소', '즐거', 'happy', 'joy', 'glad', 'smile', 'laugh', 'delighted'],
                sadness: ['슬프', '우울', '눈물', '울', '그리워', 'sad', 'depressed', 'tears', 'cry', 'miss'],
                anger: ['화나', '분노', '짜증', '열받', 'angry', 'furious', 'rage', 'annoyed', 'irritated'],
                fear: ['무서', '두려', '공포', '불안', 'scared', 'afraid', 'fear', 'anxious', 'terrified'],
                surprise: ['놀라', '충격', '깜짝', 'surprised', 'shocked', 'astonished', 'startled'],
                disgust: ['역겨', '혐오', '싫어', 'disgusted', 'hate', 'loathe', 'revolted']
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

            try {
                const providerName = config.llm.provider || 'openai';
                const provider = AutoProvider.get(providerName);
                return await provider.callLLM(config, systemPrompt, userContent, options);
            } catch (e) {
                console.error('[LIBRA] LLM Provider Error:', e?.message || e);
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
                    console.warn('[LIBRA] Failed to parse world graph:', e?.message);
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
                    console.warn('[LIBRA] Failed to parse world node:', e?.message);
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
            const visited = new Set();
            let currentId = node.parent;
            
            visited.add(nodeId); // 현재 노드 등록
            while (currentId) {
                if (visited.has(currentId)) {
                    console.warn(`[LIBRA] Circular reference detected in world graph at node: ${currentId}`);
                    break;
                }
                visited.add(currentId);
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
            await loreLock.writeLock();
            try {
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
            } finally {
                loreLock.writeUnlock();
            }
        };

        const formatForPrompt = () => {
            if (!profile) return '';

            const parts = [];
            parts.push('【세계관 구조 / World Structure】');

            const globalFeatures = [];
            if (profile.global.multiverse) globalFeatures.push('멀티버스/Multiverse');
            if (profile.global.dimensionTravel) globalFeatures.push('차원 이동 가능/Dimension Travel');
            if (profile.global.timeTravel) globalFeatures.push('시간 여행 가능/Time Travel');
            if (profile.global.metaNarrative) globalFeatures.push('메타 서술/Meta Narrative');
            if (globalFeatures.length > 0) parts.push(`구조/Structure: ${globalFeatures.join(', ')}`);

            if (profile.activePath.length > 0) {
                parts.push('\n[현재 위치 / Current Location]');
                for (let i = 0; i < profile.activePath.length; i++) {
                    const node = profile.nodes.get(profile.activePath[i]);
                    if (node) {
                        const indent = '  '.repeat(i);
                        const active = i === profile.activePath.length - 1 ? ' ← 현재/Current' : '';
                        parts.push(`${indent}${node.name}${active}`);
                    }
                }
            }

            const currentRules = getCurrentRules();
            if (currentRules) {
                parts.push('\n[현재 세계 규칙 / Current World Rules]');
                const exists = currentRules.exists || {};
                const existingElements = [];
                if (exists.magic) existingElements.push('마법/Magic');
                if (exists.ki) existingElements.push('기(氣)/Ki');
                if (exists.supernatural) existingElements.push('초자연/Supernatural');
                if (exists.mythical_creatures?.length > 0) existingElements.push(...exists.mythical_creatures);
                if (existingElements.length > 0) parts.push(`  존재/Exists: ${existingElements.join(', ')}`);

                const systems = currentRules.systems || {};
                const activeSystems = [];
                if (systems.leveling) activeSystems.push('레벨/Level');
                if (systems.skills) activeSystems.push('스킬/Skill');
                if (systems.stats) activeSystems.push('스탯/Stats');
                if (activeSystems.length > 0) parts.push(`  시스템/Systems: ${activeSystems.join(', ')}`);
            }

            if (profile.interference.level > 0.5) {
                parts.push('\n⚠️ 차원 간섭도 높음 - 세계 간 영향 가능 / High dimensional interference - cross-world effects possible');
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
            const koTitles = ['씨', '님', '양', '군', '선생님', '교수님', '박사님'];
            const enTitles = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.', 'Sir', 'Lady', 'Lord'];
            let normalized = name.trim();
            // Remove Korean suffixed titles
            for (const title of koTitles) {
                if (normalized.endsWith(title) && normalized.length > title.length + 1) {
                    normalized = normalized.slice(0, -title.length);
                }
            }
            // Remove English prefixed titles
            for (const title of enTitles) {
                if (normalized.startsWith(title + ' ') || normalized.startsWith(title)) {
                    normalized = normalized.slice(title.length).trim();
                }
            }
            return normalized.trim();
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
                    if (Array.isArray(updates.appearance[key])) {
                        if (!Array.isArray(entity.appearance[key])) entity.appearance[key] = [];
                        const newItems = updates.appearance[key].filter(item => !entity.appearance[key].includes(item));
                        entity.appearance[key].push(...newItems);
                    }
                }
            }

            if (updates.personality) {
                for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes']) {
                    if (Array.isArray(updates.personality[key])) {
                        if (!Array.isArray(entity.personality[key])) entity.personality[key] = [];
                        const newItems = updates.personality[key].filter(item => !entity.personality[key].includes(item));
                        entity.personality[key].push(...newItems);
                    }
                }
            }

            if (updates.background) {
                if (updates.background.origin && !entity.background.origin) entity.background.origin = updates.background.origin;
                if (updates.background.occupation && !entity.background.occupation) entity.background.occupation = updates.background.occupation;
                if (Array.isArray(updates.background.history)) {
                    if (!Array.isArray(entity.background.history)) entity.background.history = [];
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
            
            // Sync/Rollback Metadata
            if (updates.s_id) entity.meta.s_id = updates.s_id;
            if (updates.m_id) entity.meta.m_id = updates.m_id;

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

            // Sync/Rollback Metadata
            if (updates.s_id) relation.meta.s_id = updates.s_id;
            if (updates.m_id) relation.meta.m_id = updates.m_id;

            return relation;
        };

        const checkConsistency = (entityName, newInfo) => {
            const entity = entityCache.get(normalizeName(entityName));
            if (!entity) return { consistent: true, conflicts: [] };

            const conflicts = [];
            if (newInfo.appearance?.features) {
                const opposites = { '키가 큼': ['키가 작음'], '키가 작음': ['키가 큼'], '검은 머리': ['금발', '갈색 머리'], '금발': ['검은 머리', '갈색 머리'], 'tall': ['short'], 'short': ['tall'], 'black hair': ['blonde', 'brown hair'], 'blonde': ['black hair', 'brown hair'], 'brown hair': ['black hair', 'blonde'] };
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
                parts.push(`  외모/Appearance: ${[...entity.appearance.features, ...entity.appearance.distinctiveMarks].join(', ')}`);
            }
            if (entity.personality.traits.length > 0) parts.push(`  성격/Personality: ${entity.personality.traits.join(', ')}`);
            if (entity.personality.likes.length > 0) parts.push(`  좋아하는 것/Likes: ${entity.personality.likes.join(', ')}`);
            if (entity.personality.dislikes.length > 0) parts.push(`  싫어하는 것/Dislikes: ${entity.personality.dislikes.join(', ')}`);
            if (entity.background.origin) parts.push(`  출신/Origin: ${entity.background.origin}`);
            if (entity.background.occupation) parts.push(`  직업/Occupation: ${entity.background.occupation}`);
            if (entity.status.currentMood) parts.push(`  현재 기분/Current Mood: ${entity.status.currentMood}`);
            if (entity.status.currentLocation) parts.push(`  현재 위치/Current Location: ${entity.status.currentLocation}`);
            return parts.join('\n');
        };

        const formatRelationForPrompt = (relation) => {
            const parts = [];
            parts.push(`【${relation.entityA} ↔ ${relation.entityB}】`);
            parts.push(`  관계/Relation: ${relation.relationType}`);
            if (relation.details.closeness > 0.7) parts.push(`  친밀도/Closeness: 매우 가까움/Very Close`);
            else if (relation.details.closeness > 0.4) parts.push(`  친밀도/Closeness: 보통/Moderate`);
            else parts.push(`  친밀도/Closeness: 어색함/Distant`);
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
    // [MANAGER] Narrative Tracker
    // ══════════════════════════════════════════════════════════════
    const NarrativeTracker = (() => {
        const NARRATIVE_COMMENT = 'lmai_narrative';
        const SUMMARY_INTERVAL = 5;

        let narrativeState = {
            storylines: [],
            turnLog: [],
            lastSummaryTurn: 0
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === NARRATIVE_COMMENT);
            if (entry) {
                try {
                    narrativeState = JSON.parse(entry.content);
                } catch (e) { console.warn('[LIBRA] Narrative state parse failed:', e?.message); }
            }
            return narrativeState;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: 'narrative_tracker',
                comment: NARRATIVE_COMMENT,
                content: JSON.stringify(narrativeState),
                mode: 'normal',
                insertorder: 5,
                alwaysActive: true
            };
            const idx = lorebook.findIndex(e => e.comment === NARRATIVE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordTurn = (turn, userMsg, aiResponse, entities = []) => {
            const turnEntry = {
                turn,
                timestamp: Date.now(),
                userAction: userMsg.slice(0, 200),
                response: aiResponse.slice(0, 300),
                involvedEntities: entities.map(e => typeof e === 'string' ? e : e.name),
                summary: ''
            };
            narrativeState.turnLog.push(turnEntry);

            if (narrativeState.turnLog.length > 50) {
                narrativeState.turnLog = narrativeState.turnLog.slice(-50);
            }

            assignToStoryline(turnEntry);
        };

        const assignToStoryline = (turnEntry) => {
            const entities = turnEntry.involvedEntities;

            let bestMatch = null;
            let bestScore = 0;

            for (const storyline of narrativeState.storylines) {
                const overlap = entities.filter(e => storyline.entities.includes(e)).length;
                const score = entities.length > 0 ? overlap / entities.length : 0;
                if (score > bestScore && score >= 0.3) {
                    bestScore = score;
                    bestMatch = storyline;
                }
            }

            if (bestMatch) {
                bestMatch.turns.push(turnEntry.turn);
                bestMatch.lastTurn = turnEntry.turn;
                for (const e of entities) {
                    if (!bestMatch.entities.includes(e)) bestMatch.entities.push(e);
                }
                bestMatch.recentEvents.push({
                    turn: turnEntry.turn,
                    brief: turnEntry.userAction.slice(0, 80)
                });
                if (bestMatch.recentEvents.length > 10) {
                    bestMatch.recentEvents = bestMatch.recentEvents.slice(-10);
                }
            } else if (entities.length > 0) {
                const id = narrativeState.storylines.length + 1;
                narrativeState.storylines.push({
                    id,
                    name: `Storyline #${id}`,
                    entities: [...entities],
                    turns: [turnEntry.turn],
                    firstTurn: turnEntry.turn,
                    lastTurn: turnEntry.turn,
                    recentEvents: [{
                        turn: turnEntry.turn,
                        brief: turnEntry.userAction.slice(0, 80)
                    }],
                    summaries: [],
                    currentContext: '',
                    keyPoints: []
                });
            }
        };

        const summarizeIfNeeded = async (currentTurn, config) => {
            if (currentTurn - narrativeState.lastSummaryTurn < SUMMARY_INTERVAL) return;

            let summarized = false;

            for (const storyline of narrativeState.storylines) {
                const recentTurns = narrativeState.turnLog.filter(
                    t => storyline.turns.includes(t.turn) && t.turn > (storyline.summaries.length > 0 ? storyline.summaries[storyline.summaries.length - 1].upToTurn : 0)
                );

                if (recentTurns.length < 3) continue;

                if (config.useLLM && config.llm?.key) {
                    try {
                        const turnTexts = recentTurns.map(t => `Turn ${t.turn}: ${t.userAction} → ${t.response}`).join('\n');
                        const result = await LLMProvider.call(config,
                            'You are a narrative analyst. Summarize the following story events concisely. Identify the key plot points, character developments, and ongoing tensions. Respond in the same language as the content.\n\nOutput JSON: {"summary": "...", "keyPoints": ["..."], "ongoingTensions": ["..."], "context": "brief context for continuation"}',
                            `Storyline: ${storyline.name}\nEntities: ${storyline.entities.join(', ')}\n\nRecent events:\n${turnTexts}`,
                            { maxTokens: 500 }
                        );

                        if (result.content) {
                            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                const parsed = JSON.parse(jsonMatch[0]);
                                storyline.summaries.push({
                                    upToTurn: currentTurn,
                                    summary: parsed.summary || '',
                                    keyPoints: parsed.keyPoints || [],
                                    timestamp: Date.now()
                                });
                                storyline.currentContext = parsed.context || parsed.summary || '';
                                if (parsed.keyPoints) {
                                    storyline.keyPoints = [...new Set([...storyline.keyPoints, ...parsed.keyPoints])].slice(-20);
                                }
                            }
                        }
                        summarized = true;
                    } catch (e) {
                        console.warn('[LIBRA] Narrative summary failed:', e?.message);
                    }
                } else {
                    const brief = recentTurns.map(t => t.userAction.slice(0, 50)).join(' → ');
                    storyline.summaries.push({
                        upToTurn: currentTurn,
                        summary: brief,
                        keyPoints: [],
                        timestamp: Date.now()
                    });
                    storyline.currentContext = brief;
                    summarized = true;
                }
            }

            if (summarized) {
                narrativeState.lastSummaryTurn = currentTurn;
            }
        };

        const formatForPrompt = () => {
            if (narrativeState.storylines.length === 0) return '';

            const parts = ['【내러티브 현황 / Narrative Status】'];

            for (const storyline of narrativeState.storylines) {
                parts.push(`\n[${storyline.name}] (Entities: ${storyline.entities.join(', ')})`);
                if (storyline.currentContext) {
                    parts.push(`  Context: ${storyline.currentContext}`);
                }
                if (storyline.keyPoints.length > 0) {
                    parts.push(`  Key Points: ${storyline.keyPoints.slice(-5).join('; ')}`);
                }
                if (storyline.recentEvents.length > 0) {
                    const last3 = storyline.recentEvents.slice(-3);
                    parts.push(`  Recent: ${last3.map(e => `T${e.turn}: ${e.brief}`).join(' → ')}`);
                }
            }

            return parts.join('\n');
        };

        const getState = () => narrativeState;

        return { loadState, saveState, recordTurn, summarizeIfNeeded, formatForPrompt, getState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Character State Tracker
    // ══════════════════════════════════════════════════════════════
    const CharacterStateTracker = (() => {
        const STATE_COMMENT = 'lmai_char_states';
        const CONSOLIDATION_INTERVAL = 5;

        let stateHistory = {};

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === STATE_COMMENT);
            if (entry) {
                try { stateHistory = JSON.parse(entry.content); } catch (e) { console.warn('[LIBRA] Char state parse failed:', e?.message); }
            }
            return stateHistory;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: 'char_states',
                comment: STATE_COMMENT,
                content: JSON.stringify(stateHistory),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: true
            };
            const idx = lorebook.findIndex(e => e.comment === STATE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordState = (entityName, turn, stateSnapshot) => {
            if (!stateHistory[entityName]) {
                stateHistory[entityName] = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            }
            const history = stateHistory[entityName];
            history.turnLog.push({
                turn,
                timestamp: Date.now(),
                location: stateSnapshot.currentLocation || '',
                mood: stateSnapshot.currentMood || '',
                health: stateSnapshot.healthStatus || '',
                notes: stateSnapshot.notes || ''
            });
            if (history.turnLog.length > 30) {
                history.turnLog = history.turnLog.slice(-30);
            }
        };

        const recordCriticalMoment = (entityName, turn, description) => {
            if (!stateHistory[entityName]) {
                stateHistory[entityName] = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            }
            stateHistory[entityName].consolidated.push({
                turn,
                type: 'critical',
                description,
                timestamp: Date.now()
            });
        };

        const consolidateIfNeeded = async (entityName, currentTurn, config) => {
            const history = stateHistory[entityName];
            if (!history) return;
            if (currentTurn - history.lastConsolidationTurn < CONSOLIDATION_INTERVAL) return;

            const recentLogs = history.turnLog.filter(
                t => t.turn > history.lastConsolidationTurn
            );
            if (recentLogs.length < 3) return;

            if (config.useLLM && config.llm?.key) {
                try {
                    const logText = recentLogs.map(l =>
                        `Turn ${l.turn}: Location=${l.location}, Mood=${l.mood}, Health=${l.health}${l.notes ? ', Notes=' + l.notes : ''}`
                    ).join('\n');

                    const result = await LLMProvider.call(config,
                        'Summarize the character state changes below. Note significant changes. Respond in the same language as the content.\nOutput JSON: {"summary": "...", "significantChanges": ["..."]}',
                        `Character: ${entityName}\nState log:\n${logText}`,
                        { maxTokens: 300 }
                    );

                    if (result.content) {
                        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            history.consolidated.push({
                                turn: currentTurn,
                                type: 'periodic',
                                description: parsed.summary || '',
                                changes: parsed.significantChanges || [],
                                timestamp: Date.now()
                            });
                        }
                    }
                    history.lastConsolidationTurn = currentTurn;
                } catch (e) {
                    console.warn('[LIBRA] Char state consolidation failed:', e?.message);
                }
            } else {
                const last = recentLogs[recentLogs.length - 1];
                history.consolidated.push({
                    turn: currentTurn,
                    type: 'periodic',
                    description: `Location: ${last.location}, Mood: ${last.mood}, Health: ${last.health}`,
                    changes: [],
                    timestamp: Date.now()
                });
                history.lastConsolidationTurn = currentTurn;
            }

            if (history.consolidated.length > 20) {
                history.consolidated = history.consolidated.slice(-20);
            }
        };

        const isCriticalMoment = (entityName, newState) => {
            const history = stateHistory[entityName];
            if (!history || history.turnLog.length === 0) return false;
            const last = history.turnLog[history.turnLog.length - 1];
            if (last.health && newState.healthStatus && last.health !== newState.healthStatus) return true;
            if (last.location && newState.currentLocation && last.location !== newState.currentLocation) return true;
            return false;
        };

        const formatForPrompt = (entityName) => {
            const history = stateHistory[entityName];
            if (!history) return '';
            const parts = [];

            if (history.consolidated.length > 0) {
                const lastConsolidated = history.consolidated[history.consolidated.length - 1];
                parts.push(`  State History: ${lastConsolidated.description}`);
            }

            const recent = history.turnLog.slice(-3);
            if (recent.length > 0) {
                const stateStr = recent.map(l => {
                    const segments = [];
                    if (l.location) segments.push(l.location);
                    if (l.mood) segments.push(l.mood);
                    if (l.health) segments.push(l.health);
                    return `T${l.turn}: ${segments.join(', ')}`;
                }).join(' → ');
                parts.push(`  Recent States: ${stateStr}`);
            }

            return parts.join('\n');
        };

        const getState = () => stateHistory;

        return { loadState, saveState, recordState, recordCriticalMoment, consolidateIfNeeded, isCriticalMoment, formatForPrompt, getState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] World State Tracker
    // ══════════════════════════════════════════════════════════════
    const WorldStateTracker = (() => {
        const STATE_COMMENT = 'lmai_world_states';
        const CONSOLIDATION_INTERVAL = 5;

        let stateHistory = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === STATE_COMMENT);
            if (entry) {
                try { stateHistory = JSON.parse(entry.content); } catch (e) { console.warn('[LIBRA] World state parse failed:', e?.message); }
            }
            return stateHistory;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: 'world_states',
                comment: STATE_COMMENT,
                content: JSON.stringify(stateHistory),
                mode: 'normal',
                insertorder: 7,
                alwaysActive: true
            };
            const idx = lorebook.findIndex(e => e.comment === STATE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordState = (turn, worldSnapshot) => {
            stateHistory.turnLog.push({
                turn,
                timestamp: Date.now(),
                activeWorld: worldSnapshot.activePath || [],
                rulesSnapshot: worldSnapshot.rules || {},
                globalFlags: worldSnapshot.global || {},
                notes: worldSnapshot.notes || ''
            });
            if (stateHistory.turnLog.length > 30) {
                stateHistory.turnLog = stateHistory.turnLog.slice(-30);
            }
        };

        const recordCriticalMoment = (turn, description) => {
            stateHistory.consolidated.push({
                turn,
                type: 'critical',
                description,
                timestamp: Date.now()
            });
        };

        const consolidateIfNeeded = async (currentTurn, config) => {
            if (currentTurn - stateHistory.lastConsolidationTurn < CONSOLIDATION_INTERVAL) return;
            const recentLogs = stateHistory.turnLog.filter(t => t.turn > stateHistory.lastConsolidationTurn);
            if (recentLogs.length < 3) return;

            if (config.useLLM && config.llm?.key) {
                try {
                    const logText = recentLogs.map(l =>
                        `Turn ${l.turn}: World=${(l.activeWorld||[]).join('→')}, Notes=${l.notes||'none'}`
                    ).join('\n');

                    const result = await LLMProvider.call(config,
                        'Summarize world state changes below. Note dimension shifts and rule changes. Respond in the same language as the content.\nOutput JSON: {"summary": "...", "significantChanges": ["..."]}',
                        `World state log:\n${logText}`,
                        { maxTokens: 300 }
                    );

                    if (result.content) {
                        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            stateHistory.consolidated.push({
                                turn: currentTurn,
                                type: 'periodic',
                                description: parsed.summary || '',
                                changes: parsed.significantChanges || [],
                                timestamp: Date.now()
                            });
                        }
                    }
                    stateHistory.lastConsolidationTurn = currentTurn;
                } catch (e) {
                    console.warn('[LIBRA] World state consolidation failed:', e?.message);
                }
            } else {
                const last = recentLogs[recentLogs.length - 1];
                stateHistory.consolidated.push({
                    turn: currentTurn,
                    type: 'periodic',
                    description: `World: ${(last.activeWorld||[]).join('→')}`,
                    changes: [],
                    timestamp: Date.now()
                });
                stateHistory.lastConsolidationTurn = currentTurn;
            }

            if (stateHistory.consolidated.length > 20) {
                stateHistory.consolidated = stateHistory.consolidated.slice(-20);
            }
        };

        const isCriticalMoment = (newWorldState) => {
            if (stateHistory.turnLog.length === 0) return false;
            const last = stateHistory.turnLog[stateHistory.turnLog.length - 1];
            const lastPath = (last.activeWorld || []).join(',');
            const newPath = (newWorldState.activePath || []).join(',');
            return lastPath !== newPath;
        };

        const formatForPrompt = () => {
            const parts = [];
            if (stateHistory.consolidated.length > 0) {
                const lastC = stateHistory.consolidated[stateHistory.consolidated.length - 1];
                parts.push(`World History: ${lastC.description}`);
            }
            const recent = stateHistory.turnLog.slice(-3);
            if (recent.length > 0) {
                parts.push(`Recent: ${recent.map(l => `T${l.turn}: ${(l.activeWorld||[]).slice(-1).join('')}${l.notes ? '(' + l.notes + ')' : ''}`).join(' → ')}`);
            }
            return parts.join('\n');
        };

        const getState = () => stateHistory;

        return { loadState, saveState, recordState, recordCriticalMoment, consolidateIfNeeded, isCriticalMoment, formatForPrompt, getState };
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
            cbsEnabled: true,
            emotionEnabled: true,
            enableModuleCompat: false,
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
            action: ['공격', '회피', '기습', '위험', '비명', '달려', '총', '검', '폭발', 'attack', 'dodge', 'ambush', 'danger', 'scream', 'run', 'gun', 'sword', 'explosion', 'fight', 'battle', 'combat'],
            romance: ['사랑', '좋아', '키스', '안아', '입술', '눈물', '손잡', '두근', '설레', 'love', 'like', 'kiss', 'hug', 'lips', 'tears', 'hold hands', 'heartbeat', 'flutter', 'romance', 'affection'],
            mystery: ['단서', '증거', '범인', '비밀', '거짓말', '수상', '추리', '의심', 'clue', 'evidence', 'culprit', 'secret', 'lie', 'suspicious', 'detective', 'suspect', 'mystery', 'investigate'],
            daily: ['밥', '날씨', '오늘', '일상', '학교', '회사', '집에', '친구', 'food', 'weather', 'today', 'daily', 'school', 'work', 'home', 'friend', 'routine', 'morning']
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
        const _log = (msg) => { if (CONFIG.debug) console.log(`[LIBRA] ${msg}`); };
        const getSafeKey = (entry) => entry.id || TokenizerEngine.getSafeMapKey(entry.content || "");

        const META_PATTERN = /\[META:(\{[^}]+\})\]/;
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
                        if (!m?.url || !m?.key) return null;

                        try {
                            const providerName = m.provider || 'openai';
                            const provider = AutoProvider.get(providerName);
                            const vec = await provider.getEmbedding(CONFIG, text);

                            if (vec) cache.set(text, vec);
                            return vec;
                        } catch (e) {
                            if (CONFIG.debug) console.warn('[LIBRA] Embedding Error:', e?.message || e);
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
                const emptyKeys = [];
                MemoryState.hashIndex.forEach((set, key) => { if (set.size === 0) emptyKeys.push(key); });
                emptyKeys.forEach(key => MemoryState.hashIndex.delete(key));
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

            prepareMemory: async (data, currentTurn, existingList, lorebook, char, chat, m_id = null) => {
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
                const meta = { 
                    t: currentTurn, ttl, imp, cat: 'personal', ent: [], 
                    summary: content.slice(0, 50),
                    s_id: MemoryState.currentSessionId,
                    m_id: m_id
                };

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
    // [ENGINE] CBSEngine
    // ══════════════════════════════════════════════════════════════
    const CBSEngine = (() => {
        const R = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(".*?"|-?\d+\.?\d*)$/;
        const safeTrim = (v) => typeof v === "string" ? v.trim() : "";

        function parseDefaultVariables(raw) {
            return String(raw || "").split(/\r?\n/g).map((line) => line.trim()).filter(Boolean).map((line) => {
                const eq = line.indexOf("=");
                if (eq === -1) return null;
                return [line.slice(0, eq).trim(), line.slice(eq + 1)];
            }).filter((pair) => pair && pair[0]);
        }

        function splitTopLevelCbsByDoubleColon(raw) {
            const src = String(raw || "");
            const result = [];
            let current = "", braceDepth = 0, parenDepth = 0;
            for (let i = 0; i < src.length; i += 1) {
                const two = src.slice(i, i + 2);
                if (two === "{{") { braceDepth += 1; current += two; i += 1; continue; }
                if (two === "}}" && braceDepth > 0) { braceDepth -= 1; current += two; i += 1; continue; }
                if (src[i] === "(") parenDepth += 1;
                if (src[i] === ")" && parenDepth > 0) parenDepth -= 1;
                if (two === "::" && braceDepth === 0 && parenDepth === 0) { result.push(current); current = ""; i += 1; continue; }
                current += src[i];
            }
            result.push(current);
            return result;
        }

        function readCbsTagAt(text, startIndex) {
            if (String(text || "").slice(startIndex, startIndex + 2) !== "{{") return null;
            let depth = 1, i = startIndex + 2;
            while (i < text.length) {
                const two = text.slice(i, i + 2);
                if (two === "{{") { depth += 1; i += 2; continue; }
                if (two === "}}") { depth -= 1; i += 2; if (depth === 0) return { start: startIndex, end: i, raw: text.slice(startIndex, i), inner: text.slice(startIndex + 2, i - 2) }; continue; }
                i += 1;
            }
            return null;
        }

        function findNextCbsTag(text, startIndex) {
            const src = String(text || "");
            for (let i = startIndex; i < src.length - 1; i += 1) { if (src[i] === "{" && src[i + 1] === "{") return readCbsTagAt(src, i); }
            return null;
        }

        function extractCbsBlock(text, startTag, blockName) {
            let depth = 1, cursor = startTag.end, elseTag = null;
            while (cursor < text.length) {
                const tag = findNextCbsTag(text, cursor);
                if (!tag) break;
                const inner = safeTrim(tag.inner);
                if (inner.startsWith(`#${blockName} `)) depth += 1;
                else if (inner === `/${blockName}`) { depth -= 1; if (depth === 0) return { body: text.slice(startTag.end, elseTag ? elseTag.start : tag.start), elseBody: elseTag ? text.slice(elseTag.end, tag.start) : "", end: tag.end }; }
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
            const parts = splitTopLevelCbsByDoubleColon(expr).map((s) => String(s ?? ""));
            const head = safeTrim(parts[0] || "");
            if (head === "arg") { const index = Math.max(0, (parseInt(safeTrim(parts[1] || "1"), 10) || 1) - 1); return args[index] ?? "null"; }
            if (head === "getvar") { const keyRaw = parts.slice(1).join("::"); const key = safeTrim(await renderStandaloneCbsText(keyRaw, runtime, args)); if (!key) return "null"; if (Object.prototype.hasOwnProperty.call(runtime.vars, key)) return runtime.vars[key]; if (Object.prototype.hasOwnProperty.call(runtime.globalVars, key)) return runtime.globalVars[key]; return "null"; }
            if (head === "calc") { const expression = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return evalStandaloneCbsCalc(expression); }
            if (head === "call") { runtime._callDepth = (runtime._callDepth || 0) + 1; if (runtime._callDepth > 20) { runtime._callDepth--; return "[ERROR:max recursion]"; } try { const fnName = safeTrim(await renderStandaloneCbsText(parts[1] || "", runtime, args)); const fnBody = runtime.functions[fnName]; if (!fnBody) return ""; const callArgs = []; for (let i = 2; i < parts.length; i += 1) callArgs.push(await renderStandaloneCbsText(parts[i], runtime, args)); return await renderStandaloneCbsText(fnBody, runtime, callArgs); } finally { runtime._callDepth--; } }
            if (head === "none") return "";
            if (head === "char_desc") return safeTrim(runtime?.char?.desc || runtime?.char?.description || "");
            if (head === "ujb") return safeTrim(runtime?.db?.globalNote || "");
            if (head === "system_note") return safeTrim(runtime?.db?.globalNote || "");
            if (head === "random") { const choices = parts.slice(1); if (choices.length === 0) return ""; const randIdx = Math.floor(Math.random() * choices.length); return await renderStandaloneCbsText(choices[randIdx], runtime, args); }
            if (head === "token_count") { const text = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return String(TokenizerEngine.estimateTokens(text, 'simple')); }
            if (["equal", "not_equal", "greater", "greater_equal", "less", "less_equal"].includes(head)) {
                const v1 = await renderStandaloneCbsText(parts[1] || "", runtime, args), v2 = await renderStandaloneCbsText(parts[2] || "", runtime, args);
                const n1 = Number(v1), n2 = Number(v2), isNum = !isNaN(n1) && !isNaN(n2);
                switch(head) {
                    case "equal": return v1 === v2 ? "1" : "0"; case "not_equal": return v1 !== v2 ? "1" : "0";
                    case "greater": return (isNum ? n1 > n2 : v1 > v2) ? "1" : "0"; case "greater_equal": return (isNum ? n1 >= n2 : v1 >= v2) ? "1" : "0";
                    case "less": return (isNum ? n1 < n2 : v1 < v2) ? "1" : "0"; case "less_equal": return (isNum ? n1 <= n2 : v1 <= v2) ? "1" : "0";
                }
            }
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
                if (inner.startsWith("#func ")) { const fnName = safeTrim(inner.slice(6)); const block = extractCbsBlock(src, tag, "func"); if (fnName) runtime.functions[fnName] = block.body; cursor = block.end; continue; }
                if (inner.startsWith("#if ")) { const conditionRaw = inner.slice(4); const block = extractCbsBlock(src, tag, "if"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#unless ")) { const conditionRaw = inner.slice(8); const block = extractCbsBlock(src, tag, "unless"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.elseBody : block.body, runtime, args); cursor = block.end; continue; }
                if (inner === "else" || inner === "/if" || inner === "/unless" || inner === "/func") { cursor = tag.end; continue; }
                out += await evalStandaloneCbsExpr(inner, runtime, args); cursor = tag.end;
            }
            return out;
        }

        return {
            process: async (text) => {
                if (!MemoryEngine.CONFIG.cbsEnabled) return text;
                const src = String(text ?? ""); if (!src || !src.includes("{{")) return src;
                try {
                    const runtime = await getStandaloneCbsRuntime();
                    return await renderStandaloneCbsText(src, runtime, []);
                } catch (e) { console.error("[LIBRA] CBS Process Error", e); return src; }
            },
            clean: (text) => typeof text === 'string' ? text.replace(/\{\{[^}]*\}\}/g, '').trim() : ""
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Complex World Detector
    // ══════════════════════════════════════════════════════════════
    const ComplexWorldDetector = (() => {
        const COMPLEX_PATTERNS = {
            multiverse: [/차원/, /평행\s*우주/, /멀티버스/, /이세계/, /다른\s*세계/, /워프/, /포탈/, /귀환/, /소환/, /전생/, /dimension/i, /parallel\s*universe/i, /multiverse/i, /another\s*world/i, /isekai/i, /warp/i, /portal/i, /summon/i, /reincarnation/i, /transmigrat/i],
            timeTravel: [/시간\s*여행/, /과거로/, /미래로/, /타임\s*머신/, /루프/, /회귀/, /타임\s*리프/, /time\s*travel/i, /to\s*the\s*past/i, /to\s*the\s*future/i, /time\s*machine/i, /time\s*loop/i, /regression/i, /time\s*leap/i],
            metaNarrative: [/작가/, /독자/, /4차\s*벽/, /픽션/, /이야기\s*속/, /메타/, /author/i, /reader/i, /fourth\s*wall/i, /fiction/i, /inside\s*the\s*story/i, /meta/i, /breaking.*wall/i],
            virtualReality: [/가상\s*현실/, /VR/, /게임\s*속/, /시뮬레이션/, /로그\s*(인|아웃)/, /던전/, /virtual\s*reality/i, /VR/i, /inside\s*the\s*game/i, /simulation/i, /log\s*(in|out)/i, /dungeon/i],
            dreamWorld: [/꿈\s*속/, /몽중/, /무의식/, /악몽/, /dream/i, /nightmare/i, /unconscious/i, /dreamworld/i]
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
                { pattern: /(.+?)에서\s+(.+?)으?로\s*(전생|환생|빙의)/, type: 'reincarnation' },
                // English patterns (use [^.,;!?]+ to avoid matching across sentence boundaries)
                { pattern: /(?:from|left)\s+([^.,;!?]+?)\s+(?:to|into|towards)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'movement' },
                { pattern: /(?:through|via)\s+([^.,;!?]+?)\s+(?:arrived?|entered?|reached?)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'portal' },
                { pattern: /summoned\s+(?:to|into)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'summon', singleGroup: true },
                { pattern: /(?:reincarnated?|reborn|transmigrated?)\s+(?:in|into|as)\s+([^.,;!?]+?)(?:\s|$|[.,;!?])/i, type: 'reincarnation', singleGroup: true }
            ];
            for (const mp of movePatterns) {
                const match = text.match(mp.pattern);
                if (match) {
                    if (mp.singleGroup) {
                        shifts.push({ type: mp.type, from: 'unknown', to: match[1]?.trim() || 'unknown', matched: match[0] });
                    } else {
                        shifts.push({ type: mp.type, from: match[1]?.trim() || 'unknown', to: match[2]?.trim() || 'unknown', matched: match[0] });
                    }
                }
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
You are an expert at extracting character and world information from conversations.

[현재 저장된 정보 / Currently Stored Information]
{STORED_INFO}

[대화 내용 / Conversation]
{CONVERSATION}

[작업 / Task]
대화에서 다음 정보를 추출하여 JSON 형식으로 출력:
Extract the following information from the conversation and output in JSON format:

1. 인물 정보 / Character Info (entities)
   - name: 이름/Name
   - appearance: { features: [], distinctiveMarks: [], clothing: [] }
   - personality: { traits: [], likes: [], dislikes: [], fears: [] }
   - background: { origin: "", occupation: "", history: [] }
   - status: { currentMood: "", currentLocation: "", healthStatus: "" }

2. 관계 정보 / Relationship Info (relations)
   - entityA, entityB: 인물 이름/Character names
   - relationType: 관계 유형/Relationship type
   - closenessDelta: 친밀도 변화/Closeness change (-0.3 ~ 0.3)

3. 세계관 정보 / World Info (world)
   - classification: { primary: "modern_reality" | "fantasy" | "wuxia" | "game_isekai" | ... }
   - exists: { magic: true/false, ki: true/false, ... }
   - systems: { leveling: true/false, skills: true/false, ... }

[규칙 / Rules]
- 명시적으로 언급된 정보만 추출 / Only extract explicitly mentioned information
- 기존 정보와 충돌하면 conflict 필드에 표시 / Mark conflicts with existing info in the conflict field
- Respond in the same language as the conversation content

[출력 / Output]
{ "entities": [...], "relations": [...], "world": {...}, "conflicts": [...] }`;

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity-Aware Processor
    // ══════════════════════════════════════════════════════════════
    const EntityAwareProcessor = (() => {
        const extractFromConversation = async (userMsg, aiResponse, storedInfo, config) => {
            if (!config.useLLM) return { success: true, entities: [], relations: [], world: {}, conflicts: [] };

            const systemInstruction = EntityExtractionPrompt.replace('{STORED_INFO}', storedInfo || '없음').replace('{CONVERSATION}', '');
            const userContent = `[사용자]\n${userMsg}\n\n[응답]\n${aiResponse}`;

            try {
                const result = await LLMProvider.call(config, systemInstruction, userContent, { maxTokens: 1500 });
                const content = result.content || '';
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error('No JSON found');
                const parsed = JSON.parse(jsonMatch[0]);
                return { success: true, entities: parsed.entities || [], relations: parsed.relations || [], world: parsed.world || {}, conflicts: parsed.conflicts || [] };
            } catch (e) {
                console.error('[LIBRA] Entity extraction failed:', e?.message);
                return { success: false, entities: [], relations: [], world: {}, conflicts: [], error: e?.message };
            }
        };

        const applyExtractions = async (extractions, lorebook, config, m_id = null) => {
            const { entities, relations, world, conflicts } = extractions;
            const appliedChanges = [];
            const s_id = MemoryState.currentSessionId;

            for (const entityData of entities || []) {
                if (!entityData.name) continue;
                const consistency = EntityManager.checkConsistency(entityData.name, entityData);
                if (!consistency.consistent && config.debug) {
                    console.warn(`[LIBRA] Entity consistency warning:`, consistency.conflicts);
                }
                const updated = EntityManager.updateEntity(entityData.name, {
                    appearance: entityData.appearance,
                    personality: entityData.personality,
                    background: entityData.background,
                    status: entityData.status,
                    source: 'conversation',
                    s_id, m_id
                }, lorebook);
                if (updated) appliedChanges.push(`Entity "${entityData.name}" updated`);
            }

            for (const relationData of relations || []) {
                if (!relationData.entityA || !relationData.entityB) continue;
                const updated = EntityManager.updateRelation(relationData.entityA, relationData.entityB, {
                    relationType: relationData.relationType,
                    details: { closeness: relationData.closenessDelta },
                    sentiments: relationData.sentiments,
                    event: relationData.event,
                    s_id, m_id
                }, lorebook);
                if (updated) appliedChanges.push(`Relation "${relationData.entityA} ↔ ${relationData.entityB}" updated`);
            }

            if (world && world.classification) {
                const worldProfile = HierarchicalWorldManager.getProfile();
                if (worldProfile && worldProfile.nodes.size > 0) {
                    const activePath = HierarchicalWorldManager.getActivePath();
                    const currentNodeId = activePath.length > 0 ? activePath[activePath.length - 1] : null;
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

        // 명시적 변경 요청 패턴 / Explicit change patterns
        const explicitChangePatterns = [
            /사실은\s*.+인\s*거야/,
            /알고보니\s*.+/,
            /세계관\s*(바꿔|변경|수정)/,
            /이제부터\s*.+/,
            /.+가\s*아니라\s*.+/,
            /설정\s*(바꾸|변경)/,
            /actually.+is\s/i, /turns?\s*out.+/i, /change\s*(the)?\s*world/i, /from\s*now\s*on/i, /it's\s*not.+but/i, /change\s*(the)?\s*setting/i
        ];

        for (const pattern of explicitChangePatterns) {
            if (pattern.test(text)) {
                return { type: 'explicit_change', confidence: 0.9, reason: '사용자가 명시적으로 설정 변경을 요청함 / User explicitly requested setting change' };
            }
        }

        // 암시적 확장 패턴 / Implicit expand patterns
        const implicitExpandPatterns = [
            /새로운\s*.+/,
            /처음\s*(보는|듣는)\s*.+/,
            /.+라는\s*(것이|존재가)\s*있어/,
            /new\s+.+/i, /first\s*time\s*(seeing|hearing)/i, /there\s*(is|are|exists?)\s+.+/i
        ];

        for (const pattern of implicitExpandPatterns) {
            if (pattern.test(text)) {
                return { type: 'implicit_expand', confidence: 0.6, reason: '이야기 전개상 새로운 요소 등장 / New element appeared in narrative' };
            }
        }

        // 실수/착각 가능성 / Mistake patterns
        const mistakePatterns = [
            /아\s*미안/, /잘못\s*(말했|적었)/, /아니\s*그게\s*아니라/,
            /oh\s*sorry/i, /my\s*(bad|mistake)/i, /i\s*meant/i, /no\s*that'?s?\s*not/i
        ];

        for (const pattern of mistakePatterns) {
            if (pattern.test(text)) {
                return { type: 'mistake', confidence: 0.4, reason: '사용자의 실수 가능성 / Possible user mistake' };
            }
        }

        // 기본값
        return { type: 'narrative', confidence: 0.5, reason: '일반적인 이야기 서술 / General narrative' };
    };

    // 충돌 감지
    const detectConflict = (newInfo, worldProfile) => {
        if (!worldProfile) return [];

        const conflicts = [];
        const rules = worldProfile.rules || {};
        const exists = rules.exists || {};

        // 마법 존재 여부 충돌
        if (newInfo.mentionsMagic !== undefined && newInfo.mentionsMagic !== exists.magic) {
            conflicts.push({
                area: 'exists',
                key: 'magic',
                type: 'existence_violation',
                existing: exists.magic,
                new: newInfo.mentionsMagic,
                description: `마법 존재 여부: ${exists.magic} → ${newInfo.mentionsMagic}`
            });
        }

        // 기 존재 여부 충돌
        if (newInfo.mentionsKi !== undefined && newInfo.mentionsKi !== exists.ki) {
            conflicts.push({
                area: 'exists',
                key: 'ki',
                type: 'existence_violation',
                existing: exists.ki,
                new: newInfo.mentionsKi,
                description: `기(氣) 존재 여부: ${exists.ki} → ${newInfo.mentionsKi}`
            });
        }

        // 신화적 존재 충돌
        if (newInfo.mythicalCreature && exists.mythical_creatures && !exists.mythical_creatures.includes(newInfo.mythicalCreature)) {
            conflicts.push({
                area: 'exists',
                key: 'mythical_creatures',
                type: 'entity_violation',
                existing: exists.mythical_creatures,
                new: newInfo.mythicalCreature,
                description: `${newInfo.mythicalCreature}는 이 세계관에 존재하지 않습니다`
            });
        }

        // 금지 요소 충돌
        const forbidden = worldProfile.consistency?.forbidden || [];
        for (const item of forbidden) {
            if (newInfo.content && newInfo.content.includes(item)) {
                conflicts.push({
                    area: 'forbidden',
                    key: item,
                    type: 'forbidden_violation',
                    description: `"${item}"는 이 세계관에서 금지된 요소입니다`
                });
            }
        }

        return conflicts;
    };

    // 조정 실행
    const executeAdjustment = (worldProfile, newInfo, adjustmentConfig, intent) => {
        const mode = adjustmentConfig.mode;
        const area = newInfo.area;
        const areaConfig = adjustmentConfig.adjustableAreas[area];

        if (!areaConfig?.adjustable) {
            return { success: false, reason: '해당 영역은 조정할 수 없습니다', action: 'reject' };
        }

        // 다이내믹 모드: 맥락 기반 판단
        if (mode === 'dynamic') {
            if (intent.type === 'explicit_change' && intent.confidence > 0.7) {
                // 명시적 변경 요청
                return applyChange(worldProfile, newInfo, 'auto_adjust');
            }
            if (intent.type === 'implicit_expand' && intent.confidence > 0.5) {
                // 암시적 확장
                return applyChange(worldProfile, newInfo, 'auto_expand');
            }
        }

        // 소프트 모드: 자동 조정
        if (mode === 'soft') {
            if (intent.confidence < 0.4) {
                return applyChange(worldProfile, newInfo, 'silent_adjust');
            }
        }

        // 하드 모드: 거부
        if (mode === 'hard') {
            return {
                success: false,
                action: 'reject_with_warning',
                reason: '엄격 모드: 세계관 설정을 변경할 수 없습니다',
                suggestion: '세계관 설정을 직접 수정하려면 설정 메뉴를 이용하세요'
            };
        }

        // 기본: 확인 요청
        return {
            success: false,
            action: 'confirm_needed',
            reason: '세계관과 충돌합니다',
            options: [
                { label: '네, 변경합니다', action: 'accept' },
                { label: '아니요, 유지합니다', action: 'reject' },
                { label: '이번만 예외', action: 'exception' }
            ]
        };
    };

    // 변경 적용
    const applyChange = (worldProfile, newInfo, action) => {
        const changes = [];
        const description = [];

        if (newInfo.area === 'exists' && newInfo.key) {
            if (['magic', 'ki', 'supernatural'].includes(newInfo.key)) {
                worldProfile.rules.exists[newInfo.key] = newInfo.value;
                changes.push({ path:`rules.exists.${newInfo.key}`, value: newInfo.value });
                description.push(`${newInfo.key === 'magic' ? '마법' : newInfo.key === 'ki' ? '기(氣)' : '초자연'}: ${newInfo.value}`);
            }
            if (newInfo.key === 'mythical_creatures' && newInfo.value) {
                if (!Array.isArray(worldProfile.rules.exists.mythical_creatures)) {
                    worldProfile.rules.exists.mythical_creatures = [];
                }
                if (!worldProfile.rules.exists.mythical_creatures.includes(newInfo.value)) {
                    worldProfile.rules.exists.mythical_creatures.push(newInfo.value);
                    changes.push({ path: 'rules.exists.mythical_creatures', added: newInfo.value });
                    description.push(`신화적 존재 추가: ${newInfo.value}`);
                }
            }
        }

        if (newInfo.area === 'systems' && newInfo.key) {
            worldProfile.rules.systems[newInfo.key] = newInfo.value;
            changes.push({ path:`rules.systems.${newInfo.key}`, value: newInfo.value });
            description.push(`시스템(${newInfo.key}): ${newInfo.value}`);
        }

        worldProfile.meta.updated = MemoryState.currentTurn;

        return { success: true, action, changes, description: description.join(', ') };
    };

    return { analyzeUserIntent, detectConflict, executeAdjustment, applyChange };
})();

// ══════════════════════════════════════════════════════════════
// [TRIGGER] RisuAI Event Handlers
// ══════════════════════════════════════════════════════════════
const writeMutex = { locked: false, queue: [] };

const acquireLock = () => new Promise(resolve => {
    if (!writeMutex.locked) { writeMutex.locked = true; resolve(); }
    else writeMutex.queue.push(resolve);
});

const releaseLock = () => {
    if (writeMutex.queue.length > 0) writeMutex.queue.shift()();
    else writeMutex.locked = false;
};

// 마지막 사용자 메시지 캐시 (beforeRequest → afterRequest 전달용)
let _lastUserMessage = '';

// 지연 초기화 (CHAT_START 대체 - beforeRequest 최초 호출 시 실행)
const _lazyInit = async (lore) => {
    if (MemoryState.isInitialized) return;
    MemoryEngine.rebuildIndex(lore);
    EntityManager.rebuildCache(lore);
    HierarchicalWorldManager.loadWorldGraph(lore);
    NarrativeTracker.loadState(lore);
    CharacterStateTracker.loadState(lore);
    WorldStateTracker.loadState(lore);
    const managed = MemoryEngine.getManagedEntries(lore);
    let maxTurn = 0;
    for (const entry of managed) {
        const meta = MemoryEngine.getCachedMeta(entry);
        if (meta.t > maxTurn) maxTurn = meta.t;
    }
    MemoryEngine.setTurn(maxTurn + 1);
    MemoryState.isInitialized = true;
    if (MemoryEngine.CONFIG.debug) {
        console.log(`[LIBRA] Lazy init. Turn: ${MemoryEngine.getCurrentTurn()}, Memories: ${managed.length}`);
        console.log(`[LIBRA] Entities: ${EntityManager.getEntityCache().size}, Relations: ${EntityManager.getRelationCache().size}`);
    }
};

if (typeof risuai !== 'undefined') {
    // beforeRequest: OpenAI 메시지 배열에 컨텍스트 주입
    risuai.addRisuReplacer('beforeRequest', async (messages, type) => {
        try {
            const char = await risuai.getCharacter();
            if (!char) return messages;

            const chat = char.chats?.[char.chatPage];
            if (!chat) return messages;

            const lore = MemoryEngine.getLorebook(char, chat);

            // 지연 초기화
            await _lazyInit(lore);

            // 1. 자동 롤백 및 동기화 실행 (삭제/스와이프 감지)
            await SyncEngine.syncMemory(char, chat, lore);

            HierarchicalWorldManager.loadWorldGraph(lore);
            if (EntityManager.getEntityCache().size === 0) {
                EntityManager.rebuildCache(lore);
            }

            let userMessage = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
            if (MemoryEngine.CONFIG.cbsEnabled && typeof CBSEngine !== 'undefined') {
                userMessage = await CBSEngine.process(userMessage);
                const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
                if (lastUserIdx >= 0) messages[lastUserIdx].content = userMessage;
            }
            _lastUserMessage = userMessage;

            // 언급된 엔티티 찾기
            const mentionedEntities = [];
            const entityCache = EntityManager.getEntityCache();
            for (const [name, entity] of entityCache) {
                if (userMessage.toLowerCase().includes(name.toLowerCase())) {
                    mentionedEntities.push(entity);
                }
            }

            // 세계관 프롬프트 생성
            const worldPrompt = HierarchicalWorldManager.formatForPrompt();

            // 엔티티 프롬프트
            const entityPrompt = mentionedEntities.length > 0
                ? mentionedEntities.map(e => EntityManager.formatEntityForPrompt(e)).join('\n\n')
                : '';

            // 관계 프롬프트
            const relationPrompt = mentionedEntities.length > 0
                ? Array.from(EntityManager.getRelationCache().values())
                    .filter(r => mentionedEntities.some(e => e.name === r.entityA || e.name === r.entityB))
                    .map(r => EntityManager.formatRelationForPrompt(r))
                    .join('\n\n')
                : '';

            // 기억 및 로어북 동적 검색 (RAG)
            const memoryCandidates = MemoryEngine.getManagedEntries(lore);
            const memories = await MemoryEngine.retrieveMemories(
                userMessage, MemoryEngine.getCurrentTurn(), memoryCandidates, {}, 10
            );
            const memoryText = MemoryEngine.formatMemories(memories);

            let lorebookText = '';
            if (MemoryEngine.CONFIG.useLorebookRAG) {
                // 일반 로어북을 메모리 엔진이 인식할 수 있도록 임시 META 래핑
                const standardLore = lore.filter(e => !e.comment || !e.comment.startsWith('lmai_')).map(e => ({
                    ...e,
                    content: `[META:{"t":${MemoryEngine.getCurrentTurn()},"ttl":-1,"imp":8}] ` + (e.content || '')
                }));
                
                if (standardLore.length > 0) {
                    const loreResults = await MemoryEngine.retrieveMemories(
                        userMessage, MemoryEngine.getCurrentTurn(), standardLore, {}, 3
                    );
                    if (loreResults.length > 0) {
                        lorebookText = loreResults.map((m, i) => `[참고 설정 ${i+1}] ${m.content.replace(MemoryEngine.META_PATTERN, '').slice(0, 400)}`).join('\n');
                    }
                }
            }

            // 컨텍스트 구성
            const contextParts = [];
            if (worldPrompt) contextParts.push(worldPrompt);
            if (lorebookText) contextParts.push('[로어북 설정 / Reference Lorebook]\n' + lorebookText);
            if (entityPrompt) contextParts.push('[인물 정보 / Character Info]\n' + entityPrompt);
            if (relationPrompt) contextParts.push('[관계 정보 / Relationship Info]\n' + relationPrompt);
            if (memories.length > 0) contextParts.push('[관련 기억 / Related Memories]\n' + memoryText);

            // Narrative context
            const narrativePrompt = NarrativeTracker.formatForPrompt();
            if (narrativePrompt) contextParts.push(narrativePrompt);

            // Character state context
            for (const entity of mentionedEntities) {
                const statePrompt = CharacterStateTracker.formatForPrompt(entity.name);
                if (statePrompt) contextParts.push(`[${entity.name} State]\n${statePrompt}`);
            }

            // World state context
            const worldStatePrompt = WorldStateTracker.formatForPrompt();
            if (worldStatePrompt) contextParts.push('[World State History]\n' + worldStatePrompt);

            const instructions = [
                '[지시사항 / Instructions]',
                '1. 위 세계관 및 [로어북 설정]을 최우선으로 준수하세요. / Strictly follow the world rules and [Reference Lorebook] above as the highest priority.',
                '2. 존재하지 않는 요소(마법, 기, 레벨 등)는 절대 언급하지 마세요. / Never mention non-existent elements.',
                '3. 인물 정보를 일관되게 유지하세요. 제공된 설정과 충돌하는 기억이나 행동을 생성하지 마세요. / Maintain character info consistently. Do not generate memories or actions that conflict with the provided settings.',
                '4. 진행 중인 이야기의 맥락을 유지하세요. / Maintain the context of ongoing storylines.',
                '5. 캐릭터의 감정, 위치, 건강 상태가 이전 턴과 일관되어야 합니다. / Character emotion, location, health must be consistent with previous turns.',
                '6. 세계관의 물리 법칙과 시스템 규칙을 위반하지 마세요. / Do not violate world physics and system rules.'
            ].join('\n');
            contextParts.push(instructions);

            if (contextParts.length === 0) return messages;
            const contextStr = contextParts.join('\n\n');

            // 시스템 메시지에 컨텍스트 주입
            const result = messages.map(m => ({ ...m }));
            const sysIdx = result.findIndex(m => m.role === 'system');
            if (sysIdx >= 0) {
                result[sysIdx].content = result[sysIdx].content + '\n\n' + contextStr;
            } else {
                result.unshift({ role: 'system', content: contextStr });
            }

            // Add context reminder before last user message
            if (contextParts.length > 1) {
                const lastUserIdx = result.map(m => m.role).lastIndexOf('user');
                if (lastUserIdx > 0) {
                    result.splice(lastUserIdx, 0, {
                        role: 'system',
                        content: '[Librarian System Context Reminder]\n' +
                            (narrativePrompt ? narrativePrompt + '\n' : '') +
                            (mentionedEntities.length > 0 ? 'Active characters: ' + mentionedEntities.map(e => e.name).join(', ') + '\n' : '') +
                            'Maintain consistency with all provided context.'
                    });
                }
            }

            if (MemoryEngine.CONFIG.debug) {
                console.log('[LIBRA] World:', HierarchicalWorldManager.getActivePath());
                console.log('[LIBRA] Entities:', mentionedEntities.length);
            }


            return result;
        } catch (e) {
            console.error('[LIBRA] beforeRequest Error:', e?.message || e);
            return messages;
        }
    });

    // afterRequest: 기억 저장 및 엔티티 업데이트
    risuai.addRisuReplacer('afterRequest', async (content, type) => {
        try {
            const char = await risuai.getCharacter();
            if (!char) return content;

            const chat = char.chats?.[char.chatPage];
            if (!chat) return content;

            // 인사말 필터링: 자동 생성된 첫 인사말은 분석에서 제외
            const aiMsg = chat.msgs[chat.msgs.length - 1];
            if (aiMsg && aiMsg.id === MemoryState.ignoredGreetingId) {
                if (MemoryEngine.CONFIG.debug) console.log(`[LIBRA] Bypassing analysis for isolated greeting: ${aiMsg.id}`);
                return content;
            }

            MemoryEngine.incrementTurn();

            const userMsg = _lastUserMessage;
            const aiResponse = content;

            if (!userMsg && !aiResponse) return content;

            const lore = MemoryEngine.getLorebook(char, chat);
            const config = MemoryEngine.CONFIG;

            // 월드 그래프 로드
            HierarchicalWorldManager.loadWorldGraph(lore);

            // 복잡 세계관 감지
            const complexAnalysis = ComplexWorldDetector.analyze(userMsg, aiResponse);

            if (config.debug && complexAnalysis.hasComplexElements) {
                console.log('[LIBRA] Complex indicators:', complexAnalysis.indicators);
                console.log('[LIBRA] Dimensional shifts:', complexAnalysis.dimensionalShifts);
            }

            // 차원 이동 처리
            for (const shift of complexAnalysis.dimensionalShifts) {
                if (!shift.to) continue;
                const profile = HierarchicalWorldManager.getProfile();
                if (!profile?.nodes) continue;
                let targetNode = null;

                for (const [id, node] of profile.nodes) {
                    if (node.name.includes(shift.to) || shift.to.includes(node.name)) {
                        targetNode = node;
                        break;
                    }
                }

                if (!targetNode) {
                    const createResult = HierarchicalWorldManager.createNode({
                        name: shift.to,
                        layer: 'dimension',
                        parent: profile.rootId,
                        source: 'auto_detected'
                    });
                    if (createResult.success) {
                        targetNode = createResult.node;
                        if (config.debug) console.log('[LIBRA] New dimension created:', shift.to);
                    }
                }

                if (targetNode) {
                    HierarchicalWorldManager.changeActivePath(targetNode.id, { method: shift.type });
                }
            }

            // 전역 설정 업데이트
            const profile = HierarchicalWorldManager.getProfile();
            if (complexAnalysis.indicators.multiverse && !profile.global.multiverse) {
                profile.global.multiverse = true;
                profile.global.dimensionTravel = true;
            }
            if (complexAnalysis.indicators.timeTravel) profile.global.timeTravel = true;
            if (complexAnalysis.indicators.metaNarrative) profile.global.metaNarrative = true;

            // 엔티티 정보 추출
            const storedInfo = EntityAwareProcessor.formatStoredInfo();
            const entityResult = await EntityAwareProcessor.extractFromConversation(
                userMsg, aiResponse, storedInfo, config
            );

            const m_id = aiMsg?.id;

            if (entityResult.success) {
                for (const entityData of entityResult.entities || []) {
                    if (!entityData.name) continue;
                    const consistency = EntityManager.checkConsistency(entityData.name, entityData);
                    if (!consistency.consistent && config.debug) {
                        console.warn(`[LIBRA] Entity consistency warning:`, consistency.conflicts);
                    }
                }
                await EntityAwareProcessor.applyExtractions(entityResult, lore, config, m_id);
            }

            // Record narrative
            const involvedEntities = (entityResult.success && entityResult.entities)
                ? entityResult.entities.map(e => e.name).filter(Boolean)
                : [];
            NarrativeTracker.recordTurn(MemoryEngine.getCurrentTurn(), userMsg, aiResponse, involvedEntities);
            await NarrativeTracker.summarizeIfNeeded(MemoryEngine.getCurrentTurn(), config);

            // Track character states
            if (entityResult.success) {
                for (const entityData of entityResult.entities || []) {
                    if (!entityData.name || !entityData.status) continue;
                    const isCritical = CharacterStateTracker.isCriticalMoment(entityData.name, entityData.status);
                    CharacterStateTracker.recordState(entityData.name, MemoryEngine.getCurrentTurn(), entityData.status);
                    if (isCritical) {
                        CharacterStateTracker.recordCriticalMoment(entityData.name, MemoryEngine.getCurrentTurn(),
                            `Critical change: ${JSON.stringify(entityData.status)}`);
                    }
                    await CharacterStateTracker.consolidateIfNeeded(entityData.name, MemoryEngine.getCurrentTurn(), config);
                }
            }

            // Track world state
            const worldProfile = HierarchicalWorldManager.getProfile();
            const currentRules = HierarchicalWorldManager.getCurrentRules();
            const worldSnapshot = {
                activePath: worldProfile?.activePath || [],
                rules: currentRules,
                global: worldProfile?.global || {},
                notes: complexAnalysis.hasComplexElements ? `Complex: ${Object.keys(complexAnalysis.indicators).join(',')}` : ''
            };
            const isWorldCritical = WorldStateTracker.isCriticalMoment(worldSnapshot);
            WorldStateTracker.recordState(MemoryEngine.getCurrentTurn(), worldSnapshot);
            if (isWorldCritical) {
                WorldStateTracker.recordCriticalMoment(MemoryEngine.getCurrentTurn(),
                    `World path changed: ${(worldSnapshot.activePath || []).join('→')}`);
            }
            await WorldStateTracker.consolidateIfNeeded(MemoryEngine.getCurrentTurn(), config);

            // 일반 기억 저장
            const newMemory = await MemoryEngine.prepareMemory(
                { content: `[사용자] ${userMsg}\n[응답] ${aiResponse}`, importance: 5 },
                MemoryEngine.getCurrentTurn(), lore, lore, char, chat, m_id
            );

            if (newMemory) {
                lore.push(newMemory);
                MemoryEngine.setLorebook(char, chat, lore);
            }

            // 트래커 등록 (m_id가 있을 경우)
            if (m_id) {
                const createdKeys = [];
                if (newMemory) createdKeys.push(newMemory.key || TokenizerEngine.getSafeMapKey(newMemory.content));
                // 엔티티와 관계 키는 EntityManager 캐시에서 이번 턴에 업데이트된 것들을 찾아야 함
                // 일단 m_id 태그가 된 로어북 엔트리들을 다음 롤백 시점에 찾으므로 여기서는 최소한만 기록
                MemoryState.rollbackTracker.set(m_id, createdKeys);
            }

            // 저장 (EntityManager.saveToLorebook 내부에서 setCharacter 호출)
            await HierarchicalWorldManager.saveWorldGraph(char, chat, lore);
            await EntityManager.saveToLorebook(char, chat, lore);
            await NarrativeTracker.saveState(lore);
            await CharacterStateTracker.saveState(lore);
            await WorldStateTracker.saveState(lore);

            return content;
        } catch (e) {
            console.error('[LIBRA] afterRequest Error:', e?.message || e);
            return content;
        }
    });
}

// ══════════════════════════════════════════════════════════════
// [MAIN] Initialization
// ══════════════════════════════════════════════════════════════
const updateConfigFromArgs = async () => {
    const cfg = MemoryEngine.CONFIG;
    let local = {};

    try {
        const saved = await risuai.pluginStorage.getItem('LMAI_Config');
        if (saved) local = typeof saved === 'string' ? JSON.parse(saved) : saved;
    } catch (e) {
        console.warn('[LIBRA] Config load failed:', e?.message || e);
    }

    const getVal = (key, argName, type, parent, fallback) => {
        const localVal = parent ? local[parent]?.[key] : local[key];
        let argVal;
        try { argVal = risuai.getArgument(argName); } catch {}
        const configVal = parent ? cfg[parent]?.[key] : cfg[key];
        const raw = localVal !== undefined ? localVal : argVal !== undefined ? argVal : configVal !== undefined ? configVal : fallback;

        if (raw === undefined || raw === null) return fallback;

        switch (type) {
            case 'number': { const n = Number(raw); return isNaN(n) ? (fallback ?? configVal) : n; }
            case 'boolean': return raw === true || raw === 1 || raw === 'true' || raw === '1';
            default: return String(raw);
        }
    };

    cfg.maxLimit = getVal('maxLimit', 'max_limit', 'number', null, 200);
    cfg.threshold = getVal('threshold', 'threshold', 'number', null, 5);
    cfg.simThreshold = getVal('simThreshold', 'sim_threshold', 'number', null, 0.25);
    cfg.debug = getVal('debug', 'debug', 'boolean', null, false);
    cfg.useLLM = getVal('useLLM', 'use_llm', 'boolean', null, true);
    cfg.cbsEnabled = getVal('cbsEnabled', 'cbs_enabled', 'boolean', null, true);
    cfg.useLorebookRAG = getVal('useLorebookRAG', 'use_lorebook_rag', 'boolean', null, true);
    cfg.emotionEnabled = getVal('emotionEnabled', 'emotion_enabled', 'boolean', null, true);
    cfg.worldAdjustmentMode = getVal('worldAdjustmentMode', 'world_adjustment_mode', 'string', null, 'dynamic');

    cfg.llm = {
        provider: getVal('provider', 'llm_provider', 'string', 'llm', 'openai'),
        url: getVal('url', 'llm_url', 'string', 'llm', ''),
        key: getVal('key', 'llm_key', 'string', 'llm', ''),
        model: getVal('model', 'llm_model', 'string', 'llm', 'gpt-4o-mini'),
        temp: getVal('temp', 'llm_temp', 'number', 'llm', 0.3),
        timeout: getVal('timeout', 'llm_timeout', 'number', 'llm', 15000)
    };

    cfg.embed = {
        provider: getVal('provider', 'embed_provider', 'string', 'embed', 'openai'),
        url: getVal('url', 'embed_url', 'string', 'embed', ''),
        key: getVal('key', 'embed_key', 'string', 'embed', ''),
        model: getVal('model', 'embed_model', 'string', 'embed', 'text-embedding-3-small')
    };

    const mode = (getVal('weightMode', 'weight_mode', 'string', null, 'auto')).toLowerCase();
    cfg.weightMode = mode;

    const presets = {
        romance: { similarity: 0.5, importance: 0.3, recency: 0.2 },
        action: { similarity: 0.4, importance: 0.2, recency: 0.4 },
        mystery: { similarity: 0.4, importance: 0.5, recency: 0.1 },
        daily: { similarity: 0.3, importance: 0.3, recency: 0.4 }
    };

    if (presets[mode]) {
        cfg.weights = presets[mode];
    } else {
        cfg.weights = {
            similarity: getVal('w_sim', 'w_sim', 'number', null, 0.5),
            importance: getVal('w_imp', 'w_imp', 'number', null, 0.3),
            recency: getVal('w_rec', 'w_rec', 'number', null, 0.2)
        };
        const sum = cfg.weights.similarity + cfg.weights.importance + cfg.weights.recency;
        if (sum > 0 && Math.abs(sum - 1) > 0.01) {
            cfg.weights.similarity /= sum;
            cfg.weights.importance /= sum;
            cfg.weights.recency /= sum;
        }
    }
};

// Initialize
(async () => {
    try {
        console.log('[LIBRA] v2.4.0 Initializing...');
        await updateConfigFromArgs();

        if (typeof risuai !== 'undefined') {
            const char = await risuai.getCharacter();
            if (char) {
                const chat = char?.chats?.[char.chatPage];
                // 세션 ID 생성
                MemoryState.currentSessionId = `sess_${chat?.id || 'global'}_${Date.now()}`;

                if (chat) {
                    const lore = (chat.localLore) || char.lorebook || [];
                    if (Array.isArray(lore)) {
                        HierarchicalWorldManager.loadWorldGraph(lore);
                        EntityManager.rebuildCache(lore);
                        NarrativeTracker.loadState(lore);
                        CharacterStateTracker.loadState(lore);
                        WorldStateTracker.loadState(lore);
                    }
                }
            }
        }

        MemoryState.isInitialized = true;
        console.log(`[LIBRA] v2.4.0 Ready. LLM=${MemoryEngine.CONFIG.useLLM} | Mode=${MemoryEngine.CONFIG.weightMode}`);
        
        // Memory Carry-Over 및 Cold Start 감지 실행
        if (typeof risuai !== 'undefined') {
            setTimeout(async () => {
                const restored = await TransitionManager.restoreTransition();
                if (!restored) {
                    await ColdStartManager.check();
                }
            }, 2000);
        }
    } catch (e) {
        console.error("[LIBRA] Init Error:", e?.message || e);
    }
})();

// ══════════════════════════════════════════════════════════════
// [GUI] LIBRA World Manager UI (V1.1 Rendering Method Applied)
// ══════════════════════════════════════════════════════════════
const LMAI_GUI = (() => {
    const GUI_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#1a1a2e;--bg2:#16213e;--bg3:#0f3460;--accent:#533483;--accent2:#6a44a0;--text:#e0e0e0;--text2:#a0a0b0;--border:#2a2a4a;--success:#2ecc71;--danger:#e74c3c;--radius:8px}
.lmai-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;color:var(--text)}
.gui-wrap{width:100%;max-width:720px;height:85vh;background:var(--bg);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5)}
.hdr{background:var(--bg2);border-bottom:1px solid var(--border);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.hdr h1{font-size:15px;font-weight:600;white-space:nowrap;margin:0}
.tabs{display:flex;gap:3px;background:var(--bg);border-radius:var(--radius);padding:3px;flex:1}
.tb{flex:1;padding:5px 8px;border:none;background:transparent;color:var(--text2);cursor:pointer;border-radius:6px;font-size:12px;transition:all .2s}
.tb:hover{background:var(--bg3);color:var(--text)}
.tb.on{background:var(--accent);color:#fff}
.xbtn{background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:17px;padding:3px 8px;border-radius:var(--radius);transition:all .2s}
.xbtn:hover{background:var(--danger);color:#fff}
.content{flex:1;overflow:hidden}
.panel{display:none;height:100%;overflow-y:auto;padding:14px}
.panel.on{display:block}
.toolbar{display:flex;gap:7px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
input,select,textarea{background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:5px 9px;border-radius:var(--radius);font-size:13px;outline:none;transition:border-color .2s}
input:focus,select:focus,textarea:focus{border-color:var(--accent2)}
.si{flex:1;min-width:150px}
.stat{font-size:12px;color:var(--text2);white-space:nowrap}
.list{display:flex;flex-direction:column;gap:7px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:11px;transition:border-color .2s}
.card:hover{border-color:var(--accent2)}
.card-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:7px;gap:8px}
.card-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px}
.bdg{font-size:11px;padding:2px 7px;border-radius:10px;font-weight:500;white-space:nowrap}
.bh{background:#2d4a2d;color:#5dbb5d}
.bm{background:#4a3d1a;color:#c89c1a}
.bl{background:#2a2a2a;color:#888}
.bt{background:var(--bg3);color:var(--text2)}
.acts{display:flex;gap:5px;flex-shrink:0}
.btn{padding:4px 9px;border:none;border-radius:var(--radius);font-size:12px;cursor:pointer;transition:all .2s}
.bp{background:var(--accent);color:#fff}.bp:hover{background:var(--accent2)}
.bs{background:var(--success);color:#fff}.bs:hover{opacity:0.85}
.bd{background:transparent;border:1px solid var(--danger);color:var(--danger)}.bd:hover{background:var(--danger);color:#fff}
.sec{font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin:14px 0 7px;border-bottom:1px solid var(--border);padding-bottom:5px}
.sec:first-child{margin-top:0}
.sgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:780px){.sgrid{grid-template-columns:1fr}.gui-wrap{max-width:100%;height:100vh;border-radius:0}}
.ss{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px}
.ss h3{font-size:12px;margin-bottom:10px;color:var(--text2)}
.fld{display:flex;flex-direction:column;gap:3px;margin-bottom:9px}
.fld label{font-size:11px;color:var(--text2)}
.fld input,.fld select,.fld textarea{width:100%}
.tr{display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)}
.tr:last-child{border-bottom:none}
.tr label{font-size:13px}
.tog{position:relative;width:34px;height:19px}
.tog input{opacity:0;width:0;height:0}
.tsl{position:absolute;top:0;left:0;right:0;bottom:0;background:var(--border);border-radius:19px;cursor:pointer;transition:.2s}
.tsl:before{content:'';position:absolute;width:15px;height:15px;left:2px;bottom:2px;background:#fff;border-radius:50%;transition:.2s}
.tog input:checked+.tsl{background:var(--accent)}
.tog input:checked+.tsl:before{transform:translateX(15px)}
.wt{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px;min-height:60px}
.wn{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:var(--radius);cursor:pointer;transition:background .2s}
.wn:hover{background:var(--bg3)}
.wn.cur{background:var(--accent)}
.wn-name{font-size:13px}
.wn-layer{font-size:11px;color:var(--text2)}
.sbar{position:sticky;bottom:0;background:var(--bg2);border-top:1px solid var(--border);padding:9px 14px;display:flex;gap:7px}
.toast{position:fixed;bottom:65px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:7px 18px;border-radius:18px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:999;white-space:nowrap}
.toast.on{opacity:1}
.ec{width:100%;background:var(--bg);border:1px solid transparent;color:var(--text);padding:3px 5px;border-radius:4px;font-size:12px;line-height:1.5;resize:none;transition:border-color .2s}
.ec:focus{border-color:var(--accent2);outline:none}
.rw{display:flex;gap:7px;align-items:center}
.rw input[type=range]{flex:1;accent-color:var(--accent)}
.rv{min-width:28px;text-align:right;font-size:12px;color:var(--text2)}
.empty{text-align:center;color:var(--text2);font-size:13px;padding:30px 0}
.cs{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}
.ci{background:var(--bg3);padding:5px 11px;border-radius:var(--radius);font-size:12px;color:var(--text2)}
.ef{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:5px}
.add-form{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px;display:none}
.add-form.on{display:block}
    `;

    const GUI_BODY = `
<div class="gui-wrap">
<div class="hdr">
  <h1>📚 LIBRA World Manager <span style="font-size:0.7rem; font-weight:normal; opacity:0.5;">v2.4.0</span></h1>
  <div class="tabs">
    <button class="tb on" data-tab="memory">📚 메모리</button>
    <button class="tb" data-tab="entity">👤 엔티티</button>
    <button class="tb" data-tab="world">🌍 세계관</button>
    <button class="tb" data-tab="settings">⚙ 설정</button>
  </div>
  <button class="xbtn" id="xbtn">✕</button>
</div>
<div class="content">
  <div id="tab-memory" class="panel on">
    <div class="toolbar">
      <input type="text" id="ms" class="si" placeholder="🔍 메모리 검색...">
      <select id="mf">
        <option value="all">전체 중요도</option>
        <option value="h">높음 (7+)</option>
        <option value="m">중간 (4-6)</option>
        <option value="l">낮음 (1-3)</option>
      </select>
      <span class="stat">총 <strong id="mc">0</strong>개</span>
      <button class="btn bs" id="btn-toggle-add-mem">➕ 추가</button>
      <button class="btn bp" id="btn-save-all-mem">💾 저장</button>
    </div>
    <div id="amf" class="add-form">
      <div class="fld"><label>내용</label><textarea id="am-c" rows="3" class="ec" placeholder="새 메모리 내용..."></textarea></div>
      <div class="ef">
        <div class="fld"><label>중요도 (1-10)</label><input type="number" id="am-i" min="1" max="10" value="5"></div>
        <div class="fld"><label>카테고리</label><input type="text" id="am-cat" placeholder="일반"></div>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-mem">추가</button>
        <button class="btn bd" id="btn-cancel-mem">취소</button>
      </div>
    </div>
    <div id="ml" class="list"></div>
  </div>
  <div id="tab-entity" class="panel">
    <div class="toolbar">
      <button class="btn bs" id="btn-toggle-add-ent">➕ 인물 추가</button>
      <button class="btn bs" id="btn-toggle-add-rel">➕ 관계 추가</button>
      <button class="btn bp" id="btn-save-ents">💾 저장</button>
    </div>
    <div id="aef" class="add-form">
      <div class="fld"><label>이름</label><input type="text" id="ae-name" placeholder="캐릭터 이름"></div>
      <div class="ef">
        <div class="fld"><label>직업</label><input type="text" id="ae-occ" placeholder="직업"></div>
        <div class="fld"><label>위치</label><input type="text" id="ae-loc" placeholder="현재 위치"></div>
      </div>
      <div class="fld"><label>외모 특징 (쉼표 구분)</label><input type="text" id="ae-feat" placeholder="검은 머리, 키 큰"></div>
      <div class="fld"><label>성격 특성 (쉼표 구분)</label><input type="text" id="ae-trait" placeholder="친절한, 용감한"></div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-ent">추가</button>
        <button class="btn bd" id="btn-cancel-ent">취소</button>
      </div>
    </div>
    <div id="arf" class="add-form">
      <div class="ef">
        <div class="fld"><label>인물 A</label><input type="text" id="ar-a" placeholder="인물 A"></div>
        <div class="fld"><label>인물 B</label><input type="text" id="ar-b" placeholder="인물 B"></div>
      </div>
      <div class="ef">
        <div class="fld"><label>관계 유형</label><input type="text" id="ar-type" placeholder="친구, 연인 등"></div>
        <div class="fld"><label>친밀도</label><div class="rw"><input type="range" id="ar-cls" min="0" max="100" value="50"><span id="ar-clsv" class="rv">50</span></div></div>
      </div>
      <div class="ef">
        <div class="fld"><label>신뢰도</label><div class="rw"><input type="range" id="ar-trs" min="0" max="100" value="50"><span id="ar-trsv" class="rv">50</span></div></div>
        <div class="fld"><label>감정 (A→B)</label><input type="text" id="ar-sent" placeholder="호감, 경계 등"></div>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-rel">추가</button>
        <button class="btn bd" id="btn-cancel-rel">취소</button>
      </div>
    </div>
    <div class="sec">👥 인물 목록</div>
    <div id="el" class="list"></div>
    <div class="sec">🤝 관계 목록</div>
    <div id="rl" class="list"></div>
  </div>
  <div id="tab-world" class="panel">
    <div class="sec">🗺 세계관 트리</div>
    <div id="wt" class="wt"></div>
    <div class="sec">🌐 전역 기능</div>
    <div class="wt">
      <div class="tr"><label>멀티버스</label><label class="tog"><input type="checkbox" id="w1"><span class="tsl"></span></label></div>
      <div class="tr"><label>차원 이동</label><label class="tog"><input type="checkbox" id="w2"><span class="tsl"></span></label></div>
      <div class="tr"><label>시간 여행</label><label class="tog"><input type="checkbox" id="w3"><span class="tsl"></span></label></div>
      <div class="tr"><label>메타 서술</label><label class="tog"><input type="checkbox" id="w4"><span class="tsl"></span></label></div>
    </div>
    <div class="sec">📋 현재 세계 규칙</div>
    <div id="wr" class="wt" style="font-size:12px"></div>
    <div class="sbar"><button class="btn bp" id="btn-save-world">💾 세계관 저장</button></div>
  </div>
  <div id="tab-settings" class="panel">
    <div class="sgrid">
      <div class="ss">
        <h3>🤖 LLM 설정</h3>
        <div class="fld"><label>Provider</label><select id="slp"><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="vertex">Vertex</option><option value="copilot">Copilot</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="slu" placeholder="https://api.openai.com/v1/chat/completions"></div>
        <div class="fld"><label>API Key</label><input type="password" id="slk" placeholder="sk-..."></div>
        <div class="fld"><label>Model</label><input type="text" id="slm" placeholder="gpt-4o-mini"></div>
        <div class="fld"><label>Temperature</label><div class="rw"><input type="range" id="slt" min="0" max="1" step="0.1"><span id="sltv" class="rv">0.3</span></div></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="slto" placeholder="15000"></div>
      </div>
      <div class="ss">
        <h3>🧠 Embedding 설정</h3>
        <div class="fld"><label>Provider</label><select id="sep"><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="vertex">Vertex</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="seu" placeholder="https://api.openai.com/v1/embeddings"></div>
        <div class="fld"><label>API Key</label><input type="password" id="sek" placeholder="sk-..."></div>
        <div class="fld"><label>Model</label><input type="text" id="sem" placeholder="text-embedding-3-small"></div>
      </div>
      <div class="ss">
        <h3>💾 메모리 설정</h3>
        <div class="fld"><label>최대 메모리 수</label><input type="number" id="sml" placeholder="200"></div>
        <div class="fld"><label>중요도 임계값</label><input type="number" id="sth" placeholder="5"></div>
        <div class="fld"><label>유사도 임계값</label><div class="rw"><input type="range" id="sst" min="0" max="1" step="0.05"><span id="sstv" class="rv">0.25</span></div></div>
        <div class="fld"><label>GC 배치 크기</label><input type="number" id="sgc" placeholder="5"></div>
      </div>
      <div class="ss">
        <h3>🔧 플러그인 기능</h3>
        <div class="tr"><label>LLM 사용</label><label class="tog"><input type="checkbox" id="sul"><span class="tsl"></span></label></div>
        <div class="tr"><label>CBS 엔진 사용</label><label class="tog"><input type="checkbox" id="scbs" title="매크로 및 조건부 텍스트({{...}})를 처리합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>로어북 동적 참조 (RAG)</label><label class="tog"><input type="checkbox" id="slrag" title="일반 로어북의 설정도 검색하여 AI에게 전달합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>감정 분석 사용</label><label class="tog"><input type="checkbox" id="semo" title="감정 분석 엔진을 활성화합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>외부 모듈 호환성 (GigaTrans, Lboard)</label><label class="tog"><input type="checkbox" id="smc" title="GigaTrans, 라이트보드 등 외부 모듈의 특수 태그를 정제합니다."><span class="tsl"></span></label></div>
        <div class="tr"><label>디버그 모드</label><label class="tog"><input type="checkbox" id="sdb"><span class="tsl"></span></label></div>
      </div>
      <div class="ss">
        <h3>⚖ 가중치 & 모드</h3>
        <div class="fld"><label>가중치 모드</label>
          <select id="swm">
            <option value="auto">자동 (장르 감지)</option>
            <option value="romance">로맨스</option>
            <option value="action">액션</option>
            <option value="mystery">미스터리</option>
            <option value="daily">일상</option>
            <option value="custom">커스텀</option>
          </select>
        </div>
        <div id="cw" style="display:none">
          <div class="fld"><label>유사도 <span id="wsv" class="rv">0.50</span></label><input type="range" id="sws" min="0" max="1" step="0.05"></div>
          <div class="fld"><label>중요도 <span id="wiv" class="rv">0.30</span></label><input type="range" id="swi" min="0" max="1" step="0.05"></div>
          <div class="fld"><label>최신성 <span id="wrv" class="rv">0.20</span></label><input type="range" id="swr" min="0" max="1" step="0.05"></div>
        </div>
        <div class="fld"><label>세계관 조정 모드</label>
          <select id="sam">
            <option value="dynamic">다이내믹 (맥락 기반)</option>
            <option value="soft">소프트 (자동 조정)</option>
            <option value="hard">하드 (엄격 거부)</option>
          </select>
        </div>
      </div>
    </div>
    <div class="sec">📊 캐시 통계</div>
    <div id="cst" class="cs"></div>
    <div class="sbar">
      <button class="btn bp" id="btn-transition">🚀 다음 세션으로 대화 이어가기</button>
      <button class="btn bp" id="btn-cold-start">🔄 과거 대화 분석</button>
      <button class="btn bp" id="btn-save-settings">💾 설정 저장</button>
      <button class="btn bd" id="btn-reset-settings">🔄 초기화</button>
    </div>
  </div>
</div>
</div>
<div id="toast" class="toast"></div>
    `;

    const show = async () => {
        const R = (typeof Risuai !== 'undefined') ? Risuai : (typeof risuai !== 'undefined' ? risuai : null);
        if (!R) return;

        // 기존 레이어가 있다면 제거
        const existingOverlay = document.getElementById('lmai-overlay');
        if (existingOverlay) existingOverlay.remove();

        // 1. V1.1 방식: DOM 엘리먼트 직접 생성 (보안정책 우회)
        const overlay = document.createElement('div');
        overlay.id = 'lmai-overlay';
        overlay.className = 'lmai-overlay';
        
        // CSS 주입
        const style = document.createElement('style');
        style.textContent = GUI_CSS;
        overlay.appendChild(style);

        // 본문 주입
        const bodyWrap = document.createElement('div');
        bodyWrap.style.width = '100%';
        bodyWrap.style.display = 'flex';
        bodyWrap.style.justifyContent = 'center';
        bodyWrap.innerHTML = GUI_BODY;
        overlay.appendChild(bodyWrap);

        document.body.appendChild(overlay);

        // 2. 데이터 준비
        const char = await R.getCharacter();
        const chat = char?.chats?.[char.chatPage];
        const lore = char ? (MemoryEngine.getLorebook(char, chat) || []) : [];

        let _MEM = lore.filter(e => e.comment === 'lmai_memory');
        let _ENT = lore.filter(e => e.comment === 'lmai_entity');
        let _REL = lore.filter(e => e.comment === 'lmai_relation');
        const worldEntry = lore.find(e => e.comment === 'lmai_world_graph');

        let _WLD = { nodes: [], activePath: [], global: {}, rootId: null };
        try {
            if (worldEntry) {
                const p = JSON.parse(worldEntry.content);
                _WLD = {
                    ...p,
                    nodes: p.nodes instanceof Map ? Array.from(p.nodes.entries()) : Array.isArray(p.nodes) ? p.nodes : Object.entries(p.nodes || {})
                };
            } else {
                const profile = HierarchicalWorldManager.getProfile();
                if (profile) {
                    _WLD = { nodes: Array.from(profile.nodes.entries()), activePath: profile.activePath || [], global: profile.global || {}, rootId: profile.rootId };
                }
            }
        } catch {}

        let _CFG = { ...MemoryEngine.CONFIG };
        try {
            const saved = await R.pluginStorage.getItem('LMAI_Config');
            if (saved) {
                const p = typeof saved === 'string' ? JSON.parse(saved) : saved;
                _CFG = { ..._CFG, ...p };
            }
        } catch {}

        // 유틸리티 함수
        const esc = (s) => { const d = document.createElement("div"); d.appendChild(document.createTextNode(s||"")); return d.innerHTML; };
        const escAttr = (s) => esc(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;");
        const toast = (m, d) => { const t = overlay.querySelector("#toast"); t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), d||2000); };
        const parseMeta = (c) => { var m=(c||"").match(/\[META:(\{.*?\})\]/); if(!m)return{imp:5,t:0,ttl:0,cat:""}; try{return JSON.parse(m[1]);}catch(e){return{imp:5,t:0,ttl:0,cat:""};} };
        const stripMeta = (c) => (c||"").replace(/\[META:\{.*?\}\]/g,"").trim();
        const impBdg = (i) => { const cls = i>=7?"bh":i>=4?"bm":"bl"; return `<span class="bdg ${cls}">중요도 ${i}</span>`; };
        
        const saveLoreToChar = async (newLore, cb) => {
            if (!char) return;
            await loreLock.writeLock();
            try {
                const targetChat = char.chats?.[char.chatPage];
                if (Array.isArray(char.lorebook)) char.lorebook = newLore;
                else if (targetChat) targetChat.localLore = newLore;
                await R.setCharacter(char);
                if (cb) cb();
            } catch (e) {
                toast("❌ 저장 실패");
                console.error("[LIBRA] Save Error:", e);
            } finally {
                loreLock.writeUnlock();
            }
        };

        // UI 업데이트 로직
        const switchTab = (n) => {
            overlay.querySelectorAll(".panel").forEach(p => p.classList.remove("on"));
            overlay.querySelectorAll(".tb").forEach(b => {
                b.classList.remove("on");
                if (b.dataset.tab === n) b.classList.add("on");
            });
            overlay.querySelector("#tab-" + n).classList.add("on");
        };

        const renderMems = (list) => {
            const c = overlay.querySelector("#ml");
            overlay.querySelector("#mc").textContent = list.length;
            if (!list.length) { c.innerHTML = '<div class="empty">저장된 메모리가 없습니다</div>'; return; }
            c.innerHTML = list.map((m) => {
                const meta = parseMeta(m.content);
                const content = stripMeta(m.content);
                const idx = _MEM.indexOf(m);
                const ttl = meta.ttl === -1 ? "영구" : (meta.ttl || 0) + "turn";
                return `<div class="card" id="mc-${idx}">
                    <div class="card-hdr">
                        <div class="card-meta">${impBdg(meta.imp||5)}<span class="bdg bt">턴 ${meta.t||0}</span><span class="bdg bt">TTL:${ttl}</span>${meta.cat ? `<span class="bdg bt">${esc(meta.cat)}</span>` : ''}</div>
                        <div class="acts">
                            <button class="btn bp act-save-mem" data-idx="${idx}">저장</button>
                            <button class="btn bd act-del-mem" data-idx="${idx}">삭제</button>
                        </div>
                    </div>
                    <textarea class="ec mt-val" data-idx="${idx}" rows="3">${esc(content)}</textarea>
                    <div style="display:flex;gap:7px;align-items:center;margin-top:5px">
                        <label style="font-size:11px;color:var(--text2)">중요도:</label>
                        <input type="number" class="mi-val" data-idx="${idx}" min="1" max="10" value="${meta.imp||5}" style="width:55px">
                    </div>
                </div>`;
            }).join("");
        };

        const filterMems = () => {
            const q = overlay.querySelector("#ms").value.toLowerCase();
            const f = overlay.querySelector("#mf").value;
            const res = _MEM.filter(m => {
                const meta = parseMeta(m.content);
                const c = stripMeta(m.content).toLowerCase();
                const mq = !q || c.indexOf(q) >= 0;
                const mf = f === "h" ? (meta.imp || 5) >= 7 : f === "m" ? ((meta.imp || 5) >= 4 && (meta.imp || 5) < 7) : f === "l" ? (meta.imp || 5) < 4 : true;
                return mq && mf;
            });
            renderMems(res);
        };

        const renderEnts = () => {
            const ec = overlay.querySelector("#el");
            if (!_ENT.length) { ec.innerHTML = '<div class="empty">추적된 인물이 없습니다</div>'; }
            else {
                ec.innerHTML = _ENT.map((e, i) => {
                    let d = {}; try { d = JSON.parse(e.content); } catch (x) {}
                    const occ = (d.background && d.background.occupation) || "";
                    const loc = (d.status && d.status.currentLocation) || "";
                    const feats = (d.appearance && d.appearance.features || []).join(", ");
                    const traits = (d.personality && d.personality.traits || []).join(", ");
                    return `<div class="card">
                        <div class="card-hdr"><strong>${esc(d.name || e.key || "?")}</strong>
                            <div class="acts"><button class="btn bp act-save-ent" data-idx="${i}">저장</button><button class="btn bd act-del-ent" data-idx="${i}">삭제</button></div>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>직업</label><input type="text" class="eo-val" data-idx="${i}" value="${escAttr(occ)}"></div>
                            <div class="fld"><label>위치</label><input type="text" class="eL-val" data-idx="${i}" value="${escAttr(loc)}"></div>
                        </div>
                        <div class="fld" style="margin-top:5px"><label>외모 특징</label><input type="text" class="eF-val" data-idx="${i}" value="${escAttr(feats)}"></div>
                        <div class="fld"><label>성격 특성</label><input type="text" class="eP-val" data-idx="${i}" value="${escAttr(traits)}"></div>
                    </div>`;
                }).join("");
            }

            const rc = overlay.querySelector("#rl");
            if (!_REL.length) { rc.innerHTML = '<div class="empty">추적된 관계가 없습니다</div>'; }
            else {
                rc.innerHTML = _REL.map((r, i) => {
                    let d = {}; try { d = JSON.parse(r.content); } catch (x) {}
                    const cls = Math.round(((d.details && d.details.closeness) || 0) * 100);
                    const trs = Math.round(((d.details && d.details.trust) || 0) * 100);
                    return `<div class="card">
                        <div class="card-hdr"><strong>${esc(d.entityA || "?")} ↔ ${esc(d.entityB || "?")}</strong>
                            <div class="acts"><button class="btn bp act-save-rel" data-idx="${i}">저장</button><button class="btn bd act-del-rel" data-idx="${i}">삭제</button></div>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>관계 유형</label><input type="text" class="rT-val" data-idx="${i}" value="${escAttr(d.relationType || "")}"></div>
                            <div class="fld"><label>감정 (A→B)</label><input type="text" class="rS-val" data-idx="${i}" value="${escAttr((d.sentiments && d.sentiments.fromAtoB) || "")}"></div>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>친밀도 ${cls}%</label><div class="rw"><input type="range" class="rC-val" data-idx="${i}" min="0" max="100" value="${cls}"></div></div>
                            <div class="fld"><label>신뢰도 ${trs}%</label><div class="rw"><input type="range" class="rR-val" data-idx="${i}" min="0" max="100" value="${trs}"></div></div>
                        </div>
                    </div>`;
                }).join("");
            }
        };

        const renderWorld = () => {
            const tc = overlay.querySelector("#wt");
            const rc = overlay.querySelector("#wr");
            if (!_WLD || !_WLD.nodes || !_WLD.nodes.length) { tc.innerHTML = '<div class="empty">세계관 데이터가 없습니다</div>'; return; }
            const ap = _WLD.activePath || [];
            
            const rn = (id, depth, visited) => {
                if (depth > 50 || visited.has(id)) return "";
                visited.add(id);
                let entry = null;
                for (let j = 0; j < _WLD.nodes.length; j++) { if (_WLD.nodes[j][0] === id) { entry = _WLD.nodes[j][1]; break; } }
                if (!entry) return "";
                const active = ap.indexOf(id) >= 0;
                const ind = depth * 14;
                let h = `<div class="wn${active ? " cur" : ""}" style="padding-left:${10 + ind}px">
                    ${depth > 0 ? "└ " : ""}<span class="wn-name">${esc(entry.name)}</span>
                    <span class="wn-layer">[${esc(entry.layer || "dim")}]</span>
                    ${active ? '<span class="bdg bh" style="margin-left:4px">현재</span>' : ''}</div>`;
                const ch = entry.children || [];
                for (let k = 0; k < ch.length; k++) h += rn(ch[k], depth + 1, visited);
                return h;
            };
            tc.innerHTML = _WLD.rootId ? rn(_WLD.rootId, 0, new Set()) : _WLD.nodes.map(n => `<div class="wn"><span class="wn-name">${esc((n[1] || {}).name || "?")}</span></div>`).join("");
            
            const g = _WLD.global || {};
            overlay.querySelector("#w1").checked = !!g.multiverse;
            overlay.querySelector("#w2").checked = !!g.dimensionTravel;
            overlay.querySelector("#w3").checked = !!g.timeTravel;
            overlay.querySelector("#w4").checked = !!g.metaNarrative;
            
            const lid = ap[ap.length - 1];
            let cn = null;
            if (lid) { for (let n = 0; n < _WLD.nodes.length; n++) { if (_WLD.nodes[n][0] === lid) { cn = _WLD.nodes[n][1]; break; } } }
            if (cn && cn.rules) {
                const r = cn.rules; const ex = r.exists || {}; const sys = r.systems || {}; const itms = [];
                if (ex.magic) itms.push("마법 ✓");
                if (ex.ki) itms.push("기(氣) ✓");
                if (ex.supernatural) itms.push("초자연 ✓");
                if (sys.leveling) itms.push("레벨링 ✓");
                if (sys.skills) itms.push("스킬 ✓");
                if (sys.stats) itms.push("스탯 ✓");
                if (ex.technology) itms.push("기술: " + esc(ex.technology));
                rc.innerHTML = itms.length ? itms.map(i => `<span class="bdg bt" style="display:inline-block;margin:2px">${i}</span>`).join("") : '<span style="color:var(--text2)">규칙 없음</span>';
            }
        };

        const loadSettings = () => {
            const c = _CFG;
            overlay.querySelector("#slp").value = (c.llm && c.llm.provider) || "openai";
            overlay.querySelector("#slu").value = (c.llm && c.llm.url) || "";
            overlay.querySelector("#slk").value = (c.llm && c.llm.key) || "";
            overlay.querySelector("#slm").value = (c.llm && c.llm.model) || "gpt-4o-mini";
            const t = overlay.querySelector("#slt"); t.value = (c.llm && c.llm.temp) || 0.3; overlay.querySelector("#sltv").textContent = t.value;
            overlay.querySelector("#slto").value = (c.llm && c.llm.timeout) || 15000;
            overlay.querySelector("#sul").checked = !!c.useLLM;
            overlay.querySelector("#scbs").checked = c.cbsEnabled !== false;
            overlay.querySelector("#slrag").checked = c.useLorebookRAG !== false;
            overlay.querySelector("#semo").checked = c.emotionEnabled !== false;
            overlay.querySelector("#smc").checked = !!c.enableModuleCompat;
            overlay.querySelector("#sep").value = (c.embed && c.embed.provider) || "openai";
            overlay.querySelector("#seu").value = (c.embed && c.embed.url) || "";
            overlay.querySelector("#sek").value = (c.embed && c.embed.key) || "";
            overlay.querySelector("#sem").value = (c.embed && c.embed.model) || "text-embedding-3-small";
            overlay.querySelector("#sml").value = c.maxLimit || 200;
            overlay.querySelector("#sth").value = c.threshold || 5;
            const s = overlay.querySelector("#sst"); s.value = c.simThreshold || 0.25; overlay.querySelector("#sstv").textContent = parseFloat(s.value).toFixed(2);
            overlay.querySelector("#sgc").value = c.gcBatchSize || 5;
            
            const swm = overlay.querySelector("#swm");
            swm.value = c.weightMode || "auto";
            overlay.querySelector("#cw").style.display = swm.value === "custom" ? "block" : "none";
            
            if (c.weightMode === "custom" && c.weights) {
                overlay.querySelector("#sws").value = c.weights.similarity || 0.5; overlay.querySelector("#wsv").textContent = parseFloat(c.weights.similarity || 0.5).toFixed(2);
                overlay.querySelector("#swi").value = c.weights.importance || 0.3; overlay.querySelector("#wiv").textContent = parseFloat(c.weights.importance || 0.3).toFixed(2);
                overlay.querySelector("#swr").value = c.weights.recency || 0.2; overlay.querySelector("#wrv").textContent = parseFloat(c.weights.recency || 0.2).toFixed(2);
            }
            overlay.querySelector("#sam").value = c.worldAdjustmentMode || "dynamic";
            overlay.querySelector("#sdb").checked = !!c.debug;
            
            const st = c._cacheStats || {};
            overlay.querySelector("#cst").innerHTML = `
                <div class="ci">메모리: ${c._memCount || 0}</div>
                <div class="ci">인물: ${c._entCount || 0}</div>
                <div class="ci">관계: ${c._relCount || 0}</div>
                ${st.meta ? `<div class="ci">메타캐시 히트율: ${(parseFloat(st.meta.hitRate) * 100 || 0).toFixed(1)}%</div>` : ''}
                ${st.sim ? `<div class="ci">유사도캐시: ${st.sim.size}</div>` : ''}
            `;
        };

        // 3. 자바스크립트로 직접 이벤트 연결 (Event Delegation)
        overlay.querySelector('#xbtn').onclick = () => { overlay.remove(); R.hideContainer(); };
        overlay.querySelectorAll('.tb').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
        
        // 상단 툴바 및 폼 액션
        overlay.querySelector('#btn-toggle-add-mem').onclick = () => overlay.querySelector('#amf').classList.toggle('on');
        overlay.querySelector('#btn-cancel-mem').onclick = () => overlay.querySelector('#amf').classList.remove('on');
        overlay.querySelector('#btn-toggle-add-ent').onclick = () => overlay.querySelector('#aef').classList.toggle('on');
        overlay.querySelector('#btn-cancel-ent').onclick = () => overlay.querySelector('#aef').classList.remove('on');
        overlay.querySelector('#btn-toggle-add-rel').onclick = () => overlay.querySelector('#arf').classList.toggle('on');
        overlay.querySelector('#btn-cancel-rel').onclick = () => overlay.querySelector('#arf').classList.remove('on');

        overlay.querySelector('#ms').oninput = filterMems;
        overlay.querySelector('#mf').onchange = filterMems;
        overlay.querySelector('#swm').onchange = (e) => overlay.querySelector('#cw').style.display = e.target.value === 'custom' ? 'block' : 'none';

        // 슬라이더 값 실시간 반영
        const bindSlider = (id, targetId) => overlay.querySelector(id).oninput = (e) => overlay.querySelector(targetId).textContent = e.target.value;
        bindSlider('#slt', '#sltv');
        bindSlider('#sst', '#sstv');
        bindSlider('#ar-cls', '#ar-clsv');
        bindSlider('#ar-trs', '#ar-trsv');
        bindSlider('#sws', '#wsv');
        bindSlider('#swi', '#wiv');
        bindSlider('#swr', '#wrv');

        // 메모리 액션
        overlay.querySelector('#btn-add-mem').onclick = () => {
            const c = overlay.querySelector("#am-c").value.trim();
            if (!c) { toast("❌ 내용을 입력하세요"); return; }
            const imp = parseInt(overlay.querySelector("#am-i").value) || 5;
            const cat = overlay.querySelector("#am-cat").value.trim() || "";
            const meta = { imp: Math.max(1, Math.min(10, imp)), t: 0, ttl: -1, cat: cat };
            _MEM.push({ key: "", comment: "lmai_memory", content: `[META:${JSON.stringify(meta)}]\n${c}`, mode: "normal", insertorder: 100, alwaysActive: true });
            overlay.querySelector("#am-c").value = "";
            overlay.querySelector('#amf').classList.remove('on');
            filterMems(); toast("✅ 메모리 추가됨");
        };

        overlay.querySelector('#btn-save-all-mem').onclick = () => {
            let lore = [];
            _MEM.forEach(m => lore.push({ key: m.key || "", comment: "lmai_memory", content: m.content, mode: "normal", insertorder: 100, alwaysActive: true }));
            _ENT.forEach(e => lore.push(e));
            _REL.forEach(r => lore.push(r));
            if (_WLD) lore.unshift({ key: "world_graph", comment: "lmai_world_graph", content: JSON.stringify(_WLD), mode: "normal", insertorder: 1, alwaysActive: true });
            saveLoreToChar(lore, () => toast("💾 메모리 저장됨"));
        };

        // 엔티티 및 관계 액션
        overlay.querySelector('#btn-add-ent').onclick = () => {
            const name = overlay.querySelector("#ae-name").value.trim();
            if (!name) { toast("❌ 이름을 입력하세요"); return; }
            const d = { name: name, background: { occupation: overlay.querySelector("#ae-occ").value.trim() }, status: { currentLocation: overlay.querySelector("#ae-loc").value.trim() }, appearance: { features: overlay.querySelector("#ae-feat").value.split(",").map(s => s.trim()).filter(Boolean) }, personality: { traits: overlay.querySelector("#ae-trait").value.split(",").map(s => s.trim()).filter(Boolean) } };
            _ENT.push({ key: name, comment: "lmai_entity", content: JSON.stringify(d), mode: "normal", insertorder: 50, alwaysActive: true });
            overlay.querySelector("#ae-name").value = ""; overlay.querySelector("#ae-occ").value = ""; overlay.querySelector("#ae-loc").value = ""; overlay.querySelector("#ae-feat").value = ""; overlay.querySelector("#ae-trait").value = "";
            overlay.querySelector('#aef').classList.remove('on');
            renderEnts(); toast("✅ 인물 추가됨");
        };

        overlay.querySelector('#btn-add-rel').onclick = () => {
            const a = overlay.querySelector("#ar-a").value.trim();
            const b = overlay.querySelector("#ar-b").value.trim();
            if (!a || !b) { toast("❌ 인물을 입력하세요"); return; }
            const d = { entityA: a, entityB: b, relationType: overlay.querySelector("#ar-type").value.trim() || "관계", details: { closeness: (parseInt(overlay.querySelector("#ar-cls").value) || 0) / 100, trust: (parseInt(overlay.querySelector("#ar-trs").value) || 0) / 100 }, sentiments: { fromAtoB: overlay.querySelector("#ar-sent").value.trim() } };
            _REL.push({ key: a + "_" + b, comment: "lmai_relation", content: JSON.stringify(d), mode: "normal", insertorder: 51, alwaysActive: true });
            overlay.querySelector("#ar-a").value = ""; overlay.querySelector("#ar-b").value = ""; overlay.querySelector("#ar-type").value = ""; overlay.querySelector("#ar-sent").value = "";
            overlay.querySelector('#arf').classList.remove('on');
            renderEnts(); toast("✅ 관계 추가됨");
        };

        overlay.querySelector('#btn-save-ents').onclick = () => {
            let lore = [];
            _MEM.forEach(m => lore.push(m));
            _ENT.forEach(e => lore.push(e));
            _REL.forEach(r => lore.push(r));
            if (_WLD) lore.unshift({ key: "world_graph", comment: "lmai_world_graph", content: JSON.stringify(_WLD), mode: "normal", insertorder: 1, alwaysActive: true });
            saveLoreToChar(lore, () => toast("💾 저장됨"));
        };

        overlay.querySelector('#btn-save-world').onclick = () => {
            if (!_WLD) return;
            _WLD.global = _WLD.global || {};
            _WLD.global.multiverse = overlay.querySelector("#w1").checked;
            _WLD.global.dimensionTravel = overlay.querySelector("#w2").checked;
            _WLD.global.timeTravel = overlay.querySelector("#w3").checked;
            _WLD.global.metaNarrative = overlay.querySelector("#w4").checked;
            let lore = [];
            lore.unshift({ key: "world_graph", comment: "lmai_world_graph", content: JSON.stringify(_WLD), mode: "normal", insertorder: 1, alwaysActive: true });
            _MEM.forEach(m => lore.push(m));
            _ENT.forEach(e => lore.push(e));
            _REL.forEach(r => lore.push(r));
            saveLoreToChar(lore, () => { toast("💾 세계관 저장됨"); renderWorld(); });
        };

        overlay.querySelector('#btn-save-settings').onclick = () => {
            const sim = parseFloat(overlay.querySelector("#sws").value) || 0.5;
            const imp = parseFloat(overlay.querySelector("#swi").value) || 0.3;
            const rec = parseFloat(overlay.querySelector("#swr").value) || 0.2;
            let sum = sim + imp + rec;
            let w_sim = sim, w_imp = imp, w_rec = rec;
            if (Math.abs(sum - 1) > 0.01 && sum > 0) { w_sim /= sum; w_imp /= sum; w_rec /= sum; }
            
            const cfg = {
                useLLM: overlay.querySelector("#sul").checked,
                cbsEnabled: overlay.querySelector("#scbs").checked,
                useLorebookRAG: overlay.querySelector("#slrag").checked,
                emotionEnabled: overlay.querySelector("#semo").checked,
                enableModuleCompat: overlay.querySelector("#smc").checked,
                debug: overlay.querySelector("#sdb").checked,
                maxLimit: parseInt(overlay.querySelector("#sml").value) || 200,
                threshold: parseInt(overlay.querySelector("#sth").value) || 5,
                simThreshold: parseFloat(overlay.querySelector("#sst").value) || 0.25,
                gcBatchSize: parseInt(overlay.querySelector("#sgc").value) || 5,
                weightMode: overlay.querySelector("#swm").value,
                worldAdjustmentMode: overlay.querySelector("#sam").value,
                llm: { provider: overlay.querySelector("#slp").value, url: overlay.querySelector("#slu").value, key: overlay.querySelector("#slk").value, model: overlay.querySelector("#slm").value, temp: parseFloat(overlay.querySelector("#slt").value) || 0.3, timeout: parseInt(overlay.querySelector("#slto").value) || 15000 },
                embed: { provider: overlay.querySelector("#sep").value, url: overlay.querySelector("#seu").value, key: overlay.querySelector("#sek").value, model: overlay.querySelector("#sem").value }
            };
            if (cfg.weightMode === "custom") cfg.weights = { similarity: w_sim, importance: w_imp, recency: w_rec };
            R.pluginStorage.setItem("LMAI_Config", JSON.stringify(cfg)).then(() => toast("💾 설정 저장됨")).catch(() => toast("❌ 저장 실패"));
        };

        overlay.querySelector('#btn-reset-settings').onclick = () => {
            if (!confirm("모든 설정을 초기값으로 되돌리시겠습니까?")) return;
            _CFG = { useLLM: true, cbsEnabled: true, useLorebookRAG: true, emotionEnabled: true, enableModuleCompat: false, debug: false, maxLimit: 200, threshold: 5, simThreshold: 0.25, gcBatchSize: 5, weightMode: "auto", worldAdjustmentMode: "dynamic", llm: { provider: "openai", url: "", key: "", model: "gpt-4o-mini", temp: 0.3, timeout: 15000 }, embed: { provider: "openai", url: "", key: "", model: "text-embedding-3-small" } };
            loadSettings(); toast("🔄 설정 초기화됨");
        };

        // 리스트 동적 버튼 이벤트 위임 (Event Delegation)
        overlay.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('act-save-mem')) {
                const idx = parseInt(target.dataset.idx, 10);
                if (isNaN(idx) || idx < 0 || idx >= _MEM.length) return;
                const nc = overlay.querySelector(".mt-val[data-idx='"+idx+"']").value;
                const ni = parseInt(overlay.querySelector(".mi-val[data-idx='"+idx+"']").value) || 5;
                const meta = parseMeta(_MEM[idx].content);
                meta.imp = Math.max(1, Math.min(10, ni));
                _MEM[idx].content = `[META:${JSON.stringify(meta)}]\n${nc}`;
                toast("✅ 메모리 수정됨");
            } else if (target.classList.contains('act-del-mem')) {
                const idx = parseInt(target.dataset.idx, 10);
                if (isNaN(idx) || idx < 0 || idx >= _MEM.length) return;
                if (!confirm("이 메모리를 삭제하시겠습니까?")) return;
                _MEM.splice(idx, 1); filterMems(); toast("🗑 메모리가 삭제됨");
            } else if (target.classList.contains('act-save-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                let d = {}; try { d = JSON.parse(_ENT[i].content); } catch (x) {}
                d.background = d.background || {}; d.background.occupation = overlay.querySelector(".eo-val[data-idx='"+i+"']").value;
                d.status = d.status || {}; d.status.currentLocation = overlay.querySelector(".eL-val[data-idx='"+i+"']").value;
                d.appearance = d.appearance || {}; d.appearance.features = overlay.querySelector(".eF-val[data-idx='"+i+"']").value.split(",").map(s => s.trim()).filter(Boolean);
                d.personality = d.personality || {}; d.personality.traits = overlay.querySelector(".eP-val[data-idx='"+i+"']").value.split(",").map(s => s.trim()).filter(Boolean);
                _ENT[i].content = JSON.stringify(d); toast("✅ 인물 데이터 수정됨");
            } else if (target.classList.contains('act-del-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                if (!confirm("이 인물 데이터를 삭제하시겠습니까?")) return;
                _ENT.splice(i, 1); renderEnts(); toast("🗑 삭제됨");
            } else if (target.classList.contains('act-save-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                let d = {}; try { d = JSON.parse(_REL[i].content); } catch (x) {}
                d.relationType = overlay.querySelector(".rT-val[data-idx='"+i+"']").value;
                d.sentiments = d.sentiments || {}; d.sentiments.fromAtoB = overlay.querySelector(".rS-val[data-idx='"+i+"']").value;
                d.details = d.details || {}; d.details.closeness = (parseInt(overlay.querySelector(".rC-val[data-idx='"+i+"']").value) || 0) / 100;
                d.details.trust = (parseInt(overlay.querySelector(".rR-val[data-idx='"+i+"']").value) || 0) / 100;
                _REL[i].content = JSON.stringify(d); toast("✅ 관계 데이터 수정됨");
            } else if (target.classList.contains('act-del-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                if (!confirm("이 관계 데이터를 삭제하시겠습니까?")) return;
                _REL.splice(i, 1); renderEnts(); toast("🗑 삭제됨");
            }
        });

        overlay.querySelector('#btn-transition').onclick = async () => {
            const confirmed = await Utils.confirmEx(
                "현재 기억을 보존하고 새 대화를 준비하시겠습니까?\n이전 대화의 마지막 상황을 요약하여 다음 세션으로 인계합니다.\n(LLM 토큰이 일부 소모될 수 있습니다)"
            );
            if (!confirmed) return;

            LMAI_GUI.toast("🚀 세션 전환 준비 중...");
            const success = await TransitionManager.prepareTransition();
            
            if (success) {
                await Utils.alertEx(
                    "✅ 준비 완료!\n\n이제 RisuAI의 '새 채팅' 버튼을 눌러 완전히 새로운 방을 만드세요.\n새 방에 진입하면 LIBRA가 자동으로 모든 기억과 마지막 맥락을 복구합니다."
                );
            } else {
                await Utils.alertEx("❌ 세션 전환 준비 중 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        };

        overlay.querySelector('#btn-cold-start').onclick = async () => {
            if (!confirm("현재 채팅방의 과거 내역을 분석하여 메모리를 재구축하시겠습니까?")) return;
            await ColdStartManager.startAutoSummarization();
        };

        // 초기 화면 렌더링
        filterMems();
        renderEnts();
        renderWorld();
        loadSettings();

        await R.showContainer('fullscreen');
    };

    const toast = (m, d) => {
        const existing = document.getElementById('lmai-overlay');
        const t = existing?.querySelector("#toast");
        if (t) {
            t.textContent = m;
            t.classList.add("on");
            setTimeout(() => t.classList.remove("on"), d || 2000);
        } else {
            console.log(`[LIBRA Toast] ${m}`);
        }
    };

    return { show, toast };
})();

// GUI 등록
(async () => {
    const R = (typeof Risuai !== 'undefined') ? Risuai : (typeof risuai !== 'undefined' ? risuai : null);
    if (R) {
        try {
            await R.registerSetting('LIBRA World Manager', LMAI_GUI.show, '📚', 'html', 'lmai-settings');
            await R.registerButton({
                name: 'LIBRA',
                icon: '📚',
                iconType: 'html',
                location: 'action',
                id: 'lmai-button'
            }, LMAI_GUI.show);
            console.log('[LIBRA] GUI registered.');
        } catch (e) {
            console.warn('[LIBRA] GUI registration failed:', e?.message || e);
        }
    }
})();


// Export
if (typeof globalThis !== 'undefined') {
    globalThis.LIBRA = {
        MemoryEngine,
        EntityManager,
        HierarchicalWorldManager,
        ComplexWorldDetector,
        WorldAdjustmentManager,
        NarrativeTracker,
        CharacterStateTracker,
        WorldStateTracker,
        MemoryState
    };
}

})();
