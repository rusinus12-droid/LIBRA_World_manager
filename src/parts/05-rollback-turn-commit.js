    // ══════════════════════════════════════════════════════════════
    // [ENGINE] Sync & Rollback Engine
    // ══════════════════════════════════════════════════════════════
    const SyncEngine = (() => {
        const TRANSIENT_MISSING_GRACE_MS = 15000;

        const getTrackerMeta = (tracked) => {
            if (tracked && typeof tracked === 'object' && !Array.isArray(tracked)) return tracked;
            return { loreKeys: Array.isArray(tracked) ? tracked : [], sourceHash: null };
        };

        const buildLiveMessageIndex = (chat) => {
            const msgs = getChatMessages(chat);
            const currentMsgIds = new Set();
            const comparableTextToMsgId = new Map();
            const messageSignatures = new Set();
            for (const msg of msgs) {
                normalizeCanonicalMessageIds(msg).forEach(id => currentMsgIds.add(id));
                const roleHint = getMessageRoleHint(msg);
                const comparableText = Utils.getNarrativeComparableText(Utils.getMessageText(msg), roleHint);
                if (comparableText) comparableTextToMsgId.set(TokenizerEngine.simpleHash(comparableText), getPrimaryCanonicalMessageId(msg, true));
                const sig = getMessageSignature(msg);
                if (sig) messageSignatures.add(sig);
            }
            return { msgs, currentMsgIds, comparableTextToMsgId, messageSignatures };
        };

        const getRollbackCandidates = (chat, lore, options = {}) => {
            if (!chat || MemoryState.rollbackTracker.size === 0) return [];
            const now = Date.now();
            const live = buildLiveMessageIndex(chat);
            const candidates = [];
            for (const id of Array.from(MemoryState.rollbackTracker.keys())) {
                const tracked = getTrackerMeta(MemoryState.rollbackTracker.get(id));
                const replacementId = tracked.sourceHash ? live.comparableTextToMsgId.get(tracked.sourceHash) : null;
                if (replacementId && replacementId !== id) {
                    MemoryState.rollbackTracker.set(replacementId, tracked);
                    MemoryState.rollbackTracker.delete(id);
                    MemoryState.transientMissing.delete(id);
                    continue;
                }
                const trackedIds = normalizeCanonicalMessageIds(tracked.liveMessageIds || tracked.sourceMessageIds || tracked.messageId || id);
                const stillPresent = trackedIds.some(msgId => live.currentMsgIds.has(msgId));
                const signaturePresent = tracked.messageSignature && live.messageSignatures.has(String(tracked.messageSignature));
                if (stillPresent || signaturePresent) {
                    MemoryState.transientMissing.delete(id);
                    continue;
                }
                const transient = MemoryState.transientMissing.get(id);
                if (!transient && options.markTransient !== false) {
                    MemoryState.transientMissing.set(id, { since: now, reason: 'missing-for-rollback-anchor' });
                    continue;
                }
                const since = Number(transient?.since || now);
                if ((now - since) < TRANSIENT_MISSING_GRACE_MS && options.force !== true) continue;
                const turn = normalizeLegacyMemoryTurnAnchor(
                    tracked.turnAnchorTurn || tracked.turnAnchor || tracked.lockedTurn || tracked.finalizedTurn || tracked.turn || 0
                );
                candidates.push({
                    id,
                    messageId: id,
                    liveMessageIds: trackedIds,
                    sourceHash: String(tracked.sourceHash || tracked.aiHash || '').trim(),
                    messageSignature: String(tracked.messageSignature || '').trim(),
                    turn,
                    turnAnchor: turn,
                    turnAnchorTurn: turn,
                    deletedTurn: turn,
                    missingSince: since,
                    reason: 'tracked_message_missing'
                });
            }
            return candidates.filter(item => Number(item.turn || item.deletedTurn || 0) > 0);
        };

        const syncMemory = async (char, chat, lore) => {
            const msgs_all = getChatMessages(chat);
            // Fail-safe: chat.msgs가 유효하지 않으면 롤백 건너뜀 (대량 삭제 방지)
            if (!chat || msgs_all.length === 0 || MemoryState.rollbackTracker.size === 0) {
                return false;
            }

            if (isRefreshDeleteBlocked()) {
                if (MemoryEngine.CONFIG.debug) {
                    recordRuntimeDebug('log', '[LIBRA] syncMemory deletion skipped during refresh protection window');
                }
                return false;
            }

            // LightBoard 활동 중이면 syncMemory 스킵
            const lbActive = await isLightBoardActive();
            if (lbActive) {
                MemoryState._lbWasActive = true;
                if (MemoryEngine.CONFIG.debug) {
                    recordRuntimeDebug('log', '[LIBRA] syncMemory skipped: LightBoard active');
                }
                return false;
            }

            // LightBoard 활동 직후 첫 실행: ID 재매핑만 수행하고 롤백 스킵
            const lbJustFinished = !!MemoryState._lbWasActive;
            if (lbJustFinished) {
                MemoryState._lbWasActive = false;
            }

            const rollbackCandidates = getRollbackCandidates(chat, lore, { markTransient: true });
            if (rollbackCandidates.length > 0 && typeof RollbackSnapshotManager !== 'undefined') {
                const restored = await RollbackSnapshotManager.maybeRestoreBeforeRequest(char, chat, lore, { candidates: rollbackCandidates });
                if (restored?.ok && restored?.restored) {
                    if (MemoryEngine.CONFIG?.debug) {
                        recordRuntimeDebug('log', '[LIBRA] V4.2 rollback snapshot restored during syncMemory', restored);
                    }
                    return true;
                }
            }

            const now = Date.now();
            const currentMsgIds = new Set();
            const comparableTextToMsgId = new Map();

            for (const msg of msgs_all) {
                if (!msg?.id) continue;
                currentMsgIds.add(msg.id);

                const roleHint = getMessageRoleHint(msg);
                const comparableText = Utils.getNarrativeComparableText(Utils.getMessageText(msg), roleHint);
                if (comparableText) {
                    comparableTextToMsgId.set(TokenizerEngine.simpleHash(comparableText), msg.id);
                    MemoryState.transientMissing.delete(msg.id);
                } else if (MemoryEngine.CONFIG.debug) {
                    recordRuntimeDebug('log', `[LIBRA] syncMemory skipped comparable text for msg ${msg.id}`);
                }
            }

            const trackedMsgIds = Array.from(MemoryState.rollbackTracker.keys());
            const deletedMsgIds = [];

            for (const id of trackedMsgIds) {
                const tracked = getTrackerMeta(MemoryState.rollbackTracker.get(id));
                const replacementId = tracked.sourceHash ? comparableTextToMsgId.get(tracked.sourceHash) : null;

                if (replacementId && replacementId !== id) {
                    MemoryState.rollbackTracker.set(replacementId, tracked);
                    MemoryState.rollbackTracker.delete(id);
                    MemoryState.transientMissing.delete(id);
                    if (MemoryEngine.CONFIG.debug) {
                        recordRuntimeDebug('log', `[LIBRA] Message tracker migrated ${id} -> ${replacementId} via sourceHash remap`);
                    }
                    continue;
                }

                if (currentMsgIds.has(id)) {
                    MemoryState.transientMissing.delete(id);
                    continue;
                }

                const transient = MemoryState.transientMissing.get(id);
                if (!transient) {
                    MemoryState.transientMissing.set(id, { since: now, reason: 'missing' });
                    continue;
                }

                if ((now - transient.since) < TRANSIENT_MISSING_GRACE_MS) {
                    continue;
                }

                deletedMsgIds.push(id);
            }

            if (deletedMsgIds.length === 0) return false;

            await loreLock.writeLock();
            try {
                const workingLore = Array.isArray(lore) ? lore.map(entry => safeClone(entry)) : [];
                let changed = false;
                let removedCount = 0;
                const currentSession = MemoryState.currentSessionId;

                for (const m_id of deletedMsgIds) {
                    const trackedMeta = getTrackerMeta(MemoryState.rollbackTracker.get(m_id));
                    const deletedIds = normalizeCanonicalMessageIds([
                        m_id,
                        trackedMeta?.liveMessageIds,
                        trackedMeta?.sourceMessageIds,
                        trackedMeta?.messageId
                    ]);
                    const deletedHash = String(trackedMeta?.sourceHash || trackedMeta?.aiHash || '').trim();
                    const deletedTurnKey = String(trackedMeta?.turnKey || '').trim();
                    if (TurnRecordLedger.markDeleted(workingLore, {
                        ...trackedMeta,
                        messageId: m_id,
                        liveMessageIds: deletedIds,
                        sourceMessageIds: deletedIds,
                        sourceHash: deletedHash,
                        turnKey: deletedTurnKey,
                        reason: 'legacy-sync-delete-fallback'
                    }, chat, char)) {
                        changed = true;
                    }
                    // 1. 로어북 스캔 및 조건부 삭제
                    for (let i = workingLore.length - 1; i >= 0; i--) {
                        const entry = workingLore[i];
                        try {
                            // lmai_memory: [META:...] 태그로 m_id 확인
                            const metaJson = extractLibraMetaJsonString(entry.content || '');
                            if (metaJson) {
                                const meta = JSON.parse(metaJson);
                                // 방어 로직: 현재 세션이 아니거나 baseline인 경우 절대 삭제 안함
                                const metaIds = normalizeCanonicalMessageIds([meta.m_id, meta.m_ids, meta.messageId, meta.sourceMessageIds, meta.liveMessageIds]);
                                const metaHash = String(meta.sourceHash || meta.aiHash || '').trim();
                                const metaTurnKey = String(meta.turnKey || '').trim();
                                const matchesDeletedAnchor = hasCanonicalMessageIdOverlap(metaIds, deletedIds)
                                    || (!!deletedHash && !!metaHash && deletedHash === metaHash)
                                    || (!!deletedTurnKey && !!metaTurnKey && deletedTurnKey === metaTurnKey);
                                if (matchesDeletedAnchor && meta.s_id === currentSession && meta.s_id !== 'baseline') {
                                    workingLore.splice(i, 1);
                                    changed = true;
                                    removedCount++;
                                }
                                continue;
                            }
                            // lmai_entity / lmai_relation: 최신 메시지면 snapshot 복원, 그 외에는 연결만 분리
                            if (entry.comment === 'lmai_entity' || entry.comment === 'lmai_relation') {
                                const parsed = JSON.parse(entry.content || '{}');
                                const entMeta = parsed.meta || {};
                                const sourceIds = Array.isArray(entMeta.m_ids)
                                    ? entMeta.m_ids.filter(Boolean)
                                    : (entMeta.m_id ? [entMeta.m_id] : []);
                                if (hasCanonicalMessageIdOverlap(sourceIds, deletedIds) && entMeta.s_id === currentSession && entMeta.s_id !== 'baseline') {
                                    const isLatestSource = entMeta.m_id === m_id;
                                    if (isLatestSource) {
                                        EntityManager.restoreRollbackSnapshot(parsed, m_id);
                                    } else {
                                        EntityManager.discardRollbackSnapshot(parsed, m_id);
                                    }
                                    entMeta.m_ids = sourceIds.filter(id => !deletedIds.includes(id));
                                    entMeta.m_id = entMeta.m_ids.length > 0 ? entMeta.m_ids[entMeta.m_ids.length - 1] : null;
                                    parsed.meta = entMeta;
                                    entry.content = JSON.stringify(parsed, null, 2);
                                    changed = true;
                                    removedCount++;
                                }
                            }
                        } catch (e) {
                            if (MemoryEngine.CONFIG?.debug) {
                                recordRuntimeDebug('warn', '[LIBRA] SyncEngine entry processing error:', e?.message);
                            }
                            continue;
                        }
                    }

                    // 2. 트래커에서 제거
                    MemoryState.rollbackTracker.delete(m_id);
                    MemoryState.transientMissing.delete(m_id);
                }

                if (changed) {
                    // 캐시 재구축
                    SecretKnowledgeCore.loadState(workingLore, {
                        scopeKey: getChatRuntimeScopeKey(chat, char),
                        chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                    });
                    EntityKnowledgeVaultCore.loadState(workingLore, {
                        scopeKey: getChatRuntimeScopeKey(chat, char),
                        chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                    });
                    TimeEngine.loadState(workingLore, {
                        scopeKey: getChatRuntimeScopeKey(chat, char),
                        chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                    });
                    EntityManager.rebuildCache(workingLore);
                    HierarchicalWorldManager.loadWorldGraph(workingLore, true);
                    NarrativeTracker.loadState(workingLore);
                    StoryAuthor.loadState(workingLore);
                    Director.loadState(workingLore);
                    CharacterStateTracker.loadState(workingLore);
                    WorldStateTracker.loadState(workingLore);
                    
                    MemoryEngine.setLorebook(char, chat, workingLore);
                    await persistLoreToActiveChat(chat, workingLore);
                    
                    // Unobtrusive feedback
                    recordRuntimeDebug('log', `[LIBRA] 🔄 Phantom memory synced (cleaned ${removedCount} lore links tied to deleted messages)`);
                }
                return changed;
            } catch (e) {
                recordRuntimeDebug('error', "[LIBRA] Sync Error:", e);
                return false;
            } finally {
                loreLock.writeUnlock();
            }
        };

        return { syncMemory, getRollbackCandidates };
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] V4.2 Rollback Snapshot Manager
    // Restores the most recent stable lore/runtime snapshot before a deleted/rerolled turn.
    // ══════════════════════════════════════════════════════════════
    const RollbackSnapshotManager = (() => {
        const normalizeScopeKey = (chat = null, char = null) => String(
            getChatRuntimeScopeKey(chat, char)
            || getChatMemoryScopeKey(chat, char)
            || chat?.id
            || 'global'
        ).trim() || 'global';

        const getSnapshots = (scopeKey = '') => (
            Array.isArray(MemoryState.rollbackSnapshotsByScope.get(scopeKey))
                ? MemoryState.rollbackSnapshotsByScope.get(scopeKey)
                : []
        );

        const captureRuntime = () => safeClone({
            narrative: safeClone(NarrativeTracker.getState?.() || { storylines: [], turnLog: [], lastSummaryTurn: 0 }),
            storyAuthor: safeClone(StoryAuthor.getState?.() || {}),
            director: safeClone(Director.getState?.() || {}),
            charStates: safeClone(CharacterStateTracker.getState?.() || {}),
            worldStates: safeClone(WorldStateTracker.getState?.() || {}),
            secretKnowledge: safeClone(SecretKnowledgeCore?.getState?.() || null),
            entityKnowledgeVault: safeClone(EntityKnowledgeVaultCore?.getState?.() || null),
            timeEngine: safeClone(TimeEngine?.getState?.() || null),
            sectionWorld: safeClone(SectionWorldInferenceManager.getState?.() || null),
            currentTurn: Number(MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0)
        });

        const restoreRuntime = (snapshot = {}) => {
            const runtime = snapshot?.runtime && typeof snapshot.runtime === 'object' ? snapshot.runtime : {};
            const context = {
                scopeKey: String(snapshot?.scopeKey || '').trim(),
                chatId: String(snapshot?.chatId || '').trim(),
                turn: normalizeLegacyMemoryTurnAnchor(runtime?.currentTurn || snapshot?.turn || 0)
            };
            try { NarrativeTracker.resetState(runtime?.narrative || { storylines: [], turnLog: [], lastSummaryTurn: 0 }); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.narrative', error, context);
            }
            try { StoryAuthor.resetState?.(runtime?.storyAuthor || null); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.story_author', error, context);
            }
            try { Director.resetState?.(runtime?.director || null); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.director', error, context);
            }
            try { CharacterStateTracker.resetState?.(runtime?.charStates || {}); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.character_state', error, context);
            }
            try { WorldStateTracker.resetState?.(runtime?.worldStates || {}); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.world_state', error, context);
            }
            try { SecretKnowledgeCore.resetState?.(runtime?.secretKnowledge || null); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.secret_knowledge', error, context);
            }
            try { EntityKnowledgeVaultCore.resetState?.(runtime?.entityKnowledgeVault || null); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.entity_knowledge', error, context);
            }
            try { TimeEngine.resetState?.(runtime?.timeEngine || null); } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.time_engine', error, context);
            }
            try {
                if (runtime?.sectionWorld) SectionWorldInferenceManager.loadState?.(runtime.sectionWorld);
                else SectionWorldInferenceManager.resetState?.();
            } catch (error) {
                recordSuppressedRuntimeError('snapshot.restore_runtime.section_world', error, context);
            }
            const turn = normalizeLegacyMemoryTurnAnchor(runtime?.currentTurn || snapshot?.turn || 0);
            if (turn > 0) MemoryEngine.setTurn(turn);
        };

        const capture = (char = null, chat = null, lorebook = [], options = {}) => {
            if (!char || !chat || !Array.isArray(lorebook)) return null;
            const scopeKey = normalizeScopeKey(chat, char);
            const turn = normalizeLegacyMemoryTurnAnchor(
                options?.turn
                || deriveRuntimeTurnFromLorebook(lorebook)
                || MemoryEngine.getCurrentTurn?.()
                || 0
            );
            if (turn <= 0) return null;
            const snapshot = {
                version: 1,
                kind: String(options?.kind || 'stable-turn-snapshot').trim() || 'stable-turn-snapshot',
                scopeKey,
                chatId: String(chat?.id || '').trim(),
                turn,
                capturedAt: Date.now(),
                reason: String(options?.reason || 'stable-turn-anchor').trim() || 'stable-turn-anchor',
                lorebook: lorebook.map(entry => safeClone(entry)),
                runtime: captureRuntime()
            };
            const now = Date.now();
            const current = getSnapshots(scopeKey)
                .filter(item => normalizeLegacyMemoryTurnAnchor(item?.turn) !== turn)
                .filter(item => now - Number(item?.capturedAt || 0) < RUNTIME_SCOPE_RECORD_TTL_MS);
            const next = [snapshot, ...current]
                .sort((a, b) => Number(b?.turn || 0) - Number(a?.turn || 0) || Number(b?.capturedAt || 0) - Number(a?.capturedAt || 0))
                .slice(0, ROLLBACK_SNAPSHOT_LIMIT_PER_SCOPE);
            MemoryState.rollbackSnapshotsByScope.set(scopeKey, next);
            return safeClone(snapshot);
        };

        const captureEmergency = (char = null, chat = null, lorebook = [], options = {}) => {
            if (!char || !chat || !Array.isArray(lorebook)) return null;
            const scopeKey = normalizeScopeKey(chat, char);
            const snapshot = {
                version: 1,
                kind: 'manual-emergency',
                scopeKey,
                chatId: String(chat?.id || '').trim(),
                turn: normalizeLegacyMemoryTurnAnchor(options?.turn || deriveRuntimeTurnFromLorebook(lorebook) || MemoryEngine.getCurrentTurn?.() || 0),
                capturedAt: Date.now(),
                reason: String(options?.reason || 'manual-emergency').trim() || 'manual-emergency',
                label: String(options?.label || '').trim(),
                lorebook: lorebook.map(entry => safeClone(entry)),
                runtime: captureRuntime()
            };
            MemoryState.emergencySnapshotByScope.set(scopeKey, snapshot);
            return safeClone(snapshot);
        };

        const chooseSnapshot = (char = null, chat = null, candidates = []) => {
            const scopeKey = normalizeScopeKey(chat, char);
            const turns = (Array.isArray(candidates) ? candidates : [])
                .map(candidate => normalizeLegacyMemoryTurnAnchor(candidate?.turn || candidate?.turnAnchorTurn || candidate?.turnAnchor || candidate?.deletedTurn || 0))
                .filter(turn => turn > 0);
            if (!turns.length) return { scopeKey, snapshot: null, reason: 'no_candidate_turns' };
            const uniqueTurns = [...new Set(turns)].sort((a, b) => a - b);
            const restoreBeforeTurn = Math.max(0, Math.min(...uniqueTurns) - 1);
            if (restoreBeforeTurn <= 0) return { scopeKey, snapshot: null, reason: 'missing_restore_turn', turns: uniqueTurns };
            const now = Date.now();
            const snapshots = getSnapshots(scopeKey)
                .filter(item => now - Number(item?.capturedAt || 0) < RUNTIME_SCOPE_RECORD_TTL_MS)
                .sort((a, b) => Number(b?.turn || 0) - Number(a?.turn || 0) || Number(b?.capturedAt || 0) - Number(a?.capturedAt || 0));
            const exact = snapshots.find(item => normalizeLegacyMemoryTurnAnchor(item?.turn) === restoreBeforeTurn);
            const fallback = exact || snapshots.find(item => {
                const turn = normalizeLegacyMemoryTurnAnchor(item?.turn);
                return turn > 0 && turn < Math.min(...uniqueTurns) && (restoreBeforeTurn - turn) <= ROLLBACK_SNAPSHOT_LIMIT_PER_SCOPE;
            });
            return {
                scopeKey,
                snapshot: fallback || null,
                reason: fallback ? (exact ? 'exact_snapshot' : 'fallback_snapshot') : 'snapshot_unavailable',
                turns: uniqueTurns,
                restoreBeforeTurn
            };
        };

        const restoreSnapshot = async (char = null, chat = null, snapshot = null, options = {}) => {
            if (!char || !chat || !snapshot || !Array.isArray(snapshot?.lorebook)) {
                return { ok: false, restored: false, reason: 'invalid_snapshot' };
            }
            const restoredLore = snapshot.lorebook.map(entry => safeClone(entry));
            const scopeKey = normalizeScopeKey(chat, char);
            restoreRuntime(snapshot);
            MemoryEngine.setLorebook(char, chat, restoredLore);
            MemoryEngine.rebuildIndex(restoredLore);
            SecretKnowledgeCore.loadState(restoredLore, {
                scopeKey,
                chatId: String(chat?.id || '').trim()
            });
            EntityKnowledgeVaultCore.loadState(restoredLore, {
                scopeKey,
                chatId: String(chat?.id || '').trim()
            });
            TimeEngine.loadState(restoredLore, {
                scopeKey,
                chatId: String(chat?.id || '').trim()
            });
            HierarchicalWorldManager.loadWorldGraph(restoredLore, true);
            EntityManager.rebuildCache(restoredLore);
            NarrativeTracker.loadState(restoredLore);
            StoryAuthor.loadState(restoredLore);
            Director.loadState(restoredLore);
            CharacterStateTracker.loadState(restoredLore);
            WorldStateTracker.loadState(restoredLore);
            if (snapshot?.runtime?.sectionWorld) SectionWorldInferenceManager.loadState?.(snapshot.runtime.sectionWorld);
            const maxTurn = Math.max(normalizeLegacyMemoryTurnAnchor(snapshot?.turn), deriveRuntimeTurnFromLorebook(restoredLore));
            if (maxTurn > 0) MemoryEngine.setTurn(maxTurn);
            try { MemoryState.libraProjectionDigestByScope.delete(scopeKey); } catch (_) {}
            await persistLoreToActiveChat(chat, restoredLore, {
                reason: String(options?.reason || 'rollback-snapshot-restore').trim() || 'rollback-snapshot-restore'
            });
            MemoryState.commitRevisionByScope.set(scopeKey, {
                revision: Number(MemoryState.commitRevisionByScope.get(scopeKey)?.revision || 0) + 1,
                hash: TokenizerEngine.simpleHash(JSON.stringify(restoredLore.map(e => [e.comment, e.key, e.content]).slice(-200))),
                updatedAt: Date.now(),
                lastCommitId: `rollback:${snapshot.turn}:${Date.now()}`
            });
            return { ok: true, restored: true, scopeKey, turn: maxTurn, reason: 'snapshot_restored' };
        };

        const maybeRestoreBeforeRequest = async (char = null, chat = null, lorebook = [], options = {}) => {
            const candidates = Array.isArray(options?.candidates) && options.candidates.length > 0
                ? options.candidates
                : (SyncEngine.getRollbackCandidates?.(chat, lorebook, { markTransient: true }) || []);
            if (!candidates.length) return { ok: true, restored: false, reason: 'no_rollback_candidates' };
            const choice = chooseSnapshot(char, chat, candidates);
            if (!choice.snapshot) {
                if (MemoryEngine.CONFIG?.debug) {
                    recordRuntimeDebug('log', '[LIBRA] V4.2 rollback snapshot unavailable; legacy sync fallback may apply', choice);
                }
                return { ok: true, restored: false, reason: choice.reason || 'snapshot_unavailable', candidates };
            }
            const restored = await restoreSnapshot(char, chat, choice.snapshot, {
                reason: 'before-request-rollback-snapshot-restore'
            });
            if (restored?.ok && restored?.restored) {
                for (const candidate of candidates) {
                    const id = String(candidate?.id || candidate?.messageId || '').trim();
                    if (id) {
                        MemoryState.rollbackTracker.delete(id);
                        MemoryState.transientMissing.delete(id);
                    }
                }
            }
            return { ...restored, candidates, selectedSnapshotTurn: choice.snapshot?.turn || 0 };
        };

        const getEmergencySnapshot = (chat = null, char = null, options = {}) => {
            const scopeKey = String(options?.scopeKey || '').trim() || normalizeScopeKey(chat, char);
            const snapshot = MemoryState.emergencySnapshotByScope.get(scopeKey) || null;
            return snapshot ? safeClone(snapshot) : null;
        };

        const restoreEmergency = async (char = null, chat = null, options = {}) => {
            const scopeKey = String(options?.scopeKey || '').trim() || normalizeScopeKey(chat, char);
            const snapshot = MemoryState.emergencySnapshotByScope.get(scopeKey) || null;
            if (!snapshot) return { ok: false, restored: false, reason: 'no_emergency_snapshot' };
            const restored = await restoreSnapshot(char, chat, snapshot, { reason: 'manual-emergency-snapshot-restore' });
            if (restored?.ok) MemoryState.emergencySnapshotByScope.delete(scopeKey);
            return restored;
        };

        const discardEmergency = (chat = null, char = null, options = {}) => {
            const scopeKey = String(options?.scopeKey || '').trim() || normalizeScopeKey(chat, char);
            return { ok: true, discarded: MemoryState.emergencySnapshotByScope.delete(scopeKey), scopeKey };
        };

        return Object.freeze({
            capture,
            captureEmergency,
            restoreEmergency,
            discardEmergency,
            getEmergencySnapshot,
            maybeRestoreBeforeRequest,
            chooseSnapshot,
            getSnapshots: (scopeKey = '') => getSnapshots(scopeKey).map(item => safeClone(item))
        });
    })();

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] RE-style Rollback Journal Manager — Stage 4
    // Persistent chat fingerprint journal + visible managed-lore snapshots.
    // Stage 4 adds reload/copy-chat resilience by re-scoping foreign rollback
    // journals/snapshots that were carried over with duplicated chats, then
    // restoring only LIBRA-managed lore entries from compatible baselines.
    // ══════════════════════════════════════════════════════════════
    const RollbackJournalManager = (() => {
        const COMMENT = 'lmai_rollback_journal';
        const SNAPSHOT_COMMENT = 'lmai_rollback_snapshot';
        const JOURNAL_SCHEMA = 'libra.rollback.journal.v1';
        const SNAPSHOT_SCHEMA = 'libra.rollback.snapshot.v1';
        const VERSION = 4;
        const ENTRY_LIMIT = 64;
        const COMMIT_LOG_LIMIT = 256;
        const SNAPSHOT_LIMIT_PER_SCOPE = 1; // Keep only the latest one-turn rollback baseline in visible lorebook.
        const RECENT_ROLLBACK_TURN_LIMIT = 1; // Multi-turn rollback falls back to delete-candidate cleanup + cold-start augment.
        const COLD_START_AUGMENT_DELAY_MS = 750;
        const TEXT_PREVIEW_LIMIT = 180;
        const BASELINE_REUSE_MS = 2500;

        const normalizeScopeKey = (chat = null, char = null) => String(
            getChatRuntimeScopeKey(chat, char)
            || getChatMemoryScopeKey(chat, char)
            || chat?.id
            || 'global'
        ).trim() || 'global';

        const hashText = (value = '') => {
            const text = String(value || '');
            try {
                if (typeof TokenizerEngine !== 'undefined' && TokenizerEngine?.simpleHash) {
                    return String(TokenizerEngine.simpleHash(text));
                }
            } catch (_) {}
            return stableHash(text);
        };

        const safeParse = (value, fallback = null) => {
            if (value && typeof value === 'object') return value;
            try { return JSON.parse(String(value || '')); } catch (_) { return fallback; }
        };

        const clip = (value = '', max = TEXT_PREVIEW_LIMIT) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            return text.length > max ? `${text.slice(0, Math.max(0, max - 12)).trim()}...[cut]` : text;
        };

        const getRole = (msg = null) => {
            const role = String(msg?.role || msg?.author || msg?.sender || msg?.type || '').trim().toLowerCase();
            if (msg?.is_user || role === 'user' || role === 'human' || role === 'input' || role === 'prompt') return 'user';
            if (role === 'system' || role === 'developer' || role === 'tool' || role === 'function') return 'system';
            return 'assistant';
        };

        const getComparableText = (msg = null, role = '') => {
            const raw = Utils.getMessageText(msg);
            const memoryText = Utils.getMemorySourceText(raw);
            return String(Utils.getNarrativeComparableText(memoryText || raw || '', role === 'user' ? 'user' : 'ai') || memoryText || raw || '').trim();
        };

        const isManagedLibraEntry = (entry = null) => {
            const comment = String(entry?.comment || '').trim();
            return !!comment && comment.startsWith('lmai_');
        };

        const isRollbackJournalEntry = (entry = null) => String(entry?.comment || '').trim() === COMMENT;
        const isRollbackSnapshotEntry = (entry = null) => String(entry?.comment || '').trim() === SNAPSHOT_COMMENT;
        const isSnapshotManagedEntry = (entry = null) => isManagedLibraEntry(entry) && !isRollbackJournalEntry(entry) && !isRollbackSnapshotEntry(entry);

        const unpackLore = (lorebook = []) => LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : []).map(entry => safeClone(entry));

        const buildChatFingerprint = (chat = null, options = {}) => {
            const chatId = String(chat?.id || options?.chatId || '').trim();
            const messages = (Array.isArray(getChatMessages(chat)) ? getChatMessages(chat) : [])
                .filter(msg => msg && typeof msg === 'object');
            const items = messages.map((msg, index) => {
                const role = getRole(msg);
                const text = getComparableText(msg, role);
                const bodyHash = text ? hashText(text) : '';
                const signature = String(getMessageSignature(msg) || `${role}::${index}::${bodyHash}`).trim();
                const id = String(getLiveMessageId?.(msg) || msg?.id || msg?.messageId || '').trim();
                return {
                    index,
                    role,
                    id,
                    bodyHash,
                    signatureHash: hashText(signature),
                    time: Number(msg?.time || 0) || 0,
                    preview: clip(text)
                };
            });
            const assistants = items.filter(item => item.role === 'assistant' && item.bodyHash);
            const users = items.filter(item => item.role === 'user' && item.bodyHash);
            const commitHashes = assistants.map(item => item.bodyHash);
            const tail = items.slice(-8).map(item => `${item.role}:${item.bodyHash || item.signatureHash || 'empty'}`);
            return {
                version: 1,
                chatId,
                count: items.length,
                userCount: users.length,
                assistantCount: assistants.length,
                tailHash: hashText(tail.join('|')),
                fingerprintHash: hashText(items.map(item => `${item.role}:${item.bodyHash}:${item.time}`).join('|')),
                assistantHashes: [...new Set(assistants.map(item => item.bodyHash))],
                userHashes: [...new Set(users.map(item => item.bodyHash))],
                commitHashes: [...new Set(commitHashes)],
                lastAssistantHash: assistants.length ? assistants[assistants.length - 1].bodyHash : '',
                lastUserHash: users.length ? users[users.length - 1].bodyHash : '',
                lastAssistantSignatureHash: assistants.length ? assistants[assistants.length - 1].signatureHash : '',
                lastUserSignatureHash: users.length ? users[users.length - 1].signatureHash : '',
                tail: items.slice(-5),
                createdAt: Date.now()
            };
        };

        const compactChatFingerprint = (fingerprint = null) => {
            if (!fingerprint || typeof fingerprint !== 'object') return null;
            return {
                version: fingerprint.version || 1,
                chatId: String(fingerprint.chatId || '').trim(),
                count: Number(fingerprint.count || 0),
                userCount: Number(fingerprint.userCount || 0),
                assistantCount: Number(fingerprint.assistantCount || 0),
                tailHash: String(fingerprint.tailHash || '').trim(),
                fingerprintHash: String(fingerprint.fingerprintHash || '').trim(),
                lastAssistantHash: String(fingerprint.lastAssistantHash || '').trim(),
                lastUserHash: String(fingerprint.lastUserHash || '').trim(),
                lastAssistantSignatureHash: String(fingerprint.lastAssistantSignatureHash || '').trim(),
                lastUserSignatureHash: String(fingerprint.lastUserSignatureHash || '').trim(),
                createdAt: Number(fingerprint.createdAt || 0) || 0
            };
        };

        const DIGEST_EXCLUDED_COMMENTS = new Set([
            'lmai_turn_records',
            'lmai_hme_index',
            'lmai_debug_recent',
            'lmai_character_lore_cues'
        ]);

        const buildManagedLoreDigest = (lorebook = []) => {
            const entries = unpackLore(lorebook)
                .filter(isSnapshotManagedEntry)
                .filter(entry => !DIGEST_EXCLUDED_COMMENTS.has(String(entry?.comment || '').trim()))
                .map(entry => ({
                    comment: String(entry.comment || '').trim(),
                    key: String(entry.key || '').trim(),
                    bytes: String(entry.content || '').length,
                    hash: hashText(`${String(entry.content || '').length}:${String(entry.content || '').slice(0, 320)}:${String(entry.content || '').slice(-160)}`)
                }));
            const counts = {};
            for (const entry of entries) counts[entry.comment] = Number(counts[entry.comment] || 0) + 1;
            return {
                entryCount: entries.length,
                counts,
                hash: hashText(entries.map(entry => `${entry.comment}:${entry.key}:${entry.hash}`).sort().join('|')),
                comments: Object.keys(counts).sort()
            };
        };

        // Stage 5: compact rollback snapshots.
        // Do not duplicate lmai_memory bodies in every snapshot.  A recent
        // rollback can reconstruct the memory layer by pruning current compact
        // memories back to snapshot.turn, while aggregate state entries
        // (entity/world/narrative/state) are still kept as a compact baseline.
        // Turn records are operational anchors, so snapshots keep only memory
        // metadata that can rebuild the live turn floor after restore.
        const SNAPSHOT_RESTORE_MODE = 'compact_delta_v1';
        const SNAPSHOT_AGGREGATE_EXCLUDED_COMMENTS = new Set([
            'lmai_memory',
            'lmai_turn_records',
            'lmai_hme_index',
            'lmai_world_graph',
            'lmai_world_node',
            'lmai_debug_recent',
            COMMENT,
            SNAPSHOT_COMMENT
        ]);
        const isSnapshotAggregateEntry = (entry = null) => {
            if (!isSnapshotManagedEntry(entry)) return false;
            const comment = String(entry?.comment || '').trim();
            return !SNAPSHOT_AGGREGATE_EXCLUDED_COMMENTS.has(comment);
        };
        const SNAPSHOT_NARRATIVE_TURN_LIMIT = Math.max(24, RECENT_ROLLBACK_TURN_LIMIT * 6);
        const SNAPSHOT_META_TURN_LIMIT = Math.max(12, RECENT_ROLLBACK_TURN_LIMIT * 4);
        const SNAPSHOT_STATE_TURN_LIMIT = Math.max(8, RECENT_ROLLBACK_TURN_LIMIT * 3);
        const SNAPSHOT_SUMMARY_LIMIT = 6;
        const compactSnapshotText = (value, limit = 420) => {
            const text = String(value || '').trim();
            if (!text) return '';
            if (text.length <= limit) return text;
            return `${text.slice(0, Math.max(32, limit - 1)).trim()}…`;
        };
        const compactNarrativeSnapshotState = (state = {}) => {
            const turnLog = Array.isArray(state?.turnLog) ? state.turnLog.slice(-SNAPSHOT_NARRATIVE_TURN_LIMIT) : [];
            const metaTurnLog = Array.isArray(state?.metaTurnLog) ? state.metaTurnLog.slice(-SNAPSHOT_META_TURN_LIMIT) : [];
            const storylines = Array.isArray(state?.storylines) ? state.storylines.map((storyline) => {
                const turns = Array.isArray(storyline?.turns) ? storyline.turns.slice(-SNAPSHOT_NARRATIVE_TURN_LIMIT) : [];
                return {
                    ...storyline,
                    turns,
                    recentEvents: Array.isArray(storyline?.recentEvents) ? storyline.recentEvents.slice(-SNAPSHOT_SUMMARY_LIMIT) : [],
                    summaries: Array.isArray(storyline?.summaries) ? storyline.summaries.slice(-SNAPSHOT_SUMMARY_LIMIT) : [],
                    keyPoints: Array.isArray(storyline?.keyPoints) ? storyline.keyPoints.slice(-8) : [],
                    ongoingTensions: Array.isArray(storyline?.ongoingTensions) ? storyline.ongoingTensions.slice(-8) : [],
                    currentContext: compactSnapshotText(storyline?.currentContext || '', 260),
                    firstTurn: turns.length ? Number(turns[0] || 0) : Number(storyline?.firstTurn || 0),
                    lastTurn: turns.length ? Number(turns[turns.length - 1] || 0) : Number(storyline?.lastTurn || 0)
                };
            }) : [];
            return {
                ...state,
                turnLog,
                metaTurnLog,
                storylines
            };
        };
        const compactCharStateSnapshotState = (state = {}) => {
            const next = {};
            for (const [name, history] of Object.entries((state && typeof state === 'object') ? state : {})) {
                next[name] = {
                    ...history,
                    turnLog: Array.isArray(history?.turnLog) ? history.turnLog.slice(-SNAPSHOT_STATE_TURN_LIMIT) : [],
                    consolidated: Array.isArray(history?.consolidated) ? history.consolidated.slice(-SNAPSHOT_SUMMARY_LIMIT) : []
                };
            }
            return next;
        };
        const compactWorldStateSnapshotState = (state = {}) => ({
            ...state,
            turnLog: Array.isArray(state?.turnLog)
                ? state.turnLog.slice(-SNAPSHOT_STATE_TURN_LIMIT).map((item) => ({
                    turn: Number(item?.turn || 0),
                    timestamp: Number(item?.timestamp || 0),
                    activeWorld: Array.isArray(item?.activeWorld) ? item.activeWorld.slice(0, 8) : [],
                    globalFlags: item?.globalFlags && typeof item.globalFlags === 'object' ? safeClone(item.globalFlags) : {},
                    classification: compactSnapshotText(item?.classification || '', 160),
                    worldSummary: compactSnapshotText(item?.worldSummary || '', 260),
                    ruleHighlights: Array.isArray(item?.ruleHighlights)
                        ? item.ruleHighlights.map(value => compactSnapshotText(value || '', 120)).filter(Boolean).slice(0, 6)
                        : extractWorldRuleHighlights(item?.rulesSnapshot || {}, 6),
                    notes: compactSnapshotText(item?.notes || '', 220)
                }))
                : [],
            consolidated: Array.isArray(state?.consolidated) ? state.consolidated.slice(-SNAPSHOT_SUMMARY_LIMIT) : []
        });
        const compactWorldGraphSnapshotState = (state = {}) => ({
            ...state,
            nodes: Array.isArray(state?.nodes)
                ? state.nodes.map((item) => {
                    const tuple = Array.isArray(item) ? item : [item?.id, item];
                    const nodeId = tuple[0];
                    const node = tuple[1] && typeof tuple[1] === 'object' ? tuple[1] : {};
                    const worldMetadata = node?.meta?.worldMetadata && typeof node.meta.worldMetadata === 'object'
                        ? {
                            ...safeClone(node.meta.worldMetadata),
                            sourceText: '',
                            summary: compactSnapshotText(node.meta.worldMetadata.summary || '', 420),
                            description: compactSnapshotText(node.meta.worldMetadata.description || '', 320),
                            notes: compactSnapshotText(node.meta.worldMetadata.notes || '', 260)
                        }
                        : {};
                    return [
                        nodeId,
                        {
                            ...node,
                            meta: {
                                ...(node.meta && typeof node.meta === 'object' ? node.meta : {}),
                                notes: compactSnapshotText(node?.meta?.notes || '', 260),
                                worldSummary: compactSnapshotText(node?.meta?.worldSummary || '', 420),
                                worldMetadata
                            }
                        }
                    ];
                })
                : []
        });
        const compactRpLongTermSnapshotState = (state = {}) => {
            const categoryKeys = [
                'stableFacts', 'preferences', 'commitments', 'openLoops',
                'relationshipMilestones', 'stateChanges', 'callbacks', 'episodes'
            ];
            const compactVersion = (version = {}) => ({
                ...version,
                text: compactSnapshotText(version?.text || '', 360),
                summary: compactSnapshotText(version?.summary || '', 360),
                value: compactSnapshotText(version?.value || '', 220),
                before: compactSnapshotText(version?.before || '', 140),
                after: compactSnapshotText(version?.after || '', 180),
                resolution: compactSnapshotText(version?.resolution || '', 180),
                resolutionCriteria: Array.isArray(version?.resolutionCriteria) ? version.resolutionCriteria.slice(0, 5) : version?.resolutionCriteria,
                consequences: Array.isArray(version?.consequences) ? version.consequences.slice(0, 5) : version?.consequences
            });
            const next = {
                ...state,
                rollbackAudit: Array.isArray(state?.rollbackAudit) ? state.rollbackAudit.slice(-6) : [],
                sourceMemoryKeys: Array.isArray(state?.sourceMemoryKeys) ? state.sourceMemoryKeys.slice(-1600) : []
            };
            for (const category of categoryKeys) {
                next[category] = (Array.isArray(state?.[category]) ? state[category] : []).map(item => ({
                    ...item,
                    text: compactSnapshotText(item?.text || '', 420),
                    summary: compactSnapshotText(item?.summary || '', 420),
                    value: compactSnapshotText(item?.value || '', 260),
                    before: compactSnapshotText(item?.before || '', 160),
                    after: compactSnapshotText(item?.after || '', 200),
                    resolution: compactSnapshotText(item?.resolution || '', 220),
                    sourceTurns: Array.isArray(item?.sourceTurns) ? item.sourceTurns.slice(-12) : [],
                    previousValues: Array.isArray(item?.previousValues) ? item.previousValues.slice(-5) : item?.previousValues,
                    versions: Array.isArray(item?.versions) ? item.versions.slice(-6).map(compactVersion) : item?.versions,
                    resolutionCriteria: Array.isArray(item?.resolutionCriteria) ? item.resolutionCriteria.slice(0, 6) : item?.resolutionCriteria,
                    consequences: Array.isArray(item?.consequences) ? item.consequences.slice(0, 6) : item?.consequences
                }));
            }
            return next;
        };
        const compactSnapshotAggregateEntry = (entry = null) => {
            if (!entry || typeof entry !== 'object') return null;
            const cloned = safeClone(entry);
            const comment = String(cloned?.comment || '').trim();
            if (!comment || typeof cloned.content !== 'string') return cloned;
            try {
                const parsed = JSON.parse(cloned.content);
                if (comment === 'lmai_narrative') cloned.content = JSON.stringify(compactNarrativeSnapshotState(parsed));
                else if (comment === 'lmai_char_states') cloned.content = JSON.stringify(compactCharStateSnapshotState(parsed));
                else if (comment === 'lmai_world_states') cloned.content = JSON.stringify(compactWorldStateSnapshotState(parsed));
                else if (comment === 'lmai_rp_longterm') cloned.content = JSON.stringify(compactRpLongTermSnapshotState(parsed));
            } catch (error) {
                recordSuppressedRuntimeError('rollback.snapshot.compact_aggregate_parse_failed', error, {
                    comment,
                    key: String(cloned?.key || '').trim()
                });
            }
            return cloned;
        };
        const collectSnapshotAggregateEntries = (lorebook = []) => unpackLore(lorebook)
            .filter(isSnapshotAggregateEntry)
            .map(compactSnapshotAggregateEntry)
            .filter(Boolean);
        const getSnapshotMemoryStats = (lorebook = [], snapshotTurn = 0) => {
            const stats = { total: 0, retainedByTurn: 0, newerThanSnapshot: 0, unknownTurn: 0, hash: '' };
            const pieces = [];
            for (const entry of unpackLore(lorebook)) {
                if (String(entry?.comment || '') !== 'lmai_memory') continue;
                stats.total += 1;
                const meta = extractEntryMetaForSnapshot(entry);
                const turn = normalizeLegacyMemoryTurnAnchor(meta.turn || meta.t || meta.finalizedTurn || meta.turnAnchorTurn || 0);
                const hash = hashText(String(entry?.content || ''));
                pieces.push(`${turn || 'unknown'}:${hash}`);
                if (!turn) stats.unknownTurn += 1;
                else if (snapshotTurn && turn > snapshotTurn) stats.newerThanSnapshot += 1;
                else stats.retainedByTurn += 1;
            }
            stats.hash = hashText(pieces.sort().join('|'));
            return stats;
        };
        const extractEntryMetaForSnapshot = (entry = null) => {
            if (!entry || typeof entry !== 'object') return {};
            if (String(entry?.comment || '') === 'lmai_memory') {
                try {
                    return parseLibraMetaObject(entry?.content || '', {});
                } catch (error) {
                    recordSuppressedRuntimeError('rollback.snapshot.extract_memory_meta_failed', error, {
                        comment: 'lmai_memory',
                        key: String(entry?.key || '').trim()
                    });
                    return {};
                }
            }
            try { return JSON.parse(String(entry?.content || '{}')); } catch (error) {
                recordSuppressedRuntimeError('rollback.snapshot.extract_entry_meta_failed', error, {
                    comment: String(entry?.comment || '').trim(),
                    key: String(entry?.key || '').trim()
                });
                return {};
            }
        };

        const detectDeletedMessages = (previous = null, current = null) => {
            if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') return [];
            const detections = [];
            const previousCount = Number(previous.count || 0);
            const currentCount = Number(current.count || 0);
            const previousAssistantCount = Number(previous.assistantCount || 0);
            const currentAssistantCount = Number(current.assistantCount || 0);
            const messageCountDecreased = currentCount < previousCount;
            const assistantCountDecreased = currentAssistantCount < previousAssistantCount;
            if (messageCountDecreased) {
                detections.push({
                    reason: 'chat_message_count_decreased',
                    previousCount,
                    currentCount
                });
            }
            const currentAssistant = new Set(Array.isArray(current.assistantHashes) ? current.assistantHashes : []);
            const previousAssistant = Array.isArray(previous.assistantHashes) ? previous.assistantHashes : [];
            const missingAssistant = previousAssistant.filter(hash => hash && !currentAssistant.has(hash));
            if ((messageCountDecreased || assistantCountDecreased) && previous.lastAssistantHash && !currentAssistant.has(previous.lastAssistantHash)) {
                detections.push({ reason: 'committed_assistant_hash_missing', hash: previous.lastAssistantHash });
            }
            if (missingAssistant.length > 0 && assistantCountDecreased) {
                detections.push({
                    reason: 'historical_assistant_hash_missing',
                    missing: missingAssistant.slice(0, 8),
                    missingCount: missingAssistant.length
                });
            }
            const currentUsers = new Set(Array.isArray(current.userHashes) ? current.userHashes : []);
            const previousUsers = Array.isArray(previous.userHashes) ? previous.userHashes : [];
            const missingUsers = previousUsers.filter(hash => hash && !currentUsers.has(hash));
            if (missingUsers.length > 0 && Number(current.userCount || 0) < Number(previous.userCount || 0)) {
                detections.push({
                    reason: 'historical_user_hash_missing',
                    missing: missingUsers.slice(0, 8),
                    missingCount: missingUsers.length
                });
            }
            if (previous.tailHash && current.tailHash && previous.tailHash !== current.tailHash && messageCountDecreased) {
                detections.push({ reason: 'tail_hash_changed_without_growth', previousTailHash: previous.tailHash, currentTailHash: current.tailHash });
            }
            return detections;
        };

        const newJournal = (scopeKey = '', chat = null) => ({
            schema: JOURNAL_SCHEMA,
            version: VERSION,
            scopeKey,
            scopeHash: stableHash(scopeKey),
            chatId: String(chat?.id || '').trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            policy: {
                stage: 4,
                restoreEnabled: true,
                restoreScope: 'libra_managed_lore_only',
                snapshotComment: SNAPSHOT_COMMENT,
                note: 'Stage 4 records chat fingerprints and only the latest one visible managed-lore snapshot. Multi-turn rollbacks use delete-candidate cleanup plus cold-start reanalysis in augment mode.'
            },
            lastChatFingerprint: null,
            lastBaselineId: '',
            lastCommitId: '',
            lastRestoreId: '',
            entries: []
            ,
            commitLog: []
        });

        const normalizeJournal = (raw = null, scopeKey = '', chat = null) => {
            const parsed = safeParse(raw, null);
            if (!parsed || parsed.schema !== JOURNAL_SCHEMA) return newJournal(scopeKey, chat);
            const fallbackCommitLog = Array.isArray(parsed.entries)
                ? parsed.entries.filter(entry => entry?.kind === 'assistant_commit' && entry?.commitState === 'assistant_committed')
                : [];
            return {
                ...newJournal(scopeKey, chat),
                ...parsed,
                version: Math.max(VERSION, Number(parsed.version || 1) || 1),
                scopeKey: String(parsed.scopeKey || scopeKey).trim() || scopeKey,
                scopeHash: String(parsed.scopeHash || stableHash(scopeKey)).trim(),
                chatId: String(parsed.chatId || chat?.id || '').trim(),
                policy: {
                    ...newJournal(scopeKey, chat).policy,
                    ...(parsed.policy && typeof parsed.policy === 'object' ? parsed.policy : {}),
                    stage: 4,
                    restoreEnabled: true,
                    restoreScope: 'libra_managed_lore_only',
                    snapshotComment: SNAPSHOT_COMMENT
                },
                entries: Array.isArray(parsed.entries) ? parsed.entries : [],
                commitLog: Array.isArray(parsed.commitLog) ? parsed.commitLog : fallbackCommitLog
            };
        };


        const listJournalPayloads = (lorebook = []) => unpackLore(lorebook)
            .filter(entry => String(entry?.comment || '').trim() === COMMENT)
            .map(entry => {
                const parsed = safeParse(entry?.content, null);
                if (!parsed || parsed.schema !== JOURNAL_SCHEMA) return null;
                return { entry, parsed };
            })
            .filter(Boolean);

        const findCurrentJournalPayload = (lorebook = [], scopeKey = '', scopeHash = '') => {
            const hash = String(scopeHash || stableHash(scopeKey || '')).trim();
            return listJournalPayloads(lorebook).find(({ entry, parsed }) => {
                if (String(entry?.key || '').includes(hash)) return true;
                return parsed?.scopeHash === hash || parsed?.scopeKey === scopeKey;
            }) || null;
        };

        const removeRollbackEntriesForScope = (lorebook = [], scopeHash = '') => {
            if (!Array.isArray(lorebook)) return lorebook;
            const hash = String(scopeHash || '').trim();
            if (!hash) return lorebook;
            for (let i = lorebook.length - 1; i >= 0; i -= 1) {
                const comment = String(lorebook[i]?.comment || '').trim();
                if (comment !== COMMENT && comment !== SNAPSHOT_COMMENT) continue;
                const parsed = safeParse(lorebook[i]?.content, null);
                if (parsed?.scopeHash === hash || String(lorebook[i]?.key || '').includes(hash)) {
                    lorebook.splice(i, 1);
                }
            }
            return lorebook;
        };

        const scoreForeignJournalCandidate = (candidate = null, currentFingerprint = null, currentChatId = '') => {
            const journal = candidate?.parsed || null;
            if (!journal) return -Infinity;
            let score = 0;
            const fp = journal.lastChatFingerprint || null;
            if (fp && currentFingerprint) {
                if (fp.fingerprintHash && fp.fingerprintHash === currentFingerprint.fingerprintHash) score += 120;
                if (fp.tailHash && fp.tailHash === currentFingerprint.tailHash) score += 60;
                if (fp.lastAssistantHash && fp.lastAssistantHash === currentFingerprint.lastAssistantHash) score += 30;
                if (fp.lastUserHash && fp.lastUserHash === currentFingerprint.lastUserHash) score += 30;
                if (journal.chatId && currentChatId && journal.chatId === currentChatId
                    && fp.lastUserHash && fp.lastUserHash === currentFingerprint.lastUserHash
                    && Number(currentFingerprint.count || 0) < Number(fp.count || 0)) {
                    score += 90;
                }
                const prevAssistants = new Set(Array.isArray(fp.assistantHashes) ? fp.assistantHashes : []);
                const currAssistants = new Set(Array.isArray(currentFingerprint.assistantHashes) ? currentFingerprint.assistantHashes : []);
                const assistantOverlap = Array.from(prevAssistants).filter(hash => currAssistants.has(hash)).length;
                if (assistantOverlap) score += Math.min(40, assistantOverlap * 8);
            }
            if (journal.chatId && currentChatId && journal.chatId !== currentChatId) score += 12;
            score += Math.min(24, Number(Array.isArray(journal.entries) ? journal.entries.length : 0));
            score += Math.min(12, Math.floor((Number(journal.updatedAt || journal.createdAt || 0) || 0) / 1000000000000));
            return score;
        };

        const chooseForeignJournalForTransplant = (lorebook = [], scopeKey = '', scopeHash = '', currentFingerprint = null, chat = null) => {
            if (findCurrentJournalPayload(lorebook, scopeKey, scopeHash)) return null;
            const currentChatId = String(chat?.id || '').trim();
            const candidates = listJournalPayloads(lorebook)
                .filter(({ parsed }) => parsed?.scopeHash !== scopeHash && parsed?.scopeKey !== scopeKey)
                .map(candidate => ({
                    ...candidate,
                    score: scoreForeignJournalCandidate(candidate, currentFingerprint, currentChatId)
                }))
                .filter(candidate => candidate.score >= 50)
                .sort((a, b) => b.score - a.score || Number(b.parsed?.updatedAt || 0) - Number(a.parsed?.updatedAt || 0));
            return candidates[0] || null;
        };

        const cloneSnapshotForScope = (snapshot = null, scopeKey = '', scopeHash = '', chat = null, sourceJournal = null) => {
            if (!snapshot || snapshot.schema !== SNAPSHOT_SCHEMA || !snapshot.snapshotId) return null;
            const previousScope = {
                scopeKey: String(snapshot.scopeKey || sourceJournal?.scopeKey || '').trim(),
                scopeHash: String(snapshot.scopeHash || sourceJournal?.scopeHash || '').trim(),
                chatId: String(snapshot.chatId || sourceJournal?.chatId || '').trim(),
                snapshotId: String(snapshot.snapshotId || '').trim()
            };
            const next = safeClone(snapshot);
            next.version = Math.max(1, Number(next.version || 1) || 1);
            next.scopeKey = scopeKey;
            next.scopeHash = scopeHash;
            next.chatId = String(chat?.id || '').trim();
            next.transplanted = true;
            next.transplantedAt = Date.now();
            next.transplantedFrom = previousScope;
            next.reason = String(next.reason || 'scope-transplant').trim() || 'scope-transplant';
            if (next.chatFingerprint && typeof next.chatFingerprint === 'object') {
                next.chatFingerprint = {
                    ...next.chatFingerprint,
                    chatId: String(chat?.id || next.chatFingerprint.chatId || '').trim()
                };
            }
            return next;
        };

        const transplantForeignScopeIfNeeded = (lorebook = [], chat = null, char = null, currentFingerprint = null) => {
            if (!Array.isArray(lorebook) || !chat) return { transplanted: false, lorebook };
            const scopeKey = normalizeScopeKey(chat, char);
            const scopeHash = stableHash(scopeKey);
            if (findCurrentJournalPayload(lorebook, scopeKey, scopeHash)) return { transplanted: false, lorebook };
            const source = chooseForeignJournalForTransplant(lorebook, scopeKey, scopeHash, currentFingerprint, chat);
            if (!source?.parsed) return { transplanted: false, lorebook };
            const sourceJournal = source.parsed;
            const sourceScopeHash = String(sourceJournal.scopeHash || '').trim();
            const sourceScopeKey = String(sourceJournal.scopeKey || '').trim();
            const sourceSnapshots = listSnapshots(lorebook, sourceScopeHash);
            const workingLore = unpackLore(lorebook).map(entry => safeClone(entry));
            removeRollbackEntriesForScope(workingLore, sourceScopeHash);
            const transplantedSnapshots = [];
            sourceSnapshots.forEach(snapshot => {
                const cloned = cloneSnapshotForScope(snapshot, scopeKey, scopeHash, chat, sourceJournal);
                if (!cloned) return;
                transplantedSnapshots.push(cloned.snapshotId);
                upsertSnapshotEntry(workingLore, cloned);
            });
            const journal = normalizeJournal(sourceJournal, scopeKey, chat);
            journal.version = VERSION;
            journal.scopeKey = scopeKey;
            journal.scopeHash = scopeHash;
            journal.chatId = String(chat?.id || '').trim();
            journal.updatedAt = Date.now();
            journal.policy = {
                ...journal.policy,
                stage: 4,
                restoreEnabled: true,
                restoreScope: 'libra_managed_lore_only',
                snapshotComment: SNAPSHOT_COMMENT,
                scopeTransplantEnabled: true
            };
            const sourceFingerprint = sourceJournal.lastChatFingerprint || null;
            const currentFp = currentFingerprint || buildChatFingerprint(chat);
            const looksLikeRollbackDeletion = sourceFingerprint && currentFp && (
                Number(currentFp.count || 0) < Number(sourceFingerprint.count || 0)
                || (sourceFingerprint.lastAssistantHash
                    && !(Array.isArray(currentFp.assistantHashes) ? currentFp.assistantHashes : []).includes(sourceFingerprint.lastAssistantHash))
            );
            journal.lineage = {
                ...(journal.lineage && typeof journal.lineage === 'object' ? journal.lineage : {}),
                copiedFromScopeKey: sourceScopeKey,
                copiedFromScopeHash: sourceScopeHash,
                copiedFromChatId: String(sourceJournal.chatId || '').trim(),
                transplantedAt: Date.now(),
                transplantScore: source.score,
                transplantMode: looksLikeRollbackDeletion ? 'rollback_detection' : 'copy_rebase',
                transplantedSnapshotIds: transplantedSnapshots.slice(0, 20)
            };
            journal.lastChatFingerprint = looksLikeRollbackDeletion ? sourceFingerprint : currentFp;
            const transplantId = `rbj_transplant_${scopeHash}_${Date.now()}`;
            journal.entries = Array.isArray(journal.entries) ? journal.entries : [];
            journal.entries.push({
                id: transplantId,
                kind: 'scope_transplant',
                commitState: 'transplanted',
                ts: Date.now(),
                fromScopeKey: sourceScopeKey,
                fromScopeHash: sourceScopeHash,
                fromChatId: String(sourceJournal.chatId || '').trim(),
                toScopeKey: scopeKey,
                toScopeHash: scopeHash,
                toChatId: String(chat?.id || '').trim(),
                score: source.score,
                currentFingerprintHash: currentFp?.fingerprintHash || '',
                sourceFingerprintHash: sourceFingerprint?.fingerprintHash || '',
                transplantMode: looksLikeRollbackDeletion ? 'rollback_detection' : 'copy_rebase',
                transplantedSnapshotIds: transplantedSnapshots.slice(0, 20),
                note: 'Stage 4 adopted rollback journal/snapshots carried by a duplicated or scope-shifted chat.'
            });
            upsertJournalEntry(workingLore, journal);
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('warn', '[LIBRA] Rollback journal transplanted from copied/scope-shifted chat', {
                    __libraDebugMeta: true,
                    label: 'rollback-journal-transplant',
                    fromScopeHash: sourceScopeHash,
                    toScopeHash: scopeHash,
                    score: source.score,
                    snapshotCount: transplantedSnapshots.length
                });
            }
            return { transplanted: true, lorebook: workingLore, journal, source: sourceJournal, snapshotCount: transplantedSnapshots.length };
        };

        const bootstrapJournalFromVisibleLore = (lorebook = [], chat = null, char = null, currentFingerprint = null) => {
            const scopeKey = normalizeScopeKey(chat, char);
            const scopeHash = stableHash(scopeKey);
            if (findCurrentJournalPayload(lorebook, scopeKey, scopeHash)) return { bootstrapped: false, lorebook };
            const managedDigest = buildManagedLoreDigest(lorebook);
            if (!managedDigest.entryCount) return { bootstrapped: false, lorebook };
            const journal = newJournal(scopeKey, chat);
            journal.policy.stage = 4;
            journal.policy.bootstrapFromVisibleLore = true;
            journal.lastChatFingerprint = currentFingerprint || buildChatFingerprint(chat);
            journal.entries.push({
                id: `rbj_bootstrap_${scopeHash}_${Date.now()}`,
                kind: 'visible_lore_bootstrap',
                commitState: 'baseline_seed',
                ts: Date.now(),
                chatFingerprint: compactChatFingerprint(journal.lastChatFingerprint),
                managedLoreDigest: managedDigest,
                note: 'Stage 4 created a rollback journal for an existing chat that had LIBRA-managed lore but no rollback journal.'
            });
            const workingLore = unpackLore(lorebook).map(entry => safeClone(entry));
            upsertJournalEntry(workingLore, journal);
            return { bootstrapped: true, lorebook: workingLore, journal };
        };

        const loadJournal = (lorebook = [], chat = null, char = null) => {
            const scopeKey = normalizeScopeKey(chat, char);
            const scopeHash = stableHash(scopeKey);
            const entries = unpackLore(lorebook);
            const match = entries.find(entry => {
                if (String(entry?.comment || '') !== COMMENT) return false;
                if (String(entry?.key || '').includes(scopeHash)) return true;
                const parsed = safeParse(entry?.content, null);
                return parsed?.scopeHash === scopeHash || parsed?.scopeKey === scopeKey;
            });
            return normalizeJournal(match?.content || null, scopeKey, chat);
        };

        const compactJournalDetection = (detection = {}) => ({
            reason: String(detection?.reason || '').trim(),
            hash: String(detection?.hash || '').trim(),
            missing: Array.isArray(detection?.missing) ? detection.missing.slice(0, 4).map(v => String(v || '').trim()).filter(Boolean) : undefined,
            missingCount: Number(detection?.missingCount || 0) || undefined,
            previousCount: Number(detection?.previousCount || 0) || undefined,
            currentCount: Number(detection?.currentCount || 0) || undefined,
            previousTailHash: String(detection?.previousTailHash || '').trim() || undefined,
            currentTailHash: String(detection?.currentTailHash || '').trim() || undefined
        });

        const compactCommitReference = (entry = {}) => ({
            id: String(entry?.id || '').trim(),
            kind: 'assistant_commit',
            commitState: String(entry?.commitState || 'assistant_committed').trim() || 'assistant_committed',
            baselineId: String(entry?.baselineId || '').trim(),
            snapshotId: String(entry?.snapshotId || '').trim(),
            committedAt: Number(entry?.committedAt || entry?.ts || 0) || 0,
            turn: normalizeLegacyMemoryTurnAnchor(entry?.turn || 0),
            assistantHash: String(entry?.assistantHash || '').trim(),
            assistantSignatureHash: String(entry?.assistantSignatureHash || '').trim(),
            messageId: String(entry?.messageId || entry?.m_id || '').trim(),
            liveMessageIds: normalizeCanonicalMessageIds(entry?.liveMessageIds || entry?.sourceMessageIds || entry?.messageId || entry?.m_id).slice(0, 8),
            turnKey: String(entry?.turnKey || '').trim(),
            userTurnKey: String(entry?.userTurnKey || '').trim(),
            memoryKey: String(entry?.memoryKey || '').trim()
        });

        const compactJournalEntry = (entry = {}) => {
            if (!entry || typeof entry !== 'object') return entry;
            const next = { ...entry };
            if (next.chatFingerprint) next.chatFingerprint = compactChatFingerprint(next.chatFingerprint);
            if (Array.isArray(next.detections)) next.detections = next.detections.slice(0, 4).map(compactJournalDetection);
            if (next.managedLoreDigest?.counts) {
                next.managedLoreDigest = {
                    entryCount: Number(next.managedLoreDigest.entryCount || 0),
                    counts: next.managedLoreDigest.counts,
                    hash: String(next.managedLoreDigest.hash || '').trim(),
                    comments: Array.isArray(next.managedLoreDigest.comments) ? next.managedLoreDigest.comments.slice(0, 24) : []
                };
            }
            if (next.snapshotManagedLoreDigest?.counts) {
                next.snapshotManagedLoreDigest = {
                    entryCount: Number(next.snapshotManagedLoreDigest.entryCount || 0),
                    counts: next.snapshotManagedLoreDigest.counts,
                    hash: String(next.snapshotManagedLoreDigest.hash || '').trim(),
                    comments: Array.isArray(next.snapshotManagedLoreDigest.comments) ? next.snapshotManagedLoreDigest.comments.slice(0, 24) : []
                };
            }
            if (Array.isArray(next.liveMessageIds)) next.liveMessageIds = next.liveMessageIds.slice(0, 4);
            if (Array.isArray(next.transplantedSnapshotIds)) next.transplantedSnapshotIds = next.transplantedSnapshotIds.slice(0, 8);
            return next;
        };

        const pruneJournal = (journal = {}) => {
            const entries = Array.isArray(journal.entries) ? journal.entries.slice() : [];
            entries.sort((a, b) => Number(a?.ts || a?.capturedAt || a?.committedAt || a?.restoredAt || 0) - Number(b?.ts || b?.capturedAt || b?.committedAt || b?.restoredAt || 0));
            journal.entries = entries.slice(-ENTRY_LIMIT).map(compactJournalEntry);
            const commitLog = Array.isArray(journal.commitLog) ? journal.commitLog.slice() : [];
            commitLog.sort((a, b) => Number(a?.committedAt || a?.ts || 0) - Number(b?.committedAt || b?.ts || 0));
            journal.commitLog = commitLog
                .map(compactCommitReference)
                .filter(entry => entry.turn > 0 && entry.assistantHash)
                .slice(-COMMIT_LOG_LIMIT);
            journal.updatedAt = Date.now();
            return journal;
        };

        const pruneRollbackEntriesForSameChatDifferentScope = (lorebook = [], journal = null) => {
            if (!Array.isArray(lorebook) || !journal) return lorebook;
            const activeChatId = String(journal.chatId || '').trim();
            const activeScopeHash = String(journal.scopeHash || stableHash(journal.scopeKey || '')).trim();
            if (!activeChatId || !activeScopeHash) return lorebook;
            for (let i = lorebook.length - 1; i >= 0; i -= 1) {
                const comment = String(lorebook[i]?.comment || '').trim();
                if (comment !== COMMENT && comment !== SNAPSHOT_COMMENT) continue;
                const parsed = safeParse(lorebook[i]?.content, null);
                if (!parsed) continue;
                const parsedChatId = String(parsed.chatId || '').trim();
                const parsedScopeHash = String(parsed.scopeHash || '').trim();
                if (parsedChatId && parsedChatId === activeChatId && parsedScopeHash && parsedScopeHash !== activeScopeHash) {
                    lorebook.splice(i, 1);
                }
            }
            return lorebook;
        };

        const upsertJournalEntry = (lorebook = [], journal = null) => {
            if (!Array.isArray(lorebook) || !journal) return lorebook;
            const scopeHash = String(journal.scopeHash || stableHash(journal.scopeKey || '')).trim();
            pruneRollbackEntriesForSameChatDifferentScope(lorebook, journal);
            for (let i = lorebook.length - 1; i >= 0; i -= 1) {
                if (String(lorebook[i]?.comment || '') !== COMMENT) continue;
                const parsed = safeParse(lorebook[i]?.content, null);
                if (!parsed || parsed.scopeHash === scopeHash || String(lorebook[i]?.key || '').includes(scopeHash)) {
                    lorebook.splice(i, 1);
                }
            }
            lorebook.push({
                key: `${COMMENT}::${scopeHash}`,
                comment: COMMENT,
                content: JSON.stringify(pruneJournal(journal)),
                mode: 'normal',
                insertorder: 99,
                alwaysActive: false
            });
            return lorebook;
        };

        const makeBaselineId = (scopeKey = '', fingerprint = null, turn = 0) => `rbj_base_${stableHash(scopeKey)}_${normalizeLegacyMemoryTurnAnchor(turn) || 0}_${String(fingerprint?.fingerprintHash || 'nofp').slice(0, 10)}_${Date.now()}`;
        const makeSnapshotId = (scopeKey = '', baselineId = '', turn = 0) => `rbj_snap_${stableHash(scopeKey)}_${normalizeLegacyMemoryTurnAnchor(turn) || 0}_${String(hashText(baselineId)).slice(0, 10)}_${Date.now()}`;

        const buildSnapshotPayload = (lorebook = [], journal = {}, baseline = {}, fingerprint = null, options = {}) => {
            const scopeKey = String(journal?.scopeKey || '').trim();
            const scopeHash = String(journal?.scopeHash || stableHash(scopeKey)).trim();
            const turn = normalizeLegacyMemoryTurnAnchor(options?.turn || baseline?.turn || deriveRuntimeTurnFromLorebook(lorebook) || MemoryEngine.getCurrentTurn?.() || 0);
            const aggregateManagedEntries = collectSnapshotAggregateEntries(lorebook);
            const memoryStats = getSnapshotMemoryStats(lorebook, turn);
            const snapshotId = String(options?.snapshotId || baseline?.snapshotId || makeSnapshotId(scopeKey, baseline?.id || '', turn)).trim();
            return {
                schema: SNAPSHOT_SCHEMA,
                version: 2,
                restoreMode: SNAPSHOT_RESTORE_MODE,
                snapshotId,
                baselineId: String(baseline?.id || '').trim(),
                scopeKey,
                scopeHash,
                chatId: String(journal?.chatId || '').trim(),
                turn,
                capturedAt: Date.now(),
                reason: String(options?.reason || baseline?.reason || 'beforeRequest-baseline-snapshot').trim() || 'beforeRequest-baseline-snapshot',
                chatFingerprint: compactChatFingerprint(fingerprint || baseline?.chatFingerprint || null),
                managedLoreDigest: buildManagedLoreDigest(lorebook),
                managedLoreEntryCount: aggregateManagedEntries.length,
                aggregateManagedEntryCount: aggregateManagedEntries.length,
                memoryRestorePolicy: {
                    mode: 'prune_current_memory_to_snapshot_turn',
                    snapshotTurn: turn,
                    stats: memoryStats
                },
                retention: { recentTurnLimit: RECENT_ROLLBACK_TURN_LIMIT, snapshotLimitPerScope: SNAPSHOT_LIMIT_PER_SCOPE },
                aggregateManagedEntries
            };
        };

        const parseSnapshotEntry = (entry = null) => {
            if (!isRollbackSnapshotEntry(entry)) return null;
            const parsed = safeParse(entry?.content, null);
            if (!parsed || parsed.schema !== SNAPSHOT_SCHEMA || !parsed.snapshotId) return null;
            return parsed;
        };

        const listSnapshots = (lorebook = [], scopeHash = '') => unpackLore(lorebook)
            .filter(isRollbackSnapshotEntry)
            .map(parseSnapshotEntry)
            .filter(Boolean)
            .filter(snapshot => !scopeHash || String(snapshot.scopeHash || '') === String(scopeHash || ''));

        const loadSnapshot = (lorebook = [], snapshotId = '', scopeHash = '') => {
            const id = String(snapshotId || '').trim();
            if (!id) return null;
            return listSnapshots(lorebook, scopeHash).find(snapshot => snapshot.snapshotId === id) || null;
        };

        const hasUsableSnapshotEntries = (snapshot = null) => Boolean(snapshot
            && (Array.isArray(snapshot.managedLoreEntries) || Array.isArray(snapshot.aggregateManagedEntries)));

        const upsertSnapshotEntry = (lorebook = [], snapshot = null) => {
            if (!Array.isArray(lorebook) || !snapshot?.snapshotId) return lorebook;
            const scopeHash = String(snapshot.scopeHash || '').trim();
            const snapshotId = String(snapshot.snapshotId || '').trim();
            for (let i = lorebook.length - 1; i >= 0; i -= 1) {
                if (String(lorebook[i]?.comment || '') !== SNAPSHOT_COMMENT) continue;
                const parsed = safeParse(lorebook[i]?.content, null);
                if (parsed?.snapshotId === snapshotId || String(lorebook[i]?.key || '').includes(snapshotId)) {
                    lorebook.splice(i, 1);
                }
            }
            lorebook.push({
                key: `${SNAPSHOT_COMMENT}::${scopeHash || 'global'}::${snapshotId}`,
                comment: SNAPSHOT_COMMENT,
                content: JSON.stringify(snapshot),
                mode: 'normal',
                insertorder: 99,
                alwaysActive: false
            });
            return pruneSnapshotEntries(lorebook, scopeHash, snapshotId);
        };

        const pruneSnapshotEntries = (lorebook = [], scopeHash = '', protectedSnapshotId = '') => {
            if (!Array.isArray(lorebook)) return lorebook;
            const indexed = [];
            for (let i = 0; i < lorebook.length; i += 1) {
                if (String(lorebook[i]?.comment || '') !== SNAPSHOT_COMMENT) continue;
                const parsed = safeParse(lorebook[i]?.content, null);
                if (!parsed || (scopeHash && parsed.scopeHash !== scopeHash)) continue;
                indexed.push({ index: i, parsed });
            }
            indexed.sort((a, b) => Number(b.parsed?.capturedAt || 0) - Number(a.parsed?.capturedAt || 0));
            const keep = new Set();
            if (protectedSnapshotId) {
                const protectedItem = indexed.find(item => item.parsed?.snapshotId === protectedSnapshotId);
                if (protectedItem) keep.add(protectedItem.index);
            }
            for (const item of indexed) {
                if (keep.size >= SNAPSHOT_LIMIT_PER_SCOPE) break;
                keep.add(item.index);
            }
            for (let n = indexed.length - 1; n >= 0; n -= 1) {
                const idx = indexed[n].index;
                if (!keep.has(idx)) lorebook.splice(idx, 1);
            }
            return lorebook;
        };

        const appendDetectionEntries = (journal = {}, detections = [], currentFingerprint = null) => {
            if (!Array.isArray(detections) || detections.length === 0) return null;
            const entry = {
                id: `rbj_detect_${stableHash(journal.scopeKey || '')}_${Date.now()}`,
                kind: 'rollback_detected',
                commitState: 'detected',
                ts: Date.now(),
                detections: detections.slice(0, 8),
                currentFingerprintHash: currentFingerprint?.fingerprintHash || '',
                restoreEnabled: true
            };
            journal.entries.push(entry);
            return entry;
        };

        const collectMissingAssistantHashes = (detections = []) => {
            const out = [];
            for (const detection of Array.isArray(detections) ? detections : []) {
                if (detection?.hash) out.push(String(detection.hash));
                if (Array.isArray(detection?.missing)) detection.missing.forEach(hash => out.push(String(hash || '')));
            }
            return [...new Set(out.filter(Boolean))];
        };

        const getLatestCommittedTurn = (journal = {}) => {
            const commits = (Array.isArray(journal.commitLog) && journal.commitLog.length ? journal.commitLog : (Array.isArray(journal.entries) ? journal.entries : []))
                .filter(entry => entry?.kind === 'assistant_commit' && entry?.commitState === 'assistant_committed')
                .map(entry => normalizeLegacyMemoryTurnAnchor(entry?.turn || 0))
                .filter(turn => turn > 0);
            return commits.length ? Math.max(...commits) : 0;
        };

        const getRollbackDepth = (journal = {}, restoreTarget = null, detections = [], currentFingerprint = null) => {
            const latestTurn = getLatestCommittedTurn(journal);
            const deleteCandidates = collectDeleteCandidateCommits(journal, detections, currentFingerprint);
            if (deleteCandidates.length > 0) {
                const turns = deleteCandidates.map(commit => normalizeLegacyMemoryTurnAnchor(commit?.turn || 0)).filter(Boolean);
                if (latestTurn > 0 && turns.length > 0) return Math.max(deleteCandidates.length, latestTurn - Math.min(...turns) + 1);
                return deleteCandidates.length;
            }
            const commitTurn = normalizeLegacyMemoryTurnAnchor(restoreTarget?.commit?.turn || restoreTarget?.baseline?.turn || 0);
            if (latestTurn > 0 && commitTurn > 0) return Math.max(1, latestTurn - commitTurn + 1);
            const missingHashes = collectMissingAssistantHashes(detections);
            return Math.max(1, missingHashes.length || 1);
        };

        const isRecentRollbackTarget = (journal = {}, restoreTarget = null, detections = [], currentFingerprint = null) => {
            if (!restoreTarget?.ok) return false;
            return getRollbackDepth(journal, restoreTarget, detections, currentFingerprint) <= RECENT_ROLLBACK_TURN_LIMIT;
        };

        const collectAssistantCommitsWithRestoreRefs = (journal = {}) => {
            const merged = new Map();
            const add = (entry = null) => {
                if (!entry || entry.kind !== 'assistant_commit' || entry.commitState !== 'assistant_committed') return;
                const id = String(entry.id || '').trim();
                const turn = normalizeLegacyMemoryTurnAnchor(entry.turn || 0);
                const assistantHash = String(entry.assistantHash || '').trim();
                const key = id || [turn, assistantHash, Number(entry.committedAt || entry.ts || 0) || 0].join('|');
                if (!key) return;
                const prev = merged.get(key) || {};
                const next = { ...prev, ...entry };
                next.id = id || String(prev.id || '').trim();
                next.kind = 'assistant_commit';
                next.commitState = 'assistant_committed';
                next.baselineId = String(entry.baselineId || prev.baselineId || '').trim();
                next.snapshotId = String(entry.snapshotId || prev.snapshotId || '').trim();
                next.turn = turn || normalizeLegacyMemoryTurnAnchor(prev.turn || 0);
                next.assistantHash = assistantHash || String(prev.assistantHash || '').trim();
                next.committedAt = Number(entry.committedAt || entry.ts || prev.committedAt || prev.ts || 0) || 0;
                merged.set(key, next);
            };
            (Array.isArray(journal.entries) ? journal.entries : []).forEach(add);
            (Array.isArray(journal.commitLog) ? journal.commitLog : []).forEach(add);
            return Array.from(merged.values())
                .filter(entry => entry.turn > 0 || entry.assistantHash || entry.id)
                .sort((a, b) => Number(b.committedAt || b.ts || 0) - Number(a.committedAt || a.ts || 0));
        };

        const findBaselineForCommit = (journal = {}, commit = null) => {
            const entries = Array.isArray(journal.entries) ? journal.entries : [];
            const baselineId = String(commit?.baselineId || '').trim();
            if (baselineId) {
                const byId = entries.find(entry => entry?.kind === 'before_request_baseline' && entry?.id === baselineId) || null;
                if (byId) return byId;
            }
            const commitId = String(commit?.id || '').trim();
            const assistantHash = String(commit?.assistantHash || '').trim();
            const postCommitFingerprintHash = String(commit?.chatFingerprint?.fingerprintHash || '').trim();
            return entries
                .filter(entry => entry?.kind === 'before_request_baseline')
                .slice()
                .reverse()
                .find(entry => {
                    if (commitId && String(entry?.assistantCommitId || '').trim() === commitId) return true;
                    if (assistantHash && String(entry?.assistantHash || '').trim() === assistantHash) return true;
                    if (postCommitFingerprintHash && String(entry?.postCommitFingerprintHash || '').trim() === postCommitFingerprintHash) return true;
                    return false;
                }) || null;
        };

        const resolveSnapshotForCommit = (journal = {}, lorebook = [], commit = null, missingHashes = []) => {
            const baseline = findBaselineForCommit(journal, commit);
            const candidates = [];
            const pushCandidate = (snapshotId = '', source = '', sourceBaseline = null) => {
                const id = String(snapshotId || '').trim();
                if (!id || candidates.some(item => item.snapshotId === id)) return;
                candidates.push({ snapshotId: id, source, baseline: sourceBaseline || null });
            };
            pushCandidate(commit?.snapshotId, 'commit.snapshotId', baseline);
            pushCandidate(baseline?.snapshotId, 'baseline.snapshotId', baseline);
            const entries = Array.isArray(journal.entries) ? journal.entries : [];
            const commitId = String(commit?.id || '').trim();
            if (commitId) {
                const fullCommit = entries.find(entry => entry?.kind === 'assistant_commit' && entry?.id === commitId) || null;
                pushCandidate(fullCommit?.snapshotId, 'entry.snapshotId', baseline);
                const fullBaseline = findBaselineForCommit(journal, fullCommit);
                pushCandidate(fullBaseline?.snapshotId, 'entry.baseline.snapshotId', fullBaseline);
            }
            for (const candidate of candidates) {
                const snapshot = loadSnapshot(lorebook, candidate.snapshotId, journal.scopeHash);
                if (hasUsableSnapshotEntries(snapshot)) {
                    return {
                        ok: true,
                        commit,
                        baseline: candidate.baseline || baseline || null,
                        snapshot,
                        snapshotId: candidate.snapshotId,
                        baselineId: String((candidate.baseline || baseline)?.id || commit?.baselineId || '').trim(),
                        missingHashes,
                        snapshotSource: candidate.source
                    };
                }
            }
            const missingReason = candidates.length ? 'snapshot_unavailable' : 'target_missing_snapshot_id';
            return {
                ok: false,
                reason: missingReason,
                commitId: commit?.id,
                baselineId: String(baseline?.id || commit?.baselineId || '').trim(),
                snapshotId: candidates[0]?.snapshotId || '',
                candidateSnapshotIds: candidates.map(item => item.snapshotId),
                missingHashes
            };
        };

        const extractEntryMeta = (entry = null) => {
            if (!entry || typeof entry !== 'object') return {};
            if (String(entry?.comment || '') === 'lmai_memory') {
                try {
                    return parseLibraMetaObject(entry?.content || '', {});
                } catch (error) {
                    recordSuppressedRuntimeError('rollback.extract_memory_meta_failed', error, {
                        comment: 'lmai_memory',
                        key: String(entry?.key || '').trim()
                    });
                    return {};
                }
            }
            try { return JSON.parse(String(entry?.content || '{}')); } catch (error) {
                recordSuppressedRuntimeError('rollback.extract_entry_meta_failed', error, {
                    comment: String(entry?.comment || '').trim(),
                    key: String(entry?.key || '').trim()
                });
                return {};
            }
        };

        const normalizeCommitIds = (commit = {}) => normalizeCanonicalMessageIds([
            commit?.messageId,
            commit?.m_id,
            commit?.liveMessageIds,
            commit?.sourceMessageIds
        ]);

        const collectDeleteCandidateCommits = (journal = {}, detections = [], currentFingerprint = null) => {
            const sourceEntries = (Array.isArray(journal.commitLog) && journal.commitLog.length)
                ? journal.commitLog
                : (Array.isArray(journal.entries) ? journal.entries : []);
            const commits = sourceEntries
                .filter(entry => entry?.kind === 'assistant_commit' && entry?.commitState === 'assistant_committed')
                .slice()
                .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.committedAt || 0) - Number(b.committedAt || 0));
            if (!commits.length) return [];
            const missingHashes = new Set(collectMissingAssistantHashes(detections));
            const currentAssistantHashes = new Set(Array.isArray(currentFingerprint?.assistantHashes) ? currentFingerprint.assistantHashes : []);
            let candidates = commits.filter(commit => {
                const hash = String(commit?.assistantHash || '').trim();
                return hash && (missingHashes.has(hash) || !currentAssistantHashes.has(hash));
            });
            if (!candidates.length) {
                const countDecrease = Math.max(0, ...((Array.isArray(detections) ? detections : [])
                    .map(d => Number(d?.previousCount || 0) - Number(d?.currentCount || 0))));
                const assistantDecrease = Math.max(0, Number(journal?.lastChatFingerprint?.assistantCount || 0) - Number(currentFingerprint?.assistantCount || 0));
                const fallbackCount = Math.max(countDecrease, assistantDecrease, collectMissingAssistantHashes(detections).length, 1);
                candidates = commits.slice(-fallbackCount);
            }
            const seen = new Set();
            return candidates.filter(commit => {
                const key = String(commit.id || commit.assistantHash || `${commit.turn}:${commit.committedAt}`).trim();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };

        const pruneNarrativeTurnsForDeleteCandidates = (lorebook = [], deletedTurns = new Set(), deletedHashes = new Set(), deletedTurnKeys = new Set()) => {
            let changed = false;
            for (const entry of lorebook) {
                if (String(entry?.comment || '') !== 'lmai_narrative') continue;
                try {
                    const parsed = JSON.parse(String(entry.content || '{}'));
                    const turnLog = Array.isArray(parsed.turnLog) ? parsed.turnLog : [];
                    const beforeTurnLog = turnLog.length;
                    const filterTurnEntry = (turnEntry = {}) => {
                        const turn = normalizeLegacyMemoryTurnAnchor(turnEntry?.turn || turnEntry?.turnAnchorTurn || turnEntry?.finalizedTurn || 0);
                        const hash = String(turnEntry?.sourceHash || turnEntry?.aiHash || turnEntry?.responseHash || turnEntry?.meta?.sourceHash || turnEntry?.meta?.aiHash || '').trim();
                        const turnKey = String(turnEntry?.turnKey || turnEntry?.meta?.turnKey || '').trim();
                        return !(deletedTurns.has(turn) || (hash && deletedHashes.has(hash)) || (turnKey && deletedTurnKeys.has(turnKey)));
                    };
                    const matchesDeletedRefText = (value = '') => {
                        const text = String(value || '').trim();
                        if (!text) return false;
                        for (const turn of deletedTurns) {
                            const pattern = new RegExp(`(^|[^A-Za-z0-9])(?:T\\s*${turn}|turn\\s*[:=_-]?\\s*${turn}|turn\\s+${turn})(?=$|[^A-Za-z0-9])`, 'i');
                            if (pattern.test(text)) return true;
                        }
                        for (const hash of deletedHashes) {
                            if (hash && text.includes(hash)) return true;
                        }
                        for (const turnKey of deletedTurnKeys) {
                            if (turnKey && text.includes(turnKey)) return true;
                        }
                        return false;
                    };
                    const filterDeletedRefStrings = (items = []) => (Array.isArray(items) ? items : []).filter(item => !matchesDeletedRefText(item));
                    parsed.turnLog = turnLog.filter(turnEntry => {
                        return filterTurnEntry(turnEntry);
                    });
                    if (parsed.turnLog.length !== beforeTurnLog) changed = true;
                    if (Array.isArray(parsed.metaTurnLog)) {
                        const beforeMetaTurnLog = parsed.metaTurnLog.length;
                        parsed.metaTurnLog = parsed.metaTurnLog.filter(turnEntry => filterTurnEntry(turnEntry));
                        if (parsed.metaTurnLog.length !== beforeMetaTurnLog) changed = true;
                    }
                    if (Array.isArray(parsed.storylines)) {
                        const beforeStorylines = JSON.stringify(parsed.storylines);
                        parsed.storylines = parsed.storylines.map(storyline => {
                            const next = { ...storyline };
                            if (Array.isArray(next.turns)) next.turns = next.turns.filter(turn => !deletedTurns.has(normalizeLegacyMemoryTurnAnchor(turn)));
                            if (Array.isArray(next.recentEvents)) next.recentEvents = next.recentEvents.filter(event => !deletedTurns.has(normalizeLegacyMemoryTurnAnchor(event?.turn ?? event)));
                            if (Array.isArray(next.summaries)) {
                                next.summaries = next.summaries
                                    .filter(summary => !deletedTurns.has(normalizeLegacyMemoryTurnAnchor(summary?.upToTurn || 0)))
                                    .filter(summary => !(Array.isArray(summary?.evidenceTurns) && summary.evidenceTurns.some(matchesDeletedRefText)))
                                    .map(summary => ({
                                        ...summary,
                                        evidenceTurns: filterDeletedRefStrings(summary?.evidenceTurns)
                                    }));
                            }
                            if (Array.isArray(next.evidenceTurns)) next.evidenceTurns = filterDeletedRefStrings(next.evidenceTurns);
                            if (Array.isArray(next.memoryRefs)) next.memoryRefs = filterDeletedRefStrings(next.memoryRefs);
                            if (Array.isArray(next.dedupeKeys)) next.dedupeKeys = filterDeletedRefStrings(next.dedupeKeys);
                            const turns = Array.isArray(next.turns) ? next.turns.map(normalizeLegacyMemoryTurnAnchor).filter(Boolean) : [];
                            next.firstTurn = turns.length ? Math.min(...turns) : 0;
                            next.lastTurn = turns.length ? Math.max(...turns) : 0;
                            return next;
                        }).filter(storyline => (Array.isArray(storyline.turns) && storyline.turns.length > 0) || storyline?.meta?.manualLocked === true);
                        if (JSON.stringify(parsed.storylines) !== beforeStorylines) changed = true;
                    }
                    entry.content = JSON.stringify(parsed, null, 2);
                } catch (error) {
                    recordSuppressedRuntimeError('rollback.prune_narrative_turns', error, {
                        stage: 'rollback-delete-candidate',
                        comment: 'lmai_narrative'
                    });
                }
            }
            return changed;
        };

        const markRollbackDirtyManagedEntries = (lorebook = [], deletedTurns = new Set(), deletedHashes = new Set(), deletedTurnKeys = new Set(), deletedIds = new Set(), options = {}) => {
            const touched = {
                entities: 0,
                relations: 0,
                world: 0,
                states: 0,
                narrativeTombstones: 0,
                relationEventsRemoved: 0,
                narrativeTurnsPruned: 0,
                stateTurnsPruned: 0,
                vaultRecordsPruned: 0,
                secretEvidencePruned: 0,
                timeRecordsPruned: 0
            };
            const candidateTurns = Array.from(deletedTurns).map(Number).filter(Boolean).sort((a, b) => a - b);
            const candidateHashes = Array.from(deletedHashes).filter(Boolean).slice(0, 20);
            const candidateTurnKeys = Array.from(deletedTurnKeys).filter(Boolean).slice(0, 20);
            const candidateIds = Array.from(deletedIds).filter(Boolean).slice(0, 20);
            const stamp = {
                ts: Date.now(),
                reason: String(options?.reason || 'rollback-delete-candidate').trim() || 'rollback-delete-candidate',
                turns: candidateTurns,
                hashes: candidateHashes,
                turnKeys: candidateTurnKeys,
                messageIds: candidateIds
            };
            const idOverlap = (values = []) => normalizeCanonicalMessageIds(values).some(id => deletedIds.has(id));
            const metaMatches = (meta = {}) => {
                if (!meta || typeof meta !== 'object') return false;
                const turns = [meta.turn, meta.t, meta.created, meta.updated, meta.firstTurn, meta.originalTurn, meta.lockedTurn, meta.finalizedTurn, meta.turnAnchorTurn, meta.turnAnchor]
                    .map(normalizeLegacyMemoryTurnAnchor)
                    .filter(Boolean);
                if (turns.some(turn => deletedTurns.has(turn))) return true;
                const hashes = [meta.sourceHash, meta.aiHash, meta.responseHash, meta.hash].map(v => String(v || '').trim()).filter(Boolean);
                if (hashes.some(hash => deletedHashes.has(hash))) return true;
                const turnKey = String(meta.turnKey || '').trim();
                if (turnKey && deletedTurnKeys.has(turnKey)) return true;
                return idOverlap([meta.m_id, meta.m_ids, meta.messageId, meta.sourceMessageIds, meta.liveMessageIds]);
            };
            const addDirtyMeta = (target = {}, kind = 'managed') => {
                target.meta = target.meta && typeof target.meta === 'object' ? target.meta : {};
                const meta = target.meta;
                meta.rollbackDirty = true;
                meta.needsReanalysis = true;
                meta.rollbackDeleteCandidates = Array.isArray(meta.rollbackDeleteCandidates) ? meta.rollbackDeleteCandidates : [];
                meta.rollbackDeleteCandidates.push({ ...stamp, kind });
                meta.rollbackDeleteCandidates = meta.rollbackDeleteCandidates.slice(-12);
                meta.m_ids = normalizeCanonicalMessageIds([meta.m_ids, meta.m_id]).filter(id => !deletedIds.has(id));
                if (meta.m_id && deletedIds.has(String(meta.m_id))) meta.m_id = meta.m_ids.length ? meta.m_ids[meta.m_ids.length - 1] : null;
                return target;
            };
            const pruneRelationEvents = (relation = {}) => {
                let removed = 0;
                const details = relation.details && typeof relation.details === 'object' ? relation.details : null;
                const events = Array.isArray(details?.events) ? details.events : [];
                if (!events.length) return 0;
                details.events = events.filter(event => {
                    const eventMeta = {
                        turn: event?.turn || event?.t || event?.createdTurn || event?.updatedTurn,
                        sourceHash: event?.sourceHash || event?.aiHash || event?.responseHash,
                        turnKey: event?.turnKey,
                        sourceMessageIds: event?.sourceMessageIds || event?.liveMessageIds || event?.messageId
                    };
                    const remove = metaMatches(eventMeta);
                    if (remove) removed += 1;
                    return !remove;
                });
                if (removed > 0) relation.details = details;
                return removed;
            };
            const addNarrativeTombstones = (parsed = {}) => {
                parsed.rollbackDeletedTurns = Array.isArray(parsed.rollbackDeletedTurns) ? parsed.rollbackDeletedTurns : [];
                const existing = new Set(parsed.rollbackDeletedTurns.map(item => `${item.turn || 0}:${item.hash || ''}:${item.turnKey || ''}`));
                for (const turn of candidateTurns) {
                    const key = `${turn}::`;
                    if (existing.has(key)) continue;
                    parsed.rollbackDeletedTurns.push({
                        turn,
                        deleted: true,
                        hiddenFromPrompt: true,
                        reason: stamp.reason,
                        ts: stamp.ts,
                        hashes: candidateHashes,
                        turnKeys: candidateTurnKeys
                    });
                    touched.narrativeTombstones += 1;
                }
                parsed.rollbackDeletedTurns = parsed.rollbackDeletedTurns.slice(-60);
                return parsed;
            };
            const recordMatchesDeletedCommit = (record = {}) => {
                if (!record || typeof record !== 'object') return false;
                const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
                const turns = [
                    record.turn,
                    record.t,
                    record.sourceTurn,
                    record.turnNumber,
                    record.upToTurn,
                    record.turnAnchor,
                    record.turnAnchorTurn,
                    record.lockedTurn,
                    record.finalizedTurn,
                    record.lastUpdatedTurn,
                    meta.turn,
                    meta.t,
                    meta.sourceTurn,
                    meta.turnAnchor,
                    meta.turnAnchorTurn,
                    meta.lockedTurn,
                    meta.finalizedTurn
                ].map(normalizeLegacyMemoryTurnAnchor).filter(Boolean);
                if (turns.some(turn => deletedTurns.has(turn))) return true;
                const hashes = [
                    record.sourceHash,
                    record.aiHash,
                    record.responseHash,
                    record.hash,
                    meta.sourceHash,
                    meta.aiHash,
                    meta.responseHash,
                    meta.hash
                ].map(value => String(value || '').trim()).filter(Boolean);
                if (hashes.some(hash => deletedHashes.has(hash))) return true;
                const turnKeys = [record.turnKey, record.sourceTurnKey, meta.turnKey, meta.sourceTurnKey]
                    .map(value => String(value || '').trim())
                    .filter(Boolean);
                if (turnKeys.some(turnKey => deletedTurnKeys.has(turnKey))) return true;
                return idOverlap([
                    record.id,
                    record.m_id,
                    record.m_ids,
                    record.messageId,
                    record.sourceMessageId,
                    record.sourceMessageIds,
                    record.liveMessageIds,
                    meta.m_id,
                    meta.m_ids,
                    meta.messageId,
                    meta.sourceMessageIds,
                    meta.liveMessageIds
                ]);
            };
            const filterDeletedRecords = (items = []) => {
                const source = Array.isArray(items) ? items : [];
                const next = source.filter(item => !recordMatchesDeletedCommit(item));
                return { next, removed: Math.max(0, source.length - next.length) };
            };
            const matchesDeletedRefText = (value = '') => {
                const text = String(value || '').trim();
                if (!text) return false;
                for (const turn of deletedTurns) {
                    const pattern = new RegExp(`(^|[^A-Za-z0-9])(?:T\\s*${turn}|turn\\s*[:=_-]?\\s*${turn}|turn\\s+${turn})(?=$|[^A-Za-z0-9])`, 'i');
                    if (pattern.test(text)) return true;
                }
                for (const hash of deletedHashes) {
                    if (hash && text.includes(hash)) return true;
                }
                for (const turnKey of deletedTurnKeys) {
                    if (turnKey && text.includes(turnKey)) return true;
                }
                for (const id of deletedIds) {
                    if (id && text.includes(id)) return true;
                }
                return false;
            };
            const filterDeletedRefStrings = (items = []) => {
                const source = Array.isArray(items) ? items : [];
                return source.filter(item => !matchesDeletedRefText(item));
            };
            const pruneNarrativePayload = (parsed = {}) => {
                let removed = 0;
                const turnLog = filterDeletedRecords(parsed.turnLog);
                if (turnLog.removed) {
                    parsed.turnLog = turnLog.next;
                    removed += turnLog.removed;
                }
                const metaTurnLog = filterDeletedRecords(parsed.metaTurnLog);
                if (metaTurnLog.removed) {
                    parsed.metaTurnLog = metaTurnLog.next;
                    removed += metaTurnLog.removed;
                }
                if (Array.isArray(parsed.storylines)) {
                    parsed.storylines = parsed.storylines.map(storyline => {
                        if (!storyline || typeof storyline !== 'object') return storyline;
                        const next = { ...storyline };
                        if (Array.isArray(next.turns)) {
                            const before = next.turns.length;
                            next.turns = next.turns.filter(turn => !deletedTurns.has(normalizeLegacyMemoryTurnAnchor(turn)));
                            removed += Math.max(0, before - next.turns.length);
                        }
                        if (Array.isArray(next.evidenceTurns)) {
                            const before = next.evidenceTurns.length;
                            next.evidenceTurns = filterDeletedRefStrings(next.evidenceTurns);
                            removed += Math.max(0, before - next.evidenceTurns.length);
                        }
                        if (Array.isArray(next.memoryRefs)) {
                            const before = next.memoryRefs.length;
                            next.memoryRefs = filterDeletedRefStrings(next.memoryRefs);
                            removed += Math.max(0, before - next.memoryRefs.length);
                        }
                        if (Array.isArray(next.dedupeKeys)) {
                            const before = next.dedupeKeys.length;
                            next.dedupeKeys = filterDeletedRefStrings(next.dedupeKeys);
                            removed += Math.max(0, before - next.dedupeKeys.length);
                        }
                        const events = filterDeletedRecords(next.recentEvents);
                        if (events.removed) {
                            next.recentEvents = events.next;
                            removed += events.removed;
                        }
                        const summaries = filterDeletedRecords(next.summaries);
                        if (summaries.removed) {
                            next.summaries = summaries.next;
                            removed += summaries.removed;
                        }
                        if (Array.isArray(next.summaries)) {
                            const before = next.summaries.length;
                            next.summaries = next.summaries
                                .filter(summary => !(Array.isArray(summary?.evidenceTurns) && summary.evidenceTurns.some(matchesDeletedRefText)))
                                .map(summary => ({
                                    ...summary,
                                    evidenceTurns: filterDeletedRefStrings(summary?.evidenceTurns)
                                }));
                            removed += Math.max(0, before - next.summaries.length);
                        }
                        const turns = Array.isArray(next.turns) ? next.turns.map(normalizeLegacyMemoryTurnAnchor).filter(Boolean) : [];
                        next.firstTurn = turns.length ? Math.min(...turns) : 0;
                        next.lastTurn = turns.length ? Math.max(...turns) : 0;
                        return next;
                    }).filter(storyline => {
                        if (!storyline || typeof storyline !== 'object') return false;
                        if (storyline?.meta?.manualLocked === true) return true;
                        return (Array.isArray(storyline.turns) && storyline.turns.length > 0)
                            || String(storyline.currentContext || '').trim()
                            || (Array.isArray(storyline.keyPoints) && storyline.keyPoints.length > 0)
                            || (Array.isArray(storyline.ongoingTensions) && storyline.ongoingTensions.length > 0);
                    });
                }
                return removed;
            };
            const pruneWorldStatePayload = (parsed = {}) => {
                const result = filterDeletedRecords(parsed.turnLog);
                if (result.removed) parsed.turnLog = result.next;
                return result.removed;
            };
            const pruneCharStatePayload = (parsed = {}) => {
                let removed = 0;
                for (const value of Object.values(parsed || {})) {
                    if (!value || typeof value !== 'object' || !Array.isArray(value.turnLog)) continue;
                    const result = filterDeletedRecords(value.turnLog);
                    if (result.removed) {
                        value.turnLog = result.next;
                        removed += result.removed;
                    }
                }
                return removed;
            };
            const pruneVaultPayload = (parsed = {}) => {
                let removed = 0;
                const vaults = parsed.vaults && typeof parsed.vaults === 'object' ? parsed.vaults : {};
                for (const vault of Object.values(vaults)) {
                    if (!vault || typeof vault !== 'object' || !Array.isArray(vault.records)) continue;
                    const result = filterDeletedRecords(vault.records);
                    if (result.removed) {
                        vault.records = result.next;
                        removed += result.removed;
                    }
                }
                return removed;
            };
            const pruneSecretPayload = (parsed = {}) => {
                let removed = 0;
                if (!Array.isArray(parsed.secrets)) return 0;
                parsed.secrets = parsed.secrets.map(secret => {
                    if (!secret || typeof secret !== 'object') return secret;
                    const result = filterDeletedRecords(secret.evidenceLog);
                    if (result.removed) {
                        secret.evidenceLog = result.next;
                        removed += result.removed;
                    }
                    return secret;
                });
                return removed;
            };
            const pruneTimePayload = (value) => {
                if (Array.isArray(value)) {
                    let removed = 0;
                    const next = [];
                    for (const item of value) {
                        if (recordMatchesDeletedCommit(item)) {
                            removed += 1;
                            continue;
                        }
                        const result = pruneTimePayload(item);
                        next.push(result.value);
                        removed += result.removed;
                    }
                    return { value: next, removed };
                }
                if (!value || typeof value !== 'object') return { value, removed: 0 };
                let removed = 0;
                const out = {};
                for (const [key, child] of Object.entries(value)) {
                    const result = pruneTimePayload(child);
                    out[key] = result.value;
                    removed += result.removed;
                }
                return { value: out, removed };
            };

            for (const entry of Array.isArray(lorebook) ? lorebook : []) {
                const comment = String(entry?.comment || '').trim();
                if (!comment || !String(comment).startsWith('lmai_')) continue;
                if (comment === COMMENT || comment === SNAPSHOT_COMMENT || comment === 'lmai_memory' || comment === 'lmai_hme_index' || comment === 'lmai_turn_records' || comment === 'lmai_debug_recent' || comment === 'lmai_character_lore_cues') continue;
                try {
                    const parsed = safeParse(entry.content, null);
                    if (!parsed || typeof parsed !== 'object') continue;
                    if (comment === 'lmai_entity') {
                        if (metaMatches(parsed.meta || {}) || candidateTurns.some(turn => Number(parsed?.meta?.updated || 0) === turn)) {
                            addDirtyMeta(parsed, 'entity');
                            touched.entities += 1;
                            entry.content = JSON.stringify(parsed, null, 2);
                        }
                        continue;
                    }
                    if (comment === 'lmai_relation') {
                        const removedEvents = pruneRelationEvents(parsed);
                        const matches = removedEvents > 0 || metaMatches(parsed.meta || {}) || candidateTurns.some(turn => Number(parsed?.meta?.updated || 0) === turn);
                        if (matches) {
                            addDirtyMeta(parsed, 'relation');
                            touched.relations += 1;
                            touched.relationEventsRemoved += removedEvents;
                            entry.content = JSON.stringify(parsed, null, 2);
                        }
                        continue;
                    }
                    if (comment === 'lmai_narrative') {
                        addNarrativeTombstones(parsed);
                        parsed.meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
                        parsed.meta.rollbackDirty = true;
                        parsed.meta.needsReanalysis = true;
                        parsed.meta.rollbackQuarantine = true;
                        parsed.meta.rollbackQuarantineMode = 'preserve_until_reanalysis';
                        parsed.meta.rollbackQuarantineAt = stamp.ts;
                        parsed.meta.rollbackDeleteCandidates = Array.isArray(parsed.meta.rollbackDeleteCandidates) ? parsed.meta.rollbackDeleteCandidates : [];
                        parsed.meta.rollbackDeleteCandidates.push({ ...stamp, kind: 'narrative' });
                        parsed.meta.rollbackDeleteCandidates = parsed.meta.rollbackDeleteCandidates.slice(-12);
                        entry.content = JSON.stringify(parsed, null, 2);
                        continue;
                    }
                    if (comment === 'lmai_entity_knowledge_vault') {
                        const pruned = pruneVaultPayload(parsed);
                        if (pruned > 0) {
                            parsed.meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
                            addDirtyMeta(parsed, 'entity_knowledge_vault');
                            touched.vaultRecordsPruned += pruned;
                            entry.content = JSON.stringify(parsed, null, 2);
                        }
                        continue;
                    }
                    if (comment === 'lmai_secret_knowledge') {
                        const pruned = pruneSecretPayload(parsed);
                        if (pruned > 0) {
                            parsed.meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
                            addDirtyMeta(parsed, 'secret_knowledge');
                            touched.secretEvidencePruned += pruned;
                            entry.content = JSON.stringify(parsed, null, 2);
                        }
                        continue;
                    }
                    if (comment === 'lmai_time_engine') {
                        const result = pruneTimePayload(parsed);
                        if (result.removed > 0) {
                            const nextParsed = result.value && typeof result.value === 'object' ? result.value : parsed;
                            nextParsed.meta = nextParsed.meta && typeof nextParsed.meta === 'object' ? nextParsed.meta : {};
                            addDirtyMeta(nextParsed, 'time_engine');
                            touched.timeRecordsPruned += result.removed;
                            entry.content = JSON.stringify(nextParsed, null, 2);
                        }
                        continue;
                    }
                    if (comment === 'lmai_world_states' || comment === 'lmai_char_states') {
                        let pruned = 0;
                        if (comment === 'lmai_world_states') pruned = pruneWorldStatePayload(parsed);
                        else if (comment === 'lmai_char_states') pruned = pruneCharStatePayload(parsed);
                        parsed.meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
                        parsed.meta.rollbackDirty = true;
                        parsed.meta.needsReanalysis = true;
                        parsed.meta.rollbackDeleteCandidates = Array.isArray(parsed.meta.rollbackDeleteCandidates) ? parsed.meta.rollbackDeleteCandidates : [];
                        parsed.meta.rollbackDeleteCandidates.push({ ...stamp, kind: comment.replace(/^lmai_/, '') });
                        parsed.meta.rollbackDeleteCandidates = parsed.meta.rollbackDeleteCandidates.slice(-12);
                        touched.stateTurnsPruned += pruned;
                        entry.content = JSON.stringify(parsed, null, 2);
                        touched.states += 1;
                        continue;
                    }
                } catch (error) {
                    recordSuppressedRuntimeError('rollback.mark_dirty_managed_entry', error, {
                        stage: 'rollback-delete-candidate',
                        scopeKey: options?.scopeKey || '',
                        comment
                    });
                }
            }
            return touched;
        };

        const scheduleColdStartAugment = (chat = null, journal = {}, details = {}) => {
            const scopeKey = String(journal?.scopeKey || normalizeScopeKey(chat, null) || 'global').trim() || 'global';
            const existing = MemoryState.rollbackJournalColdStartByScope?.get?.(scopeKey);
            const now = Date.now();
            if (existing && (now - Number(existing.scheduledAt || 0)) < 60000) return false;
            MemoryState.rollbackJournalColdStartByScope?.set?.(scopeKey, {
                scheduledAt: now,
                reason: String(details?.reason || 'rollback-long-delete-fallback').trim(),
                candidateTurns: Array.isArray(details?.candidateTurns) ? details.candidateTurns.slice(0, 20) : []
            });
            setTimeout(async () => {
                try {
                    if (!MemoryEngine?.CONFIG?.useLLM) {
                        MemoryState.rollbackJournalColdStartByScope?.set?.(scopeKey, { skippedAt: Date.now(), reason: 'llm_disabled' });
                        return;
                    }
                    if (typeof ColdStartManager?.reanalyzeRollbackDeleteCandidates === 'function') {
                        await ColdStartManager.reanalyzeRollbackDeleteCandidates({
                            reason: details?.reason || 'rollback-long-delete-fallback',
                            candidateTurns: Array.isArray(details?.candidateTurns) ? details.candidateTurns.slice(0, 30) : [],
                            mode: 'augment_existing'
                        });
                        MemoryState.rollbackJournalColdStartByScope?.set?.(scopeKey, { completedAt: Date.now(), reason: details?.reason || 'rollback-long-delete-fallback', mode: 'augment_existing' });
                    } else if (typeof ColdStartManager?.reanalyzeHistoricalConversation === 'function') {
                        await ColdStartManager.reanalyzeHistoricalConversation();
                        MemoryState.rollbackJournalColdStartByScope?.set?.(scopeKey, { completedAt: Date.now(), reason: details?.reason || 'rollback-long-delete-fallback', mode: 'fallback_full_reanalysis' });
                    }
                } catch (error) {
                    MemoryState.rollbackJournalColdStartByScope?.set?.(scopeKey, { failedAt: Date.now(), error: String(error?.message || error || 'unknown').slice(0, 240) });
                    if (MemoryEngine.CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA] Rollback fallback cold-start augment skipped/failed:', error?.message || error);
                }
            }, COLD_START_AUGMENT_DELAY_MS);
            return true;
        };

        const applyDeleteCandidateFallback = async (char = null, chat = null, currentLore = [], journal = {}, detections = [], currentFingerprint = null, options = {}) => {
            const candidates = collectDeleteCandidateCommits(journal, detections, currentFingerprint);
            if (!candidates.length) return { ok: false, cleaned: false, reason: 'no_delete_candidates' };
            const workingLore = unpackLore(currentLore).map(entry => safeClone(entry));
            const deletedTurns = new Set(candidates.map(commit => normalizeLegacyMemoryTurnAnchor(commit?.turn || 0)).filter(Boolean));
            const deletedHashes = new Set(candidates.map(commit => String(commit?.assistantHash || '').trim()).filter(Boolean));
            const deletedTurnKeys = new Set(candidates.map(commit => String(commit?.turnKey || '').trim()).filter(Boolean));
            const deletedIds = new Set(candidates.flatMap(normalizeCommitIds).filter(Boolean));
            const deletedCommitIds = candidates.map(commit => String(commit?.id || '').trim()).filter(Boolean);
            let removedMemoryCount = 0;
            let hybridRollbackResult = null;
            let changed = false;
            const useHybridRollbackTombstones = MemoryEngine?.CONFIG?.hybridRollbackRowsEnabled !== false;
            hybridRollbackResult = { ok: true, tombstonedMemoryCount: 0, rowIds: [], affectedTurns: [], affectedKinds: {}, reason: 'rollback-long-delete-candidate' };
            const makeHybridRollbackTombstoneForEntry = () => ({
                schema: 'libra.hme.rollback_tombstone.v1',
                state: 'candidate_deleted',
                reason: 'rollback-long-delete-candidate',
                ts: Date.now(),
                candidateTurns: Array.from(deletedTurns).sort((a, b) => a - b),
                candidateHashes: Array.from(deletedHashes).slice(0, 30),
                candidateTurnKeys: Array.from(deletedTurnKeys).slice(0, 30),
                candidateMessageIds: Array.from(deletedIds).slice(0, 30),
                mode: 'tombstone_preserve_row_audit'
            });
            const markMemoryEntryHybridTombstone = (entry = null, meta = {}, metaTurn = 0) => {
                if (!entry || String(entry.comment || '') !== 'lmai_memory') return false;
                const payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null;
                if (!payload || typeof payload !== 'object') return false;
                const existingHybrid = payload.hybridRow && typeof payload.hybridRow === 'object' ? payload.hybridRow : (payload.hme && typeof payload.hme === 'object' ? payload.hme : {});
                const tombstone = makeHybridRollbackTombstoneForEntry();
                const sourceTurnIds = Array.from(new Set([
                    ...(Array.isArray(existingHybrid.sourceTurnIds) ? existingHybrid.sourceTurnIds : []),
                    Number(metaTurn || meta.t || payload.turn || 0)
                ].map(Number).filter(Boolean))).slice(0, 16);
                const nextHybrid = {
                    ...existingHybrid,
                    schema: existingHybrid.schema || 'libra.hme.typed_row_meta.v1',
                    engineVersion: existingHybrid.engineVersion || 'libra_world_hybrid_rollback_rows_v1_20260617',
                    kind: existingHybrid.kind || existingHybrid.primaryKind || 'memory',
                    kinds: Array.isArray(existingHybrid.kinds) && existingHybrid.kinds.length ? existingHybrid.kinds : ['memory'],
                    sourceTurnIds,
                    rollbackState: 'candidate_deleted',
                    rollbackTombstone: tombstone,
                    rollbackHistory: [...(Array.isArray(existingHybrid.rollbackHistory) ? existingHybrid.rollbackHistory : []), tombstone].slice(-12),
                    hiddenFromPrompt: true,
                    stale: true,
                    staleReason: 'rollback_candidate_deleted'
                };
                const nextMeta = { ...meta };
                let nextPayload = payload;
                if (CompactMemoryCodec.isLedgerPayload?.(payload)) {
                    nextPayload = {
                        ...payload,
                        audit: {
                            ...(payload.audit && typeof payload.audit === 'object' ? payload.audit : {}),
                            rollbackState: 'candidate_deleted',
                            rollbackTombstone: tombstone,
                            stale: true,
                            staleReason: 'rollback_candidate_deleted',
                            cautions: dedupeTextArray([
                                ...((Array.isArray(payload?.audit?.cautions) ? payload.audit.cautions : [])),
                                'rollback_candidate_deleted'
                            ]).slice(0, 12)
                        }
                    };
                    nextMeta.projection = {
                        ...(nextMeta.projection && typeof nextMeta.projection === 'object' ? nextMeta.projection : {}),
                        sourceTurnIds,
                        rollbackState: 'candidate_deleted',
                        hiddenFromPrompt: true,
                        stale: true,
                        staleReason: 'rollback_candidate_deleted'
                    };
                } else {
                    nextMeta.hme = nextMeta.hme && typeof nextMeta.hme === 'object' ? nextMeta.hme : {};
                    nextMeta.hme = {
                        ...nextMeta.hme,
                        schema: nextHybrid.schema,
                        engineVersion: nextHybrid.engineVersion,
                        kind: nextHybrid.kind,
                        kinds: nextHybrid.kinds,
                        sourceTurnIds,
                        rollbackState: 'candidate_deleted',
                        rollbackTombstone: tombstone,
                        hiddenFromPrompt: true,
                        stale: true,
                        staleReason: 'rollback_candidate_deleted'
                    };
                    nextPayload = { ...payload, hybridRow: nextHybrid };
                }
                nextMeta.rollbackDirty = true;
                nextMeta.needsReanalysis = true;
                nextMeta.rollbackDeleted = true;
                nextMeta.rollbackTombstone = tombstone;
                nextMeta.rollbackDeleteCandidates = Array.isArray(nextMeta.rollbackDeleteCandidates) ? nextMeta.rollbackDeleteCandidates : [];
                nextMeta.rollbackDeleteCandidates.push({ ...tombstone, kind: 'hybrid_memory_row' });
                nextMeta.rollbackDeleteCandidates = nextMeta.rollbackDeleteCandidates.slice(-12);
                entry.content = `[META:${JSON.stringify(nextMeta)}]\n${CompactMemoryCodec.serialize(nextPayload)}\n`;
                hybridRollbackResult.tombstonedMemoryCount += 1;
                hybridRollbackResult.rowIds.push(String(nextHybrid.id || entry.key || stableHash(entry.content || nextHybrid.content || '') || '').trim());
                sourceTurnIds.forEach(turn => { if (turn) hybridRollbackResult.affectedTurns.push(turn); });
                const kind = String(nextHybrid.kind || 'memory').trim() || 'memory';
                hybridRollbackResult.affectedKinds[kind] = (hybridRollbackResult.affectedKinds[kind] || 0) + 1;
                removedMemoryCount += 1;
                return true;
            };

            for (const commit of candidates) {
                try {
                    if (TurnRecordLedger.markDeleted(workingLore, {
                        turn: commit.turn,
                        finalizedTurn: commit.turn,
                        turnAnchorTurn: commit.turn,
                        sourceHash: commit.assistantHash,
                        aiHash: commit.assistantHash,
                        responseHash: commit.assistantHash,
                        turnKey: commit.turnKey,
                        userTurnKey: commit.userTurnKey,
                        messageId: commit.messageId,
                        liveMessageIds: commit.liveMessageIds,
                        sourceMessageIds: commit.liveMessageIds,
                        reason: 'rollback-long-delete-candidate'
                    }, chat, char, { status: 'deleted' })) changed = true;
                } catch (error) {
                    recordSuppressedRuntimeError('rollback.delete_fallback.turn_record_mark_deleted', error, {
                        scopeKey: journal?.scopeKey || getChatRuntimeScopeKey(chat, char),
                        turn: commit?.turn || 0,
                        commitId: commit?.id || ''
                    });
                }
            }

            for (let i = workingLore.length - 1; i >= 0; i -= 1) {
                const entry = workingLore[i];
                if (String(entry?.comment || '') !== 'lmai_memory') continue;
                const meta = extractEntryMeta(entry);
                const metaTurn = normalizeLegacyMemoryTurnAnchor(meta.turn || meta.t || meta.finalizedTurn || meta.turnAnchorTurn || 0);
                const metaHash = String(meta.sourceHash || meta.aiHash || meta.responseHash || '').trim();
                const metaTurnKey = String(meta.turnKey || '').trim();
                const metaIds = new Set(normalizeCanonicalMessageIds([meta.m_id, meta.m_ids, meta.messageId, meta.sourceMessageIds, meta.liveMessageIds]));
                const matchesId = Array.from(metaIds).some(id => deletedIds.has(id));
                if (deletedTurns.has(metaTurn) || (metaHash && deletedHashes.has(metaHash)) || (metaTurnKey && deletedTurnKeys.has(metaTurnKey)) || matchesId) {
                    if (useHybridRollbackTombstones && markMemoryEntryHybridTombstone(entry, meta, metaTurn)) {
                        // HME rollback-aware mode preserves the row as an audit tombstone;
                        // read-path filters it out, and cold-start augment can merge against it.
                        changed = true;
                    } else {
                        workingLore.splice(i, 1);
                        removedMemoryCount += 1;
                        changed = true;
                    }
                }
            }

            let rpLongTermRollbackResult = null;
            try {
                rpLongTermRollbackResult = RPContinuityCore.pruneRollbackTurns(workingLore, Array.from(deletedTurns), {
                    reason: 'rollback-long-delete-candidate'
                });
                if (rpLongTermRollbackResult?.changed) changed = true;
            } catch (error) {
                recordSuppressedRuntimeError('rollback.delete_fallback.rp_longterm_prune', error, {
                    scopeKey: journal?.scopeKey || getChatRuntimeScopeKey(chat, char),
                    deletedTurns: Array.from(deletedTurns).slice(0, 40)
                });
            }

            // Preserve narrative source state until rollback reanalysis succeeds; prompt projection hides dirty refs.
            const dirtyMarkResult = markRollbackDirtyManagedEntries(workingLore, deletedTurns, deletedHashes, deletedTurnKeys, deletedIds, {
                reason: 'rollback-long-delete-candidate'
            });
            if (dirtyMarkResult && Object.values(dirtyMarkResult).some(value => Number(value || 0) > 0)) changed = true;
            if (hybridRollbackResult) {
                hybridRollbackResult.rowIds = Array.from(new Set((hybridRollbackResult.rowIds || []).filter(Boolean))).slice(0, 80);
                hybridRollbackResult.affectedTurns = Array.from(new Set((hybridRollbackResult.affectedTurns || []).map(Number).filter(Boolean))).sort((a, b) => a - b).slice(0, 80);
            }
            const fallbackId = `rbj_delete_fallback_${stableHash(journal.scopeKey || '')}_${Date.now()}`;
            journal.entries.push({
                id: fallbackId,
                kind: 'delete_candidate_fallback',
                commitState: 'delete_candidates_cleaned',
                ts: Date.now(),
                reason: String(options?.reason || 'rollback-too-deep-or-snapshot-unavailable').trim(),
                detections: Array.isArray(detections) ? detections.slice(0, 8) : [],
                candidateCommitIds: deletedCommitIds.slice(0, 30),
                candidateTurns: Array.from(deletedTurns).sort((a, b) => a - b),
                candidateHashes: Array.from(deletedHashes).slice(0, 30),
                removedMemoryCount,
                hybridRollbackRows: useHybridRollbackTombstones ? {
                    mode: 'tombstone_preserve_row_audit',
                    tombstonedMemoryCount: Number(hybridRollbackResult?.tombstonedMemoryCount || 0),
                    affectedTurns: hybridRollbackResult?.affectedTurns || [],
                    affectedKinds: hybridRollbackResult?.affectedKinds || {},
                    rowIds: (hybridRollbackResult?.rowIds || []).slice(0, 24)
                } : { mode: 'legacy_hard_delete' },
                dirtyMarkResult,
                rpLongTermRollback: rpLongTermRollbackResult ? {
                    changed: rpLongTermRollbackResult.changed === true,
                    removed: Number(rpLongTermRollbackResult.removed || 0),
                    reverted: Number(rpLongTermRollbackResult.reverted || 0),
                    prunedEvidence: Number(rpLongTermRollbackResult.prunedEvidence || 0),
                    touchedCategories: rpLongTermRollbackResult.touchedCategories || {}
                } : null,
                coldStartAugment: 'scheduled',
                coldStartAugmentMode: 'augment_existing',
                fastPath: true,
                promptAssemblySkipped: true,
                note: `Rollback exceeded the latest ${RECENT_ROLLBACK_TURN_LIMIT} turns or lacked a compatible recent snapshot; deleted turns were marked and cleaned, then cold-start reanalysis will augment existing LIBRA data.`
            });
            journal.lastRestoreId = fallbackId;
            journal.lastChatFingerprint = currentFingerprint || buildChatFingerprint(chat);
            journal.lastBaselineId = '';
            upsertJournalEntry(workingLore, journal);
            pruneSnapshotEntries(workingLore, journal.scopeHash, '');
            try { MemoryEngine.ensureHybridScopeIndex?.(workingLore, { scopeKey: journal.scopeKey || getChatRuntimeScopeKey(chat, char), currentTurn: deriveRuntimeTurnFromLorebook(workingLore), force: true, reason: 'rollback-delete-fallback' }); } catch (error) {
                recordSuppressedRuntimeError('rollback.delete_fallback.ensure_hybrid_scope_index', error, {
                    scopeKey: journal.scopeKey || getChatRuntimeScopeKey(chat, char),
                    stage: 'rollback-delete-fallback'
                });
            }
            rebuildRuntimeAfterRestore(char, chat, workingLore, { turn: deriveRuntimeTurnFromLorebook(workingLore) });
            await persistLoreToActiveChat(chat, workingLore, { reason: 'rollback-journal-stage4-delete-candidate-fallback' });
            scheduleColdStartAugment(chat, journal, { reason: 'rollback-long-delete-fallback', candidateTurns: Array.from(deletedTurns), hybridRollbackRows: hybridRollbackResult || null });
            return { ok: true, cleaned: changed, mode: 'delete_candidate_fallback', fastPath: true, fallbackId, deletedTurns: Array.from(deletedTurns).sort((a, b) => a - b), removedMemoryCount, hybridRollbackRows: hybridRollbackResult || null, rpLongTermRollback: rpLongTermRollbackResult || null, lorebook: workingLore, journal };
        };


        const augmentFingerprintWithAssistantCommit = (fingerprint = null, assistantHash = '', meta = {}) => {
            const hash = String(assistantHash || '').trim();
            if (!fingerprint || !hash) return fingerprint;
            const next = safeClone(fingerprint);
            const assistantHashes = new Set(Array.isArray(next.assistantHashes) ? next.assistantHashes : []);
            const commitHashes = new Set(Array.isArray(next.commitHashes) ? next.commitHashes : []);
            const hadAssistant = assistantHashes.has(hash);
            assistantHashes.add(hash);
            commitHashes.add(hash);
            next.assistantHashes = Array.from(assistantHashes);
            next.commitHashes = Array.from(commitHashes);
            next.lastAssistantHash = hash;
            if (meta?.messageSignature) next.lastAssistantSignatureHash = hashText(meta.messageSignature);
            if (!hadAssistant) {
                next.assistantCount = Math.max(Number(next.assistantCount || 0), (Array.isArray(fingerprint.assistantHashes) ? fingerprint.assistantHashes.length : 0) + 1);
            }
            next.commitAugmented = true;
            next.commitAugmentedAt = Date.now();
            next.fingerprintHash = hashText([
                next.fingerprintHash || '',
                'assistantCommit',
                hash,
                next.lastUserHash || '',
                next.count || 0
            ].join('|'));
            return next;
        };

        const isSupersedableUserTurnKey = (value = '') => {
            const key = String(value || '').trim();
            return !!key && key !== '[auto-continue]' && key !== 'auto-continue';
        };

        const collectSupersededUserTurnCommits = (journal = {}, incoming = {}) => {
            const userTurnKey = String(incoming?.userTurnKey || '').trim();
            if (!isSupersedableUserTurnKey(userTurnKey)) return [];
            const incomingHash = String(incoming?.assistantHash || '').trim();
            const incomingTurnKey = String(incoming?.turnKey || '').trim();
            const incomingIds = normalizeCanonicalMessageIds(incoming?.liveMessageIds || incoming?.sourceMessageIds || incoming?.messageId || incoming?.m_id);
            const add = (entry = null, map = new Map()) => {
                if (!entry || entry.kind !== 'assistant_commit' || entry.commitState !== 'assistant_committed') return map;
                if (String(entry.userTurnKey || '').trim() !== userTurnKey) return map;
                const hash = String(entry.assistantHash || '').trim();
                const turnKey = String(entry.turnKey || '').trim();
                if (incomingHash && hash && hash === incomingHash) return map;
                if (incomingTurnKey && turnKey && turnKey === incomingTurnKey) return map;
                if (hasCanonicalMessageIdOverlap(incomingIds, entry.liveMessageIds || entry.sourceMessageIds || entry.messageId || entry.m_id)) return map;
                const id = String(entry.id || '').trim();
                const key = id || [entry.turn || 0, hash, turnKey, entry.committedAt || 0].join('|');
                if (!key) return map;
                map.set(key, { ...(map.get(key) || {}), ...entry, id, assistantHash: hash, turnKey });
                return map;
            };
            const merged = new Map();
            (Array.isArray(journal.entries) ? journal.entries : []).forEach(entry => add(entry, merged));
            (Array.isArray(journal.commitLog) ? journal.commitLog : []).forEach(entry => add(entry, merged));
            return Array.from(merged.values())
                .filter(entry => String(entry?.assistantHash || entry?.turnKey || entry?.id || '').trim())
                .sort((a, b) => Number(a?.committedAt || a?.ts || 0) - Number(b?.committedAt || b?.ts || 0));
        };

        const markMemoryEntrySuperseded = (entry = null, meta = {}, supersedeStamp = {}, replacement = {}) => {
            if (!entry || String(entry?.comment || '') !== 'lmai_memory') return false;
            const split = splitManagedMemoryMetaPrefix(entry.content || '');
            const nextMeta = {
                ...meta,
                rollbackState: 'superseded',
                rollbackDirty: true,
                needsReanalysis: true,
                hiddenFromPrompt: true,
                stale: true,
                staleReason: 'same_user_turn_superseded',
                supersededBy: String(replacement?.id || '').trim(),
                supersededByHash: String(replacement?.assistantHash || '').trim(),
                supersededByTurnKey: String(replacement?.turnKey || '').trim(),
                rollbackSuperseded: supersedeStamp
            };
            nextMeta.hme = nextMeta.hme && typeof nextMeta.hme === 'object' ? nextMeta.hme : {};
            nextMeta.hme = {
                ...nextMeta.hme,
                rollbackState: 'superseded',
                hiddenFromPrompt: true,
                stale: true,
                staleReason: 'same_user_turn_superseded',
                supersededBy: String(replacement?.id || '').trim(),
                supersededByHash: String(replacement?.assistantHash || '').trim(),
                supersededByTurnKey: String(replacement?.turnKey || '').trim()
            };
            let payload = null;
            try { payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null; } catch (_) { payload = null; }
            if (payload && typeof payload === 'object') {
                const existingHybrid = payload.hybridRow && typeof payload.hybridRow === 'object'
                    ? payload.hybridRow
                    : (payload.hme && typeof payload.hme === 'object' ? payload.hme : {});
                const nextHybrid = {
                    ...existingHybrid,
                    schema: existingHybrid.schema || 'libra.hme.typed_row_meta.v1',
                    engineVersion: existingHybrid.engineVersion || 'libra_world_hybrid_rollback_rows_v1_20260617',
                    rollbackState: 'superseded',
                    rollbackSuperseded: supersedeStamp,
                    hiddenFromPrompt: true,
                    stale: true,
                    staleReason: 'same_user_turn_superseded',
                    supersededBy: String(replacement?.id || '').trim(),
                    supersededByHash: String(replacement?.assistantHash || '').trim(),
                    supersededByTurnKey: String(replacement?.turnKey || '').trim()
                };
                if (CompactMemoryCodec.isLedgerPayload?.(payload)) {
                    payload = {
                        ...payload,
                        audit: {
                            ...(payload.audit && typeof payload.audit === 'object' ? payload.audit : {}),
                            rollbackState: 'superseded',
                            rollbackSuperseded: supersedeStamp,
                            hiddenFromPrompt: true,
                            stale: true,
                            staleReason: 'same_user_turn_superseded',
                            supersededBy: String(replacement?.id || '').trim(),
                            cautions: dedupeTextArray([
                                ...((Array.isArray(payload?.audit?.cautions) ? payload.audit.cautions : [])),
                                'same_user_turn_superseded'
                            ]).slice(0, 12)
                        }
                    };
                } else {
                    payload = { ...payload, hybridRow: nextHybrid };
                }
                entry.content = `[META:${JSON.stringify(nextMeta)}]\n${CompactMemoryCodec.serialize(payload)}\n`;
                return true;
            }
            entry.content = `[META:${JSON.stringify(nextMeta)}]\n${split.body || ''}`.trim();
            return true;
        };

        const supersedePreviousUserTurnCommits = (lorebook = [], journal = {}, incoming = {}, chat = null, char = null) => {
            const candidates = collectSupersededUserTurnCommits(journal, incoming);
            if (!candidates.length) return null;
            const supersededHashes = new Set(candidates.map(commit => String(commit?.assistantHash || '').trim()).filter(Boolean));
            const supersededTurnKeys = new Set(candidates.map(commit => String(commit?.turnKey || '').trim()).filter(Boolean));
            const supersededIds = new Set(candidates.flatMap(normalizeCommitIds).filter(Boolean));
            const supersededTurns = new Set(candidates.map(commit => normalizeLegacyMemoryTurnAnchor(commit?.turn || 0)).filter(Boolean));
            const replacementHash = String(incoming?.assistantHash || '').trim();
            const replacementTurnKey = String(incoming?.turnKey || '').trim();
            const replacementIds = normalizeCanonicalMessageIds(incoming?.liveMessageIds || incoming?.sourceMessageIds || incoming?.messageId || incoming?.m_id);
            const stamp = {
                schema: 'libra.rollback.same_user_turn_supersede.v1',
                state: 'superseded',
                reason: 'same-user-turn-replaced',
                ts: Date.now(),
                userTurnKey: String(incoming?.userTurnKey || '').trim(),
                replacementCommitId: String(incoming?.id || '').trim(),
                replacementHash,
                replacementTurn: normalizeLegacyMemoryTurnAnchor(incoming?.turn || 0),
                replacementTurnKey,
                supersededCommitIds: candidates.map(commit => String(commit?.id || '').trim()).filter(Boolean).slice(0, 24),
                supersededHashes: Array.from(supersededHashes).slice(0, 24),
                supersededTurnKeys: Array.from(supersededTurnKeys).slice(0, 24),
                supersededTurns: Array.from(supersededTurns).sort((a, b) => a - b)
            };
            let memorySupersededCount = 0;
            for (const entry of lorebook) {
                if (String(entry?.comment || '') !== 'lmai_memory') continue;
                const meta = extractEntryMeta(entry);
                const metaUserTurnKey = String(meta?.userTurnKey || '').trim();
                if (metaUserTurnKey !== stamp.userTurnKey) continue;
                const metaHash = String(meta?.sourceHash || meta?.aiHash || meta?.responseHash || '').trim();
                const metaTurnKey = String(meta?.turnKey || '').trim();
                const metaIds = normalizeCanonicalMessageIds([meta?.m_id, meta?.m_ids, meta?.messageId, meta?.sourceMessageIds, meta?.liveMessageIds]);
                if ((replacementHash && metaHash === replacementHash) || (replacementTurnKey && metaTurnKey === replacementTurnKey) || hasCanonicalMessageIdOverlap(metaIds, replacementIds)) continue;
                const matchesSuperseded = (metaHash && supersededHashes.has(metaHash))
                    || (metaTurnKey && supersededTurnKeys.has(metaTurnKey))
                    || hasCanonicalMessageIdOverlap(metaIds, Array.from(supersededIds));
                if (!matchesSuperseded) continue;
                if (markMemoryEntrySuperseded(entry, meta, stamp, incoming)) memorySupersededCount += 1;
            }
            const markCommit = (entry = null) => {
                if (!entry || entry.kind !== 'assistant_commit' || entry.commitState !== 'assistant_committed') return false;
                const hash = String(entry.assistantHash || '').trim();
                const turnKey = String(entry.turnKey || '').trim();
                const id = String(entry.id || '').trim();
                const matches = (id && stamp.supersededCommitIds.includes(id))
                    || (hash && supersededHashes.has(hash))
                    || (turnKey && supersededTurnKeys.has(turnKey));
                if (!matches) return false;
                entry.commitState = 'assistant_superseded';
                entry.supersededAt = stamp.ts;
                entry.supersededBy = stamp.replacementCommitId;
                entry.supersededByHash = replacementHash;
                entry.supersededByTurnKey = replacementTurnKey;
                entry.supersedeReason = stamp.reason;
                return true;
            };
            let journalSupersededCount = 0;
            (Array.isArray(journal.entries) ? journal.entries : []).forEach(entry => { if (markCommit(entry)) journalSupersededCount += 1; });
            (Array.isArray(journal.commitLog) ? journal.commitLog : []).forEach(markCommit);
            let turnRecordSupersededCount = 0;
            try {
                for (const commit of candidates) {
                    if (TurnRecordLedger.markSuperseded(lorebook, {
                        turn: commit.turn,
                        finalizedTurn: commit.turn,
                        turnAnchorTurn: commit.turn,
                        sourceHash: commit.assistantHash,
                        aiHash: commit.assistantHash,
                        turnKey: commit.turnKey,
                        userTurnKey: commit.userTurnKey,
                        messageId: commit.messageId,
                        liveMessageIds: commit.liveMessageIds,
                        sourceMessageIds: commit.liveMessageIds,
                        supersededBy: stamp.replacementCommitId,
                        supersededByHash: replacementHash,
                        supersededByTurnKey: replacementTurnKey,
                        reason: stamp.reason
                    }, chat, char)) turnRecordSupersededCount += 1;
                }
            } catch (error) {
                recordSuppressedRuntimeError('rollback.same_user_turn_supersede.turn_records', error, {
                    scopeKey: journal?.scopeKey || normalizeScopeKey(chat, char),
                    userTurnKey: stamp.userTurnKey
                });
            }
            journal.entries.push({
                id: `rbj_supersede_${stableHash(journal.scopeKey || stamp.userTurnKey)}_${Date.now()}`,
                kind: 'same_user_turn_supersede',
                commitState: 'assistant_superseded',
                ts: stamp.ts,
                reason: stamp.reason,
                userTurnKey: stamp.userTurnKey,
                replacementCommitId: stamp.replacementCommitId,
                replacementHash,
                replacementTurn: stamp.replacementTurn,
                supersededCommitIds: stamp.supersededCommitIds,
                supersededTurns: stamp.supersededTurns,
                supersededHashes: stamp.supersededHashes,
                memorySupersededCount,
                journalSupersededCount,
                turnRecordSupersededCount
            });
            try {
                MemoryEngine.ensureHybridScopeIndex?.(lorebook, {
                    scopeKey: journal?.scopeKey || getChatRuntimeScopeKey(chat, char),
                    currentTurn: deriveRuntimeTurnFromLorebook(lorebook),
                    force: true,
                    reason: 'same-user-turn-supersede'
                });
            } catch (error) {
                recordSuppressedRuntimeError('rollback.same_user_turn_supersede.ensure_hybrid_scope_index', error, {
                    scopeKey: journal?.scopeKey || normalizeScopeKey(chat, char),
                    userTurnKey: stamp.userTurnKey
                });
            }
            return {
                ok: true,
                candidates: candidates.length,
                memorySupersededCount,
                journalSupersededCount,
                turnRecordSupersededCount,
                stamp
            };
        };

        const supersedeDuplicateUserTurnCommitGroups = (lorebook = [], journal = {}, chat = null, char = null, options = {}) => {
            const active = collectAssistantCommitsWithRestoreRefs(journal)
                .filter(commit => commit?.commitState === 'assistant_committed' && isSupersedableUserTurnKey(commit?.userTurnKey));
            if (active.length < 2) return null;
            const protectedCommitId = String(options?.protectedCommitId || '').trim();
            const groups = new Map();
            for (const commit of active) {
                const userTurnKey = String(commit?.userTurnKey || '').trim();
                if (!groups.has(userTurnKey)) groups.set(userTurnKey, []);
                groups.get(userTurnKey).push(commit);
            }
            const repairs = [];
            for (const commits of groups.values()) {
                if (commits.length < 2) continue;
                const sorted = commits.slice().sort((a, b) => {
                    const timeDelta = Number(a?.committedAt || a?.ts || 0) - Number(b?.committedAt || b?.ts || 0);
                    if (timeDelta) return timeDelta;
                    return normalizeLegacyMemoryTurnAnchor(a?.turn || 0) - normalizeLegacyMemoryTurnAnchor(b?.turn || 0);
                });
                const protectedCommit = protectedCommitId
                    ? sorted.find(commit => String(commit?.id || '').trim() === protectedCommitId)
                    : null;
                const keeper = protectedCommit || sorted[sorted.length - 1];
                const result = supersedePreviousUserTurnCommits(lorebook, journal, keeper, chat, char);
                if (result?.ok) repairs.push(result);
            }
            if (!repairs.length) return null;
            return {
                ok: true,
                groups: repairs.length,
                candidates: repairs.reduce((sum, item) => sum + Number(item?.candidates || 0), 0),
                memorySupersededCount: repairs.reduce((sum, item) => sum + Number(item?.memorySupersededCount || 0), 0),
                turnRecordSupersededCount: repairs.reduce((sum, item) => sum + Number(item?.turnRecordSupersededCount || 0), 0)
            };
        };

        const chooseRestoreTarget = (journal = {}, lorebook = [], detections = []) => {
            const missingHashes = collectMissingAssistantHashes(detections);
            const commits = collectAssistantCommitsWithRestoreRefs(journal);
            let commit = null;
            if (missingHashes.length) {
                commit = commits.find(item => item?.assistantHash && missingHashes.includes(String(item.assistantHash))) || null;
            }
            if (!commit && detections.some(item => String(item?.reason || '').includes('decreased') || String(item?.reason || '').includes('missing'))) {
                commit = commits[0] || null;
            }
            if (!commit) return { ok: false, reason: 'no_committed_assistant_target', missingHashes };
            return resolveSnapshotForCommit(journal, lorebook, commit, missingHashes);
        };

        const rebuildRuntimeAfterRestore = (char = null, chat = null, restoredLore = [], options = {}) => {
            const scopeKey = normalizeScopeKey(chat, char);
            const chatId = String(chat?.id || getActiveManagedChatId() || '').trim();
            try { MemoryEngine.setLorebook(char, chat, restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.set_lorebook', error, { scopeKey, chatId });
            }
            try { MemoryEngine.rebuildIndex(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.rebuild_index', error, { scopeKey, chatId });
            }
            try {
                SecretKnowledgeCore.loadState(restoredLore, {
                    scopeKey,
                    chatId
                });
            } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.secret_knowledge', error, { scopeKey, chatId });
            }
            try {
                EntityKnowledgeVaultCore.loadState(restoredLore, {
                    scopeKey,
                    chatId
                });
            } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.entity_knowledge', error, { scopeKey, chatId });
            }
            try {
                TimeEngine.loadState(restoredLore, {
                    scopeKey,
                    chatId
                });
            } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.time_engine', error, { scopeKey, chatId });
            }
            try { HierarchicalWorldManager.loadWorldGraph(restoredLore, true); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.world_graph', error, { scopeKey, chatId });
            }
            try { EntityManager.rebuildCache(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.entity_cache', error, { scopeKey, chatId });
            }
            try { NarrativeTracker.loadState(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.narrative_state', error, { scopeKey, chatId });
            }
            try { StoryAuthor.loadState(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.story_author', error, { scopeKey, chatId });
            }
            try { Director.loadState(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.director', error, { scopeKey, chatId });
            }
            try { CharacterStateTracker.loadState(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.character_state', error, { scopeKey, chatId });
            }
            try { WorldStateTracker.loadState(restoredLore); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.world_state', error, { scopeKey, chatId });
            }
            try { SectionWorldInferenceManager.loadState?.(null); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.section_world', error, { scopeKey, chatId });
            }
            const restoredTurn = Math.max(
                normalizeLegacyMemoryTurnAnchor(options?.turn || 0),
                deriveRuntimeTurnFromLorebook(restoredLore)
            );
            try { MemoryEngine.setTurn(restoredTurn); } catch (error) {
                recordSuppressedRuntimeError('restore.rebuild_runtime.set_turn', error, { scopeKey, chatId, turn: restoredTurn });
            }
            return restoredTurn;
        };

        const getSnapshotStoredManagedEntries = (snapshot = null) => {
            if (Array.isArray(snapshot?.managedLoreEntries)) {
                return { mode: 'legacy_full', entries: snapshot.managedLoreEntries.map(entry => safeClone(entry)) };
            }
            if (Array.isArray(snapshot?.aggregateManagedEntries)) {
                return { mode: SNAPSHOT_RESTORE_MODE, entries: snapshot.aggregateManagedEntries.map(entry => safeClone(entry)) };
            }
            return { mode: 'invalid', entries: [] };
        };

        const shouldKeepMemoryForSnapshotRestore = (entry = null, snapshot = null, restoreTarget = {}, detections = []) => {
            if (String(entry?.comment || '') !== 'lmai_memory') return false;
            const snapshotTurn = normalizeLegacyMemoryTurnAnchor(snapshot?.turn || snapshot?.memoryRestorePolicy?.snapshotTurn || 0);
            const meta = extractEntryMeta(entry);
            const metaTurn = normalizeLegacyMemoryTurnAnchor(meta.turn || meta.t || meta.finalizedTurn || meta.turnAnchorTurn || 0);
            const metaHash = String(meta.sourceHash || meta.aiHash || meta.responseHash || '').trim();
            const metaTurnKey = String(meta.turnKey || '').trim();
            const metaIds = new Set(normalizeCanonicalMessageIds([meta.m_id, meta.m_ids, meta.messageId, meta.sourceMessageIds, meta.liveMessageIds]));
            const missingHashes = new Set(collectMissingAssistantHashes(detections));
            const targetCommit = restoreTarget?.commit || {};
            const deletedHashes = new Set([String(targetCommit?.assistantHash || '').trim(), ...Array.from(missingHashes)].filter(Boolean));
            const deletedTurns = new Set([normalizeLegacyMemoryTurnAnchor(targetCommit?.turn || 0)].filter(Boolean));
            const deletedTurnKeys = new Set([String(targetCommit?.turnKey || '').trim()].filter(Boolean));
            const deletedIds = new Set(normalizeCommitIds(targetCommit));
            const matchesDeletedId = Array.from(metaIds).some(id => deletedIds.has(id));
            if (metaHash && deletedHashes.has(metaHash)) return false;
            if (metaTurnKey && deletedTurnKeys.has(metaTurnKey)) return false;
            if (matchesDeletedId) return false;
            if (metaTurn && deletedTurns.has(metaTurn)) return false;
            if (snapshotTurn > 0 && metaTurn > snapshotTurn) return false;
            return true;
        };

        const restorePersistentSnapshot = async (char = null, chat = null, currentLore = [], journal = {}, restoreTarget = {}, options = {}) => {
            const snapshot = restoreTarget?.snapshot;
            const snapshotEntries = getSnapshotStoredManagedEntries(snapshot);
            const compactMode = snapshotEntries.mode === SNAPSHOT_RESTORE_MODE || Array.isArray(snapshot?.aggregateManagedEntries);
            if (!snapshot || (!compactMode && !snapshotEntries.entries.length)) {
                return { ok: false, restored: false, reason: 'invalid_snapshot' };
            }
            const unpackedCurrent = unpackLore(currentLore);
            const externalEntries = unpackedCurrent.filter(entry => !isManagedLibraEntry(entry));
            const rollbackSnapshotEntries = unpackedCurrent.filter(isRollbackSnapshotEntry);
            const retainedMemoryEntries = compactMode
                ? unpackedCurrent
                    .filter(entry => shouldKeepMemoryForSnapshotRestore(entry, snapshot, restoreTarget, options?.detections || []))
                    .map(entry => safeClone(entry))
                : [];
            const restoredManaged = compactMode
                ? [...retainedMemoryEntries, ...snapshotEntries.entries]
                : snapshotEntries.entries;
            const restoredLore = [
                ...externalEntries.map(entry => safeClone(entry)),
                ...restoredManaged.map(entry => safeClone(entry)),
                ...rollbackSnapshotEntries.map(entry => safeClone(entry))
            ];
            const restoreId = `rbj_restore_${stableHash(journal.scopeKey || '')}_${Date.now()}`;
            const currentFingerprint = options?.currentFingerprint || buildChatFingerprint(chat);
            journal.entries.push({
                id: restoreId,
                kind: 'snapshot_restore',
                commitState: 'restored',
                restoredAt: Date.now(),
                baselineId: restoreTarget.baselineId || restoreTarget.baseline?.id || '',
                commitId: restoreTarget.commit?.id || '',
                snapshotId: snapshot.snapshotId,
                snapshotRestoreMode: snapshotEntries.mode,
                restoredTurn: normalizeLegacyMemoryTurnAnchor(snapshot.turn || 0),
                detections: Array.isArray(options?.detections) ? options.detections.slice(0, 8) : [],
                currentFingerprintHash: currentFingerprint?.fingerprintHash || '',
                managedLoreEntryCount: restoredManaged.length,
                retainedMemoryEntryCount: retainedMemoryEntries.length,
                aggregateManagedEntryCount: snapshotEntries.entries.length,
                reason: String(options?.reason || 'rollback-journal-stage4-snapshot-restore').trim() || 'rollback-journal-stage4-snapshot-restore'
            });
            journal.lastRestoreId = restoreId;
            journal.lastChatFingerprint = currentFingerprint;
            journal.lastBaselineId = '';
            upsertJournalEntry(restoredLore, journal);
            pruneSnapshotEntries(restoredLore, journal.scopeHash, snapshot.snapshotId);
            const maxTurn = rebuildRuntimeAfterRestore(char, chat, restoredLore, { turn: snapshot.turn || 0 });
            try {
                const chatIdForRestore = String(chat?.id || journal?.chatId || '').trim();
                if (chatIdForRestore) MemoryState.rollbackJournalRestoredTurnByChatId?.set?.(chatIdForRestore, maxTurn);
                if (chat && typeof chat === 'object') chat.__libraRollbackRestoredTurn = maxTurn;
            } catch (error) {
                recordSuppressedRuntimeError('rollback.snapshot_restore.record_restored_turn', error, {
                    scopeKey: journal?.scopeKey || normalizeScopeKey(chat, char),
                    chatId: String(chat?.id || journal?.chatId || '').trim(),
                    turn: maxTurn
                });
            }
            await persistLoreToActiveChat(chat, restoredLore, { reason: 'rollback-journal-stage5-compact-snapshot-restore' });
            MemoryState.rollbackJournalBaselineByScope.delete(journal.scopeKey || '');
            MemoryState.commitRevisionByScope.set(journal.scopeKey || normalizeScopeKey(chat, char), {
                revision: Number(MemoryState.commitRevisionByScope.get(journal.scopeKey || '')?.revision || 0) + 1,
                hash: buildManagedLoreDigest(restoredLore).hash,
                updatedAt: Date.now(),
                lastCommitId: restoreId
            });
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('warn', '[LIBRA] Rollback journal restored compact managed-lore snapshot', {
                    __libraDebugMeta: true,
                    label: 'rollback-journal-restore',
                    scopeKey: journal.scopeKey,
                    restoreId,
                    snapshotId: snapshot.snapshotId,
                    snapshotRestoreMode: snapshotEntries.mode,
                    retainedMemoryEntryCount: retainedMemoryEntries.length,
                    aggregateManagedEntryCount: snapshotEntries.entries.length,
                    turn: maxTurn,
                    detections: options?.detections || []
                });
            }
            return { ok: true, restored: true, restoreId, snapshotId: snapshot.snapshotId, turn: maxTurn, lorebook: restoredLore, journal };
        };

        const captureBeforeRequest = async (char = null, chat = null, lorebook = [], options = {}) => {
            if (!char || !chat || !Array.isArray(lorebook)) return { ok: false, reason: 'invalid_context' };
            const scopeKey = normalizeScopeKey(chat, char);
            const currentFingerprint = buildChatFingerprint(chat);
            let workingLore = lorebook;
            const transplantResult = transplantForeignScopeIfNeeded(workingLore, chat, char, currentFingerprint);
            if (transplantResult?.transplanted) workingLore = transplantResult.lorebook;
            const bootstrapResult = transplantResult?.transplanted ? null : bootstrapJournalFromVisibleLore(workingLore, chat, char, currentFingerprint);
            if (bootstrapResult?.bootstrapped) workingLore = bootstrapResult.lorebook;
            let journal = transplantResult?.journal || bootstrapResult?.journal || loadJournal(workingLore, chat, char);
            const detections = detectDeletedMessages(journal.lastChatFingerprint, currentFingerprint);
            const detectionEntry = appendDetectionEntries(journal, detections, currentFingerprint);
            let restoreResult = null;
            if (detections.length > 0 && options?.restore !== false && journal?.policy?.restoreEnabled !== false) {
                const target = chooseRestoreTarget(journal, workingLore, detections);
                if (target?.ok && isRecentRollbackTarget(journal, target, detections, currentFingerprint)) {
                    restoreResult = await restorePersistentSnapshot(char, chat, workingLore, journal, target, {
                        currentFingerprint,
                        detections,
                        reason: 'beforeRequest-rollback-journal-stage4-recent-snapshot'
                    });
                    if (restoreResult?.ok && restoreResult?.restored) {
                        workingLore = restoreResult.lorebook;
                        journal = restoreResult.journal;
                    } else if (detectionEntry) {
                        detectionEntry.restoreAttempt = { ok: false, reason: restoreResult?.reason || 'restore_failed' };
                    }
                } else {
                    const fallbackReason = target?.ok
                        ? `rollback_depth_${getRollbackDepth(journal, target, detections, currentFingerprint)}_exceeds_${RECENT_ROLLBACK_TURN_LIMIT}`
                        : (target?.reason || 'no_recent_restore_target');
                    restoreResult = await applyDeleteCandidateFallback(char, chat, workingLore, journal, detections, currentFingerprint, {
                        reason: fallbackReason
                    });
                    if (restoreResult?.ok) {
                        workingLore = restoreResult.lorebook;
                        journal = restoreResult.journal;
                        if (detectionEntry) detectionEntry.restoreAttempt = { ok: true, mode: 'delete_candidate_fallback', reason: fallbackReason, fallbackId: restoreResult.fallbackId };
                    } else if (detectionEntry) {
                        detectionEntry.restoreAttempt = { ok: false, mode: 'delete_candidate_fallback', reason: restoreResult?.reason || fallbackReason, target };
                    }
                }
            }
            const fastPathCleanupResult = (restoreResult?.ok && restoreResult?.mode === 'delete_candidate_fallback' && restoreResult?.fastPath)
                ? restoreResult
                : null;
            if (fastPathCleanupResult) {
                MemoryState.rollbackJournalBaselineByScope.delete(scopeKey);
                if (MemoryEngine.CONFIG?.debug) {
                    recordRuntimeDebug('warn', '[LIBRA] Rollback journal delete-candidate cleanup completed; capturing a fresh rollback baseline for this request', {
                        __libraDebugMeta: true,
                        label: 'rollback-journal-fast-path',
                        scopeKey,
                        fallbackId: fastPathCleanupResult.fallbackId || '',
                        deletedTurns: fastPathCleanupResult.deletedTurns || [],
                        removedMemoryCount: fastPathCleanupResult.removedMemoryCount || 0,
                        detections
                    });
                }
            }
            const turnSource = restoreResult?.restored
                ? (restoreResult?.turn || 0)
                : (options?.turn || deriveRuntimeTurnFromLorebook(workingLore) || MemoryEngine.getCurrentTurn?.() || 0);
            const turn = normalizeLegacyMemoryTurnAnchor(turnSource);
            if (restoreResult?.restored) {
                try { MemoryEngine.setTurn(turn); } catch (error) {
                    recordSuppressedRuntimeError('rollback.capture_before_request.set_restored_turn', error, {
                        scopeKey,
                        chatId: String(chat?.id || '').trim(),
                        turn
                    });
                }
            }
            const now = Date.now();
            const latestEntry = Array.isArray(journal.entries) ? journal.entries[journal.entries.length - 1] : null;
            const canReuse = latestEntry
                && latestEntry.kind === 'before_request_baseline'
                && latestEntry.commitState === 'baseline'
                && latestEntry.chatFingerprint?.fingerprintHash === currentFingerprint.fingerprintHash
                && (now - Number(latestEntry.capturedAt || 0)) <= BASELINE_REUSE_MS;
            const baselineManagedDigest = buildManagedLoreDigest(workingLore);
            const baseline = canReuse ? latestEntry : {
                id: makeBaselineId(scopeKey, currentFingerprint, turn),
                snapshotId: '',
                kind: 'before_request_baseline',
                commitState: 'baseline',
                capturedAt: now,
                turn,
                reason: String(options?.reason || 'beforeRequest-entry-baseline').trim() || 'beforeRequest-entry-baseline',
                chatFingerprint: compactChatFingerprint(currentFingerprint),
                managedLoreDigest: baselineManagedDigest,
                detections: detections.slice(0, 8),
                restoreEnabled: true,
                restoredBeforeBaseline: Boolean(restoreResult?.restored),
                restoreId: restoreResult?.restoreId || '',
                cleanedBeforeBaseline: Boolean(fastPathCleanupResult),
                fallbackId: fastPathCleanupResult?.fallbackId || '',
                transplantedBeforeBaseline: Boolean(transplantResult?.transplanted),
                bootstrapBeforeBaseline: Boolean(bootstrapResult?.bootstrapped),
                copiedFromScopeHash: transplantResult?.source?.scopeHash || ''
            };
            if (canReuse) {
                baseline.capturedAt = now;
                baseline.turn = turn;
                baseline.detections = detections.slice(0, 8);
                baseline.managedLoreDigest = baselineManagedDigest;
                baseline.restoredBeforeBaseline = Boolean(restoreResult?.restored);
                baseline.restoreId = restoreResult?.restoreId || baseline.restoreId || '';
                baseline.cleanedBeforeBaseline = Boolean(fastPathCleanupResult) || Boolean(baseline.cleanedBeforeBaseline);
                baseline.fallbackId = fastPathCleanupResult?.fallbackId || baseline.fallbackId || '';
                baseline.transplantedBeforeBaseline = Boolean(transplantResult?.transplanted) || Boolean(baseline.transplantedBeforeBaseline);
                baseline.bootstrapBeforeBaseline = Boolean(bootstrapResult?.bootstrapped) || Boolean(baseline.bootstrapBeforeBaseline);
                baseline.copiedFromScopeHash = transplantResult?.source?.scopeHash || baseline.copiedFromScopeHash || '';
            } else {
                journal.entries.push(baseline);
            }
            if (!baseline.snapshotId && MemoryEngine.CONFIG?.rollbackJournalBaselineSnapshotsEnabled === true) {
                const snapshot = buildSnapshotPayload(workingLore, journal, baseline, currentFingerprint, {
                    turn,
                    reason: 'beforeRequest-entry-baseline-snapshot'
                });
                baseline.snapshotId = snapshot.snapshotId;
                baseline.snapshotManagedLoreDigest = snapshot.managedLoreDigest;
                baseline.snapshotCapturedAt = snapshot.capturedAt;
                upsertSnapshotEntry(workingLore, snapshot);
            }
            journal.lastChatFingerprint = currentFingerprint;
            journal.lastBaselineId = baseline.id;
            journal.chatId = String(chat?.id || journal.chatId || '').trim();
            upsertJournalEntry(workingLore, journal);
            MemoryState.rollbackJournalBaselineByScope.set(scopeKey, {
                baselineId: baseline.id,
                snapshotId: baseline.snapshotId,
                fingerprintHash: currentFingerprint.fingerprintHash,
                turn,
                capturedAt: baseline.capturedAt,
                restored: Boolean(restoreResult?.restored),
                restoreId: restoreResult?.restoreId || '',
                cleaned: Boolean(fastPathCleanupResult),
                fastPath: Boolean(fastPathCleanupResult),
                fallbackId: fastPathCleanupResult?.fallbackId || '',
                transplanted: Boolean(transplantResult?.transplanted),
                bootstrapped: Boolean(bootstrapResult?.bootstrapped),
                copiedFromScopeHash: transplantResult?.source?.scopeHash || ''
            });
            if (options?.persist !== false) {
                rebuildRuntimeAfterRestore(char, chat, workingLore);
                await persistLoreToActiveChat(chat, workingLore, { reason: restoreResult?.restored ? 'rollback-journal-beforeRequest-restored-baseline' : 'rollback-journal-beforeRequest-baseline' });
            } else {
                MemoryEngine.setLorebook(char, chat, workingLore);
            }
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug(detections.length ? 'warn' : 'log', '[LIBRA] Rollback journal beforeRequest baseline captured', {
                    __libraDebugMeta: true,
                    label: 'rollback-journal-baseline',
                    turn,
                    scopeKey,
                    baselineId: baseline.id,
                    snapshotId: baseline.snapshotId,
                    fingerprintHash: currentFingerprint.fingerprintHash,
                    detections,
                    restored: Boolean(restoreResult?.restored),
                    cleaned: Boolean(fastPathCleanupResult),
                    fastPath: Boolean(fastPathCleanupResult),
                    fallbackId: fastPathCleanupResult?.fallbackId || '',
                    transplanted: Boolean(transplantResult?.transplanted),
                    bootstrapped: Boolean(bootstrapResult?.bootstrapped)
                });
            }
            return { ok: true, baselineId: baseline.id, snapshotId: baseline.snapshotId, detections, restored: Boolean(restoreResult?.restored), cleaned: Boolean(fastPathCleanupResult), fastPath: Boolean(fastPathCleanupResult), fallbackId: fastPathCleanupResult?.fallbackId || '', transplanted: Boolean(transplantResult?.transplanted), bootstrapped: Boolean(bootstrapResult?.bootstrapped), restoreResult, transplantResult, bootstrapResult, fingerprint: currentFingerprint, lorebook: workingLore };
        };

        const recordAssistantCommit = (char = null, chat = null, lorebook = [], meta = {}, options = {}) => {
            if (!char || !chat || !Array.isArray(lorebook)) return { ok: false, reason: 'invalid_context' };
            const scopeKey = normalizeScopeKey(chat, char);
            let currentFingerprint = buildChatFingerprint(chat);
            const journal = loadJournal(lorebook, chat, char);
            const cachedBaseline = MemoryState.rollbackJournalBaselineByScope.get(scopeKey) || null;
            const baselineId = String(options?.baselineId || cachedBaseline?.baselineId || journal.lastBaselineId || '').trim();
            const baseline = baselineId
                ? (Array.isArray(journal.entries) ? journal.entries.find(entry => entry?.id === baselineId) : null)
                : null;
            if (baseline && !baseline.snapshotId && MemoryEngine.CONFIG?.rollbackJournalBaselineSnapshotsEnabled === true) {
                const snapshot = buildSnapshotPayload(lorebook, journal, baseline, baseline.chatFingerprint || currentFingerprint, {
                    turn: baseline.turn || meta?.turn,
                    reason: 'assistant-commit-missing-baseline-snapshot'
                });
                baseline.snapshotId = snapshot.snapshotId;
                baseline.snapshotManagedLoreDigest = snapshot.managedLoreDigest;
                baseline.snapshotCapturedAt = snapshot.capturedAt;
                upsertSnapshotEntry(lorebook, snapshot);
            }
            const assistantHash = String(meta?.sourceHash || meta?.aiHash || meta?.responseHash || '').trim();
            currentFingerprint = augmentFingerprintWithAssistantCommit(currentFingerprint, assistantHash, meta) || currentFingerprint;
            const commitId = `rbj_commit_${stableHash(scopeKey)}_${normalizeLegacyMemoryTurnAnchor(meta?.turn || meta?.finalizedTurn || 0)}_${assistantHash.slice(0, 10) || 'nohash'}_${Date.now()}`;
            const commitPayload = {
                id: commitId,
                kind: 'assistant_commit',
                commitState: 'assistant_committed',
                baselineId,
                snapshotId: String(baseline?.snapshotId || cachedBaseline?.snapshotId || '').trim(),
                committedAt: Date.now(),
                turn: normalizeLegacyMemoryTurnAnchor(meta?.turn || meta?.finalizedTurn || meta?.turnAnchor || 0),
                assistantHash,
                assistantSignatureHash: meta?.messageSignature ? hashText(meta.messageSignature) : '',
                messageId: String(meta?.messageId || meta?.m_id || '').trim(),
                liveMessageIds: normalizeCanonicalMessageIds?.(meta?.liveMessageIds || meta?.sourceMessageIds || meta?.messageId || meta?.m_id || []),
                turnKey: String(meta?.turnKey || '').trim(),
                userTurnKey: String(meta?.userTurnKey || '').trim(),
                memoryKey: String(meta?.memoryKey || '').trim(),
                chatFingerprint: compactChatFingerprint(currentFingerprint),
                restoreEnabled: true
            };
            if (baseline) {
                baseline.commitState = 'assistant_committed';
                baseline.committedAt = commitPayload.committedAt;
                baseline.assistantCommitId = commitId;
                baseline.assistantHash = assistantHash;
                baseline.turnKey = commitPayload.turnKey;
                baseline.messageId = commitPayload.messageId;
                baseline.liveMessageIds = commitPayload.liveMessageIds;
                baseline.postCommitFingerprintHash = currentFingerprint.fingerprintHash;
                baseline.snapshotId = commitPayload.snapshotId || baseline.snapshotId || '';
            }
            const supersedeResult = supersedePreviousUserTurnCommits(lorebook, journal, commitPayload, chat, char);
            journal.entries.push(commitPayload);
            journal.commitLog = Array.isArray(journal.commitLog) ? journal.commitLog : [];
            journal.commitLog.push(compactCommitReference(commitPayload));
            const duplicateRepairResult = supersedeDuplicateUserTurnCommitGroups(lorebook, journal, chat, char, { protectedCommitId: commitId });
            journal.lastChatFingerprint = currentFingerprint;
            journal.lastCommitId = commitId;
            journal.lastBaselineId = baselineId || journal.lastBaselineId || '';
            journal.chatId = String(chat?.id || journal.chatId || '').trim();
            upsertJournalEntry(lorebook, journal);
            pruneSnapshotEntries(lorebook, journal.scopeHash, commitPayload.snapshotId);
            try {
                const chatIdForRestoreCleanup = String(chat?.id || journal?.chatId || '').trim();
                if (chatIdForRestoreCleanup) MemoryState.rollbackJournalRestoredTurnByChatId?.delete?.(chatIdForRestoreCleanup);
            } catch (error) {
                recordSuppressedRuntimeError('rollback.commit_after_request.clear_restored_turn', error, {
                    scopeKey,
                    chatId: String(chat?.id || journal?.chatId || '').trim(),
                    turn: commitPayload.turn
                });
            }
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('log', '[LIBRA] Rollback journal assistant commit recorded', {
                    __libraDebugMeta: true,
                    label: 'rollback-journal-commit',
                    turn: commitPayload.turn,
                    scopeKey,
                    baselineId,
                    snapshotId: commitPayload.snapshotId,
                    commitId,
                    assistantHash,
                    supersededPreviousUserTurnCommits: Number(supersedeResult?.candidates || 0),
                    supersededMemoryCount: Number(supersedeResult?.memorySupersededCount || 0),
                    repairedDuplicateUserTurnGroups: Number(duplicateRepairResult?.groups || 0),
                    fingerprintHash: currentFingerprint.fingerprintHash
                });
            }
            return { ok: true, commitId, baselineId, snapshotId: commitPayload.snapshotId, fingerprint: currentFingerprint, supersedeResult, duplicateRepairResult, lorebook };
        };

        const getStatus = (lorebook = [], chat = null, char = null) => {
            const journal = loadJournal(lorebook, chat, char);
            return {
                ok: true,
                scopeKey: journal.scopeKey,
                scopeHash: journal.scopeHash,
                entryCount: Array.isArray(journal.entries) ? journal.entries.length : 0,
                snapshotCount: listSnapshots(lorebook, journal.scopeHash).length,
                lastBaselineId: journal.lastBaselineId || '',
                lastCommitId: journal.lastCommitId || '',
                lastRestoreId: journal.lastRestoreId || '',
                lastFingerprintHash: journal.lastChatFingerprint?.fingerprintHash || '',
                restoreEnabled: journal?.policy?.restoreEnabled !== false,
                stage: 4
            };
        };

        return Object.freeze({
            COMMENT,
            SNAPSHOT_COMMENT,
            SCHEMA: JOURNAL_SCHEMA,
            SNAPSHOT_SCHEMA,
            buildChatFingerprint,
            detectDeletedMessages,
            loadJournal,
            listSnapshots,
            loadSnapshot,
            captureBeforeRequest,
            recordAssistantCommit,
            getStatus
        });
    })();



    const findLatestAssistantMessage = (chat) => {
        const msgs = getChatMessages(chat);
        for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i];
            if (!msg || isUserLikeMessage(msg)) continue;
            return msg;
        }
        return null;
    };

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] V4.2 Turn Anchor Utilities
    // Late-model LIBRA uses stable turn anchors instead of background polling.
    // The lorebook schema remains V3.5.1-compatible;
    // these helpers only enrich META and rollback decisions.
    // ══════════════════════════════════════════════════════════════
    const normalizeCanonicalMessageIds = (value) => {
        const collected = [];
        const visited = new Set();
        const collect = (item) => {
            if (item == null) return;
            if (Array.isArray(item)) { item.forEach(collect); return; }
            if (typeof item === 'object') {
                if (visited.has(item)) return;
                visited.add(item);
                [
                    item?.id,
                    item?.messageId,
                    item?.m_id,
                    item?.uuid,
                    item?.key,
                    ...(Array.isArray(item?.sourceMessageIds) ? item.sourceMessageIds : []),
                    ...(Array.isArray(item?.m_ids) ? item.m_ids : []),
                    ...(Array.isArray(item?.liveMessageIds) ? item.liveMessageIds : [])
                ].forEach(collect);
                return;
            }
            const normalized = String(item || '').trim();
            if (!normalized || normalized === '[object Object]') return;
            collected.push(normalized);
        };
        collect(value);
        return [...new Set(collected)];
    };

    const getPrimaryCanonicalMessageId = (value, allowEmpty = false) => {
        const primary = String(normalizeCanonicalMessageIds(value)[0] || '').trim();
        if (primary) return primary;
        return allowEmpty ? '' : null;
    };

    const hasCanonicalMessageIdOverlap = (left, right) => {
        const leftIds = normalizeCanonicalMessageIds(left);
        const rightIds = normalizeCanonicalMessageIds(right);
        if (leftIds.length === 0 || rightIds.length === 0) return false;
        const rightSet = new Set(rightIds);
        return leftIds.some(id => rightSet.has(id));
    };

    const getLiveMessageId = (msg) => String(normalizeCanonicalMessageIds(msg)[0] || '').trim();

    const getNarrativeMessageStableId = (chat, msg, options = {}) => {
        if (!msg) return '';
        const explicitId = String(msg?.id || msg?.messageId || '').trim();
        if (explicitId) return explicitId;
        const indexHint = Number.isFinite(Number(options?.indexHint)) ? Number(options.indexHint) : -1;
        const aiText = String(
            options?.aiText
            || Utils.getNarrativeComparableText(Utils.getMessageText(msg), 'ai')
            || Utils.getMemorySourceText(Utils.getMessageText(msg))
            || ''
        ).trim();
        if (!aiText) return '';
        const chatId = String(chat?.id || options?.chatId || 'global').trim() || 'global';
        const hash = TokenizerEngine.simpleHash(aiText);
        const idxLabel = indexHint >= 0 ? String(indexHint) : 'na';
        return `derivedmsg:${chatId}:${idxLabel}:${hash}`;
    };

    const buildAfterRequestSyntheticMessageId = (chat, turn = 0, sourceHash = '') => {
        const chatId = String(chat?.id || 'global').trim() || 'global';
        const safeTurn = normalizeLegacyMemoryTurnAnchor(turn) || 'pending';
        const hash = String(sourceHash || '').trim() || 'nohash';
        return `afterrequest:${chatId}:${safeTurn}:${hash}`;
    };

    const buildAfterRequestSyntheticMessageSignature = (turn = 0, aiText = '', sourceHash = '') => {
        const hash = String(sourceHash || (aiText ? TokenizerEngine.simpleHash(aiText) : '') || '').trim() || 'nohash';
        const safeTurn = normalizeLegacyMemoryTurnAnchor(turn) || 0;
        return `ai::afterRequest::${safeTurn}::${hash}`;
    };

    const buildCanonicalMemoryCaptureContent = (userText = '', aiText = '', options = {}) => {
        const ai = String(Utils.getMemorySourceText(aiText) || '').trim();
        if (!ai) return '';
        let payload = CompactMemoryCodec.buildTurnPayload('', ai, {
            importance: 6,
            turn: options.turn || 0,
            entityRefs: options.entityRefs || []
        });
        try {
            if (payload && (typeof MemoryEngine === 'undefined' || MemoryEngine.CONFIG?.rpLongTermMemoryEnabled !== false)) {
                payload = RPContinuityCore.attachToPayload(payload, '', ai, options);
            }
        } catch (error) {
            if (typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('warn', '[LIBRA][RP-LTM] heuristic turn capture skipped:', error?.message || error);
            }
        }
        return payload ? CompactMemoryCodec.serialize(payload) : '';
    };
    const WORLD_RECALL_MEMORY_MIN_INTERVAL_TURNS = 5;
    const buildWorldRecallMemoryContent = (worldMeta = {}, currentRules = {}, options = {}) => {
        const meta = (worldMeta && typeof worldMeta === 'object') ? worldMeta : {};
        const normalizedRules = normalizeWorldRuleUpdate(currentRules || {});
        const classification = String(meta.classification || meta.worldMetadata?.classification || '').trim();
        const worldSummary = String(meta.worldSummary || meta.worldMetadata?.summary || '').trim();
        const worldDescription = String(meta.worldMetadata?.description || '').trim();
        const userWorldCorrection = String(meta.userWorldCorrection || meta.worldMetadata?.userWorldCorrection || '').trim();
        const worldSnapshot = options.worldSnapshot && typeof options.worldSnapshot === 'object' ? options.worldSnapshot : {};
        const activePath = dedupeTextArray(
            (Array.isArray(options.activePath) ? options.activePath : (Array.isArray(worldSnapshot.activePath) ? worldSnapshot.activePath : []))
                .map(item => String(item || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
        ).slice(0, 8);
        const meaningfulActivePath = activePath.filter(item => String(item || '').trim());
        const ruleHighlights = extractWorldRuleHighlights(normalizedRules, 6);
        const meaningfulHighlights = ruleHighlights.filter(item => String(item || '').trim());
        const hasMeaningfulWorldSignal = Boolean(
            worldSummary
            || userWorldCorrection
            || meaningfulHighlights.length > 0
            || meaningfulActivePath.length > 0
            || Boolean(classification)
        );
        if (!hasMeaningfulWorldSignal) return '';

        const normalizedTurn = normalizeLegacyMemoryTurnAnchor(options.turn || options.t || 0) || undefined;
        const summaryParts = [];
        if (classification) summaryParts.push(`분류 ${classification}`);
        if (meaningfulActivePath.length > 0) summaryParts.push(`활성 경로 ${meaningfulActivePath.join('→')}`);
        if (worldSummary) summaryParts.push(`세계 요약 ${truncateForLLM(worldSummary, 220, ' ... ')}`);
        else if (worldDescription) summaryParts.push(`세계 설명 ${truncateForLLM(worldDescription, 220, ' ... ')}`);
        if (meaningfulHighlights.length > 0) summaryParts.push(`핵심 규칙 ${meaningfulHighlights.join(', ')}`);
        if (userWorldCorrection) summaryParts.push(`수동 보정 ${truncateForLLM(userWorldCorrection, 160, ' ... ')}`);
        if (summaryParts.length === 0) return '';

        const snippetPool = [];
        if (classification) snippetPool.push(`분류/Classification: ${classification}`);
        if (meaningfulActivePath.length > 0) snippetPool.push(`활성 경로/Active Path: ${meaningfulActivePath.join('→')}`);
        if (worldSummary) snippetPool.push(`요약/Summary: ${truncateForLLM(worldSummary, 180, ' ... ')}`);
        else if (worldDescription) snippetPool.push(`설명/Description: ${truncateForLLM(worldDescription, 180, ' ... ')}`);
        if (meaningfulHighlights.length > 0) snippetPool.push(`규칙/Rules: ${meaningfulHighlights.join(', ')}`);
        if (userWorldCorrection) snippetPool.push(`수동 보정/User Correction: ${truncateForLLM(userWorldCorrection, 160, ' ... ')}`);

        const classificationTag = classification ? `분류:${classification}` : '';
        const tags = dedupeTextArray([
            '세계 규칙',
            'world_rule_snapshot',
            classificationTag,
            ...meaningfulHighlights
        ].filter(Boolean)).slice(0, 10);
        const worldTags = dedupeTextArray([
            '세계 규칙',
            classification,
            ...meaningfulHighlights,
            ...(userWorldCorrection ? ['수동 보정'] : [])
        ].filter(Boolean)).slice(0, 12);
        const summary = truncateForLLM(summaryParts.join(' | '), 420, ' ... ');
        const worldSignature = stableHash(JSON.stringify({
            classification,
            activePath: meaningfulActivePath,
            worldSummary,
            worldDescription,
            userWorldCorrection,
            ruleHighlights: meaningfulHighlights
        }));
        const anchorHint = truncateForLLM(dedupeTextArray([
            '세계 규칙',
            classificationTag,
            ...meaningfulHighlights
        ].filter(Boolean)).join(' / '), 160, ' ... ');
        const createdAt = Date.now();
        const sourceMessageIds = normalizeCanonicalMessageIds(options.sourceMessageIds || options.liveMessageIds || []);
        const payload = {
            schema: CompactMemoryCodec.LEDGER_SCHEMA,
            version: 2,
            turn: normalizedTurn,
            firstSeenTurn: normalizedTurn,
            source: {
                turn: normalizedTurn,
                firstSeenTurn: normalizedTurn,
                sourceHash: String(options.sourceHash || '').trim(),
                sourceMessageIds,
                createdAt,
                rawRetention: 'hash_summary_and_structured_evidence_only'
            },
            scene: {
                time: '',
                location: '',
                summary: classification ? `world:${classification}` : 'world_rule_snapshot'
            },
            participants: {
                canonicalEntities: [],
                unresolvedMentions: [],
                groups: []
            },
            facts: snippetPool.slice(0, 3).map((text, index) => ({
                id: `fact.${normalizedTurn || 'world'}.${index + 1}.${String(stableHash(`${worldSignature}:${index}:${text}`)).replace(/^-/, 'n').slice(0, 10)}`,
                type: 'world_rule',
                text: truncateForLLM(text, 220, ' ... '),
                entities: [],
                evidence: [{ source: 'world', text: truncateForLLM(text, 220, ' ... ') }],
                confidence: 0.86,
                importance: 0.7
            })),
            continuity: {
                openThreads: [],
                relationSignals: [],
                worldChanges: [{
                    id: `world.${String(worldSignature).replace(/^-/, 'n')}`,
                    type: 'world_rule_snapshot',
                    text: summary,
                    summary,
                    tags: worldTags,
                    signature: worldSignature,
                    confidence: 0.86
                }]
            },
            audit: {
                cautions: [],
                overpromotionRisks: [],
                confidence: 'medium'
            },
            retention: {
                rawRetention: 'summary_and_structured_evidence',
                rawDiscarded: true
            },
            arcKey: 'world_rule_snapshot',
            arcRole: 'current',
            causalRole: '',
            primaryConflict: '',
            relationDelta: '',
            summary,
            recallAnchors: [{
                summary: truncateForLLM(summary, 180, ' ... '),
                hint: anchorHint,
                entityRefs: [],
                confidence: 0.82
            }],
            directEvidenceSnippets: snippetPool.slice(0, 3).map(text => ({ source: 'world', text })),
            mentionedEntityNames: [],
            tags,
            importance: Math.max(6, Math.min(10, Number(options.importance || 6) || 6)),
            impression: Math.max(0.55, Math.min(0.95, Number(options.impression || 0.68) || 0.68)),
            sourceHash: String(options.sourceHash || '').trim(),
            sourceMessageIds,
            rawRetention: 'summary_and_structured_evidence',
            rawDiscarded: true,
            createdAt,
            classification,
            worldSignature,
            worldSummary: truncateForLLM(worldSummary || worldDescription, 1000, ' ... '),
            world: {
                signature: worldSignature,
                classification: classification ? { primary: classification } : {},
                exists: safeClone(normalizedRules.exists || {}),
                systems: safeClone(normalizedRules.systems || {}),
                physics: safeClone(normalizedRules.physics || {}),
                custom: safeClone(normalizeWorldCustomRules(normalizedRules.custom)),
                activePath: meaningfulActivePath,
                ruleHighlights: meaningfulHighlights,
                userCorrection: truncateForLLM(userWorldCorrection, 600, ' ... ')
            }
        };
        return CompactMemoryCodec.serialize(payload);
    };
    const getWorldRecallRuleHash = (payload = {}) => stableHash(JSON.stringify({
        classification: payload?.classification || payload?.world?.classification || {},
        exists: payload?.world?.exists || {},
        systems: payload?.world?.systems || {},
        physics: payload?.world?.physics || {},
        custom: payload?.world?.custom || {},
        ruleHighlights: payload?.world?.ruleHighlights || [],
        worldSummary: payload?.worldSummary || ''
    }));
    const getWorldRecallActivePathHash = (payload = {}) => stableHash(JSON.stringify(
        Array.isArray(payload?.world?.activePath)
            ? payload.world.activePath
            : (Array.isArray(payload?.activePath) ? payload.activePath : [])
    ));
    const getWorldRecallCorrectionHash = (payload = {}) => stableHash(String(
        payload?.world?.userCorrection || payload?.userWorldCorrection || ''
    ).trim());
    const getWorldRecallMemoryEntries = (lorebook = []) => LibraLoreConsolidator
        .unpack(Array.isArray(lorebook) ? lorebook : [])
        .filter(entry => entry && String(entry?.comment || '').trim() === 'lmai_memory');
    const findLatestWorldRecallMemoryInfo = (lorebook = []) => {
        if (!Array.isArray(lorebook)) return null;
        let inspected = 0;
        const memoryEntries = getWorldRecallMemoryEntries(lorebook);
        for (let i = memoryEntries.length - 1; i >= 0 && inspected < 128; i--) {
            const entry = memoryEntries[i];
            inspected += 1;
            let payload = null;
            try { payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null; } catch (_) { payload = null; }
            if (!payload || String(payload?.arcKey || '').trim() !== 'world_rule_snapshot') continue;
            const turn = normalizeLegacyMemoryTurnAnchor(payload?.turn || payload?.firstSeenTurn || payload?.source?.turn || 0) || 0;
            return {
                payload,
                turn,
                signature: String(payload?.worldSignature || payload?.world?.signature || '').trim(),
                ruleHash: getWorldRecallRuleHash(payload),
                activePathHash: getWorldRecallActivePathHash(payload),
                correctionHash: getWorldRecallCorrectionHash(payload)
            };
        }
        return null;
    };
    const shouldCreateWorldRecallMemorySnapshot = (lorebook = [], payload = null, options = {}) => {
        if (!payload || typeof payload !== 'object') return { create: false, reason: 'empty_payload' };
        const signature = String(payload?.worldSignature || payload?.world?.signature || '').trim();
        if (signature && hasMatchingWorldRecallMemory(lorebook, signature)) {
            return { create: false, reason: 'same_signature', signature };
        }
        const turn = normalizeLegacyMemoryTurnAnchor(options.turn || payload.turn || payload.firstSeenTurn || 0) || 0;
        const latest = findLatestWorldRecallMemoryInfo(lorebook);
        if (!latest) return { create: true, reason: 'baseline', signature };
        const currentRuleHash = getWorldRecallRuleHash(payload);
        const currentActivePathHash = getWorldRecallActivePathHash(payload);
        const currentCorrectionHash = getWorldRecallCorrectionHash(payload);
        if (options.isWorldCritical === true) {
            return { create: true, reason: 'critical_world_path', signature, previousSignature: latest.signature };
        }
        if (currentCorrectionHash !== latest.correctionHash) {
            return { create: true, reason: 'user_world_correction_changed', signature, previousSignature: latest.signature };
        }
        if (currentRuleHash !== latest.ruleHash) {
            return { create: true, reason: 'world_rules_changed', signature, previousSignature: latest.signature };
        }
        if (currentActivePathHash !== latest.activePathHash) {
            return { create: true, reason: 'world_path_changed', signature, previousSignature: latest.signature };
        }
        const age = turn > 0 && latest.turn > 0 ? turn - latest.turn : 0;
        if (age >= WORLD_RECALL_MEMORY_MIN_INTERVAL_TURNS) {
            return { create: true, reason: 'interval_refresh', signature, previousSignature: latest.signature, age };
        }
        return { create: false, reason: 'recent_equivalent', signature, previousSignature: latest.signature, age };
    };
    const hasMatchingWorldRecallMemory = (lorebook = [], signature = '') => {
        const target = String(signature || '').trim();
        if (!target || !Array.isArray(lorebook)) return false;
        let inspected = 0;
        const memoryEntries = getWorldRecallMemoryEntries(lorebook);
        for (let i = memoryEntries.length - 1; i >= 0 && inspected < 96; i--) {
            const entry = memoryEntries[i];
            inspected += 1;
            let payload = null;
            try { payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null; } catch (_) { payload = null; }
            if (!payload || String(payload?.arcKey || '').trim() !== 'world_rule_snapshot') continue;
            const existingSignature = String(payload?.worldSignature || payload?.world?.signature || '').trim();
            if (existingSignature && existingSignature === target) return true;
        }
        return false;
    };
    const buildLatestAssistantSnapshot = (chat, options = {}) => {
        const latestMessages = Array.isArray(getChatMessages(chat)) ? getChatMessages(chat) : [];
        const currentMessageCount = latestMessages.length;
        const latestAiMsg = findLatestAssistantMessage(chat);
        const latestComparable = String(
            Utils.getNarrativeComparableText(Utils.getMessageText(latestAiMsg), 'ai')
            || Utils.getMemorySourceText(Utils.getMessageText(latestAiMsg))
            || ''
        ).trim();
        const latestHash = String((latestComparable ? TokenizerEngine.simpleHash(latestComparable) : '') || '').trim();
        const latestMessageSignature = String(getMessageSignature(latestAiMsg) || '').trim();
        const latestLiveId = String(getLiveMessageId(latestAiMsg) || '').trim();
        let latestStableId = '';
        if (options?.includeStableId === true && latestAiMsg) {
            const latestIndex = latestMessages.lastIndexOf(latestAiMsg);
            latestStableId = String(getNarrativeMessageStableId(chat, latestAiMsg, {
                aiText: latestComparable,
                indexHint: latestIndex
            }) || '').trim();
        }
        return {
            latestMessages,
            currentMessageCount,
            latestAiMsg,
            latestComparable,
            latestHash,
            latestMessageSignature,
            latestLiveId,
            latestStableId
        };
    };

    const buildLogicalUserTurnKey = (userMsgForNarrative = '', userMsgForMemory = '', autoContinue = false) => {
        if (autoContinue) return '[auto-continue]';
        const base = String(userMsgForNarrative || userMsgForMemory || '').trim();
        return base ? TokenizerEngine.simpleHash(base) : '';
    };

    const buildCanonicalTurnKey = (chatId = '', userTurnKey = '', sourceHash = '', messageSignature = '', liveMessageIds = []) => {
        const normalizedIds = normalizeCanonicalMessageIds(liveMessageIds);
        const compactSignature = typeof compactTurnMessageSignature === 'function'
            ? compactTurnMessageSignature(messageSignature)
            : String(messageSignature || '').trim();
        const compactSignatureForKey = compactSignature.startsWith('sig:') ? compactSignature.slice(4) : compactSignature;
        return [
            `chat:${String(chatId || '').trim() || 'global'}`,
            `user:${String(userTurnKey || '').trim() || 'none'}`,
            `source:${String(sourceHash || '').trim() || 'none'}`,
            `sig:${compactSignatureForKey || 'none'}`,
            `ids:${normalizedIds.join(',') || 'none'}`
        ].join('|');
    };

    const normalizeLegacyMemoryTurnAnchor = (value = 0) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 && n < 1000000 ? Math.floor(n) : 0;
    };

    const deriveRuntimeTurnFromLorebook = (lorebook = []) => Math.max(0, Number(deriveMaxTurnFromLorebook(lorebook) || 0));


    const V42_TURN_RECORD_COMMENT = 'lmai_turn_records';
    const V42_TURN_RECORD_VERSION = 1;
    const V42_TURN_RECORD_LIMIT = 160;
    const V42_TURN_RECORD_FORMAT = 'compact_v2';

    function compactTurnMessageSignature(value = '') {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (raw.length <= 72 && !/\s{2,}|[\r\n]/.test(raw)) return raw;
        return `sig:${stableHash(raw)}`;
    }

    const parseJsonSafeV42 = (value, fallback = null) => {
        try {
            const parsed = typeof value === 'string' ? JSON.parse(value) : value;
            return parsed == null ? fallback : parsed;
        } catch {
            return fallback;
        }
    };

    const splitManagedMemoryMetaPrefix = (content = '') => {
        const raw = String(content || '');
        const metaJson = extractLibraMetaJsonString(raw);
        if (!metaJson) return { meta: {}, body: raw.trim(), hadMeta: false };
        const markerStart = raw.indexOf('[META:');
        const jsonStart = raw.indexOf(metaJson, markerStart >= 0 ? markerStart : 0);
        const close = jsonStart >= 0 ? raw.indexOf(']', jsonStart + metaJson.length) : -1;
        return {
            meta: parseJsonSafeV42(metaJson, {}) || {},
            body: (close >= 0 ? raw.slice(close + 1) : raw.slice((jsonStart >= 0 ? jsonStart + metaJson.length : 0))).trim(),
            hadMeta: true
        };
    };

    const forceMemoryTurnAnchor = (entry = null, anchorMeta = {}) => {
        if (!entry || typeof entry !== 'object' || String(entry?.comment || '').trim() !== 'lmai_memory') return null;
        const split = splitManagedMemoryMetaPrefix(entry.content || '');
        const turn = normalizeLegacyMemoryTurnAnchor(
            anchorMeta?.turnAnchor
            || anchorMeta?.turnAnchorTurn
            || anchorMeta?.lockedTurn
            || anchorMeta?.finalizedTurn
            || anchorMeta?.turn
            || split.meta?.turnAnchorTurn
            || split.meta?.t
        );
        const sourceIds = normalizeCanonicalMessageIds(
            anchorMeta?.liveMessageIds
            || anchorMeta?.sourceMessageIds
            || anchorMeta?.messageId
            || anchorMeta?.m_id
            || split.meta?.sourceMessageIds
            || split.meta?.m_ids
            || split.meta?.m_id
        );
        const merged = {
            ...split.meta,
            ...Object.fromEntries(Object.entries(anchorMeta || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''))
        };
        if (turn > 0) {
            merged.t = turn;
            merged.turn = turn;
            merged.turnAnchor = turn;
            merged.turnAnchorTurn = turn;
            merged.lockedTurn = turn;
            merged.finalizedTurn = turn;
        }
        if (sourceIds.length > 0) {
            merged.sourceMessageIds = sourceIds;
            merged.liveMessageIds = sourceIds;
            merged.m_ids = sourceIds;
            if (!merged.m_id) merged.m_id = sourceIds[0];
            if (!merged.messageId) merged.messageId = sourceIds[0];
        }
        if (anchorMeta?.sourceHash || anchorMeta?.aiHash) merged.sourceHash = String(anchorMeta.sourceHash || anchorMeta.aiHash).trim();
        if (anchorMeta?.turnKey) merged.turnKey = String(anchorMeta.turnKey).trim();
        if (anchorMeta?.userTurnKey) merged.userTurnKey = String(anchorMeta.userTurnKey).trim();
        if (anchorMeta?.messageSignature) merged.messageSignature = compactTurnMessageSignature(anchorMeta.messageSignature);
        if (anchorMeta?.runtimeMode) merged.runtimeMode = String(anchorMeta.runtimeMode).trim();
        if (anchorMeta?.runtimeReliability) merged.runtimeReliability = String(anchorMeta.runtimeReliability).trim();
        entry.content = `[META:${JSON.stringify(merged)}] ${split.body || ''}`.trim();
        return merged;
    };

    const TurnRecordLedger = (() => {
        const getScopeKey = (chat = null, char = null, options = {}) => String(
            options?.scopeKey
            || getChatMemoryScopeKey(chat, char)
            || ((typeof getActiveManagedRuntimeScopeKey !== 'undefined' && typeof getActiveManagedRuntimeScopeKey === 'function') ? getActiveManagedRuntimeScopeKey() : '')
            || chat?.id
            || 'global'
        ).trim() || 'global';

        const defaultState = (chat = null, char = null, options = {}) => ({
            version: V42_TURN_RECORD_VERSION,
            kind: 'v42_turn_records',
            recordFormat: V42_TURN_RECORD_FORMAT,
            scopeKey: getScopeKey(chat, char, options),
            chatId: String(options?.chatId || chat?.id || ((typeof getActiveManagedChatId !== 'undefined' && typeof getActiveManagedChatId === 'function') ? getActiveManagedChatId() : '') || '').trim(),
            updatedAt: Date.now(),
            records: []
        });

        const isMatchingEntry = (entry = {}, scopeKey = '') => {
            if (String(entry?.comment || '').trim() !== V42_TURN_RECORD_COMMENT) return false;
            const parsed = parseJsonSafeV42(entry?.content || '{}', null);
            const entryScope = String(parsed?.scopeKey || parsed?.scopeId || '').trim();
            return !entryScope || !scopeKey || entryScope === scopeKey;
        };

        const findIndex = (lorebook = [], scopeKey = '') => Array.isArray(lorebook)
            ? lorebook.findIndex(entry => isMatchingEntry(entry, scopeKey))
            : -1;

        const hydrateStoredRecord = (record = {}, chat = null, char = null, options = {}) => {
            const scopeKey = getScopeKey(chat, char, options);
            const turn = normalizeLegacyMemoryTurnAnchor(
                record?.turn
                || record?.turnAnchor
                || record?.turnAnchorTurn
                || record?.lockedTurn
                || record?.finalizedTurn
            );
            const liveMessageIds = normalizeCanonicalMessageIds(record?.liveMessageIds || record?.sourceMessageIds || record?.messageId || record?.m_id);
            const sourceHash = String(record?.sourceHash || record?.aiHash || '').trim();
            const userTurnKey = String(record?.userTurnKey || '').trim();
            const rawMessageSignature = String(record?.messageSignature || '').trim();
            const messageSignature = compactTurnMessageSignature(rawMessageSignature);
            const turnKey = String(
                record?.turnKey
                || buildCanonicalTurnKey(chat?.id || record?.chatId || '', userTurnKey, sourceHash, messageSignature, liveMessageIds)
            ).trim();
            const finalizedAt = Number(record?.finalizedAt || 0);
            const updatedAt = Number(record?.updatedAt || 0);
            return {
                version: V42_TURN_RECORD_VERSION,
                scopeKey,
                chatId: String(record?.chatId || options?.chatId || chat?.id || '').trim(),
                turn,
                turnAnchor: turn,
                turnAnchorTurn: turn,
                lockedTurn: turn,
                finalizedTurn: turn,
                turnKey,
                userTurnKey,
                sourceHash,
                aiHash: String(record?.aiHash || sourceHash || '').trim(),
                messageId: getPrimaryCanonicalMessageId(liveMessageIds, true) || null,
                liveMessageIds,
                sourceMessageIds: liveMessageIds,
                messageSignature,
                messageSignatureHash: rawMessageSignature ? stableHash(rawMessageSignature) : '',
                userPreview: String(record?.userPreview || record?.userMsg || record?.userMsgForNarrative || record?.userMsgForMemory || '').replace(/\s+/g, ' ').trim().slice(0, 90),
                aiPreview: String(record?.aiPreview || record?.aiResponse || '').replace(/\s+/g, ' ').trim().slice(0, 140),
                memoryKey: String(record?.memoryKey || '').trim(),
                status: String(record?.status || 'active').trim() || 'active',
                reason: String(record?.reason || 'afterRequest-finalized').trim() || 'afterRequest-finalized',
                runtimeMode: String(record?.runtimeMode || 'turn-anchor').trim() || 'turn-anchor',
                runtimeReliability: String(record?.runtimeReliability || 'normal').trim() || 'normal',
                finalizedAt: finalizedAt > 0 ? finalizedAt : 0,
                updatedAt: updatedAt > 0 ? updatedAt : 0,
                deletedAt: Number(record?.deletedAt || 0),
                deletionReason: String(record?.deletionReason || '').trim(),
                supersededAt: Number(record?.supersededAt || 0),
                supersededBy: String(record?.supersededBy || '').trim(),
                supersededByHash: String(record?.supersededByHash || '').trim(),
                supersededByTurnKey: String(record?.supersededByTurnKey || '').trim(),
                supersedeReason: String(record?.supersedeReason || '').trim()
            };
        };

        const loadState = (lorebook = [], chat = null, char = null, options = {}) => {
            const scopeKey = getScopeKey(chat, char, options);
            const idx = findIndex(lorebook, scopeKey);
            if (idx < 0) return defaultState(chat, char, { ...options, scopeKey });
            const parsed = parseJsonSafeV42(lorebook[idx]?.content || '{}', null);
            if (!parsed || typeof parsed !== 'object') return defaultState(chat, char, { ...options, scopeKey });
            const chatId = String(parsed?.chatId || options?.chatId || chat?.id || '').trim();
            return {
                ...defaultState(chat, char, { ...options, scopeKey, chatId }),
                ...parsed,
                version: V42_TURN_RECORD_VERSION,
                recordFormat: V42_TURN_RECORD_FORMAT,
                scopeKey,
                chatId,
                records: (Array.isArray(parsed?.records) ? parsed.records : [])
                    .map(record => hydrateStoredRecord(record, chat, char, { ...options, scopeKey, chatId }))
                    .filter(record => normalizeLegacyMemoryTurnAnchor(record?.turn) > 0)
            };
        };

        const normalizeRecord = (record = {}, chat = null, char = null, options = {}) => ({
            ...hydrateStoredRecord(record, chat, char, options),
            finalizedAt: Number(record?.finalizedAt || Date.now()),
            updatedAt: Date.now()
        });

        const compactRecordForStorage = (record = {}, chat = null, char = null, options = {}) => {
            const normalized = hydrateStoredRecord(record, chat, char, options);
            if (normalized.turn <= 0) return null;
            const liveMessageIds = normalizeCanonicalMessageIds(normalized.liveMessageIds || normalized.sourceMessageIds || normalized.messageId);
            const messageId = getPrimaryCanonicalMessageId(liveMessageIds, true) || normalized.messageId || null;
            const out = { turn: normalized.turn };
            if (normalized.turnKey) out.turnKey = normalized.turnKey;
            if (normalized.userTurnKey) out.userTurnKey = normalized.userTurnKey;
            if (normalized.sourceHash) out.sourceHash = normalized.sourceHash;
            if (normalized.aiHash && normalized.aiHash !== normalized.sourceHash) out.aiHash = normalized.aiHash;
            if (messageId) out.messageId = messageId;
            if (liveMessageIds.length > 1) out.liveMessageIds = liveMessageIds;
            if (normalized.memoryKey) out.memoryKey = normalized.memoryKey;
            if (normalized.userPreview) out.userPreview = normalized.userPreview.slice(0, 90);
            if (normalized.aiPreview) out.aiPreview = normalized.aiPreview.slice(0, 120);
            if (normalized.status && normalized.status !== 'active') out.status = normalized.status;
            if (normalized.reason && normalized.reason !== 'afterRequest-finalized') out.reason = normalized.reason;
            if (normalized.runtimeMode && normalized.runtimeMode !== 'turn-anchor') out.runtimeMode = normalized.runtimeMode;
            if (normalized.runtimeReliability && normalized.runtimeReliability !== 'normal') out.runtimeReliability = normalized.runtimeReliability;
            if (normalized.finalizedAt > 0) out.finalizedAt = normalized.finalizedAt;
            if (normalized.status === 'deleted') {
                if (normalized.deletedAt > 0) out.deletedAt = normalized.deletedAt;
                if (normalized.deletionReason) out.deletionReason = normalized.deletionReason;
            }
            if (normalized.status === 'superseded') {
                if (normalized.supersededAt > 0) out.supersededAt = normalized.supersededAt;
                if (normalized.supersededBy) out.supersededBy = normalized.supersededBy;
                if (normalized.supersededByHash) out.supersededByHash = normalized.supersededByHash;
                if (normalized.supersededByTurnKey) out.supersededByTurnKey = normalized.supersededByTurnKey;
                if (normalized.supersedeReason) out.supersedeReason = normalized.supersedeReason;
            }
            return out;
        };

        const saveState = (lorebook = [], state = {}, chat = null, char = null, options = {}) => {
            if (!Array.isArray(lorebook)) return false;
            const scopeKey = getScopeKey(chat, char, options);
            const compactRecords = (Array.isArray(state?.records) ? state.records : [])
                .map(record => hydrateStoredRecord(record, chat, char, { ...options, scopeKey }))
                .filter(item => normalizeLegacyMemoryTurnAnchor(item?.turn) > 0)
                .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0))
                .slice(-V42_TURN_RECORD_LIMIT)
                .map(record => compactRecordForStorage(record, chat, char, { ...options, scopeKey }))
                .filter(Boolean);
            const normalized = {
                ...defaultState(chat, char, { ...options, scopeKey }),
                ...state,
                version: V42_TURN_RECORD_VERSION,
                kind: 'v42_turn_records',
                recordFormat: V42_TURN_RECORD_FORMAT,
                scopeKey,
                chatId: String(state?.chatId || chat?.id || '').trim(),
                updatedAt: Date.now(),
                records: compactRecords
            };
            const entry = {
                key: `lmai_turn_records::${stableHash(scopeKey)}`,
                comment: V42_TURN_RECORD_COMMENT,
                content: JSON.stringify(normalized),
                mode: 'normal',
                insertorder: 110,
                alwaysActive: false,
                memo: 'LIBRA V4.2 turn anchor ledger'
            };
            const idx = findIndex(lorebook, scopeKey);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
            return true;
        };

        const upsertRecord = (lorebook = [], record = {}, chat = null, char = null, options = {}) => {
            if (!Array.isArray(lorebook)) return null;
            const normalized = normalizeRecord(record, chat, char, options);
            if (normalized.turn <= 0 || !normalized.sourceHash) return null;
            const state = loadState(lorebook, chat, char, options);
            const idx = state.records.findIndex(existing => {
                if (existing?.turnKey && normalized.turnKey && existing.turnKey === normalized.turnKey) return true;
                if (hasCanonicalMessageIdOverlap(existing?.liveMessageIds || existing?.sourceMessageIds || existing?.messageId, normalized.liveMessageIds)) return true;
                const sameTurn = normalizeLegacyMemoryTurnAnchor(existing?.turn) === normalized.turn && normalized.turn > 0;
                if (sameTurn && existing?.sourceHash && normalized.sourceHash && existing.sourceHash === normalized.sourceHash) return true;
                return sameTurn;
            });
            if (idx >= 0) state.records[idx] = { ...state.records[idx], ...normalized, updatedAt: Date.now() };
            else state.records.push(normalized);
            saveState(lorebook, state, chat, char, options);
            return normalized;
        };

        const markDeleted = (lorebook = [], record = {}, chat = null, char = null, options = {}) => {
            if (!Array.isArray(lorebook)) return false;
            const state = loadState(lorebook, chat, char, options);
            const normalized = normalizeRecord({ ...record, status: 'deleted', reason: record?.reason || 'live-message-deleted' }, chat, char, options);
            let changed = false;
            for (const existing of state.records) {
                const turnMatch = normalized.turn > 0 && normalizeLegacyMemoryTurnAnchor(existing?.turn) === normalized.turn;
                const hashMatch = normalized.sourceHash && existing?.sourceHash === normalized.sourceHash;
                const idMatch = hasCanonicalMessageIdOverlap(existing?.liveMessageIds || existing?.sourceMessageIds || existing?.messageId, normalized.liveMessageIds);
                if (!turnMatch && !hashMatch && !idMatch) continue;
                existing.status = 'deleted';
                existing.deletedAt = Date.now();
                existing.deletionReason = String(record?.reason || 'live-message-deleted').trim();
                existing.updatedAt = Date.now();
                changed = true;
            }
            if (!changed && normalized.turn > 0) {
                state.records.push({ ...normalized, status: 'deleted', deletedAt: Date.now(), deletionReason: String(record?.reason || 'live-message-deleted') });
                changed = true;
            }
            if (changed) saveState(lorebook, state, chat, char, options);
            return changed;
        };

        const markSuperseded = (lorebook = [], record = {}, chat = null, char = null, options = {}) => {
            if (!Array.isArray(lorebook)) return false;
            const state = loadState(lorebook, chat, char, options);
            const normalized = normalizeRecord({ ...record, status: 'superseded', reason: record?.reason || 'same-user-turn-replaced' }, chat, char, options);
            const supersededAt = Date.now();
            let changed = false;
            for (const existing of state.records) {
                const existingHash = String(existing?.sourceHash || existing?.aiHash || '').trim();
                const existingTurnKey = String(existing?.turnKey || '').trim();
                const existingUserTurnKey = String(existing?.userTurnKey || '').trim();
                const incomingHash = String(normalized?.sourceHash || normalized?.aiHash || '').trim();
                const incomingTurnKey = String(normalized?.turnKey || '').trim();
                const hashMatch = incomingHash && existingHash && existingHash === incomingHash;
                const turnKeyMatch = incomingTurnKey && existingTurnKey && existingTurnKey === incomingTurnKey;
                const idMatch = hasCanonicalMessageIdOverlap(existing?.liveMessageIds || existing?.sourceMessageIds || existing?.messageId, normalized.liveMessageIds);
                const sameUserTurn = existingUserTurnKey && normalized.userTurnKey && existingUserTurnKey === normalized.userTurnKey;
                if (!hashMatch && !turnKeyMatch && !idMatch) continue;
                if (!sameUserTurn && normalized.userTurnKey) continue;
                existing.status = 'superseded';
                existing.supersededAt = supersededAt;
                existing.supersededBy = String(record?.supersededBy || '').trim();
                existing.supersededByHash = String(record?.supersededByHash || '').trim();
                existing.supersededByTurnKey = String(record?.supersededByTurnKey || '').trim();
                existing.supersedeReason = String(record?.reason || 'same-user-turn-replaced').trim();
                existing.updatedAt = supersededAt;
                changed = true;
            }
            if (!changed && normalized.turn > 0) {
                state.records.push({
                    ...normalized,
                    status: 'superseded',
                    supersededAt,
                    supersededBy: String(record?.supersededBy || '').trim(),
                    supersededByHash: String(record?.supersededByHash || '').trim(),
                    supersededByTurnKey: String(record?.supersededByTurnKey || '').trim(),
                    supersedeReason: String(record?.reason || 'same-user-turn-replaced').trim()
                });
                changed = true;
            }
            if (changed) saveState(lorebook, state, chat, char, options);
            return changed;
        };

        const deriveMaxTurn = (lorebook = [], chat = null, char = null, options = {}) => {
            const state = loadState(lorebook, chat, char, options);
            return Math.max(0, ...state.records
                .filter(item => !['deleted', 'superseded'].includes(String(item?.status || 'active')))
                .map(item => normalizeLegacyMemoryTurnAnchor(item?.turn)));
        };

        return Object.freeze({ loadState, saveState, upsertRecord, markDeleted, markSuperseded, deriveMaxTurn, normalizeRecord });
    })();

    const markLiveSyncSnapshot = (chat, extra = {}) => {
        if (!chat) return null;
        const scopeKey = getChatMemoryScopeKey(chat);
        const latest = buildLatestAssistantSnapshot(chat, { includeStableId: true });
        const pending = MemoryState.pendingTurnCommits.get(scopeKey) || null;
        const snapshot = {
            checkedAt: Date.now(),
            messageCount: Number(latest.currentMessageCount || 0),
            latestMsgId: String(latest.latestLiveId || latest.latestStableId || '').trim(),
            latestMsgSignature: String(latest.latestMessageSignature || '').trim(),
            latestAiId: String(latest.latestLiveId || latest.latestStableId || '').trim(),
            latestAiSignature: String(latest.latestMessageSignature || '').trim(),
            latestAiHash: String(latest.latestHash || '').trim(),
            pendingKey: String(pending?.turnKey || pending?.aiHash || '').trim(),
            ...extra
        };
        MemoryState.liveSyncStateByScope.set(scopeKey, snapshot);
        return snapshot;
    };

    const getTurnMaintenanceChatId = (chat = null) => {
        const direct = String(chat?.id || '').trim();
        if (direct) return direct;
        try {
            return String(getActiveManagedChatId?.() || '').trim() || 'global';
        } catch {
            return 'global';
        }
    };

    const normalizeMaintenanceList = (value = null) => {
        if (value instanceof Set) return Array.from(value).map(v => String(v || '').trim()).filter(Boolean);
        if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
        return [];
    };

    const unionMaintenanceList = (a = null, b = null) => Array.from(new Set([
        ...normalizeMaintenanceList(a),
        ...normalizeMaintenanceList(b)
    ]));

    const mergeTurnMaintenanceState = (previousState = null, nextState = null) => {
        if (!previousState) return nextState;
        if (!nextState) return previousState;
        const merged = { ...nextState };
        const entitiesToConsolidate = unionMaintenanceList(previousState.entitiesToConsolidate, nextState.entitiesToConsolidate);
        const involvedEntities = unionMaintenanceList(previousState.involvedEntities, nextState.involvedEntities);
        if (entitiesToConsolidate.length > 0) merged.entitiesToConsolidate = entitiesToConsolidate;
        if (involvedEntities.length > 0) merged.involvedEntities = involvedEntities;
        return merged;
    };

    const mergeTurnMaintenanceRecord = (previous = null, next = null) => {
        if (!previous) return next;
        if (!next) return previous;
        return {
            ...previous,
            ...next,
            turnState: mergeTurnMaintenanceState(previous.turnState, next.turnState),
            coalescedCount: Math.max(1, Number(previous.coalescedCount || 1)) + 1,
            coalescedFromTurns: Array.from(new Set([
                ...(Array.isArray(previous.coalescedFromTurns) ? previous.coalescedFromTurns : [previous.turnForMaintenance]),
                next.turnForMaintenance
            ].map(turn => Number(turn || 0)).filter(turn => turn > 0)))
        };
    };

    const buildTurnMaintenanceRecord = (char, chat, turnState, aiResponse, turnForMaintenance, maintenanceConfig) => ({
        char,
        chat,
        chatId: getTurnMaintenanceChatId(chat),
        scopeKey: getChatRuntimeScopeKey(chat, char) || getChatMemoryScopeKey(chat),
        turnState,
        aiResponse,
        turnForMaintenance,
        maintenanceConfig: maintenanceConfig || MemoryEngine.CONFIG,
        createdAt: Date.now(),
        coalescedCount: 1,
        coalescedFromTurns: [Number(turnForMaintenance || 0)].filter(Boolean)
    });

    const updateTurnMaintenanceActivity = (record = null, patch = {}) => {
        const activityContext = record?.activityContext || null;
        if (!activityContext) return;
        try {
            ActivityDashboardCore.update(activityContext, {
                phase: 'afterRequest:maintenance',
                status: patch.status || 'running',
                progress: patch.progress,
                step: patch.step || '후처리 분석',
                stepStatus: patch.stepStatus || 'running',
                activeTask: patch.activeTask || patch.step || '후처리 분석',
                postprocessPhase: patch.postprocessPhase || 'afterRequest:maintenance',
                postprocessDetail: patch.postprocessDetail || patch.message || '',
                message: patch.message || patch.postprocessDetail || ''
            });
        } catch (error) {
            recordSuppressedRuntimeError('turn_maintenance.activity_update', error, {
                step: patch.step || '',
                activeTask: patch.activeTask || ''
            });
        }
    };

    const runTurnMaintenanceRecord = async (record = null) => {
        if (!record) return { skipped: true, reason: 'missing-record' };
        const { char, chat, aiResponse, turnForMaintenance } = record;
        let turnState = record.turnState || {};
        const maintenanceConfig = record.maintenanceConfig || MemoryEngine.CONFIG;
        if (isLibraManualOocPauseEnabled(maintenanceConfig || MemoryEngine.CONFIG)) return { skipped: true, reason: 'manual-ooc-pause' };
            const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            try {
                updateTurnMaintenanceActivity(record, {
                    progress: 74,
                    step: '후처리 분석',
                    activeTask: '턴 상태 분석',
                    postprocessDetail: '커밋된 턴의 엔티티 후보와 내러티브 상태를 확인합니다.',
                    message: '커밋된 턴 상태를 분석하고 있습니다.'
                });
                let latestLoreForCorrection = MemoryEngine.getLorebook(char, chat);
                if (turnState?.analysisPending === true) {
                    updateTurnMaintenanceActivity(record, {
                        progress: 78,
                        step: '후처리 분석',
                        activeTask: '엔티티/내러티브 보강',
                        postprocessDetail: '빠른 커밋으로 남겨둔 턴 상태를 정밀 분석으로 보강합니다.',
                        message: '턴 상태 보강 분석을 진행합니다.'
                    });
                    turnState = await analyzeCommittedTurnState(
                        char,
                        chat,
                        latestLoreForCorrection,
                        turnState,
                        aiResponse,
                        turnForMaintenance,
                        maintenanceConfig
                    );
                    latestLoreForCorrection = MemoryEngine.getLorebook(char, chat);
                }
                updateTurnMaintenanceActivity(record, {
                    progress: 82,
                    step: '후처리 분석',
                    activeTask: turnState?.precomputedMaintenance ? '통합 분석 정리' : '번들 분석',
                    postprocessDetail: '메모리/엔티티/월드/내러티브 후처리 결과를 계산합니다.',
                    message: turnState?.precomputedMaintenance
                        ? '통합 분석 결과를 후처리 상태로 정리합니다.'
                        : '후처리 번들 분석을 실행하고 있습니다.'
                });
                let bundledMaintenance = turnState?.precomputedMaintenance || await TurnMaintenanceOptimizer.run(
                        turnForMaintenance,
                        turnState,
                        aiResponse,
                        MemoryEngine.getEffectiveLorebook(char, chat),
                        maintenanceConfig
                    );
                const bundledBrief = String(bundledMaintenance?.narrativeBrief || '').trim();
                if (bundledBrief) {
                    NarrativeTracker.correctTurn(turnForMaintenance, {
                        summary: bundledBrief,
                        entities: turnState.involvedEntities || [],
                        storyAuthor: bundledMaintenance?.storyAuthor || null,
                        storylineName: bundledMaintenance?.storyAuthor?.currentArc || '',
                        narrativeGoal: bundledMaintenance?.storyAuthor?.narrativeGoal || '',
                        keyPoints: [
                            ...(Array.isArray(bundledMaintenance?.storyAuthor?.nextBeats) ? bundledMaintenance.storyAuthor.nextBeats : []),
                            ...(Array.isArray(bundledMaintenance?.storyAuthor?.recentDecisions) ? bundledMaintenance.storyAuthor.recentDecisions : [])
                        ],
                        ongoingTensions: Array.isArray(bundledMaintenance?.storyAuthor?.activeTensions) ? bundledMaintenance.storyAuthor.activeTensions : []
                    });
                }
                updateTurnMaintenanceActivity(record, {
                    progress: 88,
                    step: '후처리 분석',
                    activeTask: '분석 결과 반영 준비',
                    postprocessDetail: '스토리 작가/감독, 엔티티 보정, 흡수 병합 계획을 정리합니다.',
                    message: '분석 결과를 각 매니저에 반영할 준비를 합니다.'
                });
                const correctionResult = await applyTurnStateCorrections(
                    turnState,
                    aiResponse,
                    turnForMaintenance,
                    maintenanceConfig,
                    latestLoreForCorrection,
                    bundledMaintenance?.correctionReviewed === true ? (bundledMaintenance?.correction || null) : undefined
                );
                try {
                    const packet = bundledMaintenance?.canonicalPacket && typeof bundledMaintenance.canonicalPacket === 'object'
                        ? bundledMaintenance.canonicalPacket
                        : null;
                    const packetWorld = packet?.world && typeof packet.world === 'object' ? packet.world : null;
                    const packetWorldState = packetWorld?.state && typeof packetWorld.state === 'object' ? packetWorld.state : {};
                    const packetSceneTime = String(packetWorldState.time || packetWorld?.time || '').replace(/\s+/g, ' ').trim();
                    const packetSceneLocation = String(packetWorldState.location || packetWorld?.location || '').replace(/\s+/g, ' ').trim();
                    const packetScene = String(packetWorldState.scene || packetWorld?.scene || '').replace(/\s+/g, ' ').trim();
                    const packetActiveEvents = Array.isArray(packetWorldState.active_events)
                        ? packetWorldState.active_events
                        : (Array.isArray(packetWorldState.activeEvents) ? packetWorldState.activeEvents : (Array.isArray(packetWorld?.active_events) ? packetWorld.active_events : packetWorld?.activeEvents));
                    const packetOffscreenThreads = Array.isArray(packetWorldState.offscreen_threads)
                        ? packetWorldState.offscreen_threads
                        : (Array.isArray(packetWorldState.offscreenThreads) ? packetWorldState.offscreenThreads : (Array.isArray(packetWorld?.offscreen_threads) ? packetWorld.offscreen_threads : packetWorld?.offscreenThreads));
                    if (packetSceneTime) {
                        const focusedEntities = Array.isArray(turnState.involvedEntities)
                            ? turnState.involvedEntities.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean)
                            : [];
                        TimeEngine.ingestLiveTurn(
                            focusedEntities,
                            '',
                            `Turn ${turnForMaintenance} canonical packet scene time`,
                            { sceneTimeLabel: packetSceneTime }
                        );
                        const timeState = TimeEngine.getState?.() || {};
                        NarrativeTracker.correctTurn(turnForMaintenance, {
                            sceneDate: timeState.currentDate || '',
                            sceneTime: timeState.currentTime || '',
                            sceneTimeLabel: timeState.currentLabel || packetSceneTime
                        });
                    }
                    if (packetSceneTime || packetSceneLocation || packetScene || (Array.isArray(packetActiveEvents) && packetActiveEvents.length) || (Array.isArray(packetOffscreenThreads) && packetOffscreenThreads.length)) {
                        const worldProfile = HierarchicalWorldManager.getProfile?.() || {};
                        const currentNode = HierarchicalWorldManager.getCurrentNode?.();
                        const currentMeta = currentNode?.meta || {};
                        const currentRules = HierarchicalWorldManager.getCurrentRules?.() || {};
                        WorldStateTracker.replaceState(turnForMaintenance, {
                            activePath: worldProfile?.activePath || [],
                            rules: currentRules,
                            global: worldProfile?.global || {},
                            classification: String(currentMeta.classification || currentMeta.worldMetadata?.classification || packetWorld?.classification?.primary || '').trim(),
                            worldSummary: String(currentMeta.worldSummary || currentMeta.worldMetadata?.summary || packetWorld?.summary || '').trim(),
                            currentTime: packetSceneTime,
                            currentLocation: packetSceneLocation,
                            currentScene: packetScene,
                            activeEvents: packetActiveEvents,
                            offscreenThreads: packetOffscreenThreads,
                            ruleHighlights: extractWorldRuleHighlights(currentRules, 6),
                            notes: packetSceneTime ? `Canonical packet scene time: ${packetSceneTime}` : ''
                        });
                    }
                } catch (timePacketError) {
                    if (maintenanceConfig.debug) recordRuntimeDebug('warn', '[LIBRA] Canonical packet time/world-state projection skipped:', timePacketError?.message || timePacketError);
                }
                try {
                    const authorPayload = {
                        turn: turnForMaintenance,
                        userMsg: '',
                        aiResponse,
                        isEmptyInput: !String(turnState.strictUserMsg || '').trim(),
                        focusedEntities: Array.isArray(turnState.involvedEntities)
                            ? turnState.involvedEntities.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean).slice(0, 6)
                            : [],
                        worldPrompt: HierarchicalWorldManager.formatForPrompt(),
                        worldStatePrompt: WorldStateTracker.formatForPrompt(),
                        narrativePrompt: NarrativeTracker.formatForPrompt(),
                        recentTurns: (NarrativeTracker.getState()?.turnLog || []).slice(-8).map(t => `Turn ${t.turn}: ${t.summary || t.response || t.responseBrief || ''}`)
                    };
                    StoryAuthor.applyPlanState?.(turnForMaintenance, bundledMaintenance?.storyAuthor || null, authorPayload, maintenanceConfig);
                    Director.applyDirectiveState?.(turnForMaintenance, bundledMaintenance?.director || null, {
                        ...authorPayload,
                        storyAuthorPrompt: StoryAuthor.formatForPrompt?.() || ''
                    }, maintenanceConfig);
                } catch (orchestrationError) {
                    if (maintenanceConfig.debug) recordRuntimeDebug('warn', '[LIBRA] Story author/director update skipped:', orchestrationError?.message || orchestrationError);
                }
                const absorptionPlans = await EntityAwareProcessor.planPendingEntityAbsorptions(
                    latestLoreForCorrection,
                    maintenanceConfig,
                    { maxTasks: 1, turn: turnForMaintenance, preserveLiveEntityCache: true }
                );
                const entityNamesForMaintenance = Array.from(turnState.entitiesToConsolidate || []);
                updateTurnMaintenanceActivity(record, {
                    progress: 92,
                    step: '후처리 분석',
                    activeTask: '엔티티/월드/내러티브 반영',
                    postprocessDetail: '요약, 엔티티 상태, 월드 상태 통합 작업을 실행합니다.',
                    message: '엔티티/월드/내러티브 상태를 반영하고 있습니다.'
                });
                const stateConsolidationTask = (typeof StateConsolidationBundler !== 'undefined' && StateConsolidationBundler?.consolidateIfNeeded)
                    ? StateConsolidationBundler.consolidateIfNeeded(entityNamesForMaintenance, turnForMaintenance, maintenanceConfig)
                    : Promise.allSettled([
                        ...entityNamesForMaintenance.map(name =>
                            CharacterStateTracker.consolidateIfNeeded(name, turnForMaintenance, maintenanceConfig)
                        ),
                        WorldStateTracker.consolidateIfNeeded(turnForMaintenance, maintenanceConfig)
                    ]);
                await Promise.allSettled([
                    NarrativeTracker.summarizeIfNeeded(turnForMaintenance, maintenanceConfig),
                    stateConsolidationTask
                ]);

                updateTurnMaintenanceActivity(record, {
                    progress: 96,
                    step: '최종 저장',
                    activeTask: '최종 저장',
                    postprocessPhase: 'afterRequest:maintenance',
                    postprocessDetail: '후처리 결과를 로어북과 각 상태 저장소에 기록합니다.',
                    message: '후처리 결과를 최종 저장하고 있습니다.'
                });
                await loreLock.writeLock();
                let absorptionAppliedCount = 0;
                try {
                    const latestChar = await requireLoadedCharacter();
                    const latestChat = await getActiveChatForCharacter(latestChar);
                    if (!latestChat) return;
                    const latestLore = [...MemoryEngine.getLorebook(latestChar, latestChat)];
                    const scopeKey = getChatRuntimeScopeKey(latestChat, latestChar);
                    const chatId = String(latestChat?.id || getActiveManagedChatId() || '').trim();

                    try {
                        const packetForEntityMaterialization = bundledMaintenance?.canonicalPacket && typeof bundledMaintenance.canonicalPacket === 'object'
                            ? bundledMaintenance.canonicalPacket
                            : null;
                        const extractionForEntityMaterialization = bundledMaintenance?.entityExtraction && typeof bundledMaintenance.entityExtraction === 'object'
                            ? bundledMaintenance.entityExtraction
                            : null;
                        let materializedExtraction = null;
                        if (packetForEntityMaterialization && EntityAwareProcessor?.extractStructuredEntitySignalsFromPackets) {
                            materializedExtraction = EntityAwareProcessor.extractStructuredEntitySignalsFromPackets(packetForEntityMaterialization, {
                                lorebook: latestLore,
                                conversationText: aiResponse || '',
                                sourceMessageId: turnState?.m_id || record?.m_id || '',
                                turn: turnForMaintenance
                            });
                        }
                        if (extractionForEntityMaterialization) {
                            const packetEntities = Array.isArray(materializedExtraction?.entities) ? materializedExtraction.entities : [];
                            materializedExtraction = {
                                ...(materializedExtraction || { success: false, entities: [], relations: [], world: {}, conflicts: [] }),
                                entities: dedupeTextArray([
                                    ...packetEntities.map(entity => entity?.name).filter(Boolean),
                                    ...(Array.isArray(extractionForEntityMaterialization.entities) ? extractionForEntityMaterialization.entities.map(entity => entity?.name).filter(Boolean) : [])
                                ]).map(name => {
                                    const packetEntity = packetEntities.find(entity => String(entity?.name || '').trim() === String(name || '').trim());
                                    const llmEntity = (Array.isArray(extractionForEntityMaterialization.entities) ? extractionForEntityMaterialization.entities : [])
                                        .find(entity => String(entity?.name || '').trim() === String(name || '').trim());
                                    return { ...(packetEntity || {}), ...(llmEntity || {}), name };
                                }),
                                relations: [
                                    ...((Array.isArray(materializedExtraction?.relations) ? materializedExtraction.relations : [])),
                                    ...((Array.isArray(extractionForEntityMaterialization.relations) ? extractionForEntityMaterialization.relations : []))
                                ],
                                world: {
                                    ...((materializedExtraction?.world && typeof materializedExtraction.world === 'object') ? materializedExtraction.world : {}),
                                    ...((extractionForEntityMaterialization.world && typeof extractionForEntityMaterialization.world === 'object') ? extractionForEntityMaterialization.world : {})
                                },
                                conflicts: [
                                    ...((Array.isArray(materializedExtraction?.conflicts) ? materializedExtraction.conflicts : [])),
                                    ...((Array.isArray(extractionForEntityMaterialization.conflicts) ? extractionForEntityMaterialization.conflicts : []))
                                ],
                                sourceMode: extractionForEntityMaterialization.sourceMode || bundledMaintenance?.entitySourceMode || materializedExtraction?.sourceMode || 'structured_packet',
                                packetEvidenceEntities: [
                                    ...packetEntities,
                                    ...(Array.isArray(extractionForEntityMaterialization.packetEvidenceEntities) ? extractionForEntityMaterialization.packetEvidenceEntities : [])
                                ],
                                conversationText: aiResponse || materializedExtraction?.conversationText || ''
                            };
                            materializedExtraction.success = materializedExtraction.entities.length > 0
                                || materializedExtraction.relations.length > 0
                                || !!(materializedExtraction.world && Object.keys(materializedExtraction.world).length > 0);
                        }
                        if (materializedExtraction?.success) {
                            const sanitizedMaterializedExtraction = EntityAwareProcessor.sanitizeExtractionPayload(materializedExtraction, latestLore, {
                                sourceMode: materializedExtraction.sourceMode || 'structured_packet',
                                conversationText: aiResponse || materializedExtraction.conversationText || '',
                                requireConversationEvidenceForNew: false,
                                packetEvidenceEntities: materializedExtraction.packetEvidenceEntities || materializedExtraction.entities || []
                            });
                            if (sanitizedMaterializedExtraction?.entities?.length || sanitizedMaterializedExtraction?.relations?.length || sanitizedMaterializedExtraction?.world) {
                                await EntityAwareProcessor.applyExtractions(sanitizedMaterializedExtraction, latestLore, maintenanceConfig, turnState?.m_id || record?.m_id || null);
                            }
                        }
                    } catch (materializeError) {
                        if (maintenanceConfig.debug) recordRuntimeDebug('warn', '[LIBRA] Live packet entity materialization skipped:', materializeError?.message || materializeError);
                    }

                    if (Array.isArray(absorptionPlans) && absorptionPlans.length > 0) {
                        EntityManager.rebuildCache(latestLore);
                        for (const plan of absorptionPlans) {
                            const applied = EntityManager.applyEntityAbsorption(plan, latestLore, {
                                source: 'turn_maintenance_absorption'
                            });
                            if (!applied?.ok) {
                                if (maintenanceConfig.debug) recordRuntimeDebug('warn', '[LIBRA] Entity absorption apply skipped:', applied?.reason || 'unknown');
                                continue;
                            }
                            absorptionAppliedCount += 1;
                            const oldViewerId = SecretKnowledgeCore.entityViewerId?.(applied.sourceName) || `entity:${applied.sourceName}`;
                            const newViewerId = `entity:${applied.targetName}`;
                            const renameContext = {
                                oldName: applied.sourceName,
                                newName: applied.targetName,
                                oldViewerId,
                                newViewerId,
                                previousNames: applied.previousNames || [applied.sourceName],
                                absorptionId: applied.id
                            };
                            SecretKnowledgeCore.renameEntityReferences?.(renameContext);
                            EntityKnowledgeVaultCore.renameEntityViewer?.(renameContext);
                            TimeEngine.renameEntityAnchor?.(applied.sourceName, applied.targetName, {
                                oldKey: String(applied.sourceName || '').toLowerCase(),
                                newKey: String(applied.targetName || '').toLowerCase()
                            });
                            NarrativeTracker.renameEntityReferences?.(applied.sourceName, applied.targetName, renameContext);
                            StoryAuthor.renameEntityReferences?.(applied.sourceName, applied.targetName, renameContext);
                            Director.renameEntityReferences?.(applied.sourceName, applied.targetName, renameContext);
                            CharacterStateTracker.renameEntityKey?.(applied.sourceName, applied.targetName, renameContext);
                            MemoryEngine.renameEntityReferencesInLore?.(latestLore, applied.sourceName, applied.targetName, {
                                ...renameContext,
                                scopeKey,
                                currentTurn: MemoryEngine.getCurrentTurn?.() || turnForMaintenance || 0,
                                rewriteAliases: false,
                                structuredOnly: true
                            });
                            RPContinuityCore.renameEntityReferences?.(latestLore, applied.sourceName, applied.targetName);
                        }
                    }

                    if (maintenanceConfig.rpLongTermMemoryEnabled !== false) {
                        try {
                            const rpUpdate = RPContinuityCore.enrichCommittedTurn(
                                latestLore,
                                turnForMaintenance,
                                bundledMaintenance?.longTermMemory || null,
                                {
                                    userText: '',
                                    aiText: aiResponse || '',
                                    entityRefs: turnState.involvedEntities || [],
                                    source: maintenanceConfig.rpLongTermLlmEnrichment === false ? 'maintenance_heuristic' : 'maintenance_llm',
                                    config: maintenanceConfig
                                }
                            );
                            if (Array.isArray(rpUpdate?.changedEntries) && rpUpdate.changedEntries.length > 0) {
                                MemoryEngine.upsertHybridScopeIndexRows(latestLore, rpUpdate.changedEntries, {
                                    scopeKey,
                                    currentTurn: turnForMaintenance,
                                    reason: 'rp-long-term-enrichment'
                        });
                            }
                        } catch (error) {
                            if (maintenanceConfig.debug) recordRuntimeDebug('warn', '[LIBRA][RP-LTM] maintenance enrichment skipped:', error?.message || error);
                        }
                    }

                    HierarchicalWorldManager.saveWorldGraphUnsafe(latestLore);
                    await EntityManager.saveToLorebook(latestChar, latestChat, latestLore);
                    await NarrativeTracker.saveState(latestLore);
                    await StoryAuthor.saveState?.(latestLore);
                    await Director.saveState?.(latestLore);
                    await CharacterStateTracker.saveState(latestLore);
                    await WorldStateTracker.saveState(latestLore);
                    await SecretKnowledgeCore.saveState(latestLore, {
                        scopeKey,
                        chatId
                    });
                    await EntityKnowledgeVaultCore.saveState(latestLore, {
                        scopeKey,
                        chatId
                    });
                    await TimeEngine.saveState(latestLore, {
                        scopeKey,
                        chatId
                    });

                    MemoryEngine.setLorebook(latestChar, latestChat, latestLore);
                    await persistLoreToActiveChat(latestChat, latestLore, {});
                    updateTurnMaintenanceActivity(record, {
                        progress: 98,
                        step: '최종 저장',
                        stepStatus: 'done',
                        activeTask: '최종 저장 완료',
                        postprocessPhase: 'afterRequest:maintenance',
                        postprocessDetail: '로어북과 상태 저장을 완료했습니다.',
                        message: '후처리 결과 저장을 완료했습니다.'
                    });
                } finally {
                    loreLock.writeUnlock();
                }
                const maintenanceToasts = [];
                if (absorptionAppliedCount > 0) maintenanceToasts.push('엔티티 흡수 병합을 완료했습니다.');
                if (entityNamesForMaintenance.length > 0 || correctionResult?.corrected) maintenanceToasts.push('엔티티 정리를 완료했습니다.');
                maintenanceToasts.push('월드 정리를 완료했습니다.', '내러티브 정리를 완료했습니다.');
                LibraToast.sequence(maintenanceToasts, { keyPrefix: `libra-maintenance-${turnForMaintenance}`, duration: 1250, gap: 900 });
                if (maintenanceConfig.debug) {
                    const finishedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    recordRuntimeDebug('log', `[LIBRA] Background maintenance complete | turn=${turnForMaintenance} | duration=${Math.max(0, Math.round(finishedAt - startedAt))}ms | llmPending=${MaintenanceLLMQueue.pendingCount} | llmActive=${MaintenanceLLMQueue.activeCount}`);
                }
            } catch (bgErr) {
                updateTurnMaintenanceActivity(record, {
                    status: 'failed',
                    progress: 96,
                    step: '후처리 분석',
                    stepStatus: 'failed',
                    activeTask: '후처리 분석 실패',
                    postprocessDetail: bgErr?.message || String(bgErr || 'unknown'),
                    message: `후처리 분석 실패: ${bgErr?.message || bgErr}`
                });
                recordRuntimeDebug('error', '[LIBRA] Background maintenance error:', bgErr?.message || bgErr);
            }
        return { status: 'done', turn: turnForMaintenance };
    };

    const clearTurnMaintenanceScheduleTimer = (entry = null) => {
        if (!entry?.timer) return;
        try { clearTimeout(entry.timer); } catch (error) {
            recordSuppressedRuntimeError('turn_maintenance.clear_timer', error, { chatId: entry.chatId || '' });
        }
        entry.timer = null;
    };

    const enqueueTurnMaintenanceEntry = (entry = null) => {
        if (!entry || entry.queued || entry.running || !entry.latest) return;
        const queuedTurn = Number(entry.latest?.turnForMaintenance || 0);
        entry.queued = true;
        BackgroundMaintenanceQueue.enqueue(async () => {
            entry.queued = false;
            entry.running = true;
            const record = entry.latest;
            entry.latest = null;
            try {
                return await runTurnMaintenanceRecord(record);
            } finally {
                entry.running = false;
                entry.lastFinishedAt = Date.now();
                const deferredRecord = entry.latest;
                entry.latest = null;
                if (deferredRecord) {
                    scheduleTurnMaintenanceRecord(deferredRecord, { reason: 'post-run-coalesced' });
                }
            }
        }, `afterRequest-turn-${queuedTurn}`).catch(e => {
            entry.queued = false;
            entry.running = false;
            recordRuntimeDebug('error', '[LIBRA] Background maintenance queue error:', e?.message || e);
        });
    };

    const scheduleTurnMaintenanceRecord = (record = null, options = {}) => {
        if (!record?.chatId) return;
        const maintenanceConfig = record.maintenanceConfig || MemoryEngine.CONFIG;
        let entry = MemoryState.turnMaintenanceSchedulesByChatId.get(record.chatId);
        if (!entry) {
            entry = {
                chatId: record.chatId,
                timer: null,
                queued: false,
                running: false,
                latest: null,
                lastFinishedAt: 0
            };
            MemoryState.turnMaintenanceSchedulesByChatId.set(record.chatId, entry);
        }
        entry.latest = mergeTurnMaintenanceRecord(entry.latest, record);
        const entityCount = Array.from(entry.latest?.turnState?.entitiesToConsolidate || []).length;
        if (maintenanceConfig?.debug) {
            recordRuntimeDebug('log', `[LIBRA] Scheduling background maintenance | turn=${entry.latest.turnForMaintenance} | entities=${entityCount} | bgPending=${BackgroundMaintenanceQueue.pendingCount} | llmPending=${MaintenanceLLMQueue.pendingCount} | coalesced=${entry.latest.coalescedCount || 1} | reason=${options?.reason || 'schedule'}`);
        }
        if (entry.running || entry.queued) {
            if (maintenanceConfig?.debug) {
                recordRuntimeDebug('log', `[LIBRA] Background maintenance coalesced | chat=${record.chatId} | turn=${entry.latest.turnForMaintenance} | queued=${entry.queued} | running=${entry.running}`);
            }
            return;
        }
        clearTurnMaintenanceScheduleTimer(entry);
        const configuredDelayMs = Math.max(0, Math.min(600000, Number(maintenanceConfig?.backgroundMaintenanceDelayMs ?? 1500) || 0));
        const cooldownRemainingMs = entry.lastFinishedAt
            ? Math.max(0, BACKGROUND_MAINTENANCE_COOLDOWN_MS - (Date.now() - Number(entry.lastFinishedAt || 0)))
            : 0;
        const delayMs = Math.max(configuredDelayMs, BACKGROUND_MAINTENANCE_DEBOUNCE_MS, cooldownRemainingMs);
        if (delayMs > 0 && typeof setTimeout === 'function') {
            entry.timer = setTimeout(() => {
                entry.timer = null;
                enqueueTurnMaintenanceEntry(entry);
            }, delayMs);
        } else {
            enqueueTurnMaintenanceEntry(entry);
        }
    };

    const scheduleTurnMaintenance = (char, chat, turnState, aiResponse, turnForMaintenance, maintenanceConfig) => {
        const effectiveConfig = maintenanceConfig || MemoryEngine.CONFIG;
        if (isLibraManualOocPauseEnabled(effectiveConfig)) {
            if (effectiveConfig?.debug) {
                recordRuntimeDebug('log', `[LIBRA] Background maintenance skipped: manual OOC pause | turn=${turnForMaintenance}`);
            }
            return;
        }
        scheduleTurnMaintenanceRecord(
            buildTurnMaintenanceRecord(char, chat, turnState, aiResponse, turnForMaintenance, effectiveConfig),
            { reason: 'afterRequest' }
        );
    };

    const withTurnMaintenanceLock = async (chatId = 'global', task = async () => {}) => {
        const lockKey = String(chatId || 'global').trim() || 'global';
        const previous = MemoryState.turnMaintenanceLocksByChatId.get(lockKey) || Promise.resolve();
        let current = null;
        current = previous.catch(() => null).then(async () => task());
        MemoryState.turnMaintenanceLocksByChatId.set(lockKey, current);
        try {
            return await current;
        } finally {
            if (MemoryState.turnMaintenanceLocksByChatId.get(lockKey) === current) {
                MemoryState.turnMaintenanceLocksByChatId.delete(lockKey);
            }
        }
    };

    const startCommittedTurnMaintenance = (record = null, options = {}) => {
        if (!record?.chatId) return { mode: 'none', skipped: true, reason: 'missing-record' };
        const config = record.maintenanceConfig || MemoryEngine.CONFIG;
        const mode = normalizeAfterRequestMaintenanceMode(config?.afterRequestMaintenanceMode || DEFAULT_AFTER_REQUEST_MAINTENANCE_MODE);
        if (mode !== 'foreground') {
            scheduleTurnMaintenanceRecord(record, { reason: options?.reason || 'afterRequest' });
            return { mode: 'background', queued: true, turn: Number(record.turnForMaintenance || 0) || 0 };
        }
        const scopeKey = String(record.scopeKey || getChatMemoryScopeKey(record.chat) || record.chatId || 'global').trim() || 'global';
        const activityContext = options?.activityContext || null;
        const task = withTurnMaintenanceLock(record.chatId, async () => {
            try {
                if (activityContext) {
                    ActivityDashboardCore.update(activityContext, {
                        phase: 'afterRequest:maintenance',
                        status: 'running',
                        progress: Math.max(72, Number(MemoryState.activityDashboard?.progress || 0)),
                        step: options?.step || '후처리 분석',
                        stepStatus: 'running',
                        activeTask: options?.step || '후처리 분석',
                        postprocessPhase: 'afterRequest:maintenance',
                        postprocessDetail: options?.message || '엔티티/월드/내러티브 분석을 완료하는 중입니다.',
                        message: options?.message || '엔티티/월드/내러티브 분석을 완료하는 중입니다.'
                    });
                }
            } catch (error) {
                recordSuppressedRuntimeError('turn_maintenance.foreground_start_dashboard', error);
            }
            const result = await runTurnMaintenanceRecord({
                ...record,
                foreground: true,
                foregroundReason: options?.reason || 'afterRequest',
                activityContext
            });
            try {
                if (activityContext) {
                    ActivityDashboardCore.update(activityContext, {
                        phase: 'afterRequest:maintenance',
                        status: 'running',
                        progress: Math.max(94, Number(MemoryState.activityDashboard?.progress || 0)),
                        step: '최종 저장',
                        stepStatus: result?.skipped ? 'skipped' : 'done',
                        activeTask: result?.skipped ? '후처리 분석 건너뜀' : '후처리 분석 완료',
                        postprocessPhase: 'afterRequest:maintenance',
                        postprocessDetail: result?.skipped
                            ? `후처리 분석 건너뜀: ${result.reason || 'skipped'}`
                            : '후처리 분석과 상태 저장을 완료했습니다.',
                        message: result?.skipped
                            ? `턴 분석 건너뜀: ${result.reason || 'skipped'}`
                            : '후처리 분석과 상태 저장을 완료했습니다.'
                    });
                }
            } catch (error) {
                recordSuppressedRuntimeError('turn_maintenance.foreground_finish_dashboard', error);
            }
            return result;
        });
        MemoryState.afterRequestForegroundTasksByScope.set(scopeKey, task);
        task.then(
            () => {
                if (MemoryState.afterRequestForegroundTasksByScope.get(scopeKey) === task) {
                    MemoryState.afterRequestForegroundTasksByScope.delete(scopeKey);
                }
            },
            () => {
                if (MemoryState.afterRequestForegroundTasksByScope.get(scopeKey) === task) {
                    MemoryState.afterRequestForegroundTasksByScope.delete(scopeKey);
                }
            }
        );
        return { mode: 'foreground', task, scopeKey, turn: Number(record.turnForMaintenance || 0) || 0 };
    };

    const awaitCommittedTurnMaintenance = async (started = null, options = {}) => {
        if (!started?.task) return { status: 'none', mode: started?.mode || 'none' };
        const timeoutMs = normalizeAfterRequestForegroundTimeoutMs(options?.timeoutMs ?? MemoryEngine.CONFIG?.afterRequestForegroundTimeoutMs ?? 45000, 45000);
        let timer = null;
        const wait = started.task.then(
            result => ({ status: result?.skipped ? 'skipped' : 'done', result }),
            error => ({ status: 'failed', error: String(error?.message || error || 'unknown') })
        );
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => resolve({ status: 'timeout', timeoutMs }), timeoutMs);
        });
        const result = await Promise.race([wait, timeout]);
        if (timer) {
            try { clearTimeout(timer); } catch (_) {}
        }
        if (result?.status === 'timeout') {
            try {
                const scopeKey = String(started.scopeKey || '').trim();
                if (scopeKey && MemoryState.afterRequestForegroundTasksByScope?.get(scopeKey) === started.task) {
                    MemoryState.afterRequestForegroundTasksByScope.delete(scopeKey);
                }
            } catch (_) {}
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('warn', '[LIBRA] Foreground afterRequest maintenance timed out; detaching task from beforeRequest wait path', {
                    scopeKey: started.scopeKey || '',
                    turn: started.turn || 0,
                    timeoutMs
                });
            }
        }
        return result;
    };

    const waitForAfterRequestForegroundTask = async (chat, activityContext = null, options = {}) => {
        const config = options?.config || MemoryEngine.CONFIG;
        if (normalizeAfterRequestMaintenanceMode(config?.afterRequestMaintenanceMode || DEFAULT_AFTER_REQUEST_MAINTENANCE_MODE) !== 'foreground') {
            return { status: 'skipped', reason: 'background-mode' };
        }
        const candidateScopeKeys = Array.from(new Set([
            getChatRuntimeScopeKey(chat, options?.char || null),
            getChatMemoryScopeKey(chat),
            chat?.id,
            'global'
        ].map(value => String(value || '').trim()).filter(Boolean)));
        const scopeKey = candidateScopeKeys.find(key => MemoryState.afterRequestForegroundTasksByScope.has(key))
            || candidateScopeKeys[0]
            || 'global';
        const task = MemoryState.afterRequestForegroundTasksByScope.get(scopeKey);
        if (!task) return { status: 'none' };
        try {
            if (activityContext) {
                ActivityDashboardCore.update(activityContext, {
                    phase: 'beforeRequest',
                    status: 'waiting',
                    progress: Math.max(18, Number(MemoryState.activityDashboard?.progress || 0)),
                    step: '이전 턴 분석 대기',
                    stepStatus: 'waiting',
                    message: '이전 턴 LIBRA 분석이 끝날 때까지 기다립니다.'
                });
            }
        } catch (_) {}
        const configuredTimeoutMs = normalizeAfterRequestForegroundTimeoutMs(config?.afterRequestForegroundTimeoutMs ?? 45000, 45000);
        const beforeRequestWaitCapMs = Math.max(500, Math.min(5000, Math.round(Number(config?.afterRequestBeforeRequestWaitCapMs ?? 2500) || 2500)));
        return await awaitCommittedTurnMaintenance({
            mode: 'foreground',
            task,
            scopeKey,
            turn: options?.turn || 0
        }, {
            timeoutMs: Math.min(configuredTimeoutMs, beforeRequestWaitCapMs)
        });
    };

    const buildFastCommittedTurnState = async (char, chat, lore, userMsg, aiResponse, m_id = null, options = {}) => {
        const config = MemoryEngine.CONFIG;
        const turnChannel = (options?.narrativeChannel && typeof options.narrativeChannel === 'object')
            ? options.narrativeChannel
            : classifyNarrativeTurnChannel(userMsg, aiResponse);
        const strictUserMsg = turnChannel.strictUser || getStrictNarrativeUserText(userMsg);
        const strictAiResponse = String(turnChannel.strictAi || Utils.getNarrativeComparableText(aiResponse, 'ai') || '').trim();
        const narrativeUserLabel = strictUserMsg
            || (turnChannel.channel === 'meta' ? String(turnChannel.rawUser || userMsg || '').trim() : '')
            || ((options.autoContinue && aiResponse) ? '[auto-continue]' : '');
        const finalizedTurn = normalizeLegacyMemoryTurnAnchor(options?.finalizedTurn || options?.anchorMeta?.finalizedTurn || options?.anchorMeta?.turn || MemoryEngine.getCurrentTurn?.() || 0);
        const anchorMeta = options?.anchorMeta && typeof options.anchorMeta === 'object' ? options.anchorMeta : {};
        const shouldRecordNarrative = options?.allowNarrativeProcessing !== false && !!narrativeUserLabel;
        if (shouldRecordNarrative) {
            const narrativeAnchorMeta = {
                ...anchorMeta,
                m_id: m_id || anchorMeta.m_id || '',
                messageId: m_id || anchorMeta.messageId || '',
                chatId: String(chat?.id || anchorMeta.chatId || '').trim(),
                turnAnchorReason: String(anchorMeta.turnAnchorReason || 'v4.2-finalized-turn').trim() || 'v4.2-finalized-turn'
            };
            await NarrativeTracker.recordTurn(finalizedTurn, narrativeUserLabel, aiResponse, [], config, {
                anchorMeta: narrativeAnchorMeta,
                channel: turnChannel.channel,
                containsMetaSignals: turnChannel.containsMetaSignals
            });
        }
        return {
            config,
            analysisPending: turnChannel.channel === 'scene',
            analysisCompleted: false,
            conversationEmotion: null,
            entityResult: null,
            involvedEntities: [],
            entitiesToConsolidate: [],
            strictUserMsg,
            strictAiResponse,
            narrativeUserLabel,
            recordedNarrativeTurn: shouldRecordNarrative,
            narrativeTrack: turnChannel.channel,
            narrativeChannelPreview: turnChannel,
            anchorMeta,
            finalizedTurn,
            m_id
        };
    };

    const analyzeCommittedTurnState = async (char, chat, lore, fastTurnState = {}, aiResponse = '', turnForMaintenance = 0, maintenanceConfig = MemoryEngine.CONFIG) => {
        if (!fastTurnState?.analysisPending) return fastTurnState;
        let entityAnalysisContext = null;
        let unifiedAnalysis = null;
        try {
            const strictUserForAnalysis = String(fastTurnState.strictUserMsg || fastTurnState.narrativeUserLabel || '').trim();
            const strictAiForAnalysis = String(fastTurnState.strictAiResponse || Utils.getNarrativeComparableText(aiResponse, 'ai') || aiResponse || '').trim();
            if (fastTurnState.narrativeTrack !== 'meta' && maintenanceConfig?.useLLM !== false) {
                entityAnalysisContext = await buildCurrentTurnEntityAnalysisContext(
                    char,
                    chat,
                    lore,
                    strictUserForAnalysis,
                    strictAiForAnalysis,
                    turnForMaintenance,
                    maintenanceConfig
                );
                unifiedAnalysis = await TurnMaintenanceOptimizer.runUnified?.(
                    turnForMaintenance,
                    {
                        ...fastTurnState,
                        strictUserMsg: strictUserForAnalysis,
                        strictAiResponse: strictAiForAnalysis
                    },
                    aiResponse,
                    MemoryEngine.getEffectiveLorebook(char, chat),
                    maintenanceConfig,
                    {
                        entityStoredInfo: entityAnalysisContext.storedInfo,
                        characterEntityHintBlock: entityAnalysisContext.characterEntityHintBlock,
                        entityMemoryHintBlock: entityAnalysisContext.memoryHintBlock
                    }
                );
                if (unifiedAnalysis?.entityExtraction && maintenanceConfig?.debug) {
                    recordRuntimeDebug('log', '[LIBRA] Unified afterRequest analysis accepted:', {
                        turn: turnForMaintenance,
                        profile: unifiedAnalysis.profile || '',
                        label: unifiedAnalysis.label || ''
                    });
                }
            }
        } catch (unifiedError) {
            if (maintenanceConfig?.debug) {
                recordRuntimeDebug('warn', '[LIBRA] Unified afterRequest analysis setup failed:', unifiedError?.message || unifiedError);
            }
            unifiedAnalysis = null;
        }
        const analyzed = await processNarrativeTurnState(
            char,
            chat,
            lore,
            fastTurnState.strictUserMsg || fastTurnState.narrativeUserLabel || '',
            aiResponse,
            fastTurnState.m_id || fastTurnState.anchorMeta?.m_id || null,
            {
                autoContinue: !String(fastTurnState.strictUserMsg || '').trim() && !!aiResponse,
                anchorMeta: fastTurnState.anchorMeta || {},
                narrativeChannel: fastTurnState.narrativeChannelPreview || null,
                skipNarrativeRecord: true,
                entityAnalysisContext,
                precomputedEntityExtraction: unifiedAnalysis?.entityExtraction || null,
                precomputedSourceMode: unifiedAnalysis?.entityExtraction
                    ? (unifiedAnalysis?.entitySourceMode || unifiedAnalysis?.entityExtraction?.sourceMode || 'afterrequest_unified_analysis')
                    : ''
            }
        );
        const merged = {
            ...fastTurnState,
            ...analyzed,
            analysisPending: false,
            analysisCompleted: true,
            foregroundAnalyzedAt: Date.now(),
            precomputedMaintenance: unifiedAnalysis?.maintenance
                ? {
                    ...unifiedAnalysis.maintenance,
                    canonicalPacket: unifiedAnalysis?.canonicalPacket || unifiedAnalysis.maintenance?.canonicalPacket || null,
                    entityExtraction: unifiedAnalysis?.entityExtraction || unifiedAnalysis.maintenance?.entityExtraction || null,
                    entitySourceMode: unifiedAnalysis?.entitySourceMode || unifiedAnalysis?.entityExtraction?.sourceMode || unifiedAnalysis.maintenance?.entitySourceMode || ''
                }
                : null,
            unifiedAnalysisUsed: !!(unifiedAnalysis?.entityExtraction && unifiedAnalysis?.maintenance)
        };
        try {
            const povRecordResult = EntityKnowledgeVaultCore.recordTurnForEntities(merged.involvedEntities || [], {
                userText: '',
                aiText: aiResponse,
                turn: turnForMaintenance,
                source: 'afterRequest-foreground-analysis'
            }, {
                turn: turnForMaintenance,
                source: 'afterRequest-foreground-analysis'
            });
            if (povRecordResult?.changed && maintenanceConfig?.debug) {
                recordRuntimeDebug('log', '[LIBRA] Entity POV vault updated after foreground analysis', {
                    turn: turnForMaintenance,
                    count: povRecordResult.count || 0,
                    entities: merged.involvedEntities || []
                });
            }
        } catch (povRecordError) {
            if (maintenanceConfig?.debug) recordRuntimeDebug('warn', '[LIBRA] Entity POV vault foreground update skipped:', povRecordError?.message || povRecordError);
        }
        try {
            const candidateResult = EntityCandidateCore?.recordInvolvedEntityCandidates?.(lore, merged.involvedEntities || [], {
                turn: turnForMaintenance,
                source: 'maintenance.involvedEntities',
                reason: 'related_but_not_promoted',
                userText: '',
                aiText: aiResponse
            });
            if (candidateResult?.changed && maintenanceConfig?.debug) {
                recordRuntimeDebug('log', '[LIBRA] Entity candidates updated after foreground analysis', {
                    turn: turnForMaintenance,
                    count: candidateResult.count || 0
                });
            }
        } catch (candidateRecordError) {
            if (maintenanceConfig?.debug) recordRuntimeDebug('warn', '[LIBRA] Entity candidate foreground update skipped:', candidateRecordError?.message || candidateRecordError);
        }
        if (Array.isArray(merged.involvedEntities) && merged.involvedEntities.length > 0) {
            try {
                NarrativeTracker.correctTurn(turnForMaintenance, {
                    entities: merged.involvedEntities || []
                });
            } catch (narrativeCorrectionError) {
                if (maintenanceConfig?.debug) recordRuntimeDebug('warn', '[LIBRA] Narrative entity backfill skipped:', narrativeCorrectionError?.message || narrativeCorrectionError);
            }
        }
        return merged;
    };

    const PendingTurnManager = (() => {
        const pruneStale = () => {
            const now = Date.now();
            for (const [key, pending] of MemoryState.pendingTurnCommits.entries()) {
                if (!pending || (now - Number(pending.createdAt || now)) <= PENDING_STALE_MS) continue;
                MemoryState.pendingTurnCommits.delete(key);
            }
        };

        const getPending = (chat) => {
            pruneStale();
            return MemoryState.pendingTurnCommits.get(getChatMemoryScopeKey(chat)) || null;
        };

        const getFinalizedTurnMeta = (chat) => MemoryState.finalizedTurnMetaByScope.get(getChatMemoryScopeKey(chat)) || null;

        const setFinalizedTurnMeta = (chat, meta = {}) => {
            const scopeKey = getChatMemoryScopeKey(chat);
            const liveMessageIds = normalizeCanonicalMessageIds(meta?.liveMessageIds || meta?.sourceMessageIds || meta?.messageId || meta?.m_id);
            const turn = normalizeLegacyMemoryTurnAnchor(
                meta?.turn
                || meta?.turnAnchor
                || meta?.turnAnchorTurn
                || meta?.lockedTurn
                || meta?.finalizedTurn
            );
            const sourceHash = String(meta?.sourceHash || meta?.aiHash || '').trim();
            const userTurnKey = String(meta?.userTurnKey || '').trim();
            const messageSignature = String(meta?.messageSignature || '').trim();
            const normalized = {
                turn,
                turnAnchor: turn,
                turnAnchorTurn: turn,
                lockedTurn: turn,
                finalizedTurn: turn,
                aiHash: String(meta?.aiHash || sourceHash || '').trim(),
                sourceHash,
                userTurnKey,
                messageId: getPrimaryCanonicalMessageId(liveMessageIds, true) || null,
                liveMessageIds,
                messageSignature,
                turnKey: String(meta?.turnKey || buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, messageSignature, liveMessageIds)).trim(),
                messageCount: Number(meta?.messageCount || 0),
                finalizedAt: Number(meta?.finalizedAt || Date.now()),
                reason: String(meta?.reason || 'stabilized').trim() || 'stabilized',
                runtimeMode: String(meta?.runtimeMode || 'turn-anchor').trim() || 'turn-anchor',
                runtimeReliability: String(meta?.runtimeReliability || 'normal').trim() || 'normal'
            };
            MemoryState.finalizedTurnMetaByScope.set(scopeKey, normalized);
            return normalized;
        };

        const getPendingComparableHashes = (chat) => {
            const pending = getPending(chat);
            if (!pending?.aiHash) return new Set();
            return new Set([pending.aiHash]);
        };

        const isLikelyAlreadyFinalized = (chat, payload = {}) => {
            const finalized = getFinalizedTurnMeta(chat);
            if (!finalized) return false;
            const incomingHash = String(payload?.aiHash || payload?.sourceHash || '').trim();
            const incomingSignature = String(payload?.messageSignature || '').trim();
            const incomingIds = normalizeCanonicalMessageIds(payload?.liveMessageIds || payload?.sourceMessageIds || payload?.initialMessageId || payload?.messageId);
            if (incomingHash && finalized.sourceHash && incomingHash === finalized.sourceHash) return true;
            if (incomingSignature && finalized.messageSignature && incomingSignature === finalized.messageSignature) return true;
            return hasCanonicalMessageIdOverlap(incomingIds, finalized.liveMessageIds || finalized.messageId);
        };

        const registerPending = (chat, payload) => {
            if (isLibraManualOocPauseEnabled(MemoryEngine.CONFIG)) return null;
            if (!chat || !payload?.aiHash) return null;
            if (isLikelyAlreadyFinalized(chat, payload)) return null;
            const key = getChatMemoryScopeKey(chat);
            const prev = MemoryState.pendingTurnCommits.get(key);
            const liveMessageIds = normalizeCanonicalMessageIds(
                payload?.liveMessageIds
                || payload?.sourceMessageIds
                || payload?.initialMessageId
                || payload?.messageId
            );
            const sourceHash = String(payload?.sourceHash || payload?.aiHash || '').trim();
            const userTurnKey = String(payload?.userTurnKey || buildLogicalUserTurnKey(payload?.userMsgForNarrative, payload?.userMsgForMemory, payload?.autoContinueTurn)).trim();
            const messageSignature = String(payload?.messageSignature || '').trim();
            const anchorTurn = normalizeLegacyMemoryTurnAnchor(
                payload?.turnAnchor
                || payload?.turnAnchorTurn
                || payload?.lockedTurn
                || payload?.finalizedTurn
                || payload?.liveTurn
                || payload?.predictedTurn
                || (Number(MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0) + 1)
            );
            const next = {
                ...payload,
                chatId: chat?.id || null,
                createdAt: prev?.aiHash === payload.aiHash ? Number(prev?.createdAt || Date.now()) : Date.now(),
                firstSeenAt: prev?.aiHash === payload.aiHash ? Number(prev?.firstSeenAt || Date.now()) : Date.now(),
                lastSeenAt: 0,
                stableMatches: prev?.aiHash === payload.aiHash ? Number(prev.stableMatches || 0) : 0,
                observedMessageId: prev?.aiHash === payload.aiHash ? (prev.observedMessageId || null) : null,
                observedHash: prev?.aiHash === payload.aiHash ? (prev.observedHash || null) : null,
                aiHash: String(payload.aiHash || sourceHash).trim(),
                sourceHash,
                userTurnKey,
                liveMessageIds,
                sourceMessageIds: liveMessageIds,
                initialMessageId: getPrimaryCanonicalMessageId(liveMessageIds, true) || payload?.initialMessageId || null,
                messageSignature,
                turnAnchor: anchorTurn,
                turnAnchorTurn: anchorTurn,
                lockedTurn: anchorTurn,
                finalizedTurn: anchorTurn,
                predictedTurn: anchorTurn,
                liveTurn: anchorTurn,
                turnKey: String(payload?.turnKey || buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, messageSignature, liveMessageIds)).trim(),
                runtimeMode: String(payload?.runtimeMode || 'turn-anchor').trim() || 'turn-anchor',
                runtimeReliability: String(payload?.runtimeReliability || 'normal').trim() || 'normal'
            };
            MemoryState.pendingTurnCommits.set(key, next);
            enterRefreshStabilizeWindow();
            markLiveSyncSnapshot(chat, { pendingKey: next.turnKey || next.sourceHash || next.aiHash });
            return next;
        };

        const dropPending = (chat) => {
            const scopeKey = getChatMemoryScopeKey(chat);
            MemoryState.pendingTurnCommits.delete(scopeKey);
            clearPendingFinalizeRetry(chat);
        };

        const withPendingCommitLock = async (chat, task) => {
            const scopeKey = String(getChatMemoryScopeKey(chat) || chat?.id || 'global').trim() || 'global';
            const previous = MemoryState.pendingTurnCommitLocksByScope.get(scopeKey) || Promise.resolve();
            let current = null;
            current = previous.catch(() => null).then(async () => {
                try { return await task(); }
                finally {
                    if (MemoryState.pendingTurnCommitLocksByScope.get(scopeKey) === current) {
                        MemoryState.pendingTurnCommitLocksByScope.delete(scopeKey);
                    }
                }
            });
            MemoryState.pendingTurnCommitLocksByScope.set(scopeKey, current);
            return current;
        };

        const clearPendingFinalizeRetry = (chat) => {
            const scopeKey = String(getChatMemoryScopeKey(chat) || chat?.id || 'global').trim() || 'global';
            const current = MemoryState.pendingFinalizeRetryTimersByScope.get(scopeKey);
            if (current?.timer) { try { clearTimeout(current.timer); } catch (_) {} }
            MemoryState.pendingFinalizeRetryTimersByScope.delete(scopeKey);
        };

        const schedulePendingFinalizeRetry = (char, chat, reason = 'afterRequest-stabilized-retry', delayMs = PENDING_FINALIZE_MIN_MS + 250) => {
            if (!char || !chat || typeof setTimeout !== 'function') return false;
            const scopeKey = String(getChatMemoryScopeKey(chat) || chat?.id || 'global').trim() || 'global';
            clearPendingFinalizeRetry(chat);
            const timer = setTimeout(async () => {
                MemoryState.pendingFinalizeRetryTimersByScope.delete(scopeKey);
                try {
                    const result = await finalizePending(char, chat, reason);
                    if (MemoryEngine.CONFIG?.debug && result?.status !== 'finalized' && result?.status !== 'already-committed' && result?.status !== 'none') {
                        recordRuntimeDebug('log', '[LIBRA] delayed pending finalize result:', result);
                    }
                } catch (error) {
                    if (MemoryEngine.CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA] delayed pending finalize failed:', error?.message || error);
                }
            }, Math.max(250, Number(delayMs || 0) || (PENDING_FINALIZE_MIN_MS + 250)));
            MemoryState.pendingFinalizeRetryTimersByScope.set(scopeKey, { timer, scheduledAt: Date.now(), reason });
            return true;
        };

        const resolveLatestPendingSnapshot = (chat, pending = {}) => {
            const latest = buildLatestAssistantSnapshot(chat, { includeStableId: true });
            const pendingText = String(Utils.getMemorySourceText(pending?.aiResponseRaw || pending?.aiResponse || '') || '').trim();
            const pendingHash = String(
                (pendingText ? TokenizerEngine.simpleHash(pendingText) : '')
                || pending?.sourceHash
                || pending?.aiHash
                || ''
            ).trim();
            const latestMatchesPending = !!(latest.latestHash && pendingHash && latest.latestHash === pendingHash);
            const useLatest = latestMatchesPending || (!pendingHash && !!latest.latestHash);
            const pendingTurn = normalizeLegacyMemoryTurnAnchor(
                pending?.turnAnchor || pending?.turnAnchorTurn || pending?.lockedTurn || pending?.finalizedTurn || pending?.predictedTurn || 0
            );
            const latestIds = normalizeCanonicalMessageIds(useLatest
                ? [latest.latestLiveId, latest.latestStableId, pending?.initialMessageId, pending?.liveMessageIds]
                : [pending?.initialMessageId, pending?.liveMessageIds]
            );
            const resolvedText = String(Utils.getMemorySourceText(
                useLatest ? (latest.latestComparable || pendingText || pending?.aiResponse || '') : pendingText
            ) || '').trim();
            const resolvedHash = String(
                (resolvedText ? TokenizerEngine.simpleHash(resolvedText) : '')
                || (useLatest ? latest.latestHash : '')
                || pendingHash
                || ''
            ).trim();
            const fallbackSyntheticId = resolvedHash ? buildAfterRequestSyntheticMessageId(chat, pendingTurn, resolvedHash) : '';
            const resolvedMessageId = getPrimaryCanonicalMessageId(latestIds, true) || fallbackSyntheticId || pending?.initialMessageId || null;
            const resolvedSignature = String(
                (useLatest ? latest.latestMessageSignature : '')
                || pending?.messageSignature
                || buildAfterRequestSyntheticMessageSignature(pendingTurn, resolvedText, resolvedHash)
            ).trim();
            return {
                ...latest,
                latestIds: normalizeCanonicalMessageIds([latestIds, resolvedMessageId]),
                latestMatchesPending,
                resolvedHash,
                resolvedSignature,
                resolvedMessageId,
                resolvedText
            };
        };

        const commitPendingNowUnlocked = async (char, chat, reason = 'afterRequest-immediate', options = {}) => {
            if (isLibraManualOocPauseEnabled(MemoryEngine.CONFIG)) return { status: 'paused', reason: 'manual_ooc_pause' };
            const pending = options?.pending || getPending(chat);
            if (!char || !chat || !pending) return { status: 'none' };
            let latest = resolveLatestPendingSnapshot(chat, pending);
            if (String(reason || '').includes('afterRequest') && (!latest.resolvedMessageId || !latest.resolvedSignature)) {
                const attachDeadline = Date.now() + 1800;
                let attachStep = 120;
                while (Date.now() < attachDeadline) {
                    await sleep(attachStep);
                    const candidate = resolveLatestPendingSnapshot(chat, pending);
                    const candidateHasStableAnchor = candidate.latestMatchesPending && (
                        !!(candidate.resolvedMessageId || candidate.resolvedSignature)
                        || Number(candidate.currentMessageCount || 0) > Number(pending.messageCount || 0)
                    );
                    if (candidate.resolvedHash && candidateHasStableAnchor) {
                        latest = candidate;
                        break;
                    }
                    attachStep = Math.min(300, attachStep + 40);
                }
            }
            const sourceHash = String(pending?.sourceHash || pending?.aiHash || latest.resolvedHash || '').trim();
            const latestHash = String(latest.resolvedHash || sourceHash || '').trim();
            if (!latestHash) return { status: 'waiting', reason: 'no_latest_hash' };

            const now = Date.now();
            const isImmediateAfterRequest = String(reason || '') === 'afterRequest-immediate';
            if (isImmediateAfterRequest && options?.force !== true) {
                const ageMs = now - Number(pending.createdAt || now);
                const messageCountAdvanced = Number(latest.currentMessageCount || 0) > Number(pending.messageCount || 0);
                const anchorStable = latest.latestMatchesPending && (messageCountAdvanced || !!latest.resolvedMessageId || !!latest.resolvedSignature);
                if (ageMs < PENDING_FINALIZE_MIN_MS || !anchorStable) {
                    const retryScheduled = options?.suppressFinalizeRetry === true
                        ? false
                        : schedulePendingFinalizeRetry(char, chat, 'afterRequest-stabilized-retry', Math.max(250, PENDING_FINALIZE_MIN_MS - ageMs + 250));
                    return {
                        status: 'waiting',
                        reason: ageMs < PENDING_FINALIZE_MIN_MS ? 'age_guard_afterrequest' : 'anchor_stability_guard_afterrequest',
                        retryScheduled,
                        ageMs,
                        anchorStable
                    };
                }
            }
            pending.lastSeenAt = now;
            pending.observedHash = latestHash;
            pending.observedMessageId = latest.resolvedMessageId || pending.observedMessageId || null;
            pending.stableMatches = Math.max(Number(pending.stableMatches || 0), 1);
            pending.aiResponse = Utils.getMemorySourceText(latest.resolvedText || pending.aiResponse || '');
            pending.aiResponseRaw = Utils.getMemorySourceText(pending.aiResponseRaw || pending.aiResponse || '');
            MemoryState.pendingTurnCommits.set(getChatMemoryScopeKey(chat), pending);

            const lore = MemoryEngine.getLorebook(char, chat);
            const config = MemoryEngine.CONFIG;
            const rawDerivedMax = Math.max(
                deriveRuntimeTurnFromLorebook(lore),
                TurnRecordLedger.deriveMaxTurn(lore, chat, char)
            );
            const chatIdForRollbackRestore = String(chat?.id || '').trim();
            const rollbackRestoredTurnForFinalize = chatIdForRollbackRestore && MemoryState.rollbackJournalRestoredTurnByChatId?.has?.(chatIdForRollbackRestore)
                ? normalizeLegacyMemoryTurnAnchor(MemoryState.rollbackJournalRestoredTurnByChatId.get(chatIdForRollbackRestore))
                : null;
            const derivedMax = rollbackRestoredTurnForFinalize !== null
                ? Math.min(rawDerivedMax, rollbackRestoredTurnForFinalize)
                : rawDerivedMax;
            const currentTurn = Math.max(1, normalizeLegacyMemoryTurnAnchor(
                pending.turnAnchor
                || pending.turnAnchorTurn
                || pending.lockedTurn
                || pending.finalizedTurn
                || pending.liveTurn
                || pending.predictedTurn
                || (derivedMax + 1)
            ));
            if (currentTurn <= derivedMax && currentTurn > 0 && String(reason || '').includes('afterRequest')) {
                // Reroll/refresh may intentionally reuse an anchor; otherwise move forward.
                const finalized = getFinalizedTurnMeta(chat);
                const sameFinalized = finalized && (
                    finalized.sourceHash === latestHash
                    || finalized.messageSignature === latest.resolvedSignature
                    || hasCanonicalMessageIdOverlap(finalized.liveMessageIds, latest.latestIds)
                );
                if (!sameFinalized) {
                    pending.turnAnchor = derivedMax + 1;
                    pending.turnAnchorTurn = derivedMax + 1;
                    pending.lockedTurn = derivedMax + 1;
                    pending.finalizedTurn = derivedMax + 1;
                }
            }
            const finalizedTurn = Math.max(1, normalizeLegacyMemoryTurnAnchor(pending.turnAnchor || pending.turnAnchorTurn || currentTurn));
            MemoryEngine.setTurn(finalizedTurn);


            const m_id = latest.resolvedMessageId || pending.observedMessageId || null;
            const liveMessageIds = normalizeCanonicalMessageIds([latest.latestIds, pending.liveMessageIds, m_id]);
            const storageMessageSignature = compactTurnMessageSignature(latest.resolvedSignature);
            const turnKey = String(buildCanonicalTurnKey(chat?.id || '', pending.userTurnKey || '', latestHash, storageMessageSignature, liveMessageIds)).trim();
            const anchorMeta = {
                t: finalizedTurn,
                turn: finalizedTurn,
                turnAnchor: finalizedTurn,
                turnAnchorTurn: finalizedTurn,
                lockedTurn: finalizedTurn,
                finalizedTurn,
                firstTurn: finalizedTurn,
                originalTurn: finalizedTurn,
                m_id,
                messageId: m_id,
                liveMessageIds,
                sourceMessageIds: liveMessageIds,
                aiHash: latestHash,
                sourceHash: latestHash,
                responseHash: latestHash,
                userTurnKey: pending.userTurnKey || '',
                turnKey,
                messageSignature: storageMessageSignature,
                messageCount: Number(latest.currentMessageCount || 0),
                liveOrder: Number(latest.currentMessageCount || 0),
                chatId: String(chat?.id || '').trim(),
                runtimeMode: pending.runtimeMode || 'turn-anchor',
                runtimeReliability: pending.runtimeReliability || 'normal',
                turnLocked: true,
                turnAnchorReason: 'v4.2-finalized-turn',
                finalizedAt: Date.now()
            };
            const allowNarrativeProcessing = pending.allowNarrativeProcessing !== false;
            const allowMemoryCapture = pending.allowMemoryCapture !== false;
            const recoveredUserMemory = String(Utils.getMemorySourceText(
                pending.userMsgForMemory
                || pending.userMsgForNarrative
                || _lastUserMessageRaw
                || _lastUserMessage
                || findLatestVisibleUserText(getChatMessages(chat))
                || ''
            ) || '').trim();
            const recoveredUserNarrative = String(
                Utils.getNarrativeComparableText(pending.userMsgForNarrative || recoveredUserMemory || '', 'user')
                || recoveredUserMemory
                || ''
            ).trim();
            const effectiveAiResponse = String(Utils.getMemorySourceText(pending.aiResponse || latest.resolvedText || '') || '').trim();
            pending.userMsgForMemory = recoveredUserMemory;
            pending.userMsgForNarrative = recoveredUserNarrative;
            pending.aiResponse = effectiveAiResponse;
            pending.aiResponseRaw = String(Utils.getMemorySourceText(pending.aiResponseRaw || effectiveAiResponse) || '').trim();
            const turnState = allowNarrativeProcessing
                ? await buildFastCommittedTurnState(char, chat, lore, recoveredUserNarrative, effectiveAiResponse, m_id, {
                    autoContinue: !!pending.autoContinueTurn,
                    anchorMeta,
                    narrativeChannel: pending.narrativeChannelPreview,
                    finalizedTurn,
                    allowNarrativeProcessing
                })
                : {
                    config,
                    conversationEmotion: null,
                    analysisPending: false,
                    involvedEntities: [],
                    entitiesToConsolidate: [],
                    strictUserMsg: recoveredUserNarrative || '',
                    recordedNarrativeTurn: false,
                    narrativeTrack: 'scene',
                    m_id
                };
            try {
                const povRecordResult = EntityKnowledgeVaultCore.recordTurnForEntities(turnState?.involvedEntities || [], {
                    userText: '',
                    aiText: effectiveAiResponse,
                    turn: finalizedTurn,
                    source: 'afterRequest-turn'
                }, {
                    turn: finalizedTurn,
                    source: 'afterRequest-turn'
                });
                if (povRecordResult?.changed && config.debug) {
                    recordRuntimeDebug('log', '[LIBRA] Entity POV vault updated', {
                        turn: finalizedTurn,
                        count: povRecordResult.count || 0,
                        entities: turnState?.involvedEntities || []
                    });
                }
            } catch (povRecordError) {
                if (config.debug) recordRuntimeDebug('warn', '[LIBRA] Entity POV vault update skipped:', povRecordError?.message || povRecordError);
            }
            try {
                const candidateResult = EntityCandidateCore?.recordInvolvedEntityCandidates?.(lore, turnState?.involvedEntities || [], {
                    turn: finalizedTurn,
                    source: 'afterRequest-turn.involvedEntities',
                    reason: 'related_but_not_promoted',
                    userText: '',
                    aiText: effectiveAiResponse
                });
                if (candidateResult?.changed && config.debug) {
                    recordRuntimeDebug('log', '[LIBRA] Entity candidates updated', {
                        turn: finalizedTurn,
                        count: candidateResult.count || 0
                    });
                }
            } catch (candidateRecordError) {
                if (config.debug) recordRuntimeDebug('warn', '[LIBRA] Entity candidate update skipped:', candidateRecordError?.message || candidateRecordError);
            }
            const allowCompactMemoryCapture = allowMemoryCapture && turnState?.narrativeTrack !== 'meta';
            const memoryContent = buildCanonicalMemoryCaptureContent(recoveredUserMemory, effectiveAiResponse, {
                turn: finalizedTurn,
                entityRefs: turnState?.involvedEntities || [],
                knownEntityNames: turnState?.involvedEntities || [],
                source: 'afterRequest-turn-capture'
            });
            const memoryPayloadForRetention = memoryContent ? CompactMemoryCodec.parsePayloadFromContent(memoryContent) : null;
            const memoryImportance = (config.rpLongTermMemoryEnabled !== false && memoryPayloadForRetention?.rpLongTerm)
                ? RPContinuityCore.resolveImportance(memoryPayloadForRetention.rpLongTerm, 5)
                : 5;
            const newMemory = allowCompactMemoryCapture && memoryContent
                ? await MemoryEngine.prepareMemory(
                    { content: memoryContent, importance: memoryImportance, forceCreate: true },
                    finalizedTurn, lore, lore, char, chat, m_id, anchorMeta
                )
                : null;
            const currentWorldNode = HierarchicalWorldManager.getCurrentNode?.();
            const currentWorldRules = HierarchicalWorldManager.getCurrentRules();
            const currentWorldProfile = HierarchicalWorldManager.getProfile?.();
            const worldMemoryContent = allowCompactMemoryCapture
                ? buildWorldRecallMemoryContent(currentWorldNode?.meta || {}, currentWorldRules, {
                    turn: finalizedTurn,
                    importance: Math.max(6, Number(memoryImportance || 0) || 6),
                    sourceHash: latestHash,
                    sourceMessageIds: liveMessageIds,
                    worldSnapshot: turnState?.worldSnapshot || null,
                    activePath: turnState?.worldSnapshot?.activePath || currentWorldProfile?.activePath || []
                })
                : '';
            const worldMemoryPayload = worldMemoryContent ? (CompactMemoryCodec.parsePayloadFromContent(worldMemoryContent) || null) : null;
            const worldMemoryDecision = worldMemoryContent
                ? shouldCreateWorldRecallMemorySnapshot(lore, worldMemoryPayload, {
                    turn: finalizedTurn,
                    isWorldCritical: turnState?.isWorldCritical === true,
                    worldSnapshot: turnState?.worldSnapshot || null
                })
                : { create: false, reason: 'empty_content' };
            const shouldCreateWorldMemory = !!(worldMemoryContent && worldMemoryDecision.create);
            const worldMemory = allowCompactMemoryCapture && shouldCreateWorldMemory
                ? await MemoryEngine.prepareMemory(
                    { content: worldMemoryContent, importance: Math.max(6, Number(memoryImportance || 0) || 6) },
                    finalizedTurn, lore, lore, char, chat, m_id, anchorMeta
                )
                : null;

            if (newMemory) forceMemoryTurnAnchor(newMemory, anchorMeta);
            if (worldMemory) forceMemoryTurnAnchor(worldMemory, anchorMeta);
            const committedMemories = [newMemory, worldMemory].filter(Boolean);
            const primaryMemoryKey = newMemory?.key
                || worldMemory?.key
                || (newMemory?.content ? TokenizerEngine.getSafeMapKey(newMemory.content) : '')
                || (worldMemory?.content ? TokenizerEngine.getSafeMapKey(worldMemory.content) : '');
            if (config.debug) {
                recordRuntimeDebug('log', '[LIBRA] V4.2 turn anchor commit prepared', {
                    __libraDebugMeta: true,
                    turn: finalizedTurn,
                    turnAnchorTurn: finalizedTurn,
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || '').trim(),
                    turnKey,
                    memoryCreated: committedMemories.length > 0,
                    worldMemoryCreated: Boolean(worldMemory),
                    worldMemoryDeduped: !!(worldMemoryContent && !worldMemory),
                    worldMemoryDecision,
                    reason
                });
            }

            await loreLock.writeLock();
            try {
                if (committedMemories.length > 0) {
                    lore.push(...committedMemories);
                    MemoryEngine.upsertHybridScopeIndexRows(lore, committedMemories, {
                        scopeKey: getChatRuntimeScopeKey(chat, char),
                        currentTurn: finalizedTurn,
                        reason: `post-commit:${reason}`
                    });
                }
                if (config.rpLongTermMemoryEnabled !== false && newMemory) {
                    try {
                        const committedPayload = CompactMemoryCodec.parsePayloadFromEntry(newMemory);
                        if (committedPayload?.rpLongTerm) {
                            RPContinuityCore.upsertFromTurn(lore, committedPayload.rpLongTerm, {
                                turn: finalizedTurn,
                                entityRefs: turnState?.involvedEntities || [],
                                source: 'afterRequest-turn-commit',
                                sourceMemoryKey: String(newMemory?.key || '').trim() || `memory_hash:${TokenizerEngine.simpleHash(String(newMemory?.content || ''))}`
                            });
                        }
                    } catch (error) {
                        if (config.debug) recordRuntimeDebug('warn', '[LIBRA][RP-LTM] aggregate upsert skipped:', error?.message || error);
                    }
                }
                TurnRecordLedger.upsertRecord(lore, {
                    ...anchorMeta,
                    userPreview: String(pending.userMsgForNarrative || pending.userMsgForMemory || (pending.autoContinueTurn ? '*says nothing*' : '') || '').replace(/\s+/g, ' ').trim().slice(0, 90),
                    aiPreview: pending.aiResponse || '',
                    memoryKey: primaryMemoryKey,
                    status: 'active',
                    reason
                }, chat, char);
                RollbackJournalManager.recordAssistantCommit(char, chat, lore, {
                    ...anchorMeta,
                    memoryKey: primaryMemoryKey,
                    reason
                }, { persist: false });
                await SecretKnowledgeCore.saveState(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                });
                await NarrativeTracker.saveState(lore);
                await EntityKnowledgeVaultCore.saveState(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                });
                await TimeEngine.saveState(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                });
                MemoryEngine.setLorebook(char, chat, lore);
                await persistLoreToActiveChat(chat, lore, {});
                if (MemoryEngine.CONFIG?.runtimeRollbackSnapshotsEnabled === true) {
                    RollbackSnapshotManager.capture(char, chat, lore, {
                        turn: finalizedTurn,
                        reason: `post-commit:${reason}`
                    });
                }
            } finally {
                loreLock.writeUnlock();
            }

            if (m_id || liveMessageIds.length > 0) {
                const createdKeys = [];
                if (newMemory) createdKeys.push(newMemory.key || TokenizerEngine.getSafeMapKey(newMemory.content));
                if (worldMemory) createdKeys.push(worldMemory.key || TokenizerEngine.getSafeMapKey(worldMemory.content));
                const trackerPayload = {
                    loreKeys: createdKeys,
                    sourceHash: latestHash,
                    aiHash: latestHash,
                    messageSignature: latest.resolvedSignature,
                    liveMessageIds,
                    sourceMessageIds: liveMessageIds,
                    messageId: m_id,
                    turn: finalizedTurn,
                    turnAnchor: finalizedTurn,
                    turnAnchorTurn: finalizedTurn,
                    lockedTurn: finalizedTurn,
                    finalizedTurn,
                    turnKey,
                    userTurnKey: pending.userTurnKey || ''
                };
                for (const id of liveMessageIds.length ? liveMessageIds : [m_id]) {
                    if (!id) continue;
                    MemoryState.rollbackTracker.set(id, trackerPayload);
                    MemoryState.transientMissing.delete(id);
                }
            }

            setFinalizedTurnMeta(chat, {
                ...anchorMeta,
                messageCount: Number(latest.currentMessageCount || 0),
                reason
            });
            markLiveSyncSnapshot(chat, { finalizedTurn, pendingKey: '' });
            dropPending(chat);
            let maintenanceRecord = null;
            if (allowNarrativeProcessing && turnState?.narrativeTrack !== 'meta') {
                maintenanceRecord = buildTurnMaintenanceRecord(char, chat, turnState, pending.aiResponse, finalizedTurn, config);
                if (options?.deferMaintenance !== true) {
                    startCommittedTurnMaintenance(maintenanceRecord, { reason });
                }
            } else {
            }
            if (config.debug) {
                recordRuntimeDebug('log', `[LIBRA] V4.2 turn anchor finalized via ${reason} | turn=${finalizedTurn} | chat=${chat?.id || 'global'} | key=${turnKey}`);
            }
            return {
                status: 'finalized',
                turn: finalizedTurn,
                memoryCreated: Boolean(newMemory),
                turnKey,
                maintenanceRecord: options?.deferMaintenance === true ? maintenanceRecord : null
            };
        };

        const commitPendingNow = async (char, chat, reason = 'afterRequest-immediate', options = {}) => {
            return withPendingCommitLock(chat, () => commitPendingNowUnlocked(char, chat, reason, options));
        };

        const finalizePending = async (char, chat, reason = 'stabilized', options = {}) => {
            return withPendingCommitLock(chat, async () => {
                if (isLibraManualOocPauseEnabled(MemoryEngine.CONFIG)) return { status: 'paused', reason: 'manual_ooc_pause' };
                const pending = getPending(chat);
                if (!char || !chat || !pending) return { status: 'none' };
                const latest = resolveLatestPendingSnapshot(chat, pending);
                if (!latest.resolvedHash) return { status: 'waiting', reason: 'no_latest_hash' };
                const now = Date.now();
                pending.lastSeenAt = now;
                if (pending.observedHash === latest.resolvedHash) pending.stableMatches = Number(pending.stableMatches || 0) + 1;
                else pending.stableMatches = 1;
                pending.observedHash = latest.resolvedHash;
                pending.observedMessageId = latest.resolvedMessageId || pending.observedMessageId || null;
                pending.aiResponse = Utils.getMemorySourceText(latest.resolvedText || pending.aiResponse || '');
                pending.aiResponseRaw = Utils.getMemorySourceText(pending.aiResponseRaw || pending.aiResponse || '');
                MemoryState.pendingTurnCommits.set(getChatMemoryScopeKey(chat), pending);

                if ((now - Number(pending.createdAt || now)) < PENDING_FINALIZE_MIN_MS) {
                    const retryScheduled = options?.suppressFinalizeRetry === true
                        ? false
                        : schedulePendingFinalizeRetry(char, chat, reason, PENDING_FINALIZE_MIN_MS - (now - Number(pending.createdAt || now)) + 250);
                    return { status: 'waiting', reason: 'age_guard', retryScheduled };
                }
                if (Number(pending.stableMatches || 0) < PENDING_FINALIZE_REQUIRED_MATCHES) {
                    const retryScheduled = options?.suppressFinalizeRetry === true
                        ? false
                        : schedulePendingFinalizeRetry(char, chat, reason, 900);
                    return { status: 'waiting', reason: 'stability_guard', retryScheduled, stableMatches: Number(pending.stableMatches || 0) };
                }
                return commitPendingNowUnlocked(char, chat, reason, {
                    pending,
                    deferMaintenance: options?.deferMaintenance === true,
                    suppressFinalizeRetry: options?.suppressFinalizeRetry === true
                });
            });
        };

        return Object.freeze({
            getPending,
            getPendingComparableHashes,
            registerPending,
            finalizePending,
            commitPendingNow,
            schedulePendingFinalizeRetry,
            dropPending,
            getFinalizedTurnMeta,
            setFinalizedTurnMeta
        });
    })();

    const buildCurrentTurnEntityAnalysisContext = async (char, chat, lore, strictUserMsg, strictAiResponse, turnForMaintenance = 0, config = MemoryEngine.CONFIG) => {
        const analysisEvidence = buildCurrentTurnAnalysisEvidence(strictUserMsg, strictAiResponse, config);
        const entityConversationText = String(analysisEvidence.text || strictAiResponse || '').trim();
        const storedInfo = EntityAwareProcessor.formatStoredInfoForExtraction(10, {
            conversationText: entityConversationText,
            maxChars: 5600
        });
        const currentTurnCharacterEntityHints = await CharacterEntitySourceHintBridge.build(char, chat, entityConversationText, {
            limit: 8,
            maxChars: 3200,
            purpose: 'current_turn_entity_analysis'
        });
        const entityAnalysisMemoryHints = AnalysisMemoryHintBridge.build(lore, entityConversationText, {
            limit: 5,
            maxChars: 220,
            purpose: 'current_turn_entity_world_analysis'
        });
        const rpLongTermEntityCueBlock = EntityAnalysisHintBridge.buildRpLongTermCueBlock(lore, entityConversationText, {
            maxChars: 1400,
            currentTurn: turnForMaintenance || MemoryEngine.getCurrentTurn()
        });
        const characterEntityHintBlock = [
            currentTurnCharacterEntityHints.block,
            rpLongTermEntityCueBlock
        ].filter(Boolean).join('\n\n');
        const memoryHintTitle = 'Long-Term Compact Memory Hints for Current Turn Analysis';
        const memoryHintBlock = AnalysisMemoryHintBridge.format(entityAnalysisMemoryHints, { title: memoryHintTitle });
        return {
            entityConversationText,
            storedInfo,
            characterEntityHintBlock,
            memoryHints: entityAnalysisMemoryHints,
            memoryHintTitle,
            memoryHintBlock,
            analysisEvidenceMode: analysisEvidence.mode,
            analysisIncludesUserInput: analysisEvidence.includeUser,
            userEvidenceText: analysisEvidence.userText,
            assistantEvidenceText: analysisEvidence.assistantText,
            evidenceLabel: analysisEvidence.label,
            evidencePolicy: analysisEvidence.policy
        };
    };

    const processNarrativeTurnState = async (char, chat, lore, userMsg, aiResponse, m_id = null, options = {}) => {
        const config = MemoryEngine.CONFIG;
        const skipNarrativeRecord = options?.skipNarrativeRecord === true;
        const turnChannel = (options?.narrativeChannel && typeof options.narrativeChannel === 'object')
            ? options.narrativeChannel
            : classifyNarrativeTurnChannel(userMsg, aiResponse);
        const strictUserMsg = turnChannel.strictUser || getStrictNarrativeUserText(userMsg);
        const strictAiResponse = String(turnChannel.strictAi || Utils.getNarrativeComparableText(aiResponse, 'ai') || '').trim();
        const narrativeUserLabel = strictUserMsg
            || (turnChannel.channel === 'meta' ? String(turnChannel.rawUser || userMsg || '').trim() : '')
            || ((options.autoContinue && aiResponse) ? '[auto-continue]' : '');
        if (turnChannel.channel === 'meta') {
            if (narrativeUserLabel && !skipNarrativeRecord) {
                const narrativeAnchorMeta = {
                    ...(options?.anchorMeta && typeof options.anchorMeta === 'object' ? options.anchorMeta : {}),
                    m_id: m_id || options?.anchorMeta?.m_id || '',
                    messageId: m_id || options?.anchorMeta?.messageId || '',
                    chatId: String(chat?.id || options?.anchorMeta?.chatId || '').trim(),
                    turnAnchorReason: String(options?.anchorMeta?.turnAnchorReason || 'v4.2-finalized-turn').trim() || 'v4.2-finalized-turn'
                };
                await NarrativeTracker.recordTurn(MemoryEngine.getCurrentTurn(), narrativeUserLabel, aiResponse, [], config, {
                    anchorMeta: narrativeAnchorMeta,
                    channel: 'meta',
                    containsMetaSignals: turnChannel.containsMetaSignals
                });
            }
            return {
                config,
                conversationEmotion: null,
                involvedEntities: [],
                entitiesToConsolidate: [],
                strictUserMsg,
                recordedNarrativeTurn: !!narrativeUserLabel && !skipNarrativeRecord,
                narrativeTrack: 'meta'
            };
        }
        const conversationEmotion = null;
        const conversationEmotionNote = '';

        const complexAnalysis = ComplexWorldDetector.analyze(analysisIncludesUserInput(config) ? strictUserMsg : '', strictAiResponse);

        if (config.debug && complexAnalysis.hasComplexElements) {
            recordRuntimeDebug('log', '[LIBRA] Complex indicators:', complexAnalysis.indicators);
            recordRuntimeDebug('log', '[LIBRA] Dimensional shifts:', complexAnalysis.dimensionalShifts);
        }

        const entityContext = options?.entityAnalysisContext && typeof options.entityAnalysisContext === 'object'
            ? options.entityAnalysisContext
            : await buildCurrentTurnEntityAnalysisContext(char, chat, lore, strictUserMsg, strictAiResponse, MemoryEngine.getCurrentTurn(), config);
        const entityConversationText = entityContext.entityConversationText || strictAiResponse;
        let entityResult = await EntityAwareProcessor.extractFromConversation(
            '', strictAiResponse, entityContext.storedInfo, config, {
                userRequestMetadata: entityContext.analysisIncludesUserInput
                    ? (entityContext.userEvidenceText || strictUserMsg)
                    : '',
                canonicalEvidenceText: entityConversationText,
                userEvidenceText: entityContext.userEvidenceText || strictUserMsg,
                assistantEvidenceText: entityContext.assistantEvidenceText || strictAiResponse,
                evidenceLabel: entityContext.evidenceLabel || getAnalysisEvidenceLabel(config),
                evidencePolicy: entityContext.evidencePolicy || getAnalysisEvidencePolicy(config),
                analysisEvidenceMode: entityContext.analysisEvidenceMode || getAnalysisEvidenceMode(config),
                characterEntityHintBlock: entityContext.characterEntityHintBlock || '',
                memoryHints: entityContext.memoryHints || [],
                memoryHintTitle: entityContext.memoryHintTitle || 'Long-Term Compact Memory Hints for Current Turn Analysis',
                lorebook: lore,
                precomputedEntityExtraction: options?.precomputedEntityExtraction || null,
                precomputedSourceMode: options?.precomputedSourceMode || ''
            }
        );
        let structuredPacketEntityResult = EntityAwareProcessor.extractStructuredEntitySignals(aiResponse, {
            lorebook: lore,
            conversationText: entityConversationText,
            sourceMessageId: m_id || options?.anchorMeta?.messageId || '',
            turn: MemoryEngine.getCurrentTurn()
        });
        entityResult = EntityAwareProcessor.sanitizeExtractionPayload(entityResult, lore, {
            sourceMode: entityResult?.sourceMode || 'conversation',
            conversationText: entityConversationText,
            requireConversationEvidenceForNew: true
        });
        structuredPacketEntityResult = EntityAwareProcessor.sanitizeExtractionPayload(structuredPacketEntityResult, lore, {
            sourceMode: 'structured_packet',
            conversationText: entityConversationText,
            requireConversationEvidenceForNew: true
        });
        if (config.debug && (entityResult.rejectedEntities?.length || entityResult.rejectedRelations?.length || structuredPacketEntityResult.rejectedEntities?.length || structuredPacketEntityResult.rejectedRelations?.length)) {
            recordRuntimeDebug('warn', '[LIBRA] Entity extraction candidates suppressed:', {
                rejectedEntities: [
                    ...(entityResult.rejectedEntities || []),
                    ...(structuredPacketEntityResult.rejectedEntities || [])
                ].slice(0, 12),
                rejectedRelations: [
                    ...(entityResult.rejectedRelations || []),
                    ...(structuredPacketEntityResult.rejectedRelations || [])
                ].slice(0, 12)
            });
        }
        const worldPayloadForMutation = (entityResult?.world && typeof entityResult.world === 'object' && !Array.isArray(entityResult.world)) ? entityResult.world : {};
        const worldMutationPolicy = resolveComplexWorldMutationPolicy(complexAnalysis, worldPayloadForMutation);
        const readMutationFlag = (keys = []) => {
            const roots = [worldPayloadForMutation?.global, worldPayloadForMutation?.structure, worldPayloadForMutation?.flags, worldPayloadForMutation?.meta];
            for (const root of roots) {
                if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
                for (const key of keys) {
                    if (root[key] === true) return true;
                    if (root[key] === false) return false;
                }
            }
            return undefined;
        };
        const profile = HierarchicalWorldManager.getProfile();
        const explicitShifts = Array.isArray(worldPayloadForMutation?.dimensionalShifts)
            ? worldPayloadForMutation.dimensionalShifts
            : (Array.isArray(worldPayloadForMutation?.dimensional_shifts) ? worldPayloadForMutation.dimensional_shifts : []);
        if (turnChannel.channel === 'scene' && profile?.global && worldMutationPolicy.allowDimensionalShift) {
            for (const shift of explicitShifts) {
                const targetName = String(shift?.to || shift?.target || shift?.world || '').trim();
                if (!targetName) continue;
                if (!profile?.nodes) continue;
                let targetNode = null;

                for (const [id, node] of profile.nodes) {
                    const nodeName = String(node?.name || '').trim();
                    if (nodeName && (nodeName === targetName || nodeName.includes(targetName) || targetName.includes(nodeName))) {
                        targetNode = node;
                        break;
                    }
                }

                if (!targetNode) {
                    const createResult = HierarchicalWorldManager.createNode({
                        name: targetName,
                        layer: 'dimension',
                        parent: profile.rootId,
                        source: 'llm_structured_world_payload'
                    });
                    if (createResult.success) {
                        targetNode = createResult.node;
                        if (config.debug) recordRuntimeDebug('log', '[LIBRA] New dimension created from structured world payload:', targetName);
                    }
                }

                if (targetNode) {
                    HierarchicalWorldManager.changeActivePath(targetNode.id, { method: String(shift?.type || shift?.method || 'llm_structured') });
                }
            }
        }
        if (turnChannel.channel === 'scene' && profile?.global && worldMutationPolicy.allowGlobalFlags) {
            const applyFlag = (targetKey, keys) => {
                const value = readMutationFlag(keys);
                if (value === true || value === false) profile.global[targetKey] = value;
            };
            applyFlag('multiverse', ['multiverse', 'multiVerse', 'multipleWorlds', 'multiple_worlds']);
            applyFlag('dimensionTravel', ['dimensionTravel', 'dimension_travel', 'interdimensionalTravel', 'interdimensional_travel']);
            applyFlag('timeTravel', ['timeTravel', 'time_travel', 'timeLoop', 'time_loop']);
            applyFlag('metaNarrative', ['metaNarrative', 'meta_narrative', 'fourthWall', 'fourth_wall']);
            applyFlag('virtualReality', ['virtualReality', 'virtual_reality', 'simulation']);
            applyFlag('dreamWorld', ['dreamWorld', 'dream_world']);
            applyFlag('reincarnationPossession', ['reincarnationPossession', 'reincarnation_possession', 'reincarnation', 'possession', 'transmigration']);
        }
        if (turnChannel.channel === 'scene' && profile?.global && worldMutationPolicy.allowSystemInterface) {
            profile.global.systemInterface = true;
        }

        if (entityResult.success) {
            for (const entityData of entityResult.entities || []) {
                if (!entityData.name) continue;
                const consistency = EntityManager.checkConsistency(entityData.name, entityData, lore);
                if (!consistency.consistent && config.debug) {
                    recordRuntimeDebug('warn', `[LIBRA] Entity consistency warning:`, consistency.conflicts);
                }
            }
            await EntityAwareProcessor.applyExtractions(entityResult, lore, config, m_id);
        } else if (entityResult.world && String(entityResult.world.__genreSourceText || '').trim()) {
            await EntityAwareProcessor.applyExtractions({
                entities: [],
                relations: [],
                world: entityResult.world,
                conflicts: []
            }, lore, config, m_id);
        }
        if (structuredPacketEntityResult?.success) {
            await EntityAwareProcessor.applyExtractions(structuredPacketEntityResult, lore, config, m_id);
        }

        const involvedEntities = dedupeTextArray([
            ...((entityResult.success && entityResult.entities) ? entityResult.entities.map(e => e.name).filter(Boolean) : []),
            ...((structuredPacketEntityResult.success && structuredPacketEntityResult.entities) ? structuredPacketEntityResult.entities.map(e => e.name).filter(Boolean) : [])
        ]);
        const recordedNarrativeTurn = !!narrativeUserLabel && !skipNarrativeRecord;
        if (recordedNarrativeTurn) {
            const narrativeAnchorMeta = {
                ...(options?.anchorMeta && typeof options.anchorMeta === 'object' ? options.anchorMeta : {}),
                m_id: m_id || options?.anchorMeta?.m_id || '',
                messageId: m_id || options?.anchorMeta?.messageId || '',
                chatId: String(chat?.id || options?.anchorMeta?.chatId || '').trim(),
                turnAnchorReason: String(options?.anchorMeta?.turnAnchorReason || 'v4.2-finalized-turn').trim() || 'v4.2-finalized-turn'
            };
            await NarrativeTracker.recordTurn(MemoryEngine.getCurrentTurn(), narrativeUserLabel, aiResponse, involvedEntities, config, {
                anchorMeta: narrativeAnchorMeta,
                channel: turnChannel.channel,
                containsMetaSignals: turnChannel.containsMetaSignals
            });
        }

        const compactStateList = (value, limit = 4) => dedupeTextArray(
            (Array.isArray(value) ? value : (value ? [value] : []))
                .map(item => String(item || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
        ).slice(0, limit).join(', ');
        const buildCharacterStatusSnapshot = (entityData = {}, extraNote = '') => {
            const rawStatus = entityData?.status;
            const status = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus) ? rawStatus : {};
            const currentStateRaw = entityData?.currentState || entityData?.current_state;
            const currentState = currentStateRaw && typeof currentStateRaw === 'object' && !Array.isArray(currentStateRaw) ? currentStateRaw : {};
            const emotionalState = compactStateList(currentState.emotionalState || currentState.emotional_state, 5);
            const physicalState = compactStateList(currentState.physicalState || currentState.physical_state, 4);
            const cognitiveFocus = compactStateList(currentState.cognitiveFocus || currentState.cognitive_focus, 4);
            const activeProblems = compactStateList(currentState.activeProblems || currentState.active_problems, 4);
            const baseNotes = [
                typeof rawStatus === 'string' ? rawStatus : '',
                status.notes,
                typeof currentStateRaw === 'string' ? currentStateRaw : '',
                currentState.summary || currentState.current_state,
                currentState.immediateGoal || currentState.immediate_goal ? `goal=${currentState.immediateGoal || currentState.immediate_goal}` : '',
                cognitiveFocus ? `focus=${cognitiveFocus}` : '',
                physicalState ? `physical=${physicalState}` : '',
                activeProblems ? `issues=${activeProblems}` : ''
            ].filter(Boolean)
                .map(item => String(item || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const snapshot = {
                currentLocation: status.currentLocation || status.location || currentState.location || '',
                currentMood: status.currentMood || status.mood || emotionalState || '',
                healthStatus: status.healthStatus || status.health || '',
                notes: ''
            };
            const hasEntityState = snapshot.currentLocation || snapshot.currentMood || snapshot.healthStatus || baseNotes.length > 0;
            if (!hasEntityState) return null;
            snapshot.notes = dedupeTextArray([
                ...baseNotes,
                extraNote
            ].filter(Boolean)
                .map(item => String(item || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
            ).join(' | ');
            return snapshot;
        };
        const collectEntityStateNameCandidates = (entityData = {}, canonicalName = '') => {
            const values = [
                canonicalName,
                entityData?.name,
                entityData?.canonicalName,
                entityData?.matchedExistingEntity,
                ...(Array.isArray(entityData?.aliases) ? entityData.aliases : [])
            ];
            const entityCache = EntityManager.getEntityCache?.();
            const cachedEntity = canonicalName && entityCache?.get ? entityCache.get(canonicalName) : null;
            if (cachedEntity) {
                values.push(
                    cachedEntity.name,
                    cachedEntity.canonicalName,
                    ...(Array.isArray(cachedEntity.aliases) ? cachedEntity.aliases : []),
                    ...(Array.isArray(cachedEntity.meta?.aliases) ? cachedEntity.meta.aliases : []),
                    ...(Array.isArray(cachedEntity.identity?.aliases) ? cachedEntity.identity.aliases : [])
                );
            }
            return dedupeTextArray(values.map(item => String(item || '').trim()).filter(Boolean));
        };
        const resolveCharacterStateEntityName = (entityData = {}) => {
            const candidates = collectEntityStateNameCandidates(entityData, '');
            for (const candidate of candidates) {
                const resolved = EntityManager.resolveCanonicalName?.(candidate, lore);
                if (resolved) return resolved;
            }
            return String(entityData?.canonicalName || entityData?.matchedExistingEntity || entityData?.name || '').trim();
        };

        const entitiesToConsolidate = new Set();
        if (turnChannel.channel === 'scene' && (entityResult.success || structuredPacketEntityResult?.success)) {
            for (const entityData of [...(entityResult.entities || []), ...(structuredPacketEntityResult?.entities || [])]) {
                if (!entityData.name) continue;
                const statusForRecord = buildCharacterStatusSnapshot(entityData, conversationEmotionNote);
                if (!statusForRecord) continue;
                const canonicalEntityName = resolveCharacterStateEntityName(entityData) || entityData.name;
                if (canonicalEntityName !== entityData.name) {
                    CharacterStateTracker.renameEntityKey?.(entityData.name, canonicalEntityName, {
                        previousNames: collectEntityStateNameCandidates(entityData, canonicalEntityName)
                    });
                }
                const isCritical = CharacterStateTracker.isCriticalMoment(canonicalEntityName, statusForRecord);
                CharacterStateTracker.recordState(canonicalEntityName, MemoryEngine.getCurrentTurn(), statusForRecord);
                if (isCritical) {
                    CharacterStateTracker.recordCriticalMoment(canonicalEntityName, MemoryEngine.getCurrentTurn(),
                        `Critical change: ${JSON.stringify(statusForRecord)}`);
                }
                entitiesToConsolidate.add(canonicalEntityName);
            }
        }

        let worldSnapshotForCommit = null;
        let isWorldCriticalForCommit = false;
        if (turnChannel.channel === 'scene') {
            const collectWorldPayloadNotesForCommit = (worldPayload = {}) => {
                const payload = worldPayload && typeof worldPayload === 'object' && !Array.isArray(worldPayload) ? worldPayload : {};
                const notes = [];
                const pushText = (label, value) => {
                    const text = String(value || '').replace(/\s+/g, ' ').trim();
                    if (text) notes.push(`${label}: ${truncateForLLM(text, 180, ' ... ')}`);
                };
                const exists = payload.exists && typeof payload.exists === 'object' && !Array.isArray(payload.exists) ? payload.exists : {};
                pushText('Scene', exists.currentScene || exists.scene);
                pushText('Location', exists.currentLocation || exists.location);
                pushText('Time', exists.currentTime || exists.time);
                const systems = payload.systems && typeof payload.systems === 'object' && !Array.isArray(payload.systems) ? payload.systems : {};
                const packetRules = Array.isArray(systems.packetRules) ? systems.packetRules : [];
                if (packetRules.length > 0) pushText('Rules', packetRules.slice(0, 4).join(' | '));
                const custom = payload.custom && typeof payload.custom === 'object' && !Array.isArray(payload.custom) ? payload.custom : {};
                const activeEvents = Array.isArray(custom.activeEvents) ? custom.activeEvents : [];
                if (activeEvents.length > 0) pushText('Events', activeEvents.slice(0, 4).join(' | '));
                const offscreenThreads = Array.isArray(custom.offscreenThreads) ? custom.offscreenThreads : [];
                if (offscreenThreads.length > 0) pushText('Offscreen', offscreenThreads.slice(0, 3).join(' | '));
                return dedupeTextArray(notes).slice(0, 8);
            };
            const worldProfile = HierarchicalWorldManager.getProfile();
            const currentNode = HierarchicalWorldManager.getCurrentNode?.();
            const currentMeta = currentNode?.meta || {};
            const currentRules = HierarchicalWorldManager.getCurrentRules();
            const worldSignals = [];
            if (worldMutationPolicy.allowDimensionalShift && Array.isArray(explicitShifts) && explicitShifts.length > 0) {
                worldSignals.push(`Shift: ${explicitShifts.slice(0, 2).map(shift => `${shift?.from || '?'}->${shift?.to || shift?.target || shift?.world || '?'}`).join(', ')}`);
            }
            worldSignals.push(
                ...collectWorldPayloadNotesForCommit(entityResult?.world || {}),
                ...collectWorldPayloadNotesForCommit(structuredPacketEntityResult?.world || {})
            );
            const worldSnapshot = {
                activePath: worldProfile?.activePath || [],
                rules: currentRules,
                global: worldProfile?.global || {},
                classification: String(currentMeta.classification || currentMeta.worldMetadata?.classification || '').trim(),
                worldSummary: String(currentMeta.worldSummary || currentMeta.worldMetadata?.summary || '').trim(),
                ruleHighlights: extractWorldRuleHighlights(currentRules, 6),
                notes: worldSignals.join(' | ')
            };
            const isWorldCritical = WorldStateTracker.isCriticalMoment(worldSnapshot);
            worldSnapshotForCommit = worldSnapshot;
            isWorldCriticalForCommit = isWorldCritical;
            WorldStateTracker.recordState(MemoryEngine.getCurrentTurn(), worldSnapshot);
            if (isWorldCritical) {
                WorldStateTracker.recordCriticalMoment(MemoryEngine.getCurrentTurn(),
                    `World path changed: ${(worldSnapshot.activePath || []).join('→')}`);
            }
        }

        return {
            config,
            conversationEmotion,
            entityResult,
            involvedEntities,
            entitiesToConsolidate: Array.from(entitiesToConsolidate),
            strictUserMsg,
            narrativeUserLabel,
            recordedNarrativeTurn,
            narrativeTrack: turnChannel.channel,
            worldSnapshot: worldSnapshotForCommit,
            isWorldCritical: isWorldCriticalForCommit,
            m_id
        };
    };
    const NO_PRECOMPUTED_CORRECTION = Symbol('libra.no_precomputed_correction');
    const applyTurnStateCorrections = async (turnState, aiResponse, turnForMaintenance, maintenanceConfig, lorebook, precomputedCorrection = NO_PRECOMPUTED_CORRECTION) => {
        if (!turnState || maintenanceConfig?.autoCorrectStates === false || turnState?.narrativeTrack === 'meta') return { corrected: false };
        const extracted = turnState.entityResult && typeof turnState.entityResult === 'object'
            ? turnState.entityResult
            : { entities: [], relations: [], world: {} };
        const correctionWasPrecomputed = precomputedCorrection !== NO_PRECOMPUTED_CORRECTION;
        const correction = correctionWasPrecomputed
            ? precomputedCorrection
            : await EntityAwareProcessor.verifyTurnCorrections(
                turnState.strictUserMsg || '',
                aiResponse || '',
                extracted,
                maintenanceConfig
            );
        if (!EntityAwareProcessor.hasCorrectionPayload(correction)) {
            return { corrected: false, correction };
        }

        const sanitizedCorrectionEntities = EntityAwareProcessor.sanitizeEntities(correction.correctedEntities || [], lorebook);
        const sanitizedCorrectionRelations = EntityAwareProcessor.sanitizeRelations(
            correction.correctedRelations || [],
            lorebook,
            sanitizedCorrectionEntities.map(entity => entity?.name || '')
        );
        const correctionPayload = {
            entities: sanitizedCorrectionEntities,
            relations: sanitizedCorrectionRelations,
            world: correction.world || {},
            conflicts: [],
            sourceMode: 'correction'
        };
        await EntityAwareProcessor.applyExtractions(correctionPayload, lorebook, maintenanceConfig, turnState.m_id || null);

        const correctedEntityNames = sanitizedCorrectionEntities
            .map(entity => String(entity?.name || '').trim())
            .filter(Boolean);
        if (correctedEntityNames.length > 0) {
            turnState.involvedEntities = Array.from(new Set([...(turnState.involvedEntities || []), ...correctedEntityNames]));
            turnState.entitiesToConsolidate = Array.from(new Set([...(turnState.entitiesToConsolidate || []), ...correctedEntityNames]));
        }

        const correctionReasonText = Array.isArray(correction.reasons) && correction.reasons.length > 0
            ? `Auto-corrected: ${correction.reasons.join(' | ')}`
            : 'Auto-corrected';
        for (const entityData of sanitizedCorrectionEntities) {
            if (!entityData?.name || !entityData?.status) continue;
            const statusForRecord = {
                ...entityData.status,
                notes: [entityData.status.notes || '', correctionReasonText].filter(Boolean).join(' | ')
            };
            CharacterStateTracker.replaceState(entityData.name, turnForMaintenance, statusForRecord);
        }

        if (correction.world && Object.keys(correction.world).length > 0) {
            const worldProfile = HierarchicalWorldManager.getProfile();
            const currentNode = HierarchicalWorldManager.getCurrentNode?.();
            const currentMeta = currentNode?.meta || {};
            const currentRules = HierarchicalWorldManager.getCurrentRules();
            const correctionWorldNote = buildWorldCorrectionNote(correction.world, correctionReasonText);
            WorldStateTracker.replaceState(turnForMaintenance, {
                activePath: worldProfile?.activePath || [],
                rules: currentRules,
                global: worldProfile?.global || {},
                classification: String(currentMeta.classification || currentMeta.worldMetadata?.classification || '').trim(),
                worldSummary: String(currentMeta.worldSummary || currentMeta.worldMetadata?.summary || '').trim(),
                ruleHighlights: extractWorldRuleHighlights(currentRules, 6),
                notes: correctionWorldNote
            });
        }

        const correctedNarrativeSummary = String(correction?.narrative?.summary || '').trim();
        const correctedNarrativeEntities = Array.isArray(correction?.narrative?.entities)
            ? correction.narrative.entities.map(item => String(item || '').trim()).filter(Boolean)
            : [];
        if (correctedNarrativeSummary || correctedNarrativeEntities.length > 0) {
            NarrativeTracker.correctTurn(turnForMaintenance, {
                summary: correctedNarrativeSummary,
                entities: correctedNarrativeEntities.length > 0 ? correctedNarrativeEntities : correctedEntityNames,
                storylineName: correction?.narrative?.currentArc || correction?.narrative?.storylineName || '',
                narrativeGoal: correction?.narrative?.narrativeGoal || correction?.narrative?.primaryConflict || '',
                keyPoints: Array.isArray(correction?.narrative?.keyPoints) ? correction.narrative.keyPoints : [],
                ongoingTensions: Array.isArray(correction?.narrative?.ongoingTensions) ? correction.narrative.ongoingTensions : []
            });
        }

        const narrativeState = NarrativeTracker.getState?.();
        if (narrativeState && typeof narrativeState === 'object') {
            narrativeState.lastSummaryTurn = Math.min(Number(narrativeState.lastSummaryTurn || turnForMaintenance), Math.max(0, turnForMaintenance - 1));
        }

        if (maintenanceConfig.debug) {
            recordRuntimeDebug('log', '[LIBRA] Turn auto-correction applied:', correction.reasons || []);
        }
        return { corrected: true, correction };
    };
