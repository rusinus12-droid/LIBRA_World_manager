    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Complex World Detector
    // ══════════════════════════════════════════════════════════════
    const ComplexWorldDetector = (() => {
        const emptyIndicators = Object.freeze({});
        const detectComplexIndicators = () => ({});
        const detectDimensionalShift = () => [];
        const analyze = () => ({
            hasComplexElements: false,
            complexityScore: 0,
            indicators: {},
            dimensionalShifts: [],
            requiresNewNode: false,
            sourcePolicy: 'llm_structured_fields_only'
        });
        return { detectComplexIndicators, detectDimensionalShift, analyze };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity Extraction Prompt
    // ══════════════════════════════════════════════════════════════
    const EntityExtractionPrompt = `You are LIBRA's LLM-only NER-style entity extraction engine for RP continuity.

[Mission]
Extract only directly supported character/person entities, relations, and explicit world deltas from the supplied payload. Do not summarize the scene. Return JSON only.

[Evidence Order]
1. Canonical assistant evidence and structured assistant packets.
2. Existing LIBRA stored entities/relations.
3. Character/lore/RP-LTM/memory hints only for alias matching or stable field support.
Never create a new entity from hints alone; new entities require a direct span in the current transcript.
Unless an Active Evidence Mode Override says otherwise, user request text is metadata only and is not factual evidence for what happened.
If user request metadata conflicts with assistant evidence, assistant evidence wins.

[Span-first Rules]
- First list exact source spans in spans.
- Promote only persistent humans, fictional characters, person-like agents, or named creatures acting as characters.
- Reject common nouns, moods, body parts, clothing-only refs, props, rooms, places, organizations, systems, abstract concepts, and bare role/title labels such as 선배/교수/teacher/staff unless the text gives a stable person referent.
- Merge Korean/English/Japanese/romanized/nickname/honorific variants into an existing entity when they clearly refer to the same character. Prefer stored spelling; put variants in aliases.
- Do not infer sex/gender/sexuality from name, pronoun, genre, role, clothing, or stereotype.

[Sparse Patch Output]
Return exactly one JSON object with keys:
{"spans":[],"entities":[],"relations":[],"world":{},"conflicts":[],"uncertain":[],"rejected":[]}
Omit empty nested fields. Missing fields mean "no update".

Entity patch fields may include:
name, canonicalName, entityKind, promotion, matchedExistingEntity, aliases, sex, appearance, personality, speechStyle, background, status, identity, profile, currentState, stateTimeline, continuity, povKnowledge, episodeLedger, evidence, quality.

Relation patch fields may include:
entityA, entityB, relationType, howMet, duration, closenessDelta, trustDelta, sentiments, event, eventSentiment, currentStatus, metrics, dynamics, sharedContext, eventLedger, evidence, quality.

World patch fields may include:
classification.primary, exists, systems, setting.places, setting.organizations, setting.socialRules, physics, custom, global, structure, state. Only set explicit world facts. Classification/genre is metadata only: never expand it into magic, ki, system, hunter, isekai, sci-fi, technology, guild, or physics defaults. Do not create "no magic/system" absence facts from a modern-looking scene. Put current time/location/scene in state, not persistent exists/custom rules.

[Evidence Requirements]
- Every promoted entity/relation/profile/currentState/world fact needs a short evidence snippet.
- Profile/background/speechStyle/continuity are durable; fill them only when directly supported.
- profile.psychology is durable inner life: baseline = stable inner posture/wound/motivation, currentConflict = active unresolved internal conflict, copingStyle = recurring stress response, notes = brief evidence cues. Do not bury psychology in personality.traits.
- continuity.openThreads is for unresolved personal plot hooks, unanswered questions, promises, risks, or pending choices that should be recalled later. Use short active labels and keep one-turn mood/actions in currentState/stateTimeline.
- relation.dynamics.recentChanges is for concrete relationship shifts/events from this turn; relation.dynamics.unresolvedIssues is for open tensions, unanswered questions, pending boundaries, promises, or risks between the pair. Do not leave them in status/event only when they should be recalled later.
- status/currentState/stateTimeline are volatile scene state; update only from current transcript.
- Put turn-specific expressions, actions, emotional shifts, facial reactions, and scene state in currentState/stateTimeline, not personality.traits. personality.traits is only for stable temperament and recurring behavior patterns.
- If uncertain, put the item in uncertain or rejected instead of entities.
- Do not output markdown, code fences, comments, or natural-language explanation.`;
    const TurnStateCorrectionPrompt = `당신은 방금 추출된 대화 상태를 감사하고 잘못된 추론만 바로잡는 검증자입니다.
You audit freshly extracted turn state and correct only clear mistakes.

[핵심 규칙 / Rules]
- 대화와 현재 상태 스냅샷에 근거해 명백한 오류만 수정하십시오.
- 불확실하면 원래 값을 유지하고 수정하지 마십시오.
- 새 사실을 만들어내지 마십시오.
- 이름은 반드시 기존 표기 그대로 사용하십시오.
- 수정이 필요 없으면 correctedEntities / correctedRelations / world / narrative 를 비워 두십시오.
- 내부 데이터 언어 가드가 목표 언어를 지정하면 그 목표 언어를 우선하십시오. 가드가 없으면 모든 설명 필드는 영문으로 작성하십시오.
- speechStyle dropdown fields must use exact enum values only:
  defaultTone = "formal"|"polite"|"casual"|"blunt"|"playful"|"cold"|"gentle";
  honorificStyle = "mostly_honorific"|"mostly_casual"|"mixed_by_hierarchy"|"switches_by_mood";
  toSuperiors/toSubordinates/toPeers/toYounger = "formal_polite"|"measured_polite"|"casual_friendly"|"playful_casual"|"blunt_casual"|"gentle_caring"|"commanding".
- Put prose, examples, and uncertain speech details in speechStyle.notes, not in dropdown fields.
- 절대로 사용자의 입력 내용을 그대로 반복하거나 출력에 포함하지 마십시오. NEVER echo, repeat, or include the user's input text in your output.

[출력 JSON 스키마 / Output JSON Schema]
{
  "shouldCorrect": true|false,
  "reasons": ["brief reason"],
  "correctedEntities": [
    {
      "name": "이름(English)",
      "sex": "male|female|",
      "appearance": { "features": [], "distinctiveMarks": [], "clothing": [] },
      "personality": { "traits": [], "likes": [], "dislikes": [], "fears": [], "sexualOrientation": "", "sexualPreferences": [] },
      "speechStyle": { "defaultTone": "", "honorificStyle": "", "toSuperiors": "", "toSubordinates": "", "toPeers": "", "toYounger": "", "notes": [] },
      "background": { "origin": "", "occupation": "", "history": [] },
      "status": { "currentMood": "", "currentLocation": "", "healthStatus": "", "notes": "" }
    }
  ],
  "correctedRelations": [
    {
      "entityA": "이름(English)",
      "entityB": "이름(English)",
      "relationType": "",
      "closenessDelta": 0,
      "trustDelta": 0,
      "sentiments": { "fromAtoB": "", "fromBtoA": "", "currentTension": 0 },
      "event": ""
    }
  ],
  "world": {
    "classification": { "primary": "" },
    "exists": {},
    "systems": {},
    "setting": { "places": [], "organizations": [], "socialRules": [] },
    "physics": {},
    "custom": {},
    "state": { "time": "", "location": "", "scene": "", "activeEvents": [], "offscreenThreads": [] }
  },
  "narrative": {
    "summary": "",
    "entities": []
  }
}`;

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] Entity-Aware Processor
    // ══════════════════════════════════════════════════════════════
    const EntityAwareProcessor = (() => {
        const buildGenreSourceWorldPayload = (userMsg, aiResponse) => ({
            classification: {},
            __genreSourceText: `${userMsg || ''}\n${aiResponse || ''}`.trim()
        });
        const CLASSIFICATION_ALIASES = Object.freeze({});
        const normalizeClassificationAlias = (value) => String(value || '').trim();
        const inferWorldClassificationLabel = (world = {}, sourceText = '') => {
            const rawPrimary = normalizeClassificationAlias(world?.classification?.primary || '');
            return rawPrimary;
        };
        const resolveWorldTemplateKey = (classificationLabel, world = {}) => {
            // Deprecated compatibility shim. Genre/classification labels are metadata only;
            // they must not expand into hardcoded world rules.
            return '';
        };
        const normalizeWorldRuleUpdate = (world) => {
            const normalized = {};
            const sourceText = collectWorldRuleEvidenceText(world, String(world?.__genreSourceText || '').trim());
            // Classification is preserved as metadata by buildWorldMetaPayload(). Do not
            // convert genre labels into template defaults or inferred rules here.
            for (const key of ['exists', 'systems', 'physics', 'setting', 'custom']) {
                if (key === 'setting') {
                    const normalizedSetting = normalizeWorldSettingRules({
                        ...(world?.setting && typeof world.setting === 'object' && !Array.isArray(world.setting) ? world.setting : {}),
                        places: [world?.setting?.places, world?.places, world?.locations, world?.facilities],
                        organizations: [world?.setting?.organizations, world?.organizations, world?.orgs, world?.factions],
                        socialRules: [world?.setting?.socialRules, world?.setting?.social_rules, world?.social_rules, world?.socialRules, world?.culture, world?.customs]
                    });
                    if (normalizedSetting.places.length || normalizedSetting.organizations.length || normalizedSetting.socialRules.length) {
                        normalized.setting = normalizedSetting;
                    }
                    continue;
                }
                if (key === 'custom') {
                    const normalizedCustom = normalizeWorldCustomRules(world?.custom);
                    const filteredCustom = {};
                    Object.values(normalizedCustom)
                        .flatMap(value => normalizeWorldCanonTextList(value, 12))
                        .forEach((value, index) => { filteredCustom[`rule_${index + 1}`] = value; });
                    if (Object.keys(filteredCustom).length > 0) {
                        normalized.custom = {
                            ...(normalized.custom || {}),
                            ...filteredCustom
                        };
                    }
                    continue;
                }
                if (world?.[key] && typeof world[key] === 'object' && !Array.isArray(world[key])) {
                    normalized[key] = {
                        ...(normalized[key] || {}),
                        ...world[key]
                    };
                }
            }
            return sanitizeWorldRuleUpdateForPolicy(normalized, sourceText);
        };

        const buildWorldConflictProbe = (world) => ({
            exists: world?.exists && typeof world.exists === 'object' && !Array.isArray(world.exists) ? safeClone(world.exists) : {},
            systems: world?.systems && typeof world.systems === 'object' && !Array.isArray(world.systems) ? safeClone(world.systems) : {},
            setting: normalizeWorldSettingRules(world?.setting),
            physics: world?.physics && typeof world.physics === 'object' && !Array.isArray(world.physics) ? safeClone(world.physics) : {},
            custom: normalizeWorldCustomRules(world?.custom),
            content: JSON.stringify(world || {})
        });
        const isLikelyInvalidEntityName = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return true;
            const normalized = raw.toLowerCase().replace(/[()[\]{}"'`]/g, '').trim();
            const blockedExact = new Set([
                '사용자', '응답', '대화', '현재', '세계관', '관계', '인물', '정보', '요청', '분석', '재분석',
                '엔티티', '채팅', '로그', '전체', '기준', '결과', '요약', '메모리', '스토리', '서사', '장면',
                'user', 'assistant', 'response', 'conversation', 'current', 'world', 'relation', 'relations',
                'entity', 'entities', 'character', 'characters', 'chat', 'log', 'logs', 'whole', 'full',
                'criteria', 'result', 'results', 'summary', 'memory', 'narrative', 'scene'
            ]);
            if (blockedExact.has(normalized)) return true;
            if (/^(user|assistant|response|conversation|entity|entities|character|characters|chat|log|logs)$/i.test(normalized)) return true;
            if (/^(사용자|응답|대화|엔티티|인물|관계|채팅|로그|전체|기준|결과|요약|메모리|서사|장면)$/i.test(normalized)) return true;
            if (/(재분석|analysis|extract|extraction|json|output|schema|format|prompt|instruction)/i.test(normalized)) return true;
            if (normalized.length <= 1) return true;
            return false;
        };
        const NON_PERSON_ENTITY_EXACT = new Set([
            '소속사', '기획사', '회사', '기업', '학교', '학원', '교실', '복도', '매점', '연습실', '무대',
            '방송국', '병원', '조직', '단체', '팀', '그룹', '시스템', '세계관', '규칙', '교정', '도시',
            '국어', '영어', '수학', '과학', '사회', '역사', '문학', '음악', '미술', '보건', '체육', '안무', '상담', '로드', '유치원', '상담실', '보건실', '교무실', '커플', '시간',
            'agency', 'company', 'school', 'classroom', 'hallway', 'store', 'studio', 'stage', 'broadcast station',
            'hospital', 'organization', 'group', 'team', 'system', 'world', 'setting', 'rule'
        ]);
        const NON_PERSON_ENTITY_SUFFIX_PATTERNS = [
            /(?:소속사|기획사|회사|학교|학원|병원|방송국|교실|복도|매점|연습실|무대|조직|시스템|세계관)$/i,
            /(?:agency|company|school|hospital|studio|stage|hallway|classroom|organization|system|world|setting)$/i
        ];
        const GENERIC_ROLE_ENTITY_EXACT = new Set([
            '매니저', 'manager', 'teacher', '선생님', '교사', '담임', 'coach', '코치', 'staff', '직원',
            '바텐더', '바리스타', '점원', '웨이터', '웨이트리스', '서빙', 'bartender', 'barista', 'waiter', 'waitress', 'server', 'clerk',
            'guard', '경호원', 'doctor', '의사', 'nurse', '간호사', 'driver', '기사', 'reporter', '기자',
            'announcer', '아나운서', 'student', '학생', 'trainee', '연습생', 'staff member',
            '감독', '원장', '사감', '사장', '교장', '교감', '교생', '팀장', '부장', '부원', '회장',
            '선배', '후배', '동기', '아저씨'
        ]);
        const WEAK_STANDALONE_ENTITY_EXACT = new Set([
            '조용히', '그림', '그려', '볼륨', '챕터', '뜻밖', '재능', '가방',
            '응답', '사용자', '대화', '장면', '서술', '묘사', '문장', '단어',
            'volume', 'chapter', 'scene', 'response'
        ]);
        const SPECIFIC_PERSON_FALSE_POSITIVE_EXACT = new Set([
            '오빠', '언니', '누나', '형', '엄마', '아빠', '어머니', '아버지',
            '아저씨', '아저',
            '아까', '지금', '오늘', '내일', '방금', '서로', '그녀', '그는',
            '데뷔하기', '담당하', '너더러', '되는', '되네', '하려고', '하면서',
            '행복관', '리허설', '체조경기장', '연예인',
            '사람', '때문', '같은', '자랑', '핸드북', '핸드북에', '몰골', '몰골이었',
            '잘릴', '방의',
            '데려가서', '옆', '옆에', '지방',
            '차라리', '지켜보던', '다정한', '어른인', '연예계', '선생',
            '주변', '내가', '네가', '자신', '행각', '성역', '지켜보던', '엎질러놓', '야만', '우리',
            '거면', '없는', '획사', '부모',
            '지나가던', '완벽한', '다른', '도는', '먹다', '읽는', '진행하', '생들이나', '어머', '시간',
            '했다', '있었다', '없었다', '않았다', '시작했다', '지키기', '물었다', '될지', '되었다'
        ]);
        const EXPLICIT_NON_PERSON_TYPE_PATTERN = /(organization|org|institution|company|agency|group|team|place|location|room|building|world|setting|system|object|item|rule|school|facility)/i;
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
        const normalizeEntityStatusBaseName = (value) => {
            const normalized = EntityManager.normalizeName(value || '', []) || value || '';
            return String(normalized || '').trim();
        };
        const scoreEntityStatusNoteCandidate = (candidate = '', entityName = '', status = {}) => {
            const text = String(candidate || '').trim();
            if (!text) return -Infinity;
            let score = 0;
            const lowered = text.toLowerCase();
            const displayName = String(entityName || '').trim().toLowerCase();
            const baseName = normalizeEntityStatusBaseName(entityName).toLowerCase();
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
            return `${chosen.slice(0, Math.max(48, max - 1)).trim()}...`;
        };
        const hasMeaningfulEntityArray = (value) => Array.isArray(value) && value.some(item => String(item || '').trim().length >= 2);
        const hasStablePersonSignals = (item = {}, normalizedName = '') => {
            const appearance = (item?.appearance && typeof item.appearance === 'object') ? item.appearance : {};
            const personality = (item?.personality && typeof item.personality === 'object') ? item.personality : {};
            const speechStyle = (item?.speechStyle && typeof item.speechStyle === 'object') ? item.speechStyle : {};
            const background = (item?.background && typeof item.background === 'object') ? item.background : {};
            const status = (item?.status && typeof item.status === 'object') ? item.status : {};
            const occupation = String(background.occupation || '').trim();
            const cleanedStatusNote = compactEntityStatusNote(status.notes || '', 120, { entityName: normalizedName, status });
            return Boolean(
                normalizeBiologicalSex(item?.sex || item?.biologicalSex || item?.biological_sex || item?.gender || '')
                || hasMeaningfulEntityArray(appearance.features)
                || hasMeaningfulEntityArray(appearance.distinctiveMarks)
                || hasMeaningfulEntityArray(appearance.clothing)
                || hasMeaningfulEntityArray(personality.traits)
                || hasMeaningfulEntityArray(personality.values)
                || hasMeaningfulEntityArray(personality.likes)
                || hasMeaningfulEntityArray(personality.dislikes)
                || hasMeaningfulEntityArray(personality.fears)
                || String(personality.sexualOrientation || '').trim()
                || hasMeaningfulEntityArray(personality.sexualPreferences)
                || String(speechStyle.defaultTone || '').trim()
                || String(speechStyle.honorificStyle || '').trim()
                || String(speechStyle.toSuperiors || '').trim()
                || String(speechStyle.toSubordinates || '').trim()
                || String(speechStyle.toPeers || '').trim()
                || String(speechStyle.toYounger || '').trim()
                || hasMeaningfulEntityArray(speechStyle.notes)
                || String(background.origin || '').trim()
                || (occupation && normalizeEntityStatusBaseName(occupation).toLowerCase() !== normalizeEntityStatusBaseName(normalizedName).toLowerCase())
                || hasMeaningfulEntityArray(background.history)
                || hasMeaningfulEntityArray(background.secrets)
                || cleanedStatusNote
            );
        };
        const isLikelyNonPersonEntityName = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return true;
            const normalized = raw.toLowerCase().replace(/[()[\]{}"'`]/g, '').trim();
            if (!normalized) return true;
            if (NON_PERSON_ENTITY_EXACT.has(normalized)) return true;
            return NON_PERSON_ENTITY_SUFFIX_PATTERNS.some(pattern => pattern.test(raw));
        };
        const isLikelyGenericRoleLabel = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return false;
            const normalized = raw.toLowerCase().replace(/[()[\]{}"'`]/g, '').trim();
            if (GENERIC_ROLE_ENTITY_EXACT.has(normalized)) return true;
            return /^(?:manager|teacher|coach|staff|guard|doctor|nurse|driver|reporter|announcer|student|trainee)$/i.test(normalized);
        };
        const isWeakStandaloneEntityName = (value) => {
            const raw = String(value || '').replace(/[()[\]{}"'`]/g, '').trim();
            if (!raw) return true;
            const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
            if (WEAK_STANDALONE_ENTITY_EXACT.has(raw) || WEAK_STANDALONE_ENTITY_EXACT.has(normalized)) return true;
            if (isLikelyGenericRoleLabel(raw)) return true;
            if (/^(?:볼륨|챕터|권|장)\s*\d*$/u.test(raw)) return true;
            if (/^(?:volume|chapter)\s*\d*$/i.test(normalized)) return true;
            return false;
        };
        const stripKoreanEntityParticle = (value) => {
            const raw = String(value || '').trim();
            if (!/^[가-힣]{2,6}$/.test(raw)) return raw;
            const suffixes = [
                '으로는', '에게서는', '에게서', '이라도', '에게는', '에게', '한테는', '한테', '에서는', '에는', '에서', '부터', '까지', '처럼',
                '께서는', '께서', '으로', '하고', '이다', '이며', '이랑', '랑', '은', '는', '이',
                '에',
                '가', '을', '를', '의', '도', '로', '만'
            ];
            for (const suffix of suffixes) {
                if (raw.length - suffix.length >= 2 && raw.endsWith(suffix)) {
                    return raw.slice(0, -suffix.length);
                }
            }
            return raw;
        };
        const escapeEntityRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const looksLikeSpecificPersonName = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return false;
            if (SPECIFIC_PERSON_FALSE_POSITIVE_EXACT.has(raw)) return false;
            if (isWeakStandaloneEntityName(raw)) return false;
            if (/(?:하기|하는|하라|하자|하던|했던|되고|되는|됐다|더러|라고|처럼|부터|까지|한테|한테는|에게|에게는|에서|에서는|에|가서|와서|해서)$/u.test(raw)) return false;
            return /^[가-힣]{2,4}$/.test(raw) || /^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}$/.test(raw);
        };
        const normalizeSpecificPersonNameCandidate = (value) => {
            const compact = String(value || '')
                .replace(/[()[\]{}]/g, ' ')
                .replace(/[,:/|]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!compact) return '';
            const parts = compact
                .split(/\s+/)
                .map(part => stripKoreanEntityParticle(part).replace(/^[^A-Za-z가-힣]+|[^A-Za-z가-힣]+$/g, '').trim())
                .filter(Boolean)
                .filter(part => !isWeakStandaloneEntityName(part) && !isLikelyGenericRoleLabel(part) && !isLikelyNonPersonEntityName(part));
            const joined = parts.join(' ').trim();
            if (looksLikeSpecificPersonName(joined)) return joined;
            for (const part of parts) {
                if (looksLikeSpecificPersonName(part)) return part;
            }
            return '';
        };
        const collectEntityNameCandidates = (item = {}) => {
            const background = (item?.background && typeof item.background === 'object') ? item.background : {};
            const meta = (item?.meta && typeof item.meta === 'object') ? item.meta : {};
            return dedupeTextArray([
                item?.fullName,
                item?.canonicalName,
                item?.personName,
                item?.realName,
                item?.nativeName,
                item?.displayName,
                item?.name,
                item?.alias,
                background?.fullName,
                background?.realName,
                background?.name,
                ...(Array.isArray(item?.aliases) ? item.aliases : []),
                ...(Array.isArray(item?.altNames) ? item.altNames : []),
                ...(Array.isArray(background?.aliases) ? background.aliases : []),
                ...(Array.isArray(meta?.aliases) ? meta.aliases : [])
            ].map(value => String(value || '').trim()).filter(Boolean));
        };
        const KOREAN_ENTITY_MENTION_PARTICLES = '(?:에게서는|에게서|에게는|에게|한테서는|한테서|한테는|한테|께서는|께서|께|으로서는|으로서|로서는|로서|으로써|로써|으로는|으로|에서는|에서|부터|까지|처럼|하고|이며|이랑|랑|은|는|이|가|을|를|의|도|와|과|로|만|에)';
        const hasEntityMentionEvidenceInText = (variant = '', text = '', escapeFn = escapeEntityRegex) => {
            const rawVariant = String(variant || '').trim();
            const sourceText = String(text || '');
            if (!rawVariant || !sourceText.trim()) return false;
            const escaped = escapeFn(rawVariant);
            if (!escaped) return false;
            const isHangul = /^[가-힣]+$/.test(rawVariant);
            const pattern = isHangul
                ? new RegExp(`(^|[^가-힣])${escaped}(?:${KOREAN_ENTITY_MENTION_PARTICLES})?(?=$|[^가-힣])`, 'u')
                : new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'iu');
            return pattern.test(sourceText);
        };
        const buildDirectEntityMentionVariants = (item = {}, normalizedName = '') => {
            const variants = new Set([
                normalizedName,
                ...collectEntityNameCandidates(item)
            ].map(value => String(value || '').replace(/[“”"'`‘’]/g, '').trim()).filter(Boolean));
            for (const value of Array.from(variants)) {
                const bilingual = String(value || '').match(/^([^()[\]]+?)\s*\(([^()]+?)\)\s*$/);
                if (bilingual) {
                    variants.add(String(bilingual[1] || '').trim());
                    variants.add(String(bilingual[2] || '').trim());
                }
                String(value || '')
                    .replace(/[()[\]]/g, ' ')
                    .split(/\s*\/\s*|\s*\|\s*|\s*;\s*|\s*,\s*|\s*[·・]\s*|\s+/)
                    .map(part => String(part || '').trim())
                    .filter(Boolean)
                    .forEach(part => variants.add(part));
            }
            for (const value of Array.from(variants)) {
                const compact = String(value || '').replace(/\s+/g, '').trim();
                if (compact) variants.add(compact);
            }
            return dedupeTextArray(Array.from(variants).map(value => String(value || '').trim()).filter(value => value.length >= 2));
        };
        const hasDirectEntityMentionEvidence = (item = {}, normalizedName = '', conversationText = '') => {
            const text = String(conversationText || '');
            if (!text.trim()) return false;
            return buildDirectEntityMentionVariants(item, normalizedName)
                .some(variant => hasEntityMentionEvidenceInText(variant, text, escapeEntityRegex));
        };
        const PACKET_ENTITY_EVIDENCE_PATTERN = /(?:hayaku|structured[_\s-]*packet|assistant[_\s-]*packet)/i;
        const hasPacketEntityEvidenceSource = (value = '') => PACKET_ENTITY_EVIDENCE_PATTERN.test(String(value || ''));
        const isPacketBackedEntityEvidence = (item = {}) => {
            if (!item || typeof item !== 'object') return false;
            const sourceMix = Array.isArray(item?.quality?.sourceMix) ? item.quality.sourceMix : [];
            const evidence = Array.isArray(item?.evidence) ? item.evidence : [];
            const sourceFields = [
                item?.sourceMode,
                item?.source,
                item?.origin,
                item?.meta?.source,
                item?.quality?.source,
                item?.identity?.source?.sourceKind,
                item?.identity?.source?.kind,
                item?.identity?.source?.source
            ];
            if (sourceFields.some(value => hasPacketEntityEvidenceSource(value))) return true;
            if (sourceMix.some(value => hasPacketEntityEvidenceSource(value))) return true;
            return evidence.some(entry => {
                if (typeof entry === 'string') return hasPacketEntityEvidenceSource(entry);
                if (!entry || typeof entry !== 'object') return false;
                return [
                    entry.sourceKind,
                    entry.kind,
                    entry.source,
                    entry.sourceMode,
                    entry.origin
                ].some(value => hasPacketEntityEvidenceSource(value));
            });
        };
        const addPacketEntityEvidenceName = (set, value, lorebook = []) => {
            const raw = String(value || '').replace(/[“”"'`‘’]/g, '').trim();
            if (!raw || raw.length < 2) return;
            const candidates = dedupeTextArray([
                raw,
                EntityManager.normalizeName(raw, lorebook) || '',
                normalizeSpecificPersonNameCandidate(raw) || ''
            ].map(item => String(item || '').trim()).filter(Boolean));
            for (const candidate of candidates) {
                const key = candidate.toLowerCase();
                if (key) set.add(key);
                const compact = candidate.replace(/\s+/g, '').toLowerCase();
                if (compact) set.add(compact);
            }
        };
        const buildPacketEntityEvidenceNameSet = (items = [], lorebook = []) => {
            const set = new Set();
            const source = Array.isArray(items) ? items : [];
            for (const item of source) {
                if (!isPacketBackedEntityEvidence(item)) continue;
                const normalizedName = EntityManager.normalizeName(item?.name || '', lorebook) || String(item?.name || '').trim();
                for (const variant of buildDirectEntityMentionVariants(item, normalizedName)) {
                    addPacketEntityEvidenceName(set, variant, lorebook);
                }
            }
            return set;
        };
        const hasPacketEntityEvidence = (item = {}, normalizedName = '', packetEvidenceNames = new Set(), lorebook = []) => {
            if (!(packetEvidenceNames instanceof Set) || packetEvidenceNames.size === 0) return false;
            return buildDirectEntityMentionVariants(item, normalizedName).some(variant => {
                const raw = String(variant || '').trim();
                if (!raw) return false;
                const normalized = EntityManager.normalizeName(raw, lorebook) || raw;
                const keys = [
                    raw.toLowerCase(),
                    normalized.toLowerCase(),
                    raw.replace(/\s+/g, '').toLowerCase(),
                    normalized.replace(/\s+/g, '').toLowerCase()
                ].filter(Boolean);
                return keys.some(key => packetEvidenceNames.has(key));
            });
        };
        const isKnownEntityNameForExtraction = (normalizedName = '', lorebook = []) => {
            const name = String(normalizedName || '').trim();
            if (!name) return false;
            try {
                const cache = EntityManager.getEntityCache?.();
                if (cache?.has?.(name)) return true;
            } catch (_) {}
            for (const entry of LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : [])) {
                if (String(entry?.comment || '') !== 'lmai_entity') continue;
                try {
                    const parsed = JSON.parse(entry.content || '{}');
                    const parsedName = EntityManager.normalizeName(parsed?.name || '', lorebook) || String(parsed?.name || '').trim();
                    if (parsedName === name) return true;
                } catch (error) {
                    recordSuppressedRuntimeError('entity_extraction.known_entity_parse_failed', error, {
                        comment: 'lmai_entity',
                        key: String(entry?.key || '').trim(),
                        candidate: name
                    });
                }
            }
            return false;
        };
        const resolvePreferredEntityName = (item, lorebook = []) => {
            for (const candidate of collectEntityNameCandidates(item)) {
                const specificName = normalizeSpecificPersonNameCandidate(candidate);
                if (!specificName) continue;
                const normalized = EntityManager.normalizeName(specificName, lorebook) || specificName;
                if (isLikelyInvalidEntityName(normalized)) continue;
                if (isLikelyNonPersonEntityName(normalized)) continue;
                if (isLikelyGenericRoleLabel(normalized)) continue;
                return normalized;
            }
            const rawName = String(item?.name || '').trim();
            return EntityManager.normalizeName(rawName, lorebook) || rawName;
        };
        const hasSpecificIdentityName = (item = {}) => {
            return collectEntityNameCandidates(item).some(candidate => {
                const specificName = normalizeSpecificPersonNameCandidate(candidate);
                if (!specificName) return false;
                if (isLikelyInvalidEntityName(specificName)) return false;
                if (isLikelyNonPersonEntityName(specificName)) return false;
                if (isLikelyGenericRoleLabel(specificName)) return false;
                return true;
            });
        };
        const sanitizeEntityStatusPayload = (status, entityName = '') => {
            if (!status || typeof status !== 'object' || Array.isArray(status)) return undefined;
            const next = {
                currentMood: sanitizeEntityStatusField(status.currentMood || '', 48),
                currentLocation: sanitizeEntityStatusField(status.currentLocation || '', 72),
                healthStatus: sanitizeEntityStatusField(status.healthStatus || '', 72),
                notes: ''
            };
            next.notes = compactEntityStatusNote(status.notes || '', 180, { entityName, status: next });
            if (!next.currentMood && !next.currentLocation && !next.healthStatus && !next.notes) return undefined;
            return next;
        };
        const shouldKeepExtractedEntity = (item, normalizedName, options = {}) => {
            const conversationText = String(options?.conversationText || '').trim();
            const lorebook = Array.isArray(options?.lorebook) ? options.lorebook : [];
            const packetEvidenceNames = options?.packetEvidenceNames instanceof Set
                ? options.packetEvidenceNames
                : buildPacketEntityEvidenceNameSet(options?.packetEvidenceEntities || [], lorebook);
            const typeSignals = [
                item?.kind,
                item?.type,
                item?.category,
                item?.entityType,
                item?.entityKind,
                item?.nerType,
                item?.spanType,
                item?.recordType
            ].map(value => String(value || '').trim()).filter(Boolean).join(' ');
            if (typeSignals && EXPLICIT_NON_PERSON_TYPE_PATTERN.test(typeSignals)) return false;
            if (isLikelyNonPersonEntityName(normalizedName)) return false;
            if (SPECIFIC_PERSON_FALSE_POSITIVE_EXACT.has(String(normalizedName || '').trim())) return false;
            if (isWeakStandaloneEntityName(normalizedName)) return false;
            if (!hasSpecificIdentityName(item)) return false;
            const isKnownEntity = isKnownEntityNameForExtraction(normalizedName, lorebook);
            const hasDirectEvidence = hasDirectEntityMentionEvidence(item, normalizedName, conversationText);
            const hasPacketEvidence = hasPacketEntityEvidence(item, normalizedName, packetEvidenceNames, lorebook);
            const hasStrongEvidence = hasDirectEvidence || hasPacketEvidence;
            if (options?.requireConversationEvidenceForKnown === true && isKnownEntity && !hasStrongEvidence) {
                return false;
            }
            if (options?.requireConversationEvidenceForNew === true && !isKnownEntity && !hasStrongEvidence) {
                return false;
            }
            // Do not reject LLM-promoted person/character spans by Korean name length,
            // surname, title, or action-subject heuristics. In NER-style LLM mode,
            // local code only checks explicit source evidence and storage safety.
            if (isLikelyGenericRoleLabel(normalizedName)) {
                if (!hasSpecificIdentityName(item)) return false;
                if (!hasStablePersonSignals(item, normalizedName)) return false;
            }
            return true;
        };
        const sanitizeExtractedEntities = (items, lorebook = [], options = {}) => {
            const source = Array.isArray(items) ? items : [];
            const sanitized = [];
            const seen = new Set();
            const normalizedOptions = {
                ...options,
                lorebook,
                packetEvidenceNames: options?.packetEvidenceNames instanceof Set
                    ? options.packetEvidenceNames
                    : buildPacketEntityEvidenceNameSet(options?.packetEvidenceEntities || [], lorebook)
            };
            for (const item of source) {
                if (!item || typeof item !== 'object') continue;
                const candidateName = String(item.name || '').trim();
                if (isLikelyInvalidEntityName(candidateName)) continue;
                if (EntityManager.isBlockedEntityName(candidateName, lorebook)) continue;
                const normalizedName = resolvePreferredEntityName(item, lorebook);
                if (isLikelyInvalidEntityName(normalizedName)) continue;
                if (EntityManager.isBlockedEntityName(normalizedName, lorebook)) continue;
                if (!shouldKeepExtractedEntity(item, normalizedName, normalizedOptions)) continue;
                const key = String(normalizedName || '').trim().toLowerCase();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                const sanitizedStatus = sanitizeEntityStatusPayload(item.status, normalizedName);
                sanitized.push({
                    ...item,
                    name: normalizedName,
                    sex: normalizeBiologicalSex(item.sex || item.biologicalSex || item.biological_sex || item.gender || ''),
                    status: sanitizedStatus
                });
            }
            return sanitized;
        };
        const sanitizeExtractedRelations = (items, lorebook = [], allowedEntityNames = []) => {
            const source = Array.isArray(items) ? items : [];
            const sanitized = [];
            const seen = new Set();
            const allowed = new Set((Array.isArray(allowedEntityNames) ? allowedEntityNames : []).map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
            for (const item of source) {
                if (!item || typeof item !== 'object') continue;
                const rawA = String(item.entityA || item.nameA || '').trim();
                const rawB = String(item.entityB || item.nameB || '').trim();
                if (!rawA || !rawB) continue;
                const entityA = EntityManager.normalizeName(rawA, lorebook) || rawA;
                const entityB = EntityManager.normalizeName(rawB, lorebook) || rawB;
                if (!entityA || !entityB || entityA === entityB) continue;
                if (isWeakStandaloneEntityName(entityA) || isWeakStandaloneEntityName(entityB)) continue;
                if (EntityManager.isBlockedEntityName(entityA, lorebook) || EntityManager.isBlockedEntityName(entityB, lorebook)) continue;
                if (isLikelyInvalidEntityName(entityA) || isLikelyInvalidEntityName(entityB)) continue;
                if (isLikelyNonPersonEntityName(entityA) || isLikelyNonPersonEntityName(entityB)) continue;
                const normalizedA = entityA.toLowerCase();
                const normalizedB = entityB.toLowerCase();
                const knownA = isKnownEntityNameForExtraction(entityA, lorebook);
                const knownB = isKnownEntityNameForExtraction(entityB, lorebook);
                if (!allowed.has(normalizedA) && !knownA) continue;
                if (!allowed.has(normalizedB) && !knownB) continue;
                if (isLikelyGenericRoleLabel(entityA) && !allowed.has(normalizedA)) continue;
                if (isLikelyGenericRoleLabel(entityB) && !allowed.has(normalizedB)) continue;
                const pairKey = [entityA, entityB].sort().join('::').toLowerCase();
                if (!pairKey || seen.has(pairKey)) continue;
                seen.add(pairKey);
                sanitized.push({
                    ...item,
                    entityA,
                    entityB,
                    relationType: String(item.relationType || item.type || '').trim(),
                    event: compactEntityStatusNote(item.event || '', 160, { entityName: `${entityA}/${entityB}` })
                });
            }
            return sanitized;
        };
        const makeExtractionNameKey = (value = '', lorebook = []) => {
            const normalized = EntityManager.normalizeName(value || '', lorebook) || String(value || '').trim();
            return String(normalized || '').trim().toLowerCase();
        };
        const summarizeRejectedExtractionEntities = (sourceEntities = [], sanitizedEntities = [], lorebook = []) => {
            const accepted = new Set((Array.isArray(sanitizedEntities) ? sanitizedEntities : [])
                .map(entity => makeExtractionNameKey(entity?.name || '', lorebook))
                .filter(Boolean));
            return (Array.isArray(sourceEntities) ? sourceEntities : [])
                .map(entity => {
                    const rawName = String(entity?.name || '').trim();
                    const key = makeExtractionNameKey(rawName, lorebook);
                    if (!rawName || !key || accepted.has(key)) return null;
                    return {
                        name: rawName,
                        normalizedName: EntityManager.normalizeName(rawName, lorebook) || rawName,
                        reason: isWeakStandaloneEntityName(rawName) ? 'weak_standalone_name' : 'insufficient_entity_evidence'
                    };
                })
                .filter(Boolean);
        };
        const summarizeRejectedExtractionRelations = (sourceRelations = [], sanitizedRelations = [], lorebook = []) => {
            const accepted = new Set((Array.isArray(sanitizedRelations) ? sanitizedRelations : [])
                .map(relation => [relation?.entityA || '', relation?.entityB || ''].map(name => makeExtractionNameKey(name, lorebook)).sort().join('::'))
                .filter(key => key && key !== '::'));
            return (Array.isArray(sourceRelations) ? sourceRelations : [])
                .map(relation => {
                    const entityA = String(relation?.entityA || relation?.nameA || '').trim();
                    const entityB = String(relation?.entityB || relation?.nameB || '').trim();
                    const key = [makeExtractionNameKey(entityA, lorebook), makeExtractionNameKey(entityB, lorebook)].sort().join('::');
                    if (!entityA || !entityB || !key || key === '::' || accepted.has(key)) return null;
                    return {
                        entityA,
                        entityB,
                        reason: (isWeakStandaloneEntityName(entityA) || isWeakStandaloneEntityName(entityB))
                            ? 'weak_relation_endpoint'
                            : 'unapproved_relation_endpoint'
                    };
                })
                .filter(Boolean);
        };
        const sanitizeExtractionPayload = (extractions = {}, lorebook = [], options = {}) => {
            const payload = (extractions && typeof extractions === 'object') ? extractions : {};
            const sourceMode = String(options?.sourceMode || payload?.sourceMode || 'conversation').trim() || 'conversation';
            const evidenceExemptSources = new Set(['correction', 'manual', 'cold_start_baseline', 'structured_packet', 'assistant_packet']);
            const rawEntities = Array.isArray(payload.entities) ? payload.entities : [];
            const rawRelations = Array.isArray(payload.relations) ? payload.relations : [];
            const conversationText = String(options?.conversationText || payload?.conversationText || payload?.sourceText || '').trim();
            const packetEvidenceEntities = Array.isArray(options?.packetEvidenceEntities)
                ? options.packetEvidenceEntities
                : (Array.isArray(payload?.packetEvidenceEntities)
                    ? payload.packetEvidenceEntities
                    : (sourceMode === 'structured_packet' ? rawEntities : []));
            const sanitizedEntities = sanitizeExtractedEntities(rawEntities, lorebook, {
                ...options,
                conversationText,
                requireConversationEvidenceForNew: typeof options?.requireConversationEvidenceForNew === 'boolean'
                    ? options.requireConversationEvidenceForNew
                    : !evidenceExemptSources.has(sourceMode),
                requireConversationEvidenceForKnown: typeof options?.requireConversationEvidenceForKnown === 'boolean'
                    ? options.requireConversationEvidenceForKnown
                    : sourceMode === 'reanalysis_supplement',
                packetEvidenceEntities,
                lorebook
            });
            const sanitizedRelations = sanitizeExtractedRelations(
                rawRelations,
                lorebook,
                sanitizedEntities.map(entity => entity?.name || '')
            );
            return {
                ...payload,
                sourceMode,
                conversationText,
                entities: sanitizedEntities,
                relations: sanitizedRelations,
                conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
                rejectedEntities: summarizeRejectedExtractionEntities(rawEntities, sanitizedEntities, lorebook),
                rejectedRelations: summarizeRejectedExtractionRelations(rawRelations, sanitizedRelations, lorebook)
            };
        };
        const buildEntityExtractionFallback = (conversationText, lorebook = []) => {
            // LLM-only degraded result: never synthesize entity/relation candidates locally.
            return {
                success: false,
                entities: [],
                relations: [],
                world: buildGenreSourceWorldPayload('', conversationText),
                conflicts: [],
                fallback: true,
                llmOnlyFallback: true,
                conversationText: String(conversationText || '').trim()
            };
        };

        const extractStructuredEntityPacketBlocks = (text = '') => {
            const raw = String(text || '');
            if (!raw) return [];
            const blocks = [];
            const seen = new Set();
            const patterns = [
                /HAYAKU_STATE_PACKET_START\s*([\s\S]*?)\s*HAYAKU_STATE_PACKET_END/gi,
                /HAYAKU_([A-Z0-9_]+)_START\s*([\s\S]*?)\s*HAYAKU_\1_END/gi,
                /LIBRA_STATE\s*START\s*([\s\S]*?)\s*LIBRA_STATE\s*END/gi,
                /LIBRA_[A-Z0-9_]+_START\s*([\s\S]*?)\s*LIBRA_[A-Z0-9_]+_END/gi
            ];
            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(raw))) {
                    const payload = String(match[2] || match[1] || '').replace(/^\s*<!--\s*/, '').replace(/\s*-->\s*$/, '').trim();
                    const parsed = extractStructuredJson(payload);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        let key = '';
                        try { key = JSON.stringify(parsed); } catch (_) { key = payload; }
                        if (key && seen.has(key)) continue;
                        if (key) seen.add(key);
                        blocks.push(parsed);
                    }
                }
            }
            return blocks;
        };

        const packetList = (value) => Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
        const packetHasValue = (value) => {
            if (value == null || value === '') return false;
            if (Array.isArray(value)) return value.some(packetHasValue);
            if (typeof value === 'object') return Object.values(value).some(packetHasValue);
            return String(value || '').trim().length > 0;
        };
        const packetFirstValue = (...values) => {
            for (const value of values) {
                if (packetHasValue(value)) return value;
            }
            return [];
        };
        const packetCollectValues = (...values) => values.flatMap(value => packetList(value)).filter(packetHasValue);
        const packetText = (value, max = 220) => {
            if (value == null) return '';
            if (typeof value === 'object') {
                const picked = value.summary || value.label || value.text || value.value || value.current_state || value.state || '';
                if (picked) return packetText(picked, max);
                try { return packetText(JSON.stringify(value), max); } catch { return ''; }
            }
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            return text.length > max ? `${text.slice(0, Math.max(24, max - 1)).trim()}…` : text;
        };
        const packetTextList = (value, limit = 10, max = 180) => dedupeTextArray(
            packetList(value).map(item => packetText(item, max)).filter(Boolean)
        ).slice(-limit);
        const packetNumber01 = (value, fallback = 0) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, Number(fallback || 0)));
            return Math.max(0, Math.min(1, numeric));
        };
        const packetEvidenceItems = (value, options = {}) => {
            const turn = Number(options.turn || MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0);
            const sourceMessageId = String(options.sourceMessageId || '').trim();
            const evidence = packetList(value).map(item => {
                if (typeof item === 'string') {
                    return { sourceKind: 'structured_packet', turn, messageId: sourceMessageId, snippet: packetText(item, 260), confidence: 0.85 };
                }
                if (!item || typeof item !== 'object') return null;
                return {
                    sourceKind: packetText(item.sourceKind || item.kind || 'structured_packet', 64),
                    turn: Number(item.turn || item.sourceTurn || turn || 0),
                    messageId: packetText(item.messageId || item.m_id || sourceMessageId, 96),
                    snippet: packetText(item.snippet || item.quote || item.text || item.summary || item.evidence || '', 260),
                    confidence: packetNumber01(item.confidence, 0.85)
                };
            }).filter(item => item && (item.snippet || item.messageId || item.turn));
            if (evidence.length > 0) return evidence.slice(-8);
            return sourceMessageId || turn ? [{ sourceKind: 'structured_packet', turn, messageId: sourceMessageId, snippet: '', confidence: 0.82 }] : [];
        };
        const packetName = (item = {}) => {
            const candidates = [
                item.name,
                item.canonicalName,
                item.displayName,
                item.characterName,
                item.entityName,
                item.title
            ];
            for (const candidate of candidates) {
                const text = packetText(candidate, 120);
                if (text) return text;
            }
            return '';
        };
        const packetAgeSexFromText = (text = '') => {
            const src = String(text || '');
            const match = src.match(/\b(\d{1,3})\s*([MF])\b/i) || src.match(/\b([MF])\s*(\d{1,3})\b/i);
            if (!match) return { age: '', sex: '' };
            const firstIsAge = /^\d+$/.test(match[1]);
            const age = Number(firstIsAge ? match[1] : match[2]);
            const sexMarker = String(firstIsAge ? match[2] : match[1]).toUpperCase();
            return {
                age: Number.isFinite(age) && age > 0 && age < 200 ? age : '',
                sex: sexMarker === 'F' ? 'female' : (sexMarker === 'M' ? 'male' : '')
            };
        };
        const packetEntityArrays = (packet = {}) => {
            const entityRoot = packet.entity && typeof packet.entity === 'object' ? packet.entity : {};
            return [
                ...packetList(entityRoot.characters),
                ...packetList(entityRoot.entities),
                ...packetList(entityRoot.character),
                ...packetList(entityRoot.people),
                ...packetList(packet.characters),
                ...packetList(packet.entities),
                ...packetList(packet.people),
                ...packetList(packet.character)
            ].filter(item => item && typeof item === 'object');
        };
        const packetRelationArrays = (packet = {}) => {
            const entityRoot = packet.entity && typeof packet.entity === 'object' ? packet.entity : {};
            return [
                ...packetList(entityRoot.relations),
                ...packetList(entityRoot.relationships),
                ...packetList(packet.relations),
                ...packetList(packet.relationships)
            ].filter(item => item && typeof item === 'object');
        };
        const packetPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const packetMergePlainObjects = (left = {}, right = {}) => {
            const next = safeClone(packetPlainObject(left));
            for (const [key, value] of Object.entries(packetPlainObject(right))) {
                if (value == null) continue;
                if (Array.isArray(value)) {
                    next[key] = dedupeTextArray([
                        ...(Array.isArray(next[key]) ? next[key] : []),
                        ...value.map(item => typeof item === 'string' ? item : packetText(item, 220)).filter(Boolean)
                    ]).slice(-24);
                } else if (value && typeof value === 'object') {
                    next[key] = packetMergePlainObjects(next[key], value);
                } else if (String(value || '').trim()) {
                    next[key] = value;
                }
            }
            return next;
        };
        const packetWorldRuleList = (value, limit = 12) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return Object.entries(value)
                    .map(([key, item]) => {
                        const text = packetText(item, 220);
                        return text ? `${key}: ${text}` : '';
                    })
                    .filter(Boolean)
                    .slice(-limit);
            }
            return packetTextList(value, limit, 220);
        };
        const structuredPacketWorldToExtraction = (packet = {}, options = {}) => {
            const worldRoot = packetPlainObject(packet.world);
            const narrativeRoot = packetPlainObject(packet.narrative);
            const guidanceRoot = packetPlainObject(packet.guidance || packet.guards);
            const classification = packetText(worldRoot.classification || worldRoot.genre || worldRoot.type || '', 160);
            const time = packetText(worldRoot.time || worldRoot.scene_time || worldRoot.sceneTime || worldRoot.current_time || '', 100);
            const location = packetText(worldRoot.location || worldRoot.current_location || worldRoot.currentLocation || worldRoot.place || '', 160);
            const scene = packetText(worldRoot.scene || worldRoot.scene_state || worldRoot.sceneState || worldRoot.current_scene || '', 260);
            const rules = packetWorldRuleList(worldRoot.rules || worldRoot.active_rules || worldRoot.activeRules || [], 12);
            const places = packetTextList(worldRoot.places || worldRoot.locations || worldRoot.facilities || [], 12, 180);
            const organizations = packetTextList(worldRoot.organizations || worldRoot.orgs || worldRoot.factions || [], 12, 180);
            const socialRules = packetTextList(worldRoot.social_rules || worldRoot.socialRules || worldRoot.culture || worldRoot.customs || [], 12, 220);
            const activeEvents = packetTextList(worldRoot.active_events || worldRoot.activeEvents || worldRoot.events || [], 12, 220);
            const offscreenThreads = packetTextList(worldRoot.offscreen_threads || worldRoot.offscreenThreads || [], 12, 220);
            const narrativeDeltas = packetTextList(narrativeRoot.scene_deltas || narrativeRoot.sceneDeltas || narrativeRoot.deltas || [], 10, 220);
            const continuityLocks = packetTextList(guidanceRoot.continuity_locks || guidanceRoot.continuityLocks || [], 10, 220);
            const exists = {};
            const systems = {};
            const classifiedRules = classifyWorldCanonStatements(rules);
            const setting = normalizeWorldSettingRules({
                places: [...places, ...classifiedRules.places],
                organizations: [...organizations, ...classifiedRules.organizations],
                socialRules: [...socialRules, ...classifiedRules.socialRules]
            });
            const custom = {};
            classifiedRules.custom.forEach((rule, index) => { custom[`packet_rule_${index + 1}`] = rule; });
            const physics = packetPlainObject(worldRoot.physics);
            const phenomena = normalizeWorldCanonTextList([worldRoot.phenomena, worldRoot.special_phenomena, classifiedRules.phenomena], 16);
            if (phenomena.length > 0) physics.special_phenomena = dedupeTextArray([...(Array.isArray(physics.special_phenomena) ? physics.special_phenomena : []), ...phenomena]);
            const output = {};
            if (classification) output.classification = { primary: classification };
            if (Object.keys(exists).length > 0) output.exists = exists;
            if (Object.keys(systems).length > 0) output.systems = systems;
            if (setting.places.length || setting.organizations.length || setting.socialRules.length) output.setting = setting;
            if (Object.keys(physics).length > 0) output.physics = safeClone(physics);
            if (Object.keys(custom).length > 0) output.custom = custom;
            output.state = {
                time,
                location,
                scene,
                activeEvents,
                offscreenThreads,
                narrativeDeltas,
                continuityLocks
            };
            const sourceText = packetText(options.sourceText || worldRoot.evidence || scene || [...rules, ...activeEvents].join(' | '), 600);
            if (sourceText) output.__genreSourceText = sourceText;
            return output;
        };
        const mergeStructuredPacketWorldExtractions = (left = {}, right = {}) => packetMergePlainObjects(left, right);
        const structuredPacketEntityToExtraction = (item = {}, options = {}) => {
            const name = packetName(item);
            if (!name) return null;
            const identitySummary = packetText(item.identity || item.role || item.roleInStory || item.summary || '', 260);
            const parsedIdentity = packetAgeSexFromText(identitySummary);
            const currentStateSummary = packetText(item.current_state || item.currentState || item.state || item.status || '', 260);
            const emotion = packetText(item.emotion || item.emotional_state || item.emotionalState || '', 140);
            const location = packetText(item.location || item.current_location || item.currentLocation || '', 160);
            const evidence = packetEvidenceItems(item.evidence || item.evidenceItems || item.quotes || [], options);
            const turn = Number(options.turn || MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0);
            const personalityText = packetText(item.personality || item.traits || '', 260);
            const speechText = packetText(item.speech_style || item.speechStyle || item.speech_pattern || item.speechPattern || '', 220);
            const psychologySource = item.psychology && typeof item.psychology === 'object' && !Array.isArray(item.psychology) ? item.psychology : {};
            const rawPsychologyText = typeof item.psychology === 'string'
                ? packetText(item.psychology, 220)
                : (Array.isArray(item.psychology) ? packetTextList(item.psychology, 6, 140).join('; ') : '');
            const explicitConflict = packetText(packetFirstValue(
                psychologySource.currentConflict,
                psychologySource.current_conflict,
                psychologySource.innerConflict,
                psychologySource.inner_conflict,
                psychologySource.internalConflict,
                psychologySource.internal_conflict,
                psychologySource.conflict,
                item.currentConflict,
                item.current_conflict,
                item.innerConflict,
                item.inner_conflict,
                item.internalConflict,
                item.internal_conflict,
                item.conflict
            ), 220);
            const psychologyBaseline = packetText(packetFirstValue(
                psychologySource.baseline,
                psychologySource.defaultState,
                psychologySource.default_state,
                psychologySource.core,
                item.baselinePsychology,
                item.psychologicalBaseline,
                item.psychological_baseline,
                explicitConflict ? '' : rawPsychologyText
            ), 220);
            const psychologyText = explicitConflict || packetText(packetFirstValue(
                item.interpretation,
                item.psyche,
                item.mentalState,
                item.mental_state,
                psychologyBaseline ? '' : rawPsychologyText
            ), 260);
            const psychologyNotes = packetTextList([
                ...packetList(psychologySource.notes || psychologySource.cues || psychologySource.signals || []),
                ...packetList(item.psychologicalNotes || item.psychological_notes || item.mentalNotes || item.mental_notes || []),
                rawPsychologyText && rawPsychologyText !== psychologyBaseline && rawPsychologyText !== psychologyText ? rawPsychologyText : ''
            ].filter(Boolean), 8, 180);
            const openThreadSource = packetCollectValues(
                item.openThreads,
                item.open_threads,
                item.activeThreads,
                item.active_threads,
                item.threads,
                item.unresolvedThreads,
                item.unresolved_threads,
                item.openLoops,
                item.open_loops,
                item.openHooks,
                item.open_hooks,
                item.plotHooks,
                item.plot_hooks,
                item.looseEnds,
                item.loose_ends,
                item.pendingQuestions,
                item.pending_questions,
                item.unresolved
            );
            const unresolvedNeedSource = packetCollectValues(item.unresolvedNeeds, item.unresolved_needs, item.needs, item.pendingNeeds, item.pending_needs);
            const commitmentSource = packetCollectValues(item.commitments, item.promises, item.obligations);
            const nextHintSource = packetCollectValues(item.nextActionHints, item.next_action_hints, item.next_actions, item.nextActions, item.nextSteps, item.next_steps, item.plannedNextSteps, item.planned_next_steps);
            return {
                name,
                aliases: packetTextList(item.aliases || item.alias || [], 12, 120),
                sex: normalizeBiologicalSex(item.sex || item.biologicalSex || parsedIdentity.sex || ''),
                appearance: {
                    features: packetTextList(item.appearance?.features || item.appearance || [], 10, 140),
                    distinctiveMarks: packetTextList(item.appearance?.distinctiveMarks || item.distinctiveMarks || [], 8, 140),
                    clothing: packetTextList(item.appearance?.clothing || item.clothing || [], 8, 140)
                },
                personality: {
                    traits: packetTextList([personalityText, ...(packetList(item.personality?.traits || item.traits))].filter(Boolean), 12, 160),
                    values: packetTextList(item.personality?.values || item.values || [], 8, 160),
                    fears: packetTextList(item.personality?.fears || item.fears || [], 8, 160),
                    likes: packetTextList(item.personality?.likes || item.likes || [], 8, 160),
                    dislikes: packetTextList(item.personality?.dislikes || item.dislikes || [], 8, 160),
                    sexualOrientation: '',
                    sexualPreferences: []
                },
                speechStyle: {
                    defaultTone: packetText(item.speechStyle?.defaultTone || item.defaultTone || '', 120),
                    honorificStyle: packetText(item.speechStyle?.honorificStyle || item.honorificStyle || '', 140),
                    toSuperiors: '',
                    toSubordinates: '',
                    toPeers: '',
                    toYounger: '',
                    notes: packetTextList([speechText, ...(packetList(item.speechStyle?.notes || item.speech_notes || []))].filter(Boolean), 10, 160)
                },
                background: {
                    origin: packetText(item.origin || item.background?.origin || '', 120),
                    occupation: packetText(item.occupation || item.job || item.background?.occupation || '', 120),
                    history: packetTextList(item.history || item.background?.history || [], 10, 180),
                    secrets: []
                },
                status: {
                    currentMood: emotion,
                    currentLocation: location,
                    healthStatus: packetText(item.health || item.healthStatus || '', 120),
                    notes: currentStateSummary
                },
                identity: {
                    age: parsedIdentity.age,
                    sex: normalizeBiologicalSex(item.sex || item.biologicalSex || parsedIdentity.sex || ''),
                    occupation: packetText(item.occupation || item.job || '', 120),
                    affiliation: packetText(item.affiliation || item.workplace || item.organization || '', 120),
                    roleInStory: packetText(item.roleInStory || item.role || item.relation_to_user || '', 180),
                    summary: identitySummary,
                    aliases: packetTextList(item.aliases || [], 12, 120),
                    honorifics: packetTextList(item.honorifics || item.honorificMarkers || [], 8, 80),
                    source: evidence[0] || null
                },
                profile: {
                    personality: {
                        traits: packetTextList([personalityText, ...(packetList(item.personality?.traits || item.traits))].filter(Boolean), 14, 160),
                        values: packetTextList(item.values || item.personality?.values || [], 8, 160),
                        fears: packetTextList(item.fears || item.personality?.fears || [], 8, 160),
                        likes: packetTextList(item.likes || item.personality?.likes || [], 8, 160),
                        dislikes: packetTextList(item.dislikes || item.personality?.dislikes || [], 8, 160),
                        vulnerabilities: packetTextList(item.vulnerabilities || item.weaknesses || [], 8, 180),
                        boundaries: packetTextList(item.boundaries || [], 8, 180),
                        workStyle: packetText(item.workStyle || item.work_style || '', 180),
                        socialStyle: packetText(item.socialStyle || item.social_style || '', 180),
                        confidence: packetNumber01(item.confidence, 0.8)
                    },
                    speechStyle: {
                        defaultTone: packetText(item.speechStyle?.defaultTone || '', 120),
                        honorificStyle: packetText(item.speechStyle?.honorificStyle || '', 140),
                        pressureMarkers: packetTextList(item.pressureMarkers || item.pressure_markers || [], 8, 100),
                        intimacyShift: packetText(item.intimacyShift || item.intimacy_shift || '', 180),
                        catchphrases: packetTextList(item.catchphrases || [], 8, 100),
                        notes: packetTextList([speechText, ...(packetList(item.speechStyle?.notes || []))].filter(Boolean), 10, 160)
                    },
                    psychology: {
                        baseline: psychologyBaseline,
                        currentConflict: psychologyText,
                        copingStyle: packetText(psychologySource.copingStyle || psychologySource.coping_style || psychologySource.coping || item.copingStyle || item.coping_style || item.coping || '', 180),
                        notes: psychologyNotes,
                        confidence: packetNumber01(item.confidence, 0.8)
                    }
                },
                currentState: {
                    summary: currentStateSummary,
                    sceneTime: packetText(item.sceneTime || item.scene_time || item.time || '', 80),
                    location,
                    physicalState: packetTextList(item.physicalState || item.physical_state || [], 10, 160),
                    emotionalState: packetTextList([emotion, ...(packetList(item.emotionalState || item.emotional_state || []))].filter(Boolean), 10, 160),
                    cognitiveFocus: packetTextList(item.cognitiveFocus || item.cognitive_focus || item.focus || [], 10, 180),
                    immediateGoal: packetText(item.immediateGoal || item.immediate_goal || item.goal || '', 220),
                    activeProblems: packetTextList(item.activeProblems || item.active_problems || item.problems || [], 10, 180),
                    lastObservedTurn: turn
                },
                continuity: {
                    openThreads: packetList(openThreadSource).map(thread => typeof thread === 'string' ? { label: thread, status: 'active' } : thread),
                    unresolvedNeeds: packetTextList(unresolvedNeedSource, 10, 180),
                    commitments: packetTextList(commitmentSource, 10, 180),
                    nextActionHints: packetTextList(nextHintSource, 10, 180)
                },
                povKnowledge: {
                    knownToSelf: packetTextList(item.knownToSelf || item.known_to_self || item.pov?.knownToSelf || [], 12, 180),
                    unknownToSelf: packetTextList(item.unknownToSelf || item.unknown_to_self || item.pov?.unknownToSelf || [], 12, 180),
                    knownToOthers: packetTextList(item.knownToOthers || item.known_to_others || [], 12, 180),
                    visibleTo: packetTextList(item.visibleTo || item.visible_to || [], 8, 120),
                    privateExperiences: packetTextList(item.privateExperiences || item.private_experiences || [], 10, 180),
                    privacy: packetText(item.privacy || '', 80)
                },
                episodeLedger: [
                    currentStateSummary ? {
                        eventId: `packet_state_${TokenizerEngine.simpleHash(`${name}:${turn}:${currentStateSummary}`)}`,
                        turn,
                        summary: currentStateSummary,
                        impact: packetText(item.impact || item.interpretation || '', 220),
                        stability: 'current_state',
                        evidence
                    } : null
                ].filter(Boolean),
                stateTimeline: [
                    currentStateSummary ? {
                        turn,
                        summary: currentStateSummary,
                        physicalState: packetTextList(item.physicalState || item.physical_state || [], 6, 140),
                        emotionalState: packetTextList([emotion, ...(packetList(item.emotionalState || item.emotional_state || []))].filter(Boolean), 6, 80),
                        cognitiveFocus: packetTextList(item.cognitiveFocus || item.cognitive_focus || item.focus || [], 6, 140),
                        sourceKind: 'structured_packet',
                        stability: 'turn_state',
                        evidence
                    } : null
                ].filter(Boolean),
                evidence,
                quality: {
                    confidence: packetNumber01(item.confidence, evidence.length ? 0.85 : 0.72),
                    salience: packetNumber01(item.salience, 0),
                    importance: packetNumber01(item.importance, 0),
                    pressure: packetNumber01(item.pressure, 0),
                    lastUpdatedTurn: turn,
                    sourceMix: ['structured_packet'],
                    staleness: 'fresh',
                    needsReview: false
                }
            };
        };
        const structuredPacketRelationToExtraction = (item = {}, options = {}) => {
            const endpoints = packetList(item.entities || item.participants || item.characters).map(value => packetText(value, 120)).filter(Boolean);
            const entityA = packetText(item.entityA || item.nameA || item.a || item.from || endpoints[0] || '', 120);
            const entityB = packetText(item.entityB || item.nameB || item.b || item.to || endpoints[1] || '', 120);
            if (!entityA || !entityB || entityA === entityB) return null;
            const state = packetText(item.current_state || item.currentState || item.state || item.summary || '', 240);
            const evidence = packetEvidenceItems(item.evidence || item.evidenceItems || [], options);
            const turn = Number(options.turn || MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0);
            const relationDynamics = item.dynamics && typeof item.dynamics === 'object' && !Array.isArray(item.dynamics) ? item.dynamics : {};
            const rawDynamicsText = typeof item.dynamics === 'string'
                ? packetText(item.dynamics, 200)
                : (Array.isArray(item.dynamics) ? packetTextList(item.dynamics, 8, 160).join('; ') : '');
            const relationEventText = packetText(item.event || state, 200);
            const unresolvedIssueSource = packetCollectValues(
                item.unresolvedIssues,
                item.unresolved_issues,
                item.openIssues,
                item.open_issues,
                item.pendingIssues,
                item.pending_issues,
                item.issues,
                item.unresolved,
                item.pendingQuestions,
                item.pending_questions,
                item.openQuestions,
                item.open_questions,
                item.tensions,
                item.openTensions,
                item.open_tensions,
                relationDynamics.unresolvedIssues,
                relationDynamics.unresolved_issues,
                relationDynamics.openIssues,
                relationDynamics.open_issues,
                relationDynamics.pendingIssues,
                relationDynamics.pending_issues,
                relationDynamics.issues,
                relationDynamics.unresolved,
                relationDynamics.tensions
            );
            const recentChangeSource = packetCollectValues(
                item.recentChanges,
                item.recent_changes,
                item.changes,
                item.relationshipChanges,
                item.relationship_changes,
                item.relationshipDeltas,
                item.relationship_deltas,
                item.relationDeltas,
                item.relation_deltas,
                item.deltas,
                relationDynamics.recentChanges,
                relationDynamics.recent_changes,
                relationDynamics.changes,
                relationDynamics.relationshipChanges,
                relationDynamics.relationship_changes,
                relationDynamics.relationshipDeltas,
                relationDynamics.relationship_deltas,
                relationDynamics.deltas,
                rawDynamicsText,
                relationEventText
            );
            return {
                entityA,
                entityB,
                relationType: packetText(item.relationType || item.type || item.kind || '', 100),
                howMet: packetText(item.howMet || item.how_met || '', 160),
                duration: packetText(item.duration || '', 80),
                closenessDelta: Number.isFinite(Number(item.closenessDelta ?? item.closeness_delta)) ? Number(item.closenessDelta ?? item.closeness_delta) : undefined,
                trustDelta: Number.isFinite(Number(item.trustDelta ?? item.trust_delta)) ? Number(item.trustDelta ?? item.trust_delta) : undefined,
                sentiments: {
                    fromAtoB: packetText(item.fromAtoB || item.from_a_to_b || item.sentiments?.fromAtoB || relationDynamics.fromAtoB || relationDynamics.from_a_to_b || '', 180),
                    fromBtoA: packetText(item.fromBtoA || item.from_b_to_a || item.sentiments?.fromBtoA || relationDynamics.fromBtoA || relationDynamics.from_b_to_a || '', 180),
                    currentTension: packetNumber01(item.currentTension ?? item.tension ?? item.sentiments?.currentTension, 0)
                },
                event: relationEventText,
                eventSentiment: packetText(item.eventSentiment || item.event_sentiment || '', 40),
                currentStatus: {
                    summary: state,
                    publicLayer: packetText(item.publicLayer || item.public_layer || '', 160),
                    privateLayer: packetText(item.privateLayer || item.private_layer || '', 180),
                    boundaryState: packetText(item.boundaryState || item.boundary_state || '', 140),
                    lastChangedTurn: turn
                },
                metrics: {
                    closeness: Number.isFinite(Number(item.closeness)) ? packetNumber01(item.closeness, 0) : null,
                    trust: Number.isFinite(Number(item.trust)) ? packetNumber01(item.trust, 0) : null,
                    tension: packetNumber01(item.tension, 0),
                    risk: packetNumber01(item.risk, 0),
                    ambiguity: packetNumber01(item.ambiguity, 0),
                    pressure: packetNumber01(item.pressure, 0)
                },
                dynamics: {
                    fromAtoB: packetTextList(relationDynamics.fromAtoB || relationDynamics.from_a_to_b || [], 8, 180),
                    fromBtoA: packetTextList(relationDynamics.fromBtoA || relationDynamics.from_b_to_a || [], 8, 180),
                    unresolvedIssues: packetTextList(unresolvedIssueSource, 10, 180),
                    recentChanges: packetTextList(recentChangeSource, 10, 180)
                },
                sharedContext: {
                    location: packetText(item.location || item.sharedContext?.location || '', 160),
                    workplace: packetText(item.workplace || item.sharedContext?.workplace || '', 160),
                    privateThreads: packetTextList(item.privateThreads || item.private_threads || item.sharedContext?.privateThreads || [], 10, 120),
                    notes: packetTextList(item.notes || item.sharedContext?.notes || [], 10, 180)
                },
                eventLedger: state ? [{
                    eventId: `packet_relation_${TokenizerEngine.simpleHash(`${entityA}:${entityB}:${turn}:${state}`)}`,
                    turn,
                    summary: state,
                    impact: packetText(item.impact || '', 220),
                    stability: 'relationship_relevant',
                    evidence
                }] : [],
                evidence,
                quality: {
                    confidence: packetNumber01(item.confidence, evidence.length ? 0.85 : 0.72),
                    salience: packetNumber01(item.salience, 0),
                    importance: packetNumber01(item.importance, 0),
                    pressure: packetNumber01(item.pressure, 0),
                    lastUpdatedTurn: turn,
                    sourceMix: ['structured_packet'],
                    staleness: 'fresh',
                    needsReview: false
                }
            };
        };
        const extractStructuredEntitySignalsFromPackets = (packetInput = [], options = {}) => {
            const packets = (Array.isArray(packetInput) ? packetInput : [packetInput])
                .filter(packet => packet && typeof packet === 'object' && !Array.isArray(packet));
            if (packets.length === 0) {
                return { success: false, entities: [], relations: [], world: {}, conflicts: [], sourceMode: 'structured_packet' };
            }
            const entities = [];
            const relations = [];
            let world = {};
            for (const packet of packets) {
                for (const item of packetEntityArrays(packet)) {
                    const entity = structuredPacketEntityToExtraction(item, options);
                    if (entity) entities.push(entity);
                }
                for (const item of packetRelationArrays(packet)) {
                    const relation = structuredPacketRelationToExtraction(item, options);
                    if (relation) relations.push(relation);
                }
                world = mergeStructuredPacketWorldExtractions(
                    world,
                    structuredPacketWorldToExtraction(packet, options)
                );
            }
            const hasWorld = !!(world && (
                world.classification ||
                (world.exists && Object.keys(world.exists).length > 0) ||
                (world.systems && Object.keys(world.systems).length > 0) ||
                (world.setting && Object.keys(world.setting).length > 0) ||
                (world.physics && Object.keys(world.physics).length > 0) ||
                (world.custom && Object.keys(world.custom).length > 0) ||
                String(world.__genreSourceText || '').trim()
            ));
            return {
                success: entities.length > 0 || relations.length > 0 || hasWorld,
                entities,
                relations,
                world,
                conflicts: [],
                sourceMode: 'structured_packet',
                conversationText: String(options.conversationText || options.sourceText || '').trim()
            };
        };
        const extractStructuredEntitySignals = (text = '', options = {}) => {
            const packets = extractStructuredEntityPacketBlocks(text);
            const result = extractStructuredEntitySignalsFromPackets(packets, {
                ...options,
                conversationText: String(options.conversationText || Utils.getMemorySourceText(text) || '').trim()
            });
            return result;
        };

        const compactExtractionText = (value = '', max = 220) => {
            let raw = '';
            if (Array.isArray(value)) {
                raw = value.map(item => typeof item === 'string' ? item : compactExtractionText(item, max)).filter(Boolean).join(', ');
            } else if (value && typeof value === 'object') {
                raw = Object.entries(value)
                    .map(([key, child]) => {
                        const text = compactExtractionText(child, Math.max(40, Math.floor(max / 2)));
                        return text ? `${key}=${text}` : '';
                    })
                    .filter(Boolean)
                    .join(' | ');
            } else {
                raw = String(value || '');
            }
            const normalized = raw.replace(/\s+/g, ' ').trim();
            return normalized ? truncateForLLM(normalized, max, ' ... ') : '';
        };

        const normalizeExtractionMatchText = (value = '') => String(value || '').toLowerCase().replace(/\s+/g, '').trim();

        const collectStoredEntityAliases = (entity = {}) => {
            const identity = entity?.identity && typeof entity.identity === 'object' ? entity.identity : {};
            return dedupeTextArray([
                entity?.name,
                entity?.canonicalName,
                ...(Array.isArray(entity?.aliases) ? entity.aliases : []),
                ...(Array.isArray(identity?.aliases) ? identity.aliases : []),
                ...(Array.isArray(identity?.honorifics) ? identity.honorifics : [])
            ].map(value => String(value || '').trim()).filter(Boolean)).slice(0, 12);
        };

        const scoreStoredEntityForExtraction = (entity = {}, conversationText = '', focusNames = []) => {
            const query = normalizeExtractionMatchText(conversationText);
            const focus = new Set((Array.isArray(focusNames) ? focusNames : []).map(normalizeExtractionMatchText).filter(Boolean));
            let score = 0;
            for (const alias of collectStoredEntityAliases(entity)) {
                const key = normalizeExtractionMatchText(alias);
                if (!key || key.length < 2) continue;
                if (query && query.includes(key)) score += 120;
                if (focus.has(key)) score += 80;
            }
            const metaUpdated = Number(entity?.meta?.updated || entity?.quality?.lastUpdatedTurn || 0) || 0;
            if (metaUpdated > 0) score += Math.min(24, metaUpdated / 4);
            if (entity?.meta?.manualLocked || entity?.meta?.nameManualLocked) score += 12;
            return score;
        };

        const formatEntityForExtractionPrompt = (entity = {}, options = {}) => {
            const safe = entity && typeof entity === 'object' ? entity : {};
            const identity = safe.identity && typeof safe.identity === 'object' ? safe.identity : {};
            const appearance = safe.appearance && typeof safe.appearance === 'object' ? safe.appearance : {};
            const personality = safe.personality && typeof safe.personality === 'object' ? safe.personality : {};
            const speechStyle = safe.speechStyle && typeof safe.speechStyle === 'object' ? safe.speechStyle : {};
            const background = safe.background && typeof safe.background === 'object' ? safe.background : {};
            const status = safe.status && typeof safe.status === 'object' ? safe.status : {};
            const currentState = safe.currentState && typeof safe.currentState === 'object' ? safe.currentState : {};
            const continuity = safe.continuity && typeof safe.continuity === 'object' ? safe.continuity : {};
            const profile = safe.profile && typeof safe.profile === 'object' ? safe.profile : {};
            const profilePersonality = profile.personality && typeof profile.personality === 'object' ? profile.personality : {};
            const profileSpeech = profile.speechStyle && typeof profile.speechStyle === 'object' ? profile.speechStyle : {};
            const aliases = collectStoredEntityAliases(safe).filter(alias => alias !== safe.name).slice(0, 7);
            const parts = [];
            const push = (key, value, max = 180) => {
                const text = compactExtractionText(value, max);
                if (text) parts.push(`${key}=${text}`);
            };
            const promptTraitItems = dedupeTextArray(
                [personality.traits, profilePersonality.traits, profilePersonality.vulnerabilities, profilePersonality.boundaries]
                    .flat()
                    .flatMap(item => compactExtractionText(item, 120).split(/\s*[,，、;；|]\s*/u))
                    .map(item => item.trim())
                    .filter(Boolean)
            ).slice(0, 10);
            push('aliases', aliases, 180);
            push('sex', normalizeBiologicalSex(safe.sex || safe.biologicalSex || identity.sex || ''), 24);
            push('role', [identity.roleInStory, identity.occupation, identity.affiliation, background.occupation].filter(Boolean).join(' / '), 180);
            push('identity', identity.summary, 260);
            push('appearance', [appearance.features, appearance.distinctiveMarks].flat().filter(Boolean).slice(0, 8), 260);
            push('traits', promptTraitItems, 280);
            push('speech', [speechStyle.defaultTone, speechStyle.honorificStyle, speechStyle.notes, profileSpeech.pressureMarkers, profileSpeech.intimacyShift].flat().filter(Boolean).slice(0, 10), 260);
            push('state', [status.currentMood, status.currentLocation, status.healthStatus, currentState.summary, currentState.location, currentState.immediateGoal].filter(Boolean).join(' | '), 260);
            push('threads', [continuity.openThreads, continuity.nextActionHints].flat().map(item => item?.label || item).filter(Boolean).slice(-6), 260);
            const line = `- ${safe.name || safe.canonicalName || '?'}${parts.length ? `: ${parts.join('; ')}` : ''}`;
            return truncateForLLM(line, Number(options.maxChars || 900) || 900, ' ... ');
        };

        const formatRelationForExtractionPrompt = (relation = {}, options = {}) => {
            const safe = relation && typeof relation === 'object' ? relation : {};
            const currentStatus = safe.currentStatus && typeof safe.currentStatus === 'object' ? safe.currentStatus : {};
            const dynamics = safe.dynamics && typeof safe.dynamics === 'object' ? safe.dynamics : {};
            const details = safe.details && typeof safe.details === 'object' ? safe.details : {};
            const parts = [];
            const push = (key, value, max = 160) => {
                const text = compactExtractionText(value, max);
                if (text) parts.push(`${key}=${text}`);
            };
            push('type', safe.relationType, 80);
            push('status', [currentStatus.summary, currentStatus.publicLayer, currentStatus.privateLayer, currentStatus.boundaryState].filter(Boolean).join(' | '), 240);
            push('event', safe.event || details.howMet || safe.howMet, 180);
            push('dynamics', [dynamics.fromAtoB, dynamics.fromBtoA, dynamics.unresolvedIssues, dynamics.recentChanges].flat().filter(Boolean).slice(0, 6), 260);
            return truncateForLLM(`- ${safe.entityA || '?'} <-> ${safe.entityB || '?'}${parts.length ? `: ${parts.join('; ')}` : ''}`, Number(options.maxChars || 520) || 520, ' ... ');
        };

        const buildEntityExtractionUserPayload = (options = {}) => {
            const storedInfo = String(options.storedInfo || '').trim() || 'none';
            const taskInstruction = String(options.taskInstruction || '').trim();
            const canonicalEvidenceText = String(options.canonicalEvidenceText || options.aiResponse || '').trim();
            const evidenceLabel = String(options.evidenceLabel || 'Canonical Assistant Evidence').trim() || 'Canonical Assistant Evidence';
            const evidenceContractLabel = String(options.evidenceContractLabel || evidenceLabel).trim() || evidenceLabel;
            const hasEvidencePolicy = Object.prototype.hasOwnProperty.call(options, 'evidencePolicy');
            const evidencePolicy = options.evidencePolicy === false
                ? ''
                : String(hasEvidencePolicy ? options.evidencePolicy || '' : LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY || '').trim();
            const characterEntityHintBlock = String(options.characterEntityHintBlock || '').trim();
            const memoryHintBlock = String(options.memoryHintBlock || '').trim();
            return [
                taskInstruction ? `[Task Instruction]\n${taskInstruction}` : '',
                evidencePolicy,
                '[Known LIBRA Entity State - compact]',
                storedInfo,
                '',
                `[${evidenceLabel}]`,
                canonicalEvidenceText || '(empty)',
                characterEntityHintBlock ? `\n[External Stable Entity Cues]\n${characterEntityHintBlock}` : '',
                memoryHintBlock ? `\n[Long-Term Memory Cues]\n${memoryHintBlock}` : '',
                '',
                '[Output Contract]',
                'Return one sparse JSON object: {"spans":[],"entities":[],"relations":[],"world":{},"conflicts":[],"uncertain":[],"rejected":[]}',
                `Omit empty nested fields. Missing field = no update. New entities require direct span evidence in ${evidenceContractLabel}.`
            ].filter(part => String(part || '').trim()).join('\n');
        };

        const extractFromConversation = async (userMsg, aiResponse, storedInfo, config, options = {}) => {
            if (!config.useLLM) return { success: true, entities: [], relations: [], world: {}, conflicts: [] };

            const normalizedStoredInfo = String(storedInfo || '').trim() || 'none';
            const normalizedUserMsg = String(userMsg || '').trim();
            const normalizedAiResponse = String(aiResponse || '').trim();
            const analysisConfig = {
                ...(config || {}),
                analysisEvidenceMode: normalizeAnalysisEvidenceMode(options?.analysisEvidenceMode || config?.analysisEvidenceMode)
            };
            const taskInstruction = String(options?.taskInstruction || normalizedUserMsg || '').trim();
            const userRequestMetadata = String(options?.userRequestMetadata || '').trim();
            const canonicalEvidenceText = String(options?.canonicalEvidenceText || normalizedAiResponse || '').trim();
            const userEvidenceText = String(options?.userEvidenceText || userRequestMetadata || normalizedUserMsg || '').trim();
            const assistantEvidenceText = String(options?.assistantEvidenceText || normalizedAiResponse || '').trim();
            const extractionEvidenceLabel = String(options?.evidenceLabel || getAnalysisEvidenceLabel(analysisConfig)).trim() || getAnalysisEvidenceLabel(analysisConfig);
            const extractionEvidencePolicy = options?.evidencePolicy === false ? '' : String(options?.evidencePolicy || getAnalysisEvidencePolicy(analysisConfig)).trim();
            const safeConversation = canonicalEvidenceText || '(no current-turn evidence provided)';
            const profileOverride = String(config?.__preferredProfile || '').trim().toLowerCase() || undefined;
            const extractionLorebook = Array.isArray(options?.lorebook) ? options.lorebook : [];
            const fallbackEntityPrompt = [
                "You are LIBRA\'s LLM-only NER-style entity extraction engine.",
                'Identify exact source spans first, classify them, and promote only directly supported person/character entities.',
                'Return JSON only with keys: spans, entities, relations, world, conflicts, uncertain, rejected.'
            ].join(' ');
            const systemInstruction = [
                String(EntityExtractionPrompt || fallbackEntityPrompt).trim(),
                getAnalysisEvidenceSystemOverride(analysisConfig)
            ].filter(Boolean).join('\n\n');
            const characterEntityHintBlock = String(options?.characterEntityHintBlock || config?.__characterEntityHintBlock || '').trim();
            const memoryHintBlock = AnalysisMemoryHintBridge.format(options?.memoryHints || config?.__analysisMemoryHints || [], {
                title: options?.memoryHintTitle || 'Long-Term Compact Memory Hints for Entity/World Analysis'
            });
            const userContent = buildEntityExtractionUserPayload({
                storedInfo: normalizedStoredInfo,
                taskInstruction,
                canonicalEvidenceText,
                evidenceLabel: extractionEvidenceLabel,
                evidenceContractLabel: extractionEvidenceLabel,
                evidencePolicy: extractionEvidencePolicy,
                characterEntityHintBlock,
                memoryHintBlock
            }) || `[대화]\n${safeConversation}`;
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('log', '[LIBRA] Entity extraction prompt budget:', {
                    analysisEvidenceMode: getAnalysisEvidenceMode(analysisConfig),
                    analysisIncludesUserInput: analysisIncludesUserInput(analysisConfig),
                    evidenceLabel: extractionEvidenceLabel,
                    systemChars: systemInstruction.length,
                    userChars: userContent.length,
                    storedChars: normalizedStoredInfo.length,
                    taskInstructionChars: taskInstruction.length,
                    userRequestMetadataChars: userRequestMetadata.length,
                    userEvidenceChars: userEvidenceText.length,
                    assistantEvidenceChars: assistantEvidenceText.length,
                    canonicalEvidenceChars: canonicalEvidenceText.length,
                    characterHintChars: characterEntityHintBlock.length,
                    memoryHintChars: memoryHintBlock.length
                });
            }
            const ENTITY_EXTRACTION_JSON_SHAPE = '{"spans":[],"entities":[],"relations":[],"world":{},"conflicts":[],"uncertain":[],"rejected":[]}';
            const ENTITY_EXTRACTION_JSON_KEYS = ['spans', 'entities', 'relations', 'world', 'conflicts', 'uncertain', 'rejected'];
            const hasEntityExtractionContractKey = (value) => !!(value && typeof value === 'object' && !Array.isArray(value)
                && ENTITY_EXTRACTION_JSON_KEYS.some(key => Object.prototype.hasOwnProperty.call(value, key)));
            const hasEntityExtractionContractShape = (value) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
                const arrayKeys = ['spans', 'entities', 'relations', 'conflicts', 'uncertain', 'rejected'];
                if (arrayKeys.some(key => Object.prototype.hasOwnProperty.call(value, key) && !Array.isArray(value[key]))) return false;
                if (Object.prototype.hasOwnProperty.call(value, 'world') && (!value.world || typeof value.world !== 'object' || Array.isArray(value.world))) return false;
                return hasEntityExtractionContractKey(value);
            };
            const diagnoseEntityExtractionParseFailure = (rawText = '', parsed = null) => {
                const text = Utils.stripLLMThinkingTags(rawText || '').trim();
                if (!text) return 'empty_response';
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return hasEntityExtractionContractKey(parsed) ? 'schema_invalid' : 'wrong_json_shape';
                }
                const openCurly = (text.match(/\{/g) || []).length;
                const closeCurly = (text.match(/\}/g) || []).length;
                const openSquare = (text.match(/\[/g) || []).length;
                const closeSquare = (text.match(/\]/g) || []).length;
                if (openCurly > closeCurly || openSquare > closeSquare || /finishReason=length|```json/i.test(text)) return 'truncated';
                return 'parse_failed';
            };
            const parseEntityExtractionAttempt = (rawText) => {
                const content = Utils.stripLLMThinkingTags(rawText || '');
                const parsed = extractStructuredJson(content);
                if (hasEntityExtractionContractShape(parsed)) {
                    return { parsed, reason: 'ok', rawContent: content };
                }
                return {
                    parsed: null,
                    reason: diagnoseEntityExtractionParseFailure(content, parsed),
                    rawContent: content
                };
            };
            const tryParseEntityExtraction = (rawText) => parseEntityExtractionAttempt(rawText).parsed;
            const conversationTextForExtraction = canonicalEvidenceText;
            const finalizeParsedExtraction = (parsed, extra = {}) => {
                const packetEvidenceResult = extractStructuredEntitySignals(conversationTextForExtraction, {
                    lorebook: extractionLorebook,
                    conversationText: conversationTextForExtraction,
                    sourceMessageId: options?.sourceMessageId || options?.messageId || '',
                    turn: options?.turn || MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0
                });
                // V5.2.7 live entity materialization patch:
                // Unified afterRequest analysis may pass canonical-packet derived evidence
                // separately from the plain assistant text. Preserve that evidence through
                // the standalone extractor so NER sanitation can accept packet-grounded
                // entities/relations instead of dropping every new endpoint.
                const suppliedPacketEvidenceEntities = Array.isArray(parsed?.packetEvidenceEntities)
                    ? parsed.packetEvidenceEntities
                    : (Array.isArray(options?.packetEvidenceEntities) ? options.packetEvidenceEntities : []);
                const packetEvidenceEntities = [
                    ...suppliedPacketEvidenceEntities,
                    ...(packetEvidenceResult?.success ? (packetEvidenceResult.entities || []) : [])
                ];
                const parsedSourceMode = String(extra?.sourceMode || parsed?.sourceMode || parsed?.source || '').trim();
                const packetBackedExtraction = /^(structured_packet|assistant_packet|canonical_packet)$/i.test(parsedSourceMode)
                    || suppliedPacketEvidenceEntities.length > 0;
                const llmEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
                const sanitizedEntities = sanitizeExtractedEntities(llmEntities, extractionLorebook, {
                    conversationText: conversationTextForExtraction,
                    requireConversationEvidenceForNew: !packetBackedExtraction,
                    packetEvidenceEntities,
                    lorebook: extractionLorebook
                });
                const sanitizedRelations = sanitizeExtractedRelations(
                    parsed.relations || [],
                    extractionLorebook,
                    sanitizedEntities.map(entity => entity?.name || '')
                );
                const worldPayload = (parsed.world && typeof parsed.world === 'object') ? { ...parsed.world } : buildGenreSourceWorldPayload('', canonicalEvidenceText);
                worldPayload.__genreSourceText = canonicalEvidenceText;
                return {
                    success: true,
                    entities: sanitizedEntities,
                    relations: sanitizedRelations,
                    world: worldPayload,
                    conflicts: parsed.conflicts || [],
                    spans: Array.isArray(parsed.spans) ? parsed.spans : [],
                    uncertain: Array.isArray(parsed.uncertain) ? parsed.uncertain : [],
                    rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
                    conversationText: conversationTextForExtraction,
                    packetEvidenceEntities,
                    ...extra,
                    sourceMode: parsedSourceMode || extra?.sourceMode || 'conversation',
                    packetBackedExtraction
                };
            };
            const isRetryableExtractionFailure = (error) => /EMPTY_RESPONSE|returned no text content|finishReason=(?:unknown|length)|provider_stream_(?:idle|first_chunk)?_?timeout|STREAM_TIMEOUT|timeout|context(?:_| )length|too many tokens|prompt (?:is )?too long|input (?:is )?too long|API_PARSE_ERROR|not valid JSON|JSON at position|Expected double-quoted property name|Unexpected token/i.test(String(error?.message || error || ''));
            const buildCompactExtractionPrompts = () => ({
                system: [
                    fallbackEntityPrompt,
                    'Use NER-style span-first extraction. Do not infer or synthesize names.',
                    'Entities must be person/character only and must have direct evidence in the supplied text.',
                    'If extraction cannot be done safely, return empty arrays rather than guessing.',
                    'Return compact JSON only. No markdown.'
                ].join('\n'),
                user: [
                    '[Stored summary]',
                    truncateForLLM(normalizedStoredInfo, 3200, '\n...[TRUNCATED]...\n'),
                    '',
                    extractionEvidencePolicy,
                    '',
                    canonicalEvidenceText ? `[${extractionEvidenceLabel}]\n${truncateForLLM(canonicalEvidenceText, 3600, '\n...[TRUNCATED]...\n')}` : '',
                    '',
                    '[Required JSON]',
                    ENTITY_EXTRACTION_JSON_SHAPE
                ].filter(Boolean).join('\n')
            });
            const buildDegradedFallback = (error, reason = 'provider_failure') => {
                const fallback = buildEntityExtractionFallback(conversationTextForExtraction, extractionLorebook);
                return {
                    ...fallback,
                    success: false,
                    degraded: true,
                    fallbackReason: reason,
                    error: String(error?.message || error || ''),
                    conversationText: conversationTextForExtraction
                };
            };
            const runCompactExtractionRetry = async (error, reason = 'compact_rescue') => {
                try {
                    const compact = buildCompactExtractionPrompts();
                    const retried = await LLMProvider.call(config, compact.system, compact.user, {
                        maxTokens: 2400,
                        label: 'entity-extraction-rescue-current-turn',
                        profile: profileOverride
                    });
                    const parsedRetry = tryParseEntityExtraction(retried?.content || '');
                    if (parsedRetry) {
                        recordRuntimeDebug('warn', '[LIBRA] Entity extraction recovered with current-turn rescue:', {
                            reason,
                            originalError: String(error?.message || error || '')
                        });
                        return finalizeParsedExtraction(parsedRetry, {
                            degraded: true,
                            retry: 'current_turn_rescue',
                            fallbackReason: reason,
                            originalError: String(error?.message || error || '')
                        });
                    }
                } catch (retryError) {
                    if (MemoryEngine.CONFIG?.debug) {
                        recordRuntimeDebug('warn', '[LIBRA] Entity extraction current-turn rescue failed:', {
                            reason,
                            originalError: String(error?.message || error || ''),
                            retryError: retryError?.message || String(retryError || '')
                        });
                    }
                }
                return null;
            };
            const runEntityExtractionRepair = async (rawContent, parseReason = 'parse_failed') => {
                const repairSystem = [
                    'You repair malformed LIBRA entity extraction output into valid JSON.',
                    'Preserve only facts directly supported by Stored Context, Canonical Assistant Evidence, or the malformed output.',
                    'Return exactly one JSON object with keys: spans, entities, relations, world, conflicts, uncertain, rejected.',
                    'Do not add commentary. Do not use markdown.'
                ].join(' ');
                const repairUser = [
                    '[Parse Failure]',
                    parseReason || 'parse_failed',
                    '',
                    '[Stored Context and Canonical Evidence Payload]',
                    userContent,
                    '',
                    '[Malformed Output]',
                    String(rawContent || '').trim() || '(empty)',
                    '',
                    '[Required JSON shape]',
                    ENTITY_EXTRACTION_JSON_SHAPE
                ].join('\n');
                const repaired = await LLMProvider.call(config, repairSystem, repairUser, {
                    maxTokens: 3200,
                    label: 'entity-extraction-repair',
                    profile: profileOverride
                });
                return parseEntityExtractionAttempt(repaired?.content || '');
            };
            const runFullExtractionFallback = async (failureMeta = {}) => {
                const fallbackSystem = [
                    systemInstruction,
                    '',
                    '[Second-pass JSON Recovery]',
                    'The previous extraction output was invalid or unusable. Re-run extraction from the supplied payload.',
                    'Use the same evidence rules. Do not infer or synthesize names.',
                    'Return valid JSON only. No markdown.'
                ].filter(Boolean).join('\n');
                const fallbackUser = [
                    '[Previous Failure]',
                    JSON.stringify({
                        primaryReason: failureMeta?.primaryReason || '',
                        repairReason: failureMeta?.repairReason || ''
                    }),
                    '',
                    userContent,
                    '',
                    '[Required JSON]',
                    ENTITY_EXTRACTION_JSON_SHAPE
                ].join('\n');
                const fallback = await LLMProvider.call(config, fallbackSystem, fallbackUser, {
                    maxTokens: 6500,
                    label: 'entity-extraction-full-fallback',
                    profile: profileOverride
                });
                return parseEntityExtractionAttempt(fallback?.content || '');
            };

            const precomputedExtraction = (options?.precomputedExtraction || options?.precomputedEntityExtraction);
            if (precomputedExtraction && typeof precomputedExtraction === 'object' && !Array.isArray(precomputedExtraction)) {
                try {
                    return finalizeParsedExtraction(precomputedExtraction, {
                        precomputed: true,
                        retry: '',
                        fallbackReason: '',
                        sourceMode: options?.precomputedSourceMode || 'afterrequest_unified_analysis'
                    });
                } catch (precomputedError) {
                    if (MemoryEngine.CONFIG?.debug) {
                        recordRuntimeDebug('warn', '[LIBRA] Precomputed entity extraction was rejected; falling back to standalone extraction:', precomputedError?.message || precomputedError);
                    }
                }
            }

            try {
                const result = await LLMProvider.call(config, systemInstruction, userContent, { maxTokens: 6500, label: 'entity-extraction-ner-style', profile: profileOverride });
                const primaryAttempt = parseEntityExtractionAttempt(result?.content || '');
                let parsed = primaryAttempt.parsed;
                let repairAttempt = null;
                if (!parsed) {
                    if (MemoryEngine.CONFIG?.debug) {
                        recordRuntimeDebug('warn', '[LIBRA] Entity extraction primary JSON parse failed:', {
                            reason: primaryAttempt.reason || 'parse_failed',
                            chars: String(primaryAttempt.rawContent || '').length
                        });
                    }
                    try {
                        repairAttempt = await runEntityExtractionRepair(primaryAttempt.rawContent, primaryAttempt.reason);
                        parsed = repairAttempt?.parsed || null;
                    } catch (repairError) {
                        repairAttempt = {
                            parsed: null,
                            reason: 'repair_call_failed',
                            error: String(repairError?.message || repairError || '')
                        };
                        if (MemoryEngine.CONFIG?.debug) {
                            recordRuntimeDebug('warn', '[LIBRA] Entity extraction repair call failed:', repairAttempt.error);
                        }
                    }
                }
                if (!parsed) {
                    try {
                        const fallbackAttempt = await runFullExtractionFallback({
                            primaryReason: primaryAttempt.reason,
                            repairReason: repairAttempt?.reason || ''
                        });
                        if (fallbackAttempt?.parsed) {
                            return finalizeParsedExtraction(fallbackAttempt.parsed, {
                                degraded: true,
                                retry: 'full_fallback',
                                fallbackReason: fallbackAttempt.reason || repairAttempt?.reason || primaryAttempt.reason || 'invalid_json',
                                originalParseReason: primaryAttempt.reason || ''
                            });
                        }
                        if (MemoryEngine.CONFIG?.debug) {
                            recordRuntimeDebug('warn', '[LIBRA] Entity extraction full fallback did not return usable JSON:', {
                                primaryReason: primaryAttempt.reason || '',
                                repairReason: repairAttempt?.reason || '',
                                fallbackReason: fallbackAttempt?.reason || 'parse_failed'
                            });
                        }
                    } catch (fallbackError) {
                        if (MemoryEngine.CONFIG?.debug) {
                            recordRuntimeDebug('warn', '[LIBRA] Entity extraction full fallback failed:', fallbackError?.message || String(fallbackError || ''));
                        }
                    }
                }
                if (!parsed) {
                    const rescued = await runCompactExtractionRetry(new Error(primaryAttempt.reason || 'No valid JSON found'), 'invalid_json');
                    if (rescued) return rescued;
                    return buildDegradedFallback(new Error(primaryAttempt.reason || 'No valid JSON found'), 'invalid_json');
                }
                return finalizeParsedExtraction(parsed);
            } catch (e) {
                const retryable = isRetryableExtractionFailure(e);
                const rescued = await runCompactExtractionRetry(e, retryable ? 'provider_retryable_failure' : 'provider_failure');
                if (rescued) return rescued;
                if (retryable) {
                    const fallback = buildDegradedFallback(e, 'provider_empty_response');
                    recordRuntimeDebug('warn', '[LIBRA] Entity extraction degraded LLM-only fallback used:', e?.message);
                    return fallback;
                }
                recordRuntimeDebug('error', '[LIBRA] Entity extraction failed:', e?.message);
                return {
                    success: false,
                    entities: [],
                    relations: [],
                    world: buildGenreSourceWorldPayload('', canonicalEvidenceText),
                    conflicts: [],
                    error: e?.message,
                    conversationText: conversationTextForExtraction
                };
            }
        };
        const sanitizeCorrectionPayload = (payload) => ({
            shouldCorrect: !!payload?.shouldCorrect,
            reasons: Array.isArray(payload?.reasons) ? payload.reasons.map(v => String(v || '').trim()).filter(Boolean).slice(0, 6) : [],
            correctedEntities: Array.isArray(payload?.correctedEntities) ? payload.correctedEntities.filter(item => item && item.name) : [],
            correctedRelations: Array.isArray(payload?.correctedRelations) ? payload.correctedRelations.filter(item => item && item.entityA && item.entityB) : [],
            world: (payload?.world && typeof payload.world === 'object' && !Array.isArray(payload.world)) ? payload.world : {},
            narrative: (payload?.narrative && typeof payload.narrative === 'object' && !Array.isArray(payload.narrative)) ? payload.narrative : {}
        });
        const hasCorrectionPayload = (payload) => {
            if (!payload || typeof payload !== 'object') return false;
            if (Array.isArray(payload.correctedEntities) && payload.correctedEntities.length > 0) return true;
            if (Array.isArray(payload.correctedRelations) && payload.correctedRelations.length > 0) return true;
            if (payload.world && typeof payload.world === 'object' && Object.keys(payload.world).length > 0) return true;
            if (payload.narrative && typeof payload.narrative === 'object') {
                if (String(payload.narrative.summary || '').trim()) return true;
                if (Array.isArray(payload.narrative.entities) && payload.narrative.entities.length > 0) return true;
            }
            return false;
        };
        const buildTurnCorrectionUserContent = (userMsg, aiResponse, extracted) => {
            const snapshot = {
                entities: Array.isArray(extracted?.entities) ? extracted.entities : [],
                relations: Array.isArray(extracted?.relations) ? extracted.relations : [],
                world: extracted?.world && typeof extracted.world === 'object' ? extracted.world : {}
            };
            const narrativeState = NarrativeTracker.getState?.() || { turnLog: [] };
            const lastNarrativeTurn = Array.isArray(narrativeState.turnLog) ? narrativeState.turnLog[narrativeState.turnLog.length - 1] : null;
            const canonicalEvidenceText = String(aiResponse || '').trim();
            return [
                LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY,
                ``,
                `[Canonical Assistant Evidence]`,
                canonicalEvidenceText || '(empty)',
                ``,
                `[Current Extracted State]`,
                JSON.stringify(snapshot, null, 2),
                ``,
                `[Current Stored Info]`,
                EntityAwareProcessor.formatStoredInfoForExtraction(6, {
                    conversationText: canonicalEvidenceText,
                    maxChars: 4200
                }) || 'none',
                ``,
                `[Current World Context]`,
                HierarchicalWorldManager.formatForPrompt() || 'none',
                ``,
                `[Current Narrative Context]`,
                lastNarrativeTurn ? JSON.stringify(lastNarrativeTurn, null, 2) : 'none'
            ].join('\n');
        };
        const verifyTurnCorrections = async (userMsg, aiResponse, extracted, config) => {
            if (!config?.useLLM) return null;
            const profile = (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux'))
                ? resolveAnalysisProfile(config)
                : null;
            if (!profile) return null;
            try {
                const result = await runMaintenanceLLM(() =>
                    LLMProvider.call(
                        config,
                        TurnStateCorrectionPrompt,
                        buildTurnCorrectionUserContent(userMsg, aiResponse, extracted),
                        { maxTokens: 1200, profile, label: `turn-correction-${profile}` }
                    )
                , `turn-correction-${profile}`);
                const parsed = extractStructuredJson(result?.content || '');
                return parsed ? sanitizeCorrectionPayload(parsed) : null;
            } catch (e) {
                if (config.debug) recordRuntimeDebug('warn', '[LIBRA] Turn correction verification failed:', e?.message || e);
                return null;
            }
        };

        const compactEntityForAbsorptionPrompt = (entity = {}) => {
            const clone = safeClone(entity && typeof entity === 'object' ? entity : {});
            if (clone.meta) {
                clone.meta = {
                    aliases: Array.isArray(clone.meta.aliases) ? clone.meta.aliases.slice(0, 12) : [],
                    nameManualLocked: clone.meta.nameManualLocked === true,
                    manualLocked: clone.meta.manualLocked === true,
                    absorbedSources: Array.isArray(clone.meta.absorbedSources) ? clone.meta.absorbedSources.slice(-8) : []
                };
            }
            if (Array.isArray(clone.evidence)) clone.evidence = clone.evidence.slice(-6);
            if (Array.isArray(clone.episodeLedger)) clone.episodeLedger = clone.episodeLedger.slice(-6);
            if (Array.isArray(clone.stateTimeline)) clone.stateTimeline = clone.stateTimeline.slice(-6);
            return clone;
        };
        const buildEntityAbsorptionPrompts = (task = {}, sourceEntity = {}, targetEntity = {}) => {
            const system = [
                'You are LIBRA entity absorption merge planner.',
                'A user marked SOURCE as a wrongly split entity that must be absorbed into TARGET.',
                'Return JSON only. Do not rename TARGET. Do not create a new entity. Do not add SOURCE name as a TARGET alias.',
                'Merge and reinterpret useful facts from SOURCE into TARGET fields. Preserve TARGET identity when fields conflict.',
                'Never overwrite a manually locked target name, identity, speech style, or POV secret unless the source provides clearly compatible supporting detail.'
            ].join('\n');
            const user = [
                '[Task]',
                JSON.stringify({
                    id: task.id,
                    sourceName: task.sourceName,
                    targetName: task.targetName,
                    reason: task.reason || ''
                }, null, 2),
                '',
                '[SOURCE entity to absorb]',
                truncateForLLM(JSON.stringify(compactEntityForAbsorptionPrompt(sourceEntity), null, 2), 5200, '\n...[TRUNCATED SOURCE]...\n'),
                '',
                '[TARGET canonical entity]',
                truncateForLLM(JSON.stringify(compactEntityForAbsorptionPrompt(targetEntity), null, 2), 5200, '\n...[TRUNCATED TARGET]...\n'),
                '',
                '[Required JSON]',
                JSON.stringify({
                    id: task.id,
                    sourceName: task.sourceName,
                    targetName: task.targetName,
                    confidence: 0.0,
                    targetPatch: {
                        identity: {},
                        profile: {},
                        currentState: {},
                        continuity: {},
                        povKnowledge: {},
                        appearance: {},
                        personality: {},
                        speechStyle: {},
                        background: {},
                        status: {},
                        episodeLedger: [],
                        evidence: [],
                        quality: {}
                    },
                    conflicts: [],
                    reviewNotes: []
                }, null, 2)
            ].join('\n');
            return { system, user };
        };
        const sanitizeEntityAbsorptionPlan = (task = {}, parsed = {}) => {
            if (!task?.id || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            const patch = parsed.targetPatch || parsed.patch || parsed.targetEntity || parsed.entity || {};
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
            const targetPatch = safeClone(patch);
            delete targetPatch.id;
            delete targetPatch.name;
            delete targetPatch.key;
            if (targetPatch.meta && typeof targetPatch.meta === 'object') {
                delete targetPatch.meta.name;
                delete targetPatch.meta.nameManualLocked;
                delete targetPatch.meta.nameManualLockedAt;
                delete targetPatch.meta.absorption;
            }
            return {
                id: task.id,
                sourceName: task.sourceName,
                targetName: task.targetName,
                targetPatch,
                confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0) || 0)),
                conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) : [],
                reviewNotes: Array.isArray(parsed.reviewNotes) ? parsed.reviewNotes.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) : []
            };
        };
        const planPendingEntityAbsorptions = async (lorebook = [], config = {}, options = {}) => {
            if (!config?.useLLM) return [];
            const profile = (LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux'))
                ? resolveAnalysisProfile(config)
                : null;
            if (!profile) return [];
            const maxTasks = Math.max(1, Math.min(3, Number(options.maxTasks || 1) || 1));
            try {
                const liveEntityCacheSize = Number(EntityManager.getEntityCache?.()?.size || 0);
                const liveRelationCacheSize = Number(EntityManager.getRelationCache?.()?.size || 0);
                const preserveLiveEntityCache = options?.preserveLiveEntityCache === true
                    && (liveEntityCacheSize > 0 || liveRelationCacheSize > 0);
                if (!preserveLiveEntityCache) EntityManager.rebuildCache(lorebook);
                const pending = EntityManager.listPendingEntityAbsorptions(lorebook).slice(0, maxTasks);
                const plans = [];
                for (const task of pending) {
                    const sourceEntity = EntityManager.getEntityCache().get(task.sourceName) || task.sourceSnapshot || {};
                    const targetEntity = EntityManager.getEntityCache().get(task.targetName);
                    if (!targetEntity) continue;
                    const prompts = buildEntityAbsorptionPrompts(task, sourceEntity, targetEntity);
                    const result = await runMaintenanceLLM(() =>
                        LLMProvider.call(config, prompts.system, prompts.user, {
                            maxTokens: 1600,
                            profile,
                            label: `entity-absorption-${profile}`
                        })
                    , `entity-absorption-${task.id}`);
                    const parsed = extractStructuredJson(Utils.stripLLMThinkingTags(result?.content || ''));
                    const plan = sanitizeEntityAbsorptionPlan(task, parsed);
                    if (plan) plans.push(plan);
                }
                return plans;
            } catch (e) {
                if (config.debug) recordRuntimeDebug('warn', '[LIBRA] Entity absorption planning failed:', e?.message || e);
                return [];
            }
        };

        const applyExtractions = async (extractions, lorebook, config, m_id = null) => {
            const sourceMode = String(extractions?.sourceMode || 'conversation').trim() || 'conversation';
            const sanitizedPayload = sanitizeExtractionPayload(extractions, lorebook, { sourceMode });
            const sanitizedEntities = sanitizedPayload.entities || [];
            const sanitizedRelations = sanitizedPayload.relations || [];
            const world = sanitizedPayload.world;
            const conflicts = Array.isArray(sanitizedPayload.conflicts) ? sanitizedPayload.conflicts : [];
            const appliedChanges = [];
            const s_id = MemoryState.currentSessionId;
            const forceReplace = sourceMode === 'correction';
            const allowManualOverride = extractions?.allowManualOverride === true;
            try {
                EntityCandidateCore?.recordExtractionCandidates?.(lorebook, extractions, sanitizedPayload, {
                    source: 'entityExtraction',
                    reason: 'not_promoted',
                    sourceMode,
                    turn: MemoryState.currentTurn,
                    m_id,
                    userText: sanitizedPayload.conversationText || extractions?.conversationText || ''
                });
            } catch (candidateError) {
                if (config.debug) recordRuntimeDebug('warn', '[LIBRA] Entity candidate recording skipped:', candidateError?.message || candidateError);
            }

            for (const entityData of sanitizedEntities) {
                if (!entityData.name) continue;
                const consistency = EntityManager.checkConsistency(entityData.name, entityData, lorebook);
                if (!consistency.consistent && config.debug) {
                    recordRuntimeDebug('warn', `[LIBRA] Entity consistency warning:`, consistency.conflicts);
                }
                const updated = EntityManager.updateEntity(entityData.name, {
                    sex: entityData.sex || entityData.biologicalSex || '',
                    appearance: entityData.appearance,
                    personality: entityData.personality,
                    speechStyle: entityData.speechStyle,
                    background: entityData.background,
                    status: entityData.status,
                    identity: entityData.identity,
                    profile: entityData.profile,
                    currentState: entityData.currentState || entityData.current_state,
                    continuity: entityData.continuity,
                    povKnowledge: entityData.povKnowledge || entityData.pov_knowledge,
                    episodeLedger: entityData.episodeLedger || entityData.episode_ledger,
                    stateTimeline: entityData.stateTimeline || entityData.state_timeline,
                    evidence: entityData.evidence,
                    quality: entityData.quality,
                    source: sourceMode,
                    forceReplace,
                    allowManualOverride,
                    s_id, m_id
                }, lorebook);
                if (updated) appliedChanges.push(`Entity "${entityData.name}" updated`);
            }

            // Merge entities that are the same person (e.g., Korean name ↔ English name)
            EntityManager.collapseDuplicates();
            try {
                EntityCandidateCore?.prunePromotedOrBlocked?.(lorebook, {
                    source: 'entityExtraction.applyExtractions',
                    turn: MemoryState.currentTurn
                });
            } catch (candidatePruneError) {
                if (config.debug) recordRuntimeDebug('warn', '[LIBRA] Entity candidate prune skipped:', candidatePruneError?.message || candidatePruneError);
            }

            for (const relationData of sanitizedRelations) {
                if (!relationData.entityA || !relationData.entityB) continue;
                const relationDetails = (relationData.details && typeof relationData.details === 'object') ? relationData.details : {};
                const relationSentiments = (relationData.sentiments && typeof relationData.sentiments === 'object')
                    ? relationData.sentiments
                    : (relationData.sentiment ? { fromAtoB: String(relationData.sentiment || '') } : undefined);
                const relationDynamicsSource = relationData.dynamics && typeof relationData.dynamics === 'object' && !Array.isArray(relationData.dynamics)
                    ? relationData.dynamics
                    : {};
                const rawRelationDynamics = relationData.dynamics && (typeof relationData.dynamics === 'string' || Array.isArray(relationData.dynamics))
                    ? relationData.dynamics
                    : [];
                const relationEventText = relationData.event
                    || relationDetails.event
                    || packetText(relationData.currentStatus || relationData.current_state || relationData.status || '', 220);
                const relationDynamicsPayload = {
                    ...relationDynamicsSource,
                    unresolvedIssues: packetCollectValues(
                        relationData.unresolvedIssues,
                        relationData.unresolved_issues,
                        relationData.openIssues,
                        relationData.open_issues,
                        relationData.pendingIssues,
                        relationData.pending_issues,
                        relationData.issues,
                        relationData.unresolved,
                        relationData.pendingQuestions,
                        relationData.pending_questions,
                        relationDynamicsSource.unresolvedIssues,
                        relationDynamicsSource.unresolved_issues,
                        relationDynamicsSource.openIssues,
                        relationDynamicsSource.open_issues,
                        relationDynamicsSource.pendingIssues,
                        relationDynamicsSource.pending_issues,
                        relationDynamicsSource.issues,
                        relationDynamicsSource.unresolved
                    ),
                    recentChanges: packetCollectValues(
                        relationData.recentChanges,
                        relationData.recent_changes,
                        relationData.changes,
                        relationData.relationshipChanges,
                        relationData.relationship_changes,
                        relationData.relationshipDeltas,
                        relationData.relationship_deltas,
                        relationData.relationDeltas,
                        relationData.relation_deltas,
                        relationDynamicsSource.recentChanges,
                        relationDynamicsSource.recent_changes,
                        relationDynamicsSource.changes,
                        relationDynamicsSource.relationshipChanges,
                        relationDynamicsSource.relationship_changes,
                        rawRelationDynamics,
                        relationEventText
                    )
                };
                const updated = EntityManager.updateRelation(relationData.entityA, relationData.entityB, {
                    relationType: relationData.relationType || relationData.type,
                    details: {
                        howMet: relationData.howMet || relationDetails.howMet,
                        duration: relationData.duration || relationDetails.duration,
                        closeness: relationData.closenessDelta ?? relationData.closeness_change ?? relationDetails.closenessDelta ?? relationDetails.closeness,
                        trust: relationData.trustDelta ?? relationData.trust_change ?? relationDetails.trustDelta ?? relationDetails.trust
                    },
                    sentiments: relationSentiments,
                    currentStatus: relationData.currentStatus || relationData.current_state || relationData.status,
                    metrics: relationData.metrics,
                    dynamics: relationDynamicsPayload,
                    sharedContext: relationData.sharedContext || relationData.shared_context,
                    eventLedger: relationData.eventLedger || relationData.event_ledger,
                    evidence: relationData.evidence,
                    quality: relationData.quality,
                    event: relationEventText,
                    eventSentiment: relationData.eventSentiment || relationData.event_sentiment || relationDetails.eventSentiment || relationDetails.event_sentiment,
                    source: sourceMode,
                    forceReplace,
                    allowManualOverride,
                    s_id, m_id
                }, lorebook);
                if (updated) appliedChanges.push(`Relation "${relationData.entityA} ↔ ${relationData.entityB}" updated`);
            }

            const hasWorldPayload = !!(world && (
                world.classification ||
                (world.exists && Object.keys(world.exists).length > 0) ||
                (world.systems && Object.keys(world.systems).length > 0) ||
                (world.physics && Object.keys(world.physics).length > 0) ||
                (world.custom && Object.keys(world.custom).length > 0) ||
                String(world.__genreSourceText || '').trim()
            ));

            if (hasWorldPayload) {
                const worldProfile = HierarchicalWorldManager.getProfile();
                if (worldProfile && worldProfile.nodes.size > 0) {
                    const activePath = HierarchicalWorldManager.getActivePath();
                    const currentNodeId = activePath.length > 0 ? activePath[activePath.length - 1] : null;
                    if (currentNodeId) {
                        const currentNode = worldProfile.nodes.get(currentNodeId);
                        const worldRuleUpdate = normalizeWorldRuleUpdate(world);
                        const worldMetaPayload = buildWorldMetaPayload(world, currentNode?.meta || {});
                        const mode = String(config.worldAdjustmentMode || 'dynamic').toLowerCase();
                        const intent = WorldAdjustmentManager.analyzeUserIntent(_lastUserMessage || '', []);
                        const effectiveRules = HierarchicalWorldManager.getEffectiveRules(currentNodeId);
                        const conflictsDetected = WorldAdjustmentManager.detectConflict(
                            buildWorldConflictProbe(worldRuleUpdate),
                            {
                                rules: effectiveRules || {},
                                consistency: currentNode?.consistency || worldProfile.consistency || {}
                            }
                        );
                        const llmAuthoritativeSource = /^(afterrequest_unified_analysis|structured_packet|assistant_packet|conversation|cold_start|cold_start_baseline|manual|correction|world_reanalysis|user_correction)$/i.test(String(sourceMode || ''));
                        const allowUpdate =
                            mode === 'soft' ||
                            conflictsDetected.length === 0 ||
                            (mode === 'dynamic' && llmAuthoritativeSource);

                        if (allowUpdate) {
                            HierarchicalWorldManager.updateNode(currentNodeId, { rules: worldRuleUpdate, meta: worldMetaPayload });
                            appliedChanges.push(`World rules updated (${mode})`);
                            if (conflictsDetected.length > 0) {
                                conflicts.push(...conflictsDetected.map(c => ({ ...c, handledBy: mode })));
                            }
                        } else {
                            conflicts.push(...conflictsDetected.map(c => ({ ...c, blockedBy: mode || 'hard' })));
                        }
                    }
                }
            }

            return { applied: appliedChanges, warnings: conflicts || [] };
        };

        const formatStoredInfo = (maxEntities = 10) => {
            const parts = [];
            const entities = Array.from(EntityManager.getEntityCache().values())
                .filter(entity => EntityManager.isPromptVisibleEntityRecord?.(entity) !== false)
                .slice(0, maxEntities);
            if (entities.length > 0) {
                parts.push('[인물 정보]');
                for (const entity of entities) parts.push(EntityManager.formatEntityForPrompt(entity));
            }
            const visibleNames = new Set(entities.map(entity => String(entity?.name || '').trim()).filter(Boolean));
            const relations = Array.from(EntityManager.getRelationCache().values())
                .filter(relation => visibleNames.has(relation?.entityA) && visibleNames.has(relation?.entityB))
                .slice(0, maxEntities * 2);
            if (relations.length > 0) {
                parts.push('\n[관계 정보]');
                for (const relation of relations) parts.push(EntityManager.formatRelationForPrompt(relation));
            }
            return parts.join('\n');
        };

        const formatStoredInfoForExtraction = (maxEntities = 8, options = {}) => {
            const conversationText = String(options?.conversationText || '').trim();
            const explicitFocusNames = Array.isArray(options?.focusNames) ? options.focusNames : [];
            const extractedFocusNames = typeof extractEntityRefs === 'function'
                ? extractEntityRefs(conversationText, { includeGeneric: false }).slice(0, 16)
                : [];
            const focusNames = dedupeTextArray([...explicitFocusNames, ...extractedFocusNames].map(value => String(value || '').trim()).filter(Boolean));
            const limit = Math.max(1, Math.min(16, Number(maxEntities || 8) || 8));
            const maxChars = Math.max(1200, Math.min(12000, Number(options?.maxChars || 5200) || 5200));
            const visibleEntities = Array.from(EntityManager.getEntityCache().values())
                .filter(entity => EntityManager.isPromptVisibleEntityRecord?.(entity) !== false);
            const scoredEntities = visibleEntities
                .map(entity => ({
                    entity,
                    score: scoreStoredEntityForExtraction(entity, conversationText, focusNames),
                    updated: Number(entity?.meta?.updated || entity?.quality?.lastUpdatedTurn || 0) || 0
                }))
                .sort((a, b) => b.score - a.score || b.updated - a.updated);
            const hasFocusedEntity = scoredEntities.some(item => item.score >= 80);
            const selectedEntities = (hasFocusedEntity ? scoredEntities.filter(item => item.score > 0) : scoredEntities)
                .slice(0, limit)
                .map(item => item.entity);
            const parts = [];
            if (selectedEntities.length > 0) {
                parts.push('[Known Entities]');
                for (const entity of selectedEntities) {
                    const line = formatEntityForExtractionPrompt(entity, { maxChars: Number(options?.entityChars || 820) || 820 });
                    if (line) parts.push(line);
                }
            }
            const selectedNames = new Set(selectedEntities.map(entity => String(entity?.name || '').trim()).filter(Boolean));
            const relations = Array.from(EntityManager.getRelationCache().values())
                .map(relation => {
                    const a = String(relation?.entityA || '').trim();
                    const b = String(relation?.entityB || '').trim();
                    const keyText = `${a}\n${b}\n${relation?.relationType || ''}\n${relation?.currentStatus?.summary || ''}`;
                    const direct = normalizeExtractionMatchText(conversationText);
                    const relationScore = [
                        normalizeExtractionMatchText(a),
                        normalizeExtractionMatchText(b)
                    ].filter(Boolean).reduce((sum, key) => sum + (direct && direct.includes(key) ? 80 : 0), 0);
                    const selectedScore = (selectedNames.has(a) ? 40 : 0) + (selectedNames.has(b) ? 40 : 0);
                    return { relation, score: relationScore + selectedScore + (keyText ? 1 : 0) };
                })
                .filter(item => item.score >= 40)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit * 2)
                .map(item => item.relation);
            if (relations.length > 0) {
                parts.push('\n[Known Relations]');
                for (const relation of relations) {
                    const line = formatRelationForExtractionPrompt(relation, { maxChars: Number(options?.relationChars || 480) || 480 });
                    if (line) parts.push(line);
                }
            }
            if (parts.length === 0) return 'none';
            return truncateForLLM(parts.join('\n'), maxChars, '\n...[TRUNCATED STORED ENTITY STATE]...\n');
        };

        return {
            extractFromConversation,
            extractStructuredEntitySignals,
            extractStructuredEntitySignalsFromPackets,
            applyExtractions,
            formatStoredInfo,
            formatStoredInfoForExtraction,
            verifyTurnCorrections,
            hasCorrectionPayload,
            planPendingEntityAbsorptions,
            inferWorldClassificationLabel,
            sanitizeEntities: sanitizeExtractedEntities,
            sanitizeRelations: sanitizeExtractedRelations,
            sanitizeExtractionPayload
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [PROCESSOR] World Adjustment Manager
    // ══════════════════════════════════════════════════════════════
const WorldAdjustmentManager = (() => {
    const stringifyRuleValue = (value) => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    };
    const compareRuleTrees = (area, nextValue, existingValue, path = []) => {
        const conflicts = [];
        const currentPath = path.join('.');

        if (nextValue === undefined) return conflicts;

        if (Array.isArray(nextValue)) {
            const existingArray = Array.isArray(existingValue) ? existingValue.map(item => stringifyRuleValue(item)) : [];
            const additions = nextValue
                .map(item => stringifyRuleValue(item))
                .filter(item => !existingArray.includes(item));
            if (additions.length > 0) {
                conflicts.push({
                    area,
                    key: currentPath,
                    type: 'rule_array_violation',
                    existing: existingValue,
                    new: nextValue,
                    description: `${currentPath || area}: ${additions.join(', ')} added outside established world rules`
                });
            }
            return conflicts;
        }

        if (nextValue && typeof nextValue === 'object') {
            const existingObject = (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)) ? existingValue : {};
            for (const [key, childValue] of Object.entries(nextValue)) {
                conflicts.push(...compareRuleTrees(area, childValue, existingObject[key], [...path, key]));
            }
            return conflicts;
        }

        if (existingValue !== undefined && stringifyRuleValue(existingValue) !== stringifyRuleValue(nextValue)) {
            conflicts.push({
                area,
                key: currentPath,
                type: 'rule_value_violation',
                existing: existingValue,
                new: nextValue,
                description: `${currentPath || area}: ${stringifyRuleValue(existingValue)} -> ${stringifyRuleValue(nextValue)}`
            });
        }
        return conflicts;
    };
    const analyzeUserIntent = (userMessage, conflictInfo) => {
        return {
            type: 'llm_authoritative_patch',
            confidence: 0.75,
            reason: 'World updates are governed by structured LLM/correction payloads; local text intent heuristics are disabled.'
        };
    };

    // 충돌 감지
    const detectConflict = (newInfo, worldProfile) => {
        if (!worldProfile) return [];

        const conflicts = [];
        const rules = worldProfile.rules || {};
        conflicts.push(...compareRuleTrees('exists', newInfo.exists || {}, rules.exists || {}));
        conflicts.push(...compareRuleTrees('systems', newInfo.systems || {}, rules.systems || {}));
        conflicts.push(...compareRuleTrees('physics', newInfo.physics || {}, rules.physics || {}));
        conflicts.push(...compareRuleTrees('custom', newInfo.custom || {}, rules.custom || {}));

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
