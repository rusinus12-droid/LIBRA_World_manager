    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Narrative Tracker
    // ══════════════════════════════════════════════════════════════
    const NarrativeTracker = (() => {
        const NARRATIVE_COMMENT = 'lmai_narrative';
        const SUMMARY_INTERVAL = 5;
        const NARRATIVE_TURN_LOG_LIMIT = 160;
        const NARRATIVE_META_TURN_LOG_LIMIT = 80;

        let narrativeState = {
            storylines: [],
            turnLog: [],
            metaTurnLog: [],
            lastSummaryTurn: 0
        };

        const clipText = (text, max = 180) => {
            const normalized = String(text || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return '';
            if (normalized.length <= max) return normalized;
            const sliced = normalized.slice(0, Math.max(0, max - 1));
            const boundary = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('! '), sliced.lastIndexOf('? '), sliced.lastIndexOf(', '), sliced.lastIndexOf(' '));
            const compact = (boundary >= Math.max(24, Math.floor(max * 0.45)) ? sliced.slice(0, boundary) : sliced).trim();
            return `${compact}…`;
        };

        const normalizeNarrativeDedupeKey = (value = '') => {
            const normalized = normalizeKnowledgeText(value)
                || String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
            return normalized
                .replace(/["'“”‘’()[\]{}<>]/g, '')
                .replace(/[.,!?…:;|/\\_-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 160);
        };

        const narrativeTextSimilar = (a = '', b = '') => {
            const ak = normalizeNarrativeDedupeKey(a);
            const bk = normalizeNarrativeDedupeKey(b);
            if (!ak || !bk) return false;
            if (ak === bk) return true;
            if (Math.min(ak.length, bk.length) >= 28 && (ak.includes(bk) || bk.includes(ak))) return true;
            const at = new Set(ak.split(/\s+/).filter(part => part.length >= 2));
            const bt = new Set(bk.split(/\s+/).filter(part => part.length >= 2));
            const base = Math.min(at.size, bt.size);
            if (base < 3) return false;
            let shared = 0;
            for (const token of at) if (bt.has(token)) shared++;
            return shared / base >= 0.72;
        };

        const pushNarrativeUniqueLimited = (current = [], incoming = [], limit = 12, options = {}) => {
            const maxChars = Math.max(40, Number(options?.maxChars || 160));
            const exclusions = (Array.isArray(options?.exclude) ? options.exclude : [])
                .map(item => clipText(item, maxChars))
                .filter(Boolean);
            const out = [];
            for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
                const text = clipText(item, maxChars);
                if (!text) continue;
                if (exclusions.some(exclude => narrativeTextSimilar(text, exclude))) continue;
                if (out.some(existing => narrativeTextSimilar(existing, text))) continue;
                out.push(text);
            }
            return out.slice(-Math.max(1, Number(limit || 12)));
        };

        const normalizeNarrativeStringArray = (value, limit = 8, maxChars = 160) => (
            pushNarrativeUniqueLimited(
                [],
                (Array.isArray(value) ? value : (value ? [value] : []))
                    .map(item => typeof item === 'string' ? item : item?.label || item?.text || item?.status || '')
                    .filter(Boolean),
                limit,
                { maxChars }
            )
        );

        const dedupeNarrativeRecentEvents = (events = [], limit = 10) => {
            const seen = new Set();
            const out = [];
            for (const event of Array.isArray(events) ? events : []) {
                const rawTurn = Number(event?.turn || 0);
                const turn = Number.isFinite(rawTurn) && rawTurn > 0 ? rawTurn : (event?.turn || '?');
                const brief = clipText(event?.brief || event?.summary || event?.text || '', 220);
                if (!brief) continue;
                const arcKey = String(event?.arcKey || '').trim();
                const key = `${turn}|${normalizeNarrativeDedupeKey(brief)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ ...event, turn, brief, arcKey });
            }
            return out.slice(-Math.max(1, Number(limit || 10) || 10));
        };

        const normalizeNarrativeEntityKey = (value = '') => {
            const raw = String(value || '').normalize('NFKC').toLowerCase().trim();
            if (!raw) return '';
            const compact = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
            const squashed = raw.replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]+/g, '');
            return squashed || compact;
        };

        const narrativeEntityKeySet = (value = '') => {
            const raw = String(value || '').normalize('NFKC').trim();
            const candidates = new Set([raw]);
            const parens = [...raw.matchAll(/\(([^)]{1,60})\)/g)].map(match => match[1]);
            parens.forEach(part => candidates.add(part));
            candidates.add(raw.replace(/\([^)]*\)/g, ' '));
            raw.split(/[\/|,，;；]+/).forEach(part => candidates.add(part));
            const keys = new Set();
            for (const candidate of candidates) {
                const key = normalizeNarrativeEntityKey(candidate);
                if (key) keys.add(key);
            }
            return keys;
        };

        const narrativeEntitiesOverlapScore = (left = [], right = []) => {
            const leftKeys = new Set((Array.isArray(left) ? left : []).flatMap(item => [...narrativeEntityKeySet(item)]));
            const rightKeys = new Set((Array.isArray(right) ? right : []).flatMap(item => [...narrativeEntityKeySet(item)]));
            if (!leftKeys.size || !rightKeys.size) return 0;
            let overlap = 0;
            for (const key of leftKeys) if (rightKeys.has(key)) overlap++;
            return overlap / Math.max(1, Math.min(leftKeys.size, rightKeys.size));
        };

        const isGenericNarrativeStorylineName = (value = '') => /^Storyline #\d+$/i.test(String(value || '').trim());

        const isGenericNarrativeArcKey = (key = '') => {
            const value = String(key || '').trim();
            if (!value) return true;
            if (/^storyline_\d+$/i.test(value)) return true;
            if (/^(?:main|current|default|general|unknown|misc|기본|현재|일반|미정)$/i.test(value)) return true;
            return false;
        };

        const isConcreteNarrativeArcKey = (key = '') => !isGenericNarrativeArcKey(key);

        const narrativeArcKeysCompatible = (left = '', right = '') => {
            const leftArc = String(left || '').trim();
            const rightArc = String(right || '').trim();
            if (isConcreteNarrativeArcKey(leftArc) && isConcreteNarrativeArcKey(rightArc)) {
                return leftArc === rightArc;
            }
            return true;
        };

        const narrativeStorylineNameFromArcKey = (arcKey = '', fallback = '') => {
            const value = String(arcKey || '').trim();
            if (!value) return String(fallback || '').trim();
            return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        };

        const pushNarrativeEntity = (entities = [], entity = '') => {
            const text = String(entity || '').trim();
            if (!text) return entities;
            const next = Array.isArray(entities) ? [...entities] : [];
            const incomingKeys = narrativeEntityKeySet(text);
            const hasAlias = next.some(existing => {
                const existingKeys = narrativeEntityKeySet(existing);
                for (const key of incomingKeys) if (existingKeys.has(key)) return true;
                return false;
            });
            if (!hasAlias) next.push(text);
            return next;
        };

        const isNarrativeStatusOrControlLine = (line = '') => {
            const text = String(line || '').trim();
            if (!text) return true;
            if (/^#{1,6}\s+/.test(text)) return true;
            if (/^(?:volume|chapter)\b/i.test(text)) return true;
            if (/^chatindex\s*:/i.test(text)) return true;
            if (/^⏱️?\s*\[/.test(text)) return true;
            if (/^\[\s*(?:response|응답|assistant|character)\s*\]$/i.test(text)) return true;
            if (/^[-=_*]{3,}$/.test(text)) return true;
            if (/^```/.test(text)) return true;
            if (/^<!--/.test(text)) return true;
            if (/^<\s*\/?\s*(?:GigaTrans|HAYAKU|GT-|lb-|img\b)/i.test(text)) return true;
            if (/^\[LBDATA\b/i.test(text)) return true;
            if (/^\[[^\]]*(?:HAYAKU|GigaTrans|VN|Feedback|Translate)[^\]]*\]/i.test(text)) return true;
            if (/^★\s*📍/.test(text)) return true;
            if (/^🚪\s*name\s*:/i.test(text)) return true;
            if (/^§\s*[^§]{0,100}\s*§$/.test(text)) return true;
            return false;
        };

        const cleanNarrativeText = (text) => {
            const raw = Utils.getNarrativeSourceText(text, 'ai') || Utils.getMemorySourceText(text) || String(text || '');
            if (!raw) return '';
            const cleanedLines = raw
                .replace(/\r/g, '')
                .split('\n')
                .map(line => line.trim())
                .filter(line => !isNarrativeStatusOrControlLine(line));
            return cleanedLines.join('\n').trim();
        };

        const extractNarrativeParagraph = (text) => {
            const cleaned = cleanNarrativeText(text);
            if (!cleaned) return '';
            const paragraphs = cleaned
                .split(/\n{2,}/)
                .map(part => part.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const meaningful = paragraphs.find(part => (part.match(/[A-Za-z0-9\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length >= 12);
            return meaningful || paragraphs[0] || '';
        };

        const splitNarrativeSentences = (text) => {
            const normalized = String(text || '').replace(/\r/g, '\n').trim();
            if (!normalized) return [];
            return normalized
                .split(/\n+/)
                .flatMap(part => part.match(/[^.!?。！？…\n]+(?:[.!?。！？…]+|$)/g) || [part])
                .map(part => part.replace(/\s+/g, ' ').trim())
                .filter(part => part && !isNarrativeStatusOrControlLine(part));
        };

        const scoreNarrativeContinuitySentence = (sentence = '') => {
            const text = String(sentence || '').trim();
            if (!text || isNarrativeStatusOrControlLine(text)) return -20;
            let score = 0;
            const bump = (pattern, value) => { if (pattern.test(text)) score += value; };
            bump(/결심|선택|대답|거절|수락|확인|숨기|말해야|요청|안내|설명|약속|합의/, 4);
            bump(/말했|물었|답했|도착|나섰|들어|바라보|웃|침묵|멈추|발견|이동|따라|열었|닫았|돌아/, 3);
            bump(/갈등|긴장|오해|폭로|위기|문제|단서|비밀|규칙|목표|계획|변화|전환|관계|감정/, 2);
            if (text.length < 14) score -= 4;
            if (text.length > 260) score -= 2;
            if (/^[“"']/.test(text)) score += 1;
            return score;
        };

        const extractNarrativeSceneLocation = (raw = '', cleaned = '') => {
            const text = `${raw || ''}\n${cleaned || ''}`;
            const status = text.match(/★\s*📍\s*([^§\n]{2,90})/);
            if (status?.[1]) return { current: clipText(status[1], 90), source: 'status' };
            return { current: '', source: '' };
        };

        const extractNarrativeTemporalState = (raw = '') => {
            const text = String(raw || '');
            const labels = [];
            const bracket = text.match(/⏱️?\s*\[([^\]]{1,120})\]/);
            if (bracket?.[1]) labels.push(bracket[1]);
            for (const match of text.matchAll(/§\s*([^§]{1,120}?(?:\d{1,2}:\d{2}|오전|오후|AM|PM)[^§]{0,80})\s*§/gi)) {
                labels.push(match[1]);
            }
            const storyLabel = text.match(/(\d{1,6}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*\([^)]{1,12}\))?(?:\s*(?:오전|오후)\s*\d{1,2}(?::|시\s*)?\d{0,2}(?:분)?|\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?|\s*)?)/i);
            if (storyLabel?.[1]) labels.push(storyLabel[1]);
            const numericLabel = text.match(/\b(\d{1,6}[-./]\d{1,2}[-./]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)\b/i);
            if (numericLabel?.[1]) labels.push(numericLabel[1]);
            const label = clipText(labels.find(Boolean) || '', 100);
            const dateMatch = text.match(/\b(\d{1,6}[-./]\d{1,2}[-./]\d{1,2})\b/) || text.match(/\b(\d{1,6}년\s*\d{1,2}월\s*\d{1,2}일)\b/);
            let time = '';
            const timeSource = label || text;
            const krTime = timeSource.match(/(오전|오후)\s*(\d{1,2})(?::|시\s*)?(\d{2})?/);
            if (krTime) {
                let hour = Number(krTime[2] || 0);
                const minute = Number(krTime[3] || 0);
                if (krTime[1] === '오후' && hour < 12) hour += 12;
                if (krTime[1] === '오전' && hour === 12) hour = 0;
                time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            }
            if (!time) {
                const hhmm = timeSource.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)?\b/i);
                if (hhmm?.[4]) {
                    let hour = Number(hhmm[1]);
                    if (/PM/i.test(hhmm[4]) && hour < 12) hour += 12;
                    if (/AM/i.test(hhmm[4]) && hour === 12) hour = 0;
                    time = `${String(hour).padStart(2, '0')}:${hhmm[2]}:${hhmm[3] || '00'}`;
                } else if (hhmm) {
                    time = `${String(Number(hhmm[1])).padStart(2, '0')}:${hhmm[2]}${hhmm[3] ? `:${hhmm[3]}` : ''}`;
                }
            }
            return {
                label,
                date: dateMatch?.[1]
                    ? dateMatch[1].replace(/[./]/g, '-').replace(/(\d{1,6})년\s*(\d{1,2})월\s*(\d{1,2})일/, (_, y, m, d) => `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`)
                    : '',
                time
            };
        };

        const normalizeNarrativeThread = (thread, fallbackTurn = 0) => {
            const isObject = thread && typeof thread === 'object' && !Array.isArray(thread);
            const label = clipText(isObject ? (thread.label || thread.name || thread.text || '') : thread, 120);
            if (!label) return null;
            const id = String(isObject ? (thread.id || thread.key || '') : '').trim()
                || `thread.${normalizeNarrativeDedupeKey(label).replace(/\s+/g, '_').slice(0, 48) || stableHash(label)}`;
            const sourceTurns = Array.from(new Set(
                (Array.isArray(thread?.sourceTurns) ? thread.sourceTurns : [thread?.turn, fallbackTurn])
                    .map(turn => Number(turn || 0))
                    .filter(Number.isFinite)
                    .filter(turn => turn > 0)
            )).slice(-8);
            const evidenceTurns = normalizeNarrativeStringArray(thread?.evidenceTurns || (fallbackTurn > 0 ? [`T${fallbackTurn}`] : []), 8, 40);
            const memoryRefs = normalizeNarrativeStringArray(thread?.memoryRefs || [], 8, 80);
            return {
                id,
                label,
                status: clipText(isObject ? (thread.status || thread.state || '') : '', 140),
                sourceTurns,
                evidenceTurns,
                memoryRefs,
                lastUpdatedTurn: Number(thread?.lastUpdatedTurn || sourceTurns[sourceTurns.length - 1] || fallbackTurn || 0)
            };
        };

        const mergeNarrativeThreads = (current = [], incoming = [], limit = 8) => {
            const map = new Map();
            const add = (thread) => {
                const normalized = normalizeNarrativeThread(thread);
                if (!normalized) return;
                const key = normalized.id || normalizeNarrativeDedupeKey(normalized.label);
                const existing = map.get(key);
                if (!existing) {
                    map.set(key, normalized);
                    return;
                }
                existing.label = existing.label || normalized.label;
                if (normalized.status && !narrativeTextSimilar(existing.status, normalized.status)) existing.status = normalized.status;
                existing.sourceTurns = Array.from(new Set([...(existing.sourceTurns || []), ...(normalized.sourceTurns || [])])).sort((a, b) => a - b).slice(-8);
                existing.evidenceTurns = pushNarrativeUniqueLimited(existing.evidenceTurns, normalized.evidenceTurns, 8, { maxChars: 40 });
                existing.memoryRefs = pushNarrativeUniqueLimited(existing.memoryRefs, normalized.memoryRefs, 8, { maxChars: 80 });
                existing.lastUpdatedTurn = Math.max(Number(existing.lastUpdatedTurn || 0), Number(normalized.lastUpdatedTurn || 0));
            };
            [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])].forEach(add);
            return Array.from(map.values())
                .sort((a, b) => Number(a.lastUpdatedTurn || 0) - Number(b.lastUpdatedTurn || 0))
                .slice(-Math.max(1, Number(limit || 8)));
        };

        const narrativeThreadOverlapScore = (left = [], right = []) => {
            const toKeys = (items = []) => new Set((Array.isArray(items) ? items : [])
                .map(item => normalizeNarrativeThread(item))
                .filter(Boolean)
                .flatMap(item => [item.id, normalizeNarrativeDedupeKey(item.label)].filter(Boolean)));
            const leftKeys = toKeys(left);
            const rightKeys = toKeys(right);
            if (!leftKeys.size || !rightKeys.size) return 0;
            let overlap = 0;
            for (const key of leftKeys) if (rightKeys.has(key)) overlap++;
            return overlap / Math.max(1, Math.min(leftKeys.size, rightKeys.size));
        };

        const extractNarrativeSignals = (userMsg, aiResponse, options = {}) => {
            const raw = Utils.getNarrativeSourceText(aiResponse, 'ai') || Utils.getMemorySourceText(aiResponse) || String(aiResponse || '');
            const cleaned = cleanNarrativeText(aiResponse);
            const normalizedUser = '';
            const turn = Number(options?.turn || 0);
            const sourceMessageIds = normalizeCanonicalMessageIds(options?.sourceMessageIds || []);
            const memoryRefs = pushNarrativeUniqueLimited(
                [],
                [
                    turn > 0 ? `turn:${turn}` : '',
                    ...sourceMessageIds.map(id => `msg:${id}`)
                ],
                8,
                { maxChars: 80 }
            );
            const evidenceTurns = turn > 0 ? [`T${turn}`] : [];
            const sentences = splitNarrativeSentences(cleaned);
            const scored = sentences
                .map((text, index) => ({ text, index, score: scoreNarrativeContinuitySentence(text) }))
                .sort((a, b) => (b.score - a.score) || (a.index - b.index));
            const locationState = extractNarrativeSceneLocation(raw, cleaned);
            const temporalState = extractNarrativeTemporalState(raw);
            const activeThreads = [];
            const unresolvedQuestions = [];
            const nextBeatHints = [];
            const relationPressure = [];
            const threadUpdates = [];
            const ongoingTensions = [];
            const topSentence = clipText(scored.find(item => item.score > 0)?.text || sentences[0] || '', 180);
            const responseBrief = clipText(topSentence || normalizedUser, 180);

            const distinctEvents = pushNarrativeUniqueLimited(
                [],
                [topSentence || responseBrief],
                6,
                { maxChars: 180 }
            );
            const stateChanges = pushNarrativeUniqueLimited(
                [],
                [
                    locationState.current ? `장소 축: ${locationState.current}` : '',
                    temporalState.label || temporalState.time ? `시간 축: ${temporalState.label || temporalState.time}` : '',
                    activeThreads.length ? `진행 스레드: ${activeThreads.map(thread => thread.label).join(', ')}` : ''
                ],
                4,
                { maxChars: 160 }
            );
            const keyPoints = pushNarrativeUniqueLimited([], [...stateChanges, ...distinctEvents], 8, { maxChars: 150 });
            const continuityBrief = clipText(pushNarrativeUniqueLimited(
                [],
                [
                    locationState.current ? `장소: ${locationState.current}` : '',
                    temporalState.label || temporalState.time ? `시각: ${temporalState.label || temporalState.time}` : '',
                    responseBrief
                ],
                5,
                { maxChars: 160 }
            ).join(' | ') || responseBrief, 240);
            const dedupeKeys = Array.from(new Set(
                [responseBrief, continuityBrief, ...threadUpdates, ...distinctEvents]
                    .map(normalizeNarrativeDedupeKey)
                    .filter(Boolean)
            )).slice(0, 10);

            return {
                responseBrief,
                continuityBrief,
                lastDistinctEvent: clipText(distinctEvents[0] || responseBrief, 180),
                distinctEvents,
                stateChanges,
                threadUpdates,
                relationUpdates: relationPressure,
                nextBeat: nextBeatHints[0] || '',
                activeThreads: mergeNarrativeThreads([], activeThreads, 8),
                unresolvedQuestions: pushNarrativeUniqueLimited([], unresolvedQuestions, 6, { maxChars: 140 }),
                nextBeatHints: pushNarrativeUniqueLimited([], nextBeatHints, 6, { maxChars: 140 }),
                relationPressure: pushNarrativeUniqueLimited([], relationPressure, 6, { maxChars: 140 }),
                locationState,
                temporalState,
                keyPoints,
                ongoingTensions,
                memoryRefs,
                evidenceTurns,
                dedupeKeys
            };
        };

        const buildHeuristicTurnBrief = (userMsg, aiResponse) => {
            const signals = extractNarrativeSignals('', aiResponse);
            if (signals.responseBrief) return signals.responseBrief;
            const paragraph = extractNarrativeParagraph(aiResponse);
            if (!paragraph) return '';

            const sentences = paragraph.match(/[^.!?…\n]+(?:[.!?…]+|$)/g) || [paragraph];
            const picked = [];
            let totalLength = 0;
            for (const sentence of sentences) {
                const compact = sentence.replace(/\s+/g, ' ').trim();
                if (!compact) continue;
                if (picked.length >= 2) break;
                if (picked.length > 0 && totalLength + compact.length > 180) break;
                picked.push(compact);
                totalLength += compact.length;
            }

            const summary = clipText((picked.join(' ') || paragraph).replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), 180);
            if (summary) return summary;
            return '';
        };

        const generateTurnBrief = async (userMsg, aiResponse) => buildHeuristicTurnBrief(userMsg, aiResponse);

        const deriveKeyPointsFromBrief = (brief, maxItems = 3) => {
            const normalized = String(brief || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return [];
            const parts = splitNarrativeSentences(normalized.replace(/\s+\/\s+/g, '\n').replace(/\s+\|\s+/g, '\n'))
                .map(part => clipText(part, 110))
                .filter(part => part.length >= 12 && !/^[\u3131-\u318e\uac00-\ud7a3]{1,6}$/.test(part));
            return pushNarrativeUniqueLimited([], parts.length ? parts : [normalized], maxItems, { maxChars: 110 });
        };

        const deriveOngoingTensionsFromTurn = (turnEntry, maxItems = 3) => {
            const candidates = [];
            if (Array.isArray(turnEntry?.activeThreads)) {
                for (const thread of turnEntry.activeThreads) {
                    const normalized = normalizeNarrativeThread(thread, turnEntry?.turn || 0);
                    if (normalized?.label) candidates.push(`${normalized.label}: ${normalized.status || 'open'}`);
                }
            }
            candidates.push(...normalizeNarrativeStringArray(turnEntry?.unresolvedQuestions, 4, 140));
            candidates.push(...normalizeNarrativeStringArray(turnEntry?.relationPressure, 4, 140));
            candidates.push(...normalizeNarrativeStringArray(turnEntry?.nextBeatHints, 3, 140).map(item => `Next: ${item}`));
            return pushNarrativeUniqueLimited([], candidates, maxItems, { maxChars: 140 });
        };

        const normalizeNarrativeArcLabel = (value = '') => clipText(String(value || '').replace(/\s+/g, ' ').trim(), 120);

        const makeNarrativeArcKey = (value = '') => {
            const label = normalizeNarrativeArcLabel(value);
            if (!label) return '';
            return label
                .normalize('NFKC')
                .toLowerCase()
                .replace(/[\u0000-\u001f]+/g, ' ')
                .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 80) || `arc_${stableHash(label)}`;
        };

        const detectNarrativeArcFromText = (value = '') => {
            return { key: '', name: '', confidence: 0 };
        };

        const buildNarrativeArcPatch = (turnEntry = {}, updates = {}) => {
            const storyAuthor = updates?.storyAuthor && typeof updates.storyAuthor === 'object' ? updates.storyAuthor : {};
            const explicitName = normalizeNarrativeArcLabel(
                updates.storylineName
                || updates.currentArc
                || storyAuthor.currentArc
                || updates.name
                || ''
            );
            const explicitKey = String(updates.arcKey || '').trim();
            const narrativeGoal = clipText(updates.narrativeGoal || storyAuthor.narrativeGoal || '', 220);
            const name = explicitName;
            const key = explicitKey || makeNarrativeArcKey(name);
            const threadTexts = Array.isArray(turnEntry?.activeThreads)
                ? turnEntry.activeThreads.map(thread => {
                    const normalized = normalizeNarrativeThread(thread, turnEntry?.turn || 0);
                    return normalized ? `${normalized.label}: ${normalized.status}` : '';
                }).filter(Boolean)
                : [];
            const activeTensions = dedupeTextArray([
                ...(Array.isArray(updates.ongoingTensions) ? updates.ongoingTensions : []),
                ...(Array.isArray(storyAuthor.activeTensions) ? storyAuthor.activeTensions : []),
                ...(Array.isArray(turnEntry?.ongoingTensions) ? turnEntry.ongoingTensions : []),
                ...threadTexts,
                ...(Array.isArray(turnEntry?.unresolvedQuestions) ? turnEntry.unresolvedQuestions : []),
                ...(Array.isArray(turnEntry?.relationPressure) ? turnEntry.relationPressure : []),
                ...(narrativeGoal ? [narrativeGoal] : [])
            ]).map(item => clipText(item, 150)).filter(Boolean).slice(0, 6);
            const keyPoints = dedupeTextArray([
                ...(Array.isArray(updates.keyPoints) ? updates.keyPoints : []),
                ...(Array.isArray(storyAuthor.nextBeats) ? storyAuthor.nextBeats : []),
                ...(Array.isArray(storyAuthor.recentDecisions) ? storyAuthor.recentDecisions : []),
                ...(Array.isArray(turnEntry?.distinctEvents) ? turnEntry.distinctEvents : []),
                ...(Array.isArray(turnEntry?.stateChanges) ? turnEntry.stateChanges : []),
                ...(Array.isArray(turnEntry?.nextBeatHints) ? turnEntry.nextBeatHints : []),
                ...deriveKeyPointsFromBrief(updates.summary || turnEntry?.summary || turnEntry?.response || '')
            ]).map(item => clipText(item, 120)).filter(Boolean).slice(0, 8);
            return {
                arcKey: key,
                name,
                phase: clipText(updates.phase || storyAuthor.scenePhase || '', 80),
                primaryConflict: narrativeGoal || activeTensions[0] || '',
                keyPoints,
                ongoingTensions: activeTensions,
                confidence: Math.max(Number(updates.arcConfidence || 0), key ? 0.65 : 0)
            };
        };

        const pushUniqueLimited = (current = [], incoming = [], limit = 12) => {
            return pushNarrativeUniqueLimited(current, incoming, limit, { maxChars: 160 });
        };

        const removeTurnFromStorylines = (turn) => {
            const targetTurn = Number(turn || 0);
            if (!targetTurn) return;
            narrativeState.storylines = (Array.isArray(narrativeState.storylines) ? narrativeState.storylines : []).map(storyline => {
                storyline.turns = Array.isArray(storyline.turns)
                    ? storyline.turns.filter(item => Number(item || 0) !== targetTurn)
                    : [];
                storyline.recentEvents = Array.isArray(storyline.recentEvents)
                    ? storyline.recentEvents.filter(item => Number(item?.turn || 0) !== targetTurn)
                    : [];
                storyline.firstTurn = storyline.turns.length ? Math.min(...storyline.turns.map(Number).filter(Number.isFinite)) : 0;
                storyline.lastTurn = storyline.turns.length ? Math.max(...storyline.turns.map(Number).filter(Number.isFinite)) : 0;
                return storyline;
            }).filter(storyline => Array.isArray(storyline.turns) && storyline.turns.length > 0);
        };

        const refreshNarrativeStorylineBounds = (storyline = {}) => {
            const turns = Array.isArray(storyline.turns)
                ? Array.from(new Set(storyline.turns.map(turn => normalizeLegacyMemoryTurnAnchor(turn)).filter(Boolean))).sort((a, b) => a - b)
                : [];
            storyline.turns = turns;
            storyline.firstTurn = turns.length ? turns[0] : 0;
            storyline.lastTurn = turns.length ? turns[turns.length - 1] : 0;
            if (Array.isArray(storyline.recentEvents) && storyline.recentEvents.length) {
                const lastEvent = storyline.recentEvents[storyline.recentEvents.length - 1];
                if (!storyline.lastDistinctEvent && lastEvent?.brief) storyline.lastDistinctEvent = clipText(lastEvent.brief, 220);
                if (!storyline.currentContext && lastEvent?.brief) storyline.currentContext = clipText(lastEvent.brief, 260);
                if (!storyline.continuityBrief && lastEvent?.brief) storyline.continuityBrief = clipText(lastEvent.brief, 260);
            }
            return storyline;
        };

        const collectNarrativeRollbackDeletedRefs = (state = {}) => {
            const turns = new Set();
            const hashes = new Set();
            const turnKeys = new Set();
            const messageIds = new Set();
            const addTurn = (value) => {
                const turn = normalizeLegacyMemoryTurnAnchor(value || 0);
                if (turn) turns.add(turn);
            };
            const addText = (set, value) => {
                for (const item of Array.isArray(value) ? value : [value]) {
                    const text = String(item || '').trim();
                    if (text) set.add(text);
                }
            };
            const addMessageIds = (value) => {
                for (const id of normalizeCanonicalMessageIds(value || [])) {
                    if (id) messageIds.add(id);
                }
            };
            const addCandidate = (candidate = {}) => {
                if (!candidate || typeof candidate !== 'object') return;
                addTurn(candidate.turn || candidate.t || candidate.deletedTurn || candidate.upToTurn);
                if (Array.isArray(candidate.turns)) candidate.turns.forEach(addTurn);
                addText(hashes, [candidate.hash, candidate.sourceHash, candidate.aiHash, candidate.responseHash, candidate.hashes].flat());
                addText(turnKeys, [candidate.turnKey, candidate.turnKeys].flat());
                addMessageIds([candidate.messageId, candidate.messageIds, candidate.sourceMessageIds, candidate.liveMessageIds]);
            };
            if (Array.isArray(state.rollbackDeletedTurns)) state.rollbackDeletedTurns.forEach(addCandidate);
            const meta = state?.meta && typeof state.meta === 'object' ? state.meta : {};
            if (Array.isArray(meta.rollbackDeleteCandidates)) meta.rollbackDeleteCandidates.forEach(addCandidate);
            if (!turns.size && !hashes.size && !turnKeys.size && !messageIds.size) return null;
            return { turns, hashes, turnKeys, messageIds };
        };

        const narrativeRecordMatchesDeletedRefs = (record = {}, deletedRefs = null) => {
            if (!deletedRefs || !record || typeof record !== 'object') return false;
            const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
            const turns = [
                record.turn,
                record.t,
                record.upToTurn,
                record.turnAnchor,
                record.turnAnchorTurn,
                record.lockedTurn,
                record.finalizedTurn,
                meta.turn,
                meta.t,
                meta.upToTurn,
                meta.turnAnchor,
                meta.turnAnchorTurn,
                meta.lockedTurn,
                meta.finalizedTurn
            ].map(turn => normalizeLegacyMemoryTurnAnchor(turn || 0)).filter(Boolean);
            if (turns.some(turn => deletedRefs.turns.has(turn))) return true;

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
            if (hashes.some(hash => deletedRefs.hashes.has(hash))) return true;

            const turnKey = String(record.turnKey || meta.turnKey || '').trim();
            if (turnKey && deletedRefs.turnKeys.has(turnKey)) return true;

            const ids = normalizeCanonicalMessageIds([
                record.m_id,
                record.m_ids,
                record.messageId,
                record.sourceMessageIds,
                record.liveMessageIds,
                meta.m_id,
                meta.m_ids,
                meta.messageId,
                meta.sourceMessageIds,
                meta.liveMessageIds
            ]);
            return ids.some(id => deletedRefs.messageIds.has(id));
        };

        const narrativeRefTextMatchesDeletedRefs = (value = '', deletedRefs = null) => {
            if (!deletedRefs) return false;
            const text = String(value || '').trim();
            if (!text) return false;
            const escapeRegex = (part = '') => String(part || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            for (const turn of deletedRefs.turns) {
                const pattern = new RegExp(`(^|[^A-Za-z0-9])(?:T\\s*${turn}|turn\\s*[:=_-]?\\s*${turn}|turn\\s+${turn})(?=$|[^A-Za-z0-9])`, 'i');
                if (pattern.test(text)) return true;
            }
            for (const hash of deletedRefs.hashes) {
                if (hash && text.includes(hash)) return true;
            }
            for (const turnKey of deletedRefs.turnKeys) {
                if (turnKey && text.includes(turnKey)) return true;
            }
            for (const id of deletedRefs.messageIds) {
                if (id && text.includes(id)) return true;
                if (id && new RegExp(escapeRegex(id)).test(text)) return true;
            }
            return false;
        };

        const filterNarrativeDeletedRefStrings = (items = [], deletedRefs = null) => (
            (Array.isArray(items) ? items : []).filter(item => !narrativeRefTextMatchesDeletedRefs(item, deletedRefs))
        );

        const pruneNarrativeStateDeletedRefs = (state = {}) => {
            const deletedRefs = collectNarrativeRollbackDeletedRefs(state);
            if (!deletedRefs) return state;
            state.turnLog = (Array.isArray(state.turnLog) ? state.turnLog : []).filter(entry => !narrativeRecordMatchesDeletedRefs(entry, deletedRefs));
            state.metaTurnLog = (Array.isArray(state.metaTurnLog) ? state.metaTurnLog : []).filter(entry => !narrativeRecordMatchesDeletedRefs(entry, deletedRefs));
            state.storylines = (Array.isArray(state.storylines) ? state.storylines : []).map(storyline => {
                const next = storyline && typeof storyline === 'object' ? { ...storyline } : {};
                next.turns = (Array.isArray(next.turns) ? next.turns : [])
                    .map(turn => normalizeLegacyMemoryTurnAnchor(turn))
                    .filter(turn => turn && !deletedRefs.turns.has(turn));
                next.recentEvents = (Array.isArray(next.recentEvents) ? next.recentEvents : [])
                    .filter(event => !narrativeRecordMatchesDeletedRefs(event, deletedRefs));
                next.summaries = (Array.isArray(next.summaries) ? next.summaries : [])
                    .filter(summary => {
                        if (narrativeRecordMatchesDeletedRefs(summary, deletedRefs)) return false;
                        return !(Array.isArray(summary?.evidenceTurns) && summary.evidenceTurns.some(item => narrativeRefTextMatchesDeletedRefs(item, deletedRefs)));
                    })
                    .map(summary => ({
                        ...summary,
                        evidenceTurns: filterNarrativeDeletedRefStrings(summary?.evidenceTurns, deletedRefs)
                    }));
                next.evidenceTurns = filterNarrativeDeletedRefStrings(next.evidenceTurns, deletedRefs);
                next.memoryRefs = filterNarrativeDeletedRefStrings(next.memoryRefs, deletedRefs);
                next.dedupeKeys = filterNarrativeDeletedRefStrings(next.dedupeKeys, deletedRefs);
                return refreshNarrativeStorylineBounds(next);
            }).filter(storyline => {
                if (storyline?.meta?.manualLocked === true) return true;
                return (Array.isArray(storyline.turns) && storyline.turns.length > 0)
                    || String(storyline.currentContext || '').trim()
                    || (Array.isArray(storyline.keyPoints) && storyline.keyPoints.length > 0)
                    || (Array.isArray(storyline.ongoingTensions) && storyline.ongoingTensions.length > 0);
            });
            return state;
        };

        const splitMixedArcStorylines = (state = {}) => {
            const storylines = Array.isArray(state.storylines) ? state.storylines : [];
            if (!storylines.length) return state;
            const turnMap = new Map((Array.isArray(state.turnLog) ? state.turnLog : []).map(entry => [Number(entry?.turn || 0), entry]));
            const nextStorylines = [];

            for (const storyline of storylines) {
                if (!storyline || typeof storyline !== 'object') continue;
                if (storyline?.meta?.manualLocked === true) {
                    nextStorylines.push(storyline);
                    continue;
                }
                const baseArc = String(storyline.arcKey || '').trim();
                const recentEvents = Array.isArray(storyline.recentEvents) ? storyline.recentEvents : [];
                const buckets = new Map();

                for (const event of recentEvents) {
                    const eventArc = String(event?.arcKey || '').trim();
                    if (!isConcreteNarrativeArcKey(eventArc)) continue;
                    if (narrativeArcKeysCompatible(baseArc, eventArc) && baseArc === eventArc) continue;
                    if (isConcreteNarrativeArcKey(baseArc) && !narrativeArcKeysCompatible(baseArc, eventArc)) {
                        if (!buckets.has(eventArc)) buckets.set(eventArc, []);
                        buckets.get(eventArc).push(event);
                    } else if (!isConcreteNarrativeArcKey(baseArc)) {
                        if (!buckets.has(eventArc)) buckets.set(eventArc, []);
                        buckets.get(eventArc).push(event);
                    }
                }

                if (!buckets.size) {
                    nextStorylines.push(storyline);
                    continue;
                }

                const parent = safeClone(storyline);
                const splitTurnsAll = new Set();

                for (const [arcKey, events] of buckets.entries()) {
                    const splitTurns = new Set(events.map(event => normalizeLegacyMemoryTurnAnchor(event?.turn || 0)).filter(Boolean));
                    for (const turn of splitTurns) splitTurnsAll.add(turn);
                    const turnEntries = Array.from(splitTurns).map(turn => turnMap.get(turn)).filter(Boolean);
                    const splitEntities = Array.from(new Set(turnEntries
                        .flatMap(entry => Array.isArray(entry?.involvedEntities) ? entry.involvedEntities : [])
                        .map(String)
                        .filter(Boolean)));
                    const splitSummaries = (Array.isArray(storyline.summaries) ? storyline.summaries : []).filter(summary => {
                        const summaryArc = String(summary?.arcKey || '').trim();
                        const upToTurn = normalizeLegacyMemoryTurnAnchor(summary?.upToTurn || 0);
                        if (summaryArc && summaryArc === arcKey) return true;
                        if (upToTurn && splitTurns.has(upToTurn)) return true;
                        return Array.isArray(summary?.evidenceTurns)
                            && summary.evidenceTurns.some(item => {
                                const match = String(item || '').match(/\bT\s*(\d+)\b/i);
                                return match && splitTurns.has(normalizeLegacyMemoryTurnAnchor(match[1]));
                            });
                    });
                    const sortedTurns = Array.from(splitTurns).sort((a, b) => a - b);
                    const splitStoryline = refreshNarrativeStorylineBounds({
                        ...safeClone(storyline),
                        id: 0,
                        name: narrativeStorylineNameFromArcKey(arcKey, storyline.name),
                        arcKey,
                        entities: splitEntities.length ? splitEntities : safeClone(storyline.entities || []),
                        turns: sortedTurns,
                        recentEvents: dedupeNarrativeRecentEvents(events.map(event => ({
                            ...event,
                            arcKey,
                            brief: clipText(event?.brief || '', 220)
                        })), 10),
                        summaries: splitSummaries,
                        currentContext: events[events.length - 1]?.brief || '',
                        continuityBrief: events[events.length - 1]?.brief || '',
                        lastDistinctEvent: events[events.length - 1]?.brief || '',
                        meta: {
                            ...(storyline.meta || {}),
                            repairedFromStorylineId: storyline.id,
                            repairReason: 'mixed_arc_split'
                        }
                    });
                    nextStorylines.push(splitStoryline);
                }

                parent.turns = (Array.isArray(parent.turns) ? parent.turns : [])
                    .map(turn => normalizeLegacyMemoryTurnAnchor(turn))
                    .filter(turn => turn && !splitTurnsAll.has(turn));
                parent.recentEvents = (Array.isArray(parent.recentEvents) ? parent.recentEvents : [])
                    .filter(event => !splitTurnsAll.has(normalizeLegacyMemoryTurnAnchor(event?.turn || 0)));
                parent.summaries = (Array.isArray(parent.summaries) ? parent.summaries : []).filter(summary => {
                    const summaryArc = String(summary?.arcKey || '').trim();
                    const upToTurn = normalizeLegacyMemoryTurnAnchor(summary?.upToTurn || 0);
                    if (summaryArc && buckets.has(summaryArc)) return false;
                    return !(upToTurn && splitTurnsAll.has(upToTurn));
                });
                refreshNarrativeStorylineBounds(parent);
                if ((Array.isArray(parent.turns) && parent.turns.length > 0)
                    || String(parent.currentContext || '').trim()
                    || (Array.isArray(parent.keyPoints) && parent.keyPoints.length > 0)
                    || (Array.isArray(parent.ongoingTensions) && parent.ongoingTensions.length > 0)) {
                    nextStorylines.push(parent);
                }
            }

            state.storylines = nextStorylines.map((storyline, index) => ({
                ...storyline,
                id: Number(storyline.id || index + 1)
            }));
            return state;
        };

        const applyLiveNarrativeSnapshot = (storyline, turnEntry) => {
            if (!storyline || !turnEntry) return;
            const brief = clipText(turnEntry.continuityBrief || turnEntry.summary || turnEntry.response || '', 240);
            if (!brief) return;
            const lastDistinctEvent = clipText(turnEntry.lastDistinctEvent || turnEntry.responseBrief || turnEntry.summary || brief, 220);

            const arcPatch = turnEntry.narrativeArc && typeof turnEntry.narrativeArc === 'object'
                ? turnEntry.narrativeArc
                : buildNarrativeArcPatch(turnEntry, {});
            if (arcPatch?.arcKey && !storyline.arcKey) storyline.arcKey = arcPatch.arcKey;
            if (arcPatch?.name && (!storyline.name || /^Storyline #\d+$/i.test(String(storyline.name || '')))) storyline.name = arcPatch.name;
            if (arcPatch?.phase) storyline.phase = arcPatch.phase;
            if (arcPatch?.primaryConflict) storyline.primaryConflict = arcPatch.primaryConflict;

            storyline.currentContext = brief;
            storyline.continuityBrief = brief;
            storyline.lastDistinctEvent = lastDistinctEvent;
            if (turnEntry.sceneDate) storyline.lastSceneDate = turnEntry.sceneDate;
            if (turnEntry.sceneTime) storyline.lastSceneTime = turnEntry.sceneTime;
            if (turnEntry.sceneTimeLabel) storyline.lastSceneTimeLabel = turnEntry.sceneTimeLabel;
            if (turnEntry.sceneLocation || turnEntry.locationState?.current) {
                storyline.sceneLocation = clipText(turnEntry.sceneLocation || turnEntry.locationState?.current || '', 100);
            }
            if (turnEntry.locationState && typeof turnEntry.locationState === 'object') storyline.locationState = safeClone(turnEntry.locationState);
            if (turnEntry.temporalState && typeof turnEntry.temporalState === 'object') storyline.temporalState = safeClone(turnEntry.temporalState);
            storyline.activeThreads = mergeNarrativeThreads(storyline.activeThreads, turnEntry.activeThreads, 8);
            storyline.unresolvedQuestions = pushNarrativeUniqueLimited(storyline.unresolvedQuestions, turnEntry.unresolvedQuestions, 8, { maxChars: 140 });
            storyline.nextBeatHints = pushNarrativeUniqueLimited(storyline.nextBeatHints, turnEntry.nextBeatHints, 8, { maxChars: 140 });
            storyline.relationPressure = pushNarrativeUniqueLimited(storyline.relationPressure, turnEntry.relationPressure, 8, { maxChars: 140 });
            storyline.memoryRefs = pushNarrativeUniqueLimited(storyline.memoryRefs, turnEntry.memoryRefs, 12, { maxChars: 80 });
            storyline.evidenceTurns = pushNarrativeUniqueLimited(storyline.evidenceTurns, turnEntry.evidenceTurns, 12, { maxChars: 40 });
            storyline.dedupeKeys = pushNarrativeUniqueLimited(storyline.dedupeKeys, turnEntry.dedupeKeys, 12, { maxChars: 160 });
            const liveKeyPoints = pushUniqueLimited(
                arcPatch?.keyPoints || [],
                [
                    ...(Array.isArray(turnEntry.distinctEvents) ? turnEntry.distinctEvents : []),
                    ...(Array.isArray(turnEntry.stateChanges) ? turnEntry.stateChanges : []),
                    ...deriveKeyPointsFromBrief(brief)
                ],
                8
            ).filter(item => !narrativeTextSimilar(item, brief) && !narrativeTextSimilar(item, lastDistinctEvent));
            const liveTensions = pushUniqueLimited(
                arcPatch?.ongoingTensions || [],
                deriveOngoingTensionsFromTurn(turnEntry),
                6
            );
            storyline.keyPoints = pushUniqueLimited(storyline.keyPoints, liveKeyPoints, 12);
            storyline.ongoingTensions = pushUniqueLimited(storyline.ongoingTensions, liveTensions, 10);
            storyline.summaries = Array.isArray(storyline.summaries) ? storyline.summaries : [];

            const existingLiveIndex = storyline.summaries.findIndex(entry => entry?.live === true);
            const liveEntry = {
                upToTurn: Number(turnEntry.turn || 0),
                summary: brief,
                keyPoints: liveKeyPoints,
                ongoingTensions: liveTensions,
                timestamp: Date.now(),
                live: true,
                sceneDate: turnEntry.sceneDate || '',
                sceneTime: turnEntry.sceneTime || '',
                sceneTimeLabel: turnEntry.sceneTimeLabel || '',
                sceneLocation: turnEntry.sceneLocation || turnEntry.locationState?.current || '',
                arcKey: storyline.arcKey || '',
                continuityBrief: brief,
                lastDistinctEvent,
                activeThreads: mergeNarrativeThreads([], turnEntry.activeThreads, 6),
                nextBeatHints: normalizeNarrativeStringArray(turnEntry.nextBeatHints, 4, 140),
                evidenceTurns: normalizeNarrativeStringArray(turnEntry.evidenceTurns, 8, 40)
            };

            if (existingLiveIndex >= 0) storyline.summaries[existingLiveIndex] = liveEntry;
            else storyline.summaries.push(liveEntry);

            if (storyline.summaries.length > 12) {
                storyline.summaries = storyline.summaries.slice(-12);
            }
        };

        const normalizeTurnEntry = (entry = {}) => {
            const sourceResponse = String(entry.summary || entry.response || '').trim();
            const summary = clipText(buildHeuristicTurnBrief('', sourceResponse), 180);
            const sourceMeta = entry?.meta && typeof entry.meta === 'object' ? safeClone(entry.meta) : {};
            const channel = String(entry.channel || entry.track || sourceMeta.channel || 'scene').trim().toLowerCase() === 'meta'
                ? 'meta'
                : 'scene';
            const containsMetaSignals = entry?.containsMetaSignals === true || sourceMeta.containsMetaSignals === true;
            const turn = Number(entry.turn || 0);
            const anchorTurn = normalizeLegacyMemoryTurnAnchor(
                entry.turnAnchorTurn
                || entry.turnAnchor
                || entry.lockedTurn
                || entry.finalizedTurn
                || sourceMeta.turnAnchorTurn
                || sourceMeta.turnAnchor
                || sourceMeta.lockedTurn
                || sourceMeta.finalizedTurn
                || turn
            ) || turn;
            const sourceMessageIds = normalizeCanonicalMessageIds(
                entry.sourceMessageIds
                || entry.liveMessageIds
                || sourceMeta.sourceMessageIds
                || sourceMeta.liveMessageIds
                || entry.messageId
                || entry.m_id
                || sourceMeta.messageId
                || sourceMeta.m_id
            );
            const sourceHash = String(entry.sourceHash || entry.aiHash || entry.responseHash || sourceMeta.sourceHash || sourceMeta.aiHash || sourceMeta.responseHash || '').trim();
            const messageSignature = String(entry.messageSignature || sourceMeta.messageSignature || '').trim();
            const userTurnKey = String(entry.userTurnKey || sourceMeta.userTurnKey || '').trim();
            const chatId = String(entry.chatId || sourceMeta.chatId || '').trim();
            const turnKey = String(
                entry.turnKey
                || sourceMeta.turnKey
                || buildCanonicalTurnKey(chatId, userTurnKey, sourceHash, messageSignature, sourceMessageIds)
            ).trim();
            const v42Meta = {
                ...sourceMeta,
                t: anchorTurn,
                turn: anchorTurn,
                firstTurn: normalizeLegacyMemoryTurnAnchor(entry.firstTurn || sourceMeta.firstTurn || anchorTurn) || anchorTurn,
                originalTurn: normalizeLegacyMemoryTurnAnchor(entry.originalTurn || sourceMeta.originalTurn || anchorTurn) || anchorTurn,
                lockedTurn: normalizeLegacyMemoryTurnAnchor(entry.lockedTurn || sourceMeta.lockedTurn || anchorTurn) || anchorTurn,
                finalizedTurn: normalizeLegacyMemoryTurnAnchor(entry.finalizedTurn || sourceMeta.finalizedTurn || anchorTurn) || anchorTurn,
                turnAnchorTurn: anchorTurn,
                turnAnchor: anchorTurn,
                turnLocked: entry.turnLocked === true || sourceMeta.turnLocked === true || anchorTurn > 0,
                turnAnchorReason: String(entry.turnAnchorReason || sourceMeta.turnAnchorReason || 'v4.2-narrative-turn').trim() || 'v4.2-narrative-turn',
                sourceMessageIds,
                liveMessageIds: normalizeCanonicalMessageIds(entry.liveMessageIds || sourceMeta.liveMessageIds || sourceMessageIds),
                m_id: String(entry.m_id || sourceMeta.m_id || getPrimaryCanonicalMessageId(sourceMessageIds, true) || '').trim(),
                messageId: String(entry.messageId || sourceMeta.messageId || getPrimaryCanonicalMessageId(sourceMessageIds, true) || '').trim(),
                sourceHash,
                aiHash: String(entry.aiHash || sourceMeta.aiHash || sourceHash || '').trim(),
                responseHash: String(entry.responseHash || sourceMeta.responseHash || sourceHash || '').trim(),
                userTurnKey,
                turnKey,
                messageSignature,
                messageCount: Number(entry.messageCount || sourceMeta.messageCount || 0),
                liveOrder: Number(entry.liveOrder || sourceMeta.liveOrder || entry.messageCount || sourceMeta.messageCount || 0),
                chatId,
                channel,
                containsMetaSignals
            };
            const fallbackSignals = extractNarrativeSignals('', sourceResponse || summary, {
                turn: anchorTurn || turn,
                sourceMessageIds
            });
            const responseBrief = clipText(entry.responseBrief || entry.response || fallbackSignals.responseBrief || summary, 180);
            const continuityBrief = clipText(entry.continuityBrief || fallbackSignals.continuityBrief || responseBrief, 240);
            const lastDistinctEvent = clipText(entry.lastDistinctEvent || fallbackSignals.lastDistinctEvent || responseBrief, 180);
            const locationState = (entry.locationState && typeof entry.locationState === 'object')
                ? safeClone(entry.locationState)
                : fallbackSignals.locationState;
            const temporalState = (entry.temporalState && typeof entry.temporalState === 'object')
                ? safeClone(entry.temporalState)
                : fallbackSignals.temporalState;
            const activeThreads = mergeNarrativeThreads(fallbackSignals.activeThreads, entry.activeThreads, 8);
            const distinctEvents = pushNarrativeUniqueLimited(fallbackSignals.distinctEvents, entry.distinctEvents, 6, { maxChars: 180 });
            const stateChanges = pushNarrativeUniqueLimited(fallbackSignals.stateChanges, entry.stateChanges, 6, { maxChars: 160 });
            const threadUpdates = pushNarrativeUniqueLimited(fallbackSignals.threadUpdates, entry.threadUpdates, 8, { maxChars: 150 });
            const relationUpdates = pushNarrativeUniqueLimited(fallbackSignals.relationUpdates, entry.relationUpdates, 6, { maxChars: 140 });
            const nextBeatHints = pushNarrativeUniqueLimited(fallbackSignals.nextBeatHints, entry.nextBeatHints, 6, { maxChars: 140 });
            const unresolvedQuestions = pushNarrativeUniqueLimited(fallbackSignals.unresolvedQuestions, entry.unresolvedQuestions, 6, { maxChars: 140 });
            const relationPressure = pushNarrativeUniqueLimited(fallbackSignals.relationPressure, entry.relationPressure, 6, { maxChars: 140 });
            const memoryRefs = pushNarrativeUniqueLimited(fallbackSignals.memoryRefs, entry.memoryRefs, 8, { maxChars: 80 });
            const evidenceTurns = pushNarrativeUniqueLimited(fallbackSignals.evidenceTurns, entry.evidenceTurns, 8, { maxChars: 40 });
            const dedupeKeys = Array.from(new Set([
                ...(Array.isArray(fallbackSignals.dedupeKeys) ? fallbackSignals.dedupeKeys : []),
                ...(Array.isArray(entry.dedupeKeys) ? entry.dedupeKeys : []),
                normalizeNarrativeDedupeKey(responseBrief),
                normalizeNarrativeDedupeKey(continuityBrief)
            ].filter(Boolean))).slice(0, 10);
            return {
                turn,
                timestamp: Number(entry.timestamp || Date.now()),
                userAction: '',
                response: responseBrief,
                involvedEntities: Array.isArray(entry.involvedEntities)
                    ? entry.involvedEntities.map(e => typeof e === 'string' ? e : e?.name).filter(Boolean)
                    : [],
                summary: responseBrief,
                responseBrief,
                continuityBrief,
                lastDistinctEvent,
                distinctEvents,
                stateChanges,
                threadUpdates,
                relationUpdates,
                nextBeat: clipText(entry.nextBeat || fallbackSignals.nextBeat || nextBeatHints[0] || '', 140),
                activeThreads,
                unresolvedQuestions,
                nextBeatHints,
                relationPressure,
                locationState,
                temporalState,
                memoryRefs,
                evidenceTurns,
                dedupeKeys,
                sceneLocation: clipText(entry.sceneLocation || sourceMeta.sceneLocation || locationState?.current || '', 100),
                sceneDate: compactTimeFieldText(entry.sceneDate || sourceMeta.sceneDate || temporalState?.date || entry.currentDate || '', 80),
                sceneTime: compactTimeFieldText(entry.sceneTime || sourceMeta.sceneTime || temporalState?.time || entry.currentTime || '', 40),
                sceneTimeLabel: compactTimeFieldText(entry.sceneTimeLabel || sourceMeta.sceneTimeLabel || temporalState?.label || '', 160),
                sceneTurn: Math.max(0, Number(entry.sceneTurn || sourceMeta.sceneTurn || entry.turn || 0)),
                narrativeArc: (entry?.narrativeArc && typeof entry.narrativeArc === 'object') ? safeClone(entry.narrativeArc) : null,
                sourceMessageIds: v42Meta.sourceMessageIds,
                liveMessageIds: v42Meta.liveMessageIds,
                m_id: v42Meta.m_id,
                messageId: v42Meta.messageId,
                sourceHash: v42Meta.sourceHash,
                aiHash: v42Meta.aiHash,
                responseHash: v42Meta.responseHash,
                userTurnKey: v42Meta.userTurnKey,
                turnKey: v42Meta.turnKey,
                messageSignature: v42Meta.messageSignature,
                messageCount: v42Meta.messageCount,
                liveOrder: v42Meta.liveOrder,
                chatId: v42Meta.chatId,
                firstTurn: v42Meta.firstTurn,
                originalTurn: v42Meta.originalTurn,
                lockedTurn: v42Meta.lockedTurn,
                finalizedTurn: v42Meta.finalizedTurn,
                turnAnchorTurn: v42Meta.turnAnchorTurn,
                turnAnchor: v42Meta.turnAnchor,
                turnLocked: v42Meta.turnLocked,
                turnAnchorReason: v42Meta.turnAnchorReason,
                channel,
                containsMetaSignals,
                meta: v42Meta
            };
        };

        const getNarrativeTurnLogDedupeKey = (entry = {}) => {
            const channel = String(entry?.channel || entry?.track || entry?.meta?.channel || 'scene').trim().toLowerCase() === 'meta' ? 'meta' : 'scene';
            const turn = Number(entry?.turnAnchorTurn || entry?.turnAnchor || entry?.finalizedTurn || entry?.lockedTurn || entry?.turn || entry?.meta?.turnAnchorTurn || entry?.meta?.turn || 0);
            if (Number.isFinite(turn) && turn > 0) return `${channel}:turn:${turn}`;
            const turnKey = String(entry?.turnKey || entry?.meta?.turnKey || '').trim();
            if (turnKey) return `${channel}:key:${turnKey}`;
            const sourceHash = String(entry?.sourceHash || entry?.aiHash || entry?.responseHash || entry?.meta?.sourceHash || entry?.meta?.aiHash || entry?.meta?.responseHash || '').trim();
            if (sourceHash) return `${channel}:hash:${sourceHash}`;
            const ids = normalizeCanonicalMessageIds(entry?.sourceMessageIds || entry?.liveMessageIds || entry?.messageId || entry?.m_id || entry?.meta?.sourceMessageIds || entry?.meta?.liveMessageIds || entry?.meta?.messageId || entry?.meta?.m_id);
            if (ids.length) return `${channel}:ids:${ids.join('|')}`;
            return `${channel}:summary:${normalizeNarrativeDedupeKey(entry?.summary || entry?.response || entry?.continuityBrief || '')}`;
        };

        const mergeNarrativeTurnLogEntries = (existing = {}, incoming = {}) => {
            const merged = {
                ...existing,
                ...incoming,
                timestamp: Math.max(Number(existing?.timestamp || 0), Number(incoming?.timestamp || 0), Date.now()),
                meta: {
                    ...(existing?.meta && typeof existing.meta === 'object' ? existing.meta : {}),
                    ...(incoming?.meta && typeof incoming.meta === 'object' ? incoming.meta : {})
                }
            };
            merged.involvedEntities = pushNarrativeUniqueLimited(existing.involvedEntities, incoming.involvedEntities, 16, { maxChars: 80 });
            merged.distinctEvents = pushNarrativeUniqueLimited(existing.distinctEvents, incoming.distinctEvents, 8, { maxChars: 180 });
            merged.stateChanges = pushNarrativeUniqueLimited(existing.stateChanges, incoming.stateChanges, 8, { maxChars: 160 });
            merged.threadUpdates = pushNarrativeUniqueLimited(existing.threadUpdates, incoming.threadUpdates, 10, { maxChars: 150 });
            merged.relationUpdates = pushNarrativeUniqueLimited(existing.relationUpdates, incoming.relationUpdates, 8, { maxChars: 140 });
            merged.nextBeatHints = pushNarrativeUniqueLimited(existing.nextBeatHints, incoming.nextBeatHints, 8, { maxChars: 140 });
            merged.unresolvedQuestions = pushNarrativeUniqueLimited(existing.unresolvedQuestions, incoming.unresolvedQuestions, 8, { maxChars: 140 });
            merged.relationPressure = pushNarrativeUniqueLimited(existing.relationPressure, incoming.relationPressure, 8, { maxChars: 140 });
            merged.memoryRefs = pushNarrativeUniqueLimited(existing.memoryRefs, incoming.memoryRefs, 12, { maxChars: 80 });
            merged.evidenceTurns = pushNarrativeUniqueLimited(existing.evidenceTurns, incoming.evidenceTurns, 12, { maxChars: 40 });
            merged.dedupeKeys = pushNarrativeUniqueLimited(existing.dedupeKeys, incoming.dedupeKeys, 12, { maxChars: 160 });
            merged.activeThreads = mergeNarrativeThreads(existing.activeThreads, incoming.activeThreads, 8);
            if (!merged.locationState && (existing.locationState || incoming.locationState)) merged.locationState = safeClone(incoming.locationState || existing.locationState);
            if (!merged.temporalState && (existing.temporalState || incoming.temporalState)) merged.temporalState = safeClone(incoming.temporalState || existing.temporalState);
            return merged;
        };

        const dedupeNarrativeTurnLog = (entries = [], limit = NARRATIVE_TURN_LOG_LIMIT) => {
            const map = new Map();
            const order = [];
            for (const rawEntry of Array.isArray(entries) ? entries : []) {
                if (!rawEntry) continue;
                const entry = rawEntry.turnKey || rawEntry.turnAnchorTurn || rawEntry.summary || rawEntry.response
                    ? rawEntry
                    : normalizeTurnEntry(rawEntry);
                const key = getNarrativeTurnLogDedupeKey(entry);
                if (!key) continue;
                if (map.has(key)) {
                    map.set(key, mergeNarrativeTurnLogEntries(map.get(key), entry));
                } else {
                    map.set(key, entry);
                    order.push(key);
                }
            }
            const merged = order.map(key => map.get(key)).filter(Boolean)
                .sort((a, b) => Number(a?.turn || 0) - Number(b?.turn || 0) || Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
            const cap = Math.max(1, Number(limit || NARRATIVE_TURN_LOG_LIMIT));
            return merged.length > cap ? merged.slice(-cap) : merged;
        };

        const mergeNarrativeStorylines = (storylines = []) => {
            const shouldMerge = (left, right) => {
                const leftArc = String(left?.arcKey || '').trim();
                const rightArc = String(right?.arcKey || '').trim();
                if (!narrativeArcKeysCompatible(leftArc, rightArc)) return false;
                if (leftArc && rightArc && leftArc === rightArc && isConcreteNarrativeArcKey(leftArc)) return true;
                const threadScore = narrativeThreadOverlapScore(left?.activeThreads, right?.activeThreads);
                if (threadScore >= 0.5) return true;
                const entityScore = narrativeEntitiesOverlapScore(left?.entities, right?.entities);
                const hasConcreteArc = isConcreteNarrativeArcKey(leftArc) || isConcreteNarrativeArcKey(rightArc);
                if (hasConcreteArc) {
                    return entityScore >= 0.85
                        && (isGenericNarrativeStorylineName(left?.name) || isGenericNarrativeStorylineName(right?.name));
                }
                if (entityScore >= 0.65) return true;
                if (entityScore >= 0.4 && (isGenericNarrativeStorylineName(left?.name) || isGenericNarrativeStorylineName(right?.name))) return true;
                return false;
            };
            const mergeInto = (target, source) => {
                if (!target || !source) return target;
                if (isGenericNarrativeStorylineName(target.name) && !isGenericNarrativeStorylineName(source.name)) target.name = source.name;
                if ((!target.arcKey || isGenericNarrativeArcKey(target.arcKey)) && source.arcKey && isConcreteNarrativeArcKey(source.arcKey)) target.arcKey = source.arcKey;
                if (!target.phase && source.phase) target.phase = source.phase;
                if (!target.primaryConflict && source.primaryConflict) target.primaryConflict = source.primaryConflict;
                for (const entity of Array.isArray(source.entities) ? source.entities : []) {
                    target.entities = pushNarrativeEntity(target.entities, entity);
                }
                target.turns = Array.from(new Set([...(target.turns || []), ...(source.turns || [])].map(Number).filter(Number.isFinite))).sort((a, b) => a - b);
                target.firstTurn = target.turns[0] || target.firstTurn || source.firstTurn || 0;
                target.lastTurn = target.turns[target.turns.length - 1] || target.lastTurn || source.lastTurn || 0;
                target.lastSceneDate = source.lastSceneDate || target.lastSceneDate || '';
                target.lastSceneTime = source.lastSceneTime || target.lastSceneTime || '';
                target.lastSceneTimeLabel = source.lastSceneTimeLabel || target.lastSceneTimeLabel || '';
                target.sceneLocation = source.sceneLocation || target.sceneLocation || '';
                target.currentContext = source.currentContext || target.currentContext || '';
                target.continuityBrief = source.continuityBrief || target.continuityBrief || target.currentContext || '';
                target.lastDistinctEvent = source.lastDistinctEvent || target.lastDistinctEvent || '';
                const mergedEvents = [];
                for (const event of [...(target.recentEvents || []), ...(source.recentEvents || [])]
                    .sort((a, b) => Number(a?.turn || 0) - Number(b?.turn || 0))) {
                    const normalizedEvent = {
                        turn: Number(event?.turn || 0),
                        brief: clipText(event?.brief || '', 220),
                        arcKey: String(event?.arcKey || target.arcKey || '').trim()
                    };
                    if (!normalizedEvent.turn || !normalizedEvent.brief) continue;
                    const existing = mergedEvents.find(item => Number(item.turn || 0) === normalizedEvent.turn || narrativeTextSimilar(item.brief, normalizedEvent.brief));
                    if (existing) {
                        existing.turn = Math.max(Number(existing.turn || 0), normalizedEvent.turn);
                        if (!existing.arcKey && normalizedEvent.arcKey) existing.arcKey = normalizedEvent.arcKey;
                    } else {
                        mergedEvents.push(normalizedEvent);
                    }
                }
                target.recentEvents = dedupeNarrativeRecentEvents(mergedEvents, 10);
                target.summaries = [...(target.summaries || []), ...(source.summaries || [])]
                    .sort((a, b) => Number(a?.upToTurn || 0) - Number(b?.upToTurn || 0))
                    .slice(-12);
                target.keyPoints = pushNarrativeUniqueLimited(target.keyPoints, source.keyPoints, 12, { maxChars: 160 });
                target.ongoingTensions = pushNarrativeUniqueLimited(target.ongoingTensions, source.ongoingTensions, 10, { maxChars: 160 });
                target.activeThreads = mergeNarrativeThreads(target.activeThreads, source.activeThreads, 8);
                target.unresolvedQuestions = pushNarrativeUniqueLimited(target.unresolvedQuestions, source.unresolvedQuestions, 8, { maxChars: 140 });
                target.nextBeatHints = pushNarrativeUniqueLimited(target.nextBeatHints, source.nextBeatHints, 8, { maxChars: 140 });
                target.relationPressure = pushNarrativeUniqueLimited(target.relationPressure, source.relationPressure, 8, { maxChars: 140 });
                target.memoryRefs = pushNarrativeUniqueLimited(target.memoryRefs, source.memoryRefs, 12, { maxChars: 80 });
                target.evidenceTurns = pushNarrativeUniqueLimited(target.evidenceTurns, source.evidenceTurns, 12, { maxChars: 40 });
                target.dedupeKeys = pushNarrativeUniqueLimited(target.dedupeKeys, source.dedupeKeys, 12, { maxChars: 160 });
                if (!target.locationState && source.locationState) target.locationState = safeClone(source.locationState);
                if (!target.temporalState && source.temporalState) target.temporalState = safeClone(source.temporalState);
                return target;
            };

            const merged = [];
            for (const storyline of Array.isArray(storylines) ? storylines : []) {
                if (!storyline) continue;
                const existing = merged.find(item => shouldMerge(item, storyline));
                if (existing) mergeInto(existing, storyline);
                else merged.push(storyline);
            }
            return merged.map((storyline, index) => ({
                ...storyline,
                id: Number(storyline.id || index + 1)
            }));
        };

        const normalizeState = (state = null) => {
            const nextState = state && typeof state === 'object' ? safeClone(state) : { storylines: [], turnLog: [], metaTurnLog: [], lastSummaryTurn: 0 };
            nextState.turnLog = dedupeNarrativeTurnLog(
                Array.isArray(nextState.turnLog) ? nextState.turnLog.map(normalizeTurnEntry).filter(entry => entry.turn >= 0) : [],
                NARRATIVE_TURN_LOG_LIMIT
            );
            nextState.metaTurnLog = dedupeNarrativeTurnLog(
                Array.isArray(nextState.metaTurnLog) ? nextState.metaTurnLog.map(normalizeTurnEntry).filter(entry => entry.turn >= 0) : [],
                NARRATIVE_META_TURN_LOG_LIMIT
            );
            const turnMap = new Map(nextState.turnLog.map(entry => [entry.turn, entry]));
            nextState.storylines = Array.isArray(nextState.storylines) ? nextState.storylines.map((storyline, idx) => {
                const turns = Array.isArray(storyline?.turns) ? storyline.turns.map(turn => Number(turn)).filter(Number.isFinite) : [];
                const recentEvents = Array.isArray(storyline?.recentEvents) ? storyline.recentEvents.map((event) => {
                    const turn = Number(event?.turn ?? event);
                    const matched = turnMap.get(turn);
                    return {
                        turn: Number.isFinite(turn) ? turn : '?',
                        brief: clipText(matched?.lastDistinctEvent || matched?.continuityBrief || matched?.summary || event?.brief || '', 180),
                        arcKey: String(event?.arcKey || matched?.narrativeArc?.arcKey || '').trim()
                    };
                }).filter(event => String(event.brief || '').trim()) : [];
                return {
                    id: Number(storyline?.id || idx + 1),
                    name: String(storyline?.name || `Storyline #${idx + 1}`),
                    arcKey: String(storyline?.arcKey || makeNarrativeArcKey(storyline?.name || '') || '').trim(),
                    phase: clipText(storyline?.phase || '', 80),
                    primaryConflict: clipText(storyline?.primaryConflict || '', 220),
                    entities: Array.isArray(storyline?.entities) ? storyline.entities.map(String).filter(Boolean) : [],
                    turns,
                    firstTurn: Number(storyline?.firstTurn || turns[0] || 0),
                    lastTurn: Number(storyline?.lastTurn || turns[turns.length - 1] || 0),
                    lastSceneDate: compactTimeFieldText(storyline?.lastSceneDate || '', 80),
                    lastSceneTime: compactTimeFieldText(storyline?.lastSceneTime || '', 40),
                    lastSceneTimeLabel: compactTimeFieldText(storyline?.lastSceneTimeLabel || '', 160),
                    sceneLocation: clipText(storyline?.sceneLocation || storyline?.locationState?.current || '', 100),
                    locationState: (storyline?.locationState && typeof storyline.locationState === 'object') ? safeClone(storyline.locationState) : null,
                    temporalState: (storyline?.temporalState && typeof storyline.temporalState === 'object') ? safeClone(storyline.temporalState) : null,
                    recentEvents: dedupeNarrativeRecentEvents(recentEvents, 10),
                    summaries: Array.isArray(storyline?.summaries) ? storyline.summaries.map(entry => ({
                        upToTurn: Number(entry?.upToTurn || 0),
                        summary: clipText(entry?.summary || '', 240),
                        keyPoints: normalizeNarrativeStringArray(entry?.keyPoints, 8, 160),
                        ongoingTensions: normalizeNarrativeStringArray(entry?.ongoingTensions, 8, 160),
                        timestamp: Number(entry?.timestamp || Date.now()),
                        live: entry?.live === true,
                        sceneDate: compactTimeFieldText(entry?.sceneDate || '', 80),
                        sceneTime: compactTimeFieldText(entry?.sceneTime || '', 40),
                        sceneTimeLabel: compactTimeFieldText(entry?.sceneTimeLabel || '', 160),
                        sceneLocation: clipText(entry?.sceneLocation || '', 100),
                        arcKey: String(entry?.arcKey || '').trim(),
                        continuityBrief: clipText(entry?.continuityBrief || entry?.summary || '', 240),
                        lastDistinctEvent: clipText(entry?.lastDistinctEvent || '', 220),
                        activeThreads: mergeNarrativeThreads([], entry?.activeThreads, 6),
                        nextBeatHints: normalizeNarrativeStringArray(entry?.nextBeatHints, 4, 140),
                        evidenceTurns: normalizeNarrativeStringArray(entry?.evidenceTurns, 8, 40)
                    })) : [],
                    currentContext: clipText(storyline?.currentContext || '', 260),
                    continuityBrief: clipText(storyline?.continuityBrief || storyline?.currentContext || '', 260),
                    lastDistinctEvent: clipText(storyline?.lastDistinctEvent || recentEvents[recentEvents.length - 1]?.brief || '', 220),
                    keyPoints: normalizeNarrativeStringArray(storyline?.keyPoints, 12, 160),
                    ongoingTensions: normalizeNarrativeStringArray(storyline?.ongoingTensions, 10, 160),
                    activeThreads: mergeNarrativeThreads([], storyline?.activeThreads, 8),
                    unresolvedQuestions: normalizeNarrativeStringArray(storyline?.unresolvedQuestions, 8, 140),
                    nextBeatHints: normalizeNarrativeStringArray(storyline?.nextBeatHints, 8, 140),
                    relationPressure: normalizeNarrativeStringArray(storyline?.relationPressure, 8, 140),
                    memoryRefs: normalizeNarrativeStringArray(storyline?.memoryRefs, 12, 80),
                    evidenceTurns: normalizeNarrativeStringArray(storyline?.evidenceTurns, 12, 40),
                    dedupeKeys: normalizeNarrativeStringArray(storyline?.dedupeKeys, 12, 160),
                    meta: {
                        manualLocked: storyline?.meta?.manualLocked === true,
                        manualLockedAt: Number(storyline?.meta?.manualLockedAt || 0)
                    }
                };
            }) : [];
            splitMixedArcStorylines(nextState);
            nextState.storylines = mergeNarrativeStorylines(nextState.storylines);
            nextState.lastSummaryTurn = Number(nextState.lastSummaryTurn || 0);
            return nextState;
        };

        const buildPromptState = () => {
            const promptState = safeClone(narrativeState || {});
            pruneNarrativeStateDeletedRefs(promptState);
            splitMixedArcStorylines(promptState);
            promptState.storylines = mergeNarrativeStorylines(promptState.storylines);
            return promptState;
        };

        const recoverNarrativeFromSnapshotIfEmpty = (lorebook = [], currentState = {}) => {
            const hasCurrentStorylines = Array.isArray(currentState?.storylines) && currentState.storylines.length > 0;
            if (hasCurrentStorylines) return currentState;
            const meta = currentState?.meta && typeof currentState.meta === 'object' ? currentState.meta : {};
            const hasRollbackQuarantine = meta.rollbackDirty === true
                || meta.needsReanalysis === true
                || Array.isArray(currentState?.rollbackDeletedTurns);
            if (!hasRollbackQuarantine) return currentState;
            const snapshotEntry = (Array.isArray(lorebook) ? lorebook : [])
                .find(entry => String(entry?.comment || '') === 'lmai_rollback_snapshot');
            if (!snapshotEntry) return currentState;
            try {
                const snapshot = JSON.parse(String(snapshotEntry.content || '{}'));
                const aggregateEntries = Array.isArray(snapshot?.aggregateManagedEntries)
                    ? snapshot.aggregateManagedEntries
                    : (Array.isArray(snapshot?.managedLoreEntries) ? snapshot.managedLoreEntries : []);
                const narrativeEntry = aggregateEntries.find(entry => String(entry?.comment || '') === NARRATIVE_COMMENT);
                if (!narrativeEntry) return currentState;
                const snapshotState = normalizeState(JSON.parse(String(narrativeEntry.content || '{}')));
                if (!Array.isArray(snapshotState.storylines) || snapshotState.storylines.length === 0) return currentState;
                const merged = safeClone(snapshotState);
                const seenTurnKeys = new Set((Array.isArray(merged.turnLog) ? merged.turnLog : [])
                    .map(entry => String(entry?.turnKey || entry?.sourceHash || entry?.turn || '').trim())
                    .filter(Boolean));
                for (const entry of Array.isArray(currentState.turnLog) ? currentState.turnLog : []) {
                    const key = String(entry?.turnKey || entry?.sourceHash || entry?.turn || '').trim();
                    if (key && seenTurnKeys.has(key)) continue;
                    if (key) seenTurnKeys.add(key);
                    merged.turnLog = Array.isArray(merged.turnLog) ? merged.turnLog : [];
                    merged.turnLog.push(entry);
                }
                merged.metaTurnLog = [
                    ...(Array.isArray(merged.metaTurnLog) ? merged.metaTurnLog : []),
                    ...(Array.isArray(currentState.metaTurnLog) ? currentState.metaTurnLog : [])
                ];
                merged.rollbackDeletedTurns = Array.isArray(currentState.rollbackDeletedTurns)
                    ? safeClone(currentState.rollbackDeletedTurns)
                    : merged.rollbackDeletedTurns;
                merged.meta = {
                    ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}),
                    ...meta,
                    rollbackSnapshotRecovered: true,
                    rollbackSnapshotRecoveredAt: Date.now(),
                    rollbackSnapshotId: String(snapshot?.snapshotId || '').trim()
                };
                const recovered = normalizeState(merged);
                recordRuntimeDebug('warn', '[LIBRA] Narrative rollback quarantine restored baseline from snapshot:', {
                    snapshotId: snapshot?.snapshotId || '',
                    recoveredStorylines: recovered.storylines.length,
                    recoveredTurns: recovered.turnLog.length
                });
                return recovered;
            } catch (error) {
                recordSuppressedRuntimeError('narrative.rollback_snapshot_recover', error, {
                    stage: 'narrative-load',
                    comment: NARRATIVE_COMMENT
                });
                return currentState;
            }
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === NARRATIVE_COMMENT);
            if (entry) {
                try {
                    narrativeState = recoverNarrativeFromSnapshotIfEmpty(lorebook, normalizeState(JSON.parse(entry.content)));
                } catch (e) { recordRuntimeDebug('warn', '[LIBRA] Narrative state parse failed:', e?.message); }
            }
            return narrativeState;
        };

        const saveState = async (lorebook) => {
            narrativeState = normalizeState(narrativeState);
            const entry = {
                key: LibraLoreKeys.narrative(),
                comment: NARRATIVE_COMMENT,
                content: JSON.stringify(narrativeState),
                mode: 'normal',
                insertorder: 5,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === NARRATIVE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordTurn = async (turn, userMsg, aiResponse, entities = [], config = MemoryEngine.CONFIG, options = {}) => {
            const normalizedEntities = Array.from(new Set(
                (Array.isArray(entities) ? entities : [])
                    .map(e => typeof e === 'string' ? e : e?.name)
                    .map(name => String(name || '').trim())
                    .filter(Boolean)
            ));
            const anchorSource = (options?.anchorMeta && typeof options.anchorMeta === 'object') ? options.anchorMeta : (options || {});
            const channel = String(options?.channel || options?.track || anchorSource.channel || 'scene').trim().toLowerCase() === 'meta'
                ? 'meta'
                : 'scene';
            const containsMetaSignals = options?.containsMetaSignals === true || anchorSource.containsMetaSignals === true;
            const anchorTurn = normalizeLegacyMemoryTurnAnchor(
                anchorSource.turnAnchorTurn
                || anchorSource.turnAnchor
                || anchorSource.lockedTurn
                || anchorSource.finalizedTurn
                || anchorSource.turn
                || turn
            ) || Number(turn || 0);
            const sourceMessageIds = normalizeCanonicalMessageIds(
                anchorSource.sourceMessageIds
                || anchorSource.liveMessageIds
                || anchorSource.messageId
                || anchorSource.m_id
            );
            const sourceHash = String(anchorSource.sourceHash || anchorSource.aiHash || anchorSource.responseHash || '').trim();
            const aiHash = String(anchorSource.aiHash || sourceHash || '').trim();
            const responseHash = String(anchorSource.responseHash || sourceHash || '').trim();
            const messageSignature = String(anchorSource.messageSignature || '').trim();
            const userTurnKey = String(anchorSource.userTurnKey || '').trim();
            const chatId = String(anchorSource.chatId || '').trim();
            const turnKey = String(
                anchorSource.turnKey
                || buildCanonicalTurnKey(chatId, userTurnKey, sourceHash, messageSignature, sourceMessageIds)
            ).trim();
            const narrativeSignals = extractNarrativeSignals('', aiResponse, {
                turn: anchorTurn || turn,
                sourceMessageIds
            });
            let responseBrief = clipText(narrativeSignals.responseBrief || '', 180);
            if (!responseBrief) responseBrief = await generateTurnBrief('', aiResponse, config);
            const v42Meta = {
                ...Object.fromEntries(Object.entries(anchorSource || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')),
                t: anchorTurn,
                turn: anchorTurn,
                firstTurn: normalizeLegacyMemoryTurnAnchor(anchorSource.firstTurn || anchorTurn) || anchorTurn,
                originalTurn: normalizeLegacyMemoryTurnAnchor(anchorSource.originalTurn || anchorTurn) || anchorTurn,
                lockedTurn: normalizeLegacyMemoryTurnAnchor(anchorSource.lockedTurn || anchorTurn) || anchorTurn,
                finalizedTurn: normalizeLegacyMemoryTurnAnchor(anchorSource.finalizedTurn || anchorTurn) || anchorTurn,
                turnAnchorTurn: anchorTurn,
                turnAnchor: anchorTurn,
                turnLocked: true,
                turnAnchorReason: String(anchorSource.turnAnchorReason || 'v4.2-narrative-turn').trim() || 'v4.2-narrative-turn',
                sourceMessageIds,
                liveMessageIds: normalizeCanonicalMessageIds(anchorSource.liveMessageIds || sourceMessageIds),
                m_id: String(anchorSource.m_id || anchorSource.messageId || getPrimaryCanonicalMessageId(sourceMessageIds, true) || '').trim(),
                messageId: String(anchorSource.messageId || anchorSource.m_id || getPrimaryCanonicalMessageId(sourceMessageIds, true) || '').trim(),
                sourceHash,
                aiHash,
                responseHash,
                userTurnKey,
                turnKey,
                messageSignature,
                messageCount: Number(anchorSource.messageCount || 0),
                liveOrder: Number(anchorSource.liveOrder || anchorSource.messageCount || 0),
                chatId,
                recordedAt: Date.now(),
                channel,
                containsMetaSignals
            };
            const beforeTimeState = TimeEngine.getState?.() || {};
            const sceneDateCandidate = compactTimeFieldText(anchorSource.sceneDate || narrativeSignals.temporalState?.date || '', 80);
            const sceneTimeCandidate = compactTimeFieldText(anchorSource.sceneTime || narrativeSignals.temporalState?.time || '', 40);
            const sceneTimeLabel = compactTimeFieldText(
                anchorSource.sceneTimeLabel
                || anchorSource.currentLabel
                || narrativeSignals.temporalState?.label
                || [sceneDateCandidate, sceneTimeCandidate].filter(Boolean).join(' '),
                160
            );
            if (channel === 'scene') {
                try {
                    TimeEngine.ingestLiveTurn(
                        normalizedEntities,
                        sceneDateCandidate || anchorSource.currentDate || '',
                        `Turn ${Number(anchorTurn || turn || 0)} narrative progression`,
                        {
                            sceneDate: sceneDateCandidate,
                            sceneTime: sceneTimeCandidate,
                            sceneTimeLabel
                        }
                    );
                } catch (e) {
                    if (config?.debug) console.warn('[LIBRA] TimeEngine narrative ingest skipped:', e?.message || e);
                }
            }
            const timeState = TimeEngine.getState?.() || beforeTimeState || {};
            const sceneDate = compactTimeFieldText(sceneDateCandidate || timeState.currentDate || timeState.lastSceneDate || '', 80);
            const sceneTime = compactTimeFieldText(sceneTimeCandidate || timeState.currentTime || timeState.lastSceneTime || '', 40);
            const sceneTurn = Math.max(0, Number(timeState.sceneTurn || anchorTurn || turn || 0));
            const sceneLocation = clipText(anchorSource.sceneLocation || narrativeSignals.locationState?.current || '', 100);
            v42Meta.sceneDate = sceneDate;
            v42Meta.sceneTime = sceneTime;
            v42Meta.sceneTimeLabel = sceneTimeLabel || timeState.currentLabel || timeState.lastSceneLabel || '';
            v42Meta.sceneTurn = sceneTurn;
            v42Meta.sceneLocation = sceneLocation;
            const narrativeArcPatch = buildNarrativeArcPatch({
                    userAction: '',
                response: responseBrief,
                summary: responseBrief,
                continuityBrief: narrativeSignals.continuityBrief,
                lastDistinctEvent: narrativeSignals.lastDistinctEvent,
                distinctEvents: narrativeSignals.distinctEvents,
                stateChanges: narrativeSignals.stateChanges,
                activeThreads: narrativeSignals.activeThreads,
                unresolvedQuestions: narrativeSignals.unresolvedQuestions,
                relationPressure: narrativeSignals.relationPressure,
                nextBeatHints: narrativeSignals.nextBeatHints
            }, anchorSource?.narrative || {});
            const turnEntry = {
                turn: anchorTurn || turn,
                timestamp: Date.now(),
                userAction: '',
                response: responseBrief,
                involvedEntities: normalizedEntities,
                summary: responseBrief,
                responseBrief,
                continuityBrief: narrativeSignals.continuityBrief || responseBrief,
                lastDistinctEvent: narrativeSignals.lastDistinctEvent || responseBrief,
                distinctEvents: narrativeSignals.distinctEvents || [],
                stateChanges: narrativeSignals.stateChanges || [],
                threadUpdates: narrativeSignals.threadUpdates || [],
                relationUpdates: narrativeSignals.relationUpdates || [],
                nextBeat: narrativeSignals.nextBeat || '',
                activeThreads: narrativeSignals.activeThreads || [],
                unresolvedQuestions: narrativeSignals.unresolvedQuestions || [],
                nextBeatHints: narrativeSignals.nextBeatHints || [],
                relationPressure: narrativeSignals.relationPressure || [],
                locationState: narrativeSignals.locationState || { current: '', source: '' },
                temporalState: narrativeSignals.temporalState || { label: '', date: '', time: '' },
                memoryRefs: narrativeSignals.memoryRefs || [],
                evidenceTurns: narrativeSignals.evidenceTurns || [],
                dedupeKeys: narrativeSignals.dedupeKeys || [],
                sceneLocation,
                sceneDate,
                sceneTime,
                sceneTimeLabel: v42Meta.sceneTimeLabel,
                sceneTurn,
                narrativeArc: narrativeArcPatch,
                sourceMessageIds: v42Meta.sourceMessageIds,
                liveMessageIds: v42Meta.liveMessageIds,
                m_id: v42Meta.m_id,
                messageId: v42Meta.messageId,
                sourceHash: v42Meta.sourceHash,
                aiHash: v42Meta.aiHash,
                responseHash: v42Meta.responseHash,
                userTurnKey: v42Meta.userTurnKey,
                turnKey: v42Meta.turnKey,
                messageSignature: v42Meta.messageSignature,
                messageCount: v42Meta.messageCount,
                liveOrder: v42Meta.liveOrder,
                chatId: v42Meta.chatId,
                firstTurn: v42Meta.firstTurn,
                originalTurn: v42Meta.originalTurn,
                lockedTurn: v42Meta.lockedTurn,
                finalizedTurn: v42Meta.finalizedTurn,
                turnAnchorTurn: v42Meta.turnAnchorTurn,
                turnAnchor: v42Meta.turnAnchor,
                turnLocked: true,
                turnAnchorReason: v42Meta.turnAnchorReason,
                channel,
                containsMetaSignals,
                meta: v42Meta
            };
            if (channel === 'meta') {
                narrativeState.metaTurnLog = dedupeNarrativeTurnLog([
                    ...(Array.isArray(narrativeState.metaTurnLog) ? narrativeState.metaTurnLog : []),
                    turnEntry
                ], NARRATIVE_META_TURN_LOG_LIMIT);
                return narrativeState.metaTurnLog.find(entry => getNarrativeTurnLogDedupeKey(entry) === getNarrativeTurnLogDedupeKey(turnEntry)) || turnEntry;
            }

            narrativeState.turnLog = dedupeNarrativeTurnLog([
                ...(Array.isArray(narrativeState.turnLog) ? narrativeState.turnLog : []),
                turnEntry
            ], NARRATIVE_TURN_LOG_LIMIT);

            const storedTurnEntry = narrativeState.turnLog.find(entry => getNarrativeTurnLogDedupeKey(entry) === getNarrativeTurnLogDedupeKey(turnEntry)) || turnEntry;
            assignToStoryline(storedTurnEntry);
            return storedTurnEntry;
        };
        const correctTurn = (turn, updates = {}) => {
            const targetTurn = Number(turn || 0);
            if (!targetTurn) return false;
            const turnEntry = narrativeState.turnLog.find(entry => Number(entry?.turn || 0) === targetTurn);
            if (!turnEntry) return false;

            const nextSummary = String(updates.summary || updates.narrativeBrief || '').trim();
            const nextEntities = Array.isArray(updates.entities)
                ? updates.entities.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean)
                : [];

            if (nextSummary) {
                const clipped = clipText(nextSummary, 220);
                const correctionSignals = extractNarrativeSignals('', clipped, {
                    turn: targetTurn,
                    sourceMessageIds: turnEntry.sourceMessageIds
                });
                turnEntry.response = clipped;
                turnEntry.summary = clipped;
                turnEntry.responseBrief = correctionSignals.responseBrief || clipped;
                turnEntry.continuityBrief = correctionSignals.continuityBrief || clipped;
                turnEntry.lastDistinctEvent = correctionSignals.lastDistinctEvent || clipped;
                turnEntry.distinctEvents = correctionSignals.distinctEvents || [];
                turnEntry.stateChanges = correctionSignals.stateChanges || [];
                turnEntry.threadUpdates = correctionSignals.threadUpdates || [];
                turnEntry.relationUpdates = correctionSignals.relationUpdates || [];
                turnEntry.nextBeat = correctionSignals.nextBeat || '';
                turnEntry.activeThreads = mergeNarrativeThreads(turnEntry.activeThreads, correctionSignals.activeThreads, 8);
                turnEntry.unresolvedQuestions = pushNarrativeUniqueLimited(turnEntry.unresolvedQuestions, correctionSignals.unresolvedQuestions, 6, { maxChars: 140 });
                turnEntry.nextBeatHints = pushNarrativeUniqueLimited(turnEntry.nextBeatHints, correctionSignals.nextBeatHints, 6, { maxChars: 140 });
                turnEntry.relationPressure = pushNarrativeUniqueLimited(turnEntry.relationPressure, correctionSignals.relationPressure, 6, { maxChars: 140 });
                turnEntry.locationState = correctionSignals.locationState || turnEntry.locationState;
                turnEntry.temporalState = correctionSignals.temporalState || turnEntry.temporalState;
                turnEntry.memoryRefs = pushNarrativeUniqueLimited(turnEntry.memoryRefs, correctionSignals.memoryRefs, 8, { maxChars: 80 });
                turnEntry.evidenceTurns = pushNarrativeUniqueLimited(turnEntry.evidenceTurns, correctionSignals.evidenceTurns, 8, { maxChars: 40 });
                turnEntry.dedupeKeys = Array.from(new Set([...(turnEntry.dedupeKeys || []), ...(correctionSignals.dedupeKeys || [])].filter(Boolean))).slice(0, 10);
            }
            if (nextEntities.length > 0) {
                turnEntry.involvedEntities = Array.from(new Set(nextEntities));
            }
            const nextSceneDate = compactTimeFieldText(updates.sceneDate || updates.currentDate || '', 80);
            const nextSceneTime = compactTimeFieldText(updates.sceneTime || updates.currentTime || '', 40);
            const nextSceneTimeLabel = compactTimeFieldText(updates.sceneTimeLabel || updates.timeLabel || '', 160);
            if (nextSceneDate) turnEntry.sceneDate = nextSceneDate;
            if (nextSceneTime) turnEntry.sceneTime = nextSceneTime;
            if (nextSceneTimeLabel) turnEntry.sceneTimeLabel = nextSceneTimeLabel;
            if (nextSceneTimeLabel || nextSceneDate || nextSceneTime) {
                turnEntry.temporalState = {
                    ...(turnEntry.temporalState && typeof turnEntry.temporalState === 'object' ? turnEntry.temporalState : {}),
                    label: nextSceneTimeLabel || turnEntry.temporalState?.label || '',
                    date: nextSceneDate || turnEntry.temporalState?.date || '',
                    time: nextSceneTime || turnEntry.temporalState?.time || ''
                };
            }
            const arcPatch = buildNarrativeArcPatch(turnEntry, updates || {});
            if (arcPatch.arcKey || arcPatch.name || arcPatch.keyPoints.length || arcPatch.ongoingTensions.length) {
                turnEntry.narrativeArc = arcPatch;
            }

            removeTurnFromStorylines(targetTurn);
            assignToStoryline(turnEntry, { forceArc: !!arcPatch.arcKey });
            return true;
        };

        const assignToStoryline = (turnEntry, options = {}) => {
            const entities = Array.from(new Set((Array.isArray(turnEntry.involvedEntities) ? turnEntry.involvedEntities : []).map(String).filter(Boolean)));
            const arcPatch = turnEntry.narrativeArc && typeof turnEntry.narrativeArc === 'object'
                ? turnEntry.narrativeArc
                : buildNarrativeArcPatch(turnEntry, {});
            if (arcPatch?.arcKey || arcPatch?.name) turnEntry.narrativeArc = arcPatch;
            const arcKey = String(arcPatch?.arcKey || '').trim();
            const activeThreads = mergeNarrativeThreads([], turnEntry.activeThreads, 8);
            const recentBrief = clipText(turnEntry.lastDistinctEvent || turnEntry.continuityBrief || turnEntry.summary || turnEntry.response || '', 220);

            let bestMatch = null;
            let bestScore = 0;

            if (arcKey) {
                bestMatch = narrativeState.storylines.find(storyline => String(storyline?.arcKey || '').trim() === arcKey && isConcreteNarrativeArcKey(arcKey)) || null;
            }

            if (!bestMatch) {
                for (const storyline of narrativeState.storylines) {
                    const storylineArc = String(storyline?.arcKey || '').trim();
                    if (isConcreteNarrativeArcKey(arcKey) && isConcreteNarrativeArcKey(storylineArc) && storylineArc !== arcKey) {
                        continue;
                    }
                    const entityScore = narrativeEntitiesOverlapScore(entities, storyline.entities);
                    const threadScore = narrativeThreadOverlapScore(activeThreads, storyline.activeThreads);
                    const arcScore = arcKey && storylineArc === arcKey ? 1 : 0;
                    const genericBoost = (isGenericNarrativeStorylineName(storyline?.name) || isGenericNarrativeArcKey(storylineArc)) && (entityScore > 0 || threadScore > 0) ? 0.15 : 0;
                    const score = Math.max(entityScore, threadScore, arcScore) + genericBoost;
                    const threshold = arcKey ? 0.35 : 0.45;
                    if (score > bestScore && score >= threshold) {
                        bestScore = score;
                        bestMatch = storyline;
                    }
                }
            }

            if (bestMatch) {
                bestMatch.turns = Array.isArray(bestMatch.turns) ? bestMatch.turns : [];
                if (!bestMatch.turns.includes(turnEntry.turn)) bestMatch.turns.push(turnEntry.turn);
                bestMatch.turns = Array.from(new Set(bestMatch.turns.map(Number).filter(Number.isFinite))).sort((a, b) => a - b);
                bestMatch.firstTurn = bestMatch.turns[0] || turnEntry.turn;
                bestMatch.lastTurn = bestMatch.turns[bestMatch.turns.length - 1] || turnEntry.turn;
                for (const e of entities) {
                    bestMatch.entities = pushNarrativeEntity(bestMatch.entities, e);
                }
                if (arcPatch?.name && (!bestMatch.name || isGenericNarrativeStorylineName(bestMatch.name))) bestMatch.name = arcPatch.name;
                if (arcKey && (!bestMatch.arcKey || isGenericNarrativeArcKey(bestMatch.arcKey))) bestMatch.arcKey = arcKey;
                if (arcPatch?.primaryConflict) bestMatch.primaryConflict = arcPatch.primaryConflict;
                if (arcPatch?.phase) bestMatch.phase = arcPatch.phase;
                bestMatch.recentEvents = Array.isArray(bestMatch.recentEvents) ? bestMatch.recentEvents.filter(item => Number(item?.turn || 0) !== Number(turnEntry.turn || 0)) : [];
                bestMatch.recentEvents.push({
                    turn: turnEntry.turn,
                    brief: recentBrief,
                    arcKey: bestMatch.arcKey || ''
                });
                if (bestMatch.recentEvents.length > 10) {
                    bestMatch.recentEvents = bestMatch.recentEvents.slice(-10);
                }
                applyLiveNarrativeSnapshot(bestMatch, turnEntry);
            } else if (entities.length > 0 || arcKey || activeThreads.length > 0 || (recentBrief && narrativeState.storylines.length === 0)) {
                const id = (narrativeState.storylines || []).reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1;
                const storyline = {
                    id,
                    name: arcPatch?.name || (recentBrief ? '현재 장면' : `Storyline #${id}`),
                    arcKey: arcKey || makeNarrativeArcKey(arcPatch?.name || recentBrief || `Storyline #${id}`),
                    phase: arcPatch?.phase || '',
                    primaryConflict: arcPatch?.primaryConflict || '',
                    entities: [...entities],
                    turns: [turnEntry.turn],
                    firstTurn: turnEntry.turn,
                    lastTurn: turnEntry.turn,
                    recentEvents: [{
                        turn: turnEntry.turn,
                        brief: recentBrief,
                        arcKey: arcKey || ''
                    }],
                    summaries: [],
                    currentContext: '',
                    continuityBrief: turnEntry.continuityBrief || '',
                    lastDistinctEvent: turnEntry.lastDistinctEvent || recentBrief,
                    sceneLocation: turnEntry.sceneLocation || turnEntry.locationState?.current || '',
                    locationState: turnEntry.locationState && typeof turnEntry.locationState === 'object' ? safeClone(turnEntry.locationState) : null,
                    temporalState: turnEntry.temporalState && typeof turnEntry.temporalState === 'object' ? safeClone(turnEntry.temporalState) : null,
                    keyPoints: arcPatch?.keyPoints || [],
                    ongoingTensions: arcPatch?.ongoingTensions || [],
                    activeThreads,
                    unresolvedQuestions: normalizeNarrativeStringArray(turnEntry.unresolvedQuestions, 8, 140),
                    nextBeatHints: normalizeNarrativeStringArray(turnEntry.nextBeatHints, 8, 140),
                    relationPressure: normalizeNarrativeStringArray(turnEntry.relationPressure, 8, 140),
                    memoryRefs: normalizeNarrativeStringArray(turnEntry.memoryRefs, 12, 80),
                    evidenceTurns: normalizeNarrativeStringArray(turnEntry.evidenceTurns, 12, 40),
                    dedupeKeys: normalizeNarrativeStringArray(turnEntry.dedupeKeys, 12, 160),
                    meta: { manualLocked: false, manualLockedAt: 0 }
                };
                applyLiveNarrativeSnapshot(storyline, turnEntry);
                narrativeState.storylines.push(storyline);
            }
            narrativeState.storylines = mergeNarrativeStorylines(narrativeState.storylines);
        };

        const summarizeIfNeeded = async (currentTurn) => {
            if (currentTurn - narrativeState.lastSummaryTurn < SUMMARY_INTERVAL) return;
            let summarized = false;
            for (const storyline of narrativeState.storylines) {
                const manualLocked = storyline?.meta?.manualLocked === true;
                const recentTurns = narrativeState.turnLog.filter(
                    t => storyline.turns.includes(t.turn) && t.turn > (storyline.summaries.length > 0 ? storyline.summaries[storyline.summaries.length - 1].upToTurn : 0)
                );
                if (recentTurns.length < 3) continue;
                if (manualLocked) continue;
                const brief = clipText(pushNarrativeUniqueLimited(
                    [],
                    recentTurns.map(t => t.continuityBrief || t.lastDistinctEvent || t.summary || t.response || '').filter(Boolean),
                    4,
                    { maxChars: 180 }
                ).join(' -> '), 240);
                storyline.summaries = (storyline.summaries || []).filter(entry => entry?.live !== true);
                const summaryKeyPoints = pushUniqueLimited([], recentTurns.flatMap(t => [
                    ...(Array.isArray(t.stateChanges) ? t.stateChanges : []),
                    ...(Array.isArray(t.distinctEvents) ? t.distinctEvents : []),
                    ...deriveKeyPointsFromBrief(t.continuityBrief || t.summary || t.response || '')
                ]), 8);
                const summaryTensions = pushUniqueLimited([], recentTurns.flatMap(t => deriveOngoingTensionsFromTurn(t)), 8);
                const summaryThreads = mergeNarrativeThreads([], recentTurns.flatMap(t => Array.isArray(t.activeThreads) ? t.activeThreads : []), 8);
                storyline.summaries.push({
                    upToTurn: currentTurn,
                    summary: brief,
                    keyPoints: summaryKeyPoints,
                    ongoingTensions: summaryTensions,
                    timestamp: Date.now(),
                    arcKey: storyline.arcKey || '',
                    continuityBrief: brief,
                    lastDistinctEvent: clipText(recentTurns[recentTurns.length - 1]?.lastDistinctEvent || '', 220),
                    activeThreads: summaryThreads,
                    nextBeatHints: pushNarrativeUniqueLimited([], recentTurns.flatMap(t => t.nextBeatHints || []), 6, { maxChars: 140 }),
                    evidenceTurns: pushNarrativeUniqueLimited([], recentTurns.flatMap(t => t.evidenceTurns || []), 12, { maxChars: 40 })
                });
                storyline.currentContext = brief;
                storyline.continuityBrief = brief;
                storyline.keyPoints = pushUniqueLimited(storyline.keyPoints, summaryKeyPoints, 12);
                storyline.ongoingTensions = pushUniqueLimited(storyline.ongoingTensions, summaryTensions, 10);
                storyline.activeThreads = mergeNarrativeThreads(storyline.activeThreads, summaryThreads, 8);
                summarized = true;
            }
            if (summarized) narrativeState.lastSummaryTurn = currentTurn;
        };

        const formatForPrompt = () => {
            const promptState = buildPromptState();
            const promptStorylines = Array.isArray(promptState.storylines) ? promptState.storylines : [];
            if (promptStorylines.length === 0) return '';

            const parts = ['【내러티브 현황 / Narrative Status】'];

            for (const storyline of promptStorylines) {
                parts.push(`\n[${storyline.name}] (Entities: ${storyline.entities.join(', ')})`);
                const flow = clipText(storyline.continuityBrief || storyline.currentContext || '', 260);
                if (flow) {
                    parts.push(`  Flow: ${flow}`);
                }
                const stateBits = [];
                const location = clipText(storyline.sceneLocation || storyline.locationState?.current || '', 100);
                const timeLabel = [
                    String(storyline.lastSceneTimeLabel || storyline.temporalState?.label || '').trim()
                    || [String(storyline.lastSceneDate || storyline.temporalState?.date || '').trim(), String(storyline.lastSceneTime || storyline.temporalState?.time || '').trim()].filter(Boolean).join(' ')
                ]
                    .filter(Boolean)
                    .join(' ');
                if (location) stateBits.push(`location=${location}`);
                if (timeLabel) stateBits.push(`time=${timeLabel}`);
                const relation = normalizeNarrativeStringArray(storyline.relationPressure, 2, 140);
                if (relation.length) stateBits.push(`relation=${relation.join('; ')}`);
                if (stateBits.length) {
                    parts.push(`  State: ${stateBits.join(' | ')}`);
                }
                const openThreads = mergeNarrativeThreads([], storyline.activeThreads, 5)
                    .map(thread => `${thread.label}${thread.status ? `: ${thread.status}` : ''}`);
                if (openThreads.length > 0) {
                    parts.push(`  Open Threads: ${openThreads.join('; ')}`);
                } else if (Array.isArray(storyline.ongoingTensions) && storyline.ongoingTensions.length > 0) {
                    parts.push(`  Open Threads: ${storyline.ongoingTensions.slice(-5).join('; ')}`);
                }
                const nextBeats = normalizeNarrativeStringArray(storyline.nextBeatHints, 3, 140);
                if (nextBeats.length) {
                    parts.push(`  Next: ${nextBeats.join('; ')}`);
                }
                const progression = pushNarrativeUniqueLimited(
                    [],
                    normalizeNarrativeStringArray(storyline.keyPoints, 5, 150),
                    4,
                    { maxChars: 150, exclude: [flow, ...openThreads, ...nextBeats] }
                );
                if (progression.length > 0) {
                    parts.push(`  Progression: ${progression.join('; ')}`);
                }
                const evidence = normalizeNarrativeStringArray(storyline.evidenceTurns, 8, 40);
                if (evidence.length) {
                    parts.push(`  Evidence: ${evidence.join(', ')}`);
                }
                if (storyline.recentEvents.length > 0) {
                    const last3 = storyline.recentEvents.slice(-3);
                    parts.push(`  Recent: ${last3.map(e => {
                        const matchedTurn = narrativeState.turnLog.find(t => Number(t?.turn || 0) === Number(e.turn || 0));
                        const timeLabel = String(matchedTurn?.sceneTimeLabel || '').trim()
                            || [String(matchedTurn?.sceneDate || '').trim(), String(matchedTurn?.sceneTime || '').trim()].filter(Boolean).join(' ');
                        const brief = clipText(matchedTurn?.lastDistinctEvent || e.brief || '', 180);
                        return `T${e.turn}${timeLabel ? ` @ ${timeLabel}` : ''}: ${brief}`;
                    }).join(' → ')}`);
                }
            }

            return parts.join('\n');
        };

        const normalizeRenameEntityKey = (value = '') => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
        const renameEntityList = (items = [], oldName = '', newName = '', previousNames = []) => {
            const oldKeys = new Set([oldName, ...(Array.isArray(previousNames) ? previousNames : [])].map(normalizeRenameEntityKey).filter(Boolean));
            let changed = false;
            const next = dedupeTextArray((Array.isArray(items) ? items : [])
                .map(item => {
                    const raw = typeof item === 'string' ? item : item?.name;
                    if (!raw) return '';
                    if (oldKeys.has(normalizeRenameEntityKey(raw))) {
                        changed = true;
                        return newName;
                    }
                    return String(raw || '').trim();
                })
                .filter(Boolean));
            return { list: next, changed };
        };
        const renameEntityReferences = (oldName = '', newName = '', options = {}) => {
            const oldText = String(oldName || '').trim();
            const newText = String(newName || '').trim();
            if (!oldText || !newText || normalizeRenameEntityKey(oldText) === normalizeRenameEntityKey(newText)) return { changed: false };
            const previousNames = Array.isArray(options.previousNames) ? options.previousNames : [];
            let changed = false;
            const rewriteTurn = (entry = {}) => {
                if (!entry || typeof entry !== 'object') return entry;
                for (const key of ['involvedEntities', 'mentionedEntityNames']) {
                    if (!Array.isArray(entry[key])) continue;
                    const renamed = renameEntityList(entry[key], oldText, newText, previousNames);
                    if (renamed.changed) {
                        entry[key] = renamed.list;
                        changed = true;
                    }
                }
                if (entry.narrativeArc && typeof entry.narrativeArc === 'object' && Array.isArray(entry.narrativeArc.entities)) {
                    const renamed = renameEntityList(entry.narrativeArc.entities, oldText, newText, previousNames);
                    if (renamed.changed) {
                        entry.narrativeArc.entities = renamed.list;
                        changed = true;
                    }
                }
                return entry;
            };
            narrativeState.turnLog = (Array.isArray(narrativeState.turnLog) ? narrativeState.turnLog : []).map(rewriteTurn);
            narrativeState.metaTurnLog = (Array.isArray(narrativeState.metaTurnLog) ? narrativeState.metaTurnLog : []).map(rewriteTurn);
            narrativeState.storylines = (Array.isArray(narrativeState.storylines) ? narrativeState.storylines : []).map(storyline => {
                if (!storyline || typeof storyline !== 'object') return storyline;
                if (Array.isArray(storyline.entities)) {
                    const renamed = renameEntityList(storyline.entities, oldText, newText, previousNames);
                    if (renamed.changed) {
                        storyline.entities = renamed.list;
                        changed = true;
                    }
                }
                return storyline;
            });
            if (changed) narrativeState.storylines = mergeNarrativeStorylines(narrativeState.storylines);
            return { changed };
        };

        const getState = () => narrativeState;
        const resetState = (nextState = null) => {
            narrativeState = normalizeState(nextState);
            return narrativeState;
        };

        return { loadState, saveState, recordTurn, correctTurn, summarizeIfNeeded, formatForPrompt, renameEntityReferences, getState, resetState, buildHeuristicTurnBrief };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Story Author / Director
    // ══════════════════════════════════════════════════════════════
    const StoryAuthor = (() => {
        const AUTHOR_COMMENT = 'lmai_story_author';

        const defaultState = () => ({
            currentArc: '',
            narrativeGoal: '',
            activeTensions: [],
            nextBeats: [],
            guardrails: [],
            focusCharacters: [],
            recentDecisions: [],
            autoAdvanceOnEmptyInput: true,
            lastPlanTurn: 0,
            lastUpdated: 0
        });

        let authorState = defaultState();

        const clip = (value = '', max = 220) => truncateForLLM(String(value || '').replace(/\s+/g, ' ').trim(), max, ' ... ');
        const list = (items = [], limit = 6, max = 180) => dedupeTextArray(
            (Array.isArray(items) ? items : (items ? [items] : []))
                .map(item => typeof item === 'string' ? item : (item?.label || item?.text || item?.summary || ''))
                .map(item => clip(item, max))
                .filter(Boolean)
        ).slice(0, Math.max(1, Number(limit || 6)));
        const normalizeState = (state = null) => {
            const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
            return {
                ...defaultState(),
                currentArc: clip(source.currentArc || '', 140),
                narrativeGoal: clip(source.narrativeGoal || '', 240),
                activeTensions: list(source.activeTensions, 6, 180),
                nextBeats: list(source.nextBeats, 6, 180),
                guardrails: list(source.guardrails, 6, 180),
                focusCharacters: list(source.focusCharacters, 6, 80),
                recentDecisions: list(source.recentDecisions, 8, 180),
                autoAdvanceOnEmptyInput: source.autoAdvanceOnEmptyInput !== false,
                lastPlanTurn: Number(source.lastPlanTurn || 0) || 0,
                lastUpdated: Number(source.lastUpdated || 0) || 0
            };
        };
        const loadState = (lorebook = []) => {
            const entry = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])
                .find(item => item?.comment === AUTHOR_COMMENT);
            if (!entry) {
                authorState = defaultState();
                return authorState;
            }
            try {
                authorState = normalizeState({ ...authorState, ...JSON.parse(entry.content || '{}') });
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Story author state parse failed:', e?.message || e);
            }
            return authorState;
        };
        const saveState = async (lorebook = []) => {
            if (!Array.isArray(lorebook)) return;
            const entry = {
                key: 'lmai_story_author::plan',
                comment: AUTHOR_COMMENT,
                content: JSON.stringify(authorState),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(item => item?.comment === AUTHOR_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };
        const buildHeuristicPlan = (payload = {}, mode = 'proactive') => {
            const focused = list(payload.focusedEntities || [], 6, 80);
            const nextBeats = [];
            if (focused.length > 0) nextBeats.push(`${focused[0]} should take a concrete action that changes the scene.`);
            if (payload.worldStatePrompt) nextBeats.push('Use the current world state as active pressure on the scene.');
            if (payload.isEmptyInput) {
                nextBeats.push('Continue the scene without waiting for user direction and move it forward by one clear beat.');
                nextBeats.push('Make someone act, decide, reveal, interrupt, or shift the relationship.');
            }
            nextBeats.push(mode === 'aggressive'
                ? 'Do not let the scene stall; force a meaningful turn before the response ends.'
                : 'Advance one meaningful beat while preserving continuity.');
            return {
                currentArc: authorState.currentArc || 'Ongoing Story',
                narrativeGoal: authorState.narrativeGoal || (payload.isEmptyInput
                    ? 'Continue the scene without waiting for user direction and produce the next concrete beat.'
                    : 'Maintain momentum and create the next meaningful beat.'),
                activeTensions: authorState.activeTensions?.length ? authorState.activeTensions : ['Preserve continuity while escalating the most relevant tension.'],
                nextBeats,
                guardrails: [
                    'Respect established world rules, relationship states, and hidden information boundaries.',
                    'Prefer causally grounded developments over random twists.'
                ],
                focusCharacters: focused,
                recentDecisions: []
            };
        };
        const applyPlanState = (currentTurn, nextPlan = null, payload = {}, config = MemoryEngine.CONFIG) => {
            const mode = String(config?.storyAuthorMode || 'disabled').toLowerCase();
            if (config?.storyAuthorEnabled !== true || mode === 'disabled') return authorState;
            const plan = nextPlan && typeof nextPlan === 'object' ? nextPlan : buildHeuristicPlan(payload, mode);
            authorState = normalizeState({
                ...authorState,
                currentArc: plan.currentArc || authorState.currentArc,
                narrativeGoal: plan.narrativeGoal || authorState.narrativeGoal,
                activeTensions: Array.isArray(plan.activeTensions) ? plan.activeTensions : authorState.activeTensions,
                nextBeats: Array.isArray(plan.nextBeats) ? plan.nextBeats : authorState.nextBeats,
                guardrails: Array.isArray(plan.guardrails) ? plan.guardrails : authorState.guardrails,
                focusCharacters: Array.isArray(plan.focusCharacters) ? plan.focusCharacters : (payload.focusedEntities || authorState.focusCharacters),
                recentDecisions: [
                    ...(Array.isArray(authorState.recentDecisions) ? authorState.recentDecisions : []),
                    ...(Array.isArray(plan.recentDecisions) ? plan.recentDecisions : [])
                ],
                lastPlanTurn: Number(currentTurn || 0) || authorState.lastPlanTurn,
                lastUpdated: Date.now()
            });
            return authorState;
        };
        const formatForPrompt = () => {
            const mode = String(MemoryEngine.CONFIG?.storyAuthorMode || 'disabled').toLowerCase();
            if (MemoryEngine.CONFIG?.storyAuthorEnabled !== true || mode === 'disabled') return '';
            const parts = ['【스토리 작가 개입 / Story Author Guidance】'];
            if (mode === 'aggressive') parts.push('LIBRA must actively drive the scene forward and avoid passive continuation.');
            else if (mode === 'supportive') parts.push('LIBRA should gently steer the scene while preserving user-led rhythm.');
            else parts.push('LIBRA should proactively shape the next beat while keeping continuity intact.');
            if (authorState.autoAdvanceOnEmptyInput !== false) {
                parts.push('If the user input is empty, continue the current scene automatically and make at least one meaningful beat happen.');
            }
            parts.push(buildCreativeWritingGuidanceBlock('Story Author Creative Writing Guidance'));
            const nsfw = buildNsfwGuidanceBlock('Story Author NSFW Guidance');
            if (nsfw) parts.push(nsfw);
            const prefill = buildPrefillBlock();
            if (prefill) parts.push(prefill);
            if (authorState.currentArc) parts.push(`Current Arc: ${authorState.currentArc}`);
            if (authorState.narrativeGoal) parts.push(`Narrative Goal: ${authorState.narrativeGoal}`);
            if (authorState.focusCharacters?.length) parts.push(`Focus Characters: ${authorState.focusCharacters.join(', ')}`);
            if (authorState.activeTensions?.length) parts.push(`Active Tensions: ${authorState.activeTensions.join('; ')}`);
            if (authorState.nextBeats?.length) parts.push(`Next Beats: ${authorState.nextBeats.join('; ')}`);
            if (authorState.guardrails?.length) parts.push(`Guardrails: ${authorState.guardrails.join('; ')}`);
            parts.push('Advance at least one meaningful beat, reveal character through action/dialogue, and use memory, relationships, world rules, and ongoing narrative context.');
            return parts.filter(Boolean).join('\n');
        };
        const getState = () => authorState;
        const resetState = (nextState = null) => {
            authorState = normalizeState(nextState || defaultState());
            return authorState;
        };
        const renameEntityReferences = (oldName = '', newName = '', options = {}) => {
            const newText = String(newName || '').trim();
            if (!newText) return { changed: false };
            const oldKeys = new Set([oldName, ...(Array.isArray(options?.previousNames) ? options.previousNames : [])]
                .map(item => String(item || '').normalize('NFKC').trim().toLowerCase())
                .filter(Boolean));
            if (oldKeys.size === 0) return { changed: false };
            let changed = false;
            const rewriteList = (items = []) => {
                const next = [];
                for (const item of Array.isArray(items) ? items : []) {
                    const text = String(item || '').trim();
                    const key = text.normalize('NFKC').toLowerCase();
                    const value = oldKeys.has(key) ? newText : text;
                    if (value !== text) changed = true;
                    if (value && !next.includes(value)) next.push(value);
                }
                return next;
            };
            authorState.focusCharacters = rewriteList(authorState.focusCharacters);
            return { changed };
        };
        return { loadState, saveState, applyPlanState, formatForPrompt, renameEntityReferences, getState, resetState };
    })();

    const Director = (() => {
        const DIRECTOR_COMMENT = 'lmai_director';

        const defaultState = () => ({
            sceneMandate: '',
            requiredOutcomes: [],
            forbiddenMoves: [],
            emphasis: [],
            targetPacing: 'steady',
            pressureLevel: 'strong',
            focusCharacters: [],
            lastTurn: 0,
            lastUpdated: 0
        });

        let directorState = defaultState();

        const clip = (value = '', max = 220) => truncateForLLM(String(value || '').replace(/\s+/g, ' ').trim(), max, ' ... ');
        const list = (items = [], limit = 6, max = 180) => dedupeTextArray(
            (Array.isArray(items) ? items : (items ? [items] : []))
                .map(item => typeof item === 'string' ? item : (item?.label || item?.text || item?.summary || ''))
                .map(item => clip(item, max))
                .filter(Boolean)
        ).slice(0, Math.max(1, Number(limit || 6)));
        const normalizeState = (state = null) => {
            const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
            return {
                ...defaultState(),
                sceneMandate: clip(source.sceneMandate || '', 240),
                requiredOutcomes: list(source.requiredOutcomes, 6, 180),
                forbiddenMoves: list(source.forbiddenMoves, 6, 180),
                emphasis: list(source.emphasis, 6, 180),
                targetPacing: clip(source.targetPacing || 'steady', 60) || 'steady',
                pressureLevel: clip(source.pressureLevel || 'strong', 60) || 'strong',
                focusCharacters: list(source.focusCharacters, 6, 80),
                lastTurn: Number(source.lastTurn || 0) || 0,
                lastUpdated: Number(source.lastUpdated || 0) || 0
            };
        };
        const loadState = (lorebook = []) => {
            const entry = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])
                .find(item => item?.comment === DIRECTOR_COMMENT);
            if (!entry) {
                directorState = defaultState();
                return directorState;
            }
            try {
                directorState = normalizeState({ ...directorState, ...JSON.parse(entry.content || '{}') });
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Director state parse failed:', e?.message || e);
            }
            return directorState;
        };
        const saveState = async (lorebook = []) => {
            if (!Array.isArray(lorebook)) return;
            const entry = {
                key: 'lmai_director::directive',
                comment: DIRECTOR_COMMENT,
                content: JSON.stringify(directorState),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(item => item?.comment === DIRECTOR_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };
        const buildHeuristicDirective = (payload = {}, mode = 'strong') => {
            const focused = list(payload.focusedEntities || [], 6, 80);
            const requiredOutcomes = focused.length > 0
                ? [`At least one of ${focused.join(', ')} must take a decisive action.`]
                : ['Someone in the current scene must trigger a concrete change before the response ends.'];
            if (payload.worldStatePrompt) requiredOutcomes.push('Use the current world state as active pressure on the scene.');
            if (payload.isEmptyInput) requiredOutcomes.push('Continue the scene without waiting for user input and force one meaningful beat.');
            const forbiddenMoves = [
                'Do not end the response in a static holding pattern.',
                'Do not contradict established world rules, relationships, or known facts.'
            ];
            let sceneMandate = 'Drive the scene forward with a clear, consequential beat.';
            let targetPacing = 'steady';
            let pressureLevel = mode || 'standard';
            if (mode === 'light') {
                sceneMandate = 'Gently steer the scene toward a meaningful next beat without overwhelming the current tone.';
                targetPacing = 'measured';
                pressureLevel = 'light';
            } else if (mode === 'absolute') {
                sceneMandate = 'Override passivity. The response must create an unmistakable narrative change this turn.';
                targetPacing = 'relentless';
                pressureLevel = 'absolute';
                forbiddenMoves.push('Do not resolve the turn with pure atmosphere, repetition, or non-committal dialogue.');
            } else if (mode === 'strong') {
                sceneMandate = 'Actively force a meaningful turn in the scene and avoid passive continuation.';
                targetPacing = 'brisk';
                pressureLevel = 'strong';
            }
            return {
                sceneMandate,
                requiredOutcomes,
                forbiddenMoves,
                emphasis: [
                    'Prioritize concrete action, consequence, or decision over exposition.',
                    'Make at least one visible shift in tension, information, or relationship state.'
                ],
                targetPacing,
                pressureLevel,
                focusCharacters: focused
            };
        };
        const applyDirectiveState = (currentTurn, nextDirective = null, payload = {}, config = MemoryEngine.CONFIG) => {
            const mode = String(config?.directorMode || 'disabled').toLowerCase();
            if (config?.directorEnabled !== true || mode === 'disabled') return directorState;
            const directive = nextDirective && typeof nextDirective === 'object' ? nextDirective : buildHeuristicDirective(payload, mode);
            directorState = normalizeState({
                ...directorState,
                sceneMandate: directive.sceneMandate || directorState.sceneMandate,
                requiredOutcomes: Array.isArray(directive.requiredOutcomes) ? directive.requiredOutcomes : directorState.requiredOutcomes,
                forbiddenMoves: Array.isArray(directive.forbiddenMoves) ? directive.forbiddenMoves : directorState.forbiddenMoves,
                emphasis: Array.isArray(directive.emphasis) ? directive.emphasis : directorState.emphasis,
                targetPacing: directive.targetPacing || directorState.targetPacing,
                pressureLevel: directive.pressureLevel || directorState.pressureLevel || mode,
                focusCharacters: Array.isArray(directive.focusCharacters) ? directive.focusCharacters : (payload.focusedEntities || directorState.focusCharacters),
                lastTurn: Number(currentTurn || 0) || directorState.lastTurn,
                lastUpdated: Date.now()
            });
            return directorState;
        };
        const formatForPrompt = () => {
            const mode = String(MemoryEngine.CONFIG?.directorMode || 'disabled').toLowerCase();
            if (MemoryEngine.CONFIG?.directorEnabled !== true || mode === 'disabled') return '';
            const parts = ['【감독 개입 / Director Supervision】'];
            if (mode === 'light') parts.push('Apply light but persistent guidance to keep the scene moving.');
            else if (mode === 'absolute') parts.push('This is top-priority direction. The response must obey it and create a strong narrative turn now.');
            else if (mode === 'strong') parts.push('Apply strong directorial control and force a meaningful beat in this response.');
            else parts.push('Apply firm directorial guidance in this response.');
            parts.push(buildCreativeWritingGuidanceBlock('Director Creative Writing Guidance'));
            const nsfw = buildNsfwGuidanceBlock('Director NSFW Guidance');
            if (nsfw) parts.push(nsfw);
            const prefill = buildPrefillBlock();
            if (prefill) parts.push(prefill);
            if (directorState.sceneMandate) parts.push(`Scene Mandate: ${directorState.sceneMandate}`);
            if (directorState.focusCharacters?.length) parts.push(`Focus Characters: ${directorState.focusCharacters.join(', ')}`);
            if (directorState.targetPacing) parts.push(`Target Pacing: ${directorState.targetPacing}`);
            if (directorState.pressureLevel) parts.push(`Pressure Level: ${directorState.pressureLevel}`);
            if (directorState.requiredOutcomes?.length) parts.push(`Required Outcomes: ${directorState.requiredOutcomes.join('; ')}`);
            if (directorState.forbiddenMoves?.length) parts.push(`Forbidden Moves: ${directorState.forbiddenMoves.join('; ')}`);
            if (directorState.emphasis?.length) parts.push(`Emphasis: ${directorState.emphasis.join('; ')}`);
            parts.push('Treat these instructions as higher priority than passive continuation. The response must create visible movement in plot, tension, or relationship state this turn.');
            return parts.filter(Boolean).join('\n');
        };
        const getState = () => directorState;
        const resetState = (nextState = null) => {
            directorState = normalizeState(nextState || defaultState());
            return directorState;
        };
        const renameEntityReferences = (oldName = '', newName = '', options = {}) => {
            const newText = String(newName || '').trim();
            if (!newText) return { changed: false };
            const oldKeys = new Set([oldName, ...(Array.isArray(options?.previousNames) ? options.previousNames : [])]
                .map(item => String(item || '').normalize('NFKC').trim().toLowerCase())
                .filter(Boolean));
            if (oldKeys.size === 0) return { changed: false };
            let changed = false;
            const next = [];
            for (const item of Array.isArray(directorState.focusCharacters) ? directorState.focusCharacters : []) {
                const text = String(item || '').trim();
                const key = text.normalize('NFKC').toLowerCase();
                const value = oldKeys.has(key) ? newText : text;
                if (value !== text) changed = true;
                if (value && !next.includes(value)) next.push(value);
            }
            directorState.focusCharacters = next;
            return { changed };
        };
        return { loadState, saveState, applyDirectiveState, formatForPrompt, renameEntityReferences, getState, resetState };
    })();

    const TurnMaintenanceOptimizer = (() => {
        const sanitizeCorrectionPayloadLite = (payload) => ({
            shouldCorrect: !!payload?.shouldCorrect,
            reasons: Array.isArray(payload?.reasons) ? payload.reasons.map(v => String(v || '').trim()).filter(Boolean).slice(0, 6) : [],
            correctedEntities: Array.isArray(payload?.correctedEntities) ? payload.correctedEntities.filter(item => item && item.name) : [],
            correctedRelations: Array.isArray(payload?.correctedRelations) ? payload.correctedRelations.filter(item => item && item.entityA && item.entityB) : [],
            world: (payload?.world && typeof payload.world === 'object' && !Array.isArray(payload.world)) ? payload.world : {},
            narrative: (payload?.narrative && typeof payload.narrative === 'object' && !Array.isArray(payload.narrative)) ? payload.narrative : {}
        });

        const buildPayload = (currentTurn, turnState, aiResponse, effectiveLore = [], config = MemoryEngine.CONFIG) => {
            const involvedNames = [...new Set((turnState?.involvedEntities || []).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean))];
            const userEvidenceText = String(turnState?.strictUserMsg || turnState?.userMsgForMemory || turnState?.userMsgForNarrative || '').trim();
            const analysisEvidence = buildCurrentTurnAnalysisEvidence(userEvidenceText, aiResponse, config);
            const entityCache = Array.from(EntityManager.getEntityCache().values());
            const focusedEntities = involvedNames.length > 0
                ? entityCache.filter(entity => involvedNames.includes(entity.name))
                : entityCache.slice(0, 4);
            const charStateTexts = focusedEntities
                .map(entity => CharacterStateTracker.formatForPrompt(entity.name))
                .filter(Boolean);
            const entityTexts = focusedEntities
                .map(entity => EntityManager.formatEntityForPrompt(entity.name))
                .filter(Boolean);
            const relationTexts = focusedEntities
                .flatMap(entity => EntityManager.formatRelationsForPrompt(entity.name))
                .filter(Boolean)
                .slice(0, 8);
            const recentTurns = (NarrativeTracker.getState()?.turnLog || []).slice(-8)
                .map(t => `Turn ${t.turn}: ${t.summary || t.response}`);
            const memoryEntries = MemoryEngine.getManagedEntries(effectiveLore)
                .map(entry => ({ entry, meta: MemoryEngine.getCachedMeta(entry) }))
                .sort((a, b) => (b.meta.imp - a.meta.imp) || (b.meta.t - a.meta.t))
                .slice(0, 6)
                .map(({ entry }) => CompactMemoryCodec.buildDisplayTextFromEntry(entry, 220))
                .filter(Boolean);
            const loreSnippets = MemoryEngine.CONFIG.useLorebookRAG
                ? effectiveLore
                    .filter(e => !e.comment || !String(e.comment).startsWith('lmai_'))
                    .slice(0, 8)
                    .map(e => (e.content || '').slice(0, 180))
                : [];

            return {
                turn: currentTurn,
                userMsg: analysisEvidence.includeUser ? userEvidenceText : '',
                userRequestMetadata: userEvidenceText,
                hasUserRequestMetadata: !!userEvidenceText,
                aiResponse: analysisEvidence.assistantText,
                assistantEvidenceText: analysisEvidence.assistantText,
                canonicalEvidenceText: analysisEvidence.text,
                evidenceText: analysisEvidence.text,
                evidenceLabel: analysisEvidence.label,
                evidencePolicy: analysisEvidence.policy,
                analysisEvidenceMode: analysisEvidence.mode,
                analysisIncludesUserInput: analysisEvidence.includeUser,
                extracted: turnState?.entityResult && typeof turnState.entityResult === 'object'
                    ? safeClone(turnState.entityResult)
                    : { entities: [], relations: [], world: {} },
                focusedEntities: focusedEntities.map(e => e.name),
                entityTexts,
                relationTexts,
                charStateTexts,
                worldPrompt: HierarchicalWorldManager.formatForPrompt(),
                worldStatePrompt: WorldStateTracker.formatForPrompt(),
                narrativePrompt: NarrativeTracker.formatForPrompt(),
                currentStoryAuthorPrompt: StoryAuthor.formatForPrompt(),
                currentDirectorPrompt: Director.formatForPrompt(),
                recentTurns,
                memoryEntries,
                loreSnippets
            };
        };

        const buildHeuristicStoryAuthor = (payload, config = MemoryEngine.CONFIG) => {
            const focused = Array.isArray(payload.focusedEntities) ? payload.focusedEntities.slice(0, 6) : [];
            const mode = String(config?.storyAuthorMode || 'disabled').toLowerCase();
            const nextBeats = [];
            if (focused.length > 0) nextBeats.push(`${focused[0]} should take a concrete action that changes the scene.`);
            if (payload.worldStatePrompt) nextBeats.push('Use the current world state as active pressure on the scene.');
            if (!payload.hasUserRequestMetadata) nextBeats.push('Continue the scene without waiting for user direction and produce the next concrete beat.');
            nextBeats.push(mode === 'aggressive'
                ? 'Do not let the scene stall; force a meaningful turn before the response ends.'
                : 'Advance one meaningful beat while preserving continuity.');
            return {
                currentArc: StoryAuthor.getState?.()?.currentArc || '',
                narrativeGoal: payload.hasUserRequestMetadata
                    ? 'Maintain momentum and create the next meaningful beat.'
                    : 'Continue the scene without waiting for user direction and produce the next concrete beat.',
                activeTensions: ['Preserve continuity while escalating the most relevant tension.'],
                nextBeats,
                guardrails: [
                    'Respect established world rules, relationship states, and hidden information boundaries.',
                    'Prefer causally grounded developments over random twists.'
                ],
                focusCharacters: focused,
                recentDecisions: []
            };
        };
        const buildHeuristicDirector = (payload, config = MemoryEngine.CONFIG) => {
            const focused = Array.isArray(payload.focusedEntities) ? payload.focusedEntities.slice(0, 6) : [];
            const mode = String(config?.directorMode || 'disabled').toLowerCase();
            const requiredOutcomes = focused.length > 0
                ? [`At least one of ${focused.join(', ')} must take a decisive action.`]
                : ['Someone in the current scene must trigger a concrete change before the response ends.'];
            if (!payload.hasUserRequestMetadata) requiredOutcomes.push('Continue the scene without waiting for user input and force one meaningful beat.');
            return {
                sceneMandate: mode === 'absolute'
                    ? 'Override passivity. The response must create an unmistakable narrative change this turn.'
                    : 'Drive the scene forward with a clear, consequential beat.',
                requiredOutcomes,
                forbiddenMoves: [
                    'Do not end the response in a static holding pattern.',
                    'Do not contradict established world rules, relationships, or known facts.'
                ],
                emphasis: [
                    'Prioritize concrete action, consequence, or decision over exposition.',
                    'Make at least one visible shift in tension, information, or relationship state.'
                ],
                targetPacing: mode === 'absolute' ? 'relentless' : (mode === 'light' ? 'measured' : 'brisk'),
                pressureLevel: mode,
                focusCharacters: focused
            };
        };
        const buildHeuristicBundle = (payload, config = MemoryEngine.CONFIG) => ({
            narrativeBrief: NarrativeTracker.buildHeuristicTurnBrief('', payload.aiResponse),
            correction: null,
            correctionReviewed: false,
            longTermMemory: config?.rpLongTermMemoryEnabled === false
                ? null
                : RPContinuityCore.extractHeuristic('', payload.aiResponse, {
                    turn: payload.turn,
                    entityRefs: payload.focusedEntities || [],
                    source: 'maintenance_heuristic'
                }),
            storyAuthor: config?.storyAuthorEnabled === true && String(config?.storyAuthorMode || 'disabled').toLowerCase() !== 'disabled'
                ? buildHeuristicStoryAuthor(payload, config)
                : null,
            director: config?.directorEnabled === true && String(config?.directorMode || 'disabled').toLowerCase() !== 'disabled'
                ? buildHeuristicDirector(payload, config)
                : null
        });

        const getMaintenanceResponseShape = (includeRpLongTermLlm = false) => includeRpLongTermLlm
            ? '{"narrativeBrief":"","correction":{"shouldCorrect":false,"reasons":[],"correctedEntities":[],"correctedRelations":[],"world":{},"narrative":{}},"longTermMemory":{"importance":5,"durability":"short|medium|long|permanent","stableFacts":[{"subject":"","slot":"","value":"","text":"","confidence":0.8,"visibility":"public|pov|secret","knownBy":[],"unknownTo":[]}],"preferences":[{"subject":"","kind":"preference|boundary|fear|medical_or_food_boundary","topic":"","text":"","confidence":0.8}],"commitments":[{"owner":"","target":"","text":"","status":"open|fulfilled|broken|cancelled","due":"","confidence":0.8}],"openLoops":[{"type":"goal|mystery|conflict","text":"","status":"open|resolved","resolutionCriteria":[],"confidence":0.8}],"relationshipDeltas":[{"pair":["",""],"axis":"trust|affection|fear|loyalty|hostility|status","direction":"increase|decrease|shift","text":"","confidence":0.8}],"stateChanges":[{"entity":"","domain":"physical|location|role|knowledge|possession|goal","before":"","after":"","text":"","confidence":0.8}],"callbacks":[{"label":"","text":"","entities":[],"confidence":0.8}]},"storyAuthor":{"currentArc":"","narrativeGoal":"","activeTensions":[""],"nextBeats":[""],"guardrails":[""],"focusCharacters":[""],"recentDecisions":[""]},"director":{"sceneMandate":"","requiredOutcomes":[""],"forbiddenMoves":[""],"emphasis":[""],"targetPacing":"","pressureLevel":"","focusCharacters":[""]}}'
            : '{"narrativeBrief":"","correction":{"shouldCorrect":false,"reasons":[],"correctedEntities":[],"correctedRelations":[],"world":{},"narrative":{}},"storyAuthor":{"currentArc":"","narrativeGoal":"","activeTensions":[""],"nextBeats":[""],"guardrails":[""],"focusCharacters":[""],"recentDecisions":[""]},"director":{"sceneMandate":"","requiredOutcomes":[""],"forbiddenMoves":[""],"emphasis":[""],"targetPacing":"","pressureLevel":"","focusCharacters":[""]}}';

        const normalizeMaintenanceBundleResult = (parsed, heuristic, payload, config = MemoryEngine.CONFIG) => {
            const safe = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            return {
                narrativeBrief: String(safe.narrativeBrief || '').trim() || heuristic.narrativeBrief,
                correction: safe.correction ? sanitizeCorrectionPayloadLite(safe.correction) : null,
                correctionReviewed: Object.prototype.hasOwnProperty.call(safe, 'correction'),
                longTermMemory: config?.rpLongTermMemoryEnabled === false
                    ? null
                    : (config?.rpLongTermLlmEnrichment === false
                        ? heuristic.longTermMemory
                        : RPContinuityCore.mergeTurnMemory(heuristic.longTermMemory, safe.longTermMemory || null, {
                            turn: payload.turn,
                            entityRefs: payload.focusedEntities || [],
                            source: 'maintenance_llm'
                        })),
                storyAuthor: safe.storyAuthor && typeof safe.storyAuthor === 'object'
                    ? safe.storyAuthor
                    : heuristic.storyAuthor,
                director: safe.director && typeof safe.director === 'object'
                    ? safe.director
                    : heuristic.director,
                canonicalPacket: safe.canonicalPacket && typeof safe.canonicalPacket === 'object' && !Array.isArray(safe.canonicalPacket)
                    ? safeClone(safe.canonicalPacket)
                    : null
            };
        };

        const extractUnifiedEntityPayload = (parsed = {}) => {
            const compat = parsed?.compat && typeof parsed.compat === 'object' && !Array.isArray(parsed.compat) ? parsed.compat : {};
            const candidate = parsed?.entityExtraction || compat?.entityExtraction || parsed?.entityExtractionPatch || parsed?.entity || parsed?.entitiesPatch || null;
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
            const hasEntityShape = Array.isArray(candidate.entities)
                || Array.isArray(candidate.relations)
                || Array.isArray(candidate.spans)
                || (candidate.world && typeof candidate.world === 'object' && !Array.isArray(candidate.world));
            return hasEntityShape ? candidate : null;
        };

        const isPacketObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
        const hasCanonicalPacketKeys = (value = {}) => isPacketObject(value) && [
            'meta', 'memory', 'entity', 'world', 'narrative', 'guidance', 'guards', 'importance'
        ].some(key => Object.prototype.hasOwnProperty.call(value, key));
        const extractUnifiedCanonicalPacket = (parsed = {}) => {
            const candidates = [
                parsed?.canonicalPacket,
                parsed?.canonical_packet,
                parsed?.packet,
                parsed?.packet_patch,
                parsed?.compat?.canonicalPacket,
                parsed?.compat?.packet
            ];
            for (const candidate of candidates) {
                if (hasCanonicalPacketKeys(candidate)) return safeClone(candidate);
            }
            if (hasCanonicalPacketKeys(parsed) && !Object.prototype.hasOwnProperty.call(parsed, 'entityExtraction')) {
                return safeClone(parsed);
            }
            return null;
        };
        const packetArray = (value) => Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
        const packetObject = (value) => isPacketObject(value) ? value : {};
        const packetText = (value, max = 220) => {
            if (value == null) return '';
            if (isPacketObject(value)) {
                const picked = value.summary || value.text || value.label || value.value || value.current_state || value.state || value.reason || '';
                if (picked) return packetText(picked, max);
                try { return packetText(JSON.stringify(value), max); } catch { return ''; }
            }
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return '';
            return text.length > max ? `${text.slice(0, Math.max(24, max - 1)).trim()}…` : text;
        };
        const packetTextList = (value, limit = 8, max = 180) => dedupeTextArray(
            packetArray(value)
                .map(item => packetText(item, max))
                .filter(Boolean)
        ).slice(0, Math.max(1, Number(limit || 8)));
        const packetObjectList = (value) => packetArray(value).filter(item => isPacketObject(item));
        const packetImportance = (packet = {}, fallback = 5) => {
            const raw = packet?.importance?.overall ?? packet?.importance ?? packet?.meta?.importance;
            const numeric = Number(raw);
            if (!Number.isFinite(numeric)) return fallback;
            if (numeric <= 1) return Math.max(1, Math.min(10, Math.round(numeric * 10)));
            return Math.max(1, Math.min(10, Math.round(numeric)));
        };
        const pushPacketFact = (out, subject, slot, value, text, meta = {}) => {
            const body = packetText(text || value, 260);
            if (!body) return;
            out.push({
                subject: packetText(subject || 'current_turn', 120) || 'current_turn',
                slot: packetText(slot || 'fact', 80) || 'fact',
                value: packetText(value || body, 220),
                text: body,
                confidence: Math.max(0, Math.min(1, Number(meta.confidence ?? 0.78) || 0.78)),
                visibility: packetText(meta.visibility || 'public', 32) || 'public',
                knownBy: Array.isArray(meta.knownBy) ? meta.knownBy.map(item => packetText(item, 80)).filter(Boolean).slice(0, 8) : [],
                unknownTo: Array.isArray(meta.unknownTo) ? meta.unknownTo.map(item => packetText(item, 80)).filter(Boolean).slice(0, 8) : []
            });
        };
        const buildLongTermMemoryFromCanonicalPacket = (packet = {}, payload = {}, config = MemoryEngine.CONFIG) => {
            if (config?.rpLongTermMemoryEnabled === false || !hasCanonicalPacketKeys(packet)) return null;
            const meta = packetObject(packet.meta);
            const memory = packetObject(packet.memory);
            const entity = packetObject(packet.entity);
            const world = packetObject(packet.world);
            const narrative = packetObject(packet.narrative);
            const guidance = { ...packetObject(packet.guidance), ...packetObject(packet.guards) };
            const stableFacts = [];
            const callbacks = [];
            const openLoops = [];
            const relationshipDeltas = [];
            const stateChanges = [];
            for (const item of packetObjectList(memory.facts || memory.stableFacts || memory.stable_facts)) {
                pushPacketFact(stableFacts, item.subject || item.entity || 'current_turn', item.slot || item.type || 'fact', item.value || item.summary || item.text, item.text || item.summary || item.value, item);
            }
            for (const rule of packetTextList(world.rules || world.active_rules || world.activeRules, 12, 240)) {
                pushPacketFact(stableFacts, 'world', 'rule', rule, rule, { confidence: 0.82 });
            }
            for (const item of packetObjectList(entity.characters || entity.entities || entity.people)) {
                const name = packetText(item.name || item.canonicalName || item.displayName, 120);
                const summary = packetText(item.identity || item.role || item.summary || item.current_state || item.currentState, 260);
                if (name && summary) pushPacketFact(stableFacts, name, 'entity_profile', summary, summary, item);
                const state = packetText(item.current_state || item.currentState || item.state || item.status, 260);
                if (name && state) {
                    stateChanges.push({
                        entity: name,
                        domain: 'state',
                        before: '',
                        after: state,
                        text: state,
                        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.78) || 0.78))
                    });
                }
            }
            for (const item of packetObjectList(entity.relations || entity.relationships)) {
                const pair = packetArray(item.pair || item.entities || item.participants)
                    .map(value => packetText(value, 120))
                    .filter(Boolean)
                    .slice(0, 2);
                const entityA = packetText(item.entityA || item.a || item.from || pair[0] || '', 120);
                const entityB = packetText(item.entityB || item.b || item.to || pair[1] || '', 120);
                const text = packetText(item.text || item.summary || item.current_state || item.currentState || item.state || item.event, 260);
                if (entityA && entityB && text) {
                    relationshipDeltas.push({
                        pair: [entityA, entityB],
                        axis: packetText(item.axis || item.type || item.relationType || 'status', 80) || 'status',
                        direction: packetText(item.direction || item.change || 'shift', 40) || 'shift',
                        text,
                        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.78) || 0.78))
                    });
                }
            }
            for (const event of [
                ...packetObjectList(memory.events),
                ...packetObjectList(meta?.node_memory?.nodes),
                ...packetObjectList(world.active_events || world.activeEvents),
                ...packetObjectList(narrative.scene_deltas || narrative.sceneDeltas)
            ]) {
                const text = packetText(event.summary || event.text || event.event || event.label || event, 260);
                if (!text) continue;
                callbacks.push({
                    label: packetText(event.label || event.type || 'turn_event', 80) || 'turn_event',
                    text,
                    entities: packetTextList(event.entities || event.characters || event.participants || payload.focusedEntities, 8, 80),
                    confidence: Math.max(0, Math.min(1, Number(event.confidence ?? 0.76) || 0.76))
                });
            }
            for (const text of [
                ...packetTextList(narrative.unresolved_threads || narrative.unresolvedThreads || narrative.conflict_traces || narrative.conflictTraces, 10, 220),
                ...packetTextList(world.offscreen_threads || world.offscreenThreads, 8, 220),
                ...packetTextList(guidance.unresolved_pressure || guidance.unresolvedPressure, 8, 220)
            ]) {
                openLoops.push({
                    type: 'conflict',
                    text,
                    status: 'open',
                    resolutionCriteria: [],
                    confidence: 0.74
                });
            }
            for (const text of [
                packetText(world.scene, 240),
                packetText(world.location ? `Location: ${world.location}` : '', 180),
                packetText(world.time ? `Time: ${world.time}` : '', 120)
            ].filter(Boolean)) {
                stateChanges.push({
                    entity: 'world',
                    domain: 'location',
                    before: '',
                    after: text,
                    text,
                    confidence: 0.76
                });
            }
            const hasAny = stableFacts.length || callbacks.length || openLoops.length || relationshipDeltas.length || stateChanges.length;
            if (!hasAny) return null;
            return {
                importance: packetImportance(packet, 5),
                durability: packetImportance(packet, 5) >= 8 ? 'long' : 'medium',
                stableFacts: stableFacts.slice(0, 12),
                preferences: [],
                commitments: [],
                openLoops: openLoops.slice(0, 10),
                relationshipDeltas: relationshipDeltas.slice(0, 10),
                stateChanges: stateChanges.slice(0, 12),
                callbacks: callbacks.slice(0, 12)
            };
        };
        const buildMaintenancePayloadFromCanonicalPacket = (packet = {}, heuristic = {}, payload = {}, config = MemoryEngine.CONFIG) => {
            if (!hasCanonicalPacketKeys(packet)) return null;
            const meta = packetObject(packet.meta);
            const memory = packetObject(packet.memory);
            const narrative = packetObject(packet.narrative);
            const guidance = { ...packetObject(packet.guidance), ...packetObject(packet.guards) };
            const summaryMemory = packetObject(meta.summary_memory || meta.summaryMemory);
            const narrativeBrief = packetText(
                narrative.summary
                || narrative.scene_summary
                || narrative.sceneSummary
                || summaryMemory.one_line
                || summaryMemory.summary
                || memory.summary
                || packetTextList(memory.events, 2, 180).join(' / '),
                260
            );
            const guardrails = dedupeTextArray([
                ...packetTextList(guidance.continuity_locks || guidance.continuityLocks, 8, 160),
                ...packetTextList(guidance.audit_cautions || guidance.auditCautions, 6, 160)
            ]);
            const tensions = dedupeTextArray([
                ...packetTextList(narrative.conflict_traces || narrative.conflictTraces, 8, 160),
                ...packetTextList(guidance.unresolved_pressure || guidance.unresolvedPressure, 8, 160)
            ]);
            const nextBeats = dedupeTextArray([
                ...packetTextList(narrative.scene_deltas || narrative.sceneDeltas, 6, 160),
                ...packetTextList(narrative.unresolved_threads || narrative.unresolvedThreads, 4, 160)
            ]);
            const correction = isPacketObject(guidance.correction) ? sanitizeCorrectionPayloadLite(guidance.correction) : null;
            return {
                narrativeBrief: narrativeBrief || heuristic.narrativeBrief || '',
                correction,
                longTermMemory: buildLongTermMemoryFromCanonicalPacket(packet, payload, config),
                storyAuthor: {
                    ...(heuristic.storyAuthor || {}),
                    currentArc: packetText(narrative.current_arc || narrative.currentArc || narrative.arc || heuristic.storyAuthor?.currentArc || '', 120),
                    narrativeGoal: packetText(narrative.scene_phase || narrative.scenePhase || heuristic.storyAuthor?.narrativeGoal || '', 220),
                    activeTensions: tensions.length ? tensions : (heuristic.storyAuthor?.activeTensions || []),
                    nextBeats: nextBeats.length ? nextBeats : (heuristic.storyAuthor?.nextBeats || []),
                    guardrails: guardrails.length ? guardrails : (heuristic.storyAuthor?.guardrails || []),
                    focusCharacters: packetTextList(packet.entity?.focus || packet.entity?.active || payload.focusedEntities || [], 8, 80),
                    recentDecisions: packetTextList(narrative.recent_decisions || narrative.recentDecisions || [], 6, 160)
                },
                director: {
                    ...(heuristic.director || {}),
                    sceneMandate: packetText(narrative.scene_phase || narrative.scenePhase || heuristic.director?.sceneMandate || '', 220),
                    requiredOutcomes: packetTextList(guidance.consequence_notes || guidance.consequenceNotes || narrative.scene_deltas || narrative.sceneDeltas, 8, 160),
                    forbiddenMoves: packetTextList(guidance.overpromotion_risks || guidance.overpromotionRisks || guidance.audit_cautions || guidance.auditCautions, 8, 160),
                    emphasis: packetTextList(narrative.theme_motifs || narrative.themeMotifs || [], 8, 120),
                    targetPacing: heuristic.director?.targetPacing || '',
                    pressureLevel: heuristic.director?.pressureLevel || '',
                    focusCharacters: packetTextList(packet.entity?.focus || packet.entity?.active || payload.focusedEntities || [], 8, 80)
                },
                canonicalPacket: safeClone(packet)
            };
        };
        const mergeCanonicalPacketIntoMaintenancePayload = (maintenancePayload = null, packet = null, heuristic = {}, payload = {}, config = MemoryEngine.CONFIG) => {
            const base = maintenancePayload && typeof maintenancePayload === 'object' && !Array.isArray(maintenancePayload)
                ? safeClone(maintenancePayload)
                : {};
            if (!hasCanonicalPacketKeys(packet)) return Object.keys(base).length ? base : null;
            const packetMaintenance = buildMaintenancePayloadFromCanonicalPacket(packet, heuristic, payload, config) || {};
            const merged = {
                ...packetMaintenance,
                ...base,
                storyAuthor: {
                    ...(packetMaintenance.storyAuthor || {}),
                    ...(base.storyAuthor && typeof base.storyAuthor === 'object' ? base.storyAuthor : {})
                },
                director: {
                    ...(packetMaintenance.director || {}),
                    ...(base.director && typeof base.director === 'object' ? base.director : {})
                },
                canonicalPacket: safeClone(packet)
            };
            if (packetMaintenance.longTermMemory && base.longTermMemory && config?.rpLongTermMemoryEnabled !== false) {
                merged.longTermMemory = RPContinuityCore.mergeTurnMemory(packetMaintenance.longTermMemory, base.longTermMemory, {
                    turn: payload.turn,
                    entityRefs: payload.focusedEntities || [],
                    source: 'unified_canonical_packet'
                });
            }
            return merged;
        };
        const deriveEntityExtractionFromCanonicalPacket = (packet = null, payload = {}, options = {}) => {
            if (!hasCanonicalPacketKeys(packet)) return null;
            try {
                if (typeof EntityAwareProcessor !== 'undefined' && EntityAwareProcessor?.extractStructuredEntitySignalsFromPackets) {
                    return EntityAwareProcessor.extractStructuredEntitySignalsFromPackets(packet, {
                        lorebook: options?.lorebook || [],
                        conversationText: payload.canonicalEvidenceText || payload.aiResponse || '',
                        sourceText: payload.canonicalEvidenceText || payload.aiResponse || '',
                        sourceMessageId: options?.sourceMessageId || '',
                        turn: payload.turn || MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0
                    });
                }
            } catch (error) {
                if (MemoryEngine.CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA] Canonical packet entity adapter failed:', error?.message || error);
            }
            return {
                spans: [],
                entities: [],
                relations: [],
                world: {},
                conflicts: [],
                uncertain: [],
                rejected: [],
                sourceMode: 'structured_packet'
            };
        };

        const mergeUnifiedEntityExtractionWithPacketEvidence = (entityExtraction = null, packetExtraction = null) => {
            const base = entityExtraction && typeof entityExtraction === 'object' && !Array.isArray(entityExtraction)
                ? safeClone(entityExtraction)
                : {};
            const packet = packetExtraction && typeof packetExtraction === 'object' && !Array.isArray(packetExtraction)
                ? packetExtraction
                : null;
            if (!packet) return Object.keys(base).length ? base : null;
            const mergeByName = (left = [], right = []) => {
                const out = [];
                const seen = new Set();
                const push = (item) => {
                    if (!item || typeof item !== 'object') return;
                    const name = String(item.name || item.canonicalName || item.displayName || '').trim();
                    const key = name.toLowerCase();
                    if (!key || seen.has(key)) return;
                    seen.add(key);
                    out.push(item);
                };
                (Array.isArray(left) ? left : []).forEach(push);
                (Array.isArray(right) ? right : []).forEach(push);
                return out;
            };
            const mergeRelations = (left = [], right = []) => {
                const out = [];
                const seen = new Set();
                const push = (item) => {
                    if (!item || typeof item !== 'object') return;
                    const a = String(item.entityA || item.nameA || item.a || item.from || '').trim();
                    const b = String(item.entityB || item.nameB || item.b || item.to || '').trim();
                    if (!a || !b || a === b) return;
                    const key = [a, b].sort().join('::').toLowerCase();
                    if (!key || seen.has(key)) return;
                    seen.add(key);
                    out.push(item);
                };
                (Array.isArray(left) ? left : []).forEach(push);
                (Array.isArray(right) ? right : []).forEach(push);
                return out;
            };
            const mergeWorld = (left = {}, right = {}) => {
                if (!right || typeof right !== 'object' || Array.isArray(right)) return left && typeof left === 'object' ? left : {};
                if (!left || typeof left !== 'object' || Array.isArray(left)) return safeClone(right);
                return { ...safeClone(right), ...safeClone(left) };
            };
            base.entities = mergeByName(base.entities, packet.entities);
            base.relations = mergeRelations(base.relations, packet.relations);
            base.world = mergeWorld(base.world, packet.world);
            base.conflicts = [
                ...(Array.isArray(base.conflicts) ? base.conflicts : []),
                ...(Array.isArray(packet.conflicts) ? packet.conflicts : [])
            ];
            base.uncertain = [
                ...(Array.isArray(base.uncertain) ? base.uncertain : []),
                ...(Array.isArray(packet.uncertain) ? packet.uncertain : [])
            ];
            base.rejected = [
                ...(Array.isArray(base.rejected) ? base.rejected : []),
                ...(Array.isArray(packet.rejected) ? packet.rejected : [])
            ];
            base.packetEvidenceEntities = mergeByName(base.packetEvidenceEntities, packet.entities);
            base.sourceMode = base.sourceMode || packet.sourceMode || 'structured_packet';
            base.packetEvidenceMerged = true;
            return base;
        };

        const run = async (currentTurn, turnState, aiResponse, effectiveLore = [], config = MemoryEngine.CONFIG) => {
            const profile = (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux'))
                ? resolveAnalysisProfile(config)
                : null;
            const payload = buildPayload(currentTurn, turnState, aiResponse, effectiveLore, config);
            const heuristic = buildHeuristicBundle(payload, config);
            if (!profile) return heuristic;

            try {
                const includeRpLongTermLlm = config?.rpLongTermMemoryEnabled !== false && config?.rpLongTermLlmEnrichment !== false;
                const responseShape = getMaintenanceResponseShape(includeRpLongTermLlm);
                const system = [
                    'You are LIBRA Turn Maintenance Optimizer.',
                    'Combine turn correction and narrative briefing in one pass.',
                    includeRpLongTermLlm
                        ? 'Also produce compact story-author planning, director supervision, and durable RP long-term memory for the next response when available.'
                        : 'Also produce compact story-author planning and director supervision for the next response when available.',
                    'Do not invent canon. Only fix clear extraction mistakes and keep guidance compact and actionable.',
                    payload.evidencePolicy,
                    includeRpLongTermLlm ? `For longTermMemory, record only facts directly supported by ${payload.evidenceLabel}. Omit transient prose, uncertain guesses, generic mood, and duplicates.` : '',
                    includeRpLongTermLlm ? 'Treat stable identity/family/occupation facts, explicit preferences or boundaries, promises, unresolved goals, irreversible state changes, relationship milestones, and callback objects as durable.' : '',
                    includeRpLongTermLlm ? 'Use visibility=secret or visibility=pov for undisclosed information; never convert hidden knowledge into public canon.' : '',
                    includeRpLongTermLlm
                        ? 'If correction is unnecessary, return null for correction. Empty long-term categories must be arrays.'
                        : 'If correction is unnecessary, return null for correction.',
                    'Respond only as JSON with this shape:',
                    responseShape,
                    'Top-level keys must match this shape directly. Never wrap the result in data/result/output/message/status/done. A JSON object with only status/done/message is invalid.'
                ].filter(Boolean).join('\n');
                const user = [
                    `Turn: ${payload.turn}`,
                    payload.evidenceText ? `[${payload.evidenceLabel}]\n${payload.evidenceText}` : `[${payload.evidenceLabel}]\n(empty)`,
                    `[Current Extracted State]\n${JSON.stringify(payload.extracted, null, 2)}`,
                    payload.worldPrompt ? `World:\n${payload.worldPrompt}` : '',
                    payload.worldStatePrompt ? `World State:\n${payload.worldStatePrompt}` : '',
                    payload.narrativePrompt ? `Narrative:\n${payload.narrativePrompt}` : '',
                    payload.currentStoryAuthorPrompt ? `Existing Story Author:\n${payload.currentStoryAuthorPrompt}` : '',
                    payload.currentDirectorPrompt ? `Existing Director:\n${payload.currentDirectorPrompt}` : '',
                    payload.entityTexts.length ? `Entities:\n${payload.entityTexts.join('\n\n')}` : '',
                    payload.relationTexts.length ? `Relations:\n${payload.relationTexts.join('\n\n')}` : '',
                    payload.charStateTexts.length ? `Character States:\n${payload.charStateTexts.join('\n\n')}` : '',
                    payload.recentTurns.length ? `Recent Turns:\n${payload.recentTurns.join('\n')}` : '',
                    payload.memoryEntries.length ? `Important Memories:\n- ${payload.memoryEntries.join('\n- ')}` : '',
                    payload.loreSnippets.length ? `Lorebook Hints:\n- ${payload.loreSnippets.join('\n- ')}` : ''
                ].filter(Boolean).join('\n\n');
                const result = await runMaintenanceLLM(() =>
                    LLMProvider.call(config, system, user, { maxTokens: includeRpLongTermLlm ? 2400 : 1800, profile, label: `turn-maintenance-bundle-${profile}` }),
                `turn-maintenance-bundle-${currentTurn}`);
                const parsed = parseTurnMaintenanceJson(result?.content || '', includeRpLongTermLlm);
                if (!parsed) {
                    recordRuntimeDebug('warn', '[LIBRA] Turn maintenance bundle returned invalid JSON shape; using heuristic fallback.', {
                        __libraDebugMeta: true,
                        label: 'turn-maintenance-invalid-json',
                        preview: truncateForLLM(result?.content || '', 260, ' ... ')
                    });
                    return heuristic;
                }
                return normalizeMaintenanceBundleResult(parsed, heuristic, payload, config);
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Turn maintenance bundle failed:', e?.message || e);
                return heuristic;
            }
        };

        const runUnified = async (currentTurn, turnState, aiResponse, effectiveLore = [], config = MemoryEngine.CONFIG, options = {}) => {
            const profile = (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux'))
                ? resolveAnalysisProfile(config)
                : null;
            if (!profile) return null;
            const payload = buildPayload(currentTurn, turnState, aiResponse, effectiveLore, config);
            const heuristic = buildHeuristicBundle(payload, config);
            const includeRpLongTermLlm = config?.rpLongTermMemoryEnabled !== false && config?.rpLongTermLlmEnrichment !== false;
            const maintenanceShape = getMaintenanceResponseShape(includeRpLongTermLlm);
            const memoryHintBlock = String(options?.entityMemoryHintBlock || '').trim();
            const characterEntityHintBlock = String(options?.characterEntityHintBlock || '').trim();
            const entityStoredInfo = String(options?.entityStoredInfo || '').trim() || 'none';
            const entityShape = '{"spans":[],"entities":[],"relations":[],"world":{},"conflicts":[],"uncertain":[],"rejected":[]}';
            const canonicalPacketShape = '{"meta":{"summary_memory":{"summary":"","recall":""},"node_memory":{"nodes":[]},"audit_cautions":[],"overpromotion_risks":[]},"memory":{"events":[{"summary":"","entities":[],"time":"","location":"","evidence":"","importance":0.0,"confidence":0.0}],"facts":[]},"entity":{"characters":[],"relations":[],"pov_memories":[],"secrets":[],"current_state":[]},"world":{"time":"","location":"","scene":"","rules":[],"places":[],"organizations":[],"social_rules":[],"phenomena":[],"systems":{},"physics":{},"exists":{},"active_events":[],"offscreen_threads":[],"state":{"time":"","location":"","scene":"","active_events":[],"offscreen_threads":[]}},"narrative":{"scene_phase":"","conflict_traces":[],"scene_deltas":[],"theme_motifs":[],"unresolved_threads":[]},"guards":{"continuity_locks":[],"audit_cautions":[],"overpromotion_risks":[]},"importance":{"overall":0.0,"reason":[]}}';
            try {
                const system = [
                    'You are LIBRA AfterRequest Unified Analysis.',
                    'Use the RE Companion V2 packet-commit style: one analysis produces one canonicalPacket, and every storage axis is derived from that packet.',
                    'Return one JSON object with top-level keys exactly: canonicalPacket, entityExtraction, maintenance.',
                    'Never wrap the object in data/result/output/message/status/done. A status-only object is invalid and will be discarded.',
                    payload.evidencePolicy,
                    'canonicalPacket: summarize the current turn once across memory, entity, world, narrative, and guards. Keep current-turn evidence chronological and do not collapse memory into prose-only canon.',
                    'Axis ownership rule: memory.events/facts are chronological recall records; entity owns characters, relations, POV/private knowledge, secrets, and current states; world owns persistent setting fields, places/facilities, organizations, social rules, systems, physics, phenomena, and current world state; put current time/location/scene under world.state, not persistent world rules; narrative owns scene phase, conflict traces, scene deltas, motifs, and unresolved threads; guards owns continuity locks, audit cautions, and overpromotion risks.',
                    'Record each fact in the most specific axis. Do not duplicate the same fact across axes except for a short memory event anchor.',
                    `entityExtraction: compatibility projection from canonicalPacket.entity/world. Perform span-grounded NER-style extraction for ${payload.evidenceLabel}. Extract only directly supported person/character entities, relations, and world changes. Do not invent names or canon.`,
                    'maintenance: compatibility projection from canonicalPacket.memory/narrative/guards. Produce compact turn correction, narrative brief, durable RP long-term memory, story-author planning, and director supervision when available.',
                    'Do not expose hidden/pov information as public canon. If correction is unnecessary, use null.',
                    'Treat guards and guidance as continuity constraints or audit notes, not direct instructions to the next assistant response.',
                    'If evidence is weak, leave arrays empty or lower confidence instead of promoting a fact.',
                    'Return JSON only. No markdown.',
                    `canonicalPacket shape: ${canonicalPacketShape}`,
                    `entityExtraction shape: ${entityShape}`,
                    `maintenance shape: ${maintenanceShape}`
                ].join('\n');
                const user = [
                    `Turn: ${payload.turn}`,
                    payload.evidenceText ? `[${payload.evidenceLabel}]\n${payload.evidenceText}` : `[${payload.evidenceLabel}]\n(empty)`,
                    `[Known LIBRA Entity State]\n${entityStoredInfo}`,
                    characterEntityHintBlock ? `[External Stable Entity Cues]\n${characterEntityHintBlock}` : '',
                    memoryHintBlock ? `[Long-Term Memory Cues]\n${memoryHintBlock}` : '',
                    payload.worldPrompt ? `[World]\n${payload.worldPrompt}` : '',
                    payload.worldStatePrompt ? `[World State]\n${payload.worldStatePrompt}` : '',
                    payload.narrativePrompt ? `[Narrative]\n${payload.narrativePrompt}` : '',
                    payload.currentStoryAuthorPrompt ? `[Existing Story Author]\n${payload.currentStoryAuthorPrompt}` : '',
                    payload.currentDirectorPrompt ? `[Existing Director]\n${payload.currentDirectorPrompt}` : '',
                    payload.entityTexts.length ? `[Existing Focus Entities]\n${payload.entityTexts.join('\n\n')}` : '',
                    payload.relationTexts.length ? `[Existing Relations]\n${payload.relationTexts.join('\n\n')}` : '',
                    payload.charStateTexts.length ? `[Character States]\n${payload.charStateTexts.join('\n\n')}` : '',
                    payload.recentTurns.length ? `[Recent Turns]\n${payload.recentTurns.join('\n')}` : '',
                    payload.memoryEntries.length ? `[Important Memories]\n- ${payload.memoryEntries.join('\n- ')}` : '',
                    payload.loreSnippets.length ? `[Lorebook Hints]\n- ${payload.loreSnippets.join('\n- ')}` : ''
                ].filter(Boolean).join('\n\n');
                if (config?.debug) {
                    recordRuntimeDebug('log', '[LIBRA] Unified afterRequest analysis prompt budget:', {
                        analysisEvidenceMode: payload.analysisEvidenceMode,
                        analysisIncludesUserInput: payload.analysisIncludesUserInput,
                        evidenceLabel: payload.evidenceLabel,
                        systemChars: system.length,
                        userChars: user.length,
                        userEvidenceChars: String(payload.userMsg || payload.userRequestMetadata || '').length,
                        assistantEvidenceChars: String(payload.assistantEvidenceText || payload.aiResponse || '').length,
                        canonicalEvidenceChars: String(payload.canonicalEvidenceText || payload.evidenceText || '').length,
                        entityStoredChars: entityStoredInfo.length,
                        characterHintChars: characterEntityHintBlock.length,
                        memoryHintChars: memoryHintBlock.length
                    });
                }
                const result = await runMaintenanceLLM(() =>
                    LLMProvider.call(config, system, user, {
                        maxTokens: 20000,
                        profile,
                        label: `afterrequest-analysis-bundle-${profile}`
                    }),
                `afterrequest-analysis-bundle-${currentTurn}`);
                const parsed = parseUnifiedAfterRequestJson(result?.content || '');
                if (!parsed) {
                    recordRuntimeDebug('warn', '[LIBRA] Unified afterRequest analysis returned invalid JSON shape; falling back to split analysis.', {
                        __libraDebugMeta: true,
                        label: 'unified-afterrequest-invalid-json',
                        preview: truncateForLLM(result?.content || '', 260, ' ... ')
                    });
                    return null;
                }
                const canonicalPacket = extractUnifiedCanonicalPacket(parsed);
                let entityExtraction = extractUnifiedEntityPayload(parsed);
                let entitySourceMode = 'afterrequest_unified_analysis';
                if (canonicalPacket) {
                    const packetEntityExtraction = deriveEntityExtractionFromCanonicalPacket(canonicalPacket, payload, {
                        lorebook: effectiveLore,
                        sourceMessageId: options?.sourceMessageId || options?.messageId || ''
                    });
                    if (!entityExtraction) {
                        entityExtraction = packetEntityExtraction;
                        entitySourceMode = 'structured_packet';
                    } else {
                        entityExtraction = mergeUnifiedEntityExtractionWithPacketEvidence(entityExtraction, packetEntityExtraction);
                        entityExtraction.sourceMode = entityExtraction.sourceMode || 'structured_packet';
                        entitySourceMode = entityExtraction.sourceMode || 'structured_packet';
                    }
                }
                const compat = parsed?.compat && typeof parsed.compat === 'object' && !Array.isArray(parsed.compat) ? parsed.compat : {};
                const rawMaintenancePayload = parsed.maintenance && typeof parsed.maintenance === 'object'
                    ? parsed.maintenance
                    : (compat.maintenance && typeof compat.maintenance === 'object' ? compat.maintenance : null);
                const maintenancePayload = mergeCanonicalPacketIntoMaintenancePayload(
                    rawMaintenancePayload,
                    canonicalPacket,
                    heuristic,
                    payload,
                    config
                );
                if (!entityExtraction && !maintenancePayload) return null;
                if (!entityExtraction) {
                    entityExtraction = {
                        spans: [],
                        entities: [],
                        relations: [],
                        world: {},
                        conflicts: [],
                        uncertain: [],
                        rejected: [],
                        sourceMode: entitySourceMode
                    };
                }
                const unifiedEntityNames = dedupeTextArray([
                    ...(Array.isArray(payload.focusedEntities) ? payload.focusedEntities : []),
                    ...(Array.isArray(entityExtraction.entities) ? entityExtraction.entities.map(entity => entity?.name).filter(Boolean) : [])
                ]).slice(0, 12);
                const unifiedPayload = { ...payload, focusedEntities: unifiedEntityNames };
                const normalizedMaintenance = normalizeMaintenanceBundleResult(maintenancePayload, heuristic, unifiedPayload, config);
                if (canonicalPacket && !normalizedMaintenance.canonicalPacket) {
                    normalizedMaintenance.canonicalPacket = safeClone(canonicalPacket);
                }
                return {
                    entityExtraction,
                    maintenance: normalizedMaintenance,
                    canonicalPacket,
                    entitySourceMode,
                    profile,
                    label: `afterrequest-analysis-bundle-${profile}`
                };
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Unified afterRequest analysis failed; falling back to split analysis:', e?.message || e);
                return null;
            }
        };

        return { run, runUnified };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Section World Inference
    // ══════════════════════════════════════════════════════════════
    const SectionWorldInferenceManager = (() => {
        let cache = {
            key: '',
            prompt: '',
            title: '',
            activeRules: [],
            scenePressures: [],
            sourceRefs: []
        };

        const isSceneLensSourceWrapperLine = (line = '') => {
            const text = String(line || '').trim();
            if (!text) return true;
            if (/^\[?(Character Description and Character Lorebook|Character Description|Character Lorebook|Character Name|Character Personality|Scenario|First Message|Creator Notes|Default Variables)\]?/i.test(text)) return true;
            if (/^\[?(현재 세계 규칙\s*\/\s*Current World Rules|Current World Rules|World Structure|World|세계관 구조|현재 위치|Active World Rules|Character\/Lorebook World Cues|Memory World Cues|Scene Pressures|Scene Focus)\]?$/i.test(text)) return true;
            if (/^#\s*(Roleplay setting|World Settings|Relationships?)\b/i.test(text)) return true;
            if (/^<\/?(World Settings|.+ Start|.+ End)>$/i.test(text)) return true;
            if (/^\.\.\.\[TRUNCATED/i.test(text) || /\[TRUNCATED(?: CHARACTER WORLD SOURCES)?\]/i.test(text)) return true;
            return false;
        };

        const collectCueLines = (value, limit = 6, maxChars = 220, options = {}) => {
            const raw = String(value || '').trim();
            if (!raw) return [];
            const { excludeSourceWrappers = false } = options || {};
            const lines = raw
                .replace(/\r/g, '\n')
                .split('\n')
                .flatMap(line => splitImportedWorldRuleFragments(line))
                .map(line => String(line || '')
                    .replace(/^[\s\-*•·▶▷☞]+/, '')
                    .replace(/^[0-9]+[.)]\s*/, '')
                    .trim())
                .filter(line => {
                    if (!line) return false;
                    if (excludeSourceWrappers && isSceneLensSourceWrapperLine(line)) return false;
                    if (/^[\[\]【】#\s\/A-Za-z가-힣]+$/.test(line) && line.length < 28) return false;
                    if (/^(World|World Structure|Current World Rules|세계관 구조|현재 세계 규칙|현재 위치)$/i.test(line)) return false;
                    return true;
                })
                .map(line => truncateForLLM(line, maxChars, ' ... '))
                .filter(Boolean);
            return dedupeTextArray(lines).slice(0, limit);
        };

        const isLikelyLoreSourceExcerpt = (line = '') => {
            const text = String(line || '').trim();
            if (!text) return true;
            if (isSceneLensSourceWrapperLine(text)) return true;
            if (/^(Absolute rule|Information):/i.test(text) && text.length > 140) return true;
            if (/^(Character Description|Character Lorebook|Character Name|Roleplay setting|World Settings)/i.test(text)) return true;
            if (/\{\{Char\}\}|co \.\.\.|\.\.\.\[TRUNCATED\]/i.test(text)) return true;
            return false;
        };

        const buildLoreWorldCueLines = (loreHints = [], limit = 5) => {
            const raw = (Array.isArray(loreHints) ? loreHints : [loreHints])
                .map(item => String(item || '').trim())
                .filter(Boolean)
                .join('\n');
            if (!raw) return [];
            const candidateLines = collectCueLines(raw, Math.max(limit * 3, 12), 180, { excludeSourceWrappers: true });
            return dedupeTextArray(candidateLines
                .map(line => String(line || '').trim())
                .filter(line => line && !isLikelyLoreSourceExcerpt(line)))
                .slice(0, limit);
        };

        const classifyWorldRuleLines = (lines = []) => lines.filter(line =>
            /(수동 보정|User Correction|분류|Classification|요약|Summary|설명|Description|존재|Exists|부재|Absent|시스템|Systems|비활성|Inactive|기술|Technology|중력|Gravity|시간|Time|공간|Space|현상|Phenomena|규칙|Rules|마법|Magic|초자연|Supernatural|레벨|Level|스킬|Skill|스탯|Stats|길드|Guild|세력|Faction)/i.test(String(line || ''))
        );

        const buildFallbackPrompt = (payload) => {
            const focusCharacters = Array.isArray(payload?.focusCharacters)
                ? payload.focusCharacters.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8)
                : [];
            const memoryHints = Array.isArray(payload?.memoryHints)
                ? payload.memoryHints.map(item => truncateForLLM(String(item || '').trim(), 500, ' ...[TRUNCATED]... ')).filter(Boolean).slice(0, 4)
                : [];
            const loreHints = Array.isArray(payload?.loreHints)
                ? payload.loreHints.map(item => truncateForLLM(String(item || '').trim(), 900, ' ...[TRUNCATED]... ')).filter(Boolean).slice(0, 4)
                : [];

            const worldLines = collectCueLines(payload.worldPrompt, 14, 240, { excludeSourceWrappers: true });
            const worldRuleLines = classifyWorldRuleLines(worldLines)
                .filter(line => !isLikelyLoreSourceExcerpt(line))
                .slice(0, 7);
            const worldStateLines = collectCueLines(payload.worldStatePrompt, 4, 220, { excludeSourceWrappers: true });
            const narrativeLines = collectCueLines(payload.narrativePrompt, 4, 220, { excludeSourceWrappers: true });
            const loreCueLines = buildLoreWorldCueLines(loreHints, 5);
            const activeRules = dedupeTextArray([
                ...worldRuleLines
            ]).slice(0, 7);
            const scenePressures = dedupeTextArray([
                ...worldStateLines,
                ...narrativeLines,
                ...memoryHints.slice(0, 2)
            ]).slice(0, 6);
            const sourceRefs = [];
            if (payload.worldPrompt) sourceRefs.push('세계관 트리/현재 규칙');
            if (payload.worldStatePrompt) sourceRefs.push('세계관 상태');
            if (payload.narrativePrompt) sourceRefs.push('내러티브');
            if (memoryHints.length > 0) sourceRefs.push('관련 기억');
            if (loreHints.length > 0) sourceRefs.push('캐릭터 설명/로어북');
            if (focusCharacters.length > 0) sourceRefs.push('초점 엔티티');
            if (payload.canonicalEvidenceText || payload.aiResponse) sourceRefs.push(payload.analysisIncludesUserInput ? '현재 턴 증거' : 'assistant 정본 응답');

            const parts = [
                '[Active Scene Lens / 현재 장면 세계관 보정]',
                'This is a compact selection of existing LIBRA world context, not a new world definition.',
                'Use it to keep the current scene aligned with stored world rules and active continuity.'
            ];
            if (activeRules.length > 0) {
                parts.push('\n[Active World Rules]');
                parts.push(...activeRules.map(rule => `- ${rule}`));
            } else if (payload.worldPrompt) {
                parts.push('\n[Active World Rules]');
                parts.push('- Follow the established world structure and current world rules already provided.');
            }
            if (scenePressures.length > 0) {
                parts.push('\n[Scene Pressures]');
                parts.push(...scenePressures.map(item => `- ${item}`));
            }
            if (focusCharacters.length > 0) {
                parts.push('\n[Scene Focus]');
                parts.push(`- Keep the scene grounded around: ${focusCharacters.join(', ')}.`);
            }
            if (loreCueLines.length > 0) {
                parts.push('\n[Character/Lorebook World Cues]');
                parts.push(...loreCueLines.map(item => `- ${item}`));
            }
            if (memoryHints.length > 0) {
                parts.push('\n[Memory World Cues]');
                parts.push(...memoryHints.slice(0, 4).map(item => `- ${item}`));
            }
            parts.push('\n[Use Policy]');
            parts.push('- Manual world correction and stored current world rules outrank inferred hints from memories or lorebook fragments.');
            parts.push('- Use memory/lore cues only to clarify the active scene; do not rewrite persistent world rules from this lens alone.');
            if (payload.canonicalEvidenceText || payload.aiResponse) parts.push(`- Select only the rules relevant to ${payload.evidenceLabel || 'Canonical Assistant Evidence'} before escalating any world element.`);

            return {
                title: 'Active Scene Lens',
                prompt: parts.join('\n'),
                activeRules,
                scenePressures,
                sourceRefs: dedupeTextArray(sourceRefs)
            };
        };

        const inferPrompt = async (config, payload) => {
            if (config?.sectionWorldInferenceEnabled === false) return '';
            const hasMemoryHints = Array.isArray(payload?.memoryHints) && payload.memoryHints.some(item => String(item || '').trim());
            const hasLoreHints = Array.isArray(payload?.loreHints) && payload.loreHints.some(item => String(item || '').trim());
            if (!payload?.worldPrompt && !payload?.worldStatePrompt && !payload?.narrativePrompt && !hasMemoryHints && !hasLoreHints) return '';

            const cacheKey = TokenizerEngine.simpleHash(JSON.stringify({
                scopeKey: payload.scopeKey || payload.scopeId || '',
                chatId: payload.chatId || '',
                turn: payload.turn,
                canonicalEvidenceHash: TokenizerEngine.simpleHash(payload.canonicalEvidenceText || payload.aiResponse || ''),
                worldPrompt: payload.worldPrompt,
                worldStatePrompt: payload.worldStatePrompt,
                narrativePrompt: payload.narrativePrompt,
                directorPrompt: payload.directorPrompt,
                storyAuthorPrompt: payload.storyAuthorPrompt,
                focusCharacters: payload.focusCharacters,
                memoryHints: payload.memoryHints,
                loreHints: payload.loreHints
            }));
            if (cache.key === cacheKey && cache.prompt) return cache.prompt;

            const fallback = buildFallbackPrompt(payload);
            cache = { key: cacheKey, ...fallback };
            return fallback.prompt;
        };

        const getLastMeta = () => ({
            title: cache.title || '',
            activeRules: Array.isArray(cache.activeRules) ? cache.activeRules.slice(0, 5) : [],
            scenePressures: Array.isArray(cache.scenePressures) ? cache.scenePressures.slice(0, 5) : [],
            sourceRefs: Array.isArray(cache.sourceRefs) ? cache.sourceRefs.slice(0, 6) : []
        });
        const getLastPrompt = () => String(cache.prompt || '').trim();
        const getState = () => ({
            key: String(cache.key || ''),
            prompt: String(cache.prompt || ''),
            title: String(cache.title || ''),
            activeRules: Array.isArray(cache.activeRules) ? cache.activeRules.slice(0, 5) : [],
            scenePressures: Array.isArray(cache.scenePressures) ? cache.scenePressures.slice(0, 5) : [],
            sourceRefs: Array.isArray(cache.sourceRefs) ? cache.sourceRefs.slice(0, 6) : []
        });
        const loadState = (nextState = null) => {
            cache = {
                key: String(nextState?.key || ''),
                prompt: String(nextState?.prompt || ''),
                title: String(nextState?.title || ''),
                activeRules: Array.isArray(nextState?.activeRules) ? nextState.activeRules.map(String).filter(Boolean).slice(0, 5) : [],
                scenePressures: Array.isArray(nextState?.scenePressures) ? nextState.scenePressures.map(String).filter(Boolean).slice(0, 5) : [],
                sourceRefs: Array.isArray(nextState?.sourceRefs) ? nextState.sourceRefs.map(String).filter(Boolean).slice(0, 6) : []
            };
            return getState();
        };

        const resetState = () => {
            cache = { key: '', prompt: '', title: '', activeRules: [], scenePressures: [], sourceRefs: [] };
            return cache;
        };

        return { inferPrompt, getLastMeta, getLastPrompt, getState, loadState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Character State Tracker
    // ══════════════════════════════════════════════════════════════
    const CharacterStateTracker = (() => {
        const STATE_COMMENT = 'lmai_char_states';
        const CONSOLIDATION_INTERVAL = 5;

        let stateHistory = {};
        const normalizeCharacterStateMood = (value = '') => {
            try {
                return EntityManager.normalizeMoodText?.(value, 8) || String(value || '').trim();
            } catch {
                return String(value || '').replace(/\s+/g, ' ').trim();
            }
        };
        const normalizeCharacterStateNotes = (value = '') => dedupeTextArray(
            String(value || '')
                .split('|')
                .map(item => String(item || '').replace(/\s+/g, ' ').trim())
                .filter(item => item && !/^Auto-corrected:/i.test(item))
        ).join(' | ');
        const normalizeCharacterStateLog = (entry = {}) => ({
            ...entry,
            turn: Number(entry?.turn || 0) || 0,
            timestamp: Number(entry?.timestamp || Date.now()) || Date.now(),
            location: String(entry?.location || '').replace(/\s+/g, ' ').trim(),
            mood: normalizeCharacterStateMood(entry?.mood || ''),
            health: String(entry?.health || '').replace(/\s+/g, ' ').trim(),
            notes: normalizeCharacterStateNotes(entry?.notes || '')
        });
        const normalizeCharacterStateHistory = (raw = {}) => {
            const next = {};
            for (const [name, history] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
                const key = String(name || '').trim();
                if (!key) continue;
                const source = history && typeof history === 'object' ? history : {};
                next[key] = {
                    turnLog: (Array.isArray(source.turnLog) ? source.turnLog : [])
                        .map(normalizeCharacterStateLog)
                        .filter(entry => entry.turn > 0)
                        .slice(-30),
                    consolidated: (Array.isArray(source.consolidated) ? source.consolidated : []).slice(-20),
                    lastConsolidationTurn: Number(source.lastConsolidationTurn || 0) || 0
                };
            }
            return next;
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === STATE_COMMENT);
            if (entry) {
                try { stateHistory = normalizeCharacterStateHistory(JSON.parse(entry.content)); } catch (e) { recordRuntimeDebug('warn', '[LIBRA] Char state parse failed:', e?.message); }
            }
            return stateHistory;
        };

        const saveState = async (lorebook) => {
            stateHistory = normalizeCharacterStateHistory(stateHistory);
            const entry = {
                key: LibraLoreKeys.charStates(),
                comment: STATE_COMMENT,
                content: JSON.stringify(stateHistory),
                mode: 'normal',
                insertorder: 6,
                alwaysActive: false
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
                mood: normalizeCharacterStateMood(stateSnapshot.currentMood || ''),
                health: stateSnapshot.healthStatus || '',
                notes: normalizeCharacterStateNotes(stateSnapshot.notes || '')
            });
            if (history.turnLog.length > 30) {
                history.turnLog = history.turnLog.slice(-30);
            }
        };
        const replaceState = (entityName, turn, stateSnapshot) => {
            if (!stateHistory[entityName]) {
                stateHistory[entityName] = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            }
            const history = stateHistory[entityName];
            const targetTurn = Number(turn || 0);
            const existingIdx = history.turnLog.findIndex(item => Number(item?.turn || 0) === targetTurn);
            const nextEntry = {
                turn: targetTurn,
                timestamp: Date.now(),
                location: stateSnapshot.currentLocation || '',
                mood: normalizeCharacterStateMood(stateSnapshot.currentMood || ''),
                health: stateSnapshot.healthStatus || '',
                notes: normalizeCharacterStateNotes(stateSnapshot.notes || '')
            };
            if (existingIdx >= 0) history.turnLog[existingIdx] = nextEntry;
            else history.turnLog.push(nextEntry);
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

        const getConsolidationCandidate = (entityName, currentTurn) => {
            const name = String(entityName || '').trim();
            const history = stateHistory[name];
            if (!history) return;
            if (currentTurn - history.lastConsolidationTurn < CONSOLIDATION_INTERVAL) return;

            const recentLogs = history.turnLog.filter(
                t => t.turn > history.lastConsolidationTurn
            );
            if (recentLogs.length < 3) return;
            const logText = recentLogs.map(l =>
                `Turn ${l.turn}: Location=${l.location}, Mood=${l.mood}, Health=${l.health}${l.notes ? ', Notes=' + l.notes : ''}`
            ).join('\n');
            return {
                type: 'character',
                name,
                currentTurn: Number(currentTurn || 0),
                recentLogs: safeClone(recentLogs),
                logText
            };
        };

        const trimConsolidatedHistory = (history) => {
            if (!history) return;
            if (history.consolidated.length > 20) {
                history.consolidated = history.consolidated.slice(-20);
            }
        };

        const applyConsolidationResult = (entityName, currentTurn, result = {}) => {
            const name = String(entityName || '').trim();
            const history = stateHistory[name];
            if (!history) return false;
            const rawChanges = Array.isArray(result?.significantChanges)
                ? result.significantChanges
                : (Array.isArray(result?.changes) ? result.changes : (result?.changes ? [result.changes] : []));
            const changes = dedupeTextArray(
                rawChanges
                    .map(item => String(item || '').trim())
                    .filter(Boolean)
            ).slice(0, 8);
            const summary = truncateForLLM(String(result?.summary || result?.description || '').trim(), 360, ' ... ');
            if (summary || changes.length > 0) {
                history.consolidated.push({
                    turn: Number(currentTurn || 0),
                    type: 'periodic',
                    description: summary,
                    changes,
                    timestamp: Date.now()
                });
            }
            history.lastConsolidationTurn = Number(currentTurn || 0);
            trimConsolidatedHistory(history);
            return true;
        };

        const applyConsolidationFallback = (entityName, currentTurn) => {
            const candidate = getConsolidationCandidate(entityName, currentTurn);
            if (!candidate) return false;
            const last = candidate.recentLogs[candidate.recentLogs.length - 1] || {};
            return applyConsolidationResult(candidate.name, currentTurn, {
                summary: `Location: ${last.location || ''}, Mood: ${last.mood || ''}, Health: ${last.health || ''}`,
                significantChanges: []
            });
        };

        const consolidateIfNeeded = async (entityName, currentTurn, config) => {
            const candidate = getConsolidationCandidate(entityName, currentTurn);
            if (!candidate) return;
            const history = stateHistory[candidate.name];

            if (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux')) {
                try {
                    const result = await runMaintenanceLLM(() =>
                        LLMProvider.call(config,
                            'Summarize the character state changes below. Note significant changes. Respond in the same language as the content.\nOutput JSON: {"summary": "...", "significantChanges": ["..."]}',
                            `Character: ${candidate.name}\nState log:\n${candidate.logText}`,
                            { maxTokens: 300, profile: resolveAnalysisProfile(config), label: `char-state-${candidate.name}` }
                        )
                    , `char-state-${candidate.name}`);

                    if (result.content) {
                        const cleanedContent = Utils.stripLLMThinkingTags(result.content);
                        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            applyConsolidationResult(candidate.name, currentTurn, parsed);
                        }
                    }
                    history.lastConsolidationTurn = currentTurn;
                } catch (e) {
                    recordRuntimeDebug('warn', '[LIBRA] Char state consolidation failed:', e?.message);
                }
            } else {
                applyConsolidationFallback(candidate.name, currentTurn);
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

        const getCharacterStateLookupKeys = (value = '') => {
            const text = String(value || '').trim();
            if (!text) return [];
            const keys = [text];
            const noParen = text.replace(/\([^)]*\)/g, '').trim();
            if (noParen && noParen !== text) keys.push(noParen);
            for (const match of text.matchAll(/\(([^)]{2,80})\)/g)) {
                if (match?.[1]) keys.push(match[1].trim());
            }
            const korean = text.match(/[가-힣]{2,}/g);
            if (korean) keys.push(...korean);
            return dedupeTextArray(keys)
                .map(item => String(item || '').trim())
                .filter(Boolean);
        };

        const findCharacterStateHistory = (entityName = '') => {
            const directName = String(entityName || '').trim();
            if (directName && stateHistory[directName]) return stateHistory[directName];
            const lookupKeys = new Set(getCharacterStateLookupKeys(directName).map(key => key.toLowerCase()));
            if (lookupKeys.size === 0) return null;
            for (const [key, history] of Object.entries(stateHistory || {})) {
                const keyVariants = getCharacterStateLookupKeys(key).map(item => item.toLowerCase());
                if (keyVariants.some(item => lookupKeys.has(item))) return history;
            }
            return null;
        };

        const formatForPrompt = (entityName) => {
            const history = findCharacterStateHistory(entityName);
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
                    if (l.notes) segments.push(l.notes);
                    return `T${l.turn}: ${segments.join(', ')}`;
                }).join(' → ');
                parts.push(`  Recent States: ${stateStr}`);
            }

            return parts.join('\n');
        };

        const formatForPromptAny = (entityNames = []) => {
            const candidates = Array.isArray(entityNames) ? entityNames : [entityNames];
            for (const candidate of candidates) {
                const text = formatForPrompt(candidate);
                if (text) return text;
            }
            return '';
        };

        const renameEntityKey = (oldName = '', newName = '', options = {}) => {
            const oldText = String(oldName || '').trim();
            const newText = String(newName || '').trim();
            if (!oldText || !newText || oldText === newText) return { changed: false };
            const candidates = [oldText, ...(Array.isArray(options.previousNames) ? options.previousNames : [])]
                .map(value => String(value || '').trim())
                .filter(Boolean);
            const keys = Object.keys(stateHistory || {});
            const matchedKeys = keys.filter(key => candidates.some(candidate => key === candidate));
            if (!matchedKeys.length) return { changed: false };
            const mergeHistory = (target = {}, source = {}) => ({
                turnLog: [...(Array.isArray(target.turnLog) ? target.turnLog : []), ...(Array.isArray(source.turnLog) ? source.turnLog : [])]
                    .sort((a, b) => Number(a?.turn || 0) - Number(b?.turn || 0))
                    .slice(-30),
                consolidated: [...(Array.isArray(target.consolidated) ? target.consolidated : []), ...(Array.isArray(source.consolidated) ? source.consolidated : [])]
                    .sort((a, b) => Number(a?.turn || 0) - Number(b?.turn || 0))
                    .slice(-20),
                lastConsolidationTurn: Math.max(Number(target.lastConsolidationTurn || 0), Number(source.lastConsolidationTurn || 0))
            });
            let merged = stateHistory[newText] || { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            for (const key of matchedKeys) {
                merged = mergeHistory(merged, stateHistory[key]);
                if (key !== newText) delete stateHistory[key];
            }
            stateHistory[newText] = merged;
            return { changed: true };
        };

        const getState = () => stateHistory;
        const resetState = (nextState = null) => {
            stateHistory = nextState ? normalizeCharacterStateHistory(safeClone(nextState)) : {};
            return stateHistory;
        };

        return { loadState, saveState, recordState, replaceState, recordCriticalMoment, getConsolidationCandidate, applyConsolidationResult, applyConsolidationFallback, consolidateIfNeeded, isCriticalMoment, formatForPrompt, formatForPromptAny, renameEntityKey, getState, resetState };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] World State Tracker
    // ══════════════════════════════════════════════════════════════
    const WorldStateTracker = (() => {
        const STATE_COMMENT = 'lmai_world_states';
        const CONSOLIDATION_INTERVAL = 5;

        let stateHistory = { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
        const getWorldPathLabel = (entry = {}) => {
            const path = Array.isArray(entry?.activeWorld) ? entry.activeWorld.map(value => String(value || '').trim()).filter(Boolean) : [];
            return path.length > 0 ? path[path.length - 1] : '';
        };
        const normalizeWorldStateNotes = (value = '') => dedupeTextArray(
            String(value || '')
                .split('|')
                .map(item => String(item || '').replace(/^Auto-corrected:\s*/i, '').replace(/^Auto-corrected$/i, '').trim())
                .filter(Boolean)
        );
        const normalizeWorldStateEntry = (turn, worldSnapshot = {}) => {
            const targetTurn = Number(turn || 0);
            const rulesSnapshot = worldSnapshot?.rules && typeof worldSnapshot.rules === 'object' ? safeClone(worldSnapshot.rules) : {};
            const ruleHighlights = Array.isArray(worldSnapshot?.ruleHighlights)
                ? dedupeTextArray(worldSnapshot.ruleHighlights.map(value => String(value || '').trim()).filter(Boolean)).slice(0, 6)
                : extractWorldRuleHighlights(rulesSnapshot, 6);
            const worldSummary = truncateForLLM(String(worldSnapshot?.worldSummary || '').trim(), 260, ' ... ');
            const currentTime = truncateForLLM(String(worldSnapshot?.currentTime || worldSnapshot?.time || '').trim(), 100, ' ... ');
            const currentLocation = truncateForLLM(String(worldSnapshot?.currentLocation || worldSnapshot?.location || '').trim(), 160, ' ... ');
            const currentScene = truncateForLLM(String(worldSnapshot?.currentScene || worldSnapshot?.scene || '').trim(), 260, ' ... ');
            const activeEvents = normalizeWorldCanonTextList(worldSnapshot?.activeEvents || worldSnapshot?.active_events, 12);
            const offscreenThreads = normalizeWorldCanonTextList(worldSnapshot?.offscreenThreads || worldSnapshot?.offscreen_threads, 12);
            const notes = truncateForLLM(normalizeWorldStateNotes(worldSnapshot?.notes || '').join(' | '), 220, ' ... ');
            return {
                turn: targetTurn,
                timestamp: Date.now(),
                activeWorld: Array.isArray(worldSnapshot?.activePath) ? worldSnapshot.activePath.slice(0, 8) : [],
                rulesSnapshot,
                globalFlags: worldSnapshot?.global && typeof worldSnapshot.global === 'object' ? safeClone(worldSnapshot.global) : {},
                classification: truncateForLLM(String(worldSnapshot?.classification || '').trim(), 160, ' ... '),
                worldSummary,
                currentTime,
                currentLocation,
                currentScene,
                activeEvents,
                offscreenThreads,
                ruleHighlights,
                notes
            };
        };
        const getWorldStateSignature = (entry = {}) => [
            Array.isArray(entry?.activeWorld) ? entry.activeWorld.join('>') : '',
            String(entry?.classification || '').trim(),
            String(entry?.currentTime || '').trim(),
            String(entry?.currentLocation || '').trim(),
            String(entry?.currentScene || '').trim(),
            Array.isArray(entry?.activeEvents) ? entry.activeEvents.join('|') : '',
            Array.isArray(entry?.offscreenThreads) ? entry.offscreenThreads.join('|') : '',
            Array.isArray(entry?.ruleHighlights) ? entry.ruleHighlights.join('|') : '',
            String(entry?.notes || '').trim()
        ].join('::');
        const describeWorldStateEntry = (entry = {}, options = {}) => {
            const { includeTurn = true, includeNotes = false, ruleLimit = 2 } = options || {};
            const segments = [];
            const turn = Number(entry?.turn || 0);
            if (includeTurn && turn > 0) segments.push(`T${turn}`);
            const pathLabel = getWorldPathLabel(entry);
            if (pathLabel) segments.push(pathLabel);
            if (entry?.classification) segments.push(String(entry.classification));
            if (entry?.currentTime) segments.push(`시간 ${String(entry.currentTime)}`);
            if (entry?.currentLocation) segments.push(`위치 ${String(entry.currentLocation)}`);
            if (entry?.currentScene) segments.push(`장면 ${truncateForLLM(String(entry.currentScene), 100, ' ... ')}`);
            const rules = Array.isArray(entry?.ruleHighlights) ? entry.ruleHighlights.slice(0, Math.max(1, Number(ruleLimit || 0))) : [];
            if (rules.length > 0) segments.push(`규칙 ${rules.join(', ')}`);
            if (Array.isArray(entry?.activeEvents) && entry.activeEvents.length > 0) segments.push(`진행 ${entry.activeEvents.slice(0, 2).join(', ')}`);
            if (!rules.length && entry?.worldSummary) segments.push(truncateForLLM(String(entry.worldSummary), 120, ' ... '));
            if (includeNotes && entry?.notes) segments.push(String(entry.notes));
            return segments.join(' | ');
        };
        const summarizeWorldStateWindow = (entries = []) => {
            const recent = Array.isArray(entries) ? entries.filter(Boolean) : [];
            if (recent.length === 0) return { summary: '', changes: [] };
            const first = recent[0];
            const last = recent[recent.length - 1];
            const changes = [];
            const firstPath = getWorldPathLabel(first);
            const lastPath = getWorldPathLabel(last);
            if (firstPath && lastPath && firstPath !== lastPath) changes.push(`경로 ${firstPath} -> ${lastPath}`);
            if (String(first?.classification || '').trim() !== String(last?.classification || '').trim() && last?.classification) {
                changes.push(`분류 ${String(first?.classification || '미상').trim()} -> ${String(last.classification).trim()}`);
            }
            if (String(first?.currentLocation || '').trim() !== String(last?.currentLocation || '').trim() && last?.currentLocation) {
                changes.push(`위치 ${String(first?.currentLocation || '미상').trim()} -> ${String(last.currentLocation).trim()}`);
            }
            if (String(first?.currentScene || '').trim() !== String(last?.currentScene || '').trim() && last?.currentScene) {
                changes.push(`장면 ${truncateForLLM(String(last.currentScene), 120, ' ... ')}`);
            }
            const lastRuleHighlights = Array.isArray(last?.ruleHighlights) ? last.ruleHighlights.slice(0, 3) : [];
            if (lastRuleHighlights.length > 0) changes.push(`규칙 ${lastRuleHighlights.join(', ')}`);
            if (Array.isArray(last?.activeEvents) && last.activeEvents.length > 0) changes.push(...last.activeEvents.slice(0, 2));
            const lastNotes = normalizeWorldStateNotes(last?.notes || '');
            if (lastNotes.length > 0) changes.push(...lastNotes.slice(0, 2));
            const summaryParts = [];
            if (firstPath && lastPath) summaryParts.push(firstPath === lastPath ? `${lastPath} 유지` : `${firstPath} -> ${lastPath}`);
            else if (lastPath) summaryParts.push(lastPath);
            if (last?.classification) summaryParts.push(String(last.classification));
            if (last?.currentTime) summaryParts.push(String(last.currentTime));
            if (last?.currentLocation) summaryParts.push(`위치 ${String(last.currentLocation)}`);
            if (last?.currentScene) summaryParts.push(truncateForLLM(String(last.currentScene), 120, ' ... '));
            if (lastRuleHighlights.length > 0) summaryParts.push(`핵심 규칙 ${lastRuleHighlights.join(', ')}`);
            else if (last?.worldSummary) summaryParts.push(truncateForLLM(String(last.worldSummary), 180, ' ... '));
            return {
                summary: truncateForLLM(summaryParts.join(' | '), 260, ' ... '),
                changes: dedupeTextArray(changes).slice(0, 4)
            };
        };

        const loadState = (lorebook) => {
            const entry = lorebook.find(e => e.comment === STATE_COMMENT);
            if (entry) {
                try { stateHistory = JSON.parse(entry.content); } catch (e) { recordRuntimeDebug('warn', '[LIBRA] World state parse failed:', e?.message); }
            }
            return stateHistory;
        };

        const saveState = async (lorebook) => {
            const entry = {
                key: LibraLoreKeys.worldStates(),
                comment: STATE_COMMENT,
                content: JSON.stringify(stateHistory),
                mode: 'normal',
                insertorder: 7,
                alwaysActive: false
            };
            const idx = lorebook.findIndex(e => e.comment === STATE_COMMENT);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
        };

        const recordState = (turn, worldSnapshot) => {
            stateHistory.turnLog.push(normalizeWorldStateEntry(turn, worldSnapshot));
            if (stateHistory.turnLog.length > 30) {
                stateHistory.turnLog = stateHistory.turnLog.slice(-30);
            }
        };
        const replaceState = (turn, worldSnapshot) => {
            const targetTurn = Number(turn || 0);
            const nextEntry = normalizeWorldStateEntry(targetTurn, worldSnapshot);
            const existingIdx = stateHistory.turnLog.findIndex(item => Number(item?.turn || 0) === targetTurn);
            if (existingIdx >= 0) stateHistory.turnLog[existingIdx] = nextEntry;
            else stateHistory.turnLog.push(nextEntry);
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

        const getConsolidationCandidate = (currentTurn) => {
            if (currentTurn - stateHistory.lastConsolidationTurn < CONSOLIDATION_INTERVAL) return;
            const recentLogs = stateHistory.turnLog.filter(t => t.turn > stateHistory.lastConsolidationTurn);
            if (recentLogs.length < 3) return;
            const logText = recentLogs.map(l =>
                `Turn ${l.turn}: World=${(l.activeWorld||[]).join('→')}, Notes=${l.notes||'none'}`
            ).join('\n');
            return {
                type: 'world',
                currentTurn: Number(currentTurn || 0),
                recentLogs: safeClone(recentLogs),
                logText
            };
        };

        const trimConsolidatedHistory = () => {
            if (stateHistory.consolidated.length > 20) {
                stateHistory.consolidated = stateHistory.consolidated.slice(-20);
            }
        };

        const applyConsolidationResult = (currentTurn, result = {}) => {
            const rawChanges = Array.isArray(result?.significantChanges)
                ? result.significantChanges
                : (Array.isArray(result?.changes) ? result.changes : (result?.changes ? [result.changes] : []));
            const changes = dedupeTextArray(
                rawChanges
                    .map(item => String(item || '').trim())
                    .filter(Boolean)
            ).slice(0, 8);
            const summary = truncateForLLM(String(result?.summary || result?.description || '').trim(), 360, ' ... ');
            if (summary || changes.length > 0) {
                stateHistory.consolidated.push({
                    turn: Number(currentTurn || 0),
                    type: 'periodic',
                    description: summary,
                    changes,
                    timestamp: Date.now()
                });
            }
            stateHistory.lastConsolidationTurn = Number(currentTurn || 0);
            trimConsolidatedHistory();
            return true;
        };

        const applyConsolidationFallback = (currentTurn) => {
            const candidate = getConsolidationCandidate(currentTurn);
            if (!candidate) return false;
            const last = candidate.recentLogs[candidate.recentLogs.length - 1] || {};
            const summary = summarizeWorldStateWindow(candidate.recentLogs);
            return applyConsolidationResult(currentTurn, {
                summary: summary.summary || `World: ${(last.activeWorld||[]).join('→')}`,
                significantChanges: summary.changes || []
            });
        };

        const consolidateIfNeeded = async (currentTurn, config) => {
            const candidate = getConsolidationCandidate(currentTurn);
            if (!candidate) return;

            if (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux')) {
                try {
                    const result = await runMaintenanceLLM(() =>
                        LLMProvider.call(config,
                            'Summarize world state changes below. Note dimension shifts and rule changes. Respond in the same language as the content.\nOutput JSON: {"summary": "...", "significantChanges": ["..."]}',
                            `World state log:\n${candidate.logText}`,
                            { maxTokens: 300, profile: resolveAnalysisProfile(config), label: `world-state-${currentTurn}` }
                        )
                    , `world-state-${currentTurn}`);

                    if (result.content) {
                        const cleanedContent = Utils.stripLLMThinkingTags(result.content);
                        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            applyConsolidationResult(currentTurn, parsed);
                        }
                    }
                    stateHistory.lastConsolidationTurn = currentTurn;
                } catch (e) {
                    recordRuntimeDebug('warn', '[LIBRA] World state consolidation failed:', e?.message);
                }
            } else {
                applyConsolidationFallback(currentTurn);
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
            const recent = [];
            const seen = new Set();
            for (let i = stateHistory.turnLog.length - 1; i >= 0 && recent.length < 3; i--) {
                const entry = stateHistory.turnLog[i];
                const signature = getWorldStateSignature(entry);
                if (seen.has(signature)) continue;
                seen.add(signature);
                recent.unshift(entry);
            }
            if (recent.length > 0) {
                parts.push(`Recent: ${recent.map(entry => describeWorldStateEntry(entry, { includeTurn: true, includeNotes: false, ruleLimit: 2 })).join(' → ')}`);
            }
            return parts.join('\n');
        };

        const getState = () => stateHistory;
        const resetState = (nextState = null) => {
            stateHistory = nextState ? safeClone(nextState) : { turnLog: [], consolidated: [], lastConsolidationTurn: 0 };
            return stateHistory;
        };

        return { loadState, saveState, recordState, replaceState, recordCriticalMoment, getConsolidationCandidate, applyConsolidationResult, applyConsolidationFallback, consolidateIfNeeded, isCriticalMoment, formatForPrompt, getState, resetState };
    })();

    const StateConsolidationBundler = (() => {
        const normalizeChanges = (value = []) => dedupeTextArray(
            (Array.isArray(value) ? value : (value ? [value] : []))
                .map(item => String(item || '').trim())
                .filter(Boolean)
        ).slice(0, 8);

        const buildPayload = (characterTasks = [], worldTask = null, currentTurn = 0) => ({
            turn: Number(currentTurn || 0),
            characters: characterTasks.map(task => ({
                name: task.name,
                logs: String(task.logText || '').trim()
            })),
            world: worldTask ? { logs: String(worldTask.logText || '').trim() } : null
        });

        const parseBundleResult = (content = '') => {
            const cleaned = Utils.stripLLMThinkingTags(String(content || ''));
            const parsed = parseLooseJson(cleaned) || extractStructuredJson(cleaned);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            return parsed;
        };

        const findCharacterResult = (parsedCharacters = [], task = {}) => {
            const target = String(task?.name || '').trim().toLowerCase();
            if (!target || !Array.isArray(parsedCharacters)) return null;
            return parsedCharacters.find(item => String(item?.name || '').trim().toLowerCase() === target) || null;
        };

        const applyParsedBundle = (parsed = {}, characterTasks = [], worldTask = null, currentTurn = 0) => {
            let applied = 0;
            const characters = Array.isArray(parsed.characters) ? parsed.characters : [];
            for (const task of characterTasks) {
                const item = findCharacterResult(characters, task);
                if (item) {
                    applied += CharacterStateTracker.applyConsolidationResult(task.name, currentTurn, {
                        summary: item.summary || item.description || '',
                        significantChanges: normalizeChanges(item.significantChanges || item.changes)
                    }) ? 1 : 0;
                } else {
                    applied += CharacterStateTracker.applyConsolidationFallback(task.name, currentTurn) ? 1 : 0;
                }
            }
            if (worldTask) {
                const world = parsed.world && typeof parsed.world === 'object' && !Array.isArray(parsed.world)
                    ? parsed.world
                    : null;
                if (world) {
                    applied += WorldStateTracker.applyConsolidationResult(currentTurn, {
                        summary: world.summary || world.description || '',
                        significantChanges: normalizeChanges(world.significantChanges || world.changes)
                    }) ? 1 : 0;
                } else {
                    applied += WorldStateTracker.applyConsolidationFallback(currentTurn) ? 1 : 0;
                }
            }
            return applied;
        };

        const consolidateIfNeeded = async (entityNames = [], currentTurn = 0, config = MemoryEngine.CONFIG) => {
            const names = dedupeTextArray((Array.isArray(entityNames) ? entityNames : [])
                .map(name => String(name || '').trim())
                .filter(Boolean));
            const characterTasks = names
                .map(name => CharacterStateTracker.getConsolidationCandidate(name, currentTurn))
                .filter(Boolean);
            const worldTask = WorldStateTracker.getConsolidationCandidate(currentTurn) || null;
            if (!characterTasks.length && !worldTask) {
                return { skipped: true, reason: 'no-state-consolidation-due' };
            }
            const profile = (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux'))
                ? resolveAnalysisProfile(config)
                : null;
            if (!profile) {
                let applied = 0;
                for (const task of characterTasks) {
                    applied += CharacterStateTracker.applyConsolidationFallback(task.name, currentTurn) ? 1 : 0;
                }
                if (worldTask) applied += WorldStateTracker.applyConsolidationFallback(currentTurn) ? 1 : 0;
                return { mode: 'heuristic', applied, characters: characterTasks.length, world: !!worldTask };
            }

            try {
                const payload = buildPayload(characterTasks, worldTask, currentTurn);
                const system = [
                    'You are LIBRA State Consolidation Bundler.',
                    'Summarize character state logs and world state logs in one compact JSON response.',
                    'Preserve the same language as the logs. Do not invent events, locations, moods, health states, rules, or dimension shifts.',
                    'Return JSON only with this shape:',
                    '{"characters":[{"name":"","summary":"","significantChanges":[]}],"world":{"summary":"","significantChanges":[]}}'
                ].join('\n');
                const user = JSON.stringify(payload, null, 2);
                const maxTokens = Math.min(6000, Math.max(1200, 500 + characterTasks.length * 320 + (worldTask ? 500 : 0)));
                const result = await runMaintenanceLLM(() =>
                    LLMProvider.call(config, system, user, {
                        maxTokens,
                        profile,
                        label: `state-consolidation-bundle-${profile}`,
                        disableReasoning: true
                    })
                , `state-consolidation-bundle-${currentTurn}`);
                const parsed = parseBundleResult(result?.content || '');
                if (!parsed) throw new Error('state_consolidation_bundle_invalid_json');
                const applied = applyParsedBundle(parsed, characterTasks, worldTask, currentTurn);
                return { mode: 'bundle', applied, characters: characterTasks.length, world: !!worldTask };
            } catch (error) {
                if (config?.debug) recordRuntimeDebug('warn', '[LIBRA] State consolidation bundle failed; falling back to split consolidation:', error?.message || error);
                await Promise.allSettled([
                    ...characterTasks.map(task => CharacterStateTracker.consolidateIfNeeded(task.name, currentTurn, config)),
                    worldTask ? WorldStateTracker.consolidateIfNeeded(currentTurn, config) : Promise.resolve()
                ]);
                return { mode: 'fallback-split', characters: characterTasks.length, world: !!worldTask };
            }
        };

        return { consolidateIfNeeded };
    })();
