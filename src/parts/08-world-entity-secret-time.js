    // ══════════════════════════════════════════════════════════════
    // [ENGINE] World Archetype Registry
    // ══════════════════════════════════════════════════════════════
    // V5.2.8: keep this as an empty compatibility registry. Previous builds
    // expanded genre labels such as "fantasy" or "modern" into predefined
    // world rules, which made world canon drift toward local heuristics. World
    // rules now come from explicit LLM/packet/manual fields only; local code may
    // normalize, sanitize, and dedupe, but it must not synthesize genre defaults.
    const WORLD_TEMPLATES = Object.freeze({});

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Hierarchical World Manager
    // ══════════════════════════════════════════════════════════════
    const HierarchicalWorldManager = (() => {
        let profile = null;
        const WORLD_GRAPH_COMMENT = "lmai_world_graph";
        const WORLD_NODE_COMMENT = "lmai_world_node";
        const REMOVED_WORLD_GRAPH_COMMENTS = new Set([WORLD_GRAPH_COMMENT, WORLD_NODE_COMMENT]);

        const removeWorldGraphEntries = (lorebook) => {
            if (!Array.isArray(lorebook)) return 0;
            let removed = 0;
            for (let i = lorebook.length - 1; i >= 0; i--) {
                if (REMOVED_WORLD_GRAPH_COMMENTS.has(String(lorebook[i]?.comment || ''))) {
                    lorebook.splice(i, 1);
                    removed += 1;
                }
            }
            return removed;
        };

        const createDefaultProfile = () => ({
            version: '6.0',
            rootId: null,
            global: {
                multiverse: false,
                dimensionTravel: false,
                timeTravel: false,
                metaNarrative: false,
                virtualReality: false,
                dreamWorld: false,
                reincarnationPossession: false,
                systemInterface: false
            },
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
                exists: { mythical_creatures: [], non_human_races: [] },
                systems: {},
                setting: { places: [], organizations: [], socialRules: [] },
                physics: { special_phenomena: [] },
                inheritance: { mode: 'extend', exceptions: [] },
                ruleMeta: {
                    schema: 'libra.world.rule_meta.v1',
                    metaphysics: {
                        magic: { state: 'unknown', explicitness: 'none', emitPolicy: 'silent', evidence: [] },
                        ki: { state: 'unknown', explicitness: 'none', emitPolicy: 'silent', evidence: [] },
                        supernatural: { state: 'unknown', explicitness: 'none', emitPolicy: 'silent', evidence: [] }
                    },
                    systems: {},
                    consistencyWarnings: [],
                    autoDemotions: []
                }
            },
            dimensional: null,
            connections: [],
            meta: { created: Date.now(), updated: 0, source: 'default', notes: '', worldSummary: '', classification: '', worldMetadata: {} }
        });

        const normalizeNodeMap = (nodes) => {
            if (nodes instanceof Map) return nodes;
            if (Array.isArray(nodes)) {
                try { return new Map(nodes.filter(item => Array.isArray(item) && item.length >= 2)); }
                catch { return new Map(); }
            }
            if (nodes && typeof nodes === 'object') {
                try { return new Map(Object.entries(nodes)); }
                catch { return new Map(); }
            }
            return new Map();
        };

        const ensureProfile = () => {
            if (!profile || typeof profile !== 'object') {
                profile = createDefaultProfile();
            }
            profile.nodes = normalizeNodeMap(profile.nodes);
            profile.global = (profile.global && typeof profile.global === 'object') ? profile.global : createDefaultProfile().global;
            profile.activePath = Array.isArray(profile.activePath) ? profile.activePath : [];
            profile.interference = (profile.interference && typeof profile.interference === 'object') ? profile.interference : { level: 0, recentEvents: [] };
            profile.interference.recentEvents = Array.isArray(profile.interference.recentEvents) ? profile.interference.recentEvents : [];
            profile.meta = (profile.meta && typeof profile.meta === 'object') ? profile.meta : { created: Date.now(), updated: 0, complexity: 1 };
            if (profile.nodes.size === 0) {
                profile.rootId = null;
                profile.activePath = [];
                return profile;
            }
            if (!profile.rootId || !profile.nodes.has(profile.rootId)) {
                profile.rootId = profile.nodes.keys().next().value || null;
            }
            if (profile.activePath.length === 0 && profile.rootId) {
                profile.activePath = [profile.rootId];
            }
            return profile;
        };

        const deepMerge = (target, source) => {
            const result = { ...target };
            for (const key in source) {
                if (Array.isArray(source[key])) {
                    result[key] = [...new Set([...(Array.isArray(result[key]) ? result[key] : []), ...source[key]])];
                } else if (source[key] && typeof source[key] === 'object') {
                    const nextTarget = (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) ? result[key] : {};
                    result[key] = deepMerge(nextTarget, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        };

        const deepClone = safeClone;

        const sanitizeNodeWorldRules = (node = null) => {
            if (!node || typeof node !== 'object') return node;
            const meta = node.meta && typeof node.meta === 'object' ? node.meta : {};
            const sourceText = [
                meta.classification,
                meta.worldSummary,
                meta.notes,
                meta.userWorldCorrection,
                meta.worldMetadata?.classification,
                meta.worldMetadata?.summary,
                meta.worldMetadata?.description,
                meta.worldMetadata?.tech,
                meta.worldMetadata?.sourceText,
                meta.worldMetadata?.userWorldCorrection,
                collectWorldRuleEvidenceText(node.rules || {})
            ].map(value => String(value || '').trim()).filter(Boolean).join('\n');
            node.rules = sanitizeWorldRuleUpdateForPolicy(node.rules || {}, sourceText);
            return node;
        };

        const serializeWorldNode = (node = {}) => ({
            id: String(node?.id || '').trim(),
            name: String(node?.name || '').trim() || '주요 세계',
            layer: String(node?.layer || '').trim() || 'dimension',
            parent: node?.parent || null,
            children: Array.isArray(node?.children) ? node.children.map(value => String(value || '').trim()).filter(Boolean).slice(0, 64) : [],
            isActive: node?.isActive === true,
            isPrimary: node?.isPrimary !== false,
            accessCondition: node?.accessCondition || null,
            rules: sanitizeWorldRuleUpdateForPolicy(node?.rules || {}, collectWorldRuleEvidenceText(node?.rules || {})),
            dimensional: node?.dimensional && typeof node.dimensional === 'object' ? safeClone(node.dimensional) : null,
            connections: Array.isArray(node?.connections) ? safeClone(node.connections).slice(0, 64) : [],
            meta: node?.meta && typeof node.meta === 'object' ? safeClone(node.meta) : { created: Date.now(), updated: 0, source: 'llm_analysis', notes: '', worldSummary: '', classification: '', worldMetadata: {} }
        });

        const serializeWorldProfile = () => {
            ensureProfile();
            const nodes = Array.from(profile.nodes.entries())
                .slice(0, 64)
                .map(([id, node]) => [String(id || node?.id || '').trim(), serializeWorldNode({ ...node, id: String(id || node?.id || '').trim() })])
                .filter(([id, node]) => id && node && node.id);
            return {
                schema: 'libra.world.graph.compact.v2',
                version: '6.1',
                rootId: String(profile.rootId || '').trim() || (nodes[0] ? nodes[0][0] : null),
                global: profile.global && typeof profile.global === 'object' ? safeClone(profile.global) : createDefaultProfile().global,
                nodes,
                activePath: Array.isArray(profile.activePath) ? profile.activePath.map(value => String(value || '').trim()).filter(Boolean).slice(0, 16) : [],
                interference: profile.interference && typeof profile.interference === 'object' ? safeClone(profile.interference) : { level: 0, recentEvents: [] },
                meta: profile.meta && typeof profile.meta === 'object' ? safeClone(profile.meta) : { created: Date.now(), updated: 0, complexity: 1 }
            };
        };

        const hydrateWorldProfile = (rawProfile = null) => {
            const next = createDefaultProfile();
            const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
            const rawNodes = Array.isArray(source.nodes)
                ? source.nodes
                : (source.nodes && typeof source.nodes === 'object' ? Object.entries(source.nodes) : []);
            for (const entry of rawNodes) {
                const id = Array.isArray(entry) ? String(entry[0] || '').trim() : String(entry?.id || '').trim();
                const node = Array.isArray(entry) ? entry[1] : entry;
                if (!id || !node || typeof node !== 'object') continue;
                next.nodes.set(id, sanitizeNodeWorldRules(serializeWorldNode({ ...node, id })));
            }
            if (next.nodes.size === 0) {
                const root = createDefaultRootNode();
                next.rootId = root.id;
                next.nodes.set(root.id, root);
                next.activePath = [root.id];
            } else {
                next.rootId = String(source.rootId || '').trim();
                if (!next.rootId || !next.nodes.has(next.rootId)) next.rootId = next.nodes.keys().next().value || null;
                next.activePath = Array.isArray(source.activePath)
                    ? source.activePath.map(value => String(value || '').trim()).filter(value => next.nodes.has(value)).slice(0, 16)
                    : [];
                if (next.activePath.length === 0 && next.rootId) next.activePath = [next.rootId];
            }
            next.global = source.global && typeof source.global === 'object' ? safeClone(source.global) : next.global;
            next.interference = source.interference && typeof source.interference === 'object' ? safeClone(source.interference) : next.interference;
            next.interference.recentEvents = Array.isArray(next.interference?.recentEvents) ? next.interference.recentEvents.slice(-10) : [];
            next.meta = source.meta && typeof source.meta === 'object' ? safeClone(source.meta) : next.meta;
            profile = next;
            updateComplexity();
            return ensureProfile();
        };

        const loadWorldGraph = (lorebook, force = false) => {
            if (profile && !force) return profile;
            const unpacked = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : []);
            const entry = unpacked.find(item => String(item?.comment || '') === WORLD_GRAPH_COMMENT);
            if (entry) {
                try {
                    const parsed = JSON.parse(entry.content || '{}');
                    return hydrateWorldProfile(parsed);
                } catch (error) {
                    recordRuntimeDebug('warn', '[LIBRA] World graph parse failed; rebuilding empty root:', error?.message || error);
                }
            }
            return hydrateWorldProfile(null);
        };

        const getEffectiveRules = (nodeId) => {
            ensureProfile();
            const node = profile.nodes.get(nodeId);
            if (!node) return null;

            const parentChain = [];
            const visited = new Set();
            let currentId = node.parent;
            
            visited.add(nodeId); // 현재 노드 등록
            while (currentId) {
                if (visited.has(currentId)) {
                    recordRuntimeDebug('warn', `[LIBRA] Circular reference detected in world graph at node: ${currentId}`);
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
            if (!profile) return null;
            ensureProfile();
            if (profile.activePath.length === 0) return null;
            const currentId = profile.activePath[profile.activePath.length - 1];
            return getEffectiveRules(currentId);
        };
        const getCurrentNode = () => {
            if (!profile) return null;
            ensureProfile();
            if (!Array.isArray(profile.activePath) || profile.activePath.length === 0) return null;
            const currentId = profile.activePath[profile.activePath.length - 1];
            return profile.nodes.get(currentId) || null;
        };
        const getUserWorldCorrection = () => {
            const currentNode = getCurrentNode();
            const text = String(
                currentNode?.meta?.userWorldCorrection
                || currentNode?.meta?.worldMetadata?.userWorldCorrection
                || ''
            ).trim();
            return text;
        };
        const formatUserWorldCorrectionForPrompt = () => '';

        const buildPathToNode = (nodeId) => {
            ensureProfile();
            const path = [];
            const visited = new Set();
            let currentId = nodeId;
            while (currentId) {
                if (visited.has(currentId)) {
                    recordRuntimeDebug('warn', `[LIBRA] Circular reference detected while building active path: ${currentId}`);
                    break;
                }
                visited.add(currentId);
                const node = profile.nodes.get(currentId);
                if (!node) break;
                path.unshift(currentId);
                currentId = node.parent;
            }
            return path;
        };

        const changeActivePath = (newNodeId, transition = null) => {
            ensureProfile();
            const node = profile.nodes.get(newNodeId);
            if (!node) return { success: false, reason: 'Node not found' };

            const oldPath = [...profile.activePath];
            const newPath = buildPathToNode(newNodeId);
            if (newPath.length === 0) return { success: false, reason: 'Unable to build path' };
            profile.activePath = newPath;
            for (const [, worldNode] of profile.nodes) worldNode.isActive = false;
            for (const pathNodeId of newPath) {
                const pathNode = profile.nodes.get(pathNodeId);
                if (pathNode) pathNode.isActive = true;
            }

            if (transition) {
                profile.interference.recentEvents.push({
                    type: 'dimension_shift',
                    from: oldPath,
                    to: [...profile.activePath],
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
            ensureProfile();
            if (profile.activePath.length <= 1) return { success: false, reason: 'Cannot pop root' };
            const removedId = profile.activePath.pop();
            const removedNode = profile.nodes.get(removedId);
            if (removedNode) removedNode.isActive = false;
            return { success: true, removedNode, currentPath: profile.activePath };
        };

        const createNode = (config) => {
            ensureProfile();
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
                rules: config.rules || { exists: {}, systems: {}, setting: { places: [], organizations: [], socialRules: [] }, physics: {}, inheritance: { mode: 'extend', exceptions: [] } },
                dimensional: config.dimensional || null,
                connections: config.connections || [],
                meta: {
                    created: Date.now(),
                    updated: 0,
                    source: config.source || 'user',
                    notes: config.notes || '',
                    worldSummary: config.worldSummary || '',
                    classification: config.classification || '',
                    worldMetadata: config.worldMetadata && typeof config.worldMetadata === 'object' ? safeClone(config.worldMetadata) : {}
                }
            };
            sanitizeNodeWorldRules(node);

            profile.nodes.set(id, node);
            if (parentId) {
                const parent = profile.nodes.get(parentId);
                if (parent) parent.children.push(id);
            }

            updateComplexity();
            return { success: true, node };
        };

        const updateNode = (nodeId, updates) => {
            ensureProfile();
            const node = profile.nodes.get(nodeId);
            if (!node) return { success: false, reason: 'Node not found' };

            if (updates.name) node.name = updates.name;
            if (updates.rules) node.rules = sanitizeWorldRuleUpdateForPolicy(deepMerge(node.rules, updates.rules), collectWorldRuleEvidenceText(updates.rules));
            if (updates.dimensional) node.dimensional = { ...node.dimensional, ...updates.dimensional };
            if (updates.connections) node.connections = [...node.connections, ...updates.connections];
            if (updates.meta && typeof updates.meta === 'object') node.meta = deepMerge(node.meta || {}, updates.meta);
            sanitizeNodeWorldRules(node);
            node.meta.updated = Date.now();

            return { success: true, node };
        };

        const updateComplexity = () => {
            ensureProfile();
            const nodeCount = profile.nodes.size;
            const connectionCount = Array.from(profile.nodes.values()).reduce((sum, n) => sum + (n.connections?.length || 0), 0);
            profile.meta.complexity = 1 + Math.log2(nodeCount + 1) + (connectionCount * 0.1);
        };

        const _saveWorldGraphUnsafe = (lorebook) => {
            if (!Array.isArray(lorebook)) return;
            removeWorldGraphEntries(lorebook);
            const payload = serializeWorldProfile();
            lorebook.push({
                key: LibraLoreKeys?.worldGraph ? LibraLoreKeys.worldGraph() : 'lmai_world_graph::compact',
                comment: WORLD_GRAPH_COMMENT,
                content: JSON.stringify(payload),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            });
        };

        const saveWorldGraph = async (char, chat, lorebook) => {
            await loreLock.writeLock();
            try {
                _saveWorldGraphUnsafe(lorebook);
            } finally {
                loreLock.writeUnlock();
            }
        };

        const formatForPrompt = () => {
            if (!profile) return '';
            ensureProfile();

            const compactWorldList = (values = [], limit = 10) => dedupeTextArray(
                (Array.isArray(values) ? values : [values])
                    .flatMap(value => splitImportedWorldRuleFragments(String(value || '')))
                    .map(value => String(value || '').trim())
                    .filter(value => value && !isStructuralWorldScalar(value))
            ).slice(0, limit);
            const compactCustomRules = (custom = {}, limit = 10) => {
                const normalized = normalizeWorldCustomRules(custom);
                const out = [];
                for (const [key, value] of Object.entries(normalized)) {
                    for (const fragment of splitImportedWorldRuleFragments(value)) {
                        const text = String(fragment || '').trim();
                        if (!text || isStructuralWorldScalar(text)) continue;
                        out.push(/^rule_\d+$/i.test(String(key || '').trim()) ? text : `${key}: ${text}`);
                    }
                }
                return dedupeTextArray(out).slice(0, limit);
            };

            const parts = [];
            parts.push('【세계관 구조 / World Structure】');

            const globalFeatures = [];
            if (profile.global.multiverse) globalFeatures.push('멀티버스/Multiverse');
            if (profile.global.dimensionTravel) globalFeatures.push('차원 이동 가능/Dimension Travel');
            if (profile.global.timeTravel) globalFeatures.push('시간 여행 가능/Time Travel');
            if (profile.global.metaNarrative) globalFeatures.push('메타 서술/Meta Narrative');
            if (profile.global.virtualReality) globalFeatures.push('가상현실/Virtual Reality');
            if (profile.global.dreamWorld) globalFeatures.push('꿈 세계/Dream World');
            if (profile.global.reincarnationPossession) globalFeatures.push('회귀·환생·빙의/Reincarnation or Possession');
            if (profile.global.systemInterface) globalFeatures.push('시스템 인터페이스/System Interface');
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

            const currentNodeId = profile.activePath[profile.activePath.length - 1];
            const currentNode = currentNodeId ? profile.nodes.get(currentNodeId) : null;
            const currentMeta = currentNode?.meta || {};
            const worldSummaryLines = [];
            const classification = String(currentMeta.classification || currentMeta.worldMetadata?.classification || '').trim();
            const worldSummary = String(currentMeta.worldSummary || currentMeta.worldMetadata?.summary || '').trim();
            const worldDescription = String(currentMeta.worldMetadata?.description || '').trim();
            const worldTechMemo = String(currentMeta.worldMetadata?.tech || '').trim();
            const worldNotes = String(currentMeta.notes || currentMeta.worldMetadata?.notes || '').trim();
            const userWorldCorrection = String(currentMeta.userWorldCorrection || currentMeta.worldMetadata?.userWorldCorrection || '').trim();
            if (classification) worldSummaryLines.push(`분류/Classification: ${classification}`);
            if (worldSummary) worldSummaryLines.push(`요약/Summary: ${truncateForLLM(worldSummary, 700, ' ... ')}`);
            if (worldDescription) worldSummaryLines.push(`설명/Description: ${truncateForLLM(worldDescription, 500, ' ... ')}`);
            if (worldTechMemo) worldSummaryLines.push(`기술 메모/Tech Note: ${truncateForLLM(worldTechMemo, 360, ' ... ')}`);
            if (worldNotes) worldSummaryLines.push(`노트/Notes: ${truncateForLLM(worldNotes, 360, ' ... ')}`);
            if (userWorldCorrection) worldSummaryLines.push(`수동 보정/User Correction: ${truncateForLLM(userWorldCorrection, 600, ' ... ')}`);
            if (worldSummaryLines.length > 0) {
                parts.push('\n[세계관 코덱스 / World Codex]');
                parts.push(...worldSummaryLines.map(line => `  ${line}`));
            }

            const currentRules = sanitizeWorldRuleUpdateForPolicy(getCurrentRules(), collectWorldRuleEvidenceText(getCurrentRules()));
            if (currentRules) {
                parts.push('\n[현재 세계 규칙 / Current World Rules]');
                const exists = currentRules.exists || {};
                const existingElements = [];
                if (shouldEmitWorldPresentRule(currentRules, 'magic')) existingElements.push('마법/Magic');
                if (shouldEmitWorldPresentRule(currentRules, 'ki')) existingElements.push('기(氣)/Ki');
                if (shouldEmitWorldPresentRule(currentRules, 'supernatural')) existingElements.push('초자연/Supernatural');
                existingElements.push(...compactWorldList(exists.mythical_creatures, 8));
                existingElements.push(...compactWorldList(exists.non_human_races, 8));
                if (existingElements.length > 0) parts.push(`  존재/Exists: ${existingElements.join(', ')}`);

                const absentElements = [];
                if (shouldEmitWorldAbsentRule(currentRules, 'magic')) absentElements.push('마법 없음/No magic');
                if (shouldEmitWorldAbsentRule(currentRules, 'ki')) absentElements.push('기 없음/No ki');
                if (shouldEmitWorldAbsentRule(currentRules, 'supernatural')) absentElements.push('초자연 없음/No supernatural');
                if (absentElements.length > 0) parts.push(`  부재/Absent: ${absentElements.join(', ')}`);

                const systems = currentRules.systems || {};
                const activeSystems = [];
                if (systems.leveling) activeSystems.push('레벨/Level');
                if (systems.skills) activeSystems.push('스킬/Skill');
                if (systems.stats) activeSystems.push('스탯/Stats');
                if (systems.classes) activeSystems.push('직업/Class');
                if (systems.guilds) activeSystems.push('길드/Guild');
                if (systems.factions) activeSystems.push('세력/Faction');
                if (activeSystems.length > 0) parts.push(`  시스템/Systems: ${activeSystems.join(', ')}`);

                const inactiveSystems = [];
                if (shouldEmitWorldInactiveSystem(currentRules, 'leveling')) inactiveSystems.push('레벨/Level');
                if (shouldEmitWorldInactiveSystem(currentRules, 'skills')) inactiveSystems.push('스킬/Skill');
                if (shouldEmitWorldInactiveSystem(currentRules, 'stats')) inactiveSystems.push('스탯/Stats');
                if (shouldEmitWorldInactiveSystem(currentRules, 'classes')) inactiveSystems.push('직업/Class');
                if (inactiveSystems.length > 0) parts.push(`  비활성 시스템/Inactive Systems: ${inactiveSystems.join(', ')}`);

                if (exists.technology) {
                    parts.push(`  기술/Technology: ${exists.technology}`);
                }
                const setting = normalizeWorldSettingRules(currentRules.setting);
                if (setting.places.length > 0) {
                    parts.push(`  장소·시설/Places: ${setting.places.join(', ')}`);
                }
                if (setting.organizations.length > 0) {
                    parts.push(`  조직/Organizations: ${setting.organizations.join(', ')}`);
                }
                if (setting.socialRules.length > 0) {
                    parts.push('  사회·문화 규칙/Social Rules:');
                    parts.push(...setting.socialRules.slice(0, 10).map(rule => `    - ${rule}`));
                }
                const physics = currentRules.physics || {};
                if (!isDefaultWorldGravity(physics.gravity) && physics.gravity) {
                    parts.push(`  중력/Gravity: ${physics.gravity}`);
                }
                if (!isDefaultWorldTimeFlow(physics.time_flow || physics.timeFlow) && (physics.time_flow || physics.timeFlow)) {
                    parts.push(`  시간 흐름/Time Flow: ${physics.time_flow || physics.timeFlow}`);
                }
                if (!isDefaultWorldSpace(physics.space) && physics.space) {
                    parts.push(`  공간/Space: ${physics.space}`);
                }
                if (physics.dimensionStability) {
                    parts.push(`  차원 안정성/Dimension Stability: ${physics.dimensionStability}`);
                }
                const phenomena = compactWorldList(physics.special_phenomena, 8);
                if (phenomena.length > 0) {
                    parts.push(`  현상/Phenomena: ${phenomena.join(', ')}`);
                }
                const customRules = compactCustomRules(currentRules.custom, 10);
                if (customRules.length > 0) {
                    parts.push('  추가 규칙/Custom Rules:');
                    parts.push(...customRules.map(rule => `    - ${rule}`));
                }
            }

            if (currentNode?.connections?.length > 0) {
                const connections = compactWorldList(currentNode.connections.map(item => {
                    if (typeof item === 'string') return item;
                    if (item && typeof item === 'object') return item.name || item.id || item.target || JSON.stringify(item);
                    return '';
                }), 6);
                if (connections.length > 0) {
                    parts.push('\n[세계 연결 / World Connections]');
                    parts.push(`  ${connections.join(', ')}`);
                }
            }

            if (profile.interference.level > 0.5) {
                parts.push('\n⚠️ 차원 간섭도 높음 - 세계 간 영향 가능 / High dimensional interference - cross-world effects possible');
            }

            const meaningfulLines = parts
                .map(line => String(line || '').trim())
                .filter(line => line
                    && !/^【세계관 구조\s*\/\s*World Structure】$/i.test(line)
                    && !/^\[(현재 위치\s*\/\s*Current Location|세계관 코덱스\s*\/\s*World Codex|현재 세계 규칙\s*\/\s*Current World Rules|세계 연결\s*\/\s*World Connections)\]$/i.test(line)
                    && !/^주요 세계\s*←\s*현재\/Current$/i.test(line));
            if (meaningfulLines.length === 0) return '';
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
            saveWorldGraphUnsafe: _saveWorldGraphUnsafe,
            formatForPrompt,
            getCurrentNode,
            getUserWorldCorrection,
            formatUserWorldCorrectionForPrompt,
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
        const ENTITY_ABSORPTION_COMMENT = "lmai_entity_absorption";
        const ENTITY_ABSORPTION_SCHEMA = "libra_entity_absorption_v1";
        const RELATION_DELTA_SCALE = 0.5;
        // V5.2.7 storage guard: entity/relation rollback snapshots only need a short recent window.
        const MAX_ROLLBACK_SNAPSHOTS = 2;
        let identityState = {
            userCanonical: 'User',
            userAliases: new Set(['user', '사용자', 'you', 'me', '나', '본인'])
        };

        // V5.2.2 stability patch: canonical-name lookup cache.
        // This keeps EntityManager.resolveCanonicalName from reparsing/scanning the
        // full entity collection on every call in long chats. The cache is invalidated
        // whenever entityCache mutates, while lorebook-backed fallback uses a compact
        // signature derived from entity entry count/hash.
        const ENTITY_RESOLVE_CACHE_LIMIT = 4096;
        let entityCacheRevision = 0;
        let entityLookupIndexCache = null;
        const entityResolveCache = new Map();
        const trimEntityResolveCache = () => {
            while (entityResolveCache.size > ENTITY_RESOLVE_CACHE_LIMIT) {
                const first = entityResolveCache.keys().next().value;
                if (!first) break;
                entityResolveCache.delete(first);
            }
        };
        const invalidateEntityResolveCaches = () => {
            entityCacheRevision++;
            entityLookupIndexCache = null;
            entityResolveCache.clear();
        };
        (() => {
            const baseSet = entityCache.set.bind(entityCache);
            const baseDelete = entityCache.delete.bind(entityCache);
            const baseClear = entityCache.clear.bind(entityCache);
            entityCache.set = (key, value) => { const result = baseSet(key, value); invalidateEntityResolveCaches(); return result; };
            entityCache.delete = (key) => { const result = baseDelete(key); if (result) invalidateEntityResolveCaches(); return result; };
            entityCache.clear = () => { const had = entityCache.size > 0; const result = baseClear(); if (had) invalidateEntityResolveCaches(); return result; };
        })();

        const stripNameTitles = (name) => {
            let normalized = String(name || '')
                .replace(/[“”"'`‘’]/g, '')
                .replace(/\[[^\]]*\]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const koTitles = ['선생님', '교수님', '박사님', '씨', '님'];
            const spacedKoTitles = ['양', '군'];
            const enTitles = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.', 'Sir', 'Lady', 'Lord'];
            for (const title of koTitles) {
                if (normalized.endsWith(title) && normalized.length > title.length + 1) {
                    normalized = normalized.slice(0, -title.length).trim();
                    break;
                }
            }
            for (const title of spacedKoTitles) {
                const pattern = new RegExp(`\\s+${title}$`, 'u');
                if (pattern.test(normalized)) {
                    normalized = normalized.replace(pattern, '').trim();
                    break;
                }
            }
            for (const title of enTitles) {
                const needsBoundary = !title.endsWith('.');
                const hasTitlePrefix = normalized.startsWith(title + ' ')
                    || (!needsBoundary && normalized.startsWith(title))
                    || normalized === title;
                if (hasTitlePrefix) {
                    normalized = normalized.slice(title.length).trim();
                    break;
                }
            }
            return normalized.trim();
        };

        const extractBilingualNameParts = (name) => {
            const raw = String(name || '').replace(/[“”"'`‘’]/g, '').trim();
            const match = raw.match(/^([^()[\]]+?)\s*\(([^()]+?)\)\s*$/);
            if (!match) return null;
            const primary = stripNameTitles(match[1]).trim();
            const secondary = stripNameTitles(match[2]).trim();
            if (!primary || !secondary) return null;
            return { primary, secondary };
        };

        const normalizeCanonicalDisplayName = (name) => {
            const bilingual = extractBilingualNameParts(name);
            if (bilingual) return `${bilingual.primary}(${bilingual.secondary})`;
            return stripNameTitles(String(name || '')).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
        };

        const splitNameVariants = (value) => String(value || '')
            .split(/\s*\/\s*|\s*\|\s*|\s*;\s*|\s*,\s*|\s*[·・]\s*/)
            .map(part => stripNameTitles(part).trim())
            .filter(Boolean);

        const extractNameVariantParts = (name) => {
            const variants = new Set();
            const canonical = normalizeCanonicalDisplayName(name);
            if (canonical) variants.add(canonical);
            const bilingual = extractBilingualNameParts(name);
            if (bilingual) {
                variants.add(bilingual.primary);
                variants.add(bilingual.secondary);
                splitNameVariants(bilingual.primary).forEach(part => variants.add(part));
                splitNameVariants(bilingual.secondary).forEach(part => variants.add(part));
            }
            splitNameVariants(String(name || '').replace(/[()]/g, ' ')).forEach(part => variants.add(part));
            return [...variants].filter(Boolean);
        };

        const normalizeBaseName = (name) => {
            if (!name) return '';
            const bilingual = extractBilingualNameParts(name);
            if (bilingual) {
                return bilingual.primary;
            }
            return normalizeCanonicalDisplayName(name);
        };

        const getKoreanShortName = (name) => {
            const base = normalizeBaseName(name);
            if (!/^[가-힣]{3,4}$/.test(base)) return '';
            return base.slice(-2);
        };

        const getKoreanFamilyName = (name) => {
            const base = normalizeBaseName(name);
            if (!/^[가-힣]{3,4}$/.test(base)) return '';
            return base.slice(0, 1);
        };

        const getEnglishOrJapaneseNameParts = (name) => {
            const base = normalizeBaseName(name);
            if (!base) return [];
            const spaceParts = base.split(/\s+/).filter(Boolean);
            if (spaceParts.length >= 2) {
                return spaceParts;
            }
            if (/[・·]/.test(base)) {
                return base.split(/[・·]/).map(v => v.trim()).filter(Boolean);
            }
            return [];
        };

        const getNameTokenSignatures = (name) => {
            const parts = getEnglishOrJapaneseNameParts(name)
                .map(part => normalizeBaseName(part).toLowerCase())
                .filter(Boolean);
            if (parts.length < 2) return [];
            const signatures = new Set();
            signatures.add(parts.join(' '));
            signatures.add(parts.join(''));
            signatures.add(`${parts[0]} ${parts[parts.length - 1]}`);
            signatures.add(`${parts[parts.length - 1]} ${parts[0]}`);
            signatures.add(`${parts[0]}${parts[parts.length - 1]}`);
            signatures.add(`${parts[parts.length - 1]}${parts[0]}`);
            return [...signatures].filter(Boolean);
        };
        const normalizeIdentityToken = (value) => String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[._'`’\-]/g, '')
            .replace(/[·・]/g, '')
            .replace(/\s+/g, '');
        const romanizeHangulText = (value) => {
            const text = String(value || '').trim();
            if (!text || !/[가-힣]/.test(text)) return '';
            const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
            const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
            const JONG = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 'h'];
            let out = '';
            for (const ch of text) {
                const code = ch.charCodeAt(0);
                if (code < 0xac00 || code > 0xd7a3) {
                    out += ch.toLowerCase();
                    continue;
                }
                const syllableIndex = code - 0xac00;
                const cho = Math.floor(syllableIndex / 588);
                const jung = Math.floor((syllableIndex % 588) / 28);
                const jong = syllableIndex % 28;
                out += `${CHO[cho]}${JUNG[jung]}${JONG[jong]}`;
            }
            return normalizeIdentityToken(out);
        };
        const normalizePhoneticIdentityToken = (value) => {
            const identity = normalizeIdentityToken(value);
            if (!identity) return '';
            const shouldSimplify = /[가-힣]/.test(String(value || '')) || identity.length >= 5 || /[-_.\s]/.test(String(value || ''));
            if (!shouldSimplify) return '';
            return identity.replace(/(.)\1+/g, '$1');
        };
        const isPhoneticallySimilar = (nameA, nameB) => {
            const a = normalizeIdentityToken(nameA);
            const b = normalizeIdentityToken(nameB);
            if (!a || !b) return false;
            if (a === b) return true;
            
            const ra = romanizeHangulText(nameA);
            const rb = romanizeHangulText(nameB);
            if (ra && rb && ra === rb) return true;
            if (ra && ra === b) return true;
            if (rb && rb === a) return true;
            return false;
        };

        const buildHiddenNameKeys = (name) => {
            const keys = new Set();
            const canonical = normalizeCanonicalDisplayName(name);
            const base = normalizeBaseName(name);
            const family = getKoreanFamilyName(name);
            const shortKo = getKoreanShortName(name);
            const addKey = (value) => {
                const normalized = String(value || '').trim().toLowerCase();
                if (!normalized) return;
                keys.add(normalized);
                keys.add(normalized.replace(/\s+/g, ''));
                const identityToken = normalizeIdentityToken(normalized);
                if (identityToken) keys.add(identityToken);
                const phoneticToken = normalizePhoneticIdentityToken(normalized);
                if (phoneticToken) keys.add(phoneticToken);
                const hangulRomanized = romanizeHangulText(normalized);
                if (hangulRomanized) {
                    keys.add(hangulRomanized);
                    const romanizedPhonetic = normalizePhoneticIdentityToken(hangulRomanized);
                    if (romanizedPhonetic) keys.add(romanizedPhonetic);
                }
            };
            addKey(canonical);
            addKey(base);
            extractNameVariantParts(name).forEach(addKey);
            getNameTokenSignatures(name).forEach(addKey);
            if (family && shortKo) {
                addKey(`${family}:${shortKo}`);
                addKey(`${family}${shortKo}`);
                addKey(shortKo); // 성 떼고 이름만으로도 매칭되도록 추가
            }
            return [...keys].filter(Boolean);
        };

        const buildAliasCandidates = (name, includeShortKorean = true) => {
            const base = normalizeBaseName(name);
            const canonical = normalizeCanonicalDisplayName(name);
            if (!base && !canonical) return [];
            const aliases = new Set();
            const pushAlias = (value) => {
                const normalized = String(value || '').trim();
                if (!normalized) return;
                const compact = normalized.replace(/\s+/g, '');
                aliases.add(normalized);
                aliases.add(compact);
                aliases.add(normalized.toLowerCase());
                aliases.add(compact.toLowerCase());
                const identityToken = normalizeIdentityToken(normalized);
                if (identityToken) aliases.add(identityToken);
                const phoneticToken = normalizePhoneticIdentityToken(normalized);
                if (phoneticToken) aliases.add(phoneticToken);
                const hangulRomanized = romanizeHangulText(normalized);
                if (hangulRomanized) {
                    aliases.add(hangulRomanized);
                    const romanizedPhonetic = normalizePhoneticIdentityToken(hangulRomanized);
                    if (romanizedPhonetic) aliases.add(romanizedPhonetic);
                }
            };
            pushAlias(base);
            pushAlias(canonical);
            extractNameVariantParts(name).forEach(pushAlias);
            if (includeShortKorean) {
                const shortKo = getKoreanShortName(base) || (/^[가-힣]{2}$/.test(base) ? base : '');
                if (shortKo) {
                    aliases.add(shortKo);
                    aliases.add(shortKo.toLowerCase());
                    const shortKoRomanized = romanizeHangulText(shortKo);
                    if (shortKoRomanized) {
                        aliases.add(shortKoRomanized);
                        const shortKoPhonetic = normalizePhoneticIdentityToken(shortKoRomanized);
                        if (shortKoPhonetic) aliases.add(shortKoPhonetic);
                    }
                }
            }
            return [...aliases].filter(Boolean);
        };

        const refreshIdentity = (char, db) => {
            const aliases = new Set(['user', '사용자', 'you', 'me', '나', '본인']);
            const selectedPersonaIndex = Number.isInteger(Number(db?.selectedPersona)) ? Number(db.selectedPersona) : 0;
            const personaName = normalizeBaseName(db?.personas?.[selectedPersonaIndex]?.name || '');
            const canonical = personaName || identityState.userCanonical || 'User';
            buildAliasCandidates(canonical, true).forEach(alias => aliases.add(alias));
            if (personaName) buildAliasCandidates(personaName, true).forEach(alias => aliases.add(alias));
            identityState = {
                userCanonical: canonical,
                userAliases: aliases
            };
            return identityState;
        };

        const isUserAlias = (name) => {
            const aliases = buildAliasCandidates(name, true);
            return aliases.some(alias => identityState.userAliases.has(alias));
        };
        const readActiveEntityBlocklist = () => {
            try {
                return normalizeEntityBlocklistCollection(
                    (typeof MemoryEngine !== 'undefined' && MemoryEngine?.CONFIG)
                        ? MemoryEngine.CONFIG.entityBlocklist
                        : []
                );
            } catch {
                return [];
            }
        };
        const BUILTIN_WEAK_ENTITY_BLOCKLIST = Object.freeze([
            '조용히', '그림', '그려', '볼륨', '챕터', '뜻밖', '재능', '가방',
            '응답', '사용자', '대화', '장면', '서술', '묘사', '문장', '단어',
            '부장', '부원', '회장', '선배', '후배', '동기',
            'volume', 'chapter', 'scene', 'response'
        ]);
        const GENERIC_ROLE_ALIAS_BLOCKLIST = Object.freeze([
            '바텐더', '바리스타', '점원', '직원', '웨이터', '웨이트리스', '서빙',
            '매니저', '관리자', '선생님', '교사', '담임', '코치', '경호원', '의사',
            '간호사', '기사', '기자', '아나운서', '학생', '연습생', '감독', '원장',
            '사감', '사장', '교장', '교감', '교생', '팀장', '부장', '부원', '회장',
            '선배', '후배', '동기', '아저씨',
            'bartender', 'barista', 'waiter', 'waitress', 'server', 'clerk',
            'staff', 'staff member', 'manager', 'teacher', 'coach', 'guard',
            'doctor', 'nurse', 'driver', 'reporter', 'announcer', 'student',
            'trainee', 'director', 'boss'
        ]);
        const addBlockedEntityKey = (bucket, value) => {
            const normalized = String(value || '').trim().toLowerCase();
            if (!normalized) return;
            bucket.add(normalized);
            bucket.add(normalized.replace(/\s+/g, ''));
        };
        const isBuiltinWeakEntityName = (value) => {
            const raw = String(value || '').replace(/[()[\]{}"'`]/g, '').trim();
            if (!raw) return false;
            const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
            if (BUILTIN_WEAK_ENTITY_BLOCKLIST.includes(raw) || BUILTIN_WEAK_ENTITY_BLOCKLIST.includes(normalized)) return true;
            if (/^(?:볼륨|챕터|권|장)\s*\d*$/u.test(raw)) return true;
            if (/^(?:volume|chapter)\s*\d*$/i.test(normalized)) return true;
            return false;
        };
        const isGenericRoleAliasName = (value) => {
            const raw = String(value || '').replace(/[()[\]{}"'`]/g, '').trim();
            if (!raw) return false;
            const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
            if (GENERIC_ROLE_ALIAS_BLOCKLIST.includes(raw) || GENERIC_ROLE_ALIAS_BLOCKLIST.includes(normalized)) return true;
            if (/^(?:바텐더|바리스타|점원|직원|웨이터|웨이트리스|서빙|매니저|관리자|선생님|교사|담임|코치|경호원|의사|간호사|기사|기자|아나운서|학생|연습생|감독|원장|사감|사장|교장|교감|교생|팀장|부장|부원|회장|선배|후배|동기|아저씨)(?:님|씨)?$/u.test(raw)) return true;
            if (/^(?:bartender|barista|waiter|waitress|server|clerk|staff(?:\s+member)?|manager|teacher|coach|guard|doctor|nurse|driver|reporter|announcer|student|trainee|director|boss)$/i.test(normalized)) return true;
            return false;
        };
        const shouldKeepOldNameAsAliasForRename = (oldName = '', options = {}) => {
            if (options.keepOldNameAsAlias === true || options.aliasOldName === true) return true;
            if (options.keepOldNameAsAlias === false || options.aliasOldName === false) return false;
            const raw = String(oldName || '').trim();
            if (!raw) return false;
            if (isBuiltinWeakEntityName(raw) || isGenericRoleAliasName(raw)) return false;
            return true;
        };
        const getBlockedEntityNameSet = (lorebook = []) => {
            const blocked = new Set();
            for (const rawName of BUILTIN_WEAK_ENTITY_BLOCKLIST) {
                addBlockedEntityKey(blocked, rawName);
            }
            for (const rawName of readActiveEntityBlocklist()) {
                const canonical = resolveCanonicalName(rawName, lorebook) || normalizeCanonicalDisplayName(rawName) || normalizeBaseName(rawName) || rawName;
                [
                    rawName,
                    canonical,
                    normalizeCanonicalDisplayName(canonical),
                    normalizeBaseName(canonical)
                ].forEach(value => addBlockedEntityKey(blocked, value));
                buildAliasCandidates(rawName, true).forEach(value => addBlockedEntityKey(blocked, value));
                buildAliasCandidates(canonical, true).forEach(value => addBlockedEntityKey(blocked, value));
                buildHiddenNameKeys(rawName).forEach(value => addBlockedEntityKey(blocked, value));
                buildHiddenNameKeys(canonical).forEach(value => addBlockedEntityKey(blocked, value));
            }
            return blocked;
        };
        const isBlockedEntityName = (name, lorebook = []) => {
            const raw = String(name || '').trim();
            if (!raw) return false;
            if (isBuiltinWeakEntityName(raw)) return true;
            const blocked = getBlockedEntityNameSet(lorebook);
            if (blocked.size === 0) return false;
            const probe = new Set([
                raw,
                normalizeCanonicalDisplayName(raw),
                normalizeBaseName(raw),
                resolveCanonicalName(raw, lorebook) || ''
            ].filter(Boolean));
            buildAliasCandidates(raw, true).forEach(value => probe.add(value));
            buildHiddenNameKeys(raw).forEach(value => probe.add(value));
            for (const value of probe) {
                const normalized = String(value || '').trim().toLowerCase();
                if (!normalized) continue;
                if (blocked.has(normalized) || blocked.has(normalized.replace(/\s+/g, ''))) return true;
            }
            return false;
        };

        const extractEntityAliases = (entity) => {
            const aliases = new Set();
            buildAliasCandidates(entity?.name || '', true).forEach(alias => aliases.add(alias));
            getNameTokenSignatures(entity?.name || '').forEach(alias => aliases.add(alias));
            const metaAliases = Array.isArray(entity?.meta?.aliases) ? entity.meta.aliases : [];
            for (const alias of metaAliases) {
                buildAliasCandidates(alias, true).forEach(candidate => aliases.add(candidate));
            }
            const hiddenKeys = Array.isArray(entity?.meta?.hiddenNameKeys) ? entity.meta.hiddenNameKeys : [];
            for (const key of hiddenKeys) {
                const normalized = String(key || '').trim();
                if (normalized) aliases.add(normalized);
            }
            return [...aliases].filter(Boolean);
        };

        const normalizeEntityAbsorptionStatus = (status = '') => {
            const normalized = String(status || '').trim().toLowerCase();
            if (['pending', 'applied', 'cancelled'].includes(normalized)) return normalized;
            return '';
        };
        const getEntityAbsorptionMeta = (entity = null) => {
            const meta = entity?.meta?.absorption;
            return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
        };
        const isEntityAbsorptionPending = (entity = null) => normalizeEntityAbsorptionStatus(getEntityAbsorptionMeta(entity)?.status) === 'pending';
        const isEntityAbsorptionApplied = (entity = null) => normalizeEntityAbsorptionStatus(getEntityAbsorptionMeta(entity)?.status) === 'applied';
        const isEntityAbsorptionCancelled = (entity = null) => normalizeEntityAbsorptionStatus(getEntityAbsorptionMeta(entity)?.status) === 'cancelled';
        const isActiveEntityRecord = (entity = null) => !!entity && !isEntityAbsorptionApplied(entity);
        const isPromptVisibleEntityRecord = (entity = null) => isActiveEntityRecord(entity) && !isEntityAbsorptionPending(entity);

        const collectKnownEntities = (lorebook) => {
            // If entityCache is populated (after rebuildCache), use it directly to avoid
            // redundant lorebook parsing and duplicate entries
            if (entityCache.size > 0) {
                return Array.from(entityCache.values()).filter(isActiveEntityRecord);
            }
            // Fallback: parse lorebook entries when cache is not yet built
            const known = [];
            for (const entry of LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])) {
                if (entry.comment !== ENTITY_COMMENT) continue;
                try {
                    const parsed = JSON.parse(entry.content || '{}');
                    if (isActiveEntityRecord(parsed)) known.push(parsed);
                } catch (e) {
                    if (typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.debug) {
                        recordRuntimeDebug('warn', '[LIBRA] collectKnownEntities parse error:', e?.message);
                    }
                }
            }
            return known;
        };

        const getKnownEntitySignature = (knownEntities = [], lorebook = []) => {
            if (entityCache.size > 0) return `cache:${entityCacheRevision}:${entityCache.size}`;
            const loreEntries = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])
                .filter(entry => entry?.comment === ENTITY_COMMENT);
            const digest = stableHash(loreEntries.map(entry => `${entry.comment}:${entry.content || ''}`).join('|'));
            return `lore:${loreEntries.length}:${digest}`;
        };

        const addEntityIndexValue = (map, key, value) => {
            const normalized = String(key || '').trim();
            const display = normalizeCanonicalDisplayName(value || '');
            if (!normalized || !display) return;
            if (!map.has(normalized)) map.set(normalized, new Set());
            map.get(normalized).add(display);
        };

        const uniqueEntityIndexValue = (set) => {
            if (!set || set.size !== 1) return '';
            return [...set][0] || '';
        };

        const getEntityLookupIndex = (knownEntities = [], lorebook = []) => {
            const signature = getKnownEntitySignature(knownEntities, lorebook);
            if (entityLookupIndexCache?.signature === signature) return entityLookupIndexCache;
            const aliasToName = new Map();
            const identityTokenToName = new Map();
            const normalizedNameToName = new Map();
            const shortKoToNames = new Map();
            for (const entity of Array.isArray(knownEntities) ? knownEntities : []) {
                const display = normalizeCanonicalDisplayName(entity?.name || '');
                if (!display) continue;
                const baseDisplay = normalizeBaseName(display);
                addEntityIndexValue(normalizedNameToName, baseDisplay, display);
                for (const alias of extractEntityAliases(entity)) {
                    addEntityIndexValue(aliasToName, alias, display);
                    const identity = normalizeIdentityToken(alias);
                    if (identity) addEntityIndexValue(identityTokenToName, identity, display);
                    const shortKo = getKoreanShortName(alias);
                    if (shortKo) addEntityIndexValue(shortKoToNames, shortKo, display);
                }
                for (const signatureToken of getNameTokenSignatures(display)) {
                    for (const token of signatureToken.split(/\s+/).filter(Boolean)) {
                        addEntityIndexValue(aliasToName, token.toLowerCase(), display);
                        const identity = normalizeIdentityToken(token);
                        if (identity) addEntityIndexValue(identityTokenToName, identity, display);
                    }
                }
                const shortKo = getKoreanShortName(display);
                if (shortKo) addEntityIndexValue(shortKoToNames, shortKo, display);
            }
            entityLookupIndexCache = { signature, aliasToName, identityTokenToName, normalizedNameToName, shortKoToNames, size: knownEntities.length };
            return entityLookupIndexCache;
        };

        const resolveCanonicalName = (name, lorebook = []) => {
            const base = normalizeBaseName(name);
            if (!base) return '';
            if (isUserAlias(base)) return identityState.userCanonical || base;

            const knownEntities = collectKnownEntities(lorebook);
            const lookupIndex = getEntityLookupIndex(knownEntities, lorebook);
            const cacheKey = `${lookupIndex.signature}::${base}::${String(name || '').trim()}`;
            if (entityResolveCache.has(cacheKey)) return entityResolveCache.get(cacheKey);
            const finish = (value) => {
                const resolved = normalizeCanonicalDisplayName(value) || normalizeCanonicalDisplayName(name) || base;
                entityResolveCache.set(cacheKey, resolved);
                trimEntityResolveCache();
                return resolved;
            };

            const incomingAliases = new Set(buildAliasCandidates(base, true));
            buildHiddenNameKeys(name).forEach(key => incomingAliases.add(key));

            // 1. Indexed exact match in aliases / normalized names.
            for (const alias of incomingAliases) {
                const match = uniqueEntityIndexValue(lookupIndex.aliasToName.get(alias))
                    || uniqueEntityIndexValue(lookupIndex.normalizedNameToName.get(alias));
                if (match) return finish(match);
            }

            // 2. Fallback exact scan for ambiguous or uncached metadata shapes.
            const exactAliasMatch = knownEntities.find(entity => {
                const entityAliases = extractEntityAliases(entity);
                return entityAliases.some(alias => incomingAliases.has(alias));
            });
            if (exactAliasMatch?.name) return finish(exactAliasMatch.name);

            // 3. Phonetic/Fuzzy matching.
            const fuzzyMatch = knownEntities.find(entity => {
                const entityName = entity?.name || '';
                return isPhoneticallySimilar(base, entityName);
            });
            if (fuzzyMatch?.name) return finish(fuzzyMatch.name);

            const shortKo = getKoreanShortName(base) || (/^[가-힣]{2}$/.test(base) ? base : '');
            if (shortKo) {
                const indexedShortMatch = uniqueEntityIndexValue(lookupIndex.shortKoToNames.get(shortKo));
                if (indexedShortMatch && !getKoreanFamilyName(name)) return finish(indexedShortMatch);

                const incomingFamilyName = getKoreanFamilyName(name);
                const candidates = knownEntities
                    .map(entity => normalizeCanonicalDisplayName(entity?.name || ''))
                    .filter(Boolean)
                    .map(entityName => ({
                        displayName: entityName,
                        baseName: normalizeBaseName(entityName),
                        familyName: getKoreanFamilyName(entityName)
                    }))
                    .filter(entity => /^[가-힣]{3,4}$/.test(entity.baseName) && entity.baseName.endsWith(shortKo));

                const exactFamilyMatches = incomingFamilyName
                    ? candidates.filter(entity => entity.familyName === incomingFamilyName)
                    : [];
                const uniqueExactFamilyMatches = [...new Set(exactFamilyMatches.map(entity => entity.displayName))];
                if (uniqueExactFamilyMatches.length === 1) return finish(uniqueExactFamilyMatches[0]);

                if (!incomingFamilyName) {
                    const uniqueMatches = [...new Set(candidates.map(entity => entity.displayName))];
                    if (uniqueMatches.length === 1) return finish(uniqueMatches[0]);
                }
            }

            const jpEnBase = normalizeBaseName(base);
            const jpEnIsSingleToken = getEnglishOrJapaneseNameParts(jpEnBase).length === 0
                && !/\s/.test(jpEnBase)
                && /[A-Za-z\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff]/.test(jpEnBase);
            if (jpEnIsSingleToken) {
                const incomingIdentity = normalizeIdentityToken(jpEnBase);
                const indexedMatch = uniqueEntityIndexValue(lookupIndex.identityTokenToName.get(jpEnBase.toLowerCase()))
                    || (incomingIdentity ? uniqueEntityIndexValue(lookupIndex.identityTokenToName.get(incomingIdentity)) : '');
                if (indexedMatch) return finish(indexedMatch);

                const matches = knownEntities
                    .filter(entity => {
                        const signatures = getNameTokenSignatures(entity?.name || '');
                        if (signatures.length === 0) return false;
                        return signatures.some(signature => {
                            const tokens = signature.split(/\s+/).filter(Boolean).flatMap(token => {
                                const lowered = token.toLowerCase();
                                const identity = normalizeIdentityToken(token);
                                return identity && identity !== lowered ? [lowered, identity] : [lowered];
                            });
                            return tokens.length >= 2 && (tokens.includes(jpEnBase.toLowerCase()) || (incomingIdentity && tokens.includes(incomingIdentity)));
                        });
                    })
                    .map(entity => normalizeCanonicalDisplayName(entity?.name || ''))
                    .filter(Boolean);
                const uniqueMatches = [...new Set(matches)];
                if (uniqueMatches.length === 1) return finish(uniqueMatches[0]);
            }

            // 5. Cross-script matching: English multi-part name vs Korean entity.
            const englishParts = getEnglishOrJapaneseNameParts(base);
            if (englishParts.length >= 2 && !/[가-힣]/.test(base)) {
                const incomingIdentity = normalizeIdentityToken(base);
                const crossScriptMatches = knownEntities
                    .filter(entity => {
                        const entityBaseName = normalizeBaseName(entity?.name || '');
                        if (!/[가-힣]/.test(entityBaseName)) return false;
                        const romanized = romanizeHangulText(entityBaseName);
                        if (romanized && incomingIdentity && romanized === incomingIdentity) return true;
                        const koreanShort = getKoreanShortName(entityBaseName);
                        if (koreanShort) {
                            const romanizedShort = romanizeHangulText(koreanShort);
                            for (const part of englishParts) {
                                const partIdentity = normalizeIdentityToken(part);
                                if (partIdentity && romanizedShort && partIdentity === romanizedShort) return true;
                            }
                        }
                        return false;
                    })
                    .map(entity => normalizeCanonicalDisplayName(entity?.name || ''))
                    .filter(Boolean);
                const uniqueCrossScriptMatches = [...new Set(crossScriptMatches)];
                if (uniqueCrossScriptMatches.length === 1) return finish(uniqueCrossScriptMatches[0]);
            }

            return finish(name);
        };

        const normalizeName = (name, lorebook = []) => {
            return resolveCanonicalName(name, lorebook);
        };

        const makeRelationId = (nameA, nameB, lorebook = []) => {
            const sorted = [normalizeName(nameA, lorebook), normalizeName(nameB, lorebook)].sort();
            return `${sorted[0]}_${sorted[1]}`;
        };

        const addSourceMessageId = (meta, m_id) => {
            if (!meta || !m_id) return;
            const list = Array.isArray(meta.m_ids) ? meta.m_ids.filter(Boolean) : [];
            if (!list.includes(m_id)) list.push(m_id);
            meta.m_ids = dedupeTextArray(list.map(id => String(id || '').trim()).filter(Boolean)).slice(-16);
            meta.m_id = String(m_id || '').trim();
        };
        const isManualProtected = (meta, updates) => {
            if (!meta?.manualLocked) return false;
            const source = String(updates?.source || '').trim().toLowerCase();
            if (source === 'gui' || source === 'manual') return false;
            if (updates?.allowManualOverride === true) return false;
            return true;
        };

        const deepClone = safeClone;
        const STATUS_NOTE_SCENE_DUMP_PATTERN = /(?:^|\s)(?:#|##|\[응답\]|\[assistant\]|\[response\]|scene result|user turn:|current pressure:|pending response to:|chatindex\s*:|volume\s+\d+|chapter\s+\d+|볼륨\s*\d+|챕터\s*\d+|\d+\s*권|\d+\s*장\b|⏱️?\s*\[\d{4}-\d{2}-\d{2})/i;
        const STATUS_NOTE_SIGNAL_PATTERN = /(tense|anxious|angry|afraid|guilty|relieved|hurt|injured|sick|exhausted|awkward|conflicted|jealous|긴장|불안|죄책감|질투|상처|회피)/i;
        const normalizeEntityStatusNoteText = (value) => String(value || '')
            .replace(/\r/g, ' ')
            .replace(/[#*_`>~]/g, ' ')
            .replace(/\[(?:user|assistant|response|conversation|응답|사용자)\]/ig, ' ')
            .replace(/◇/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const sanitizeEntityStatusField = (value, max = 64) => {
            const text = normalizeEntityStatusNoteText(value);
            if (!text) return '';
            if (STATUS_NOTE_SCENE_DUMP_PATTERN.test(text)) return '';
            if (text.length > max) return '';
            return text;
        };
        const buildEntityStatusNoteCandidates = (value) => {
            const cleaned = normalizeEntityStatusNoteText(value);
            if (!cleaned) return [];
            const separated = cleaned
                .replace(/\s*\|\s*/g, ' || ')
                .replace(/([.!?。！？])\s+/g, '$1 || ')
                .replace(/\s+-\s+/g, ' || ');
            return dedupeTextArray(
                separated
                    .split('||')
                    .map(part => part.replace(/^(?:user|assistant|response|conversation|응답|사용자)\s*:?/i, '').trim())
                    .filter(Boolean)
            );
        };
        const scoreEntityStatusNoteCandidate = (candidate = '', entityName = '', status = {}) => {
            const text = String(candidate || '').trim();
            if (!text) return -Infinity;
            let score = 0;
            const lowered = text.toLowerCase();
            const displayName = String(entityName || '').trim().toLowerCase();
            const baseName = String(normalizeBaseName(entityName || '') || '').trim().toLowerCase();
            if (displayName && lowered.includes(displayName)) score += 3;
            if (baseName && lowered.includes(baseName)) score += 2;
            if (STATUS_NOTE_SIGNAL_PATTERN.test(text)) score += 2;
            for (const key of ['currentMood', 'currentLocation', 'healthStatus']) {
                const signal = String(status?.[key] || '').trim().toLowerCase();
                if (signal && lowered.includes(signal)) score += 1;
            }
            if (STATUS_NOTE_SCENE_DUMP_PATTERN.test(text)) score -= 4;
            if (text.length > 140) score -= 2;
            if ((text.match(/[,;:]/g) || []).length >= 4) score -= 1;
            return score;
        };
        const compactEntityStatusNote = (value, max = 280, options = {}) => {
            const status = (options && typeof options === 'object' && options.status && typeof options.status === 'object')
                ? options.status
                : {};
            const entityName = String(options?.entityName || '').trim();
            const cleaned = normalizeEntityStatusNoteText(value);
            if (!cleaned) return '';
            const candidates = buildEntityStatusNoteCandidates(cleaned).filter(candidate => candidate.length >= 6);
            const ranked = candidates
                .map(candidate => ({ candidate, score: scoreEntityStatusNoteCandidate(candidate, entityName, status) }))
                .sort((a, b) => (b.score - a.score) || (a.candidate.length - b.candidate.length));
            const looksLikeSceneDump = STATUS_NOTE_SCENE_DUMP_PATTERN.test(cleaned) || cleaned.length > Math.max(220, max * 1.5);
            const best = ranked[0] || null;
            let chosen = best?.candidate || cleaned;
            if (looksLikeSceneDump && (!best || best.score < 2)) chosen = '';
            if (!chosen) return '';
            if (chosen.length <= max) return chosen;
            return `${chosen.slice(0, Math.max(48, max - 1)).trim()}…`;
        };
        const mergeLimitedStatusNotes = (current = '', incoming = '', max = 320, options = {}) => {
            const merged = dedupeTextArray(
                [current, incoming]
                    .map(value => compactEntityStatusNote(value, max, options))
                    .filter(Boolean)
            ).join(' | ');
            return compactEntityStatusNote(merged, max, options);
        };

        const trimRollbackSnapshots = (snapshots) => {
            if (!snapshots || typeof snapshots !== 'object') return {};
            const keys = Object.keys(snapshots);
            if (keys.length <= MAX_ROLLBACK_SNAPSHOTS) return snapshots;
            const sorted = keys.sort((a, b) => Number(snapshots[b]?.turn || 0) - Number(snapshots[a]?.turn || 0));
            const keep = new Set(sorted.slice(0, MAX_ROLLBACK_SNAPSHOTS));
            const trimmed = {};
            for (const key of keep) trimmed[key] = snapshots[key];
            return trimmed;
        };

        const captureRollbackSnapshot = (target, m_id, stateFactory) => {
            if (!target?.meta || !m_id || typeof stateFactory !== 'function') return;
            const snapshots = (target.meta.rollbackSnapshots && typeof target.meta.rollbackSnapshots === 'object')
                ? target.meta.rollbackSnapshots
                : {};
            if (!snapshots[m_id]) {
                snapshots[m_id] = {
                    turn: MemoryState.currentTurn,
                    state: deepClone(stateFactory(target))
                };
            }
            target.meta.rollbackSnapshots = trimRollbackSnapshots(snapshots);
        };

        const discardRollbackSnapshot = (target, m_id) => {
            const snapshots = target?.meta?.rollbackSnapshots;
            if (!snapshots || typeof snapshots !== 'object' || !m_id) return false;
            if (!Object.prototype.hasOwnProperty.call(snapshots, m_id)) return false;
            delete snapshots[m_id];
            if (Object.keys(snapshots).length === 0) delete target.meta.rollbackSnapshots;
            else target.meta.rollbackSnapshots = snapshots;
            return true;
        };

        const restoreRollbackSnapshot = (target, m_id) => {
            const snapshots = target?.meta?.rollbackSnapshots;
            if (!snapshots || typeof snapshots !== 'object' || !m_id) return false;
            const snapshot = snapshots[m_id];
            if (!snapshot?.state || typeof snapshot.state !== 'object') {
                discardRollbackSnapshot(target, m_id);
                return false;
            }

            const state = deepClone(snapshot.state);
            if (Object.prototype.hasOwnProperty.call(state, 'sex')) target.sex = normalizeBiologicalSex(state.sex);
            if (Object.prototype.hasOwnProperty.call(state, 'biologicalSex')) target.sex = normalizeBiologicalSex(state.biologicalSex);
            if (Object.prototype.hasOwnProperty.call(state, 'appearance')) target.appearance = state.appearance || { features: [], distinctiveMarks: [], clothing: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'personality')) target.personality = state.personality || { traits: [], values: [], fears: [], likes: [], dislikes: [], sexualOrientation: '', sexualPreferences: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'speechStyle')) target.speechStyle = state.speechStyle || { defaultTone: '', honorificStyle: '', toSuperiors: '', toSubordinates: '', toPeers: '', toYounger: '', notes: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'background')) target.background = state.background || { origin: '', occupation: '', history: [], secrets: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'status')) target.status = state.status || { currentLocation: '', currentMood: '', healthStatus: '', notes: '', lastUpdated: 0 };
            if (Object.prototype.hasOwnProperty.call(state, 'identity')) target.identity = state.identity || {};
            if (Object.prototype.hasOwnProperty.call(state, 'profile')) target.profile = state.profile || {};
            if (Object.prototype.hasOwnProperty.call(state, 'currentState')) target.currentState = state.currentState || {};
            if (Object.prototype.hasOwnProperty.call(state, 'continuity')) target.continuity = state.continuity || {};
            if (Object.prototype.hasOwnProperty.call(state, 'povKnowledge')) target.povKnowledge = state.povKnowledge || {};
            if (Object.prototype.hasOwnProperty.call(state, 'episodeLedger')) target.episodeLedger = state.episodeLedger || [];
            if (Object.prototype.hasOwnProperty.call(state, 'stateTimeline')) target.stateTimeline = state.stateTimeline || [];
            if (Object.prototype.hasOwnProperty.call(state, 'evidence')) target.evidence = state.evidence || [];
            if (Object.prototype.hasOwnProperty.call(state, 'quality')) target.quality = state.quality || {};
            if (Object.prototype.hasOwnProperty.call(state, 'relationType')) target.relationType = state.relationType || target.relationType;
            if (Object.prototype.hasOwnProperty.call(state, 'details')) target.details = state.details || { howMet: '', duration: '', closeness: null, trust: null, events: [] };
            if (Object.prototype.hasOwnProperty.call(state, 'sentiments')) target.sentiments = state.sentiments || { fromAtoB: '', fromBtoA: '', currentTension: 0, lastInteraction: 0 };
            if (Object.prototype.hasOwnProperty.call(state, 'currentStatus')) target.currentStatus = state.currentStatus || {};
            if (Object.prototype.hasOwnProperty.call(state, 'metrics')) target.metrics = state.metrics || {};
            if (Object.prototype.hasOwnProperty.call(state, 'dynamics')) target.dynamics = state.dynamics || {};
            if (Object.prototype.hasOwnProperty.call(state, 'sharedContext')) target.sharedContext = state.sharedContext || {};
            if (Object.prototype.hasOwnProperty.call(state, 'eventLedger')) target.eventLedger = state.eventLedger || [];

            discardRollbackSnapshot(target, m_id);
            return true;
        };

        const hasRelationScore = (value) => Number.isFinite(Number(value));

        const normalizeNullableRelationScore = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return null;
            return Math.max(0, Math.min(1, numeric));
        };

        const mergeNullableRelationScore = (left, right) => {
            const leftScore = normalizeNullableRelationScore(left);
            const rightScore = normalizeNullableRelationScore(right);
            if (leftScore != null && rightScore != null) return Math.max(leftScore, rightScore);
            if (leftScore != null) return leftScore;
            if (rightScore != null) return rightScore;
            return null;
        };

        const applyRelationshipDelta = (current, delta, options = {}) => {
            const safeCurrent = hasRelationScore(current) ? Number(current) : Number(options?.initialBaseline ?? 0.1);
            const safeDelta = Number.isFinite(Number(delta)) ? Number(delta) : 0;
            return Math.max(0, Math.min(1, safeCurrent + (safeDelta * RELATION_DELTA_SCALE)));
        };

        const getRelationFloors = (relationType) => {
            const text = String(relationType || '').toLowerCase();
            const rules = [
                { keywords: ['연인', '애인', 'lover', 'romantic partner', 'spouse', 'wife', 'husband'], closeness: 0.75, trust: 0.75 },
                { keywords: ['썸', '호감', 'crush', 'flirt'], closeness: 0.55, trust: 0.45 },
                { keywords: ['친구', '동료', 'friend', 'teammate', 'partner'], closeness: 0.45, trust: 0.45 },
                { keywords: ['가족', '형제', '자매', '남매', '모녀', '부녀', 'family', 'sibling', 'parent'], closeness: 0.65, trust: 0.6 },
                { keywords: ['스승', '제자', 'mentor', 'student', 'teacher'], closeness: 0.35, trust: 0.55 },
                { keywords: ['라이벌', '경쟁', 'rival'], closeness: 0.3, trust: 0.2 },
                { keywords: ['적', '원수', 'enemy', 'hostile'], closeness: 0.05, trust: 0.05 }
            ];
            for (const rule of rules) {
                if (rule.keywords.some(keyword => text.includes(keyword))) {
                    return { closeness: rule.closeness, trust: rule.trust };
                }
            }
            return null;
        };

        const harmonizeRelationMetrics = (relation) => {
            if (!relation?.details) return relation;
            const floors = getRelationFloors(relation.relationType);
            if (!floors) return relation;
            relation.details.closeness = Math.max(normalizeNullableRelationScore(relation.details.closeness) ?? 0, floors.closeness);
            relation.details.trust = Math.max(normalizeNullableRelationScore(relation.details.trust) ?? 0, floors.trust);
            return relation;
        };

        const normalizeFiniteNumber = (value, fallback = 0) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : fallback;
        };

        const isFunctionLikeEntityText = (value = '') => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return false;
            const head = text.slice(0, 160);
            return /^(?:async\s+)?function/.test(head)
                || /^\(?\s*[\w$\s,]*\)?\s*=>/.test(head)
                || /\[native code\]/.test(head)
                || /function\s*[\w$]*\s*\([^)]*\)\s*\{/.test(head);
        };

        const clampEntityText = (value, max = 220) => {
            if (value == null || typeof value === 'function' || typeof value === 'symbol') return '';
            if (typeof value === 'object') {
                const preferred = value.summary || value.label || value.text || value.value || value.note || value.description || '';
                if (preferred) return clampEntityText(preferred, max);
                try { return clampEntityText(JSON.stringify(value), max); } catch { return ''; }
            }
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text || isFunctionLikeEntityText(text)) return '';
            return text.length > max ? `${text.slice(0, Math.max(24, max - 1)).trim()}…` : text;
        };

        const expandEntityListItem = (item, depth = 0) => {
            if (depth > 2 || item == null || item === '') return [];
            if (typeof item === 'function' || typeof item === 'symbol') return [];
            if (Array.isArray(item)) return item.flatMap(child => expandEntityListItem(child, depth + 1));
            if (typeof item === 'string') {
                const text = item.replace(/\s+/g, ' ').trim();
                if (!text || isFunctionLikeEntityText(text)) return [];
                const first = text[0];
                const last = text[text.length - 1];
                if ((first === '[' && last === ']') || (first === '{' && last === '}')) {
                    try {
                        const parsed = JSON.parse(text);
                        if (Array.isArray(parsed)) return parsed.flatMap(child => expandEntityListItem(child, depth + 1));
                        if (parsed && typeof parsed === 'object') {
                            const preferred = parsed.summary || parsed.label || parsed.text || parsed.value || parsed.note || parsed.description || '';
                            if (preferred) return expandEntityListItem(preferred, depth + 1);
                        }
                    } catch {}
                }
                return [text];
            }
            return [item];
        };

        const normalizeEntity01 = (value, fallback = 0) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, Number(fallback || 0)));
            return Math.max(0, Math.min(1, numeric));
        };

        const normalizeEntityList = (items, limit = 12, itemMax = 180) => {
            const source = Array.isArray(items) ? items : (items == null || items === '' ? [] : [items]);
            return dedupeTextArray(
                source
                    .flatMap(item => expandEntityListItem(item))
                    .map(item => clampEntityText(item, itemMax))
                    .filter(Boolean)
            ).slice(-Math.max(1, limit));
        };

        const splitEntityTraitFragments = (value = '', itemMax = 180) => {
            const text = clampEntityText(value, itemMax);
            if (!text) return [];
            const parts = text
                .replace(/[.!?。！？]+/g, '|')
                .split(/\s*[,，、;；|]\s*/u)
                .map(part => clampEntityText(part, itemMax))
                .filter(part => part.length >= 2);
            return parts.length > 1 ? parts : [text];
        };

        const ENTITY_APPEARANCE_FRAGMENT_RE = /(hair|eye|skin|face|body|height|weight|clothing|outfit|wearing|glasses|breast|chest|scar|tattoo|머리|머리카락|눈동자|눈매|눈빛|눈이|안경|피부|체형|키|신장|몸무게|복장|옷|착용|블라우스|셔츠|스커트|스타킹|가디건|가터|맨발|유방|가슴|쇄골|어깨|허리|체구|미모|외모|얼굴|표정|귀끝|손자국|상처|흉터|멍|충혈|cm|kg|[A-Z]컵)/i;
        const ENTITY_CLOTHING_FRAGMENT_RE = /(clothing|outfit|wearing|복장|옷|착용|입고|걸친|블라우스|셔츠|스커트|스타킹|가디건|가터|맨발)/i;
        const ENTITY_MARK_FRAGMENT_RE = /(scar|tattoo|distinctive|상처|흉터|문신|점|멍|손자국|자국|충혈|붉은)/i;
        const ENTITY_STABLE_TRAIT_RE = /(personality|trait|attitude|value|temperament|성격|성향|태도|가치관|경향|패턴|기질|습관|면모|기본|유지|책임감|체념|단호|차분|친절|무심|장난|뻔뻔|거침|교활|회의감|희망|결의|집착|사려|인내|도덕적|현실적|관찰자적)/i;
        const ENTITY_TRANSIENT_TRAIT_RE = /(이번\s*턴|이번\s*장면|현재|방금|처음으로|3년\s*만에|오르가즘|성관계|키스|고백|질문|대답|인터뷰|제보|커튼|서류|치킨|담배|전자레인지|배를\s*만지|눈물|웃음|발언|결정|식사|소파|식탁|거실)/i;
        const ENTITY_TRAIT_STOPWORDS = new Set([
            '이번', '턴', '현재', '장면', '처음', '으로', '에서', '에게', '하고', '하며', '한다',
            '있는', '있음', '유지', '모습', '상태', 'after', 'current', 'turn', 'scene'
        ]);

        const collectEntityTraitFragments = (items, itemMax = 180) => {
            const source = Array.isArray(items) ? items : (items == null || items === '' ? [] : [items]);
            return source
                .flatMap(item => expandEntityListItem(item))
                .flatMap(item => splitEntityTraitFragments(item, itemMax))
                .map(item => clampEntityText(item, itemMax))
                .filter(Boolean);
        };

        const getEntityTraitCompareText = (value = '') => String(value || '')
            .toLowerCase()
            .replace(/[“”"'‘’`「」『』()[\]{}]/g, ' ')
            .replace(/이번\s*턴(?:에서|의)?|이번\s*장면(?:에서|의)?|현재|방금|처음으로|3년\s*만에/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const getEntityTraitShingles = (value = '') => {
            const compact = getEntityTraitCompareText(value).replace(/[^a-z0-9가-힣]+/gi, '');
            if (compact.length <= 3) return new Set(compact ? [compact] : []);
            const out = new Set();
            for (let i = 0; i <= compact.length - 3; i += 1) out.add(compact.slice(i, i + 3));
            return out;
        };

        const getEntityTraitTokens = (value = '') => String(value || '')
            .toLowerCase()
            .match(/[a-z0-9가-힣]{2,}/gi)
            ?.map(token => token
                .replace(/(으로|에게|에서|부터|까지|처럼|보다|이고|이며|적인|적으로|함|함을|함이|하다|하고|하는|했다|한다)$/g, '')
                .trim())
            .filter(token => token && token.length >= 2 && !ENTITY_TRAIT_STOPWORDS.has(token)) || [];

        const areEntityTraitFragmentsRedundant = (left = '', right = '') => {
            const a = getEntityTraitCompareText(left);
            const b = getEntityTraitCompareText(right);
            if (!a || !b) return false;
            if (a === b) return true;
            const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
            if (shorter.length >= 8 && longer.includes(shorter)) return true;

            const aTokens = new Set(getEntityTraitTokens(a));
            const bTokens = new Set(getEntityTraitTokens(b));
            if (aTokens.size >= 2 && bTokens.size >= 2) {
                let shared = 0;
                for (const token of aTokens) if (bTokens.has(token)) shared += 1;
                if (shared / Math.min(aTokens.size, bTokens.size) >= 0.8) return true;
            }

            const aShingles = getEntityTraitShingles(a);
            const bShingles = getEntityTraitShingles(b);
            if (aShingles.size >= 4 && bShingles.size >= 4) {
                let shared = 0;
                for (const gram of aShingles) if (bShingles.has(gram)) shared += 1;
                if (shared / Math.min(aShingles.size, bShingles.size) >= 0.72) return true;
            }
            return false;
        };

        const shouldPreferEntityTraitFragment = (candidate = '', existing = '') => {
            const candidateTransient = ENTITY_TRANSIENT_TRAIT_RE.test(candidate);
            const existingTransient = ENTITY_TRANSIENT_TRAIT_RE.test(existing);
            if (existingTransient && !candidateTransient) return true;
            if (candidateTransient && !existingTransient) return false;
            return String(candidate || '').length < String(existing || '').length;
        };

        const normalizeEntityTraitCandidates = (items, limit = 18, itemMax = 180) => {
            const candidates = dedupeTextArray(
                (Array.isArray(items) ? items : [])
                    .map(item => clampEntityText(item, itemMax))
                    .filter(Boolean)
            );
            const out = [];
            for (const candidate of candidates) {
                const existingIdx = out.findIndex(item => areEntityTraitFragmentsRedundant(item, candidate));
                if (existingIdx >= 0) {
                    if (shouldPreferEntityTraitFragment(candidate, out[existingIdx])) out[existingIdx] = candidate;
                    continue;
                }
                out.push(candidate);
            }
            return out.slice(-Math.max(1, limit));
        };

        const classifyEntityVisualTraitBucket = (value = '') => {
            const text = String(value || '').trim();
            if (!text || !ENTITY_APPEARANCE_FRAGMENT_RE.test(text)) return '';
            if (ENTITY_STABLE_TRAIT_RE.test(text) && !/(표정|눈매|눈동자|피부|체형|키|신장|몸무게|복장|옷|셔츠|가슴|체구|미모|얼굴|귀끝|손자국|충혈|상처|흉터|멍|cm|kg|[A-Z]컵)/i.test(text)) return '';
            if (ENTITY_CLOTHING_FRAGMENT_RE.test(text)) return 'clothing';
            if (ENTITY_MARK_FRAGMENT_RE.test(text)) return 'distinctiveMarks';
            return 'features';
        };

        const shouldDropEntityTraitFragment = (value = '') => {
            const text = String(value || '').trim();
            if (!text) return true;
            if (classifyEntityVisualTraitBucket(text)) return true;
            return false;
        };

        const isEntityTurnStateTraitFragment = (value = '') => {
            const text = String(value || '').trim();
            if (!text || classifyEntityVisualTraitBucket(text)) return false;
            return ENTITY_TRANSIENT_TRAIT_RE.test(text) && !ENTITY_STABLE_TRAIT_RE.test(text);
        };

        const partitionEntityTraitFragments = (items, limit = 18, itemMax = 180) => {
            const routed = { traits: [], features: [], distinctiveMarks: [], clothing: [], stateFragments: [] };
            for (const fragment of collectEntityTraitFragments(items, itemMax)) {
                const bucket = classifyEntityVisualTraitBucket(fragment);
                if (bucket) {
                    routed[bucket].push(fragment);
                    continue;
                }
                if (isEntityTurnStateTraitFragment(fragment)) {
                    routed.stateFragments.push(fragment);
                    continue;
                }
                if (shouldDropEntityTraitFragment(fragment)) continue;
                routed.traits.push(fragment);
            }
            routed.traits = normalizeEntityTraitCandidates(routed.traits, limit, itemMax);
            routed.features = normalizeEntityList(routed.features, 12, 160);
            routed.distinctiveMarks = normalizeEntityList(routed.distinctiveMarks, 8, 160);
            routed.clothing = normalizeEntityList(routed.clothing, 8, 160);
            routed.stateFragments = normalizeEntityList(routed.stateFragments, 12, 220);
            return routed;
        };

        const normalizeEntityTraitList = (items, limit = 18, itemMax = 180) => {
            return partitionEntityTraitFragments(items, limit, itemMax).traits;
        };

        const rebalanceEntityVisualPersonalityFields = (entity) => {
            if (!entity || typeof entity !== 'object') return entity;
            entity.appearance = entity.appearance && typeof entity.appearance === 'object' ? entity.appearance : {};
            entity.personality = entity.personality && typeof entity.personality === 'object' ? entity.personality : {};
            entity.profile = entity.profile && typeof entity.profile === 'object' ? entity.profile : {};
            entity.profile.appearance = entity.profile.appearance && typeof entity.profile.appearance === 'object' ? entity.profile.appearance : {};
            entity.profile.personality = entity.profile.personality && typeof entity.profile.personality === 'object' ? entity.profile.personality : {};

            const legacyRoute = partitionEntityTraitFragments(entity.personality.traits || [], 18, 180);
            const profileRoute = partitionEntityTraitFragments(entity.profile.personality.traits || [], 18, 180);

            entity.appearance.features = normalizeEntityList([
                ...(Array.isArray(entity.appearance.features) ? entity.appearance.features : []),
                ...legacyRoute.features
            ], 18, 160);
            entity.appearance.distinctiveMarks = normalizeEntityList([
                ...(Array.isArray(entity.appearance.distinctiveMarks) ? entity.appearance.distinctiveMarks : []),
                ...legacyRoute.distinctiveMarks
            ], 12, 160);
            entity.appearance.clothing = normalizeEntityList([
                ...(Array.isArray(entity.appearance.clothing) ? entity.appearance.clothing : []),
                ...legacyRoute.clothing
            ], 12, 160);
            entity.personality.traits = legacyRoute.traits;

            entity.profile.appearance.features = normalizeEntityList([
                ...(Array.isArray(entity.profile.appearance.features) ? entity.profile.appearance.features : []),
                ...profileRoute.features,
                ...legacyRoute.features
            ], 18, 160);
            entity.profile.appearance.distinctiveMarks = normalizeEntityList([
                ...(Array.isArray(entity.profile.appearance.distinctiveMarks) ? entity.profile.appearance.distinctiveMarks : []),
                ...profileRoute.distinctiveMarks,
                ...legacyRoute.distinctiveMarks
            ], 12, 160);
            entity.profile.appearance.clothing = normalizeEntityList([
                ...(Array.isArray(entity.profile.appearance.clothing) ? entity.profile.appearance.clothing : []),
                ...profileRoute.clothing,
                ...legacyRoute.clothing
            ], 12, 160);
            entity.profile.personality.traits = normalizeEntityTraitCandidates([
                ...legacyRoute.traits,
                ...profileRoute.traits
            ], 18, 180);
            const stateFragments = normalizeEntityList([
                ...legacyRoute.stateFragments,
                ...profileRoute.stateFragments
            ], 12, 220);
            if (stateFragments.length > 0) {
                const turn = normalizeFiniteNumber(
                    entity.currentState?.lastObservedTurn
                    ?? entity.status?.lastUpdated
                    ?? entity.quality?.lastUpdatedTurn
                    ?? MemoryState?.currentTurn,
                    0
                );
                entity.stateTimeline = normalizeEntityStateTimeline([
                    ...(Array.isArray(entity.stateTimeline) ? entity.stateTimeline : []),
                    ...stateFragments.map(fragment => ({
                        turn,
                        summary: fragment,
                        sourceKind: 'personality_trait_reroute',
                        stability: 'turn_state'
                    }))
                ], 24);
                entity.currentState = entity.currentState && typeof entity.currentState === 'object' ? entity.currentState : {};
                if (!entity.currentState.summary && stateFragments[0]) entity.currentState.summary = stateFragments[0];
                entity.currentState.lastObservedTurn = Math.max(
                    normalizeFiniteNumber(entity.currentState.lastObservedTurn, 0),
                    turn
                );
            }
            return entity;
        };

        const getRelationEvidenceCount = (relation = {}) => {
            const details = relation?.details && typeof relation.details === 'object' ? relation.details : {};
            return [
                ...(Array.isArray(details.events) ? details.events : []),
                ...(Array.isArray(relation?.eventLedger) ? relation.eventLedger : []),
                ...(Array.isArray(relation?.evidence) ? relation.evidence : [])
            ].filter(Boolean).length;
        };

        const buildRelationshipAssessment = (relation = {}) => {
            const source = relation && typeof relation === 'object' ? relation : {};
            const existing = source.relationshipAssessment && typeof source.relationshipAssessment === 'object'
                ? source.relationshipAssessment
                : {};
            const evidenceCount = Math.max(
                Number(existing.evidenceCount || 0),
                getRelationEvidenceCount(source)
            );
            const closeness = normalizeNullableRelationScore(source?.details?.closeness ?? source?.metrics?.closeness);
            const trust = normalizeNullableRelationScore(source?.details?.trust ?? source?.metrics?.trust);
            const hasScores = closeness != null || trust != null;
            const hasExplicitStatus = !!String(source?.currentStatus?.summary || source?.relationType || '').trim()
                && !/^(?:관계|아는 사이|첫 대면|unknown|relationship)$/i.test(String(source?.relationType || '').trim());
            const inferred = existing.inferred === false ? false : !hasScores;
            let stage = String(existing.stage || '').trim();
            let label = String(existing.label || '').trim();
            let note = String(existing.note || '').trim();
            let definitionConfidence = normalizeNullableRelationScore(existing.definitionConfidence);

            if (!stage) {
                if (!hasScores && evidenceCount <= 1) stage = 'first_contact';
                else if (evidenceCount >= 3 || hasExplicitStatus) stage = 'defined';
                else stage = 'observing';
            }
            if (!label) {
                if (stage === 'first_contact') label = '첫 대면 · 정의 보류';
                else if (stage === 'defined') label = hasScores ? '관계 정의됨' : '관계 정의 중';
                else label = '관찰 중';
            }
            if (!note && stage === 'first_contact') note = '관계를 정의하기에는 근거가 부족함';
            if (definitionConfidence == null) {
                definitionConfidence = stage === 'first_contact'
                    ? (evidenceCount > 0 ? 0.18 : 0.08)
                    : Math.min(1, 0.25 + evidenceCount * 0.15 + (hasScores ? 0.2 : 0));
            }

            return {
                stage,
                definitionConfidence,
                evidenceCount,
                label,
                note,
                inferred
            };
        };
        const ENTITY_ROLLBACK_REPAIR_SOURCE_IDS = new Set([
            'rollback-delete-augment',
            'rollback-delete-augment-existing-data-verify',
            'rollback-repair'
        ]);
        const isRollbackRepairEntitySource = (value = '') => {
            const text = String(value || '').trim().toLowerCase();
            return text && ENTITY_ROLLBACK_REPAIR_SOURCE_IDS.has(text);
        };
        const normalizeEntitySourceMix = (items, limit = 12, itemMax = 180) =>
            normalizeEntityList(items, limit, itemMax).filter(item => !isRollbackRepairEntitySource(item));

        const normalizeEntityMoodAtoms = (items = [], limit = 8, itemMax = 48) => {
            const source = Array.isArray(items) ? items : (items == null || items === '' ? [] : [items]);
            const atoms = [];
            for (const item of source) {
                const text = String(item || '')
                    .replace(/…+$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (!text) continue;
                text
                    .split(/\s*[,，、;|/]\s*/u)
                    .map(part => clampEntityText(part, itemMax))
                    .filter(part => part && part !== '…')
                    .forEach(part => atoms.push(part));
            }
            const unique = dedupeTextArray(atoms)
                .filter(part => String(part || '').trim().length >= 2);
            const pruned = unique.filter((part, index) => !unique.some((other, otherIndex) =>
                otherIndex !== index
                && part.length >= 5
                && other.length >= part.length + 4
                && other.includes(part)
            ));
            return pruned.slice(-Math.max(1, Number(limit || 8) || 8));
        };
        const normalizeEntityMoodText = (value = '', limit = 8) =>
            normalizeEntityMoodAtoms(value, limit, 48).join(', ');

        const asEntityArray = (items) => Array.isArray(items) ? items : (items == null || items === '' ? [] : [items]);
        const collectEntityItems = (...values) => values.flatMap(value => asEntityArray(value));

        const isSparseEntityText = (value) => {
            const text = String(value || '').trim();
            if (!text) return true;
            const lowered = text.toLowerCase();
            return lowered === 'unknown'
                || lowered === 'none'
                || lowered === 'n/a'
                || lowered === 'null'
                || lowered === '아는 사이'
                || lowered === '동료'
                || text.length < 4;
        };

        const normalizeEntityEvidenceItems = (items, limit = 16) => {
            const source = Array.isArray(items) ? items : (items ? [items] : []);
            const out = [];
            const seen = new Set();
            for (const item of source) {
                let entry = {};
                if (typeof item === 'string') {
                    entry = { snippet: item };
                } else if (item && typeof item === 'object') {
                    entry = {
                        sourceKind: clampEntityText(item.sourceKind || item.source_kind || item.kind || item.source || '', 64),
                        turn: normalizeFiniteNumber(item.turn ?? item.sourceTurn ?? item.turnNumber, 0),
                        messageId: clampEntityText(item.messageId || item.m_id || item.sourceMessageId || '', 96),
                        snippet: clampEntityText(item.snippet || item.quote || item.text || item.summary || item.evidence || '', 260),
                        confidence: normalizeEntity01(item.confidence, 0)
                    };
                }
                if (isRollbackRepairEntitySource(entry.sourceKind)) continue;
                if (!entry.snippet && !entry.sourceKind && !entry.turn && !entry.messageId) continue;
                const key = `${entry.sourceKind || ''}|${entry.turn || 0}|${entry.messageId || ''}|${entry.snippet || ''}`.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(entry);
            }
            return out.slice(-Math.max(1, limit));
        };

        const normalizeEntityThreadItems = (items, limit = 12) => {
            const source = Array.isArray(items) ? items : (items ? [items] : []);
            return source.map(item => {
                if (typeof item === 'string') {
                    const label = clampEntityText(item, 180);
                    if (!label) return null;
                    return {
                        id: `thread_${TokenizerEngine.simpleHash(label)}`,
                        label,
                        status: 'active',
                        pressure: 0
                    };
                }
                if (!item || typeof item !== 'object') return null;
                const label = clampEntityText(item.label || item.summary || item.text || item.name || '', 180);
                if (!label) return null;
                return {
                    id: clampEntityText(item.id || `thread_${TokenizerEngine.simpleHash(label)}`, 96),
                    label,
                    status: clampEntityText(item.status || 'active', 48) || 'active',
                    pressure: normalizeEntity01(item.pressure, 0),
                    evidenceTurns: normalizeEntityList(item.evidenceTurns || item.turns || [], 12, 24)
                };
            }).filter(Boolean).slice(-Math.max(1, limit));
        };

        const normalizeEntityEpisodeLedger = (items, limit = 16) => {
            const source = Array.isArray(items) ? items : (items ? [items] : []);
            const out = [];
            const seen = new Set();
            for (const item of source) {
                if (!item) continue;
                const summary = typeof item === 'string'
                    ? clampEntityText(item, 260)
                    : clampEntityText(item.summary || item.event || item.text || item.brief || '', 260);
                if (!summary) continue;
                const turn = typeof item === 'object' ? normalizeFiniteNumber(item.turn ?? item.sourceTurn ?? item.turnNumber, 0) : 0;
                const eventId = typeof item === 'object'
                    ? clampEntityText(item.eventId || item.id || `event_${TokenizerEngine.simpleHash(`${turn}:${summary}`)}`, 96)
                    : `event_${TokenizerEngine.simpleHash(summary)}`;
                const key = `${eventId}|${turn}|${summary}`.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    eventId,
                    turn,
                    summary,
                    impact: typeof item === 'object' ? clampEntityText(item.impact || item.effect || '', 220) : '',
                    stability: typeof item === 'object' ? clampEntityText(item.stability || item.scope || 'current_state', 64) : 'current_state',
                    evidence: typeof item === 'object' ? normalizeEntityEvidenceItems(item.evidence || item.evidenceItems || [], 6) : []
                });
            }
            return out.slice(-Math.max(1, limit));
        };

        const normalizeEntityStateTimeline = (items, limit = 24) => {
            const source = Array.isArray(items) ? items : (items ? [items] : []);
            const out = [];
            const seen = new Set();
            for (const item of source) {
                if (!item) continue;
                const isObject = item && typeof item === 'object' && !Array.isArray(item);
                const summary = isObject
                    ? clampEntityText(item.summary || item.state || item.text || item.description || item.note || '', 260)
                    : clampEntityText(item, 260);
                if (!summary) continue;
                const turn = isObject
                    ? normalizeFiniteNumber(item.turn ?? item.sourceTurn ?? item.lastObservedTurn, 0)
                    : normalizeFiniteNumber(MemoryState?.currentTurn, 0);
                const physicalState = isObject ? normalizeEntityList(item.physicalState || item.physical_state || [], 8, 140) : [];
                const emotionalState = isObject ? normalizeEntityMoodAtoms(item.emotionalState || item.emotional_state || [], 6, 48) : [];
                const cognitiveFocus = isObject ? normalizeEntityList(item.cognitiveFocus || item.cognitive_focus || [], 8, 160) : [];
                const sourceKind = isObject ? clampEntityText(item.sourceKind || item.source || 'turn_state', 64) : 'turn_state';
                const stability = isObject ? clampEntityText(item.stability || item.scope || 'turn_state', 64) : 'turn_state';
                const evidence = isObject ? normalizeEntityEvidenceItems(item.evidence || item.evidenceItems || [], 4) : [];
                const key = `${turn}|${sourceKind}|${summary}`.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    turn,
                    summary,
                    physicalState,
                    emotionalState,
                    cognitiveFocus,
                    sourceKind,
                    stability,
                    evidence
                });
            }
            return out.slice(-Math.max(1, limit));
        };

        const normalizeEntityQuality = (quality, entity = {}) => {
            const source = quality && typeof quality === 'object' && !Array.isArray(quality) ? quality : {};
            const meta = entity?.meta && typeof entity.meta === 'object' ? entity.meta : {};
            return {
                confidence: normalizeEntity01(source.confidence, normalizeFiniteNumber(meta.confidence, 0.5)),
                salience: normalizeEntity01(source.salience, 0),
                importance: normalizeEntity01(source.importance, 0),
                pressure: normalizeEntity01(source.pressure, 0),
                lastUpdatedTurn: normalizeFiniteNumber(source.lastUpdatedTurn ?? source.updatedTurn ?? meta.updated, 0),
                sourceMix: normalizeEntitySourceMix([...(Array.isArray(source.sourceMix) ? source.sourceMix : []), meta.source].filter(Boolean), 10, 64),
                staleness: clampEntityText(source.staleness || '', 48),
                needsReview: !!source.needsReview
            };
        };

        const normalizeEntityIdentity = (identity, entity = {}) => {
            const source = identity && typeof identity === 'object' && !Array.isArray(identity) ? identity : {};
            const rawAge = source.age ?? entity.age;
            const parsedAge = Number(rawAge);
            const age = Number.isFinite(parsedAge) && parsedAge > 0 && parsedAge < 200 ? Math.floor(parsedAge) : '';
            const background = entity.background && typeof entity.background === 'object' ? entity.background : {};
            const meta = entity.meta && typeof entity.meta === 'object' ? entity.meta : {};
            return {
                age,
                sex: normalizeBiologicalSex(source.sex || entity.sex || entity.biologicalSex || ''),
                occupation: clampEntityText(source.occupation || background.occupation || '', 120),
                affiliation: clampEntityText(source.affiliation || source.organization || source.workplace || '', 120),
                roleInStory: clampEntityText(source.roleInStory || source.role || source.storyRole || '', 180),
                summary: clampEntityText(source.summary || source.identity || '', 240),
                aliases: normalizeEntityList([
                    ...(Array.isArray(source.aliases) ? source.aliases : []),
                    ...(Array.isArray(meta.aliases) ? meta.aliases : [])
                ], 18, 120),
                honorifics: normalizeEntityList(source.honorifics || source.honorificMarkers || [], 10, 80),
                source: normalizeEntityEvidenceItems(source.source ? [source.source] : [], 4)[0] || null
            };
        };

        const normalizeEntityProfile = (profile, entity = {}) => {
            const source = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
            const appearance = source.appearance && typeof source.appearance === 'object' ? source.appearance : {};
            const personality = source.personality && typeof source.personality === 'object' ? source.personality : {};
            const speech = source.speechStyle && typeof source.speechStyle === 'object' ? source.speechStyle : {};
            const psychology = source.psychology && typeof source.psychology === 'object' && !Array.isArray(source.psychology) ? source.psychology : {};
            const legacyAppearance = entity.appearance && typeof entity.appearance === 'object' ? entity.appearance : {};
            const legacyPersonality = entity.personality && typeof entity.personality === 'object' ? entity.personality : {};
            const legacySpeech = entity.speechStyle && typeof entity.speechStyle === 'object' ? entity.speechStyle : {};
            const legacyPsychology = entity.psychology && typeof entity.psychology === 'object' && !Array.isArray(entity.psychology) ? entity.psychology : {};
            const rawPsychologyText = typeof source.psychology === 'string'
                ? source.psychology
                : (Array.isArray(source.psychology)
                    ? normalizeEntityList(source.psychology, 6, 140).join('; ')
                    : (typeof entity.psychology === 'string'
                        ? entity.psychology
                        : (Array.isArray(entity.psychology) ? normalizeEntityList(entity.psychology, 6, 140).join('; ') : '')));
            const explicitPsychologyConflict = psychology.currentConflict
                || psychology.current_conflict
                || psychology.innerConflict
                || psychology.inner_conflict
                || psychology.internalConflict
                || psychology.internal_conflict
                || psychology.conflict
                || legacyPsychology.currentConflict
                || legacyPsychology.current_conflict
                || legacyPsychology.innerConflict
                || legacyPsychology.inner_conflict
                || entity.currentConflict
                || entity.current_conflict
                || entity.innerConflict
                || entity.inner_conflict
                || entity.internalConflict
                || entity.internal_conflict
                || entity.conflict
                || '';
            const normalizedPsychologyBaseline = clampEntityText(
                psychology.baseline
                || psychology.defaultState
                || psychology.default_state
                || psychology.core
                || legacyPsychology.baseline
                || legacyPsychology.defaultState
                || legacyPsychology.default_state
                || entity.baselinePsychology
                || entity.psychologicalBaseline
                || entity.psychological_baseline
                || (explicitPsychologyConflict ? '' : rawPsychologyText),
                220
            );
            const normalizedPsychologyConflict = clampEntityText(explicitPsychologyConflict, 220);
            const normalizedPsychologyNotes = normalizeEntityList([
                ...collectEntityItems(
                    psychology.notes,
                    psychology.cues,
                    psychology.signals,
                    psychology.observations,
                    legacyPsychology.notes,
                    legacyPsychology.cues,
                    entity.psychologicalNotes,
                    entity.psychological_notes,
                    entity.mentalNotes,
                    entity.mental_notes
                ),
                rawPsychologyText && rawPsychologyText !== normalizedPsychologyBaseline && rawPsychologyText !== normalizedPsychologyConflict ? rawPsychologyText : ''
            ].filter(Boolean), 10, 180);
            return {
                appearance: {
                    features: normalizeEntityList([...asEntityArray(appearance.features), ...asEntityArray(legacyAppearance.features)], 14, 150),
                    distinctiveMarks: normalizeEntityList([...asEntityArray(appearance.distinctiveMarks), ...asEntityArray(legacyAppearance.distinctiveMarks)], 8, 150),
                    clothing: normalizeEntityList([...asEntityArray(appearance.clothing), ...asEntityArray(legacyAppearance.clothing)], 10, 150),
                    confidence: normalizeEntity01(appearance.confidence, 0)
                },
                personality: {
                    traits: normalizeEntityTraitList([...asEntityArray(personality.traits), ...asEntityArray(legacyPersonality.traits)], 18, 160),
                    values: normalizeEntityList([...asEntityArray(personality.values), ...asEntityArray(legacyPersonality.values)], 12, 160),
                    fears: normalizeEntityList([...asEntityArray(personality.fears), ...asEntityArray(legacyPersonality.fears)], 12, 160),
                    likes: normalizeEntityList([...asEntityArray(personality.likes), ...asEntityArray(legacyPersonality.likes)], 12, 160),
                    dislikes: normalizeEntityList([...asEntityArray(personality.dislikes), ...asEntityArray(legacyPersonality.dislikes)], 12, 160),
                    vulnerabilities: normalizeEntityList(personality.vulnerabilities || personality.weaknesses || [], 10, 180),
                    boundaries: normalizeEntityList(personality.boundaries || [], 10, 180),
                    workStyle: clampEntityText(personality.workStyle || '', 180),
                    socialStyle: clampEntityText(personality.socialStyle || '', 180),
                    confidence: normalizeEntity01(personality.confidence, 0)
                },
                speechStyle: {
                    defaultTone: clampEntityText(speech.defaultTone || legacySpeech.defaultTone || '', 120),
                    honorificStyle: clampEntityText(speech.honorificStyle || legacySpeech.honorificStyle || '', 140),
                    pressureMarkers: normalizeEntityList(speech.pressureMarkers || speech.pressure_markers || [], 10, 100),
                    intimacyShift: clampEntityText(speech.intimacyShift || speech.intimacy_shift || '', 180),
                    catchphrases: normalizeEntityList(speech.catchphrases || speech.verbalTics || [], 10, 100),
                    notes: normalizeEntityList([...asEntityArray(speech.notes), ...asEntityArray(legacySpeech.notes)], 12, 160)
                },
                psychology: {
                    baseline: normalizedPsychologyBaseline,
                    currentConflict: normalizedPsychologyConflict,
                    copingStyle: clampEntityText(psychology.copingStyle || psychology.coping_style || psychology.coping || legacyPsychology.copingStyle || legacyPsychology.coping_style || legacyPsychology.coping || entity.copingStyle || entity.coping_style || entity.coping || '', 180),
                    notes: normalizedPsychologyNotes,
                    confidence: normalizeEntity01(psychology.confidence ?? legacyPsychology.confidence, 0)
                }
            };
        };

        const normalizeEntityCurrentState = (currentState, entity = {}) => {
            const source = currentState && typeof currentState === 'object' && !Array.isArray(currentState) ? currentState : {};
            const rawStateText = typeof currentState === 'string' ? currentState : '';
            const status = entity.status && typeof entity.status === 'object' ? entity.status : {};
            const sceneTime = clampEntityText(source.sceneTime || source.scene_time || [status.currentDate, status.currentTime].filter(Boolean).join(' ') || '', 80);
            const rawEmotionalState = source.emotionalState || source.emotional_state || [];
            const hasExplicitEmotionalState = Array.isArray(rawEmotionalState)
                ? rawEmotionalState.some(item => String(item || '').trim())
                : !!String(rawEmotionalState || '').trim();
            return {
                summary: clampEntityText(source.summary || source.current_state || rawStateText || '', 260),
                sceneTime,
                location: clampEntityText(source.location || status.currentLocation || '', 160),
                physicalState: normalizeEntityList(source.physicalState || source.physical_state || [], 12, 160),
                emotionalState: normalizeEntityMoodAtoms(hasExplicitEmotionalState ? rawEmotionalState : status.currentMood, 8, 48),
                cognitiveFocus: normalizeEntityList(source.cognitiveFocus || source.cognitive_focus || [], 12, 180),
                immediateGoal: clampEntityText(source.immediateGoal || source.immediate_goal || '', 220),
                activeProblems: normalizeEntityList(source.activeProblems || source.active_problems || [], 12, 180),
                lastObservedTurn: normalizeFiniteNumber(source.lastObservedTurn ?? source.last_observed_turn ?? status.lastUpdated, 0)
            };
        };

        const syncEntityLegacyV2Mirrors = (entity) => {
            if (!entity || typeof entity !== 'object') return entity;
            const identity = entity.identity && typeof entity.identity === 'object' ? entity.identity : {};
            const profile = entity.profile && typeof entity.profile === 'object' ? entity.profile : {};
            const currentState = entity.currentState && typeof entity.currentState === 'object' ? entity.currentState : {};
            const appearance = profile.appearance && typeof profile.appearance === 'object' ? profile.appearance : {};
            const personality = profile.personality && typeof profile.personality === 'object' ? profile.personality : {};
            const speech = profile.speechStyle && typeof profile.speechStyle === 'object' ? profile.speechStyle : {};
            const legacyAppearance = entity.appearance && typeof entity.appearance === 'object' ? entity.appearance : {};
            const legacyPersonality = entity.personality && typeof entity.personality === 'object' ? entity.personality : {};
            const legacySpeech = normalizeSpeechStyleObject(entity.speechStyle || {});
            const legacyBackground = entity.background && typeof entity.background === 'object' ? entity.background : {};
            const legacyStatus = entity.status && typeof entity.status === 'object' ? entity.status : {};
            entity.meta = entity.meta && typeof entity.meta === 'object' ? entity.meta : {};

            const aliases = normalizeEntityList([
                ...(Array.isArray(entity.meta.aliases) ? entity.meta.aliases : []),
                ...(Array.isArray(identity.aliases) ? identity.aliases : [])
            ], 32, 120);
            entity.meta.aliases = aliases;
            if (entity.identity && typeof entity.identity === 'object') entity.identity.aliases = aliases.slice(0, 24);

            entity.sex = normalizeBiologicalSex(identity.sex || entity.sex || '');
            entity.appearance = {
                ...legacyAppearance,
                features: normalizeEntityList(appearance.features || [], 18, 160),
                distinctiveMarks: normalizeEntityList(appearance.distinctiveMarks || [], 12, 160),
                clothing: normalizeEntityList(appearance.clothing || [], 12, 160)
            };
            entity.personality = {
                ...legacyPersonality,
                traits: normalizeEntityTraitList(personality.traits || [], 18, 180),
                values: normalizeEntityList(personality.values || [], 12, 180),
                fears: normalizeEntityList(personality.fears || [], 12, 180),
                likes: normalizeEntityList(personality.likes || [], 12, 180),
                dislikes: normalizeEntityList(personality.dislikes || [], 12, 180),
                sexualOrientation: clampEntityText(legacyPersonality.sexualOrientation || '', 160),
                sexualPreferences: normalizeEntityList(legacyPersonality.sexualPreferences || [], 12, 160)
            };
            entity.speechStyle = {
                ...legacySpeech,
                defaultTone: clampEntityText(speech.defaultTone || legacySpeech.defaultTone || '', 120),
                honorificStyle: clampEntityText(speech.honorificStyle || legacySpeech.honorificStyle || '', 140),
                notes: normalizeEntityList(speech.notes || [], 12, 160)
            };
            entity.background = {
                ...legacyBackground,
                occupation: clampEntityText(identity.occupation || legacyBackground.occupation || '', 120)
            };
            const emotionalState = normalizeEntityMoodAtoms(
                Array.isArray(currentState.emotionalState) && currentState.emotionalState.length
                    ? currentState.emotionalState
                    : legacyStatus.currentMood,
                8,
                48
            );
            if (entity.currentState && typeof entity.currentState === 'object') {
                entity.currentState.emotionalState = emotionalState;
            }
            const lastObservedTurn = normalizeFiniteNumber(currentState.lastObservedTurn, 0);
            const qualityTurn = normalizeFiniteNumber(entity.quality?.lastUpdatedTurn, 0);
            entity.status = {
                ...legacyStatus,
                currentLocation: clampEntityText(currentState.location || legacyStatus.currentLocation || '', 160),
                currentMood: clampEntityText(emotionalState.join(', '), 160),
                lastUpdated: Math.max(normalizeFiniteNumber(legacyStatus.lastUpdated, 0), lastObservedTurn, qualityTurn)
            };
            return entity;
        };

        const normalizeEntityContinuity = (continuity) => {
            const source = continuity && typeof continuity === 'object' && !Array.isArray(continuity) ? continuity : {};
            return {
                openThreads: normalizeEntityThreadItems(collectEntityItems(
                    source.openThreads,
                    source.open_threads,
                    source.activeThreads,
                    source.active_threads,
                    source.threads,
                    source.unresolvedThreads,
                    source.unresolved_threads,
                    source.openLoops,
                    source.open_loops,
                    source.openHooks,
                    source.open_hooks,
                    source.plotHooks,
                    source.plot_hooks,
                    source.looseEnds,
                    source.loose_ends,
                    source.pendingQuestions,
                    source.pending_questions,
                    source.unresolved
                ), 12),
                unresolvedNeeds: normalizeEntityList(collectEntityItems(source.unresolvedNeeds, source.unresolved_needs, source.needs, source.pendingNeeds, source.pending_needs), 12, 180),
                commitments: normalizeEntityList(collectEntityItems(source.commitments, source.promises, source.obligations), 12, 180),
                nextActionHints: normalizeEntityList(collectEntityItems(source.nextActionHints, source.next_action_hints, source.nextActions, source.next_actions, source.nextSteps, source.next_steps, source.plannedNextSteps, source.planned_next_steps), 12, 180)
            };
        };

        const normalizeEntityPovKnowledge = (povKnowledge) => {
            const source = povKnowledge && typeof povKnowledge === 'object' && !Array.isArray(povKnowledge) ? povKnowledge : {};
            return {
                knownToSelf: normalizeEntityList(source.knownToSelf || source.known_to_self || [], 16, 180),
                unknownToSelf: normalizeEntityList(source.unknownToSelf || source.unknown_to_self || [], 16, 180),
                knownToOthers: normalizeEntityList(source.knownToOthers || source.known_to_others || [], 16, 180),
                visibleTo: normalizeEntityList(source.visibleTo || source.visible_to || [], 12, 120),
                privateExperiences: normalizeEntityList(source.privateExperiences || source.private_experiences || [], 12, 180),
                privacy: clampEntityText(source.privacy || source.privacyLevel || '', 80)
            };
        };

        const normalizeEntityV2Fields = (entity) => {
            if (!entity || typeof entity !== 'object') return entity;
            entity.entityType = clampEntityText(entity.entityType || entity.kind || entity.type || 'person', 48) || 'person';
            entity.identity = normalizeEntityIdentity(entity.identity, entity);
            rebalanceEntityVisualPersonalityFields(entity);
            entity.profile = normalizeEntityProfile(entity.profile, entity);
            entity.currentState = normalizeEntityCurrentState(entity.currentState || entity.current_state, entity);
            entity.continuity = normalizeEntityContinuity(entity.continuity);
            entity.povKnowledge = normalizeEntityPovKnowledge(entity.povKnowledge || entity.pov_knowledge || entity.knowledge);
            entity.episodeLedger = normalizeEntityEpisodeLedger(entity.episodeLedger || entity.episode_ledger || []);
            entity.stateTimeline = normalizeEntityStateTimeline(entity.stateTimeline || entity.state_timeline || []);
            entity.evidence = normalizeEntityEvidenceItems(entity.evidence || entity.evidenceItems || [], 20);
            entity.quality = normalizeEntityQuality(entity.quality, entity);
            rebalanceEntityVisualPersonalityFields(entity);
            return syncEntityLegacyV2Mirrors(entity);
        };

        const mergeEntityScalar = (target, source, key, options = {}) => {
            const incoming = source?.[key];
            const incomingText = typeof incoming === 'number' ? incoming : clampEntityText(incoming, options.max || 220);
            if (incomingText === '' || incomingText == null) return;
            const existing = target?.[key];
            if (options.force || isSparseEntityText(existing)) {
                target[key] = incomingText;
                return;
            }
            if (typeof incomingText === 'string' && typeof existing === 'string' && incomingText.length > existing.length * 1.45) {
                target[key] = incomingText;
            }
        };

        const mergeEntityListField = (target, source, key, limit = 12, itemMax = 180) => {
            if (key === 'emotionalState') {
                target[key] = normalizeEntityMoodAtoms([
                    ...(Array.isArray(target?.[key]) ? target[key] : (target?.[key] ? [target[key]] : [])),
                    ...(Array.isArray(source?.[key]) ? source[key] : (source?.[key] ? [source[key]] : []))
                ], Math.min(Number(limit || 8) || 8, 8), 48);
                return;
            }
            const mergedItems = [
                ...(Array.isArray(target?.[key]) ? target[key] : []),
                ...(Array.isArray(source?.[key]) ? source[key] : (source?.[key] ? [source[key]] : []))
            ];
            target[key] = key === 'traits'
                ? normalizeEntityTraitList(mergedItems, limit, itemMax)
                : normalizeEntityList(mergedItems, limit, itemMax);
        };

        const mergeEntityV2Fields = (baseEntity, incomingEntity, options = {}) => {
            if (!baseEntity || !incomingEntity) return baseEntity;
            normalizeEntityV2Fields(baseEntity);
            normalizeEntityV2Fields(incomingEntity);
            const force = options.forceReplace === true;

            ['age', 'sex', 'occupation', 'affiliation', 'roleInStory', 'summary'].forEach(key => mergeEntityScalar(baseEntity.identity, incomingEntity.identity, key, { force, max: 180 }));
            mergeEntityListField(baseEntity.identity, incomingEntity.identity, 'aliases', 24, 120);
            mergeEntityListField(baseEntity.identity, incomingEntity.identity, 'honorifics', 12, 100);
            if (!baseEntity.identity.source && incomingEntity.identity.source) baseEntity.identity.source = incomingEntity.identity.source;

            for (const key of ['features', 'distinctiveMarks', 'clothing']) {
                mergeEntityListField(baseEntity.profile.appearance, incomingEntity.profile.appearance, key, key === 'features' ? 18 : 12, 160);
            }
            baseEntity.profile.appearance.confidence = Math.max(baseEntity.profile.appearance.confidence || 0, incomingEntity.profile.appearance.confidence || 0);
            for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes', 'vulnerabilities', 'boundaries']) {
                mergeEntityListField(baseEntity.profile.personality, incomingEntity.profile.personality, key, 18, 180);
            }
            ['workStyle', 'socialStyle'].forEach(key => mergeEntityScalar(baseEntity.profile.personality, incomingEntity.profile.personality, key, { force, max: 180 }));
            baseEntity.profile.personality.confidence = Math.max(baseEntity.profile.personality.confidence || 0, incomingEntity.profile.personality.confidence || 0);

            ['defaultTone', 'honorificStyle', 'intimacyShift'].forEach(key => mergeEntityScalar(baseEntity.profile.speechStyle, incomingEntity.profile.speechStyle, key, { force, max: 180 }));
            ['pressureMarkers', 'catchphrases', 'notes'].forEach(key => mergeEntityListField(baseEntity.profile.speechStyle, incomingEntity.profile.speechStyle, key, 12, 160));
            ['baseline', 'currentConflict', 'copingStyle'].forEach(key => mergeEntityScalar(baseEntity.profile.psychology, incomingEntity.profile.psychology, key, { force, max: 220 }));
            mergeEntityListField(baseEntity.profile.psychology, incomingEntity.profile.psychology, 'notes', 12, 180);
            baseEntity.profile.psychology.confidence = Math.max(baseEntity.profile.psychology.confidence || 0, incomingEntity.profile.psychology.confidence || 0);

            const incomingTurn = normalizeFiniteNumber(incomingEntity.currentState?.lastObservedTurn, options.currentTurn || MemoryState.currentTurn || 0);
            const baseTurn = normalizeFiniteNumber(baseEntity.currentState?.lastObservedTurn, 0);
            const allowStateReplace = force || incomingTurn >= baseTurn || isSparseEntityText(baseEntity.currentState?.summary);
            ['summary', 'sceneTime', 'location', 'immediateGoal'].forEach(key => mergeEntityScalar(baseEntity.currentState, incomingEntity.currentState, key, { force: allowStateReplace, max: 260 }));
            ['physicalState', 'emotionalState', 'cognitiveFocus', 'activeProblems'].forEach(key => mergeEntityListField(baseEntity.currentState, incomingEntity.currentState, key, 14, 180));
            if (incomingTurn) baseEntity.currentState.lastObservedTurn = Math.max(baseTurn, incomingTurn);

            baseEntity.continuity.openThreads = normalizeEntityThreadItems([...(baseEntity.continuity.openThreads || []), ...(incomingEntity.continuity.openThreads || [])], 14);
            ['unresolvedNeeds', 'commitments', 'nextActionHints'].forEach(key => mergeEntityListField(baseEntity.continuity, incomingEntity.continuity, key, 14, 180));
            ['knownToSelf', 'unknownToSelf', 'knownToOthers', 'visibleTo', 'privateExperiences'].forEach(key => mergeEntityListField(baseEntity.povKnowledge, incomingEntity.povKnowledge, key, 18, 180));
            mergeEntityScalar(baseEntity.povKnowledge, incomingEntity.povKnowledge, 'privacy', { force, max: 100 });

            baseEntity.episodeLedger = normalizeEntityEpisodeLedger([...(baseEntity.episodeLedger || []), ...(incomingEntity.episodeLedger || [])], 20);
            baseEntity.stateTimeline = normalizeEntityStateTimeline([...(baseEntity.stateTimeline || []), ...(incomingEntity.stateTimeline || [])], 24);
            baseEntity.evidence = normalizeEntityEvidenceItems([...(baseEntity.evidence || []), ...(incomingEntity.evidence || [])], 24);
            if (options.sourceMode || options.m_id) {
                baseEntity.evidence = normalizeEntityEvidenceItems([
                    ...(baseEntity.evidence || []),
                    {
                        sourceKind: options.sourceMode || 'entity_update',
                        turn: MemoryState.currentTurn,
                        messageId: options.m_id || '',
                        confidence: normalizeEntity01(incomingEntity.quality?.confidence, 0)
                    }
                ], 24);
            }
            baseEntity.quality.confidence = Math.max(baseEntity.quality.confidence || 0, incomingEntity.quality.confidence || 0);
            baseEntity.quality.salience = Math.max(baseEntity.quality.salience || 0, incomingEntity.quality.salience || 0);
            baseEntity.quality.importance = Math.max(baseEntity.quality.importance || 0, incomingEntity.quality.importance || 0);
            baseEntity.quality.pressure = Math.max(baseEntity.quality.pressure || 0, incomingEntity.quality.pressure || 0);
            baseEntity.quality.lastUpdatedTurn = Math.max(baseEntity.quality.lastUpdatedTurn || 0, incomingEntity.quality.lastUpdatedTurn || 0, MemoryState.currentTurn || 0);
            baseEntity.quality.sourceMix = normalizeEntitySourceMix([...(baseEntity.quality.sourceMix || []), ...(incomingEntity.quality.sourceMix || []), options.sourceMode].filter(Boolean), 12, 64);
            baseEntity.quality.needsReview = !!(baseEntity.quality.needsReview || incomingEntity.quality.needsReview);
            if (incomingEntity.quality.staleness) baseEntity.quality.staleness = incomingEntity.quality.staleness;
            return normalizeEntityV2Fields(baseEntity);
        };

        const normalizeRelationV2Fields = (relation) => {
            if (!relation || typeof relation !== 'object') return relation;
            const details = relation.details && typeof relation.details === 'object' ? relation.details : {};
            const sentiments = relation.sentiments && typeof relation.sentiments === 'object' ? relation.sentiments : {};
            const currentStatus = relation.currentStatus && typeof relation.currentStatus === 'object' ? relation.currentStatus : {};
            const rawCurrentStatusText = typeof relation.currentStatus === 'string' ? relation.currentStatus : '';
            const metrics = relation.metrics && typeof relation.metrics === 'object' ? relation.metrics : {};
            const dynamics = relation.dynamics && typeof relation.dynamics === 'object' && !Array.isArray(relation.dynamics) ? relation.dynamics : {};
            const rawDynamicsItems = typeof relation.dynamics === 'string' || Array.isArray(relation.dynamics) ? relation.dynamics : [];
            const sharedContext = relation.sharedContext && typeof relation.sharedContext === 'object' ? relation.sharedContext : {};
            const hasDetailCloseness = Object.prototype.hasOwnProperty.call(details, 'closeness');
            const hasDetailTrust = Object.prototype.hasOwnProperty.call(details, 'trust');
            const closenessScore = normalizeNullableRelationScore(hasDetailCloseness ? details.closeness : metrics.closeness);
            const trustScore = normalizeNullableRelationScore(hasDetailTrust ? details.trust : metrics.trust);
            relation.details = {
                howMet: clampEntityText(details.howMet || relation.howMet || '', 180),
                duration: clampEntityText(details.duration || relation.duration || '', 120),
                closeness: closenessScore,
                trust: trustScore,
                events: Array.isArray(details.events) ? details.events.slice(-12) : []
            };
            relation.currentStatus = {
                summary: clampEntityText(currentStatus.summary || rawCurrentStatusText || relation.current_state || '', 220),
                publicLayer: clampEntityText(currentStatus.publicLayer || currentStatus.public_layer || '', 160),
                privateLayer: clampEntityText(currentStatus.privateLayer || currentStatus.private_layer || '', 180),
                boundaryState: clampEntityText(currentStatus.boundaryState || currentStatus.boundary_state || '', 140),
                lastChangedTurn: normalizeFiniteNumber(currentStatus.lastChangedTurn ?? currentStatus.last_changed_turn ?? sentiments.lastInteraction, 0)
            };
            relation.metrics = {
                closeness: closenessScore,
                trust: trustScore,
                tension: normalizeEntity01(metrics.tension ?? metrics.currentTension, sentiments.currentTension || 0),
                risk: normalizeEntity01(metrics.risk, 0),
                ambiguity: normalizeEntity01(metrics.ambiguity, closenessScore == null && trustScore == null ? 0.65 : 0),
                pressure: normalizeEntity01(metrics.pressure, 0)
            };
            const relationEventItems = collectEntityItems(
                relation.event,
                details.event,
                Array.isArray(details.events) ? details.events.map(item => item?.event || item?.summary || item?.text || item?.brief || '') : []
            );
            relation.dynamics = {
                fromAtoB: normalizeEntityList(collectEntityItems(dynamics.fromAtoB, dynamics.from_a_to_b, sentiments.fromAtoB ? [sentiments.fromAtoB] : []), 12, 180),
                fromBtoA: normalizeEntityList(collectEntityItems(dynamics.fromBtoA, dynamics.from_b_to_a, sentiments.fromBtoA ? [sentiments.fromBtoA] : []), 12, 180),
                unresolvedIssues: normalizeEntityList(collectEntityItems(
                    dynamics.unresolvedIssues,
                    dynamics.unresolved_issues,
                    dynamics.openIssues,
                    dynamics.open_issues,
                    dynamics.pendingIssues,
                    dynamics.pending_issues,
                    dynamics.issues,
                    dynamics.unresolved,
                    dynamics.pendingQuestions,
                    dynamics.pending_questions,
                    dynamics.openQuestions,
                    dynamics.open_questions,
                    dynamics.tensions,
                    dynamics.openTensions,
                    dynamics.open_tensions,
                    relation.unresolvedIssues,
                    relation.unresolved_issues,
                    relation.openIssues,
                    relation.open_issues,
                    relation.pendingIssues,
                    relation.pending_issues,
                    relation.issues,
                    relation.unresolved
                ), 12, 180),
                recentChanges: normalizeEntityList(collectEntityItems(
                    dynamics.recentChanges,
                    dynamics.recent_changes,
                    dynamics.changes,
                    dynamics.relationshipChanges,
                    dynamics.relationship_changes,
                    dynamics.relationshipDeltas,
                    dynamics.relationship_deltas,
                    dynamics.relationDeltas,
                    dynamics.relation_deltas,
                    dynamics.deltas,
                    relation.recentChanges,
                    relation.recent_changes,
                    relation.changes,
                    relation.relationshipChanges,
                    relation.relationship_changes,
                    relation.relationshipDeltas,
                    relation.relationship_deltas,
                    relation.relationDeltas,
                    relation.relation_deltas,
                    rawDynamicsItems,
                    relationEventItems
                ), 12, 180)
            };
            relation.sharedContext = {
                location: clampEntityText(sharedContext.location || '', 160),
                workplace: clampEntityText(sharedContext.workplace || '', 160),
                privateThreads: normalizeEntityList(sharedContext.privateThreads || sharedContext.private_threads || [], 12, 120),
                notes: normalizeEntityList(sharedContext.notes || [], 12, 180)
            };
            relation.eventLedger = normalizeEntityEpisodeLedger(relation.eventLedger || relation.event_ledger || details.events || [], 12);
            relation.evidence = normalizeEntityEvidenceItems(relation.evidence || [], 20);
            relation.quality = normalizeEntityQuality(relation.quality, relation);
            relation.relationshipAssessment = buildRelationshipAssessment(relation);
            return relation;
        };

        const mergeRelationV2Fields = (baseRelation, incomingRelation, options = {}) => {
            if (!baseRelation || !incomingRelation) return baseRelation;
            normalizeRelationV2Fields(baseRelation);
            normalizeRelationV2Fields(incomingRelation);
            const force = options.forceReplace === true;
            ['summary', 'publicLayer', 'privateLayer', 'boundaryState'].forEach(key => mergeEntityScalar(baseRelation.currentStatus, incomingRelation.currentStatus, key, { force, max: 220 }));
            baseRelation.currentStatus.lastChangedTurn = Math.max(baseRelation.currentStatus.lastChangedTurn || 0, incomingRelation.currentStatus.lastChangedTurn || 0, MemoryState.currentTurn || 0);
            ['closeness', 'trust'].forEach(key => {
                baseRelation.metrics[key] = mergeNullableRelationScore(baseRelation.metrics[key], incomingRelation.metrics[key]);
                baseRelation.details[key] = mergeNullableRelationScore(baseRelation.details[key], incomingRelation.details[key]);
            });
            ['tension', 'risk', 'ambiguity', 'pressure'].forEach(key => {
                baseRelation.metrics[key] = Math.max(normalizeEntity01(baseRelation.metrics[key], 0), normalizeEntity01(incomingRelation.metrics[key], 0));
            });
            ['fromAtoB', 'fromBtoA', 'unresolvedIssues', 'recentChanges'].forEach(key => mergeEntityListField(baseRelation.dynamics, incomingRelation.dynamics, key, 14, 180));
            ['privateThreads', 'notes'].forEach(key => mergeEntityListField(baseRelation.sharedContext, incomingRelation.sharedContext, key, 14, 180));
            ['location', 'workplace'].forEach(key => mergeEntityScalar(baseRelation.sharedContext, incomingRelation.sharedContext, key, { force, max: 160 }));
            baseRelation.eventLedger = normalizeEntityEpisodeLedger([...(baseRelation.eventLedger || []), ...(incomingRelation.eventLedger || [])], 24);
            baseRelation.evidence = normalizeEntityEvidenceItems([...(baseRelation.evidence || []), ...(incomingRelation.evidence || [])], 24);
            if (options.sourceMode || options.m_id) {
                baseRelation.evidence = normalizeEntityEvidenceItems([
                    ...(baseRelation.evidence || []),
                    {
                        sourceKind: options.sourceMode || 'relation_update',
                        turn: MemoryState.currentTurn,
                        messageId: options.m_id || '',
                        confidence: normalizeEntity01(incomingRelation.quality?.confidence, 0)
                    }
                ], 24);
            }
            baseRelation.quality.confidence = Math.max(baseRelation.quality.confidence || 0, incomingRelation.quality.confidence || 0);
            baseRelation.quality.salience = Math.max(baseRelation.quality.salience || 0, incomingRelation.quality.salience || 0);
            baseRelation.quality.importance = Math.max(baseRelation.quality.importance || 0, incomingRelation.quality.importance || 0);
            baseRelation.quality.pressure = Math.max(baseRelation.quality.pressure || 0, incomingRelation.quality.pressure || 0);
            baseRelation.quality.lastUpdatedTurn = Math.max(baseRelation.quality.lastUpdatedTurn || 0, incomingRelation.quality.lastUpdatedTurn || 0, MemoryState.currentTurn || 0);
            baseRelation.quality.sourceMix = normalizeEntitySourceMix([...(baseRelation.quality.sourceMix || []), ...(incomingRelation.quality.sourceMix || []), options.sourceMode].filter(Boolean), 12, 64);
            baseRelation.relationshipAssessment = buildRelationshipAssessment({
                ...baseRelation,
                relationshipAssessment: {
                    ...(baseRelation.relationshipAssessment || {}),
                    ...(incomingRelation.relationshipAssessment || {}),
                    evidenceCount: Math.max(
                        Number(baseRelation.relationshipAssessment?.evidenceCount || 0),
                        Number(incomingRelation.relationshipAssessment?.evidenceCount || 0),
                        getRelationEvidenceCount(baseRelation)
                    )
                }
            });
            return normalizeRelationV2Fields(baseRelation);
        };

        const mergeEntityRecords = (baseEntity, incomingEntity) => {
            if (!baseEntity) return incomingEntity;
            if (!incomingEntity) return baseEntity;
            baseEntity.meta = baseEntity.meta || {};
            incomingEntity.meta = incomingEntity.meta || {};
            normalizeEntityV2Fields(baseEntity);
            normalizeEntityV2Fields(incomingEntity);
            const baseDisplayName = normalizeCanonicalDisplayName(baseEntity.name || '');
            const incomingDisplayName = normalizeCanonicalDisplayName(incomingEntity.name || '');
            const baseNameLocked = baseEntity.meta?.nameManualLocked === true;
            const incomingNameLocked = incomingEntity.meta?.nameManualLocked === true;
            const baseHasBilingual = !!extractBilingualNameParts(baseDisplayName);
            const incomingHasBilingual = !!extractBilingualNameParts(incomingDisplayName);
            if (baseNameLocked && baseDisplayName) {
                baseEntity.name = baseDisplayName;
            } else if (incomingNameLocked && incomingDisplayName) {
                baseEntity.name = incomingDisplayName;
            } else if ((!baseHasBilingual && incomingHasBilingual) || (!baseDisplayName && incomingDisplayName)) {
                baseEntity.name = incomingDisplayName;
            } else if (!baseHasBilingual && !incomingHasBilingual && baseDisplayName && incomingDisplayName) {
                // Synthesize bilingual name when merging Korean-only + English-only
                const isBaseKorean = /[가-힣]/.test(baseDisplayName) && !/[A-Za-z]/.test(baseDisplayName);
                const isIncomingKorean = /[가-힣]/.test(incomingDisplayName) && !/[A-Za-z]/.test(incomingDisplayName);
                const isBaseEnglish = /[A-Za-z]/.test(baseDisplayName) && !/[가-힣]/.test(baseDisplayName);
                const isIncomingEnglish = /[A-Za-z]/.test(incomingDisplayName) && !/[가-힣]/.test(incomingDisplayName);
                if (isBaseKorean && isIncomingEnglish) {
                    baseEntity.name = `${baseDisplayName}(${incomingDisplayName})`;
                } else if (isBaseEnglish && isIncomingKorean) {
                    baseEntity.name = `${incomingDisplayName}(${baseDisplayName})`;
                } else if (baseDisplayName) {
                    baseEntity.name = baseDisplayName;
                }
            } else if (baseDisplayName) {
                baseEntity.name = baseDisplayName;
            }
            const aliasSet = new Set([
                ...(Array.isArray(baseEntity.meta.aliases) ? baseEntity.meta.aliases : []),
                ...(Array.isArray(incomingEntity.meta.aliases) ? incomingEntity.meta.aliases : []),
                normalizeBaseName(baseEntity.name || ''),
                normalizeBaseName(incomingEntity.name || ''),
                normalizeCanonicalDisplayName(baseEntity.name || ''),
                normalizeCanonicalDisplayName(incomingEntity.name || '')
            ].filter(Boolean));
            baseEntity.meta.aliases = [...aliasSet];
            baseEntity.meta.nameManualLocked = baseNameLocked || incomingNameLocked || false;
            if (baseEntity.meta.nameManualLocked) {
                baseEntity.meta.nameManualLockedAt = Math.max(
                    normalizeFiniteNumber(baseEntity.meta.nameManualLockedAt, 0),
                    normalizeFiniteNumber(incomingEntity.meta.nameManualLockedAt, 0)
                ) || Date.now();
            }
            baseEntity.meta.nameHistory = normalizeEntityList([
                ...(Array.isArray(baseEntity.meta.nameHistory) ? baseEntity.meta.nameHistory : []),
                ...(Array.isArray(incomingEntity.meta.nameHistory) ? incomingEntity.meta.nameHistory : [])
            ], 24, 180);
            const hiddenNameKeySet = new Set([
                ...(Array.isArray(baseEntity.meta.hiddenNameKeys) ? baseEntity.meta.hiddenNameKeys : []),
                ...(Array.isArray(incomingEntity.meta.hiddenNameKeys) ? incomingEntity.meta.hiddenNameKeys : []),
                ...buildHiddenNameKeys(baseEntity.name || ''),
                ...buildHiddenNameKeys(incomingEntity.name || '')
            ].filter(Boolean));
            baseEntity.meta.hiddenNameKeys = [...hiddenNameKeySet];

            baseEntity.sex = normalizeBiologicalSex(baseEntity.sex || baseEntity.biologicalSex || '');
            incomingEntity.sex = normalizeBiologicalSex(incomingEntity.sex || incomingEntity.biologicalSex || '');
            if (!baseEntity.sex && incomingEntity.sex) baseEntity.sex = incomingEntity.sex;

            for (const key of ['features', 'distinctiveMarks', 'clothing']) {
                baseEntity.appearance = baseEntity.appearance || {};
                incomingEntity.appearance = incomingEntity.appearance || {};
                const merged = new Set([...(baseEntity.appearance[key] || []), ...(incomingEntity.appearance[key] || [])].filter(Boolean));
                baseEntity.appearance[key] = [...merged];
            }
            for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes', 'sexualPreferences']) {
                baseEntity.personality = baseEntity.personality || {};
                incomingEntity.personality = incomingEntity.personality || {};
                const merged = [...(baseEntity.personality[key] || []), ...(incomingEntity.personality[key] || [])].filter(Boolean);
                baseEntity.personality[key] = key === 'traits'
                    ? normalizeEntityTraitList(merged, 18, 180)
                    : [...new Set(merged)];
            }
            if (!baseEntity.personality.sexualOrientation && incomingEntity.personality?.sexualOrientation) {
                baseEntity.personality.sexualOrientation = incomingEntity.personality.sexualOrientation;
            }
            baseEntity.speechStyle = baseEntity.speechStyle || { defaultTone: '', honorificStyle: '', toSuperiors: '', toSubordinates: '', toPeers: '', toYounger: '', notes: [] };
            incomingEntity.speechStyle = incomingEntity.speechStyle || {};
            for (const key of ['defaultTone', 'honorificStyle', 'toSuperiors', 'toSubordinates', 'toPeers', 'toYounger']) {
                if (!baseEntity.speechStyle[key] && incomingEntity.speechStyle?.[key]) {
                    baseEntity.speechStyle[key] = incomingEntity.speechStyle[key];
                }
            }
            baseEntity.speechStyle.notes = dedupeTextArray([
                ...(Array.isArray(baseEntity.speechStyle.notes) ? baseEntity.speechStyle.notes : []),
                ...(Array.isArray(incomingEntity.speechStyle?.notes) ? incomingEntity.speechStyle.notes : [])
            ].filter(Boolean));
            baseEntity.background = baseEntity.background || {};
            incomingEntity.background = incomingEntity.background || {};
            if (!baseEntity.background.origin && incomingEntity.background.origin) baseEntity.background.origin = incomingEntity.background.origin;
            if (!baseEntity.background.occupation && incomingEntity.background.occupation) baseEntity.background.occupation = incomingEntity.background.occupation;
            const mergedHistory = new Set([...(baseEntity.background.history || []), ...(incomingEntity.background.history || [])].filter(Boolean));
            baseEntity.background.history = [...mergedHistory];
            baseEntity.status = baseEntity.status || {};
            incomingEntity.status = incomingEntity.status || {};
            if (!baseEntity.status.currentLocation && incomingEntity.status.currentLocation) baseEntity.status.currentLocation = incomingEntity.status.currentLocation;
            if (!baseEntity.status.currentMood && incomingEntity.status.currentMood) baseEntity.status.currentMood = incomingEntity.status.currentMood;
            if (!baseEntity.status.healthStatus && incomingEntity.status.healthStatus) baseEntity.status.healthStatus = incomingEntity.status.healthStatus;
            baseEntity.status.notes = mergeLimitedStatusNotes(baseEntity.status.notes || '', incomingEntity.status.notes || '', 320, {
                entityName: baseEntity.name || incomingEntity.name || '',
                status: baseEntity.status
            });
            baseEntity.meta.created = Math.min(
                normalizeFiniteNumber(baseEntity.meta.created, Infinity),
                normalizeFiniteNumber(incomingEntity.meta.created, Infinity)
            );
            if (!Number.isFinite(baseEntity.meta.created)) baseEntity.meta.created = 0;
            baseEntity.meta.updated = Math.max(
                normalizeFiniteNumber(baseEntity.meta.updated, 0),
                normalizeFiniteNumber(incomingEntity.meta.updated, 0)
            );
            baseEntity.meta.confidence = Math.max(
                normalizeFiniteNumber(baseEntity.meta.confidence, 0),
                normalizeFiniteNumber(incomingEntity.meta.confidence, 0)
            );
            return mergeEntityV2Fields(baseEntity, incomingEntity, {
                sourceMode: incomingEntity.meta?.source || baseEntity.meta?.source || 'merge'
            });
        };
        const getEntityDisplayNameScore = (entity) => {
            const displayName = normalizeCanonicalDisplayName(entity?.name || '');
            let score = Math.max(0, displayName.length);
            if (entity?.meta?.nameManualLocked === true) score += 1000;
            if (extractBilingualNameParts(displayName)) score += 100;
            if (/^[가-힣]{3,4}$/.test(normalizeBaseName(displayName))) score += 40;
            if (/\s/.test(displayName)) score += 10;
            return score;
        };
        const shouldForceMergeEntities = (entityA, entityB) => {
            if (!entityA || !entityB) return false;
            if (entityA?.meta?.nameManualLocked === true && entityB?.meta?.nameManualLocked === true) {
                const displayA = normalizeCanonicalDisplayName(entityA?.name || '');
                const displayB = normalizeCanonicalDisplayName(entityB?.name || '');
                if (displayA && displayB && displayA !== displayB) return false;
            }
            const aliasesA = new Set(extractEntityAliases(entityA).map(alias => String(alias || '').trim().toLowerCase()).filter(Boolean));
            const aliasesB = new Set(extractEntityAliases(entityB).map(alias => String(alias || '').trim().toLowerCase()).filter(Boolean));
            const shared = [...aliasesA].filter(alias => aliasesB.has(alias));
            if (shared.some(alias => /^[가-힣]{3,4}$/.test(alias))) return true;
            if (shared.some(alias => alias.length >= 5)) return true;

            // Cross-script phonetic matching: Korean ↔ English
            const nameA = String(entityA?.name || '');
            const nameB = String(entityB?.name || '');
            const baseA = normalizeBaseName(nameA);
            const baseB = normalizeBaseName(nameB);
            const isKoreanA = /[가-힣]/.test(baseA);
            const isKoreanB = /[가-힣]/.test(baseB);

            if (isKoreanA !== isKoreanB) {
                const koreanName = isKoreanA ? baseA : baseB;
                const otherName = isKoreanA ? baseB : baseA;
                const romanizedFull = romanizeHangulText(koreanName);
                const otherIdentity = normalizeIdentityToken(otherName);
                if (romanizedFull && otherIdentity && romanizedFull === otherIdentity) return true;

                // Match individual English name parts against Korean short name
                const koreanShort = getKoreanShortName(koreanName);
                if (koreanShort) {
                    const romanizedShort = romanizeHangulText(koreanShort);
                    const otherParts = getEnglishOrJapaneseNameParts(otherName);
                    for (const part of otherParts) {
                        const partIdentity = normalizeIdentityToken(part);
                        if (partIdentity && romanizedShort && partIdentity === romanizedShort) return true;
                    }
                }

                // Match romanized full Korean name against English identity (prefix/suffix)
                if (romanizedFull && otherIdentity) {
                    const shorter = romanizedFull.length <= otherIdentity.length ? romanizedFull : otherIdentity;
                    const longer = romanizedFull.length <= otherIdentity.length ? otherIdentity : romanizedFull;
                    if (shorter.length >= 4 && longer.includes(shorter) && shorter.length >= longer.length * 0.6) return true;
                }
            }

            // Conservative phonetic matching: only allow exact cross-script phonetic identity.
            if (baseA && baseB) {
                const crossScript = (/[가-힣]/.test(baseA) && /[a-z]/i.test(baseB)) || (/[가-힣]/.test(baseB) && /[a-z]/i.test(baseA));
                if (crossScript && isPhoneticallySimilar(baseA, baseB)) return true;
            }

            return false;
        };
        const getEntityCollapseBucketKeys = (key = '', entity = {}) => {
            const keys = new Set();
            const addRaw = (raw = '') => {
                const base = normalizeBaseName(raw);
                if (base) keys.add(`base:${base}`);
                for (const alias of buildAliasCandidates(raw, true)) {
                    if (alias) keys.add(`alias:${alias}`);
                }
                for (const hidden of buildHiddenNameKeys(raw)) {
                    if (hidden) keys.add(`hidden:${hidden}`);
                }
                const shortKo = getKoreanShortName(raw);
                if (shortKo) keys.add(`ko_short:${shortKo}`);
                const identity = normalizeIdentityToken(raw);
                if (identity) keys.add(`identity:${identity}`);
            };
            addRaw(key);
            addRaw(entity?.name || '');
            for (const alias of Array.isArray(entity?.meta?.aliases) ? entity.meta.aliases : []) addRaw(alias);
            for (const hidden of Array.isArray(entity?.meta?.hiddenNameKeys) ? entity.meta.hiddenNameKeys : []) addRaw(hidden);
            return Array.from(keys).slice(0, 64);
        };

        const collapseClearlyDuplicateEntities = () => {
            let mergedAny = false;
            let changed = true;
            let safetyCounter = 0;
            const MAX_COLLAPSE_ITERATIONS = 80;
            const MAX_BUCKET_PAIR_CHECKS = 1600;
            while (changed && safetyCounter < MAX_COLLAPSE_ITERATIONS) {
                changed = false;
                safetyCounter++;
                const entries = Array.from(entityCache.entries());
                const buckets = new Map();
                for (const [key, entity] of entries) {
                    if (!entityCache.has(key)) continue;
                    if (!isPromptVisibleEntityRecord(entity)) continue;
                    for (const bucketKey of getEntityCollapseBucketKeys(key, entity)) {
                        if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
                        const bucket = buckets.get(bucketKey);
                        if (bucket.length < 80) bucket.push([key, entity]);
                    }
                }

                let pairChecks = 0;
                let mergePair = null;
                const orderedBuckets = Array.from(buckets.values()).sort((a, b) => a.length - b.length);
                for (const bucket of orderedBuckets) {
                    if (!Array.isArray(bucket) || bucket.length < 2) continue;
                    for (let i = 0; i < bucket.length; i++) {
                        const [keyA, entityA] = bucket[i];
                        if (!entityCache.has(keyA)) continue;
                        for (let j = i + 1; j < bucket.length; j++) {
                            const [keyB, entityB] = bucket[j];
                            if (keyA === keyB || !entityCache.has(keyB)) continue;
                            pairChecks += 1;
                            if (pairChecks > MAX_BUCKET_PAIR_CHECKS) break;
                            if (!isPromptVisibleEntityRecord(entityA) || !isPromptVisibleEntityRecord(entityB)) continue;
                            if (!shouldForceMergeEntities(entityA, entityB)) continue;
                            mergePair = { keyA, entityA, keyB, entityB };
                            break;
                        }
                        if (mergePair || pairChecks > MAX_BUCKET_PAIR_CHECKS) break;
                    }
                    if (mergePair || pairChecks > MAX_BUCKET_PAIR_CHECKS) break;
                }

                if (!mergePair) break;
                const { keyA, entityA, keyB, entityB } = mergePair;
                const preferA = getEntityDisplayNameScore(entityA) >= getEntityDisplayNameScore(entityB);
                const keepKey = preferA ? keyA : keyB;
                const dropKey = preferA ? keyB : keyA;
                const merged = mergeEntityRecords(
                    safeClone(preferA ? entityA : entityB),
                    safeClone(preferA ? entityB : entityA)
                );
                entityCache.set(keepKey, merged);
                entityCache.delete(dropKey);
                changed = true;
                mergedAny = true;
            }
            if (!mergedAny) return;
            const rebuiltRelations = new Map();
            for (const relation of relationCache.values()) {
                relation.entityA = resolveCanonicalName(relation.entityA || '');
                relation.entityB = resolveCanonicalName(relation.entityB || '');
                relation.id = makeRelationId(relation.entityA || '', relation.entityB || '');
                if (rebuiltRelations.has(relation.id)) {
                    rebuiltRelations.set(relation.id, mergeRelationRecords(rebuiltRelations.get(relation.id), relation));
                } else {
                    rebuiltRelations.set(relation.id, relation);
                }
            }
            relationCache.clear();
            for (const [id, relation] of rebuiltRelations.entries()) {
                relationCache.set(id, relation);
            }
        };
        const pruneEntitiesForReanalysis = (conversationText = '', extractedEntities = [], lorebook = []) => {
            const transcript = String(conversationText || '').trim();
            const extractedSet = new Set(
                (Array.isArray(extractedEntities) ? extractedEntities : [])
                    .map(entity => resolveCanonicalName(entity?.name || '', lorebook))
                    .filter(Boolean)
            );
            const removedNames = [];
            for (const [name, entity] of Array.from(entityCache.entries())) {
                if (entity?.meta?.manualLocked || entity?.meta?.nameManualLocked || isEntityAbsorptionPending(entity)) continue;
                if (extractedSet.has(name)) continue;
                if (transcript && mentionsEntity(transcript, entity)) continue;
                entityCache.delete(name);
                removedNames.push(name);
            }
            if (removedNames.length === 0) return removedNames;
            for (const [relationId, relation] of Array.from(relationCache.entries())) {
                const relationA = resolveCanonicalName(relation?.entityA || '', lorebook);
                const relationB = resolveCanonicalName(relation?.entityB || '', lorebook);
                if (removedNames.includes(relationA) || removedNames.includes(relationB)) {
                    relationCache.delete(relationId);
                }
            }
            return removedNames;
        };
        const pruneBlockedEntries = (lorebook = []) => {
            const removedNames = [];
            for (const [name] of Array.from(entityCache.entries())) {
                if (!isBlockedEntityName(name, lorebook)) continue;
                entityCache.delete(name);
                removedNames.push(name);
            }
            if (removedNames.length > 0) {
                for (const [relationId, relation] of Array.from(relationCache.entries())) {
                    const relationA = resolveCanonicalName(relation?.entityA || '', lorebook);
                    const relationB = resolveCanonicalName(relation?.entityB || '', lorebook);
                    if (removedNames.includes(relationA) || removedNames.includes(relationB) || isBlockedEntityName(relationA, lorebook) || isBlockedEntityName(relationB, lorebook)) {
                        relationCache.delete(relationId);
                    }
                }
            }
            return removedNames;
        };

        const mergeRelationRecords = (baseRelation, incomingRelation) => {
            if (!baseRelation) return incomingRelation;
            if (!incomingRelation) return baseRelation;
            normalizeRelationV2Fields(baseRelation);
            normalizeRelationV2Fields(incomingRelation);
            if (!baseRelation.relationType && incomingRelation.relationType) baseRelation.relationType = incomingRelation.relationType;
            baseRelation.details = baseRelation.details || {};
            incomingRelation.details = incomingRelation.details || {};
            if (!baseRelation.details.howMet && incomingRelation.details.howMet) baseRelation.details.howMet = incomingRelation.details.howMet;
            if (!baseRelation.details.duration && incomingRelation.details.duration) baseRelation.details.duration = incomingRelation.details.duration;
            baseRelation.details.closeness = mergeNullableRelationScore(baseRelation.details.closeness, incomingRelation.details.closeness);
            baseRelation.details.trust = mergeNullableRelationScore(baseRelation.details.trust, incomingRelation.details.trust);
            const mergedEvents = [...(baseRelation.details.events || []), ...(incomingRelation.details.events || [])];
            baseRelation.details.events = mergedEvents.slice(-12);
            baseRelation.sentiments = baseRelation.sentiments || {};
            incomingRelation.sentiments = incomingRelation.sentiments || {};
            if (!baseRelation.sentiments.fromAtoB && incomingRelation.sentiments.fromAtoB) baseRelation.sentiments.fromAtoB = incomingRelation.sentiments.fromAtoB;
            if (!baseRelation.sentiments.fromBtoA && incomingRelation.sentiments.fromBtoA) baseRelation.sentiments.fromBtoA = incomingRelation.sentiments.fromBtoA;
            baseRelation.sentiments.currentTension = Math.max(Number(baseRelation.sentiments.currentTension || 0), Number(incomingRelation.sentiments.currentTension || 0));
            baseRelation.sentiments.lastInteraction = Math.max(Number(baseRelation.sentiments.lastInteraction || 0), Number(incomingRelation.sentiments.lastInteraction || 0));
            baseRelation.meta = baseRelation.meta || {};
            incomingRelation.meta = incomingRelation.meta || {};
            baseRelation.meta.created = Math.min(
                normalizeFiniteNumber(baseRelation.meta.created, Infinity),
                normalizeFiniteNumber(incomingRelation.meta.created, Infinity)
            );
            if (!Number.isFinite(baseRelation.meta.created)) baseRelation.meta.created = 0;
            baseRelation.meta.updated = Math.max(
                normalizeFiniteNumber(baseRelation.meta.updated, 0),
                normalizeFiniteNumber(incomingRelation.meta.updated, 0)
            );
            baseRelation.meta.confidence = Math.max(
                normalizeFiniteNumber(baseRelation.meta.confidence, 0),
                normalizeFiniteNumber(incomingRelation.meta.confidence, 0)
            );
            baseRelation.relationshipAssessment = buildRelationshipAssessment({
                ...baseRelation,
                relationshipAssessment: {
                    ...(baseRelation.relationshipAssessment || {}),
                    ...(incomingRelation.relationshipAssessment || {}),
                    evidenceCount: Math.max(
                        Number(baseRelation.relationshipAssessment?.evidenceCount || 0),
                        Number(incomingRelation.relationshipAssessment?.evidenceCount || 0),
                        getRelationEvidenceCount(baseRelation)
                    )
                }
            });
            harmonizeRelationMetrics(baseRelation);
            return mergeRelationV2Fields(baseRelation, incomingRelation, {
                sourceMode: incomingRelation.meta?.source || baseRelation.meta?.source || 'merge'
            });
        };

        const buildEntityMentionRegex = (name) => {
            const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const latinName = /^[a-z0-9 .'-]+$/i.test(name);
            if (latinName) {
                return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
            }
            return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?:[이가은는을를와과랑이랑도의께님씨아야]|\\s|$|[.,!?])`, 'iu');
        };

        const mentionsEntity = (text, entityOrName) => {
            const rawText = String(text || '').trim();
            const entity = typeof entityOrName === 'string' ? { name: entityOrName } : (entityOrName || {});
            const candidates = extractEntityAliases(entity)
                .map(alias => normalizeBaseName(alias))
                .filter(alias => alias && alias.length >= 2);
            if (!rawText || candidates.length === 0) return false;

            const tokenSet = new Set(
                TokenizerEngine.tokenize(rawText)
                    .map(token => String(token || '').toLowerCase())
                    .filter(Boolean)
            );
            const compactText = rawText.toLowerCase().replace(/\s+/g, '');

            for (const candidate of candidates) {
                const loweredName = candidate.toLowerCase();
                if (tokenSet.has(loweredName)) return true;
                const compactName = loweredName.replace(/\s+/g, '');
                if (compactName.length >= 2 && compactText.includes(compactName)) {
                    if (buildEntityMentionRegex(candidate).test(rawText)) return true;
                }
                if (buildEntityMentionRegex(candidate).test(rawText)) return true;
            }

            return false;
        };

        const sanitizeEntityPersonalityFields = (personality) => {
            const source = personality && typeof personality === 'object' ? personality : {};
            const sexualOrientationKeywords = [
                '개방적', '보수적', '순결주의', '문란함', '금욕적',
                '이성애', '동성애', '양성애', '무성애', '범성애',
                'open-minded', 'conservative', 'chaste', 'prudish', 'sex-positive',
                'heterosexual', 'straight', 'homosexual', 'gay', 'lesbian', 'bisexual', 'asexual', 'pansexual'
            ];
            const sexualPreferenceKeywords = [
                's성향', 'm성향', '리버스', 'switch', 'dominant', 'submissive', 'dom', 'sub',
                'sadist', 'masochist', 'voyeur', 'exhibitionist', '페티시', 'fetish', 'kink'
            ];
            const matchesKeyword = (value, keywords) => {
                const text = String(value || '').trim().toLowerCase();
                if (!text) return false;
                return keywords.some(keyword => text === keyword || text.includes(keyword));
            };
            const sexualOrientationPatterns = [
                /sexual attitudes?\s*[:\-]\s*([^.;\n]+)/i,
                /sexual orientation\s*[:\-]\s*([^.;\n]+)/i,
                /성관념\s*[:\-]\s*([^.;\n]+)/i
            ];
            const sexualPreferencePatterns = [
                /sexual preferences?\s*[:\-]\s*([^.;\n]+)/i,
                /sexual preference\s*[:\-]\s*([^.;\n]+)/i,
                /성적취향\s*[:\-]\s*([^.;\n]+)/i
            ];
            const fragmentPatterns = [
                /sexual attitudes?\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /sexual orientation\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /성관념\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /sexual preferences?\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /sexual preference\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /성적취향\s*[:\-]\s*[^.;\n]+[.;]?/gi
            ];

            const traitValues = Array.isArray(source.traits) ? source.traits : [];
            const explicitOrientation = typeof source.sexualOrientation === 'string' ? source.sexualOrientation.trim() : (typeof source.sexualAttitude === 'string' ? source.sexualAttitude.trim() : '');
            const explicitPreferences = Array.isArray(source.sexualPreferences)
                ? dedupeTextArray(source.sexualPreferences.map(String).map(v => v.trim()).filter(Boolean))
                : [];

            let parsedOrientation = explicitOrientation;
            const parsedPreferences = [...explicitPreferences];
            const cleanedTraits = [];

            for (const trait of traitValues.map(String).map(v => v.trim()).filter(Boolean)) {
                if (!parsedOrientation) {
                    parsedOrientation = pickLatestExplicitField(trait, sexualOrientationPatterns) || parsedOrientation;
                }
                const extractedPrefs = normalizeDelimitedList(pickLatestExplicitField(trait, sexualPreferencePatterns));
                if (extractedPrefs.length > 0) {
                    parsedPreferences.push(...extractedPrefs);
                }
                const cleanedTrait = stripLabeledFragments(trait, fragmentPatterns);
                if (!cleanedTrait) continue;
                if (!parsedOrientation && matchesKeyword(cleanedTrait, sexualOrientationKeywords)) {
                    parsedOrientation = cleanedTrait;
                    continue;
                }
                if (matchesKeyword(cleanedTrait, sexualPreferenceKeywords)) {
                    parsedPreferences.push(cleanedTrait);
                    continue;
                }
                cleanedTraits.push(cleanedTrait);
            }

            return {
                cleanedTraits: normalizeEntityTraitList(cleanedTraits, 18, 180),
                sexualOrientation: parsedOrientation || '',
                sexualPreferences: dedupeTextArray(parsedPreferences)
            };
        };

        const normalizeEntityShape = (entity) => {
            if (!entity || typeof entity !== 'object') return entity;
            entity.meta = entity.meta || {};
            entity.meta.aliases = Array.isArray(entity.meta.aliases) ? entity.meta.aliases : [];
            entity.meta.hiddenNameKeys = Array.isArray(entity.meta.hiddenNameKeys) ? entity.meta.hiddenNameKeys : [];
            entity.sex = normalizeBiologicalSex(entity.sex || entity.biologicalSex || '');
            if (Object.prototype.hasOwnProperty.call(entity, 'biologicalSex')) delete entity.biologicalSex;
            entity.appearance = entity.appearance || {};
            entity.appearance.features = Array.isArray(entity.appearance.features) ? entity.appearance.features : [];
            entity.appearance.distinctiveMarks = Array.isArray(entity.appearance.distinctiveMarks) ? entity.appearance.distinctiveMarks : [];
            entity.appearance.clothing = Array.isArray(entity.appearance.clothing) ? entity.appearance.clothing : [];
            entity.personality = entity.personality || {};
            entity.personality.traits = Array.isArray(entity.personality.traits) ? entity.personality.traits : [];
            entity.personality.values = Array.isArray(entity.personality.values) ? entity.personality.values : [];
            entity.personality.fears = Array.isArray(entity.personality.fears) ? entity.personality.fears : [];
            entity.personality.likes = Array.isArray(entity.personality.likes) ? entity.personality.likes : [];
            entity.personality.dislikes = Array.isArray(entity.personality.dislikes) ? entity.personality.dislikes : [];
            entity.personality.sexualPreferences = Array.isArray(entity.personality.sexualPreferences) ? entity.personality.sexualPreferences : [];
            entity.personality.sexualOrientation = typeof entity.personality.sexualOrientation === 'string' ? entity.personality.sexualOrientation : '';
            const sanitizedPersonality = sanitizeEntityPersonalityFields(entity.personality);
            entity.personality.traits = sanitizedPersonality.cleanedTraits;
            entity.personality.sexualOrientation = sanitizedPersonality.sexualOrientation || entity.personality.sexualOrientation;
            entity.personality.sexualPreferences = sanitizedPersonality.sexualPreferences;
            entity.speechStyle = normalizeSpeechStyleObject(entity.speechStyle);
            entity.background = entity.background || {};
            entity.background.origin = typeof entity.background.origin === 'string' ? entity.background.origin : '';
            entity.background.occupation = typeof entity.background.occupation === 'string' ? entity.background.occupation : '';
            entity.background.history = Array.isArray(entity.background.history) ? entity.background.history : [];
            entity.background.secrets = Array.isArray(entity.background.secrets) ? entity.background.secrets : [];
            entity.status = entity.status || {};
            entity.status.currentLocation = typeof entity.status.currentLocation === 'string' ? entity.status.currentLocation : '';
            entity.status.currentMood = typeof entity.status.currentMood === 'string' ? entity.status.currentMood : '';
            entity.status.healthStatus = typeof entity.status.healthStatus === 'string' ? entity.status.healthStatus : '';
            entity.status.currentDate = typeof entity.status.currentDate === 'string' ? entity.status.currentDate : '';
            entity.status.currentTime = typeof entity.status.currentTime === 'string' ? entity.status.currentTime : '';
            entity.status.notes = typeof entity.status.notes === 'string' ? entity.status.notes : '';
            entity.status.lastUpdated = Number.isFinite(Number(entity.status.lastUpdated)) ? Number(entity.status.lastUpdated) : 0;
            entity.timeTracking = normalizeEntityTimeTracking(entity.timeTracking, entity);
            return normalizeEntityV2Fields(entity);
        };

        const getOrCreateEntity = (name, lorebook) => {
            const normalizedName = resolveCanonicalName(name, lorebook);
            if (!normalizedName) return null;
            if (isBlockedEntityName(normalizedName, lorebook) || isBlockedEntityName(name, lorebook)) return null;

            if (entityCache.has(normalizedName)) return entityCache.get(normalizedName);

            const existing = lorebook.find(e => {
                if (e.comment !== ENTITY_COMMENT) return false;
                try {
                    const parsed = JSON.parse(e.content || '{}');
                    return resolveCanonicalName(parsed.name || '', lorebook) === normalizedName;
                } catch {
                    return false;
                }
            });
            if (existing) {
                try {
                    const profile = normalizeEntityShape(JSON.parse(existing.content));
                    profile.meta = profile.meta || { created: 0, updated: 0, confidence: 0.5, source: '' };
                    if (!Array.isArray(profile.meta.m_ids) && profile.meta.m_id) profile.meta.m_ids = [profile.meta.m_id];
                    profile.meta.aliases = Array.isArray(profile.meta.aliases) ? profile.meta.aliases : [];
                    profile.meta.hiddenNameKeys = Array.isArray(profile.meta.hiddenNameKeys) ? profile.meta.hiddenNameKeys : [];
                    extractNameVariantParts(name).forEach(alias => {
                        if (alias && alias !== normalizedName && !profile.meta.aliases.includes(alias)) {
                            profile.meta.aliases.push(alias);
                        }
                    });
                    buildHiddenNameKeys(name).forEach(key => {
                        if (key && !profile.meta.hiddenNameKeys.includes(key)) {
                            profile.meta.hiddenNameKeys.push(key);
                        }
                    });
                    try {
                        const legacyTracking = normalizeEntityTimeTracking(profile.timeTracking, profile);
                        if (Object.values(legacyTracking).some(Boolean)) {
                            TimeEngine.ingestEntityTracking(profile.name || normalizedName, legacyTracking, profile);
                        }
                        const projection = TimeEngine.projectEntity(profile);
                        if (projection?.currentDate) profile.status.currentDate = projection.currentDate;
                        if (projection?.currentTime) profile.status.currentTime = projection.currentTime;
                    } catch (e) {
                        if (MemoryEngine.CONFIG?.debug) console.warn('[LIBRA] TimeEngine entity bootstrap skipped:', e?.message);
                    }
                    entityCache.set(normalizedName, profile);
                    return profile;
                } catch {}
            }

            const newEntity = {
                id: TokenizerEngine.simpleHash(normalizedName),
                name: normalizedName,
                type: 'character',
                sex: '',
                appearance: { features: [], distinctiveMarks: [], clothing: [] },
                personality: { traits: [], values: [], fears: [], likes: [], dislikes: [], sexualOrientation: '', sexualPreferences: [] },
                speechStyle: { defaultTone: '', honorificStyle: '', toSuperiors: '', toSubordinates: '', toPeers: '', toYounger: '', notes: [] },
                background: { origin: '', occupation: '', history: [], secrets: [] },
                status: { currentLocation: '', currentMood: '', healthStatus: '', currentDate: '', currentTime: '', notes: '', lastUpdated: 0 },
                identity: { age: '', sex: '', occupation: '', affiliation: '', roleInStory: '', summary: '', aliases: [], honorifics: [], source: null },
                profile: {
                    appearance: { features: [], distinctiveMarks: [], clothing: [], confidence: 0 },
                    personality: { traits: [], values: [], fears: [], likes: [], dislikes: [], vulnerabilities: [], boundaries: [], workStyle: '', socialStyle: '', confidence: 0 },
                    speechStyle: { defaultTone: '', honorificStyle: '', pressureMarkers: [], intimacyShift: '', catchphrases: [], notes: [] },
                    psychology: { baseline: '', currentConflict: '', copingStyle: '', notes: [], confidence: 0 }
                },
                currentState: { summary: '', sceneTime: '', location: '', physicalState: [], emotionalState: [], cognitiveFocus: [], immediateGoal: '', activeProblems: [], lastObservedTurn: 0 },
                continuity: { openThreads: [], unresolvedNeeds: [], commitments: [], nextActionHints: [] },
                povKnowledge: { knownToSelf: [], unknownToSelf: [], knownToOthers: [], visibleTo: [], privateExperiences: [], privacy: '' },
                episodeLedger: [],
                stateTimeline: [],
                evidence: [],
                quality: { confidence: 0.5, salience: 0, importance: 0, pressure: 0, lastUpdatedTurn: 0, sourceMix: [], staleness: '', needsReview: false },
                meta: {
                    created: MemoryState.currentTurn,
                    updated: 0,
                    confidence: 0.5,
                    source: '',
                    aliases: Array.from(new Set(extractNameVariantParts(name).filter(alias => alias && alias !== normalizedName))),
                    hiddenNameKeys: buildHiddenNameKeys(name)
                }
            };

            entityCache.set(normalizedName, newEntity);
            return newEntity;
        };

        const hasEntityRecordForRelationEndpoint = (name, lorebook = []) => {
            const normalizedName = resolveCanonicalName(name, lorebook);
            if (!normalizedName) return false;
            if (entityCache.has(normalizedName)) return true;
            return collectKnownEntities(lorebook).some(entity => {
                const entityName = resolveCanonicalName(entity?.name || '', lorebook);
                return entityName === normalizedName;
            });
        };

        const getOrCreateRelation = (nameA, nameB, lorebook) => {
            const normalizedA = resolveCanonicalName(nameA, lorebook);
            const normalizedB = resolveCanonicalName(nameB, lorebook);
            if (!normalizedA || !normalizedB || normalizedA === normalizedB) return null;
            if (isBlockedEntityName(normalizedA, lorebook) || isBlockedEntityName(normalizedB, lorebook) || isBlockedEntityName(nameA, lorebook) || isBlockedEntityName(nameB, lorebook)) return null;
            if (!hasEntityRecordForRelationEndpoint(normalizedA, lorebook) || !hasEntityRecordForRelationEndpoint(normalizedB, lorebook)) return null;

            const relationId = makeRelationId(normalizedA, normalizedB, lorebook);
            if (relationCache.has(relationId)) return relationCache.get(relationId);

            const existing = lorebook.find(e => {
                if (e.comment !== RELATION_COMMENT) return false;
                try {
                    const parsed = JSON.parse(e.content || '{}');
                    const parsedA = resolveCanonicalName(parsed.entityA || '', lorebook);
                    const parsedB = resolveCanonicalName(parsed.entityB || '', lorebook);
                    const parsedId = makeRelationId(parsedA || parsed.entityA || '', parsedB || parsed.entityB || '', lorebook);
                    return parsedId === relationId;
                } catch {
                    return false;
                }
            });
            if (existing) {
                try {
                    const relation = JSON.parse(existing.content);
                    relation.meta = relation.meta || { created: 0, updated: 0, confidence: 0.3, source: '' };
                    if (!Array.isArray(relation.meta.m_ids) && relation.meta.m_id) relation.meta.m_ids = [relation.meta.m_id];
                    normalizeRelationV2Fields(relation);
                    relationCache.set(relationId, relation);
                    return relation;
                } catch {}
            }

            const newRelation = {
                id: relationId,
                entityA: normalizedA,
                entityB: normalizedB,
                relationType: '첫 대면',
                details: { howMet: '', duration: '', closeness: null, trust: null, events: [] },
                sentiments: { fromAtoB: '', fromBtoA: '', currentTension: 0, lastInteraction: MemoryState.currentTurn },
                currentStatus: { summary: '', publicLayer: '', privateLayer: '', boundaryState: '', lastChangedTurn: 0 },
                metrics: { closeness: null, trust: null, tension: 0, risk: 0, ambiguity: 0.65, pressure: 0 },
                dynamics: { fromAtoB: [], fromBtoA: [], unresolvedIssues: [], recentChanges: [] },
                sharedContext: { location: '', workplace: '', privateThreads: [], notes: [] },
                eventLedger: [],
                evidence: [],
                quality: { confidence: 0.3, salience: 0, importance: 0, pressure: 0, lastUpdatedTurn: 0, sourceMix: [], staleness: '', needsReview: false },
                relationshipAssessment: { stage: 'first_contact', definitionConfidence: 0.08, evidenceCount: 0, label: '첫 대면 · 정의 보류', note: '관계를 정의하기에는 근거가 부족함', inferred: true },
                meta: { created: MemoryState.currentTurn, updated: 0, confidence: 0.3 }
            };

            relationCache.set(relationId, newRelation);
            return newRelation;
        };

        const makeRenameNameKeys = (values = []) => {
            const keys = new Set();
            const add = (value = '') => {
                const raw = String(value || '').trim();
                if (!raw) return;
                [
                    raw,
                    normalizeCanonicalDisplayName(raw),
                    normalizeBaseName(raw),
                    ...buildAliasCandidates(raw, true),
                    ...buildHiddenNameKeys(raw)
                ].filter(Boolean).forEach(item => {
                    const normalized = String(item || '').trim().toLowerCase();
                    if (!normalized) return;
                    keys.add(normalized);
                    keys.add(normalized.replace(/\s+/g, ''));
                });
            };
            (Array.isArray(values) ? values : [values]).forEach(add);
            return keys;
        };
        const renameNameMatches = (value = '', keySet = new Set()) => {
            if (!keySet || keySet.size === 0) return false;
            const probe = makeRenameNameKeys([value]);
            for (const key of probe) {
                if (keySet.has(key)) return true;
            }
            return false;
        };
        const filterAliasesForRename = (aliases = [], oldNameKeys = new Set(), keepOldNameAsAlias = false) => {
            const out = [];
            for (const alias of Array.isArray(aliases) ? aliases : []) {
                const text = String(alias || '').trim();
                if (!text) continue;
                const oldAlias = renameNameMatches(text, oldNameKeys);
                if (!keepOldNameAsAlias && oldAlias) continue;
                if (!keepOldNameAsAlias && isGenericRoleAliasName(text)) continue;
                if (!out.includes(text)) out.push(text);
            }
            return out;
        };
        const makeEntityAbsorptionId = (sourceName = '', targetName = '') => {
            const source = normalizeCanonicalDisplayName(sourceName || '');
            const target = normalizeCanonicalDisplayName(targetName || '');
            return `lmai_absorb_${stableHash(`${source}=>${target}`)}`;
        };
        const getEntityRecordFromLore = (canonicalName = '', lorebook = []) => {
            const normalized = normalizeCanonicalDisplayName(canonicalName || '');
            if (!normalized) return null;
            const cached = entityCache.get(normalized);
            if (cached) return cached;
            for (const entry of LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])) {
                if (entry?.comment !== ENTITY_COMMENT) continue;
                try {
                    const parsed = normalizeEntityShape(JSON.parse(entry.content || '{}'));
                    const parsedName = resolveCanonicalName(parsed?.name || '', lorebook) || normalizeCanonicalDisplayName(parsed?.name || '');
                    if (parsedName === normalized) return parsed;
                } catch {
                    // Invalid entity entries are ignored by the normal rebuild path too.
                }
            }
            return null;
        };
        const normalizeEntityAbsorptionTask = (task = {}, lorebook = []) => {
            const sourceInput = String(task?.sourceName || task?.source || task?.oldName || '').trim();
            const targetInput = String(task?.targetName || task?.target || task?.newName || '').trim();
            const sourceName = resolveCanonicalName(sourceInput, lorebook) || normalizeCanonicalDisplayName(sourceInput);
            const targetName = resolveCanonicalName(targetInput, lorebook) || normalizeCanonicalDisplayName(targetInput);
            if (!sourceName || !targetName || sourceName === targetName) return null;
            const status = normalizeEntityAbsorptionStatus(task?.status) || 'pending';
            const id = String(task?.id || makeEntityAbsorptionId(sourceName, targetName)).trim();
            return {
                schema: ENTITY_ABSORPTION_SCHEMA,
                id,
                status,
                sourceName,
                targetName,
                sourceOriginalName: String(task?.sourceOriginalName || sourceInput || sourceName).trim(),
                reason: clampEntityText(task?.reason || '', 220),
                requestedAt: normalizeFiniteNumber(task?.requestedAt, Date.now()),
                requestedTurn: normalizeFiniteNumber(task?.requestedTurn, MemoryState.currentTurn || 0),
                appliedAt: normalizeFiniteNumber(task?.appliedAt, 0),
                appliedTurn: normalizeFiniteNumber(task?.appliedTurn, 0),
                cancelledAt: normalizeFiniteNumber(task?.cancelledAt, 0),
                cancelledTurn: normalizeFiniteNumber(task?.cancelledTurn, 0),
                confidence: normalizeEntity01(task?.confidence, 0),
                sourceSnapshot: task?.sourceSnapshot && typeof task.sourceSnapshot === 'object' ? task.sourceSnapshot : null,
                relationSnapshot: Array.isArray(task?.relationSnapshot) ? task.relationSnapshot.slice(0, 16) : [],
                reviewNotes: normalizeEntityList(task?.reviewNotes || [], 8, 220),
                conflicts: normalizeEntityList(task?.conflicts || [], 8, 220)
            };
        };
        const parseEntityAbsorptionTaskEntry = (entry = null, lorebook = []) => {
            if (!entry || entry.comment !== ENTITY_ABSORPTION_COMMENT) return null;
            try {
                return normalizeEntityAbsorptionTask(JSON.parse(entry.content || '{}'), lorebook);
            } catch {
                return null;
            }
        };
        const listEntityAbsorptions = (lorebook = [], options = {}) => {
            const statuses = Array.isArray(options.statuses)
                ? new Set(options.statuses.map(normalizeEntityAbsorptionStatus).filter(Boolean))
                : null;
            const tasks = [];
            for (const entry of LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])) {
                const task = parseEntityAbsorptionTaskEntry(entry, lorebook);
                if (!task) continue;
                if (statuses && !statuses.has(task.status)) continue;
                tasks.push(task);
            }
            if (options.includeEntityMeta !== false) {
                for (const entity of collectKnownEntities(lorebook)) {
                    const meta = getEntityAbsorptionMeta(entity);
                    if (!meta) continue;
                    const task = normalizeEntityAbsorptionTask({
                        ...meta,
                        sourceName: meta.sourceName || entity.name,
                        sourceOriginalName: meta.sourceOriginalName || entity.name
                    }, lorebook);
                    if (!task) continue;
                    if (statuses && !statuses.has(task.status)) continue;
                    if (!tasks.some(existing => existing.id === task.id)) tasks.push(task);
                }
            }
            return tasks;
        };
        const listPendingEntityAbsorptions = (lorebook = [], options = {}) => listEntityAbsorptions(lorebook, {
            ...options,
            statuses: ['pending']
        });
        const upsertEntityAbsorptionTask = (lorebook = [], task = {}) => {
            if (!Array.isArray(lorebook)) return null;
            const normalizedTask = normalizeEntityAbsorptionTask(task, lorebook);
            if (!normalizedTask) return null;
            const entry = {
                key: `lmai_entity_absorption::${normalizedTask.id}`,
                comment: ENTITY_ABSORPTION_COMMENT,
                content: JSON.stringify(normalizedTask, null, 2),
                mode: 'normal',
                insertorder: 55,
                alwaysActive: false
            };
            const existingIdx = lorebook.findIndex(item => {
                if (item?.comment !== ENTITY_ABSORPTION_COMMENT) return false;
                const parsed = parseEntityAbsorptionTaskEntry(item, lorebook);
                return parsed?.id === normalizedTask.id;
            });
            if (existingIdx >= 0) lorebook[existingIdx] = entry;
            else lorebook.push(entry);
            return normalizedTask;
        };
        const filterAliasesForAbsorption = (aliases = [], sourceNameKeys = new Set(), targetName = '') => {
            const target = normalizeCanonicalDisplayName(targetName || '');
            const out = [];
            for (const alias of Array.isArray(aliases) ? aliases : []) {
                const text = String(alias || '').trim();
                if (!text) continue;
                if (target && normalizeCanonicalDisplayName(text) === target) continue;
                if (renameNameMatches(text, sourceNameKeys)) continue;
                if (isGenericRoleAliasName(text)) continue;
                if (!out.includes(text)) out.push(text);
            }
            return out;
        };
        const sanitizeAbsorptionMergeEntity = (entity = {}, targetName = '', sourceNameKeys = new Set()) => {
            const sanitized = safeClone(entity && typeof entity === 'object' ? entity : {});
            sanitized.name = normalizeCanonicalDisplayName(targetName || sanitized.name || '');
            sanitized.meta = sanitized.meta && typeof sanitized.meta === 'object' ? sanitized.meta : {};
            delete sanitized.meta.absorption;
            sanitized.meta.aliases = filterAliasesForAbsorption(sanitized.meta.aliases, sourceNameKeys, sanitized.name);
            sanitized.meta.hiddenNameKeys = Array.isArray(sanitized.meta.hiddenNameKeys)
                ? sanitized.meta.hiddenNameKeys.filter(key => !renameNameMatches(key, sourceNameKeys) && !isGenericRoleAliasName(key))
                : [];
            if (sanitized.identity && typeof sanitized.identity === 'object') {
                sanitized.identity.aliases = filterAliasesForAbsorption(sanitized.identity.aliases, sourceNameKeys, sanitized.name);
            }
            return normalizeEntityShape(sanitized);
        };
        const rewriteRelationsForAbsorption = (sourceNameKeys = new Set(), targetName = '', lorebook = []) => {
            const target = normalizeCanonicalDisplayName(targetName || '');
            if (!target) return { changed: false, rewired: 0, dropped: 0 };
            const rebuiltRelations = new Map();
            let rewired = 0;
            let dropped = 0;
            for (const relation of relationCache.values()) {
                if (!relation || typeof relation !== 'object') continue;
                const nextRelation = safeClone(relation);
                const originalA = String(nextRelation.entityA || '').trim();
                const originalB = String(nextRelation.entityB || '').trim();
                nextRelation.entityA = renameNameMatches(originalA, sourceNameKeys)
                    ? target
                    : (resolveCanonicalName(originalA, lorebook) || originalA);
                nextRelation.entityB = renameNameMatches(originalB, sourceNameKeys)
                    ? target
                    : (resolveCanonicalName(originalB, lorebook) || originalB);
                if (nextRelation.entityA !== originalA || nextRelation.entityB !== originalB) rewired += 1;
                if (!nextRelation.entityA || !nextRelation.entityB || nextRelation.entityA === nextRelation.entityB) {
                    dropped += 1;
                    continue;
                }
                nextRelation.id = makeRelationId(nextRelation.entityA, nextRelation.entityB, lorebook);
                normalizeRelationV2Fields(nextRelation);
                if (rebuiltRelations.has(nextRelation.id)) {
                    rebuiltRelations.set(nextRelation.id, mergeRelationRecords(rebuiltRelations.get(nextRelation.id), nextRelation));
                } else {
                    rebuiltRelations.set(nextRelation.id, nextRelation);
                }
            }
            relationCache.clear();
            for (const [id, relation] of rebuiltRelations.entries()) {
                relationCache.set(id, relation);
            }
            return { changed: rewired > 0 || dropped > 0, rewired, dropped };
        };
        const renameEntity = (oldName = '', newName = '', lorebook = [], options = {}) => {
            const oldInput = normalizeCanonicalDisplayName(oldName || '');
            const newCanonical = normalizeCanonicalDisplayName(newName || '');
            if (!oldInput || !newCanonical) return { ok: false, reason: 'empty_name' };
            if (isBlockedEntityName(newCanonical, lorebook)) return { ok: false, reason: 'blocked_new_name', oldName: oldInput, newName: newCanonical };
            const oldCanonical = resolveCanonicalName(oldInput, lorebook) || oldInput;
            if (!oldCanonical) return { ok: false, reason: 'missing_old_name', oldName: oldInput, newName: newCanonical };
            if (oldCanonical === newCanonical) return { ok: false, reason: 'same_name', oldName: oldCanonical, newName: newCanonical };

            let sourceEntity = entityCache.get(oldCanonical);
            if (!sourceEntity) {
                const existingEntry = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : []).find(entry => {
                    if (entry?.comment !== ENTITY_COMMENT) return false;
                    try {
                        const parsed = JSON.parse(entry.content || '{}');
                        return resolveCanonicalName(parsed.name || '', lorebook) === oldCanonical;
                    } catch {
                        return false;
                    }
                });
                if (existingEntry) {
                    try {
                        sourceEntity = normalizeEntityShape(JSON.parse(existingEntry.content || '{}'));
                    } catch {
                        sourceEntity = null;
                    }
                }
            }
            if (!sourceEntity) return { ok: false, reason: 'entity_not_found', oldName: oldCanonical, newName: newCanonical };

            const previousNames = dedupeTextArray([
                oldInput,
                oldCanonical,
                sourceEntity.name || '',
                normalizeBaseName(oldInput),
                normalizeBaseName(oldCanonical),
                normalizeBaseName(sourceEntity.name || '')
            ].filter(Boolean));
            const oldNameKeys = makeRenameNameKeys(previousNames);
            const keepOldNameAsAlias = shouldKeepOldNameAsAliasForRename(oldInput || oldCanonical, options);
            const now = Date.now();
            const sourceForMerge = safeClone(sourceEntity);
            sourceForMerge.name = newCanonical;
            sourceForMerge.meta = sourceForMerge.meta || {};
            sourceForMerge.meta.aliases = filterAliasesForRename(sourceForMerge.meta.aliases, oldNameKeys, keepOldNameAsAlias);
            sourceForMerge.meta.hiddenNameKeys = Array.isArray(sourceForMerge.meta.hiddenNameKeys) ? sourceForMerge.meta.hiddenNameKeys : [];
            if (!keepOldNameAsAlias) {
                sourceForMerge.meta.hiddenNameKeys = sourceForMerge.meta.hiddenNameKeys.filter(key => !renameNameMatches(key, oldNameKeys));
            }
            if (keepOldNameAsAlias) {
                previousNames.forEach(alias => {
                    if (alias && alias !== newCanonical && !sourceForMerge.meta.aliases.includes(alias)) sourceForMerge.meta.aliases.push(alias);
                });
                previousNames.flatMap(name => buildHiddenNameKeys(name)).forEach(key => {
                    if (key && !sourceForMerge.meta.hiddenNameKeys.includes(key)) sourceForMerge.meta.hiddenNameKeys.push(key);
                });
            }
            if (!sourceForMerge.meta.aliases.includes(newCanonical)) sourceForMerge.meta.aliases.push(newCanonical);
            buildHiddenNameKeys(newCanonical).forEach(key => {
                if (key && !sourceForMerge.meta.hiddenNameKeys.includes(key)) sourceForMerge.meta.hiddenNameKeys.push(key);
            });
            sourceForMerge.meta.nameManualLocked = true;
            sourceForMerge.meta.nameManualLockedAt = now;
            sourceForMerge.meta.nameHistory = normalizeEntityList([
                ...(Array.isArray(sourceForMerge.meta.nameHistory) ? sourceForMerge.meta.nameHistory : []),
                `${oldCanonical} -> ${newCanonical} @T${MemoryState.currentTurn || 0}`
            ], 24, 180);
            sourceForMerge.meta.updated = MemoryState.currentTurn;
            sourceForMerge.meta.source = options.source || 'gui_rename';
            if (sourceForMerge.identity && typeof sourceForMerge.identity === 'object') {
                sourceForMerge.identity.aliases = sourceForMerge.meta.aliases.slice(0, 24);
            }
            normalizeEntityV2Fields(sourceForMerge);

            const existingNew = entityCache.get(newCanonical);
            let renamedEntity = sourceForMerge;
            if (existingNew && existingNew !== sourceEntity) {
                renamedEntity = mergeEntityRecords(safeClone(existingNew), sourceForMerge);
                renamedEntity.name = newCanonical;
                renamedEntity.meta = renamedEntity.meta || {};
                renamedEntity.meta.nameManualLocked = true;
                renamedEntity.meta.nameManualLockedAt = Math.max(normalizeFiniteNumber(renamedEntity.meta.nameManualLockedAt, 0), now);
                renamedEntity.meta.source = options.source || 'gui_rename_merge';
                renamedEntity.meta.aliases = filterAliasesForRename(renamedEntity.meta.aliases, oldNameKeys, keepOldNameAsAlias);
                if (keepOldNameAsAlias) {
                    previousNames.forEach(alias => {
                        if (alias && alias !== newCanonical && !renamedEntity.meta.aliases.includes(alias)) renamedEntity.meta.aliases.push(alias);
                    });
                }
                normalizeEntityV2Fields(renamedEntity);
            }

            if (entityCache.has(oldCanonical)) entityCache.delete(oldCanonical);
            entityCache.set(newCanonical, renamedEntity);

            const rebuiltRelations = new Map();
            for (const relation of relationCache.values()) {
                if (!relation || typeof relation !== 'object') continue;
                const nextRelation = safeClone(relation);
                if (renameNameMatches(nextRelation.entityA, oldNameKeys)) nextRelation.entityA = newCanonical;
                else nextRelation.entityA = resolveCanonicalName(nextRelation.entityA || '', lorebook) || nextRelation.entityA || '';
                if (renameNameMatches(nextRelation.entityB, oldNameKeys)) nextRelation.entityB = newCanonical;
                else nextRelation.entityB = resolveCanonicalName(nextRelation.entityB || '', lorebook) || nextRelation.entityB || '';
                if (!nextRelation.entityA || !nextRelation.entityB || nextRelation.entityA === nextRelation.entityB) continue;
                nextRelation.id = makeRelationId(nextRelation.entityA, nextRelation.entityB, lorebook);
                if (rebuiltRelations.has(nextRelation.id)) {
                    rebuiltRelations.set(nextRelation.id, mergeRelationRecords(rebuiltRelations.get(nextRelation.id), nextRelation));
                } else {
                    rebuiltRelations.set(nextRelation.id, nextRelation);
                }
            }
            relationCache.clear();
            for (const [id, relation] of rebuiltRelations.entries()) {
                relationCache.set(id, relation);
            }

            return {
                ok: true,
                oldName: oldCanonical,
                newName: newCanonical,
                previousNames,
                aliasKept: keepOldNameAsAlias,
                entity: renamedEntity
            };
        };

        const markEntityAbsorption = (sourceName = '', targetName = '', lorebook = [], options = {}) => {
            const sourceCanonical = resolveCanonicalName(sourceName, lorebook) || normalizeCanonicalDisplayName(sourceName);
            const targetCanonical = resolveCanonicalName(targetName, lorebook) || normalizeCanonicalDisplayName(targetName);
            if (!sourceCanonical || !targetCanonical) return { ok: false, reason: 'empty_name' };
            if (sourceCanonical === targetCanonical) return { ok: false, reason: 'same_entity', sourceName: sourceCanonical, targetName: targetCanonical };
            if (isBlockedEntityName(sourceCanonical, lorebook) || isBlockedEntityName(targetCanonical, lorebook)) {
                return { ok: false, reason: 'blocked_entity', sourceName: sourceCanonical, targetName: targetCanonical };
            }
            const sourceEntity = getEntityRecordFromLore(sourceCanonical, lorebook);
            const targetEntity = getEntityRecordFromLore(targetCanonical, lorebook);
            if (!sourceEntity) return { ok: false, reason: 'source_not_found', sourceName: sourceCanonical, targetName: targetCanonical };
            if (!targetEntity) return { ok: false, reason: 'target_not_found', sourceName: sourceCanonical, targetName: targetCanonical };
            if (isEntityAbsorptionApplied(sourceEntity)) return { ok: false, reason: 'source_already_absorbed', sourceName: sourceCanonical, targetName: targetCanonical };

            const now = Date.now();
            const id = makeEntityAbsorptionId(sourceCanonical, targetCanonical);
            const relationSnapshot = Array.from(relationCache.values())
                .filter(relation => renameNameMatches(relation?.entityA || '', makeRenameNameKeys([sourceCanonical, sourceEntity?.name || '']))
                    || renameNameMatches(relation?.entityB || '', makeRenameNameKeys([sourceCanonical, sourceEntity?.name || ''])))
                .map(relation => safeClone(relation))
                .slice(0, 16);
            const task = upsertEntityAbsorptionTask(lorebook, {
                id,
                status: 'pending',
                sourceName: sourceCanonical,
                targetName: targetCanonical,
                sourceOriginalName: String(sourceName || sourceCanonical).trim(),
                reason: options.reason || '',
                requestedAt: now,
                requestedTurn: MemoryState.currentTurn || 0,
                sourceSnapshot: safeClone(sourceEntity),
                relationSnapshot,
                reviewNotes: ['manual_absorption_requested']
            });
            if (!task) return { ok: false, reason: 'task_create_failed', sourceName: sourceCanonical, targetName: targetCanonical };

            sourceEntity.meta = sourceEntity.meta || {};
            sourceEntity.meta.absorption = {
                schema: ENTITY_ABSORPTION_SCHEMA,
                id: task.id,
                status: 'pending',
                sourceName: sourceCanonical,
                targetName: targetCanonical,
                sourceOriginalName: task.sourceOriginalName,
                requestedAt: now,
                requestedTurn: MemoryState.currentTurn || 0,
                reason: task.reason || ''
            };
            sourceEntity.meta.updated = MemoryState.currentTurn || sourceEntity.meta.updated || 0;
            sourceEntity.quality = sourceEntity.quality || {};
            sourceEntity.quality.needsReview = true;

            targetEntity.meta = targetEntity.meta || {};
            targetEntity.meta.pendingAbsorptionSources = normalizeEntityList([
                ...(Array.isArray(targetEntity.meta.pendingAbsorptionSources) ? targetEntity.meta.pendingAbsorptionSources : []),
                sourceCanonical
            ], 12, 180);
            targetEntity.meta.updated = MemoryState.currentTurn || targetEntity.meta.updated || 0;

            entityCache.set(sourceCanonical, sourceEntity);
            entityCache.set(targetCanonical, targetEntity);
            return { ok: true, id: task.id, sourceName: sourceCanonical, targetName: targetCanonical, task };
        };

        const cancelEntityAbsorption = (sourceName = '', lorebook = [], options = {}) => {
            const sourceCanonical = resolveCanonicalName(sourceName, lorebook) || normalizeCanonicalDisplayName(sourceName);
            if (!sourceCanonical) return { ok: false, reason: 'empty_name' };
            const sourceEntity = getEntityRecordFromLore(sourceCanonical, lorebook);
            const absorption = getEntityAbsorptionMeta(sourceEntity);
            if (!sourceEntity || normalizeEntityAbsorptionStatus(absorption?.status) !== 'pending') {
                return { ok: false, reason: 'not_pending', sourceName: sourceCanonical };
            }
            const task = normalizeEntityAbsorptionTask({
                ...absorption,
                sourceName: absorption.sourceName || sourceCanonical,
                status: 'cancelled',
                cancelledAt: Date.now(),
                cancelledTurn: MemoryState.currentTurn || 0,
                reviewNotes: ['manual_absorption_cancelled']
            }, lorebook);
            if (task) upsertEntityAbsorptionTask(lorebook, task);
            delete sourceEntity.meta.absorption;
            sourceEntity.quality = sourceEntity.quality || {};
            sourceEntity.quality.needsReview = !!options.keepReviewFlag;
            const targetCanonical = task?.targetName || absorption?.targetName || '';
            const targetEntity = targetCanonical ? getEntityRecordFromLore(targetCanonical, lorebook) : null;
            if (targetEntity?.meta) {
                targetEntity.meta.pendingAbsorptionSources = (Array.isArray(targetEntity.meta.pendingAbsorptionSources) ? targetEntity.meta.pendingAbsorptionSources : [])
                    .filter(name => name !== sourceCanonical);
                entityCache.set(targetCanonical, targetEntity);
            }
            entityCache.set(sourceCanonical, sourceEntity);
            return { ok: true, sourceName: sourceCanonical, targetName: targetCanonical, task };
        };

        const applyEntityAbsorption = (planOrTask = {}, lorebook = [], options = {}) => {
            const incomingTask = planOrTask?.task && typeof planOrTask.task === 'object' ? planOrTask.task : planOrTask;
            const normalizedTask = typeof incomingTask === 'string'
                ? listPendingEntityAbsorptions(lorebook).find(task => task.id === incomingTask)
                : normalizeEntityAbsorptionTask(incomingTask, lorebook);
            if (!normalizedTask) return { ok: false, reason: 'task_not_found' };
            if (normalizedTask.status !== 'pending') return { ok: false, reason: 'task_not_pending', id: normalizedTask.id, status: normalizedTask.status };

            const sourceCanonical = resolveCanonicalName(normalizedTask.sourceName, lorebook) || normalizedTask.sourceName;
            const targetCanonical = resolveCanonicalName(normalizedTask.targetName, lorebook) || normalizedTask.targetName;
            const sourceEntity = getEntityRecordFromLore(sourceCanonical, lorebook) || normalizeEntityShape(safeClone(normalizedTask.sourceSnapshot || {}));
            const targetEntity = getEntityRecordFromLore(targetCanonical, lorebook);
            if (!sourceEntity?.name && !sourceCanonical) return { ok: false, reason: 'source_not_found', id: normalizedTask.id };
            if (!targetEntity) return { ok: false, reason: 'target_not_found', id: normalizedTask.id, sourceName: sourceCanonical, targetName: targetCanonical };

            const previousNames = dedupeTextArray([
                normalizedTask.sourceName,
                normalizedTask.sourceOriginalName,
                sourceCanonical,
                sourceEntity.name || '',
                ...(Array.isArray(sourceEntity?.meta?.aliases) ? sourceEntity.meta.aliases : []),
                ...(Array.isArray(sourceEntity?.identity?.aliases) ? sourceEntity.identity.aliases : [])
            ].filter(Boolean));
            const sourceNameKeys = makeRenameNameKeys(previousNames);
            const sanitizedSource = sanitizeAbsorptionMergeEntity(sourceEntity, targetCanonical, sourceNameKeys);
            const rawPatch = planOrTask?.targetPatch || planOrTask?.patch || planOrTask?.targetEntity || planOrTask?.entity || {};
            const sanitizedPatch = rawPatch && typeof rawPatch === 'object' && Object.keys(rawPatch).length > 0
                ? sanitizeAbsorptionMergeEntity(rawPatch, targetCanonical, sourceNameKeys)
                : null;

            const targetBefore = safeClone(targetEntity);
            let mergedEntity = mergeEntityRecords(safeClone(targetEntity), sanitizedSource);
            if (sanitizedPatch) mergedEntity = mergeEntityRecords(mergedEntity, sanitizedPatch);
            mergedEntity.name = targetCanonical;
            mergedEntity.id = targetBefore.id || mergedEntity.id || TokenizerEngine.simpleHash(normalizeName(targetCanonical));
            mergedEntity.meta = mergedEntity.meta || {};
            mergedEntity.meta.absorbedSources = normalizeEntityList([
                ...(Array.isArray(targetBefore?.meta?.absorbedSources) ? targetBefore.meta.absorbedSources : []),
                sourceCanonical
            ], 24, 180);
            mergedEntity.meta.pendingAbsorptionSources = (Array.isArray(mergedEntity.meta.pendingAbsorptionSources) ? mergedEntity.meta.pendingAbsorptionSources : [])
                .filter(name => !previousNames.includes(name) && name !== sourceCanonical);
            mergedEntity.meta.absorptionHistory = normalizeEntityList([
                ...(Array.isArray(targetBefore?.meta?.absorptionHistory) ? targetBefore.meta.absorptionHistory : []),
                `${sourceCanonical} => ${targetCanonical} @T${MemoryState.currentTurn || 0}`
            ], 24, 220);
            mergedEntity.meta.aliases = filterAliasesForAbsorption(mergedEntity.meta.aliases, sourceNameKeys, targetCanonical);
            mergedEntity.meta.hiddenNameKeys = Array.isArray(mergedEntity.meta.hiddenNameKeys)
                ? mergedEntity.meta.hiddenNameKeys.filter(key => !renameNameMatches(key, sourceNameKeys) && !isGenericRoleAliasName(key))
                : [];
            if (targetBefore?.meta?.nameManualLocked === true) {
                mergedEntity.meta.nameManualLocked = true;
                mergedEntity.meta.nameManualLockedAt = targetBefore.meta.nameManualLockedAt || Date.now();
            }
            delete mergedEntity.meta.absorption;
            mergedEntity.meta.source = options.source || 'entity_absorption';
            mergedEntity.meta.updated = MemoryState.currentTurn || mergedEntity.meta.updated || 0;
            normalizeEntityV2Fields(mergedEntity);

            entityCache.delete(sourceCanonical);
            entityCache.set(targetCanonical, mergedEntity);
            const relationRewrite = rewriteRelationsForAbsorption(sourceNameKeys, targetCanonical, lorebook);

            const appliedTask = upsertEntityAbsorptionTask(lorebook, {
                ...normalizedTask,
                status: 'applied',
                appliedAt: Date.now(),
                appliedTurn: MemoryState.currentTurn || 0,
                confidence: normalizeEntity01(planOrTask?.confidence, normalizedTask.confidence || 0),
                conflicts: normalizeEntityList(planOrTask?.conflicts || normalizedTask.conflicts || [], 8, 220),
                reviewNotes: normalizeEntityList([
                    ...(Array.isArray(normalizedTask.reviewNotes) ? normalizedTask.reviewNotes : []),
                    ...(Array.isArray(planOrTask?.reviewNotes) ? planOrTask.reviewNotes : []),
                    `relations:${relationRewrite.rewired}/${relationRewrite.dropped}`
                ], 10, 220)
            });

            return {
                ok: true,
                id: normalizedTask.id,
                sourceName: sourceCanonical,
                targetName: targetCanonical,
                previousNames,
                entity: mergedEntity,
                task: appliedTask,
                relationRewrite
            };
        };

        const updateEntity = (name, updates, lorebook) => {
            if (isBlockedEntityName(name, lorebook)) return null;
            const entity = getOrCreateEntity(name, lorebook);
            if (!entity) return null;
            if (isEntityAbsorptionApplied(entity) || (isEntityAbsorptionPending(entity) && updates?.source !== 'entity_absorption')) return null;
            entity.meta = entity.meta || { created: MemoryState.currentTurn, updated: 0, confidence: 0.5, source: '', aliases: [] };
            entity.meta.aliases = Array.isArray(entity.meta.aliases) ? entity.meta.aliases : [];
            entity.meta.hiddenNameKeys = Array.isArray(entity.meta.hiddenNameKeys) ? entity.meta.hiddenNameKeys : [];
            normalizeEntityV2Fields(entity);
            const forceReplace = updates?.forceReplace === true || updates?.source === 'correction';
            const manualProtected = isManualProtected(entity.meta, updates);
            extractNameVariantParts(name).forEach(incomingAlias => {
                if (incomingAlias && incomingAlias !== entity.name && !entity.meta.aliases.includes(incomingAlias)) {
                    entity.meta.aliases.push(incomingAlias);
                }
            });
            buildHiddenNameKeys(name).forEach(hiddenKey => {
                if (hiddenKey && !entity.meta.hiddenNameKeys.includes(hiddenKey)) {
                    entity.meta.hiddenNameKeys.push(hiddenKey);
                }
            });

            const currentTurn = MemoryState.currentTurn;
            const incomingSex = normalizeBiologicalSex(updates.sex || updates.biologicalSex || '');
            if (incomingSex && (forceReplace || !entity.sex)) {
                if (!(manualProtected && entity.sex)) entity.sex = incomingSex;
            }
            if (updates.m_id != null) {
                captureRollbackSnapshot(entity, updates.m_id, (target) => ({
                    sex: target.sex,
                    appearance: target.appearance,
                    personality: target.personality,
                    speechStyle: target.speechStyle,
                    background: target.background,
                    status: target.status,
                    identity: target.identity,
                    profile: target.profile,
                    currentState: target.currentState,
                    continuity: target.continuity,
                    povKnowledge: target.povKnowledge,
                    episodeLedger: target.episodeLedger,
                    stateTimeline: target.stateTimeline,
                    evidence: target.evidence,
                    quality: target.quality
                }));
            }

            if (updates.appearance) {
                for (const key of ['features', 'distinctiveMarks', 'clothing']) {
                    if (Array.isArray(updates.appearance[key])) {
                        const normalizedItems = [...new Set(updates.appearance[key].filter(Boolean))];
                        if (forceReplace) {
                            if (manualProtected && Array.isArray(entity.appearance[key]) && entity.appearance[key].length > 0) continue;
                            entity.appearance[key] = normalizedItems;
                        } else {
                            if (!Array.isArray(entity.appearance[key])) entity.appearance[key] = [];
                            if (manualProtected && entity.appearance[key].length > 0) continue;
                            const newItems = normalizedItems.filter(item => !entity.appearance[key].includes(item));
                            entity.appearance[key].push(...newItems);
                        }
                    }
                }
            }

            if (updates.personality) {
                const sanitizedCurrentPersonality = sanitizeEntityPersonalityFields(entity.personality);
                entity.personality.traits = sanitizedCurrentPersonality.cleanedTraits;
                entity.personality.sexualOrientation = sanitizedCurrentPersonality.sexualOrientation || entity.personality.sexualOrientation;
                entity.personality.sexualPreferences = sanitizedCurrentPersonality.sexualPreferences;

                const sanitizedIncomingPersonality = sanitizeEntityPersonalityFields(updates.personality);
                const incomingPersonality = {
                    ...updates.personality,
                    traits: sanitizedIncomingPersonality.cleanedTraits,
                    sexualOrientation: sanitizedIncomingPersonality.sexualOrientation || updates.personality.sexualOrientation || '',
                    sexualPreferences: sanitizedIncomingPersonality.sexualPreferences
                };

                for (const key of ['traits', 'values', 'fears', 'likes', 'dislikes', 'sexualPreferences']) {
                    if (Array.isArray(incomingPersonality[key])) {
                        const normalizedItems = [...new Set(incomingPersonality[key].filter(Boolean))];
                        if (forceReplace) {
                            if (manualProtected && Array.isArray(entity.personality[key]) && entity.personality[key].length > 0) continue;
                            entity.personality[key] = normalizedItems;
                        } else {
                            if (!Array.isArray(entity.personality[key])) entity.personality[key] = [];
                            if (manualProtected && entity.personality[key].length > 0) continue;
                            const newItems = normalizedItems.filter(item => !entity.personality[key].includes(item));
                            entity.personality[key].push(...newItems);
                        }
                    }
                }
                if (incomingPersonality.sexualOrientation && (forceReplace || !entity.personality.sexualOrientation)) {
                    if (manualProtected && entity.personality.sexualOrientation) {
                    } else {
                    entity.personality.sexualOrientation = incomingPersonality.sexualOrientation;
                    }
                }
            }

            if (updates.speechStyle && typeof updates.speechStyle === 'object') {
                entity.speechStyle = entity.speechStyle || { defaultTone: '', honorificStyle: '', toSuperiors: '', toSubordinates: '', toPeers: '', toYounger: '', notes: [] };
                for (const key of ['defaultTone', 'honorificStyle', 'toSuperiors', 'toSubordinates', 'toPeers', 'toYounger']) {
                    const rawValue = String(updates.speechStyle[key] || '').trim();
                    const nextValue = normalizeSpeechStyleField(key, rawValue);
                    if (!nextValue) continue;
                    const existingValue = String(entity.speechStyle[key] || '').trim();
                    if (manualProtected && existingValue) continue;
                    const isKnownValue = (SPEECH_FIELD_OPTION_MAP[key] || []).some(option => option.value === rawValue);
                    if (rawValue && nextValue !== rawValue && !isKnownValue) {
                        entity.speechStyle.notes = Array.isArray(entity.speechStyle.notes) ? entity.speechStyle.notes : [];
                        if (!(manualProtected && entity.speechStyle.notes.length > 0)) {
                            entity.speechStyle.notes = dedupeTextArray([...(entity.speechStyle.notes || []), `${key}: ${rawValue}`]);
                        }
                    }
                    if (forceReplace || !entity.speechStyle[key]) {
                        entity.speechStyle[key] = nextValue;
                    }
                }
                if (Array.isArray(updates.speechStyle.notes)) {
                    const nextNotes = dedupeTextArray(updates.speechStyle.notes.map(String).map(v => v.trim()).filter(Boolean));
                    entity.speechStyle.notes = Array.isArray(entity.speechStyle.notes) ? entity.speechStyle.notes : [];
                    if (forceReplace) {
                        if (!(manualProtected && entity.speechStyle.notes.length > 0)) entity.speechStyle.notes = nextNotes;
                    } else {
                        if (manualProtected && entity.speechStyle.notes.length > 0) {
                        } else {
                        entity.speechStyle.notes = dedupeTextArray([...(entity.speechStyle.notes || []), ...nextNotes]);
                        }
                    }
                }
            }

            if (updates.background) {
                if (updates.background.origin && (forceReplace || !entity.background.origin)) {
                    if (!(manualProtected && entity.background.origin)) entity.background.origin = updates.background.origin;
                }
                if (updates.background.occupation && (forceReplace || !entity.background.occupation)) {
                    if (!(manualProtected && entity.background.occupation)) entity.background.occupation = updates.background.occupation;
                }
                if (Array.isArray(updates.background.history)) {
                    const normalizedHistory = [...new Set(updates.background.history.filter(Boolean))];
                    if (forceReplace) {
                        if (manualProtected && Array.isArray(entity.background.history) && entity.background.history.length > 0) {
                        } else {
                        entity.background.history = normalizedHistory;
                        }
                    } else {
                        if (!Array.isArray(entity.background.history)) entity.background.history = [];
                        if (manualProtected && entity.background.history.length > 0) {
                        } else {
                        const newHistory = normalizedHistory.filter(h => !entity.background.history.includes(h));
                        entity.background.history.push(...newHistory);
                        }
                    }
                }
            }

            if (updates.status) {
                if (updates.status.currentLocation && !(manualProtected && entity.status.currentLocation)) entity.status.currentLocation = updates.status.currentLocation;
                if (updates.status.currentMood && !(manualProtected && entity.status.currentMood)) entity.status.currentMood = normalizeEntityMoodText(updates.status.currentMood, 8);
                if (updates.status.healthStatus && !(manualProtected && entity.status.healthStatus)) entity.status.healthStatus = updates.status.healthStatus;
                if (updates.status.currentDate && !(manualProtected && entity.status.currentDate)) entity.status.currentDate = compactTimeFieldText(updates.status.currentDate, 80);
                if (updates.status.currentTime && !(manualProtected && entity.status.currentTime)) entity.status.currentTime = compactTimeFieldText(updates.status.currentTime, 40);
                if (updates.status.notes) {
                    const incomingNotes = String(updates.status.notes || '').trim();
                    if (incomingNotes && !(manualProtected && entity.status.notes)) {
                        entity.status.notes = mergeLimitedStatusNotes(forceReplace ? '' : entity.status.notes, incomingNotes, 320, {
                            entityName: entity.name || name || '',
                            status: entity.status
                        });
                    }
                }
                entity.status.lastUpdated = currentTurn;
            }

            mergeEntityV2Fields(entity, updates, {
                forceReplace,
                sourceMode: updates.source || 'conversation',
                m_id: updates.m_id,
                currentTurn
            });

            entity.meta.updated = currentTurn;
            if (updates.source) entity.meta.source = updates.source;
            entity.meta.confidence = Math.min(1, entity.meta.confidence + 0.1);
            
            // Sync/Rollback Metadata
            if (updates.s_id != null) entity.meta.s_id = updates.s_id;
            if (updates.m_id != null) addSourceMessageId(entity.meta, updates.m_id);

            try {
                const trackingPatch = {
                    ...(updates.timeTracking && typeof updates.timeTracking === 'object' ? updates.timeTracking : {}),
                    currentDate: updates?.status?.currentDate || updates?.timeTracking?.currentDate || entity?.status?.currentDate || '',
                    currentTime: updates?.status?.currentTime || updates?.timeTracking?.currentTime || entity?.status?.currentTime || '',
                    notes: updates?.status?.notes || updates?.timeTracking?.notes || entity?.status?.notes || ''
                };
                TimeEngine.ingestEntityTracking(entity.name || name || '', trackingPatch, entity);
                const projection = TimeEngine.projectEntity(entity);
                if (projection?.currentDate) entity.status.currentDate = projection.currentDate;
                if (projection?.currentTime) entity.status.currentTime = projection.currentTime;
            } catch (e) {
                if (MemoryEngine.CONFIG?.debug) console.warn('[LIBRA] TimeEngine updateEntity skipped:', e?.message);
            }

            return entity;
        };

        const updateRelation = (nameA, nameB, updates, lorebook) => {
            if (isBlockedEntityName(nameA, lorebook) || isBlockedEntityName(nameB, lorebook)) return null;
            const relation = getOrCreateRelation(nameA, nameB, lorebook);
            if (!relation) return null;
            normalizeRelationV2Fields(relation);

            const currentTurn = MemoryState.currentTurn;
            const forceReplace = updates?.forceReplace === true || updates?.source === 'correction';
            const manualProtected = isManualProtected(relation.meta, updates);
            if (updates.m_id != null) {
                captureRollbackSnapshot(relation, updates.m_id, (target) => ({
                    relationType: target.relationType,
                    details: target.details,
                    sentiments: target.sentiments,
                    currentStatus: target.currentStatus,
                    metrics: target.metrics,
                    dynamics: target.dynamics,
                    sharedContext: target.sharedContext,
                    eventLedger: target.eventLedger,
                    evidence: target.evidence,
                    quality: target.quality
                }));
            }

            if (updates.relationType && !(manualProtected && relation.relationType)) relation.relationType = updates.relationType;

            if (updates.details) {
                if (updates.details.howMet && !(manualProtected && relation.details.howMet)) relation.details.howMet = updates.details.howMet;
                if (updates.details.duration && !(manualProtected && relation.details.duration)) relation.details.duration = updates.details.duration;
                if (typeof updates.details.closeness === 'number' && !(manualProtected && Number.isFinite(Number(relation.details.closeness)))) relation.details.closeness = applyRelationshipDelta(relation.details.closeness, updates.details.closeness, { initialBaseline: 0.08 });
                if (typeof updates.details.trust === 'number' && !(manualProtected && Number.isFinite(Number(relation.details.trust)))) relation.details.trust = applyRelationshipDelta(relation.details.trust, updates.details.trust, { initialBaseline: 0.1 });
            }

            if (updates.sentiments) {
                if (updates.sentiments.fromAtoB && !(manualProtected && relation.sentiments.fromAtoB)) relation.sentiments.fromAtoB = updates.sentiments.fromAtoB;
                if (updates.sentiments.fromBtoA && !(manualProtected && relation.sentiments.fromBtoA)) relation.sentiments.fromBtoA = updates.sentiments.fromBtoA;
                if (typeof updates.sentiments.currentTension === 'number') {
                    if (manualProtected && Number.isFinite(Number(relation.sentiments.currentTension)) && relation.sentiments.currentTension > 0) {
                    } else {
                    relation.sentiments.currentTension = forceReplace
                        ? Math.max(0, Math.min(1, updates.sentiments.currentTension))
                        : Math.max(0, Math.min(1, relation.sentiments.currentTension + updates.sentiments.currentTension));
                    }
                } else if (typeof updates.sentiments.tension === 'number') {
                    if (manualProtected && Number.isFinite(Number(relation.sentiments.currentTension)) && relation.sentiments.currentTension > 0) {
                    } else {
                    relation.sentiments.currentTension = Math.max(0, Math.min(1, relation.sentiments.currentTension + updates.sentiments.tension));
                    }
                }
            }

            if (updates.event) {
                relation.details.events.push({ turn: currentTurn, event: updates.event, sentiment: updates.eventSentiment || 'neutral' });
                if (relation.details.events.length > 12) relation.details.events = relation.details.events.slice(-10);
            }

            mergeRelationV2Fields(relation, updates, {
                forceReplace,
                sourceMode: updates.source || 'conversation',
                m_id: updates.m_id,
                currentTurn
            });

            relation.meta.updated = currentTurn;
            if (updates.source) relation.meta.source = updates.source;
            relation.meta.confidence = Math.min(1, Math.max(0.3, Number(relation.meta.confidence || 0.3)) + 0.1);
            relation.sentiments.lastInteraction = currentTurn;

            // Sync/Rollback Metadata
            if (updates.s_id != null) relation.meta.s_id = updates.s_id;
            if (updates.m_id != null) addSourceMessageId(relation.meta, updates.m_id);

            harmonizeRelationMetrics(relation);
            relation.metrics = relation.metrics && typeof relation.metrics === 'object' ? relation.metrics : {};
            relation.metrics.closeness = normalizeNullableRelationScore(relation.details?.closeness);
            relation.metrics.trust = normalizeNullableRelationScore(relation.details?.trust);
            relation.relationshipAssessment = buildRelationshipAssessment(relation);

            return relation;
        };

        const checkConsistency = (entityName, newInfo, lorebook = []) => {
            const entity = entityCache.get(resolveCanonicalName(entityName, lorebook));
            if (!entity) return { consistent: true, conflicts: [] };

            const conflicts = [];
            if (newInfo.appearance?.features) {
                const opposites = { '키가 큼': ['키가 작음'], '키가 작음': ['키가 큼'], '검은 머리': ['금발', '갈색 머리'], '금발': ['검은 머리', '갈색 머리'], 'tall': ['short'], 'short': ['tall'], 'black hair': ['blonde', 'brown hair'], 'blonde': ['black hair', 'brown hair'], 'brown hair': ['black hair', 'blonde'] };
                const currentFeatures = Array.isArray(entity.appearance.features) ? entity.appearance.features : [];
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

        const formatEntityForPrompt = (entity, options = {}) => {
            const sourceEntity = typeof entity === 'string'
                ? (entityCache.get(resolveCanonicalName(entity)) || entityCache.get(entity) || { name: entity })
                : entity;
            const safeEntity = sourceEntity && typeof sourceEntity === 'object' ? sourceEntity : {};
            if (!options.includeAbsorptionPending && !isPromptVisibleEntityRecord(safeEntity)) return '';
            const appearance = (safeEntity.appearance && typeof safeEntity.appearance === 'object') ? safeEntity.appearance : {};
            const personality = (safeEntity.personality && typeof safeEntity.personality === 'object') ? safeEntity.personality : {};
            const speechStyle = (safeEntity.speechStyle && typeof safeEntity.speechStyle === 'object') ? safeEntity.speechStyle : {};
            const background = (safeEntity.background && typeof safeEntity.background === 'object') ? safeEntity.background : {};
            const status = (safeEntity.status && typeof safeEntity.status === 'object') ? safeEntity.status : {};
            const identity = (safeEntity.identity && typeof safeEntity.identity === 'object') ? safeEntity.identity : {};
            const profile = (safeEntity.profile && typeof safeEntity.profile === 'object') ? safeEntity.profile : {};
            const currentState = (safeEntity.currentState && typeof safeEntity.currentState === 'object') ? safeEntity.currentState : {};
            const continuity = (safeEntity.continuity && typeof safeEntity.continuity === 'object') ? safeEntity.continuity : {};
            const povKnowledge = (safeEntity.povKnowledge && typeof safeEntity.povKnowledge === 'object') ? safeEntity.povKnowledge : {};
            const quality = (safeEntity.quality && typeof safeEntity.quality === 'object') ? safeEntity.quality : {};
            let timeProjection = null;
            try {
                timeProjection = TimeEngine.getProjection(safeEntity?.name || '', safeEntity) || null;
            } catch (_) {
                timeProjection = null;
            }
            const features = Array.isArray(appearance.features) ? appearance.features : [];
            const distinctiveMarks = Array.isArray(appearance.distinctiveMarks) ? appearance.distinctiveMarks : [];
            const traits = Array.isArray(personality.traits) ? personality.traits : [];
            const likes = Array.isArray(personality.likes) ? personality.likes : [];
            const dislikes = Array.isArray(personality.dislikes) ? personality.dislikes : [];
            const sexualPreferences = Array.isArray(personality.sexualPreferences) ? personality.sexualPreferences : [];
            const speechNotes = Array.isArray(speechStyle.notes) ? speechStyle.notes : [];
            const parts = [];
            parts.push(`【${safeEntity.name || '?'}】`);
            const sex = normalizeBiologicalSex(safeEntity.sex || safeEntity.biologicalSex || '');
            if (sex) parts.push(`  생물학적 성별/Biological Sex: ${sex}`);
            if (features.length > 0 || distinctiveMarks.length > 0) {
                parts.push(`  외모/Appearance: ${[...features, ...distinctiveMarks].join(', ')}`);
            }
            if (traits.length > 0) parts.push(`  성격/Personality: ${traits.join(', ')}`);
            if (personality.sexualOrientation) parts.push(`  성관념/Sexual Attitude: ${personality.sexualOrientation}`);
            if (sexualPreferences.length > 0) parts.push(`  성적취향/Sexual Preferences: ${sexualPreferences.join(', ')}`);
            if (speechStyle.defaultTone) parts.push(`  말투 기본/Speech Tone: ${speechStyle.defaultTone}`);
            if (speechStyle.honorificStyle) parts.push(`  높임말 경향/Honorific Style: ${speechStyle.honorificStyle}`);
            if (speechStyle.toSuperiors) parts.push(`  윗사람에게/To Superiors: ${speechStyle.toSuperiors}`);
            if (speechStyle.toSubordinates) parts.push(`  아랫사람에게/To Subordinates: ${speechStyle.toSubordinates}`);
            if (speechStyle.toPeers) parts.push(`  동급·친구에게/To Peers: ${speechStyle.toPeers}`);
            if (speechStyle.toYounger) parts.push(`  동생·연하에게/To Younger: ${speechStyle.toYounger}`);
            if (speechNotes.length > 0) parts.push(`  말버릇/Speech Notes: ${speechNotes.join(', ')}`);
            if (likes.length > 0) parts.push(`  좋아하는 것/Likes: ${likes.join(', ')}`);
            if (dislikes.length > 0) parts.push(`  싫어하는 것/Dislikes: ${dislikes.join(', ')}`);
            if (background.origin) parts.push(`  출신/Origin: ${background.origin}`);
            if (background.occupation) parts.push(`  직업/Occupation: ${background.occupation}`);
            if (status.currentMood) parts.push(`  현재 기분/Current Mood: ${status.currentMood}`);
            if (status.currentLocation) parts.push(`  현재 위치/Current Location: ${status.currentLocation}`);
            const currentDate = String(timeProjection?.currentDate || status.currentDate || '').trim();
            const currentTime = String(timeProjection?.currentTime || status.currentTime || '').trim();
            if (currentDate || currentTime) parts.push(`  장면 시각/Scene Time: ${[currentDate, currentTime].filter(Boolean).join(' ')}`);
            const lastInteractionDate = String(timeProjection?.lastInteractionDate || '').trim();
            const lastInteractionTime = String(timeProjection?.lastInteractionTime || '').trim();
            if (lastInteractionDate || lastInteractionTime) parts.push(`  최근 상호작용 시각/Last Interaction Time: ${[lastInteractionDate, lastInteractionTime].filter(Boolean).join(' ')}`);
            if (status.healthStatus) parts.push(`  건강 상태/Health Status: ${status.healthStatus}`);
            if (status.notes) parts.push(`  상태 메모/Status Notes: ${status.notes}`);
            const identityFacts = [
                identity.age ? `age=${identity.age}` : '',
                identity.occupation ? `occupation=${identity.occupation}` : '',
                identity.affiliation ? `affiliation=${identity.affiliation}` : '',
                identity.roleInStory ? `role=${identity.roleInStory}` : '',
                identity.summary ? `identity=${identity.summary}` : ''
            ].filter(Boolean);
            if (identityFacts.length > 0) parts.push(`  정체성/Identity: ${identityFacts.join(' | ')}`);
            const profilePersonality = profile.personality && typeof profile.personality === 'object' ? profile.personality : {};
            const profileSpeech = profile.speechStyle && typeof profile.speechStyle === 'object' ? profile.speechStyle : {};
            const profilePsychology = profile.psychology && typeof profile.psychology === 'object' ? profile.psychology : {};
            const vulnerabilities = Array.isArray(profilePersonality.vulnerabilities) ? profilePersonality.vulnerabilities : [];
            const boundaries = Array.isArray(profilePersonality.boundaries) ? profilePersonality.boundaries : [];
            if (profilePersonality.workStyle || profilePersonality.socialStyle || vulnerabilities.length > 0 || boundaries.length > 0) {
                parts.push(`  인물 프로필/Profile: ${[
                    profilePersonality.workStyle ? `work=${profilePersonality.workStyle}` : '',
                    profilePersonality.socialStyle ? `social=${profilePersonality.socialStyle}` : '',
                    vulnerabilities.length ? `vulnerabilities=${vulnerabilities.join(', ')}` : '',
                    boundaries.length ? `boundaries=${boundaries.join(', ')}` : ''
                ].filter(Boolean).join(' | ')}`);
            }
            if (Array.isArray(profileSpeech.pressureMarkers) && profileSpeech.pressureMarkers.length > 0) parts.push(`  압박 말버릇/Pressure Markers: ${profileSpeech.pressureMarkers.join(', ')}`);
            if (profileSpeech.intimacyShift) parts.push(`  친밀도별 말투 변화/Intimacy Speech Shift: ${profileSpeech.intimacyShift}`);
            const psychologyNotes = Array.isArray(profilePsychology.notes) ? profilePsychology.notes : [];
            if (profilePsychology.baseline || profilePsychology.currentConflict || profilePsychology.copingStyle || psychologyNotes.length) {
                parts.push(`  심리/Psychology: ${[
                    profilePsychology.baseline ? `baseline=${profilePsychology.baseline}` : '',
                    profilePsychology.currentConflict ? `conflict=${profilePsychology.currentConflict}` : '',
                    profilePsychology.copingStyle ? `coping=${profilePsychology.copingStyle}` : '',
                    psychologyNotes.length ? `notes=${psychologyNotes.slice(-3).join(', ')}` : ''
                ].filter(Boolean).join(' | ')}`);
            }
            const currentStateFacts = [
                currentState.summary ? `state=${currentState.summary}` : '',
                currentState.location ? `location=${currentState.location}` : '',
                Array.isArray(currentState.physicalState) && currentState.physicalState.length ? `physical=${currentState.physicalState.join(', ')}` : '',
                Array.isArray(currentState.emotionalState) && currentState.emotionalState.length ? `emotion=${currentState.emotionalState.join(', ')}` : '',
                Array.isArray(currentState.cognitiveFocus) && currentState.cognitiveFocus.length ? `focus=${currentState.cognitiveFocus.join(', ')}` : '',
                currentState.immediateGoal ? `goal=${currentState.immediateGoal}` : ''
            ].filter(Boolean);
            if (currentStateFacts.length > 0) parts.push(`  현재 상태판/Current State: ${currentStateFacts.join(' | ')}`);
            const stateTimeline = Array.isArray(safeEntity.stateTimeline) ? safeEntity.stateTimeline : [];
            if (stateTimeline.length > 0) {
                const stateLines = stateTimeline.slice(-3)
                    .map(item => item?.summary ? `T${Number(item.turn || 0) || '?'}:${item.summary}` : '')
                    .filter(Boolean);
                if (stateLines.length > 0) parts.push(`  최근 상태 로그/Recent State Log: ${stateLines.join(' / ')}`);
            }
            const threads = Array.isArray(continuity.openThreads) ? continuity.openThreads : [];
            if (threads.length > 0) parts.push(`  열린 인물 스레드/Open Threads: ${threads.slice(-4).map(thread => `${thread.label}${thread.status ? `(${thread.status})` : ''}`).join(' / ')}`);
            const nextHints = Array.isArray(continuity.nextActionHints) ? continuity.nextActionHints : [];
            if (nextHints.length > 0) parts.push(`  다음 행동 힌트/Next Hints: ${nextHints.slice(-4).join(' / ')}`);
            const unknownToSelf = Array.isArray(povKnowledge.unknownToSelf) ? povKnowledge.unknownToSelf : [];
            const knownToSelf = Array.isArray(povKnowledge.knownToSelf) ? povKnowledge.knownToSelf : [];
            if (knownToSelf.length > 0 || unknownToSelf.length > 0) {
                parts.push(`  POV 지식/POV Knowledge: ${[
                    knownToSelf.length ? `knows=${knownToSelf.slice(-4).join(', ')}` : '',
                    unknownToSelf.length ? `unknown=${unknownToSelf.slice(-4).join(', ')}` : ''
                ].filter(Boolean).join(' | ')}`);
            }
            const ledger = Array.isArray(safeEntity.episodeLedger) ? safeEntity.episodeLedger : [];
            if (ledger.length > 0) parts.push(`  최근 사건 장부/Recent Entity Events: ${ledger.slice(-3).map(event => event.summary).filter(Boolean).join(' / ')}`);
            const evidence = Array.isArray(safeEntity.evidence) ? safeEntity.evidence : [];
            if (evidence.length > 0) {
                const evidenceTurns = dedupeTextArray(evidence.map(item => item.turn ? `T${item.turn}` : item.sourceKind).filter(Boolean)).slice(-5);
                if (evidenceTurns.length > 0) parts.push(`  근거/Evidence: ${evidenceTurns.join(', ')}${quality.confidence ? ` | conf=${Number(quality.confidence).toFixed(2)}` : ''}`);
            }
            const output = parts.join('\n');
            return options?.viewerId
                ? SecretKnowledgeCore.redactForViewer(output, options.viewerId)
                : output;
        };

        const formatRelationForPrompt = (relation) => {
            const safeRelation = relation && typeof relation === 'object' ? relation : {};
            const details = safeRelation.details && typeof safeRelation.details === 'object' ? safeRelation.details : {};
            const sentiments = safeRelation.sentiments && typeof safeRelation.sentiments === 'object' ? safeRelation.sentiments : {};
            const currentStatus = safeRelation.currentStatus && typeof safeRelation.currentStatus === 'object' ? safeRelation.currentStatus : {};
            const metrics = safeRelation.metrics && typeof safeRelation.metrics === 'object' ? safeRelation.metrics : {};
            const dynamics = safeRelation.dynamics && typeof safeRelation.dynamics === 'object' ? safeRelation.dynamics : {};
            const sharedContext = safeRelation.sharedContext && typeof safeRelation.sharedContext === 'object' ? safeRelation.sharedContext : {};
            const assessment = safeRelation.relationshipAssessment && typeof safeRelation.relationshipAssessment === 'object' ? safeRelation.relationshipAssessment : {};
            const parts = [];
            parts.push(`【${safeRelation.entityA || '?'} ↔ ${safeRelation.entityB || '?'}】`);
            if (safeRelation.relationType) parts.push(`  관계/Relation: ${safeRelation.relationType}`);
            if (assessment.label || Number.isFinite(Number(assessment.definitionConfidence))) {
                const confidence = normalizeNullableRelationScore(assessment.definitionConfidence);
                parts.push(`  관계 정의도/Definition: ${assessment.label || '관찰 중'}${confidence != null ? ` (${Math.round(confidence * 100)}%)` : ''}`);
                if (assessment.note) parts.push(`  정의 메모/Definition Note: ${assessment.note}`);
            }
            if (currentStatus.summary || currentStatus.publicLayer || currentStatus.privateLayer || currentStatus.boundaryState) {
                parts.push(`  관계 상태판/Relation State: ${[
                    currentStatus.summary ? `state=${currentStatus.summary}` : '',
                    currentStatus.publicLayer ? `public=${currentStatus.publicLayer}` : '',
                    currentStatus.privateLayer ? `private=${currentStatus.privateLayer}` : '',
                    currentStatus.boundaryState ? `boundary=${currentStatus.boundaryState}` : ''
                ].filter(Boolean).join(' | ')}`);
            }
            const howMet = String(safeRelation.howMet || details.howMet || '').trim();
            const duration = String(safeRelation.duration || details.duration || '').trim();
            if (howMet) parts.push(`  성립/변화 계기/How Met: ${howMet}`);
            if (duration) parts.push(`  지속 기간/Duration: ${duration}`);
            const closeness = normalizeNullableRelationScore(details.closeness);
            const trust = normalizeNullableRelationScore(details.trust);
            if (closeness == null) parts.push(`  친밀도/Closeness: 판단 보류/Insufficient Evidence`);
            else if (closeness > 0.7) parts.push(`  친밀도/Closeness: 매우 가까움/Very Close`);
            else if (closeness > 0.4) parts.push(`  친밀도/Closeness: 보통/Moderate`);
            else parts.push(`  친밀도/Closeness: 낮음/Low`);
            if (trust == null) parts.push(`  신뢰도/Trust: 판단 보류/Insufficient Evidence`);
            else if (trust > 0.7) parts.push(`  신뢰도/Trust: 매우 높음/Very High`);
            else if (trust > 0.4) parts.push(`  신뢰도/Trust: 보통/Moderate`);
            else parts.push(`  신뢰도/Trust: 낮음/Low`);
            if (Number.isFinite(Number(sentiments.currentTension))) {
                const tension = Math.max(0, Math.min(1, Number(sentiments.currentTension)));
                const label = tension >= 0.7 ? '높음/High' : (tension >= 0.4 ? '중간/Moderate' : '낮음/Low');
                parts.push(`  현재 긴장도/Current Tension: ${label} (${tension.toFixed(2)})`);
            }
            const metricParts = [
                Number(metrics.risk) > 0 ? `risk=${Number(metrics.risk).toFixed(2)}` : '',
                Number(metrics.ambiguity) > 0 ? `ambiguity=${Number(metrics.ambiguity).toFixed(2)}` : '',
                Number(metrics.pressure) > 0 ? `pressure=${Number(metrics.pressure).toFixed(2)}` : ''
            ].filter(Boolean);
            if (metricParts.length > 0) parts.push(`  관계 압력/Relation Pressure: ${metricParts.join(' | ')}`);
            if (sentiments.fromAtoB) parts.push(`    - ${safeRelation.entityA || '?'} → ${safeRelation.entityB || '?'}: ${sentiments.fromAtoB}`);
            if (sentiments.fromBtoA) parts.push(`    - ${safeRelation.entityB || '?'} → ${safeRelation.entityA || '?'}: ${sentiments.fromBtoA}`);
            const unresolvedIssues = Array.isArray(dynamics.unresolvedIssues) ? dynamics.unresolvedIssues : [];
            const recentChanges = Array.isArray(dynamics.recentChanges) ? dynamics.recentChanges : [];
            if (unresolvedIssues.length > 0) parts.push(`  미해결 관계 이슈/Unresolved Issues: ${unresolvedIssues.slice(-5).join(' / ')}`);
            if (recentChanges.length > 0) parts.push(`  최근 관계 변화/Recent Changes: ${recentChanges.slice(-4).join(' / ')}`);
            const contextBits = [
                sharedContext.location ? `location=${sharedContext.location}` : '',
                sharedContext.workplace ? `workplace=${sharedContext.workplace}` : '',
                Array.isArray(sharedContext.privateThreads) && sharedContext.privateThreads.length ? `threads=${sharedContext.privateThreads.slice(-4).join(', ')}` : ''
            ].filter(Boolean);
            if (contextBits.length > 0) parts.push(`  공유 맥락/Shared Context: ${contextBits.join(' | ')}`);
            const eventList = Array.isArray(details.events) ? details.events : [];
            const latestEvent = eventList.length > 0 ? eventList[eventList.length - 1] : null;
            const eventText = String(safeRelation.event || latestEvent?.event || '').trim();
            const eventSentiment = String(safeRelation.eventSentiment || latestEvent?.sentiment || '').trim();
            if (eventText) {
                const eventLine = eventSentiment ? `${eventText} (${eventSentiment})` : eventText;
                parts.push(`  최근 관계 사건/Latest Event: ${eventLine}`);
            }
            const eventLedger = Array.isArray(safeRelation.eventLedger) ? safeRelation.eventLedger : [];
            if (eventLedger.length > 0) parts.push(`  관계 사건 장부/Relation Event Ledger: ${eventLedger.slice(-3).map(event => event.summary).filter(Boolean).join(' / ')}`);
            return parts.join('\n');
        };
        const formatProjectionFacts = (facts = [], max = 420) => clampEntityText(
            (Array.isArray(facts) ? facts : [facts])
                .map(item => String(item || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .join(' | '),
            max
        );
        const formatEntityForProjection = (entity, options = {}) => {
            const safeEntity = entity && typeof entity === 'object' ? entity : {};
            const profile = safeEntity.profile && typeof safeEntity.profile === 'object' ? safeEntity.profile : {};
            const identity = safeEntity.identity && typeof safeEntity.identity === 'object' ? safeEntity.identity : {};
            const status = safeEntity.status && typeof safeEntity.status === 'object' ? safeEntity.status : {};
            const currentState = profile.currentState && typeof profile.currentState === 'object' ? profile.currentState : {};
            const personality = profile.personality && typeof profile.personality === 'object' ? profile.personality : {};
            const speech = profile.speechStyle && typeof profile.speechStyle === 'object' ? profile.speechStyle : {};
            const psychology = profile.psychology && typeof profile.psychology === 'object' ? profile.psychology : {};
            const psychologyNotes = Array.isArray(psychology.notes) ? psychology.notes : [];
            const continuity = safeEntity.continuity && typeof safeEntity.continuity === 'object' ? safeEntity.continuity : {};
            const povKnowledge = safeEntity.povKnowledge && typeof safeEntity.povKnowledge === 'object' ? safeEntity.povKnowledge : {};
            const name = clampEntityText(safeEntity.name || safeEntity.canonicalName || safeEntity.displayName || '?', 80) || '?';
            const parts = [`- ${name}`];
            const identityFacts = formatProjectionFacts([
                identity.summary ? `identity=${identity.summary}` : '',
                identity.roleInStory ? `role=${identity.roleInStory}` : '',
                identity.occupation ? `job=${identity.occupation}` : '',
                identity.affiliation ? `affiliation=${identity.affiliation}` : ''
            ], 360);
            if (identityFacts) parts.push(identityFacts);
            const currentFacts = formatProjectionFacts([
                currentState.summary || status.currentState ? `state=${currentState.summary || status.currentState}` : '',
                currentState.location || status.currentLocation ? `location=${currentState.location || status.currentLocation}` : '',
                Array.isArray(currentState.emotionalState) && currentState.emotionalState.length ? `emotion=${currentState.emotionalState.slice(-3).join(', ')}` : '',
                Array.isArray(currentState.cognitiveFocus) && currentState.cognitiveFocus.length ? `focus=${currentState.cognitiveFocus.slice(-3).join(', ')}` : '',
                currentState.immediateGoal ? `goal=${currentState.immediateGoal}` : ''
            ], 420);
            if (currentFacts) parts.push(currentFacts);
            const characterFacts = formatProjectionFacts([
                personality.workStyle ? `work=${personality.workStyle}` : '',
                personality.socialStyle ? `social=${personality.socialStyle}` : '',
                psychology.baseline ? `psych=${psychology.baseline}` : '',
                psychology.currentConflict ? `conflict=${psychology.currentConflict}` : '',
                psychology.copingStyle ? `coping=${psychology.copingStyle}` : '',
                psychologyNotes.length ? `psychNotes=${psychologyNotes.slice(-3).join(', ')}` : ''
            ], 360);
            if (characterFacts) parts.push(characterFacts);
            const speechFacts = formatProjectionFacts([
                speech.defaultTone ? `tone=${speech.defaultTone}` : '',
                speech.honorificStyle ? `honorific=${speech.honorificStyle}` : '',
                speech.intimacyShift ? `speechShift=${speech.intimacyShift}` : '',
                Array.isArray(speech.pressureMarkers) && speech.pressureMarkers.length ? `pressure=${speech.pressureMarkers.slice(-3).join(', ')}` : ''
            ], 300);
            if (speechFacts) parts.push(speechFacts);
            const threads = Array.isArray(continuity.openThreads) ? continuity.openThreads : [];
            if (threads.length > 0) {
                parts.push(`threads=${threads.slice(-3).map(thread => clampEntityText(thread?.label || thread?.summary || thread, 80)).filter(Boolean).join(' / ')}`);
            }
            const knownToSelf = Array.isArray(povKnowledge.knownToSelf) ? povKnowledge.knownToSelf : [];
            const unknownToSelf = Array.isArray(povKnowledge.unknownToSelf) ? povKnowledge.unknownToSelf : [];
            const povFacts = formatProjectionFacts([
                knownToSelf.length ? `knows=${knownToSelf.slice(-3).join(', ')}` : '',
                unknownToSelf.length ? `unknown=${unknownToSelf.slice(-3).join(', ')}` : ''
            ], 300);
            if (povFacts) parts.push(`pov=${povFacts}`);
            const ledger = Array.isArray(safeEntity.episodeLedger) ? safeEntity.episodeLedger : [];
            if (ledger.length > 0) {
                const recentEvents = ledger.slice(-2).map(event => clampEntityText(event?.summary || event?.event || event, 120)).filter(Boolean);
                if (recentEvents.length > 0) parts.push(`recent=${recentEvents.join(' / ')}`);
            }
            const output = parts.join(' | ');
            return options?.viewerId
                ? SecretKnowledgeCore.redactForViewer(output, options.viewerId)
                : output;
        };
        const formatRelationForProjection = (relation, options = {}) => {
            const safeRelation = relation && typeof relation === 'object' ? relation : {};
            const details = safeRelation.details && typeof safeRelation.details === 'object' ? safeRelation.details : {};
            const sentiments = safeRelation.sentiments && typeof safeRelation.sentiments === 'object' ? safeRelation.sentiments : {};
            const currentStatus = safeRelation.currentStatus && typeof safeRelation.currentStatus === 'object' ? safeRelation.currentStatus : {};
            const dynamics = safeRelation.dynamics && typeof safeRelation.dynamics === 'object' ? safeRelation.dynamics : {};
            const sharedContext = safeRelation.sharedContext && typeof safeRelation.sharedContext === 'object' ? safeRelation.sharedContext : {};
            const assessment = safeRelation.relationshipAssessment && typeof safeRelation.relationshipAssessment === 'object' ? safeRelation.relationshipAssessment : {};
            const entityA = clampEntityText(safeRelation.entityA || '?', 80) || '?';
            const entityB = clampEntityText(safeRelation.entityB || '?', 80) || '?';
            const parts = [`- ${entityA} ↔ ${entityB}`];
            const tensionValue = Number(sentiments.currentTension);
            const definitionConfidence = normalizeNullableRelationScore(assessment.definitionConfidence);
            const closeness = normalizeNullableRelationScore(details.closeness);
            const trust = normalizeNullableRelationScore(details.trust);
            const relationFacts = formatProjectionFacts([
                safeRelation.relationType ? `type=${safeRelation.relationType}` : '',
                assessment.label ? `definition=${assessment.label}${definitionConfidence != null ? `:${definitionConfidence.toFixed(2)}` : ''}` : '',
                currentStatus.summary ? `state=${currentStatus.summary}` : '',
                currentStatus.publicLayer ? `public=${currentStatus.publicLayer}` : '',
                currentStatus.boundaryState ? `boundary=${currentStatus.boundaryState}` : '',
                Number.isFinite(tensionValue) ? `tension=${Math.max(0, Math.min(1, tensionValue)).toFixed(2)}` : '',
                closeness != null ? `closeness=${closeness.toFixed(2)}` : '',
                trust != null ? `trust=${trust.toFixed(2)}` : ''
            ], 460);
            if (relationFacts) parts.push(relationFacts);
            const contextFacts = formatProjectionFacts([
                sharedContext.location ? `location=${sharedContext.location}` : '',
                sharedContext.workplace ? `workplace=${sharedContext.workplace}` : '',
                Array.isArray(dynamics.unresolvedIssues) && dynamics.unresolvedIssues.length ? `issues=${dynamics.unresolvedIssues.slice(-3).join(' / ')}` : '',
                Array.isArray(dynamics.recentChanges) && dynamics.recentChanges.length ? `changes=${dynamics.recentChanges.slice(-3).join(' / ')}` : ''
            ], 360);
            if (contextFacts) parts.push(contextFacts);
            const eventList = Array.isArray(details.events) ? details.events : [];
            const latestEvent = eventList.length > 0 ? eventList[eventList.length - 1] : null;
            const eventText = clampEntityText(safeRelation.event || latestEvent?.event || '', 140);
            if (eventText) parts.push(`latest=${eventText}`);
            const output = parts.join(' | ');
            return options?.viewerId
                ? SecretKnowledgeCore.redactForViewer(output, options.viewerId)
                : output;
        };
        const formatRelationsForPrompt = (entityName) => {
            const target = String(entityName || '').trim();
            if (!target) return [];
            return Array.from(relationCache.values())
                .filter(relation => {
                    if (!relation || !(relation.entityA === target || relation.entityB === target)) return false;
                    const entityA = entityCache.get(relation.entityA);
                    const entityB = entityCache.get(relation.entityB);
                    return isPromptVisibleEntityRecord(entityA) && isPromptVisibleEntityRecord(entityB);
                })
                .map(formatRelationForPrompt)
                .filter(Boolean);
        };

        const clearCache = () => { entityCache.clear(); relationCache.clear(); };

        const rebuildCache = (lorebook) => {
            clearCache();
            for (const entry of LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])) {
                try {
                    if (entry.comment === ENTITY_COMMENT) {
                        const entity = normalizeEntityShape(JSON.parse(entry.content));
                        if (isEntityAbsorptionApplied(entity)) continue;
                        entity.id = entity.id || TokenizerEngine.simpleHash(normalizeName(entity.name || ''));
                        entity.meta = entity.meta || { created: 0, updated: 0, confidence: 0.5, source: '' };
                        if (!Array.isArray(entity.meta.m_ids) && entity.meta.m_id) entity.meta.m_ids = [entity.meta.m_id];
                        entity.meta.aliases = Array.isArray(entity.meta.aliases) ? entity.meta.aliases : [];
                        const canonicalName = resolveCanonicalName(entity.name, lorebook);
                        if (!canonicalName || isBlockedEntityName(canonicalName, lorebook) || isBlockedEntityName(entity.name, lorebook)) continue;
                        try {
                            const legacyTracking = normalizeEntityTimeTracking(entity.timeTracking, entity);
                            if (Object.values(legacyTracking).some(Boolean)) {
                                TimeEngine.ingestEntityTracking(entity.name || canonicalName, legacyTracking, entity);
                            }
                            const projection = TimeEngine.projectEntity(entity);
                            if (projection?.currentDate) entity.status.currentDate = projection.currentDate;
                            if (projection?.currentTime) entity.status.currentTime = projection.currentTime;
                        } catch (e) {
                            if (MemoryEngine.CONFIG?.debug) console.warn('[LIBRA] TimeEngine rebuildCache skipped:', e?.message);
                        }
                        if (entityCache.has(canonicalName)) {
                            entityCache.set(canonicalName, mergeEntityRecords(entityCache.get(canonicalName), entity));
                        } else {
                            entityCache.set(canonicalName, entity);
                        }
                    } else if (entry.comment === RELATION_COMMENT) {
                        const relation = JSON.parse(entry.content);
                        relation.entityA = resolveCanonicalName(relation.entityA || '', lorebook);
                        relation.entityB = resolveCanonicalName(relation.entityB || '', lorebook);
                        if (!relation.entityA || !relation.entityB || isBlockedEntityName(relation.entityA, lorebook) || isBlockedEntityName(relation.entityB, lorebook)) continue;
                        if (!hasEntityRecordForRelationEndpoint(relation.entityA, lorebook) || !hasEntityRecordForRelationEndpoint(relation.entityB, lorebook)) continue;
                        relation.id = makeRelationId(relation.entityA || '', relation.entityB || '', lorebook);
                        relation.meta = relation.meta || { created: 0, updated: 0, confidence: 0.3, source: '' };
                        if (!Array.isArray(relation.meta.m_ids) && relation.meta.m_id) relation.meta.m_ids = [relation.meta.m_id];
                        normalizeRelationV2Fields(relation);
                        if (relationCache.has(relation.id)) {
                            relationCache.set(relation.id, mergeRelationRecords(relationCache.get(relation.id), relation));
                        } else {
                            relationCache.set(relation.id, relation);
                        }
                    }
                } catch (e) {
                    if (typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.debug) {
                        recordRuntimeDebug('warn', '[LIBRA] rebuildCache entry parse error:', e?.message);
                    }
                }
            }
            pruneBlockedEntries(lorebook);
            collapseClearlyDuplicateEntities();
        };

        const saveToLorebook = async (char, chat, lorebook) => {
            pruneBlockedEntries(lorebook);
            const currentTurn = MemoryState.currentTurn;
            const liveEntityNames = new Set(Array.from(entityCache.keys()).filter(Boolean));
            const liveRelationIds = new Set(Array.from(relationCache.keys()).filter(Boolean));

            for (let i = lorebook.length - 1; i >= 0; i--) {
                const entry = lorebook[i];
                if (!entry || typeof entry !== 'object') continue;
                try {
                    if (entry.comment === ENTITY_COMMENT) {
                        const parsed = JSON.parse(entry.content || '{}');
                        const canonicalName = resolveCanonicalName(parsed.name || '', lorebook);
                        if (!canonicalName || !liveEntityNames.has(canonicalName)) {
                            lorebook.splice(i, 1);
                        }
                    } else if (entry.comment === RELATION_COMMENT) {
                        const parsed = JSON.parse(entry.content || '{}');
                        const entityA = resolveCanonicalName(parsed.entityA || '', lorebook);
                        const entityB = resolveCanonicalName(parsed.entityB || '', lorebook);
                        const relationId = makeRelationId(entityA || parsed.entityA || '', entityB || parsed.entityB || '', lorebook);
                        if (!relationId || !liveRelationIds.has(relationId) || !liveEntityNames.has(entityA) || !liveEntityNames.has(entityB)) {
                            lorebook.splice(i, 1);
                        }
                    }
                } catch {
                    if (entry.comment === ENTITY_COMMENT || entry.comment === RELATION_COMMENT) {
                        lorebook.splice(i, 1);
                    }
                }
            }

            for (const [name, entity] of entityCache) {
                entity.meta = entity.meta || { created: currentTurn, updated: currentTurn, confidence: 0.5, source: '' };
                entity.meta.updated = currentTurn;
                normalizeEntityV2Fields(entity);
                try {
                    TimeEngine.ingestEntityTracking(entity.name || name || '', {
                        currentDate: entity?.status?.currentDate || '',
                        currentTime: entity?.status?.currentTime || '',
                        notes: entity?.status?.notes || ''
                    }, entity);
                    const projection = TimeEngine.projectEntity(entity);
                    if (projection?.currentDate) entity.status.currentDate = projection.currentDate;
                    if (projection?.currentTime) entity.status.currentTime = projection.currentTime;
                } catch (e) {
                    if (MemoryEngine.CONFIG?.debug) console.warn('[LIBRA] TimeEngine saveToLorebook projection skipped:', e?.message);
                }
                const entry = {
                    key: LibraLoreKeys.entityFromName(entity.name || name),
                    comment: ENTITY_COMMENT,
                    content: JSON.stringify(entity, null, 2),
                    mode: 'normal',
                    insertorder: 50,
                    alwaysActive: false
                };
                const matchingEntityIndexes = [];
                lorebook.forEach((e, idx) => {
                    if (e.comment !== ENTITY_COMMENT) return false;
                    try {
                        const parsed = JSON.parse(e.content || '{}');
                        if (resolveCanonicalName(parsed.name || '', lorebook) === name) matchingEntityIndexes.push(idx);
                    } catch {
                        return false;
                    }
                });
                const existingIdx = matchingEntityIndexes[0] ?? -1;
                for (let i = matchingEntityIndexes.length - 1; i >= 1; i--) {
                    lorebook.splice(matchingEntityIndexes[i], 1);
                }
                if (existingIdx >= 0) lorebook[existingIdx] = entry;
                else lorebook.push(entry);
            }

            for (const [id, relation] of relationCache) {
                const entityA = resolveCanonicalName(relation.entityA || '', lorebook);
                const entityB = resolveCanonicalName(relation.entityB || '', lorebook);
                if (!entityA || !entityB || !liveEntityNames.has(entityA) || !liveEntityNames.has(entityB)) continue;
                relation.entityA = entityA;
                relation.entityB = entityB;
                relation.id = makeRelationId(entityA, entityB, lorebook);
                relation.meta = relation.meta || { created: currentTurn, updated: currentTurn, confidence: 0.3, source: '' };
                relation.meta.updated = currentTurn;
                normalizeRelationV2Fields(relation);
                const entry = {
                    key: LibraLoreKeys.relationFromNames(relation.entityA, relation.entityB),
                    comment: RELATION_COMMENT,
                    content: JSON.stringify(relation, null, 2),
                    mode: 'normal',
                    insertorder: 60,
                    alwaysActive: false
                };
                const matchingRelationIndexes = [];
                lorebook.forEach((e, idx) => {
                    if (e.comment !== RELATION_COMMENT) return false;
                    try {
                        const parsed = JSON.parse(e.content || '{}');
                        const parsedA = resolveCanonicalName(parsed.entityA || '', lorebook);
                        const parsedB = resolveCanonicalName(parsed.entityB || '', lorebook);
                        const parsedId = makeRelationId(parsedA || parsed.entityA || '', parsedB || parsed.entityB || '', lorebook);
                        if (parsedId === id || parsedId === relation.id) matchingRelationIndexes.push(idx);
                    } catch {
                        return false;
                    }
                });
                const existingIdx = matchingRelationIndexes[0] ?? -1;
                for (let i = matchingRelationIndexes.length - 1; i >= 1; i--) {
                    lorebook.splice(matchingRelationIndexes[i], 1);
                }
                if (existingIdx >= 0) lorebook[existingIdx] = entry;
                else lorebook.push(entry);
            }
        };

        return {
            refreshIdentity,
            normalizeName, resolveCanonicalName, makeRelationId, getOrCreateEntity, getOrCreateRelation,
            renameEntity, updateEntity, updateRelation, checkConsistency, formatEntityForPrompt,
            formatRelationForPrompt, formatEntityForProjection, formatRelationForProjection,
            formatRelationsForPrompt, clearCache, rebuildCache, saveToLorebook,
            normalizeEntityRecord: normalizeEntityShape,
            normalizeMoodText: normalizeEntityMoodText,
            normalizeMoodAtoms: normalizeEntityMoodAtoms,
            mentionsEntity, restoreRollbackSnapshot, discardRollbackSnapshot,
            getEntityCache: () => entityCache, getRelationCache: () => relationCache,
            pruneEntitiesForReanalysis, pruneBlockedEntries, isBlockedEntityName,
            collapseDuplicates: collapseClearlyDuplicateEntities,
            markEntityAbsorption, cancelEntityAbsorption, applyEntityAbsorption,
            listEntityAbsorptions, listPendingEntityAbsorptions,
            isActiveEntityRecord, isPromptVisibleEntityRecord,
            ENTITY_ABSORPTION_COMMENT
        };
    })();

    const normalizeRuntimeList = (items = [], limit = 20, itemMax = 220) => dedupeTextArray(
        (Array.isArray(items) ? items : [items])
            .map(item => String(item || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .map(item => item.length > itemMax ? item.slice(0, Math.max(0, itemMax - 1)).trimEnd() + '…' : item)
    ).slice(0, Math.max(0, Number(limit || 0)) || 20);
    const buildScopedManagedLoreKey = (comment = '', scopeKey = '') => {
        const normalizedComment = String(comment || 'lmai').trim() || 'lmai';
        const normalizedScope = String(scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
        const hash = typeof TokenizerEngine?.simpleHash === 'function'
            ? TokenizerEngine.simpleHash(normalizedScope)
            : stableHash(normalizedScope);
        return normalizedComment + '::' + hash;
    };
    const getManagedScopedEntryScope = (entry = null, parsed = null) => {
        const payload = parsed || (() => {
            try { return JSON.parse(entry?.content || '{}'); }
            catch { return null; }
        })();
        return String(
            payload?.scopeKey
            || payload?.scopeId
            || payload?.runtimeScopeId
            || payload?.engineState?.scopeKey
            || entry?.scopeKey
            || entry?.meta?.scopeKey
            || ''
        ).trim();
    };
    const findManagedScopedEntryIndex = (lorebook = [], comment = '', scopeKey = '') => {
        const normalizedComment = String(comment || '').trim();
        const normalizedScope = String(scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
        const matches = [];
        for (let i = 0; i < (Array.isArray(lorebook) ? lorebook.length : 0); i++) {
            const entry = lorebook[i];
            if (String(entry?.comment || '').trim() !== normalizedComment) continue;
            let parsed = null;
            try { parsed = JSON.parse(entry?.content || '{}'); } catch (error) {
                recordSuppressedRuntimeError('managed_scope.find_entry_parse_failed', error, {
                    comment: normalizedComment,
                    scopeKey: normalizedScope,
                    key: String(entry?.key || '').trim()
                });
            }
            matches.push({ index: i, entry, parsed, scope: getManagedScopedEntryScope(entry, parsed) });
        }
        const exact = matches.find(item => item.scope === normalizedScope);
        if (exact) return exact.index;
        const legacy = matches.find(item => !item.scope);
        return legacy ? legacy.index : -1;
    };
    const upsertManagedScopedEntry = (lorebook = [], comment = '', entry = {}, scopeKey = '') => {
        if (!Array.isArray(lorebook)) return -1;
        const idx = findManagedScopedEntryIndex(lorebook, comment, scopeKey);
        if (idx >= 0) {
            lorebook[idx] = entry;
            return idx;
        }
        lorebook.push(entry);
        return lorebook.length - 1;
    };

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Hidden Entity Candidate Store
    // Keeps weak/non-promoted entity observations out of official entity state.
    // ══════════════════════════════════════════════════════════════
    const EntityCandidateCore = (() => {
        const COMMENT = 'lmai_entity_candidates';
        const VERSION = 1;
        const MAX_ITEMS = 96;
        const MAX_EVIDENCE = 6;
        const NAME_MAX = 80;
        const SNIPPET_MAX = 320;
        let state = null;

        const makeEmptyState = (scopeKey = '', chatId = '') => ({
            version: VERSION,
            scopeKey: String(scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global',
            chatId: String(chatId || getActiveManagedChatId() || '').trim(),
            updatedAt: 0,
            items: []
        });
        const compact = (value = '', max = 240) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            return text.length > max ? text.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : text;
        };
        const normalizeCandidateKey = (value = '') => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase().trim();
        const normalizeCandidateName = (value = '', lorebook = []) => {
            const raw = compact(value, NAME_MAX);
            if (!raw) return '';
            try {
                return compact(EntityManager.normalizeName(raw, lorebook) || raw, NAME_MAX);
            } catch {
                return raw;
            }
        };
        const parseJsonObject = (text = '') => {
            try {
                const parsed = JSON.parse(String(text || '{}'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch {
                return {};
            }
        };
        const getOfficialEntityNameKeys = (lorebook = []) => {
            const keys = new Set();
            const add = (value = '') => {
                const normalized = normalizeCandidateName(value, lorebook);
                const key = normalizeCandidateKey(normalized || value);
                if (key) keys.add(key);
            };
            try {
                for (const name of EntityManager.getEntityCache().keys()) add(name);
                for (const entity of EntityManager.getEntityCache().values()) {
                    add(entity?.name || '');
                    if (Array.isArray(entity?.meta?.aliases)) entity.meta.aliases.forEach(add);
                }
            } catch { /* cache may be unavailable during early init */ }
            for (const entry of LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])) {
                if (entry?.comment !== 'lmai_entity') continue;
                const parsed = parseJsonObject(entry.content || '{}');
                add(parsed.name || '');
                if (Array.isArray(parsed?.meta?.aliases)) parsed.meta.aliases.forEach(add);
            }
            return keys;
        };
        const isOfficialEntityName = (name = '', lorebook = []) => {
            const normalized = normalizeCandidateName(name, lorebook);
            const key = normalizeCandidateKey(normalized || name);
            return !!key && getOfficialEntityNameKeys(lorebook).has(key);
        };
        const isBlockedCandidateName = (name = '', lorebook = []) => {
            const normalized = normalizeCandidateName(name, lorebook);
            try {
                return !normalized
                    || EntityManager.isBlockedEntityName(name, lorebook)
                    || EntityManager.isBlockedEntityName(normalized, lorebook);
            } catch {
                return !normalized;
            }
        };
        const normalizeEvidence = (evidence = {}, fallback = {}) => ({
            turn: Number(evidence.turn ?? fallback.turn ?? 0) || 0,
            source: compact(evidence.source || fallback.source || '', 96),
            reason: compact(evidence.reason || fallback.reason || '', 96),
            snippet: compact(evidence.snippet || fallback.snippet || '', SNIPPET_MAX),
            at: Number(evidence.at || Date.now())
        });
        const findSnippetAroundName = (name = '', context = {}) => {
            const haystack = compact([
                context.userText || context.inputText || '',
                context.aiText || context.responseText || ''
            ].filter(Boolean).join('\n'), 2200);
            const needle = String(name || '').trim();
            if (!haystack) return '';
            if (!needle) return compact(haystack, SNIPPET_MAX);
            const idx = haystack.indexOf(needle);
            if (idx < 0) return compact(haystack, SNIPPET_MAX);
            const start = Math.max(0, idx - 120);
            const end = Math.min(haystack.length, idx + needle.length + 180);
            return compact(haystack.slice(start, end), SNIPPET_MAX);
        };
        const sanitizeItem = (item = {}, lorebook = []) => {
            const normalizedName = normalizeCandidateName(item.normalizedName || item.name || '', lorebook);
            const name = compact(item.name || normalizedName, NAME_MAX);
            const key = normalizeCandidateKey(normalizedName || name);
            if (!name || !normalizedName || !key) return null;
            if (isBlockedCandidateName(name, lorebook) || isOfficialEntityName(normalizedName, lorebook)) return null;
            const sources = dedupeTextArray((Array.isArray(item.sources) ? item.sources : [item.source])
                .map(source => compact(source, 96))
                .filter(Boolean)).slice(0, 12);
            const reasons = dedupeTextArray((Array.isArray(item.reasons) ? item.reasons : [item.reason])
                .map(reason => compact(reason, 96))
                .filter(Boolean)).slice(0, 12);
            const evidence = (Array.isArray(item.evidence) ? item.evidence : [])
                .filter(entry => entry && typeof entry === 'object')
                .map(entry => normalizeEvidence(entry))
                .filter(entry => entry.source || entry.snippet)
                .slice(-MAX_EVIDENCE);
            const seenCount = Math.max(1, Number(item.seenCount || evidence.length || 1) || 1);
            const hasExtractionSource = sources.some(source => /entityExtraction|rejectedEntity|uncertain/i.test(source));
            const status = String(item.status || '').trim() === 'ignored'
                ? 'ignored'
                : (seenCount >= 2 && hasExtractionSource ? 'promotable' : 'candidate');
            return {
                id: compact(item.id || `cand_${TokenizerEngine.simpleHash(`${key}::${state?.scopeKey || ''}`)}`, 80),
                name,
                normalizedName,
                status,
                confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.35) || 0.35)),
                seenCount,
                firstSeenTurn: Number(item.firstSeenTurn || item.turn || 0) || 0,
                lastSeenTurn: Number(item.lastSeenTurn || item.turn || 0) || 0,
                sources,
                reasons,
                evidence
            };
        };
        const loadState = (lorebook = [], options = {}) => {
            const scopeKey = String(options?.scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            const chatId = String(options?.chatId || getActiveManagedChatId() || '').trim();
            const idx = findManagedScopedEntryIndex(lorebook, COMMENT, scopeKey);
            const entry = idx >= 0 ? lorebook[idx] : null;
            if (!entry) {
                state = makeEmptyState(scopeKey, chatId);
                return state;
            }
            const parsed = parseJsonObject(entry.content || '{}');
            state = {
                ...makeEmptyState(scopeKey, chatId),
                ...parsed,
                scopeKey,
                chatId,
                items: []
            };
            const seen = new Set();
            for (const item of (Array.isArray(parsed.items) ? parsed.items : [])) {
                const normalized = sanitizeItem(item, lorebook);
                const key = normalizeCandidateKey(normalized?.normalizedName || normalized?.name || '');
                if (!normalized || !key || seen.has(key)) continue;
                seen.add(key);
                state.items.push(normalized);
            }
            return state;
        };
        const saveState = (lorebook = [], options = {}) => {
            if (!Array.isArray(lorebook)) return false;
            if (!state) loadState(lorebook, options);
            const scopeKey = String(options?.scopeKey || state.scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            const chatId = String(options?.chatId || state.chatId || getActiveManagedChatId() || '').trim();
            state.scopeKey = scopeKey;
            state.chatId = chatId;
            state.version = VERSION;
            state.updatedAt = Date.now();
            state.items = (Array.isArray(state.items) ? state.items : [])
                .map(item => sanitizeItem(item, lorebook))
                .filter(Boolean)
                .sort((a, b) => Number(b.lastSeenTurn || 0) - Number(a.lastSeenTurn || 0) || Number(b.seenCount || 0) - Number(a.seenCount || 0))
                .slice(0, MAX_ITEMS);
            const idx = findManagedScopedEntryIndex(lorebook, COMMENT, scopeKey);
            if (state.items.length === 0) {
                if (idx >= 0) lorebook.splice(idx, 1);
                return true;
            }
            const entry = {
                key: buildScopedManagedLoreKey(COMMENT, scopeKey),
                comment: COMMENT,
                content: JSON.stringify(state),
                mode: 'normal',
                insertorder: 52,
                alwaysActive: false
            };
            return upsertManagedScopedEntry(lorebook, COMMENT, entry, scopeKey) >= 0;
        };
        const ensureLoaded = (lorebook = [], options = {}) => {
            const scopeKey = String(options?.scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            if (!state || state.scopeKey !== scopeKey) loadState(lorebook, options);
            return state || loadState(lorebook, options);
        };
        const upsertCandidate = (lorebook = [], candidate = {}, context = {}) => {
            if (!Array.isArray(lorebook)) return false;
            ensureLoaded(lorebook, context);
            const normalizedName = normalizeCandidateName(candidate.normalizedName || candidate.name || '', lorebook);
            const name = compact(candidate.name || normalizedName, NAME_MAX);
            const key = normalizeCandidateKey(normalizedName || name);
            if (!name || !normalizedName || !key) return false;
            if (isBlockedCandidateName(name, lorebook) || isOfficialEntityName(normalizedName, lorebook)) return false;
            const items = Array.isArray(state.items) ? state.items : [];
            const idx = items.findIndex(item => normalizeCandidateKey(item.normalizedName || item.name || '') === key);
            const turn = Number(context.turn || candidate.turn || 0) || 0;
            const source = compact(candidate.source || context.source || 'entity-candidate', 96);
            const reason = compact(candidate.reason || context.reason || 'not_promoted', 96);
            const evidence = normalizeEvidence({
                turn,
                source,
                reason,
                snippet: candidate.snippet || findSnippetAroundName(name, context)
            }, context);
            const previous = idx >= 0 ? items[idx] : null;
            const merged = sanitizeItem({
                ...(previous || {}),
                name: previous?.name || name,
                normalizedName,
                confidence: Math.max(Number(previous?.confidence || 0), Number(candidate.confidence ?? context.confidence ?? 0.35) || 0.35),
                seenCount: Number(previous?.seenCount || 0) + 1,
                firstSeenTurn: Number(previous?.firstSeenTurn || 0) || turn,
                lastSeenTurn: turn || Number(previous?.lastSeenTurn || 0) || 0,
                sources: dedupeTextArray([...(previous?.sources || []), source].filter(Boolean)),
                reasons: dedupeTextArray([...(previous?.reasons || []), reason].filter(Boolean)),
                evidence: [...(previous?.evidence || []), evidence].slice(-MAX_EVIDENCE)
            }, lorebook);
            if (!merged) return false;
            if (idx >= 0) items[idx] = merged;
            else items.push(merged);
            state.items = items;
            return true;
        };
        const collectExtractionCandidates = (rawExtraction = {}, sanitizedPayload = {}) => {
            const out = [];
            const push = (name, source, reason, confidence = 0.45) => {
                const normalized = compact(name, NAME_MAX);
                if (!normalized) return;
                out.push({ name: normalized, source, reason, confidence });
            };
            for (const item of (Array.isArray(sanitizedPayload.rejectedEntities) ? sanitizedPayload.rejectedEntities : [])) {
                push(item?.normalizedName || item?.name || '', 'entityExtraction.rejectedEntity', item?.reason || 'not_promoted', 0.45);
            }
            for (const item of (Array.isArray(rawExtraction?.uncertain) ? rawExtraction.uncertain : [])) {
                push(item?.normalizedName || item?.name || item?.entity || '', 'entityExtraction.uncertain', item?.reason || 'uncertain', 0.4);
            }
            const uncertainEntities = Array.isArray(rawExtraction?.uncertain?.entities) ? rawExtraction.uncertain.entities : [];
            for (const item of uncertainEntities) {
                push(item?.normalizedName || item?.name || item?.entity || '', 'entityExtraction.uncertainEntity', item?.reason || 'uncertain', 0.4);
            }
            for (const relation of (Array.isArray(sanitizedPayload.rejectedRelations) ? sanitizedPayload.rejectedRelations : [])) {
                push(relation?.entityA || '', 'entityExtraction.rejectedRelation', relation?.reason || 'relation_endpoint_not_promoted', 0.28);
                push(relation?.entityB || '', 'entityExtraction.rejectedRelation', relation?.reason || 'relation_endpoint_not_promoted', 0.28);
            }
            return out;
        };
        const recordExtractionCandidates = (lorebook = [], rawExtraction = {}, sanitizedPayload = {}, context = {}) => {
            let changed = false;
            for (const candidate of collectExtractionCandidates(rawExtraction, sanitizedPayload)) {
                changed = upsertCandidate(lorebook, candidate, {
                    ...context,
                    source: candidate.source,
                    reason: candidate.reason,
                    confidence: candidate.confidence
                }) || changed;
            }
            if (changed) saveState(lorebook, context);
            return { changed, count: Array.isArray(state?.items) ? state.items.length : 0 };
        };
        const recordInvolvedEntityCandidates = (lorebook = [], names = [], context = {}) => {
            let changed = false;
            for (const rawName of (Array.isArray(names) ? names : [])) {
                const name = compact(rawName, NAME_MAX);
                if (!name) continue;
                changed = upsertCandidate(lorebook, {
                    name,
                    source: context.source || 'maintenance.involvedEntities',
                    reason: context.reason || 'related_but_not_promoted',
                    confidence: Number(context.confidence ?? 0.35) || 0.35
                }, context) || changed;
            }
            if (changed) saveState(lorebook, context);
            return { changed, count: Array.isArray(state?.items) ? state.items.length : 0 };
        };
        const prunePromotedOrBlocked = (lorebook = [], context = {}) => {
            if (!Array.isArray(lorebook)) return { changed: false, count: 0 };
            ensureLoaded(lorebook, context);
            const before = Array.isArray(state.items) ? state.items.length : 0;
            state.items = (Array.isArray(state.items) ? state.items : []).filter(item => {
                const name = item?.normalizedName || item?.name || '';
                return name && !isBlockedCandidateName(name, lorebook) && !isOfficialEntityName(name, lorebook);
            });
            const changed = state.items.length !== before;
            if (changed) saveState(lorebook, context);
            return { changed, count: state.items.length };
        };
        const getState = () => state || makeEmptyState();
        return Object.freeze({
            COMMENT,
            loadState,
            saveState,
            getState,
            recordExtractionCandidates,
            recordInvolvedEntityCandidates,
            prunePromotedOrBlocked
        });
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] V4.2-style Secret Knowledge / POV Guard
    // Keeps undisclosed facts out of main prompt injection and character POV.
    // ══════════════════════════════════════════════════════════════
    const SecretKnowledgeCore = (() => {
        const COMMENT = 'lmai_secret_knowledge';
        const VERSION = 1;
        const SECRET_BLOCK_RE = /\[\[비밀([^\]]*)\]\]([\s\S]*?)\[\[\/비밀\]\]/gi;
        const REVEAL_TAG_RE = /\[\[공개\s+([^\]]*?)\]\]/gi;
        const REDACTED_SECRET_TEXT = '[비밀 기록됨: 본문 비공개]';
        const REVEAL_RECORDED_TEXT = '[비밀 공개 근거 기록됨]';
        const IMPLICIT_SECRET_CUE_RE = /(?:비밀|숨기|숨겨|감추|몰래|아무도\s*모르|모르면|알면\s*안|정체|본명|약점|진실|사실은|secret|hidden|concealed|no\s+one\s+knows|keep\s+(?:it\s+)?secret)/i;
        const IMPLICIT_SECRET_BOUNDARY_RE = /(?:유저만|사용자만|플레이어만|나만|나\s*혼자|본인만|캐릭터(?:들)?(?:은|가)?\s*모르|아무도\s*모르|누구(?:도|에게도)\s*(?:말|알리|공개).{0,30}(?:마|말|않|안)|비밀로\s*(?:남|유지|둬|해)|숨겨야|알면\s*안|모르게|only\s+(?:the\s+)?user|known\s+only\s+to|no\s+one\s+knows|do\s+not\s+(?:reveal|tell|show)|must\s+not\s+know)/i;
        const DIRECT_REVEAL_RE = /(말했|알렸|알려|고백|밝혔|공개|털어놓|보여줬|보여주|들려줬|전했|told|revealed|confessed|showed|disclosed|informed|said)/i;
        const STOPWORDS = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'was', 'were', 'are', '그리고', '하지만', '그러나', '그는', '그녀는', '했다', '한다', '있는', '없는', '에게', '으로', '에서']);
        const makeEmptyState = (scopeKey = '', chatId = '') => ({
            version: VERSION,
            scopeKey: String(scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global',
            chatId: String(chatId || getActiveManagedChatId() || '').trim(),
            secrets: []
        });
        let state = makeEmptyState();
        const compact = (value = '', max = 600) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            return text.length > max ? text.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : text;
        };
        const normalizeLoose = (value = '') => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        const normalizeKey = (value = '') => normalizeLoose(value).toLowerCase().replace(/\s+/g, '');
        const escapeRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const splitValues = (value = '') => String(value || '')
            .split(/[,\s|;、，]+/u)
            .map(item => item.trim())
            .filter(Boolean);
        const parseJsonObject = (text = '') => {
            try {
                const parsed = JSON.parse(String(text || '{}'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch {
                return {};
            }
        };
        const normalizeEntityForSecret = (name = '') => {
            const raw = String(name || '').trim();
            if (!raw) return '';
            try {
                return EntityManager?.normalizeName?.(raw) || normalizeKey(raw);
            } catch {
                return normalizeKey(raw);
            }
        };
        const isUserPersonaViewerName = (name = '') => /^(?:user|유저|사용자|player|pc|persona|나|본인)$/i.test(String(name || '').trim());
        const entityViewerId = (name = '') => {
            if (isUserPersonaViewerName(name)) return 'user';
            const normalized = normalizeEntityForSecret(name);
            return normalized ? `entity:${normalized}` : '';
        };
        const normalizeViewerId = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            const lowered = raw.toLowerCase();
            if (/^(?:user|유저|사용자|player|pc|persona|나|본인)$/.test(lowered)) return 'user';
            if (/^(?:planner|storyauthor|story_author|director)$/.test(lowered)) return 'planner';
            if (/^(?:main|main_request|model)$/.test(lowered)) return 'main_request';
            if (lowered.startsWith('entity:')) return entityViewerId(raw.slice(raw.indexOf(':') + 1));
            return entityViewerId(raw);
        };
        const normalizeViewerList = (values = []) => dedupeTextArray(
            (Array.isArray(values) ? values : splitValues(values))
                .map(normalizeViewerId)
                .filter(Boolean)
        );
        const parseAttributes = (source = '', options = {}) => {
            const out = {};
            const raw = String(source || '').trim();
            raw.replace(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g, (match, key, dq, sq, bare) => {
                out[String(key || '').trim().toLowerCase()] = String(dq ?? sq ?? bare ?? '').trim();
                return match;
            });
            const withoutPairs = raw.replace(/([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]+)/g, ' ').trim();
            const bareTokens = splitValues(withoutPairs);
            if (options.bareKey && bareTokens.length > 0 && !out[options.bareKey]) out[options.bareKey] = bareTokens[0];
            return out;
        };
        const pickAttr = (attrs = {}, keys = [], fallback = '') => {
            for (const key of keys) {
                const normalized = String(key || '').trim().toLowerCase();
                if (attrs[normalized] != null && String(attrs[normalized]).trim()) return String(attrs[normalized]).trim();
            }
            return fallback;
        };
        const buildSecretId = (secret = {}) => `sk_${TokenizerEngine.simpleHash([
            secret.title || '',
            secret.content || '',
            Array.isArray(secret.about) ? secret.about.join('|') : '',
            state.scopeKey || ''
        ].join('::'))}`;
        const normalizeSecret = (secret = {}) => {
            const source = secret && typeof secret === 'object' ? secret : {};
            const about = dedupeTextArray(
                (Array.isArray(source.about) ? source.about : splitValues(source.about || source.target || ''))
                    .map(item => compact(item, 80))
                    .filter(Boolean)
            ).slice(0, 12);
            const content = compact(source.content || source.text || source.summary || '', 1800);
            const title = compact(source.title || source.name || '', 120) || (about.length ? `${about[0]} secret` : 'protected secret');
            const knownBy = normalizeViewerList(source.knownBy && source.knownBy.length ? source.knownBy : ['user']);
            const next = {
                id: compact(source.id || '', 80),
                title,
                content,
                about,
                owner: normalizeViewerId(source.owner || 'user') || 'user',
                knownBy: knownBy.length ? knownBy : ['user'],
                sensitivity: compact(source.sensitivity || 'normal', 40) || 'normal',
                status: compact(source.status || 'active', 40) || 'active',
                source: compact(source.source || 'explicit-tag', 120) || 'explicit-tag',
                evidenceLog: Array.isArray(source.evidenceLog)
                    ? source.evidenceLog.filter(item => item && typeof item === 'object').map(item => ({
                        turn: Number(item.turn || 0),
                        viewerId: normalizeViewerId(item.viewerId || item.viewer || '') || '',
                        source: compact(item.source || '', 80),
                        note: compact(item.note || '', 180),
                        at: Number(item.at || Date.now())
                    })).slice(-24)
                    : []
            };
            if (!next.id) next.id = buildSecretId(next);
            return next;
        };
        const getActiveSecrets = () => (Array.isArray(state.secrets) ? state.secrets : [])
            .map(normalizeSecret)
            .filter(secret => String(secret.status || 'active').toLowerCase() !== 'archived' && (secret.content || secret.title));
        const loadState = (lorebook = [], options = {}) => {
            const scopeKey = String(options?.scopeKey || options?.scopeId || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            const chatId = String(options?.chatId || getActiveManagedChatId() || '').trim();
            const idx = findManagedScopedEntryIndex(lorebook, COMMENT, scopeKey);
            const entry = idx >= 0 ? lorebook[idx] : null;
            if (!entry) {
                state = makeEmptyState(scopeKey, chatId);
                return state;
            }
            const parsed = parseJsonObject(entry.content || '{}');
            state = {
                ...makeEmptyState(scopeKey, chatId),
                ...parsed,
                scopeKey,
                chatId,
                secrets: (Array.isArray(parsed.secrets) ? parsed.secrets : []).map(normalizeSecret).filter(secret => secret.content || secret.title)
            };
            return state;
        };
        const saveState = (lorebook = [], options = {}) => {
            if (!Array.isArray(lorebook)) return false;
            const scopeKey = String(options?.scopeKey || state.scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            const chatId = String(options?.chatId || state.chatId || getActiveManagedChatId() || '').trim();
            state.scopeKey = scopeKey;
            state.chatId = chatId;
            state.version = VERSION;
            state.secrets = getActiveSecrets();
            const entry = {
                key: buildScopedManagedLoreKey(COMMENT, scopeKey),
                comment: COMMENT,
                content: JSON.stringify(state),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            };
            return upsertManagedScopedEntry(lorebook, COMMENT, entry, scopeKey) >= 0;
        };
        const upsertSecret = (incoming = {}, meta = {}) => {
            const next = normalizeSecret({ ...incoming, source: incoming.source || meta.source || 'explicit-tag' });
            if (!next.content) return { changed: false, secret: null };
            const fingerprint = normalizeKey(`${next.title}|${next.content}|${next.about.join('|')}`);
            const secrets = Array.isArray(state.secrets) ? state.secrets : [];
            const idx = secrets.findIndex(secret =>
                String(secret.id || '') === String(next.id || '')
                || normalizeKey(`${secret.title}|${secret.content}|${(secret.about || []).join('|')}`) === fingerprint
            );
            const evidence = {
                turn: Number(meta.turn || 0),
                viewerId: 'user',
                source: compact(meta.source || next.source || 'secret', 80),
                note: compact(meta.note || 'secret registered', 180),
                at: Date.now()
            };
            if (idx >= 0) {
                const merged = normalizeSecret({
                    ...secrets[idx],
                    ...next,
                    knownBy: dedupeTextArray([...(secrets[idx].knownBy || []), ...(next.knownBy || [])]),
                    evidenceLog: [...(secrets[idx].evidenceLog || []), evidence]
                });
                const changed = JSON.stringify(secrets[idx]) !== JSON.stringify(merged);
                secrets[idx] = merged;
                state.secrets = secrets;
                return { changed, secret: merged };
            }
            next.evidenceLog = [...(next.evidenceLog || []), evidence].slice(-24);
            state.secrets = [...secrets, next];
            return { changed: true, secret: next };
        };
        const parseSecretBlocks = (text = '') => {
            const blocks = [];
            String(text || '').replace(SECRET_BLOCK_RE, (full, attrText, body, offset) => {
                const attrs = parseAttributes(attrText || '');
                const knownRaw = pickAttr(attrs, ['알고있음', '알고있는', 'knownby', 'known']);
                blocks.push({
                    full,
                    offset,
                    title: pickAttr(attrs, ['제목', 'title', 'name'], ''),
                    about: splitValues(pickAttr(attrs, ['대상', 'target', 'about'], '')),
                    owner: pickAttr(attrs, ['owner', '소유자'], 'user'),
                    knownBy: knownRaw ? splitValues(knownRaw) : ['user'],
                    sensitivity: pickAttr(attrs, ['sensitivity', '민감도'], 'normal'),
                    content: String(body || '').trim()
                });
                return full;
            });
            return blocks;
        };
        const parseRevealTags = (text = '') => {
            const tags = [];
            String(text || '').replace(REVEAL_TAG_RE, (full, attrText, offset) => {
                const attrs = parseAttributes(attrText || '', { bareKey: 'id' });
                const id = pickAttr(attrs, ['id', 'secretid', 'secret', '비밀'], attrs.id || '');
                const targetRaw = pickAttr(attrs, ['대상', 'target', 'to', 'viewer', '알림대상'], '');
                tags.push({ full, offset, id, targets: splitValues(targetRaw) });
                return full;
            });
            return tags;
        };
        const redactSecretTagsInText = (text = '') => String(text || '')
            .replace(SECRET_BLOCK_RE, REDACTED_SECRET_TEXT)
            .replace(REVEAL_TAG_RE, REVEAL_RECORDED_TEXT);
        const detectImplicitSecretCandidates = (text = '', options = {}) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return [];
            const role = String(options?.role || '').trim().toLowerCase();
            if (role && !['user', 'human'].includes(role)) return [];
            const lines = redactSecretTagsInText(text)
                .replace(/\r\n/g, '\n')
                .split(/\n+/)
                .map(line => compact(line, 900))
                .filter(Boolean)
                .slice(0, 8);
            const out = [];
            for (const line of lines) {
                if (!IMPLICIT_SECRET_CUE_RE.test(line) || !IMPLICIT_SECRET_BOUNDARY_RE.test(line)) continue;
                out.push({
                    title: '자동 감지 비밀',
                    content: line,
                    about: [],
                    owner: 'user',
                    knownBy: ['user'],
                    sensitivity: 'normal',
                    source: 'implicit-auto'
                });
                if (out.length >= 3) break;
            }
            return out;
        };
        const addKnownBy = (secretId = '', viewers = [], meta = {}) => {
            const normalizedViewers = normalizeViewerList(viewers);
            if (!secretId || normalizedViewers.length === 0) return false;
            const secret = (state.secrets || []).find(item => String(item.id || '') === String(secretId || ''));
            if (!secret) return false;
            const before = new Set(secret.knownBy || []);
            normalizedViewers.forEach(viewer => before.add(viewer));
            const nextKnown = Array.from(before).filter(Boolean);
            const changed = nextKnown.length !== (secret.knownBy || []).length;
            if (!changed) return false;
            secret.knownBy = nextKnown;
            secret.evidenceLog = [
                ...(Array.isArray(secret.evidenceLog) ? secret.evidenceLog : []),
                ...normalizedViewers.map(viewerId => ({
                    turn: Number(meta.turn || 0),
                    viewerId,
                    source: compact(meta.source || 'scene-evidence', 80),
                    note: compact(meta.note || 'secret revealed by scene evidence', 180),
                    at: Date.now()
                }))
            ].slice(-24);
            state.secrets = state.secrets.map(item => item.id === secret.id ? normalizeSecret(secret) : item);
            return true;
        };
        const ingestFromMessages = (messages = [], options = {}) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return { changed: false, state: safeClone(state) };
            state.scopeKey = String(options?.scopeKey || state.scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            state.chatId = String(options?.chatId || state.chatId || getActiveManagedChatId() || '').trim();
            let changed = false;
            for (const msg of (Array.isArray(messages) ? messages : [])) {
                const role = String(msg?.role || '').trim().toLowerCase();
                const sourceText = String(Utils.getMessageText?.(msg) || msg?.content || '').trim();
                if (!sourceText) continue;
                for (const block of parseSecretBlocks(sourceText)) {
                    const result = upsertSecret({
                        title: block.title,
                        content: block.content,
                        about: block.about,
                        owner: block.owner,
                        knownBy: block.knownBy,
                        sensitivity: block.sensitivity,
                        source: role ? `explicit-tag:${role}` : 'explicit-tag'
                    }, { turn: options.turn, source: role ? `explicit-tag:${role}` : 'explicit-tag', note: 'secret tag captured' });
                    changed = result.changed || changed;
                }
                for (const tag of parseRevealTags(sourceText)) {
                    if (!tag.id) continue;
                    changed = addKnownBy(tag.id, tag.targets, { turn: options.turn, source: role ? `explicit-reveal:${role}` : 'explicit-reveal', note: 'explicit reveal tag captured' }) || changed;
                }
                for (const implicit of detectImplicitSecretCandidates(sourceText, { role })) {
                    const result = upsertSecret(implicit, { turn: options.turn, source: role ? `implicit-auto:${role}` : 'implicit-auto', note: 'conservative implicit secret cue captured' });
                    changed = result.changed || changed;
                }
            }
            return { changed, state: safeClone(state) };
        };
        const ingestFromEntities = (entities = [], options = {}) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return { changed: false, count: 0 };
            let changed = false;
            let count = 0;
            for (const entity of (Array.isArray(entities) ? entities : [])) {
                const name = String(entity?.name || '').trim();
                const secrets = [
                    ...(Array.isArray(entity?.background?.secrets) ? entity.background.secrets : []),
                    ...(Array.isArray(entity?.secrets) ? entity.secrets : []),
                    ...(Array.isArray(entity?.privateKnowledge) ? entity.privateKnowledge : [])
                ].map(value => String(value || '').trim()).filter(Boolean);
                for (const secretText of secrets.slice(0, 12)) {
                    const result = upsertSecret({
                        title: name ? `${name} 비공개 사실` : '비공개 사실',
                        content: secretText,
                        about: name ? [name] : [],
                        owner: 'user',
                        knownBy: ['user'],
                        source: options.source || 'entity-secret-field'
                    }, { turn: options.turn, source: options.source || 'entity-secret-field', note: 'entity secret field protected' });
                    if (result.changed) {
                        changed = true;
                        count += 1;
                    }
                }
            }
            return { changed, count };
        };
        const viewerSetFor = (viewerId = '') => {
            const normalized = normalizeViewerId(viewerId);
            const set = new Set([normalized].filter(Boolean));
            if (normalized === 'user') set.add('player');
            return set;
        };
        const isAllowedForViewer = (secret = {}, viewerId = '') => {
            const normalized = normalizeViewerId(viewerId);
            if (!normalized) return false;
            const known = new Set(normalizeViewerList(secret.knownBy || []));
            for (const alias of viewerSetFor(normalized)) {
                if (known.has(alias)) return true;
            }
            return false;
        };
        const replaceLiteral = (text = '', value = '', replacement = REDACTED_SECRET_TEXT) => {
            const source = String(text || '');
            const raw = String(value || '').trim();
            if (!raw || raw.length < 3 || !source) return source;
            return source.replace(new RegExp(escapeRegex(raw), 'gi'), replacement);
        };
        const redactForViewer = (text = '', viewerId = 'planner', options = {}) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return String(text || '');
            let out = redactSecretTagsInText(text);
            const viewer = normalizeViewerId(viewerId || 'planner') || 'planner';
            for (const secret of getActiveSecrets()) {
                if (isAllowedForViewer(secret, viewer)) continue;
                out = replaceLiteral(out, secret.content, options.replacement || REDACTED_SECRET_TEXT);
                out = replaceLiteral(out, secret.title, options.replacement || '[비밀 제목 비공개]');
            }
            return out;
        };
        const redactPayloadForViewer = (value, viewerId = 'planner') => {
            if (typeof value === 'string') return redactForViewer(value, viewerId);
            if (Array.isArray(value)) return value.map(item => redactPayloadForViewer(item, viewerId));
            if (value && typeof value === 'object') {
                const next = {};
                for (const [key, nested] of Object.entries(value)) {
                    const loweredKey = String(key || '').trim().toLowerCase();
                    if (/(?:^|[_.-])(secrets?|privateSecrets?|hiddenSecrets?)(?:$|[_.-])/i.test(loweredKey) || loweredKey === 'secrets') {
                        next[key] = Array.isArray(nested) ? [] : '[비밀 필드 비공개]';
                        continue;
                    }
                    next[key] = redactPayloadForViewer(nested, viewerId);
                }
                return next;
            }
            return value;
        };
        const redactMessages = (messages = [], viewerId = 'main_request') => (Array.isArray(messages) ? messages : []).map(msg => ({
            ...msg,
            content: redactForViewer(String(msg?.content ?? Utils.getMessageText?.(msg) ?? ''), viewerId)
        }));
        const getKnownSecretsForViewer = (viewerId = '') => getActiveSecrets().filter(secret => isAllowedForViewer(secret, viewerId));
        const getHiddenSecretsForViewer = (viewerId = '') => getActiveSecrets().filter(secret => !isAllowedForViewer(secret, viewerId));
        const buildSecrecyGuardPrompt = (options = {}) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return '';
            const viewerId = normalizeViewerId(options.viewerId || 'main_request') || 'main_request';
            const hidden = getHiddenSecretsForViewer(viewerId);
            if (!hidden.length) return '';
            const focusNames = dedupeTextArray((Array.isArray(options.focusNames) ? options.focusNames : [])
                .map(item => typeof item === 'string' ? item : item?.name)
                .map(item => compact(item, 80))
                .filter(Boolean)).slice(0, 8);
            const aboutCounts = new Map();
            hidden.forEach(secret => {
                const about = Array.isArray(secret.about) && secret.about.length ? secret.about : ['unscoped'];
                about.slice(0, 3).forEach(item => aboutCounts.set(item, (aboutCounts.get(item) || 0) + 1));
            });
            const aboutLine = Array.from(aboutCounts.entries()).slice(0, 8).map(([name, count]) => `${name}:${count}`).join(', ');
            return [
                '[비밀 유지 / Secrecy Guard]',
                `${hidden.length} protected undisclosed fact(s) exist outside the active viewer knowledge.`,
                focusNames.length ? `Active focus: ${focusNames.join(', ')}` : '',
                aboutLine ? `Protected scopes: ${aboutLine}` : '',
                'Do not reveal, paraphrase, hint, infer, or let any character act on protected information unless the scene explicitly made that character a knower.',
                'Characters may react only to visible behavior, shared/public facts, or facts explicitly told to them in-scene.',
                'Hidden facts may affect long-term continuity bookkeeping, but must not surface as dialogue, narration, body reaction, or decision.'
            ].filter(Boolean).join('\n');
        };
        const buildCharacterKnowledgeBoundaryPrompt = (focusNames = []) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return '';
            const names = dedupeTextArray((Array.isArray(focusNames) ? focusNames : [])
                .map(item => typeof item === 'string' ? item : item?.name)
                .map(item => compact(item, 80))
                .filter(Boolean)).slice(0, 8);
            if (!names.length || !getActiveSecrets().length) return '';
            const lines = names.map(name => {
                const viewerId = entityViewerId(name);
                const known = getKnownSecretsForViewer(viewerId).length;
                const hidden = getHiddenSecretsForViewer(viewerId).length;
                return `- ${name}: known protected facts=${known}; hidden facts=${hidden}. Speak and act only from known facts plus visible scene evidence.`;
            });
            lines.push('- If a fact is in LIBRA memory but not visible to a character, that character must not reveal it through dialogue, narration, body reaction, or decision.');
            return ['[Character Knowledge Boundaries]', ...lines].join('\n');
        };
        const tokenizeAuditText = (value = '', limit = 48) => dedupeTextArray(String(value || '')
            .normalize('NFKC')
            .toLowerCase()
            .split(/[^0-9a-z가-힣]+/iu)
            .map(token => token.trim())
            .filter(token => token.length >= 2 && token.length <= 32 && !STOPWORDS.has(token))
        ).slice(0, Math.max(4, Number(limit || 48)));
        const splitAuditSentences = (value = '') => String(value || '')
            .split(/\n+/)
            .flatMap(line => {
                const trimmed = line.trim();
                if (!trimmed) return [];
                return trimmed.match(/[^.!?。！？]+[.!?。！？]?/gu) || [trimmed];
            })
            .map(part => part.trim())
            .filter(Boolean)
            .slice(0, 140);
        const auditResponseForLeaks = (text = '', options = {}) => {
            const source = String(text || '');
            if (!source || MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return { changed: false, text: source, leaks: [], checked: false };
            const viewer = normalizeViewerId(options.viewerId || 'main_request') || 'main_request';
            const replacement = String(options.replacement || '말해지지 않은 사실').trim() || '말해지지 않은 사실';
            const sentenceReplacement = String(options.sentenceReplacement || '그 사실은 겉으로 드러나지 않았다.').trim() || '그 사실은 겉으로 드러나지 않았다.';
            let out = source;
            const leaks = [];
            for (const secret of getHiddenSecretsForViewer(viewer)) {
                const before = out;
                const content = String(secret.content || '').trim();
                const title = compact(secret.title || '', 120);
                if (content.length >= 8 && normalizeKey(out).includes(normalizeKey(content))) out = replaceLiteral(out, content, replacement);
                if (!/^(?:자동 감지 비밀|protected secret|known secret|secret|비밀)$/i.test(title) && title.length >= 6 && normalizeKey(out).includes(normalizeKey(title))) out = replaceLiteral(out, title, '숨겨진 사실');
                if (out !== before) {
                    leaks.push({ id: secret.id || '', kind: 'literal', title, about: Array.isArray(secret.about) ? secret.about.slice(0, 4) : [] });
                    continue;
                }
                const recordTokens = tokenizeAuditText(content, 48);
                if (recordTokens.length < 4) continue;
                for (const sentence of splitAuditSentences(out)) {
                    const sentenceTokens = new Set(tokenizeAuditText(sentence, 64));
                    const matched = recordTokens.filter(token => sentenceTokens.has(token));
                    const hitRatio = matched.length / Math.max(1, Math.min(recordTokens.length, 12));
                    const cueHit = /(?:비밀|진실|정체|사실은|숨기|감추|몰랐|알고 있었|secret|truth|identity|hidden|knew)/i.test(sentence);
                    if (!(matched.length >= 4 && hitRatio >= 0.42) && !(matched.length >= 3 && hitRatio >= 0.34 && cueHit)) continue;
                    const next = out.replace(sentence, sentenceReplacement);
                    if (next === out) continue;
                    out = next;
                    leaks.push({ id: secret.id || '', kind: 'semantic_sentence', title, matchedTokens: matched.slice(0, 8), hitRatio: Number(hitRatio.toFixed(3)) });
                    break;
                }
            }
            return { changed: out !== source, text: out, leaks, checked: true, viewerId: viewer };
        };
        const applySceneEvidenceReveal = (options = {}) => {
            if (MemoryEngine?.CONFIG?.secretKnowledgeEnabled === false) return { changed: false };
            const texts = (Array.isArray(options.texts) ? options.texts : [options.text])
                .map(text => redactSecretTagsInText(text))
                .map(normalizeLoose)
                .filter(Boolean);
            const focusViewers = normalizeViewerList((Array.isArray(options.focusNames) ? options.focusNames : []).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean));
            if (!texts.length || !focusViewers.length) return { changed: false };
            let changed = false;
            for (const text of texts) {
                if (!DIRECT_REVEAL_RE.test(text)) continue;
                const haystack = normalizeKey(text);
                for (const secret of getActiveSecrets()) {
                    const contentKey = normalizeKey(secret.content);
                    const titleKey = normalizeKey(secret.title);
                    const contentHit = contentKey.length >= 6 && haystack.includes(contentKey);
                    const titleHit = titleKey.length >= 3 && haystack.includes(titleKey) && /비밀|secret|진실|fact|사실/i.test(text);
                    if (!contentHit && !titleHit) continue;
                    changed = addKnownBy(secret.id, focusViewers, { turn: options.turn, source: 'scene-evidence', note: 'direct visible reveal wording matched' }) || changed;
                }
            }
            return { changed, state: safeClone(state) };
        };
        const listSecrets = () => getActiveSecrets().map(secret => ({
            id: secret.id,
            title: secret.title,
            content: secret.content,
            about: secret.about || [],
            owner: secret.owner || 'user',
            knownBy: secret.knownBy || [],
            sensitivity: secret.sensitivity || 'normal',
            status: secret.status || 'active',
            evidenceLog: Array.isArray(secret.evidenceLog) ? secret.evidenceLog.slice(-8) : []
        }));
        const deleteSecret = (secretId = '') => {
            const id = String(secretId || '').trim();
            if (!id) return false;
            const before = Array.isArray(state.secrets) ? state.secrets.length : 0;
            state.secrets = (Array.isArray(state.secrets) ? state.secrets : []).filter(secret => String(secret?.id || '') !== id);
            return state.secrets.length !== before;
        };
        const manualReveal = (secretId = '', viewer = '', meta = {}) => addKnownBy(secretId, [viewer], { ...meta, source: meta?.source || 'manual-reveal', note: meta?.note || 'manual reveal' });
        const renameEntityReferences = (options = {}) => {
            const oldName = compact(options.oldName || '', 80);
            const newName = compact(options.newName || '', 80);
            const oldViewerId = String(options.oldViewerId || '').trim();
            const newViewerId = String(options.newViewerId || '').trim();
            if (!oldName || !newName || !oldViewerId || !newViewerId || oldViewerId === newViewerId) return { changed: false };
            const oldNameKeys = new Set([oldName, ...(Array.isArray(options.previousNames) ? options.previousNames : [])]
                .map(normalizeKey)
                .filter(Boolean));
            const replaceViewer = (value = '') => String(value || '').trim() === oldViewerId ? newViewerId : String(value || '').trim();
            let changed = false;
            state.secrets = (Array.isArray(state.secrets) ? state.secrets : []).map(secret => {
                const next = { ...secret };
                const about = Array.isArray(next.about) ? next.about : [];
                const nextAbout = dedupeTextArray(about.map(item => oldNameKeys.has(normalizeKey(item)) ? newName : item).filter(Boolean)).slice(0, 12);
                if (JSON.stringify(nextAbout) !== JSON.stringify(about)) changed = true;
                next.about = nextAbout;
                const nextOwner = replaceViewer(next.owner || '');
                if (nextOwner !== next.owner) changed = true;
                next.owner = nextOwner || next.owner;
                const knownBy = Array.isArray(next.knownBy) ? next.knownBy : [];
                const nextKnownBy = dedupeTextArray(knownBy.map(replaceViewer).filter(Boolean));
                if (JSON.stringify(nextKnownBy) !== JSON.stringify(knownBy)) changed = true;
                next.knownBy = nextKnownBy;
                if (Array.isArray(next.evidenceLog)) {
                    next.evidenceLog = next.evidenceLog.map(item => {
                        if (!item || typeof item !== 'object') return item;
                        const viewerId = replaceViewer(item.viewerId || '');
                        if (viewerId !== item.viewerId) changed = true;
                        return { ...item, viewerId };
                    });
                }
                return next;
            });
            if (changed) state.secrets = state.secrets.map(normalizeSecret);
            return { changed };
        };
        const getState = () => state;
        const resetState = (next = null) => {
            state = next && typeof next === 'object'
                ? { ...makeEmptyState(next.scopeKey, next.chatId), ...safeClone(next), secrets: (Array.isArray(next.secrets) ? next.secrets : []).map(normalizeSecret) }
                : makeEmptyState();
            return state;
        };
        const selfCheck = () => ({
            ok: true,
            core: 'SecretKnowledgeCore',
            comment: COMMENT,
            enabled: MemoryEngine?.CONFIG?.secretKnowledgeEnabled !== false,
            secrets: getActiveSecrets().length,
            scopeKey: state.scopeKey || ''
        });
        return Object.freeze({
            COMMENT,
            REDACTED_SECRET_TEXT,
            loadState,
            saveState,
            ingestFromMessages,
            ingestFromEntities,
            redactForViewer,
            redactPayloadForViewer,
            redactMessages,
            buildSecrecyGuardPrompt,
            buildCharacterKnowledgeBoundaryPrompt,
            auditResponseForLeaks,
            applySceneEvidenceReveal,
            getKnownSecretsForViewer,
            getHiddenSecretsForViewer,
            entityViewerId,
            listSecrets,
            deleteSecret,
            manualReveal,
            renameEntityReferences,
            getState,
            resetState,
            selfCheck
        });
    })();

    const EntityKnowledgeVaultCore = (() => {
        const COMMENT = 'lmai_entity_knowledge_vault';
        const VERSION = 3;
        const MAX_RECORDS_PER_ENTITY = 16;
        const MAX_ACTIVE_PROMPT_RECORDS = 6;
        const MEMORY_TYPES = new Set(['experienced', 'witnessed', 'heard', 'inferred', 'rumor', 'private_thought', 'public_fact']);
        const KNOWLEDGE_STATES = new Set(['known', 'suspected', 'uncertain', 'misunderstood', 'forgotten', 'hidden']);
        const PRIVACY_LEVELS = new Set(['public', 'shared', 'private', 'secret', 'internal']);
        const PRIVATE_THOUGHT_PATTERN = /(?:속으로|마음속으로|속마음|내심|말하지 않고|혼잣말처럼|생각했다|생각하며|생각한다|thought to (?:himself|herself|themself|itself)|internally|inwardly|kept .* to (?:himself|herself|themself)|without saying)/i;
        const RUMOR_PATTERN = /(?:소문|들었다|전해졌다|누가 그러던데|라고 들|라는 말을 들|rumou?r|heard that|they say|word is|it is said)/i;
        const MISUNDERSTOOD_PATTERN = /(?:오해|착각|잘못 알|misunderstood|mistook|wrongly believed|misread)/i;
        const SUSPICION_PATTERN = /(?:의심|수상|숨기고 있|무언가 숨|suspect|suspicious|doubt|seems to be hiding)/i;
        const makeEmptyState = (scopeKey = '', chatId = '') => ({
            version: VERSION,
            scopeKey: String(scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global',
            chatId: String(chatId || getActiveManagedChatId() || '').trim(),
            vaults: {}
        });
        let state = makeEmptyState();
        let activeLorebookRef = null;
        const compact = (value = '', max = 420) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            return text.length > max ? text.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : text;
        };
        const parseJsonObject = (text = '') => {
            try {
                const parsed = JSON.parse(String(text || '{}'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch {
                return {};
            }
        };
        const viewerIdForEntity = (name = '') => SecretKnowledgeCore.entityViewerId(name);
        const normalizeMemoryType = (value = '') => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            return MEMORY_TYPES.has(normalized) ? normalized : 'witnessed';
        };
        const normalizeKnowledgeState = (value = '') => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            return KNOWLEDGE_STATES.has(normalized) ? normalized : 'known';
        };
        const normalizePrivacy = (value = '') => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            return PRIVACY_LEVELS.has(normalized) ? normalized : 'private';
        };
        const normalizeEntityId = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (/^entity:/i.test(raw)) return viewerIdForEntity(raw.slice(raw.indexOf(':') + 1));
            return viewerIdForEntity(raw);
        };
        const normalizeEntityIdList = (values = [], limit = 16) => dedupeTextArray(
            (Array.isArray(values) ? values : String(values || '').split(/[,\s|;、，]+/u))
                .map(item => typeof item === 'string' ? item : item?.viewerId || item?.id || item?.name)
                .map(normalizeEntityId)
                .filter(Boolean)
        ).slice(0, Math.max(0, Number(limit || 16)));
        const normalizeLifecycleStatus = (value = '') => {
            const status = String(value || 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
            return ['active', 'deleted', 'superseded', 'shadowed', 'invalidated', 'archived'].includes(status) ? status : 'active';
        };
        const isLifecycleInactive = (value = '') => normalizeLifecycleStatus(value) !== 'active';
        const normalizeVaultRecord = (raw = {}, fallback = {}) => {
            const source = typeof raw === 'string' ? { text: raw } : (raw && typeof raw === 'object' ? raw : {});
            const ownerEntityId = normalizeEntityId(source.ownerEntityId || fallback.ownerEntityId || fallback.viewerId || '');
            const text = compact(source.text || source.content || source.body || source.summary || fallback.text || '', 360);
            const summary = compact(source.summary || text, 180);
            if (!text && !summary) return null;
            let memoryType = normalizeMemoryType(source.memoryType || fallback.memoryType || 'witnessed');
            let knowledgeState = normalizeKnowledgeState(source.knowledgeState || fallback.knowledgeState || 'known');
            let privacy = normalizePrivacy(source.privacy || fallback.privacy || 'private');
            if (memoryType === 'private_thought') privacy = 'internal';
            if (memoryType === 'public_fact') privacy = 'public';
            if (privacy === 'internal' && memoryType === 'witnessed') memoryType = 'private_thought';
            const visibleFallback = ownerEntityId ? [ownerEntityId] : [];
            const visibleToEntityIds = normalizeEntityIdList(source.visibleToEntityIds || source.visibleTo || fallback.visibleToEntityIds || visibleFallback, 12);
            const deniedToEntityIds = normalizeEntityIdList(source.deniedToEntityIds || source.deniedTo || fallback.deniedToEntityIds || [], 12);
            const uncertain = ['suspected', 'uncertain', 'misunderstood'].includes(knowledgeState);
            let canRevealAsFact = source.canRevealAsFact;
            if (canRevealAsFact == null) canRevealAsFact = ['public', 'shared'].includes(privacy);
            let requiresSuspicionLanguage = source.requiresSuspicionLanguage;
            if (requiresSuspicionLanguage == null) requiresSuspicionLanguage = uncertain;
            if (['private', 'secret', 'internal'].includes(privacy)) canRevealAsFact = false;
            if (uncertain) requiresSuspicionLanguage = true;
            const normalized = {
                id: String(source.id || TokenizerEngine.simpleHash([source.turn || fallback.turn || 0, ownerEntityId, text || summary, source.source || fallback.source || ''].join('|')) || '').trim(),
                turn: Math.max(0, Number(source.turn || fallback.turn || 0) || 0),
                at: Math.max(0, Number(source.at || fallback.at || Date.now()) || Date.now()),
                ownerEntityId,
                ownerEntityName: compact(source.ownerEntityName || fallback.ownerEntityName || '', 80),
                text,
                summary,
                memoryType,
                knowledgeState,
                privacy,
                source: compact(source.source || fallback.source || 'scene-observation', 80),
                evidence: compact(source.evidence || fallback.evidence || '', 140),
                visibleToEntityIds,
                deniedToEntityIds,
                confidence: Math.max(0, Math.min(1, Number(source.confidence ?? fallback.confidence ?? 0.7))),
                canUseInDialogue: source.canUseInDialogue !== false,
                canRevealAsFact: !!canRevealAsFact,
                requiresSuspicionLanguage: !!requiresSuspicionLanguage,
                status: normalizeLifecycleStatus(source.status || fallback.status || 'active')
            };
            if (!normalized.visibleToEntityIds.length && normalized.ownerEntityId) normalized.visibleToEntityIds = [normalized.ownerEntityId];
            return normalized;
        };
        const normalizeVault = (viewerId = '', raw = {}) => ({
            viewerId,
            entityName: compact(raw?.entityName || '', 80),
            schemaVersion: VERSION,
            records: (Array.isArray(raw?.records) ? raw.records : [])
                .map(record => normalizeVaultRecord(record, {
                    ownerEntityId: viewerId,
                    ownerEntityName: raw?.entityName || '',
                    currentTurn: MemoryEngine?.getCurrentTurn?.() || 0
                }))
                .filter(record => record && record.text)
                .slice(-MAX_RECORDS_PER_ENTITY)
        });
        const normalizeState = (raw = {}, scopeKey = '', chatId = '') => {
            const next = { ...makeEmptyState(scopeKey || raw?.scopeKey, chatId || raw?.chatId), ...(raw && typeof raw === 'object' ? raw : {}) };
            const vaults = {};
            for (const [viewerId, vault] of Object.entries(next.vaults || {})) {
                const key = String(viewerId || '').trim();
                if (!key) continue;
                vaults[key] = normalizeVault(key, vault);
            }
            next.version = VERSION;
            next.scopeKey = String(scopeKey || next.scopeKey || 'global').trim() || 'global';
            next.chatId = String(chatId || next.chatId || '').trim();
            next.vaults = vaults;
            return next;
        };
        const loadState = (lorebook = [], options = {}) => {
            activeLorebookRef = Array.isArray(lorebook) ? lorebook : null;
            const scopeKey = String(options?.scopeKey || options?.scopeId || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            const chatId = String(options?.chatId || getActiveManagedChatId() || '').trim();
            const idx = findManagedScopedEntryIndex(lorebook, COMMENT, scopeKey);
            const entry = idx >= 0 ? lorebook[idx] : null;
            state = entry ? normalizeState(parseJsonObject(entry.content || '{}'), scopeKey, chatId) : makeEmptyState(scopeKey, chatId);
            return state;
        };
        const saveState = (lorebook = [], options = {}) => {
            if (!Array.isArray(lorebook)) return false;
            const scopeKey = String(options?.scopeKey || state.scopeKey || getActiveManagedRuntimeScopeKey() || 'global').trim() || 'global';
            const chatId = String(options?.chatId || state.chatId || getActiveManagedChatId() || '').trim();
            state = normalizeState(state, scopeKey, chatId);
            const entry = {
                key: buildScopedManagedLoreKey(COMMENT, scopeKey),
                comment: COMMENT,
                content: JSON.stringify(state),
                mode: 'normal',
                insertorder: 7,
                alwaysActive: false
            };
            return upsertManagedScopedEntry(lorebook, COMMENT, entry, scopeKey) >= 0;
        };
        const canViewerAccessRecord = (record = {}, viewerId = '') => {
            const viewer = normalizeEntityId(viewerId);
            if (!viewer) return false;
            const normalized = normalizeVaultRecord(record, { ownerEntityId: record?.ownerEntityId || viewer });
            if (!normalized || isLifecycleInactive(normalized.status)) return false;
            if (normalized.deniedToEntityIds.includes(viewer)) return false;
            if (normalized.privacy === 'public') return true;
            if (normalized.privacy === 'shared') return normalized.visibleToEntityIds.includes(viewer);
            if (['private', 'secret', 'internal'].includes(normalized.privacy)) {
                if (normalized.visibleToEntityIds.includes(viewer)) return true;
                return !normalized.visibleToEntityIds.length && normalized.ownerEntityId === viewer;
            }
            return normalized.ownerEntityId === viewer;
        };
        const pruneRecords = (records = []) => (Array.isArray(records) ? records : [])
            .map(record => normalizeVaultRecord(record))
            .filter(Boolean)
            .sort((a, b) => Number(b.turn || 0) - Number(a.turn || 0) || Number(b.at || 0) - Number(a.at || 0))
            .slice(0, MAX_RECORDS_PER_ENTITY)
            .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0) || Number(a.at || 0) - Number(b.at || 0));
        const recordObservation = (entityName = '', text = '', meta = {}) => {
            if (MemoryEngine?.CONFIG?.entityKnowledgeVaultEnabled === false) return false;
            const viewerId = viewerIdForEntity(entityName);
            const body = compact(text, 360);
            if (!viewerId || !body) return false;
            const vault = normalizeVault(viewerId, state.vaults?.[viewerId] || { viewerId, entityName, records: [] });
            vault.entityName = compact(entityName || vault.entityName || '', 80);
            const requestedPrivacy = normalizePrivacy(meta.privacy || (meta.memoryType === 'private_thought' ? 'internal' : 'private'));
            const sharedVisible = ['public', 'shared'].includes(requestedPrivacy)
                ? normalizeEntityIdList(meta.visibleToEntityIds || meta.visibleTo || [viewerId], 12)
                : [viewerId];
            const record = normalizeVaultRecord({
                turn: meta.turn || MemoryEngine.getCurrentTurn?.() || 0,
                ownerEntityId: viewerId,
                ownerEntityName: entityName,
                text: body,
                summary: meta.summary || '',
                memoryType: meta.memoryType,
                knowledgeState: meta.knowledgeState,
                privacy: requestedPrivacy,
                visibleToEntityIds: sharedVisible,
                deniedToEntityIds: meta.deniedToEntityIds,
                confidence: meta.confidence,
                canRevealAsFact: meta.canRevealAsFact,
                requiresSuspicionLanguage: meta.requiresSuspicionLanguage,
                source: meta.source || 'scene-observation',
                evidence: meta.evidence || '',
                at: Date.now()
            });
            if (!record) return false;
            if (vault.records.some(prev => prev.id === record.id || compact(prev.text, 360) === record.text)) return false;
            vault.records.push(record);
            vault.records = pruneRecords(vault.records);
            state.vaults = { ...(state.vaults || {}), [viewerId]: vault };
            return true;
        };
        const classifySubjectiveMemory = (name = '', text = '', names = []) => {
            const source = String(text || '');
            const ownerId = viewerIdForEntity(name);
            const participantIds = normalizeEntityIdList(names, 16);
            if (PRIVATE_THOUGHT_PATTERN.test(source)) {
                const nameHit = new RegExp(String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(source);
                return {
                    memoryType: nameHit ? 'private_thought' : 'inferred',
                    knowledgeState: nameHit ? 'known' : 'hidden',
                    privacy: nameHit ? 'internal' : 'secret',
                    visibleToEntityIds: nameHit ? [ownerId] : [],
                    deniedToEntityIds: participantIds.filter(id => id !== ownerId),
                    canRevealAsFact: false,
                    requiresSuspicionLanguage: !nameHit,
                    summary: nameHit ? compact(source, 180) : '',
                    skip: !nameHit
                };
            }
            if (RUMOR_PATTERN.test(source)) return { memoryType: 'rumor', knowledgeState: 'uncertain', privacy: 'private', visibleToEntityIds: [ownerId], canRevealAsFact: false, requiresSuspicionLanguage: true, summary: compact(source, 180) };
            if (MISUNDERSTOOD_PATTERN.test(source)) return { memoryType: 'inferred', knowledgeState: 'misunderstood', privacy: 'private', visibleToEntityIds: [ownerId], canRevealAsFact: false, requiresSuspicionLanguage: true, summary: compact(source, 180) };
            if (SUSPICION_PATTERN.test(source)) return { memoryType: 'inferred', knowledgeState: 'suspected', privacy: 'private', visibleToEntityIds: [ownerId], canRevealAsFact: false, requiresSuspicionLanguage: true, summary: compact(source, 180) };
            return { memoryType: 'experienced', knowledgeState: 'known', privacy: 'shared', visibleToEntityIds: participantIds.length ? participantIds : [ownerId], canRevealAsFact: true, requiresSuspicionLanguage: false, summary: compact(source, 180) };
        };
        const recordTurnForEntities = (entityNames = [], payload = {}, options = {}) => {
            const names = dedupeTextArray((Array.isArray(entityNames) ? entityNames : []).map(name => String(name || '').trim()).filter(Boolean)).slice(0, 12);
            const text = compact(payload.text || payload.summary || [payload.userText, payload.aiText].filter(Boolean).join('\n'), 520);
            if (!names.length || !text) return { changed: false, count: 0 };
            let changed = false;
            let count = 0;
            for (const name of names) {
                const profile = classifySubjectiveMemory(name, text, names);
                if (profile.skip) continue;
                const ok = recordObservation(name, profile.summary || text, {
                    turn: payload.turn || options.turn || MemoryEngine.getCurrentTurn?.() || 0,
                    memoryType: profile.memoryType,
                    knowledgeState: profile.knowledgeState,
                    privacy: profile.privacy,
                    visibleToEntityIds: profile.visibleToEntityIds,
                    deniedToEntityIds: profile.deniedToEntityIds,
                    canRevealAsFact: profile.canRevealAsFact,
                    requiresSuspicionLanguage: profile.requiresSuspicionLanguage,
                    source: options.source || payload.source || 'turn-pov',
                    confidence: options.confidence || 0.66
                });
                if (ok) {
                    changed = true;
                    count += 1;
                }
            }
            return { changed, count };
        };
        const getRecordsForEntity = (entityName = '', limit = 8) => {
            const viewerId = viewerIdForEntity(entityName);
            if (!viewerId) return [];
            const max = Math.max(1, Number(limit || 8));
            return (state.vaults?.[viewerId]?.records || [])
                .map(record => normalizeVaultRecord(record, { ownerEntityId: viewerId }))
                .filter(record => record && canViewerAccessRecord(record, viewerId))
                .sort((a, b) => Number(b.turn || 0) - Number(a.turn || 0) || Number(b.at || 0) - Number(a.at || 0))
                .slice(0, max);
        };
        const formatRecordForPrompt = (record = {}, viewerId = '') => {
            const normalized = normalizeVaultRecord(record, { ownerEntityId: viewerId });
            if (!normalized || !canViewerAccessRecord(normalized, viewerId)) return '';
            const base = SecretKnowledgeCore.redactForViewer(compact(normalized.summary || normalized.text, 260), viewerId);
            if (!base) return '';
            const suffixes = [];
            if (normalized.memoryType === 'private_thought' || normalized.privacy === 'internal') suffixes.push('내면 기억; 타인이 알 수 없음');
            if (normalized.knowledgeState === 'suspected') suffixes.push('의심으로만 표현; 확정하지 말 것');
            if (normalized.knowledgeState === 'uncertain') suffixes.push('불확실함; 추측으로만 표현');
            if (normalized.knowledgeState === 'misunderstood') suffixes.push('오해하고 있음; 객관 사실이 아닐 수 있음');
            if (normalized.knowledgeState === 'hidden') suffixes.push('알지만 숨김; 직접 드러내지 말 것');
            if (!normalized.canRevealAsFact && !suffixes.length) suffixes.push('확정 사실처럼 말하지 말 것');
            return `- ${normalized.turn ? `T${normalized.turn} ` : ''}${base}${suffixes.length ? ` (${suffixes.join('; ')})` : ''}`;
        };
        const buildPrompt = (entityName = '', options = {}) => {
            if (MemoryEngine?.CONFIG?.entityKnowledgeVaultEnabled === false) return '';
            const viewerId = viewerIdForEntity(entityName);
            if (!viewerId) return '';
            const records = getRecordsForEntity(entityName, Math.max(1, Math.min(MAX_ACTIVE_PROMPT_RECORDS, Number(options.limit || MAX_ACTIVE_PROMPT_RECORDS) || MAX_ACTIVE_PROMPT_RECORDS)));
            if (!records.length) return '';
            const lines = [`[Entity Knowledge Vault: ${compact(entityName, 80)}]`];
            records.map(record => formatRecordForPrompt(record, viewerId)).filter(Boolean).forEach(line => lines.push(line));
            lines.push(
                '',
                `Memory Limits: ${compact(entityName, 80)} must not know other entities' private_thought/internal/secret/hidden records, and must not state suspected/uncertain/misunderstood records as objective truth.`
            );
            return SecretKnowledgeCore.redactForViewer(lines.join('\n'), viewerId);
        };
        const buildBoundaryPrompt = (focusNames = []) => {
            if (MemoryEngine?.CONFIG?.entityKnowledgeVaultEnabled === false) return '';
            const names = dedupeTextArray((Array.isArray(focusNames) ? focusNames : [])
                .map(item => typeof item === 'string' ? item : item?.name)
                .map(item => compact(item, 80))
                .filter(Boolean)).slice(0, 8);
            if (!names.length) return '';
            const lines = [];
            for (const name of names) {
                lines.push(`- ${name}: use only ${name}'s own Entity Knowledge Vault, shared/public memory visible to ${name}, and facts ${name} directly witnessed or was explicitly told.`);
                lines.push(`- ${name} must not know other entities' private_thought, internal, secret, hidden, or denied records.`);
                lines.push(`- ${name} must express suspected, uncertain, or misunderstood records as suspicion, confusion, or mistaken belief, not objective truth.`);
            }
            lines.push('- If a fact exists in LIBRA memory but is not visible to a character, the character must not reveal it through dialogue, narration, body reaction, or decision.');
            return ['[Entity POV Memory Boundaries]', ...lines].join('\n');
        };
        const auditResponseKnowledgeBoundary = (text = '', options = {}) => {
            const source = String(text || '');
            if (!source || MemoryEngine?.CONFIG?.entityKnowledgeVaultEnabled === false) return { changed: false, text: source, violations: [], checked: false };
            const focusNames = dedupeTextArray((Array.isArray(options.focusNames) ? options.focusNames : [])
                .map(item => typeof item === 'string' ? item : item?.name)
                .map(item => compact(item, 80))
                .filter(Boolean)).slice(0, 12);
            if (!focusNames.length) return { changed: false, text: source, violations: [], checked: true };
            const protectedRecords = Object.values(state.vaults || {})
                .flatMap(vault => Array.isArray(vault?.records) ? vault.records : [])
                .map(record => normalizeVaultRecord(record))
                .filter(record => record && !isLifecycleInactive(record.status))
                .filter(record => record.memoryType === 'private_thought' || ['secret', 'internal'].includes(record.privacy) || record.knowledgeState === 'hidden')
                .slice(-120);
            if (!protectedRecords.length) return { changed: false, text: source, violations: [], checked: true };
            const replacement = String(options.replacement || '그 사실은 해당 인물의 지식 범위 밖에 머물렀다.').trim() || '그 사실은 해당 인물의 지식 범위 밖에 머물렀다.';
            let out = source;
            const violations = [];
            for (const sentence of String(out).split(/\n+/).flatMap(line => line.match(/[^.!?。！？]+[.!?。！？]?/gu) || [line]).map(v => v.trim()).filter(Boolean)) {
                const mentioned = focusNames.filter(name => sentence.toLowerCase().includes(String(name).toLowerCase()));
                if (!mentioned.length) continue;
                for (const record of protectedRecords) {
                    const recText = compact(record.text || record.summary || '', 900);
                    if (!recText || recText.length < 8 || !sentence.toLowerCase().replace(/\s+/g, '').includes(recText.toLowerCase().replace(/\s+/g, ''))) continue;
                    const unauthorized = mentioned.map(viewerIdForEntity).filter(viewerId => !canViewerAccessRecord(record, viewerId));
                    if (!unauthorized.length) continue;
                    out = out.replace(sentence, replacement);
                    violations.push({ recordId: record.id || '', ownerEntityId: record.ownerEntityId || '', unauthorized: unauthorized.slice(0, 6), privacy: record.privacy || '', knowledgeState: record.knowledgeState || '' });
                    break;
                }
                if (violations.length >= 4) break;
            }
            return { changed: out !== source, text: out, violations, checked: true };
        };
        const renameEntityViewer = (options = {}) => {
            const oldName = compact(options.oldName || '', 80);
            const newName = compact(options.newName || '', 80);
            const oldViewerId = String(options.oldViewerId || '').trim();
            const newViewerId = String(options.newViewerId || '').trim();
            if (!oldName || !newName || !oldViewerId || !newViewerId || oldViewerId === newViewerId) return { changed: false };
            const replaceViewer = (value = '') => String(value || '').trim() === oldViewerId ? newViewerId : String(value || '').trim();
            const rewriteRecord = (record = {}) => {
                const next = { ...record };
                next.ownerEntityId = replaceViewer(next.ownerEntityId || '');
                if (next.ownerEntityId === newViewerId && (!next.ownerEntityName || String(next.ownerEntityName || '').trim() === oldName)) {
                    next.ownerEntityName = newName;
                }
                next.visibleToEntityIds = dedupeTextArray((Array.isArray(next.visibleToEntityIds) ? next.visibleToEntityIds : []).map(replaceViewer).filter(Boolean)).slice(0, 24);
                next.deniedToEntityIds = dedupeTextArray((Array.isArray(next.deniedToEntityIds) ? next.deniedToEntityIds : []).map(replaceViewer).filter(Boolean)).slice(0, 24);
                return normalizeVaultRecord(next, { ownerEntityId: newViewerId, ownerEntityName: newName });
            };
            const vaults = state.vaults && typeof state.vaults === 'object' ? state.vaults : {};
            const oldVault = vaults[oldViewerId] || null;
            const newVault = vaults[newViewerId] || null;
            let changed = false;
            if (oldVault) {
                const mergedRecords = [
                    ...(Array.isArray(newVault?.records) ? newVault.records : []),
                    ...(Array.isArray(oldVault.records) ? oldVault.records : [])
                ].map(rewriteRecord).filter(Boolean);
                vaults[newViewerId] = normalizeVault(newViewerId, {
                    ...(newVault || {}),
                    viewerId: newViewerId,
                    entityName: newName,
                    records: pruneRecords(mergedRecords)
                });
                delete vaults[oldViewerId];
                changed = true;
            }
            for (const [viewerId, vault] of Object.entries(vaults)) {
                if (!vault || typeof vault !== 'object') continue;
                const records = Array.isArray(vault.records) ? vault.records : [];
                const nextRecords = records.map(rewriteRecord).filter(Boolean);
                if (JSON.stringify(nextRecords) !== JSON.stringify(records)) {
                    vaults[viewerId] = normalizeVault(viewerId, { ...vault, records: pruneRecords(nextRecords) });
                    changed = true;
                }
            }
            state.vaults = vaults;
            return { changed };
        };
        const getState = () => state;
        const resetState = (next = null) => {
            state = next && typeof next === 'object' ? normalizeState(safeClone(next), next.scopeKey, next.chatId) : makeEmptyState();
            return state;
        };
        const selfCheck = () => {
            const vaults = Object.values(state.vaults || {}).map((vault, index) => normalizeVault(Object.keys(state.vaults || {})[index] || vault?.viewerId || '', vault));
            const records = vaults.flatMap(vault => vault.records || []).filter(record => !isLifecycleInactive(record.status));
            return {
                ok: true,
                core: 'EntityKnowledgeVaultCore',
                comment: COMMENT,
                schemaVersion: VERSION,
                enabled: MemoryEngine?.CONFIG?.entityKnowledgeVaultEnabled !== false,
                vaults: vaults.length,
                records: records.length,
                privateRecords: records.filter(record => record.privacy === 'private').length,
                secretRecords: records.filter(record => record.privacy === 'secret').length,
                internalRecords: records.filter(record => record.privacy === 'internal' || record.memoryType === 'private_thought').length,
                scopeKey: state.scopeKey || ''
            };
        };
        return Object.freeze({
            COMMENT,
            VERSION,
            schemaVersion: VERSION,
            loadState,
            saveState,
            recordObservation,
            recordTurnForEntities,
            getRecordsForEntity,
            buildPrompt,
            buildBoundaryPrompt,
            auditResponseKnowledgeBoundary,
            renameEntityViewer,
            canViewerAccessRecord,
            formatRecordForPrompt,
            getState,
            resetState,
            selfCheck
        });
    })();

    const hasDeletedTurnTombstonesInLorebook = (lorebook = []) => {
        const entries = Array.isArray(lorebook) ? LibraLoreConsolidator.unpack(lorebook) : [];
        return entries.some(entry => {
            if (!entry || typeof entry !== 'object') return false;
            try {
                const parsed = JSON.parse(entry.content || '{}');
                return parsed?.deletedTurn === true
                    || parsed?.deleted === true
                    || String(parsed?.status || '').toLowerCase() === 'deleted'
                    || String(parsed?.mode || '').toLowerCase().includes('tombstone');
            } catch {
                return /deletedTurn|tombstone|rollback_deleted/i.test(String(entry?.content || ''));
            }
        });
    };
    const deriveMaxConfirmedMemoryTurnFromLorebook = (lorebook = []) => deriveMaxTurnFromLorebook(lorebook);

    const compactTimeFieldText = (value, max = 220) => {
        if (value == null) return '';
        const limit = Math.max(0, Number(max) || 0);
        let text = '';
        if (typeof value === 'string') text = value;
        else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
        else if (Array.isArray(value)) text = value.map(item => compactTimeFieldText(item, Math.max(16, Math.min(limit || 220, 120)))).filter(Boolean).join(' / ');
        else {
            try { text = JSON.stringify(value); }
            catch { text = String(value); }
        }
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!limit || normalized.length <= limit) return normalized;
        return normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + '…';
    };
    const normalizeEntityTimeTracking = (tracking, entity = {}) => {
        const source = tracking && typeof tracking === 'object' ? tracking : {};
        const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
        return {
            currentDate: compactTimeFieldText(source.currentDate || status.currentDate || '', 80),
            currentTime: compactTimeFieldText(source.currentTime || status.currentTime || '', 40),
            lastInteractionDate: compactTimeFieldText(source.lastInteractionDate || source.relationAnchorDate || '', 80),
            lastInteractionTime: compactTimeFieldText(source.lastInteractionTime || '', 40),
            lastIntimacyDate: compactTimeFieldText(source.lastIntimacyDate || source.nsfwAnchorDate || '', 80),
            lastIntimacyTime: compactTimeFieldText(source.lastIntimacyTime || '', 40),
            cycleAnchorDate: compactTimeFieldText(source.cycleAnchorDate || source.lastCycleDate || '', 80),
            cycleAnchorTime: compactTimeFieldText(source.cycleAnchorTime || '', 40),
            notes: compactTimeFieldText(source.notes || source.memo || status.notes || '', 180)
        };
    };
    const stripEntityTimeTracking = (entity) => {
        if (!entity || typeof entity !== 'object') return entity;
        try {
            delete entity.timeTracking;
        } catch {
            entity.timeTracking = undefined;
        }
        return entity;
    };
    const LibraTimeParser = (() => {
        const options = { timezone: 'Asia/Seoul', defaultHour: 9, preserveCurrentTimeForDateOnly: false, weekStartsOn: 1, endOfMonthBias: true };
        const unitMap = { '초': 'seconds', '초간': 'seconds', '분': 'minutes', '시간': 'hours', '시': 'hours', '일': 'days', '주': 'weeks', '주일': 'weeks', '개월': 'months', '달': 'months', '월': 'months', '년': 'years', '해': 'years' };
        const directionMap = { '후': 1, '뒤': 1, '이후': 1, '전': -1, '이전': -1, '앞': -1 };
        const weekdayMap = { '일요일': 0, '월요일': 1, '화요일': 2, '수요일': 3, '목요일': 4, '금요일': 5, '토요일': 6, '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
        const normalizeInput = (input) => String(input || '').trim().replace(/\s+/g, ' ').replace(/오전\s*/g, '오전 ').replace(/오후\s*/g, '오후 ').replace(/내일모레/g, '모레');
        const formatDateLocal = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const formatTimeLocal = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
        const toTarget = (date) => ({ date: formatDateLocal(date), time: formatTimeLocal(date), iso: date.toISOString(), timestamp: date.getTime() });
        const parseDateText = (value) => {
            const text = compactTimeFieldText(value, 80);
            if (!text) return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                const [y, m, d] = text.split('-').map(Number);
                const parsed = new Date(y, m - 1, d, options.defaultHour, 0, 0, 0);
                return Number.isNaN(parsed.getTime()) ? null : parsed;
            }
            if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
                const parsed = new Date(text);
                return Number.isNaN(parsed.getTime()) ? null : parsed;
            }
            let match = text.match(/(\d{1,6})년\s*(\d{1,2})월\s*(\d{1,2})일/);
            if (match) {
                const y = Number(match[1]);
                const m = Number(match[2]);
                const d = Number(match[3]);
                const parsed = new Date(y, m - 1, d, options.defaultHour, 0, 0, 0);
                if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d) return parsed;
            }
            match = text.match(/\b(\d{1,6})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
            if (match) {
                const y = Number(match[1]);
                const m = Number(match[2]);
                const d = Number(match[3]);
                const parsed = new Date(y, m - 1, d, options.defaultHour, 0, 0, 0);
                if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d) return parsed;
            }
            return null;
        };
        const parseTimeText = (value) => {
            const text = compactTimeFieldText(value, 40);
            if (!text) return null;
            let match = text.match(/^(오전|오후)\s*(\d{1,2})(?::|시\s*)?(\d{2})?(?:분)?$/);
            if (match) {
                let hour = Number(match[2]);
                const minute = Number(match[3] || 0);
                if (match[1] === '오후' && hour < 12) hour += 12;
                if (match[1] === '오전' && hour === 12) hour = 0;
                return { hour, minute, second: 0 };
            }
            match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
            if (match) {
                let hour = Number(match[1]);
                const minute = Number(match[2]);
                if (/PM/i.test(match[4]) && hour < 12) hour += 12;
                if (/AM/i.test(match[4]) && hour === 12) hour = 0;
                return { hour, minute, second: Number(match[3] || 0) };
            }
            match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!match) return null;
            return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] || 0) };
        };
        const buildDateFromState = (dateText = '', timeText = '') => {
            const parsedDate = parseDateText(dateText);
            if (!parsedDate) return null;
            const parsedTime = parseTimeText(timeText);
            if (parsedTime) parsedDate.setHours(parsedTime.hour, parsedTime.minute, parsedTime.second, 0);
            return parsedDate;
        };
        const applyDefaultTime = (date) => {
            const next = new Date(date);
            if (options.preserveCurrentTimeForDateOnly) return next;
            next.setHours(options.defaultHour, 0, 0, 0);
            return next;
        };
        const startOfWeek = (date) => {
            const next = new Date(date);
            const diff = (next.getDay() - options.weekStartsOn + 7) % 7;
            next.setDate(next.getDate() - diff);
            next.setHours(0, 0, 0, 0);
            return next;
        };
        const addDuration = (date, duration) => {
            const next = new Date(date);
            if (duration.years) next.setFullYear(next.getFullYear() + duration.years);
            if (duration.months) {
                const originalDate = next.getDate();
                next.setDate(1);
                next.setMonth(next.getMonth() + duration.months);
                const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
                next.setDate(Math.min(originalDate, maxDay));
            }
            if (duration.weeks) next.setDate(next.getDate() + duration.weeks * 7);
            if (duration.days) next.setDate(next.getDate() + duration.days);
            if (duration.hours) next.setHours(next.getHours() + duration.hours);
            if (duration.minutes) next.setMinutes(next.getMinutes() + duration.minutes);
            if (duration.seconds) next.setSeconds(next.getSeconds() + duration.seconds);
            return next;
        };
        const extractClockTime = (text, date) => {
            const next = new Date(date);
            const tokens = [];
            if (text.includes('자정')) { next.setHours(0, 0, 0, 0); tokens.push({ kind: 'special_time', value: 'midnight' }); return { date: next, tokens }; }
            if (text.includes('정오')) { next.setHours(12, 0, 0, 0); tokens.push({ kind: 'special_time', value: 'noon' }); return { date: next, tokens }; }
            const explicit = text.match(/(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
            if (explicit) {
                const meridiem = explicit[1] || null;
                let hour = Number(explicit[2]);
                const minute = explicit[3] ? Number(explicit[3]) : 0;
                if (meridiem === '오후' && hour < 12) hour += 12;
                if (meridiem === '오전' && hour === 12) hour = 0;
                next.setHours(hour, minute, 0, 0);
                tokens.push({ kind: 'hour', value: hour }, { kind: 'minute', value: minute });
                return { date: next, tokens };
            }
            const ampm = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\b/i);
            if (ampm) {
                let hour = Number(ampm[1]);
                const minute = Number(ampm[2]);
                const second = Number(ampm[3] || 0);
                if (/PM/i.test(ampm[4]) && hour < 12) hour += 12;
                if (/AM/i.test(ampm[4]) && hour === 12) hour = 0;
                next.setHours(hour, minute, second, 0);
                tokens.push({ kind: 'hour', value: hour }, { kind: 'minute', value: minute });
                return { date: next, tokens };
            }
            for (const [label, hour] of [['아침', 8], ['점심', 12], ['오후', 15], ['저녁', 19], ['밤', 21]]) {
                if (text.includes(label)) {
                    next.setHours(hour, 0, 0, 0);
                    tokens.push({ kind: 'time_bucket', value: label }, { kind: 'hour', value: hour });
                    return { date: next, tokens };
                }
            }
            return null;
        };
        const parseAbsolute = (text, baseDate) => {
            const tokens = [];
            let match = text.match(/(\d{1,6})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?)?/);
            if (match) {
                const year = Number(match[1]);
                const month = Number(match[2]);
                const day = Number(match[3]);
                const hour = match[4] ? Number(match[4]) : options.defaultHour;
                const minute = match[5] ? Number(match[5]) : 0;
                const date = new Date(baseDate);
                date.setFullYear(year, month - 1, day);
                date.setHours(hour, minute, 0, 0);
                tokens.push({ kind: 'year', value: year }, { kind: 'month', value: month }, { kind: 'day', value: day }, { kind: 'hour', value: hour }, { kind: 'minute', value: minute });
                return { date, tokens, meta: { assumedTime: !match[4], ambiguous: false, confidence: 0.99 } };
            }
            match = text.match(/(?:(\d{1,6})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s*\([^)]{1,12}\))?(?:\s*(오전|오후))?\s*(\d{1,2})?시?(?:\s*(\d{1,2})분)?/);
            if (!match) return null;
            const year = match[1] ? Number(match[1]) : null;
            const month = Number(match[2]);
            const day = Number(match[3]);
            let hour = match[5] ? Number(match[5]) : options.defaultHour;
            const minute = match[6] ? Number(match[6]) : 0;
            const meridiem = match[4] || null;
            if (meridiem === '오후' && hour < 12) hour += 12;
            if (meridiem === '오전' && hour === 12) hour = 0;
            const date = new Date(baseDate);
            if (year) date.setFullYear(year);
            date.setMonth(month - 1, day);
            const ampm = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\b/i);
            let explicitMinute = minute;
            if (ampm) {
                hour = Number(ampm[1]);
                if (/PM/i.test(ampm[4]) && hour < 12) hour += 12;
                if (/AM/i.test(ampm[4]) && hour === 12) hour = 0;
                explicitMinute = Number(ampm[2]);
            }
            date.setHours(hour, explicitMinute, 0, 0);
            if (ampm) date.setMinutes(Number(ampm[2]), Number(ampm[3] || 0), 0);
            tokens.push({ kind: 'month', value: month }, { kind: 'day', value: day }, { kind: 'hour', value: hour }, { kind: 'minute', value: explicitMinute });
            return { date, tokens, meta: { assumedTime: !match[5] && !ampm, ambiguous: false, confidence: year ? 0.97 : 0.93 } };
        };
        const parseRelative = (text, baseDate) => {
            const matches = [...text.matchAll(/(\d+)\s*(초|분|시간|시|일|주|개월|달|월|년)\s*(후|뒤|이후|전|이전|앞)/g)];
            if (!matches.length) return null;
            const duration = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
            const tokens = [];
            for (const match of matches) {
                const amount = Number(match[1]);
                const unit = unitMap[match[2]];
                const direction = directionMap[match[3]] || 1;
                if (!unit) continue;
                duration[unit] += amount * direction;
                tokens.push({ kind: 'amount', value: amount }, { kind: 'unit', value: unit }, { kind: 'direction', value: direction > 0 ? 'future' : 'past' });
            }
            let date = addDuration(baseDate, duration);
            const timeAdjust = extractClockTime(text, date);
            if (timeAdjust) {
                date = timeAdjust.date;
                tokens.push(...timeAdjust.tokens);
            }
            return { date, tokens, duration, meta: { assumedTime: !timeAdjust, ambiguous: false, confidence: 0.96 } };
        };
        const parseKeyword = (text, baseDate) => {
            const date = new Date(baseDate);
            const makeRange = (start, end, anchor) => ({ type: 'range', anchor, tokens: [{ kind: 'keyword', value: anchor }], range: { start: toTarget(start), end: toTarget(end) }, meta: { assumedTime: false, ambiguous: false, confidence: 0.92 } });
            if (text === '지금') return { type: 'keyword', anchor: 'now', tokens: [{ kind: 'keyword', value: 'now' }], target: date, meta: { assumedTime: false, ambiguous: false, confidence: 1 } };
            if (text.startsWith('오늘')) { const adjusted = extractClockTime(text, new Date(date)); return { type: 'keyword', anchor: 'today', tokens: [{ kind: 'keyword', value: 'today' }, ...(adjusted?.tokens || [])], target: adjusted ? adjusted.date : applyDefaultTime(date), meta: { assumedTime: !adjusted, ambiguous: false, confidence: adjusted ? 0.97 : 0.9 } }; }
            if (text.startsWith('내일')) { date.setDate(date.getDate() + 1); const adjusted = extractClockTime(text, date); return { type: 'keyword', anchor: 'tomorrow', tokens: [{ kind: 'keyword', value: 'tomorrow' }, ...(adjusted?.tokens || [])], target: adjusted ? adjusted.date : applyDefaultTime(date), meta: { assumedTime: !adjusted, ambiguous: false, confidence: 0.95 } }; }
            if (text.startsWith('모레')) { date.setDate(date.getDate() + 2); const adjusted = extractClockTime(text, date); return { type: 'keyword', anchor: 'day_after_tomorrow', tokens: [{ kind: 'keyword', value: 'day_after_tomorrow' }, ...(adjusted?.tokens || [])], target: adjusted ? adjusted.date : applyDefaultTime(date), meta: { assumedTime: !adjusted, ambiguous: false, confidence: 0.94 } }; }
            if (text.startsWith('어제')) { date.setDate(date.getDate() - 1); const adjusted = extractClockTime(text, date); return { type: 'keyword', anchor: 'yesterday', tokens: [{ kind: 'keyword', value: 'yesterday' }, ...(adjusted?.tokens || [])], target: adjusted ? adjusted.date : applyDefaultTime(date), meta: { assumedTime: !adjusted, ambiguous: false, confidence: 0.94 } }; }
            if (text.startsWith('그제')) { date.setDate(date.getDate() - 2); const adjusted = extractClockTime(text, date); return { type: 'keyword', anchor: 'day_before_yesterday', tokens: [{ kind: 'keyword', value: 'day_before_yesterday' }, ...(adjusted?.tokens || [])], target: adjusted ? adjusted.date : applyDefaultTime(date), meta: { assumedTime: !adjusted, ambiguous: false, confidence: 0.93 } }; }
            if (text === '이번 주' || text === '다음 주' || text === '지난 주') {
                const start = startOfWeek(baseDate);
                if (text === '다음 주') start.setDate(start.getDate() + 7);
                if (text === '지난 주') start.setDate(start.getDate() - 7);
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                end.setHours(23, 59, 59, 999);
                return makeRange(start, end, text === '이번 주' ? 'this_week' : text === '다음 주' ? 'next_week' : 'last_week');
            }
            if (text === '이번 달' || text === '다음 달' || text === '지난 달') {
                const start = new Date(baseDate);
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                if (text === '다음 달') start.setMonth(start.getMonth() + 1);
                if (text === '지난 달') start.setMonth(start.getMonth() - 1);
                const end = new Date(start);
                end.setMonth(end.getMonth() + 1);
                end.setDate(0);
                end.setHours(23, 59, 59, 999);
                return makeRange(start, end, text === '이번 달' ? 'this_month' : text === '다음 달' ? 'next_month' : 'last_month');
            }
            if (text === '월말') { const end = new Date(baseDate); end.setMonth(end.getMonth() + 1, 0); end.setHours(23, 59, 59, 999); return { type: 'keyword', anchor: 'end_of_month', tokens: [{ kind: 'keyword', value: 'end_of_month' }], target: end, meta: { assumedTime: false, ambiguous: false, confidence: 0.9 } }; }
            if (text === '연말') { const end = new Date(baseDate); end.setMonth(11, 31); end.setHours(23, 59, 59, 999); return { type: 'keyword', anchor: 'end_of_year', tokens: [{ kind: 'keyword', value: 'end_of_year' }], target: end, meta: { assumedTime: false, ambiguous: false, confidence: 0.9 } }; }
            return null;
        };
        const parseWeekday = (text, baseDate) => {
            const match = text.match(/(이번 주|다음 주|지난 주)?\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)(?:\s*(오전|오후))?\s*(\d{1,2})?시?(?:\s*(\d{1,2})분)?/);
            if (!match) return null;
            const scope = match[1] || null;
            const weekday = weekdayMap[match[2]];
            const meridiem = match[3] || null;
            let hour = match[4] ? Number(match[4]) : options.defaultHour;
            const minute = match[5] ? Number(match[5]) : 0;
            if (meridiem === '오후' && hour < 12) hour += 12;
            if (meridiem === '오전' && hour === 12) hour = 0;
            const start = startOfWeek(baseDate);
            if (scope === '다음 주') start.setDate(start.getDate() + 7);
            if (scope === '지난 주') start.setDate(start.getDate() - 7);
            const target = new Date(start);
            target.setDate(start.getDate() + weekday);
            target.setHours(hour, minute, 0, 0);
            if (!scope && target < baseDate) target.setDate(target.getDate() + 7);
            return { date: target, tokens: [{ kind: 'scope', value: scope || 'nearest' }, { kind: 'weekday', value: weekday }, { kind: 'hour', value: hour }, { kind: 'minute', value: minute }], meta: { assumedTime: !match[4], ambiguous: !scope, confidence: scope ? 0.93 : 0.82 } };
        };
        const parse = (input, baseDate = null) => {
            const normalized = normalizeInput(input);
            const base = baseDate instanceof Date
                ? (Number.isNaN(baseDate.getTime()) ? null : new Date(baseDate.getTime()))
                : (() => {
                    if (baseDate == null || baseDate === '') return null;
                    const parsed = new Date(baseDate);
                    return Number.isNaN(parsed.getTime()) ? null : parsed;
                })();
            const result = { ok: false, type: null, input, normalized, base: base ? base.toISOString() : null, timezone: options.timezone, tokens: [], duration: { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }, anchor: null, target: null, range: null, meta: { assumedTime: false, ambiguous: false, confidence: 0 } };
            if (!base) {
                return { ...result, ok: false, meta: { assumedTime: false, ambiguous: true, confidence: 0.15 } };
            }
            const absolute = parseAbsolute(normalized, base);
            if (absolute) return { ...result, ok: true, type: 'absolute', tokens: absolute.tokens, target: toTarget(absolute.date), meta: absolute.meta };
            const relative = parseRelative(normalized, base);
            if (relative) return { ...result, ok: true, type: 'relative', tokens: relative.tokens, duration: relative.duration, target: toTarget(relative.date), meta: relative.meta };
            const keyword = parseKeyword(normalized, base);
            if (keyword) return { ...result, ok: true, type: keyword.type, tokens: keyword.tokens, anchor: keyword.anchor, target: keyword.target ? toTarget(keyword.target) : null, range: keyword.range || null, meta: keyword.meta };
            const weekday = parseWeekday(normalized, base);
            if (weekday) return { ...result, ok: true, type: 'absolute', tokens: weekday.tokens, target: toTarget(weekday.date), meta: weekday.meta };
            return { ...result, ok: false, meta: { assumedTime: false, ambiguous: true, confidence: 0.15 } };
        };
        const resolveTextTarget = (input, baseDate = null) => {
            const text = compactTimeFieldText(input, 120);
            if (!text) return null;
            const dateOnly = /^\d{1,6}-\d{1,2}-\d{1,2}$/.test(text)
                || /^\d{1,6}[\/.]\d{1,2}[\/.]\d{1,2}$/.test(text)
                || /^\d{1,6}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*\([^)]{1,12}\))?$/.test(text);
            const normalizedBase = baseDate instanceof Date
                ? (Number.isNaN(baseDate.getTime()) ? null : new Date(baseDate.getTime()))
                : (() => {
                    if (baseDate == null || baseDate === '') return null;
                    const parsed = new Date(baseDate);
                    return Number.isNaN(parsed.getTime()) ? null : parsed;
                })();
            if (normalizedBase) {
                const parsed = parse(text, normalizedBase);
                if (parsed?.ok) return parsed;
            }
            const hasExplicitDateToken = /(\d{1,6})[\/.-](\d{1,2})[\/.-](\d{1,2})/.test(text) || /(\d{1,6})년\s*(\d{1,2})월\s*(\d{1,2})일/.test(text) || /^\d{4}-\d{2}-\d{2}T/.test(text);
            if (!normalizedBase && hasExplicitDateToken) {
                const parsed = parse(text, new Date(2000, 0, 1, options.defaultHour, 0, 0, 0));
                if (parsed?.ok) return parsed;
            }
            const parsedDate = parseDateText(text);
            if (parsedDate) return { ok: true, type: 'absolute', input: text, target: toTarget(parsedDate), meta: { assumedTime: dateOnly, ambiguous: false, confidence: 0.99 } };
            if (hasExplicitDateToken) {
                const nativeDate = new Date(text);
                if (!Number.isNaN(nativeDate.getTime())) return { ok: true, type: 'absolute', input: text, target: toTarget(nativeDate), meta: { assumedTime: false, ambiguous: false, confidence: 0.7 } };
            }
            return null;
        };
        return { options, formatDateLocal, formatTimeLocal, toTarget, parseDateText, parseTimeText, buildDateFromState, parse, resolveTextTarget };
    })();

    // [MANAGER] Narrative Time Engine
    // Entity-local timeTracking is treated as legacy input only.
    // Canonical time state now lives here and is projected top-down.
    // ══════════════════════════════════════════════════════════════
    const TimeEngine = (() => {
        const STATE_COMMENT = 'lmai_time_engine';
        const defaultState = () => ({
            currentDate: '',
            currentTime: '',
            lastSceneDate: '',
            lastSceneTime: '',
            currentLabel: '',
            lastSceneLabel: '',
            sceneTurn: 0,
            notes: '',
            updatedAt: 0,
            entityAnchors: {}
        });

        let engineState = defaultState();

        const normalizeEntityKey = (entityName = '', entity = null) => {
            const raw = String(entityName || entity?.name || entity?.id || '').trim();
            return raw ? raw.toLowerCase() : '';
        };
        const STORY_DATE_PATTERN = /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/g;
        const STORY_KR_DATE_PATTERN = /(\d{1,6})년\s*(\d{1,2})월\s*(\d{1,2})일/g;
        const normalizeStoryDateToken = (year, month, day) => {
            const y = Number(year);
            const m = Number(month);
            const d = Number(day);
            if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
            if (m < 1 || m > 12 || d < 1 || d > 31) return '';
            const parsed = new Date(y, m - 1, d, 9, 0, 0, 0);
            if (Number.isNaN(parsed.getTime())) return '';
            if (parsed.getFullYear() !== y || parsed.getMonth() !== (m - 1) || parsed.getDate() !== d) return '';
            return LibraTimeParser.formatDateLocal(parsed);
        };
        const extractStoryDateFromText = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            const direct = LibraTimeParser.parseDateText(raw);
            if (direct) return LibraTimeParser.formatDateLocal(direct);
            let latest = '';
            for (const match of raw.matchAll(STORY_DATE_PATTERN)) {
                const normalized = normalizeStoryDateToken(match[1], match[2], match[3]);
                if (normalized) latest = normalized;
            }
            for (const match of raw.matchAll(STORY_KR_DATE_PATTERN)) {
                const normalized = normalizeStoryDateToken(match[1], match[2], match[3]);
                if (normalized) latest = normalized;
            }
            return latest;
        };
        const deriveStoryAnchorDate = (lorebook = null) => {
            const candidates = [];
            const pushCandidate = (value) => {
                const normalized = extractStoryDateFromText(value);
                if (normalized) candidates.push(normalized);
            };
            pushCandidate(engineState.currentDate);
            pushCandidate(engineState.lastSceneDate);
            for (const anchor of Object.values(engineState.entityAnchors || {})) {
                if (!anchor || typeof anchor !== 'object') continue;
                pushCandidate(anchor.currentDate);
                pushCandidate(anchor.lastInteractionDate);
                pushCandidate(anchor.lastIntimacyDate);
                pushCandidate(anchor.cycleAnchorDate);
            }
            const sourceLore = Array.isArray(lorebook) ? lorebook : [];
            if (sourceLore.length > 0) {
                const scanFrom = Math.max(0, sourceLore.length - 160);
                for (let i = sourceLore.length - 1; i >= scanFrom; i--) {
                    const entry = sourceLore[i];
                    if (!entry) continue;
                    const meta = (typeof MemoryEngine !== 'undefined' && typeof MemoryEngine.getCachedMeta === 'function')
                        ? (MemoryEngine.getCachedMeta(entry) || {})
                        : {};
                    pushCandidate(meta?.currentDate);
                    pushCandidate(meta?.lastSceneDate);
                    pushCandidate(meta?.sourceDate);
                    pushCandidate(meta?.summary);
                    const rawContent = typeof entry?.content === 'string'
                        ? entry.content
                        : JSON.stringify(entry?.content || '');
                    pushCandidate(rawContent);
                }
            }
            if (!candidates.length) return '';
            candidates.sort((a, b) => String(a).localeCompare(String(b)));
            return candidates[candidates.length - 1] || '';
        };
        const getFallbackBaseDate = (entity = {}) => {
            const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
            return LibraTimeParser.buildDateFromState(engineState.currentDate, engineState.currentTime)
                || LibraTimeParser.buildDateFromState(engineState.lastSceneDate, engineState.lastSceneTime)
                || LibraTimeParser.parseDateText(status.currentDate)
                || LibraTimeParser.parseDateText(deriveStoryAnchorDate())
                || null;
        };
        const makeCanonicalAnchor = ({
            currentDate = '',
            currentTime = '',
            lastInteractionDate = '',
            lastInteractionTime = '',
            lastIntimacyDate = '',
            lastIntimacyTime = '',
            cycleAnchorDate = '',
            cycleAnchorTime = '',
            notes = '',
            parserMeta = null
        } = {}) => ({
            currentDate: compactTimeFieldText(currentDate, 80),
            currentTime: compactTimeFieldText(currentTime, 40),
            lastInteractionDate: compactTimeFieldText(lastInteractionDate, 80),
            lastInteractionTime: compactTimeFieldText(lastInteractionTime, 40),
            lastIntimacyDate: compactTimeFieldText(lastIntimacyDate, 80),
            lastIntimacyTime: compactTimeFieldText(lastIntimacyTime, 40),
            cycleAnchorDate: compactTimeFieldText(cycleAnchorDate, 80),
            cycleAnchorTime: compactTimeFieldText(cycleAnchorTime, 40),
            notes: compactTimeFieldText(notes, 180),
            parserMeta: parserMeta && typeof parserMeta === 'object' ? {
                input: compactTimeFieldText(parserMeta.input || '', 120),
                normalized: compactTimeFieldText(parserMeta.normalized || '', 120),
                type: compactTimeFieldText(parserMeta.type || '', 40),
                confidence: Number(parserMeta.confidence || 0) || 0,
                ambiguous: !!parserMeta.ambiguous,
                assumedTime: !!parserMeta.assumedTime
            } : null
        });
        const resolveAnchorField = (primaryValue, fallbackDate = '', fallbackTime = '', entity = {}) => {
            const raw = compactTimeFieldText(primaryValue || fallbackDate || '', 120);
            if (!raw && !fallbackTime) {
                return { date: '', time: '', parserMeta: null };
            }
            const directDate = LibraTimeParser.parseDateText(raw);
            const directTime = LibraTimeParser.parseTimeText(fallbackTime);
            if (directDate) {
                if (directTime) {
                    directDate.setHours(directTime.hour, directTime.minute, directTime.second, 0);
                }
                return {
                    date: LibraTimeParser.formatDateLocal(directDate),
                    time: directTime ? LibraTimeParser.formatTimeLocal(directDate) : compactTimeFieldText(fallbackTime || '', 40),
                    parserMeta: null
                };
            }
            const fallbackBaseDate = getFallbackBaseDate(entity);
            const resolved = fallbackBaseDate
                ? LibraTimeParser.resolveTextTarget(raw, fallbackBaseDate)
                : null;
            if (resolved?.target) {
                return {
                    date: resolved.target.date || '',
                    time: resolved.target.time || '',
                    parserMeta: {
                        input: raw,
                        normalized: resolved.normalized || raw,
                        type: resolved.type || 'absolute',
                        confidence: resolved?.meta?.confidence || 0,
                        ambiguous: !!resolved?.meta?.ambiguous,
                        assumedTime: !!resolved?.meta?.assumedTime
                    }
                };
            }
            return {
                date: compactTimeFieldText(fallbackDate || raw, 80),
                time: compactTimeFieldText(fallbackTime || '', 40),
                parserMeta: null
            };
        };
        const normalizeAnchor = (tracking, entity = {}) => {
            const source = tracking && typeof tracking === 'object' ? tracking : {};
            const normalized = normalizeEntityTimeTracking(tracking, entity);
            const current = resolveAnchorField(
                source.currentDate || source.currentDateText || source.currentDatePrompt || '',
                normalized.currentDate || '',
                source.currentTime || ''
            );
            const interaction = resolveAnchorField(
                source.lastInteractionDate || source.relationAnchorDate || source.lastInteractionText || '',
                normalized.lastInteractionDate || '',
                source.lastInteractionTime || ''
            );
            const intimacy = resolveAnchorField(
                source.lastIntimacyDate || source.nsfwAnchorDate || source.lastIntimacyText || '',
                normalized.lastIntimacyDate || '',
                source.lastIntimacyTime || ''
            );
            const cycle = resolveAnchorField(
                source.cycleAnchorDate || source.lastCycleDate || source.cycleAnchorText || '',
                normalized.cycleAnchorDate || '',
                source.cycleAnchorTime || ''
            );
            return makeCanonicalAnchor({
                currentDate: current.date,
                currentTime: current.time,
                lastInteractionDate: interaction.date,
                lastInteractionTime: interaction.time,
                lastIntimacyDate: intimacy.date,
                lastIntimacyTime: intimacy.time,
                cycleAnchorDate: cycle.date,
                cycleAnchorTime: cycle.time,
                notes: normalized.notes || source.notes || source.memo || '',
                parserMeta: current.parserMeta || interaction.parserMeta || intimacy.parserMeta || cycle.parserMeta || null
            });
        };
        const normalizeState = (state) => {
            const source = state && typeof state === 'object' ? state : {};
            const next = {
                currentDate: compactTimeFieldText(source.currentDate || source.lastSceneDate || '', 80),
                currentTime: compactTimeFieldText(source.currentTime || '', 40),
                lastSceneDate: compactTimeFieldText(source.lastSceneDate || source.currentDate || '', 80),
                lastSceneTime: compactTimeFieldText(source.lastSceneTime || source.currentTime || '', 40),
                currentLabel: compactTimeFieldText(source.currentLabel || source.sceneTimeLabel || source.currentSceneTimeLabel || '', 160),
                lastSceneLabel: compactTimeFieldText(source.lastSceneLabel || source.sceneTimeLabel || source.currentLabel || '', 160),
                sceneTurn: Math.max(0, Number(source.sceneTurn || 0)),
                notes: compactTimeFieldText(source.notes || source.memo || '', 180),
                updatedAt: Math.max(0, Number(source.updatedAt || 0)),
                entityAnchors: {}
            };
            const rawAnchors = source.entityAnchors && typeof source.entityAnchors === 'object' ? source.entityAnchors : {};
            for (const [key, value] of Object.entries(rawAnchors)) {
                const normalizedKey = normalizeEntityKey(key);
                if (!normalizedKey) continue;
                next.entityAnchors[normalizedKey] = normalizeAnchor(value, {});
            }
            return next;
        };
        const ensureAnchor = (entityName = '', entity = null) => {
            const key = normalizeEntityKey(entityName, entity);
            if (!key) return [null, null];
            if (!engineState.entityAnchors[key]) {
                engineState.entityAnchors[key] = normalizeAnchor({}, entity || {});
            }
            return [key, engineState.entityAnchors[key]];
        };
        const getObservedSceneTurn = (lorebook = null) => {
            const hasDeletedTurnTombstones = hasDeletedTurnTombstonesInLorebook(lorebook);
            const memoryTurn = hasDeletedTurnTombstones ? 0 : Number(typeof MemoryEngine !== 'undefined' && typeof MemoryEngine?.getCurrentTurn === 'function'
                ? MemoryEngine.getCurrentTurn()
                : 0);
            const narrativeTurn = Number(Array.isArray(NarrativeTracker?.getState?.()?.turnLog)
                ? Math.max(0, ...NarrativeTracker.getState().turnLog
                    .filter(entry => entry?.deletedTurn !== true && entry?.needsReinterpretation !== true)
                    .map(entry => Number(entry?.sceneTurn || entry?.turn || 0))
                    .filter(Number.isFinite))
                : 0);
            const loreTurn = Number(Array.isArray(lorebook) && typeof deriveMaxConfirmedMemoryTurnFromLorebook === 'function'
                ? deriveMaxConfirmedMemoryTurnFromLorebook(lorebook)
                : 0);
            return Math.max(0, memoryTurn, narrativeTurn, loreTurn);
        };
        const syncSceneTurn = (lorebook = null) => {
            const observedSceneTurn = getObservedSceneTurn(lorebook);
            const hasDeletedTurnTombstones = hasDeletedTurnTombstonesInLorebook(lorebook);
            engineState.sceneTurn = hasDeletedTurnTombstones
                ? Math.max(0, Number(observedSceneTurn || 0))
                : Math.max(0, Number(engineState.sceneTurn || 0), observedSceneTurn);
            return engineState.sceneTurn;
        };
        const ensureMinimumClockState = (lorebook = null) => {
            syncSceneTurn(lorebook);
            if (engineState.currentDate) return false;
            const hasAnchors = Object.values(engineState.entityAnchors || {}).some(anchor => {
                if (!anchor || typeof anchor !== 'object') return false;
                return !!(
                    anchor.currentDate
                    || anchor.lastInteractionDate
                    || anchor.lastIntimacyDate
                    || anchor.cycleAnchorDate
                );
            });
            if (!hasAnchors && Number(engineState.sceneTurn || 0) <= 0) return false;
            const fallbackDate = deriveStoryAnchorDate(lorebook);
            if (!fallbackDate) return false;
            engineState.currentDate = fallbackDate;
            engineState.lastSceneDate = engineState.lastSceneDate || fallbackDate;
            engineState.updatedAt = Date.now();
            return true;
        };
        const bootstrapStateFromLorebook = (lorebook = null) => {
            const sourceLore = Array.isArray(lorebook) ? LibraLoreConsolidator.unpack(lorebook) : [];
            if (!sourceLore.length) return false;
            let changed = false;
            for (const entry of sourceLore) {
                if (String(entry?.comment || '') !== 'lmai_entity') continue;
                let content = null;
                try {
                    content = typeof entry?.content === 'string' ? JSON.parse(entry.content) : entry?.content;
                } catch (_) {
                    content = null;
                }
                if (!content || typeof content !== 'object') continue;
                const entityName = String(content?.name || content?.id || '').trim();
                if (!entityName) continue;
                const legacyTracking = {
                    currentDate: content?.timeTracking?.currentDate || content?.status?.currentDate || '',
                    currentTime: content?.timeTracking?.currentTime || content?.status?.currentTime || '',
                    lastInteractionDate: content?.timeTracking?.lastInteractionDate || '',
                    lastInteractionTime: content?.timeTracking?.lastInteractionTime || '',
                    lastIntimacyDate: content?.timeTracking?.lastIntimacyDate || '',
                    lastIntimacyTime: content?.timeTracking?.lastIntimacyTime || '',
                    cycleAnchorDate: content?.timeTracking?.cycleAnchorDate || '',
                    cycleAnchorTime: content?.timeTracking?.cycleAnchorTime || '',
                    notes: content?.timeTracking?.notes || content?.status?.notes || ''
                };
                if (!Object.values(legacyTracking).some(Boolean)) continue;
                const before = JSON.stringify(engineState.entityAnchors?.[normalizeEntityKey(entityName)] || {});
                ingestEntityTracking(entityName, legacyTracking, content);
                const after = JSON.stringify(engineState.entityAnchors?.[normalizeEntityKey(entityName)] || {});
                if (before !== after) changed = true;
            }
            if (ensureMinimumClockState(sourceLore)) changed = true;
            return changed;
        };
        const loadState = (lorebook, options = {}) => {
            const sourceLore = Array.isArray(lorebook) ? lorebook : [];
            const scopeKey = String(options?.scopeKey || getActiveManagedRuntimeScopeKey()).trim() || 'global';
            const idx = findManagedScopedEntryIndex(sourceLore, STATE_COMMENT, scopeKey);
            const entry = idx >= 0 ? sourceLore[idx] : null;
            if (entry) {
                try {
                    const parsed = JSON.parse(entry.content);
                    engineState = normalizeState(parsed?.engineState && typeof parsed.engineState === 'object' ? parsed.engineState : parsed);
                } catch (e) {
                    console.warn('[LIBRA] Time engine parse failed:', e?.message);
                    engineState = defaultState();
                }
            } else {
                engineState = defaultState();
            }
            syncSceneTurn(sourceLore);
            bootstrapStateFromLorebook(sourceLore);
            ensureMinimumClockState(sourceLore);
            return engineState;
        };
        const saveState = async (lorebook, options = {}) => {
            syncSceneTurn(lorebook);
            const scopeKey = String(options?.scopeKey || getActiveManagedRuntimeScopeKey()).trim() || 'global';
            const chatId = String(options?.chatId || getActiveManagedChatId() || '').trim();
            const entry = {
                key: buildScopedManagedLoreKey(STATE_COMMENT, scopeKey),
                comment: STATE_COMMENT,
                content: JSON.stringify({
                    scopeKey,
                    chatId,
                    engineState
                }),
                mode: 'normal',
                insertorder: 7,
                alwaysActive: false
            };
            upsertManagedScopedEntry(lorebook, STATE_COMMENT, entry, scopeKey);
        };
        const resetState = (nextState = null) => {
            engineState = nextState ? normalizeState(nextState) : defaultState();
            return engineState;
        };
        const getState = () => engineState;
        const ingestEntityTracking = (entityName = '', tracking = {}, entity = {}) => {
            syncSceneTurn();
            const [key, anchor] = ensureAnchor(entityName, entity);
            const normalized = normalizeAnchor(tracking, entity);
            if (!key || !anchor) {
                if (normalized.currentDate) {
                    engineState.currentDate = normalized.currentDate;
                    engineState.currentTime = normalized.currentTime || engineState.currentTime || '';
                    engineState.lastSceneDate = normalized.currentDate;
                    engineState.lastSceneTime = normalized.currentTime || engineState.lastSceneTime || '';
                    engineState.updatedAt = Date.now();
                }
                ensureMinimumClockState();
                return normalized;
            }
            engineState.entityAnchors[key] = makeCanonicalAnchor({
                currentDate: normalized.currentDate || anchor.currentDate || '',
                currentTime: normalized.currentTime || anchor.currentTime || '',
                lastInteractionDate: normalized.lastInteractionDate || anchor.lastInteractionDate || '',
                lastInteractionTime: normalized.lastInteractionTime || anchor.lastInteractionTime || '',
                lastIntimacyDate: normalized.lastIntimacyDate || anchor.lastIntimacyDate || '',
                lastIntimacyTime: normalized.lastIntimacyTime || anchor.lastIntimacyTime || '',
                cycleAnchorDate: normalized.cycleAnchorDate || anchor.cycleAnchorDate || '',
                cycleAnchorTime: normalized.cycleAnchorTime || anchor.cycleAnchorTime || '',
                notes: normalized.notes || anchor.notes || '',
                parserMeta: normalized.parserMeta || anchor.parserMeta || null
            });
            const effectiveCurrentDate = normalized.currentDate || engineState.currentDate || '';
            if (effectiveCurrentDate) {
                engineState.currentDate = effectiveCurrentDate;
                engineState.currentTime = normalized.currentTime || engineState.currentTime || '';
                engineState.lastSceneDate = effectiveCurrentDate;
                engineState.lastSceneTime = normalized.currentTime || engineState.lastSceneTime || '';
            }
            ensureMinimumClockState();
            engineState.updatedAt = Date.now();
            return engineState.entityAnchors[key];
        };
        const ingestLiveTurn = (entityNames = [], liveDate = '', notes = '', options = {}) => {
            syncSceneTurn();
            const sceneTimeLabel = compactTimeFieldText(
                options?.sceneTimeLabel
                || options?.timeLabel
                || options?.rawSceneTime
                || '',
                160
            );
            const sceneTimeText = compactTimeFieldText(
                [
                    sceneTimeLabel,
                    liveDate,
                    options?.sceneDate || '',
                    options?.sceneTime || ''
                ].filter(Boolean).join(' '),
                220
            );
            const storyAnchorDate = deriveStoryAnchorDate();
            const baseDate = LibraTimeParser.buildDateFromState(engineState.currentDate, engineState.currentTime)
                || LibraTimeParser.buildDateFromState(engineState.lastSceneDate, engineState.lastSceneTime)
                || LibraTimeParser.parseDateText(storyAnchorDate)
                || null;
            const resolved = LibraTimeParser.resolveTextTarget(
                sceneTimeText || `${engineState.currentDate || ''} ${engineState.currentTime || ''}`.trim(),
                baseDate
            );
            const normalizedDate = compactTimeFieldText(
                resolved?.target?.date
                || options?.sceneDate
                || liveDate
                || engineState.currentDate
                || engineState.lastSceneDate
                || storyAnchorDate
                || '',
                80
            );
            const normalizedTime = compactTimeFieldText(resolved?.target?.time || options?.sceneTime || engineState.currentTime || '', 40);
            if (!normalizedDate) return 0;
            let changed = 0;
            engineState.currentDate = normalizedDate;
            engineState.currentTime = normalizedTime;
            engineState.lastSceneDate = normalizedDate;
            engineState.lastSceneTime = normalizedTime;
            if (sceneTimeLabel || sceneTimeText) {
                const label = sceneTimeLabel || sceneTimeText;
                engineState.currentLabel = label;
                engineState.lastSceneLabel = label;
            }
            engineState.notes = compactTimeFieldText(notes || engineState.notes || '', 180);
            for (const entityName of (Array.isArray(entityNames) ? entityNames : [])) {
                const [key, anchor] = ensureAnchor(entityName);
                if (!key || !anchor) continue;
                const nextAnchor = makeCanonicalAnchor({
                    ...anchor,
                    currentDate: normalizedDate,
                    currentTime: normalizedTime,
                    lastInteractionDate: normalizedDate,
                    lastInteractionTime: normalizedTime,
                    notes: anchor.notes || engineState.notes || '',
                    parserMeta: resolved?.meta ? {
                        input: compactTimeFieldText(liveDate || '', 120),
                        normalized: compactTimeFieldText(resolved.normalized || sceneTimeText || liveDate || '', 120),
                        type: compactTimeFieldText(resolved.type || 'absolute', 40),
                        confidence: resolved?.meta?.confidence || 0,
                        ambiguous: !!resolved?.meta?.ambiguous,
                        assumedTime: !!resolved?.meta?.assumedTime
                    } : (anchor.parserMeta || null)
                });
                const before = JSON.stringify(anchor);
                const after = JSON.stringify(nextAnchor);
                engineState.entityAnchors[key] = nextAnchor;
                if (before !== after) changed++;
            }
            engineState.updatedAt = Date.now();
            return changed;
        };
        const getProjection = (entityName = '', entity = {}) => {
            syncSceneTurn();
            const key = normalizeEntityKey(entityName, entity);
            const anchor = key ? (engineState.entityAnchors[key] || {}) : {};
            const fallback = normalizeAnchor(entity?.timeTracking || {}, entity);
            const status = entity?.status && typeof entity.status === 'object' ? entity.status : {};
            const normalized = normalizeEntityTimeTracking({
                currentDate: anchor.currentDate || engineState.currentDate || fallback.currentDate || status.currentDate || '',
                lastInteractionDate: anchor.lastInteractionDate || fallback.lastInteractionDate || engineState.lastSceneDate || '',
                lastIntimacyDate: anchor.lastIntimacyDate || fallback.lastIntimacyDate || '',
                cycleAnchorDate: anchor.cycleAnchorDate || fallback.cycleAnchorDate || '',
                notes: anchor.notes || fallback.notes || engineState.notes || ''
            }, entity);
            normalized.currentTime = compactTimeFieldText(anchor.currentTime || engineState.currentTime || fallback.currentTime || status.currentTime || '', 40);
            normalized.lastInteractionTime = compactTimeFieldText(anchor.lastInteractionTime || fallback.lastInteractionTime || engineState.lastSceneTime || '', 40);
            normalized.lastIntimacyTime = compactTimeFieldText(anchor.lastIntimacyTime || fallback.lastIntimacyTime || '', 40);
            normalized.cycleAnchorTime = compactTimeFieldText(anchor.cycleAnchorTime || fallback.cycleAnchorTime || '', 40);
            normalized.parserMeta = anchor.parserMeta || fallback.parserMeta || null;
            return normalized;
        };
        const projectEntity = (entity = {}) => {
            if (!entity || typeof entity !== 'object') return normalizeEntityTimeTracking({}, {});
            syncSceneTurn();
            const projection = getProjection(entity?.name || '', entity);
            entity.status = entity.status && typeof entity.status === 'object' ? entity.status : {};
            if (projection.currentDate) entity.status.currentDate = projection.currentDate;
            if (projection.currentTime) entity.status.currentTime = projection.currentTime;
            stripEntityTimeTracking(entity);
            return projection;
        };
        const mergeTimeAnchors = (target = {}, source = {}) => makeCanonicalAnchor({
            currentDate: target.currentDate || source.currentDate || '',
            currentTime: target.currentTime || source.currentTime || '',
            lastInteractionDate: target.lastInteractionDate || source.lastInteractionDate || '',
            lastInteractionTime: target.lastInteractionTime || source.lastInteractionTime || '',
            lastIntimacyDate: target.lastIntimacyDate || source.lastIntimacyDate || '',
            lastIntimacyTime: target.lastIntimacyTime || source.lastIntimacyTime || '',
            cycleAnchorDate: target.cycleAnchorDate || source.cycleAnchorDate || '',
            cycleAnchorTime: target.cycleAnchorTime || source.cycleAnchorTime || '',
            notes: compactTimeFieldText(dedupeTextArray([target.notes, source.notes].filter(Boolean)).join(' | '), 180),
            parserMeta: target.parserMeta || source.parserMeta || null
        });
        const renameEntityAnchor = (oldName = '', newName = '', options = {}) => {
            const oldKey = String(options.oldKey || normalizeEntityKey(oldName)).trim();
            const newKey = String(options.newKey || normalizeEntityKey(newName)).trim();
            if (!oldKey || !newKey || oldKey === newKey) return { changed: false };
            const anchors = engineState.entityAnchors && typeof engineState.entityAnchors === 'object' ? engineState.entityAnchors : {};
            const oldAnchor = anchors[oldKey];
            if (!oldAnchor) return { changed: false };
            const newAnchor = anchors[newKey];
            anchors[newKey] = newAnchor ? mergeTimeAnchors(newAnchor, oldAnchor) : normalizeAnchor(oldAnchor, {});
            delete anchors[oldKey];
            engineState.entityAnchors = anchors;
            engineState.updatedAt = Date.now();
            return { changed: true };
        };
        const selfCheck = (context = {}) => {
            const scopeKey = String(context?.scopeKey || context?.scopeId || getActiveManagedRuntimeScopeKey()).trim() || 'global';
            const lorebook = Array.isArray(context?.lorebook) ? context.lorebook : null;
            const warnings = [];
            const anchors = engineState?.entityAnchors && typeof engineState.entityAnchors === 'object'
                ? engineState.entityAnchors
                : {};
            const anchorEntries = Object.entries(anchors);
            const anchorCount = anchorEntries.length;
            const datedAnchorCount = anchorEntries.filter(([, anchor]) => !!(
                anchor?.currentDate
                || anchor?.lastInteractionDate
                || anchor?.lastIntimacyDate
                || anchor?.cycleAnchorDate
            )).length;
            const currentDate = String(engineState?.currentDate || '').trim();
            const currentTime = String(engineState?.currentTime || '').trim();
            const lastSceneDate = String(engineState?.lastSceneDate || '').trim();
            const lastSceneTime = String(engineState?.lastSceneTime || '').trim();
            const currentLabel = String(engineState?.currentLabel || '').trim();
            const lastSceneLabel = String(engineState?.lastSceneLabel || '').trim();
            const parsedCurrentDate = currentDate ? LibraTimeParser.parseDateText(currentDate) : null;
            const parsedLastSceneDate = lastSceneDate ? LibraTimeParser.parseDateText(lastSceneDate) : null;
            if (currentDate && !parsedCurrentDate) warnings.push('currentDate is not parser-readable');
            if (lastSceneDate && !parsedLastSceneDate) warnings.push('lastSceneDate is not parser-readable');
            if (currentTime && !LibraTimeParser.parseTimeText(currentTime)) warnings.push('currentTime is not HH:mm[:ss]');
            if (lastSceneTime && !LibraTimeParser.parseTimeText(lastSceneTime)) warnings.push('lastSceneTime is not HH:mm[:ss]');
            if (!currentDate && datedAnchorCount > 0) warnings.push('entity anchors exist but canonical currentDate is empty');
            let storage = null;
            if (lorebook) {
                const idx = findManagedScopedEntryIndex(lorebook, STATE_COMMENT, scopeKey);
                const entry = idx >= 0 ? lorebook[idx] : null;
                storage = {
                    present: idx >= 0,
                    index: idx,
                    scopeKey: getManagedScopedEntryScope(entry) || '',
                    legacyCompatible: !!entry && !getManagedScopedEntryScope(entry)
                };
                if (!entry && (currentDate || lastSceneDate || anchorCount > 0 || Number(engineState?.sceneTurn || 0) > 0)) {
                    warnings.push('runtime time state has data but scoped lore entry is missing');
                }
            }
            return {
                ok: warnings.length === 0,
                degraded: warnings.length > 0,
                source: 'time_engine',
                scopeKey,
                parserAvailable: !!LibraTimeParser?.parse,
                globalExported: typeof globalThis === 'undefined' || globalThis.LIBRA_TimeEngine === TimeEngine,
                hasCanonicalClock: !!(currentDate || currentTime || lastSceneDate || lastSceneTime || currentLabel || lastSceneLabel),
                currentDate,
                currentTime,
                currentLabel,
                lastSceneDate,
                lastSceneTime,
                lastSceneLabel,
                sceneTurn: Math.max(0, Number(engineState?.sceneTurn || 0)),
                anchorCount,
                datedAnchorCount,
                updatedAt: Number(engineState?.updatedAt || 0),
                updatedAgeMs: Number(engineState?.updatedAt || 0) > 0 ? Math.max(0, Date.now() - Number(engineState.updatedAt || 0)) : null,
                storage,
                warnings: normalizeRuntimeList(warnings, 24, 180)
            };
        };

        return {
            loadState, saveState, resetState, getState,
            ingestEntityTracking, ingestLiveTurn, getProjection, projectEntity,
            renameEntityAnchor,
            selfCheck,
            parse: LibraTimeParser.parse,
            resolveTextTarget: LibraTimeParser.resolveTextTarget,
            getStoryAnchorDate: (lorebook = null) => deriveStoryAnchorDate(lorebook)
        };
    })();
    if (typeof globalThis !== 'undefined') {
        globalThis.LIBRA_TimeParser = LibraTimeParser;
        globalThis.LIBRA_TimeEngine = TimeEngine;
        globalThis.LIBRA_getEntityTimeProjection = (entityOrName, maybeEntity = null) => {
            const entity = maybeEntity && typeof maybeEntity === 'object'
                ? maybeEntity
                : (entityOrName && typeof entityOrName === 'object' ? entityOrName : {});
            const entityName = typeof entityOrName === 'string' ? entityOrName : (entity?.name || '');
            return TimeEngine.getProjection(entityName, entity);
        };
    }

    const buildTemporalPrecisionPrompt = (focusEntities = [], options = {}) => {
        const focusNames = (Array.isArray(focusEntities) ? focusEntities : [])
            .map(item => String(item?.name || item || '').trim())
            .filter(Boolean);
        const timeState = TimeEngine.getState?.() || {};
        const currentClock = [timeState.currentDate, timeState.currentTime].map(v => String(v || '').trim()).filter(Boolean).join(' ');
        const lastSceneClock = [timeState.lastSceneDate, timeState.lastSceneTime].map(v => String(v || '').trim()).filter(Boolean).join(' ');
        const currentLabel = String(timeState.currentLabel || '').trim() || currentClock;
        const lastSceneLabel = String(timeState.lastSceneLabel || '').trim() || lastSceneClock;
        const lines = [
            '[시간 정밀도 / Temporal Precision]',
            '특정 사실, 사건, 약속, 만남, 상태 변화의 시점을 말할 때는 "어제", "최근", "전날", "저번에", "last time", "yesterday"만 단독으로 쓰지 마세요.',
            '시간 엔진에 날짜/시각 anchor가 있으면 상대 표현 대신 정확한 날짜/시각을 우선 쓰고, 필요할 때만 괄호로 상대 표현을 덧붙이세요. 예: "YYYY-MM-DD 밤(어제)"',
            '정확한 날짜가 없으면 추측해서 만들지 말고, "정확한 날짜는 확정되지 않았지만"처럼 불확실성을 유지하세요.'
        ];
        if (currentLabel) lines.push(`canonical_now: ${currentLabel}`);
        if (currentLabel && currentClock && currentLabel !== currentClock) lines.push(`canonical_now_normalized: ${currentClock}`);
        if (lastSceneLabel) lines.push(`last_scene_time: ${lastSceneLabel}`);
        if (lastSceneLabel && lastSceneClock && lastSceneLabel !== lastSceneClock) lines.push(`last_scene_time_normalized: ${lastSceneClock}`);
        const sceneTurn = Math.max(0, Number(timeState.sceneTurn || 0));
        if (sceneTurn > 0) lines.push(`scene_turn: ${sceneTurn}`);
        const notes = String(timeState.notes || '').replace(/\s+/g, ' ').trim();
        if (notes) lines.push(`time_notes: ${truncateForLLM(notes, 180, ' ... ')}`);

        const anchors = timeState.entityAnchors && typeof timeState.entityAnchors === 'object'
            ? timeState.entityAnchors
            : {};
        const maxAnchors = Math.max(0, Number(options?.maxEntityAnchors || 5));
        const selectedKeys = [];
        const pushKey = (key) => {
            const normalized = String(key || '').trim().toLowerCase();
            if (!normalized || selectedKeys.includes(normalized) || !anchors[normalized]) return;
            selectedKeys.push(normalized);
        };
        focusNames.forEach(pushKey);
        Object.keys(anchors).sort().forEach(key => {
            if (selectedKeys.length >= maxAnchors) return;
            pushKey(key);
        });
        for (const key of selectedKeys.slice(0, maxAnchors)) {
            const anchor = anchors[key] || {};
            const entityNow = [anchor.currentDate, anchor.currentTime].map(v => String(v || '').trim()).filter(Boolean).join(' ');
            const interaction = [anchor.lastInteractionDate, anchor.lastInteractionTime].map(v => String(v || '').trim()).filter(Boolean).join(' ');
            const intimacy = [anchor.lastIntimacyDate, anchor.lastIntimacyTime].map(v => String(v || '').trim()).filter(Boolean).join(' ');
            if (entityNow) lines.push(`entity_time.${key}: ${entityNow}`);
            if (interaction) lines.push(`entity_last_interaction.${key}: ${interaction}`);
            if (intimacy) lines.push(`entity_last_intimacy.${key}: ${intimacy}`);
        }

        return lines.join('\n');
    };
