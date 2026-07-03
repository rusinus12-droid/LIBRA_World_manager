    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Cold Start Manager
    // ══════════════════════════════════════════════════════════════
    const ColdStartManager = (() => {
        let isProcessing = false;
        const STRICT_JSON_OUTPUT_RULES = `

[엄격 출력 규칙 / Strict Output Rules]
- 응답은 JSON 객체 또는 JSON 배열 하나만 반환하십시오.
- 절대로 사용자의 입력 내용을 그대로 반복하거나 출력에 포함하지 마십시오. NEVER echo, repeat, or include the user's input text in your output.
- 첫 글자는 반드시 { 또는 [ 이어야 합니다.
- 마지막 글자는 반드시 } 또는 ] 이어야 합니다.
- 코드블록, Markdown, 설명문, 인사말, 주석, 사고흐름, reasoning, analysis, note, explanation, prefix/suffix를 절대 출력하지 마십시오.
- JSON 앞뒤에 어떤 문자도 붙이지 마십시오.
- 확신이 낮아도 설명하지 말고, 빈 배열/빈 문자열/기본 필드로 유효한 JSON만 반환하십시오.
- JSON 외 텍스트를 한 글자라도 출력하면 실패입니다.`;

        const ColdStartSummaryPrompt = `당신은 과거 대화 내역을 분석하여 핵심 요약을 생성하는 전문가입니다.
제공된 대화 청크를 분석하여 다음 정보를 JSON 형식으로 추출하십시오.

{
    "events": ["주요 사건 리스트"],
    "characters": [
        { "name": "이름", "details": "외모/성격/배경 요약", "role": "서사 역할", "currentState": "현재 상태", "speechStyle": "말투 단서", "psychology": "심리/갈등 단서", "evidence": ["짧은 근거 단서"] }
    ],
    "relationships": [
        { "pair": ["A", "B"], "status": "관계 요약", "dynamics": ["관계 동역학"], "evidence": ["짧은 근거 단서"] }
    ],
    "world_rules": ["감지된 세계관 규칙"]
}

[보수적 추출 규칙 / Conservative Extraction Rules]
- Assistant/AI lines are canonical evidence for what happened. User messages are request metadata only and must not be treated as completed events unless confirmed by assistant evidence.
- If a user request conflicts with the assistant response, the assistant response is canonical.
- Stable appearance, personality, background, relationship, and world facts may be extracted only when they are explicitly established by the provided text.
- role, currentState, speechStyle, psychology, dynamics, and evidence must be short, grounded cues only; do not invent continuity.
- evidence must be a concise paraphrased source cue, not a long verbatim transcript.
- Lines under "[Auxiliary module hints]" are lower-priority runtime cues extracted from companion modules such as HAYAKU or image commands. Use them only when they support or clarify visible prose; never let them override contradictory visible conversation.
- Do not infer physical traits, sexual body details, sexual attitudes, sexual preferences, identity labels, occupation, or current location from gender, genre convention, tone, or weak implication.
- Sexual body details, sexual preferences, and sexual attitudes must be recorded only if explicitly stated and necessary for later continuity; otherwise omit them.
- If a detail is unknown or merely plausible, leave it out rather than guessing.

[출력 언어 규칙 / Output Language Rules]
- 이름(name)은 반드시 "한글(English)" 형식으로 작성하십시오. (e.g. "정수진(Jeong Sujin)", "히비키(Hibiki)")
- 내부 데이터 언어 가드가 목표 언어를 지정하면 그 목표 언어를 우선하십시오. 가드가 없으면 이름을 제외한 모든 서술(details, events, status, world_rules 등)은 영문으로 작성하십시오.
- Names MUST be in "한글(English)" format. If the LIBRA Internal Data Language Guard specifies a target language, follow it for descriptions; otherwise write all non-name descriptions in English.

주의: 반드시 유효한 JSON 구조만 반환하십시오. 다른 설명은 생략하십시오.${STRICT_JSON_OUTPUT_RULES}`;

        const FinalSynthesisPrompt = `당신은 여러 개의 대화 요약본을 하나로 통합하는 마스터 편집자입니다.
분할된 요약 데이터들을 바탕으로, 이 채팅방의 현재 상태를 정의하는 최종 보고서를 JSON 형식으로 작성하십시오.

반환 형식:
{
    "narrative": "전체 줄거리 요약",
    "narrativeDetails": {
        "storylines": [
            { "name": "스토리라인 이름", "context": "현재 맥락", "keyPoints": ["핵심 포인트"], "ongoingTensions": ["진행 중 갈등"], "entities": ["관련 인물"] }
        ]
    },
    "entities": [
        {
            "name": "이름", "sex": "male|female|", "appearance": "외모", "personality": "성격", "background": "배경",
            "identity": { "age": "", "occupation": "", "affiliation": "", "roleInStory": "", "summary": "", "aliases": [], "honorifics": [] },
            "profile": { "personality": { "values": [], "fears": [], "likes": [], "dislikes": [], "boundaries": [] }, "speechStyle": { "defaultTone": "", "honorificStyle": "", "pressureMarkers": [], "catchphrases": [], "notes": [] }, "psychology": { "baseline": "", "currentConflict": "", "copingStyle": "", "notes": [] } },
            "currentState": { "summary": "", "sceneTime": "", "location": "", "physicalState": [], "emotionalState": [], "cognitiveFocus": [], "immediateGoal": "", "activeProblems": [] },
            "continuity": { "openThreads": [{ "label": "", "status": "active", "pressure": 0 }], "unresolvedNeeds": [], "commitments": [], "nextActionHints": [] },
            "povKnowledge": { "knownToSelf": [], "unknownToSelf": [], "knownToOthers": [], "visibleTo": [], "privateExperiences": [], "privacy": "" },
            "episodeLedger": [{ "turn": 0, "summary": "", "impact": "", "stability": "current_state" }],
            "evidence": [{ "sourceKind": "cold_start", "turn": 0, "snippet": "짧은 근거 단서", "confidence": 0.7 }],
            "quality": { "confidence": 0.7, "salience": 0.5, "importance": 0.5, "pressure": 0, "needsReview": false }
        }
    ],
    "relations": [
        {
            "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태",
            "currentStatus": { "summary": "", "publicLayer": "", "privateLayer": "", "boundaryState": "" },
            "metrics": { "closeness": 0, "trust": 0, "tension": 0, "risk": 0, "ambiguity": 0, "pressure": 0 },
            "dynamics": { "fromAtoB": [], "fromBtoA": [], "unresolvedIssues": [], "recentChanges": [] },
            "sharedContext": { "location": "", "workplace": "", "privateThreads": [], "notes": [] },
            "eventLedger": [{ "turn": 0, "summary": "", "impact": "", "stability": "current_state" }],
            "evidence": [{ "sourceKind": "cold_start", "turn": 0, "snippet": "짧은 근거 단서", "confidence": 0.7 }],
            "quality": { "confidence": 0.7, "salience": 0.5, "importance": 0.5, "pressure": 0 }
        }
    ],
    "world": { "tech": "기술수준", "rules": ["규칙들"] }
}

[보수적 추출 규칙 / Conservative Extraction Rules]
- Assistant/AI-derived summaries are canonical evidence for what happened. User requests are not evidence that an event occurred unless confirmed by assistant evidence.
- If a user request conflicts with assistant evidence, assistant evidence wins.
- entities.sex, appearance, personality, background, and occupation must contain only stable details explicitly supported by the input summaries. sex must be exactly "male" or "female" only when explicitly supported; otherwise leave it empty.
- Current location is transient scene/world state; leave entity.currentState.location empty and never place current location in background.
- Use extended entity/relation fields when the summaries explicitly support current state, continuity, POV knowledge, psychology, relationship pressure, or evidence. Leave unsupported subfields empty.
- profile.psychology.baseline/currentConflict/copingStyle should capture supported inner posture, unresolved inner conflict, and recurring stress response; do not hide these in personality.
- continuity.openThreads should capture unresolved personal plot hooks, unanswered questions, pending promises/risks, or choices that should be recalled later.
- When legacy entity fields overlap with identity/profile/currentState, treat identity/profile/currentState as canonical and keep legacy fields as short compatible mirrors. Never write conflicting values between them.
- evidence.snippet must be a concise paraphrased evidence cue, not a long verbatim transcript.
- Auxiliary module hints from HAYAKU/image-command cues are lower-priority evidence. Use them only to preserve scene/current-state hints that are compatible with visible conversation.
- Do not infer physical traits, sexual body details, sexual attitudes, sexual preferences, identity labels, occupation, or current location from gender, genre convention, tone, or weak implication.
- Sexual body details, sexual preferences, and sexual attitudes may be included only when explicitly stated and necessary for later continuity; otherwise omit them.
- If a detail is unknown, leave the field empty or omit the claim instead of guessing.
- If occupation is explicit and current, put it in background with an "Occupation: ..." label.

[출력 언어 규칙 / Output Language Rules]
- 이름(name)은 반드시 "한글(English)" 형식으로 작성하십시오. (e.g. "정수진(Jeong Sujin)", "히비키(Hibiki)")
- 내부 데이터 언어 가드가 목표 언어를 지정하면 그 목표 언어를 우선하십시오. 가드가 없으면 이름을 제외한 모든 서술(appearance, personality, narrative 등)은 영문으로 작성하십시오.
- Names MUST be in "한글(English)" format. If the LIBRA Internal Data Language Guard specifies a target language, follow it for descriptions; otherwise write all non-name descriptions in English.

주의: 반드시 JSON만 반환하십시오.${STRICT_JSON_OUTPUT_RULES}`;
        const StructuredMergePrompt = `당신은 여러 개의 부분 구조 보고서를 하나의 최종 구조 보고서로 병합하는 편집자입니다.
제공된 부분 보고서들을 통합하여 현재 채팅방의 최종 상태를 가장 일관되게 나타내는 JSON을 작성하십시오.

반환 형식:
{
    "narrative": "전체 줄거리 요약",
    "narrativeDetails": {
        "storylines": [
            { "name": "스토리라인 이름", "context": "현재 맥락", "keyPoints": ["핵심 포인트"], "ongoingTensions": ["진행 중 갈등"], "entities": ["관련 인물"] }
        ]
    },
    "entities": [
        {
            "name": "이름", "sex": "male|female|", "appearance": "외모", "personality": "성격", "background": "배경",
            "identity": { "age": "", "occupation": "", "affiliation": "", "roleInStory": "", "summary": "", "aliases": [], "honorifics": [] },
            "profile": { "personality": { "values": [], "fears": [], "likes": [], "dislikes": [], "boundaries": [] }, "speechStyle": { "defaultTone": "", "honorificStyle": "", "pressureMarkers": [], "catchphrases": [], "notes": [] }, "psychology": { "baseline": "", "currentConflict": "", "copingStyle": "", "notes": [] } },
            "currentState": { "summary": "", "sceneTime": "", "location": "", "physicalState": [], "emotionalState": [], "cognitiveFocus": [], "immediateGoal": "", "activeProblems": [] },
            "continuity": { "openThreads": [{ "label": "", "status": "active", "pressure": 0 }], "unresolvedNeeds": [], "commitments": [], "nextActionHints": [] },
            "povKnowledge": { "knownToSelf": [], "unknownToSelf": [], "knownToOthers": [], "visibleTo": [], "privateExperiences": [], "privacy": "" },
            "episodeLedger": [{ "turn": 0, "summary": "", "impact": "", "stability": "current_state" }],
            "evidence": [{ "sourceKind": "cold_start", "turn": 0, "snippet": "짧은 근거 단서", "confidence": 0.7 }],
            "quality": { "confidence": 0.7, "salience": 0.5, "importance": 0.5, "pressure": 0, "needsReview": false }
        }
    ],
    "relations": [
        {
            "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태",
            "currentStatus": { "summary": "", "publicLayer": "", "privateLayer": "", "boundaryState": "" },
            "metrics": { "closeness": 0, "trust": 0, "tension": 0, "risk": 0, "ambiguity": 0, "pressure": 0 },
            "dynamics": { "fromAtoB": [], "fromBtoA": [], "unresolvedIssues": [], "recentChanges": [] },
            "sharedContext": { "location": "", "workplace": "", "privateThreads": [], "notes": [] },
            "eventLedger": [{ "turn": 0, "summary": "", "impact": "", "stability": "current_state" }],
            "evidence": [{ "sourceKind": "cold_start", "turn": 0, "snippet": "짧은 근거 단서", "confidence": 0.7 }],
            "quality": { "confidence": 0.7, "salience": 0.5, "importance": 0.5, "pressure": 0 }
        }
    ],
    "world": { "tech": "기술수준", "rules": ["규칙들"] }
}

규칙:
- 부분 보고서의 근거는 assistant/AI evidence에서 확인된 사건을 우선하십시오. 사용자 요청만 있는 내용은 발생 사실로 확정하지 마십시오.
- 부분 보고서들 사이의 중복은 제거하고, 더 구체적이고 일관된 내용을 우선하십시오.
- 서로 충돌하는 경우 가장 많이 지지되거나 더 구체적인 정보를 우선하십시오.
- 확장 엔티티/관계 필드(identity/profile/currentState/continuity/povKnowledge/evidence/quality 등)는 근거 있는 값만 누적 병합하고, 근거 없는 하위 필드는 빈 값으로 두십시오.
- profile.psychology에는 근거 있는 심리 기준선, 현재 내적 갈등, 반복적 대처 방식을 넣고 성격과 섞지 마십시오.
- continuity.openThreads에는 나중에 회수해야 할 미해결 개인 떡밥, 질문, 약속, 위험, 선택지를 넣으십시오.
- evidence.snippet은 긴 원문 복사가 아니라 짧은 근거 단서여야 합니다.
- 이름(name)은 반드시 "한글(English)" 형식으로 유지하십시오.
- 내부 데이터 언어 가드가 목표 언어를 지정하면 그 목표 언어를 우선하십시오. 가드가 없으면 이름을 제외한 모든 서술은 영문으로 작성하십시오.
- 반드시 JSON만 반환하십시오.${STRICT_JSON_OUTPUT_RULES}`;
        const COLD_START_CANONICAL_PACKET_SCHEMA = `{
  "canonicalPacket": {
    "meta": {
      "turn_range": "analyzed source range",
      "summary_memory": { "summary": "durable global summary", "topics": [], "importance": 1-10 }
    },
    "memory": {
      "events": [{ "summary": "", "importance": 1-10, "time_hint": "", "evidence": "" }],
      "facts": [{ "summary": "", "importance": 1-10, "evidence": "" }],
      "open_threads": [{ "summary": "", "importance": 1-10, "evidence": "" }]
    },
    "entity": {
      "characters": [{
        "name": "한글(English)",
        "sex": "male|female|",
        "appearance": "",
        "personality": "",
        "background": "",
        "role": "",
        "current_state": "",
        "speech_style": [],
        "psychology": "",
        "current_conflict": "",
        "coping_style": "",
        "open_threads": [],
        "evidence": ""
      }],
      "relations": [{
        "entityA": "한글(English)",
        "entityB": "한글(English)",
        "type": "",
        "sentiment": "",
        "summary": "",
        "dynamics": [],
        "recent_changes": [],
        "unresolved_issues": [],
        "evidence": ""
      }]
    },
    "world": {
      "tech": "",
      "time": "",
      "location": "",
      "scene": "",
      "summary": "",
      "rules": [],
      "places": [],
      "organizations": [],
      "social_rules": [],
      "phenomena": [],
      "systems": {},
      "physics": {},
      "exists": {},
      "offscreen_threads": [],
      "state": { "time": "", "location": "", "scene": "", "active_events": [], "offscreen_threads": [] }
    },
    "narrative": {
      "summary": "",
      "storylines": [{ "name": "", "context": "", "keyPoints": [], "ongoingTensions": [], "entities": [] }],
      "current_arc": "",
      "unresolved_threads": [],
      "scene_deltas": [],
      "conflict_traces": []
    },
    "guards": {
      "uncertain": [],
      "conflicts": [],
      "do_not_assume": []
    },
    "importance": { "memory": 0.0, "entity": 0.0, "world": 0.0, "narrative": 0.0 }
  },
  "structuredSnapshot": {
    "narrative": "compatibility summary for current LIBRA storage",
    "narrativeDetails": { "storylines": [] },
    "entities": [],
    "relations": [],
    "world": { "tech": "", "summary": "", "rules": [] }
  }
}`;
        const ColdStartCanonicalPacketPrompt = `당신은 LIBRA 정본 델타 분석기입니다.
분할 요약본들을 한 번에 통합하여 메모리, 엔티티, 내러티브, 세계관을 모두 포함한 canonicalPacket을 작성하십시오.
또한 현재 LIBRA 저장소가 바로 병합할 수 있도록 같은 내용을 structuredSnapshot에도 투영하십시오.

반환 형식:
${COLD_START_CANONICAL_PACKET_SCHEMA}

[분석 규칙]
- 하나의 응답 안에서 memory/entity/world/narrative/guards를 모두 분석하십시오. 축별 추가 분석을 가정하지 마십시오.
- memory는 시간순 회상용 짧은 사건/사실/미해결 흐름입니다. 원문 대사 모음, 장면 전문, 장황한 요약을 저장하지 마십시오.
- narrative는 memory들을 묶는 스토리라인/아크/갈등/현재 맥락 지도입니다. 개별 턴 회상 저장소처럼 쓰지 마십시오.
- Assistant/AI-derived summaries are canonical evidence for what happened. User requests are not evidence that an event occurred unless confirmed by assistant evidence.
- If user request and assistant evidence conflict, assistant evidence wins.
- 시간순 기억이 나중에 꺼내 쓰일 수 있도록 memory.events는 대화 흐름 순서를 유지하십시오.
- 안정적이고 재사용 가치가 있는 기억, 현재 상태, 관계 변화, 세계 규칙, 미해결 서사만 남기십시오.
- entity.appearance에는 외형/복장/신체 특징만, entity.personality에는 성격/태도/행동 경향만, entity.background에는 출신/직업/소속/과거 같은 안정 배경만 넣으십시오.
- entity.background에 외모, 현재 장면 상태, 관계 상태, 말투, 서사 역할을 섞지 마십시오. 서사 역할은 role에만 넣으십시오.
- 현재 위치는 장면/월드 상태에서 다루고 entity의 안정 DB 필드로 저장하지 마십시오.
- relation의 closeness/trust 같은 수치는 명시 근거가 있을 때만 넣고, 근거가 약하면 비워 두십시오.
- world는 영구 세계 구조만 저장하십시오. 장소/시설, 조직, 사회·문화 규칙, 초자연/시스템/물리 법칙, 특수 현상만 world 정본에 넣으십시오.
- world.time, world.location, world.scene, world.state, active_events, offscreen_threads는 현재 세계 상태로만 쓰고 영구 rules.exists/custom에 섞지 마십시오.
- 불확실하거나 근거가 약한 내용은 guards.uncertain 또는 guards.do_not_assume에 넣고 정본 필드에는 확정하지 마십시오.
- 이름(name)은 반드시 "한글(English)" 형식으로 작성하십시오.
- 내부 데이터 언어 가드가 목표 언어를 지정하면 그 목표 언어를 우선하십시오. 가드가 없으면 이름을 제외한 모든 서술은 영문으로 작성하십시오.
- 반드시 유효한 JSON만 반환하십시오.${STRICT_JSON_OUTPUT_RULES}`;
        const ColdStartCanonicalMergePrompt = `당신은 LIBRA 정본 델타 병합 편집자입니다.
여러 개의 canonicalPacket 또는 structuredSnapshot 부분 보고서를 하나의 최신 정본 canonicalPacket으로 병합하십시오.
병합 결과는 반드시 현재 LIBRA 저장소가 바로 적용할 수 있는 structuredSnapshot도 함께 포함해야 합니다.

반환 형식:
${COLD_START_CANONICAL_PACKET_SCHEMA}

규칙:
- 중복은 제거하고, 더 구체적이며 assistant evidence에 더 잘 지지되는 내용을 우선하십시오.
- 명백한 충돌은 guards.conflicts에 남기고, 확정하기 어려운 값은 정본 필드에 쓰지 마십시오.
- memory.events는 시간 흐름을 유지하십시오. 최신성 때문에 오래된 중요 사건을 삭제하지 마십시오.
- entity/world/narrative는 교체가 아니라 누적 병합 기준으로 작성하십시오.
- relation.recent_changes에는 이번 범위에서 발생한 관계 변화/사건을, relation.unresolved_issues에는 아직 열린 관계 긴장/질문/약속/위험을 넣으십시오.
- 이름(name)은 반드시 "한글(English)" 형식으로 유지하십시오.
- 반드시 JSON만 반환하십시오.${STRICT_JSON_OUTPUT_RULES}`;
        const ColdStartChunkArbiterPrompt = `당신은 과거 대화 청크 분석의 최종 판정자입니다.
원문 대화 청크와 보조 요약 초안을 함께 보고, 원문을 최우선 근거로 삼아 최종 청크 구조 요약을 JSON으로 반환하십시오.

반드시 다음 JSON 형식만 반환하십시오:
{
    "events": ["주요 사건 리스트"],
    "characters": [
        { "name": "이름", "details": "외모/성격/배경 요약", "role": "서사 역할", "currentState": "현재 상태", "speechStyle": "말투 단서", "psychology": "심리/갈등 단서", "evidence": ["짧은 근거 단서"] }
    ],
    "relationships": [
        { "pair": ["A", "B"], "status": "관계 요약", "dynamics": ["관계 동역학"], "recent_changes": ["관계 변화"], "unresolved_issues": ["미해결 관계 이슈"], "evidence": ["짧은 근거 단서"] }
    ],
    "world_rules": ["감지된 세계관 규칙"]
}

규칙:
- 원문 대화 청크를 가장 높은 우선순위로 사용하십시오.
- 원문 중 AI/Assistant lines are canonical evidence. User lines are request metadata and must not be treated as completed events unless the assistant line confirms them.
- 보조 요약 초안은 참고만 하되, 원문 근거와 일치할 때만 채택하십시오.
- 보조 초안이 누락했더라도 원문에 있으면 반드시 반영하십시오.
- role/currentState/speechStyle/psychology/dynamics/evidence는 원문에 근거가 있을 때만 짧게 작성하십시오.
- relationships.recent_changes에는 실제로 변화한 관계 사건을, unresolved_issues에는 열린 긴장/질문/약속/위험을 기록하십시오.
- evidence는 긴 원문 복사가 아니라 짧은 근거 단서로 작성하십시오.
- 반드시 JSON만 반환하십시오.${STRICT_JSON_OUTPUT_RULES}`;

        const MemoryReanalysisPrompt = `당신은 대화 로그를 다시 읽고, 기존 메모리에 아직 충분히 반영되지 않은 기억만 골라내는 전문가입니다.
You scan prior turns and propose only missing, durable memories worth adding.

[Rules]
- Extract 0 to 3 memory candidates from this turn pair only.
- Use assistant evidence as canonical. User request text is not proof that an event happened.
- If user request and assistant response conflict, save only the assistant-confirmed outcome.
- Keep only information that is stable, consequential, and useful later.
- Prefer facts, promises, secrets, relationship shifts, location/status changes, important emotional turns, and meaningful scene outcomes.
- Do not restate the whole conversation.
- Do not include formatting tags, module tags, or meta instructions.
- If existing memory snippets already cover the same point, return fewer or no candidates.
- Write naturally in the same language as the source turn.

[Output JSON]
{
  "memories": [
    { "content": "string", "importance": 1-10, "reason": "brief reason" }
  ]
}

Return JSON only.${STRICT_JSON_OUTPUT_RULES}`;
        const MemoryReanalysisVerificationPrompt = `당신은 메모리 후보를 후검증하는 보수적 검증자입니다.
You decide whether a proposed memory candidate is truly worth saving.

[Rules]
- Accept only if the candidate is grounded in the provided turn pair.
- Grounding must come from assistant evidence. User request text alone is insufficient.
- Reject if it is redundant with the existing memory snippets, too vague, too transient, or speculative.
- If accepted, you may lightly tighten wording and adjust importance.
- Preserve the original meaning. Do not invent new facts.

[Output JSON]
{
  "accept": true,
  "content": "string",
  "importance": 1-10,
  "reason": "brief reason"
}

Return JSON only.${STRICT_JSON_OUTPUT_RULES}`;
        const MergeVerificationPrompt = `당신은 LIBRA 구조 데이터 병합 검증기입니다.
기존 구조 데이터와 새로 분석된 후보 데이터를 비교하여, 기존 정보를 최대한 보존하면서 새 정보만 누적 병합한 최종 JSON을 반환하십시오.

반드시 다음 JSON 형식만 반환하십시오:
{
  "narrative": "최종 줄거리 요약",
  "narrativeDetails": {
    "storylines": [
      { "name": "스토리라인 이름", "context": "현재 맥락", "keyPoints": ["핵심 포인트"], "ongoingTensions": ["진행 중 갈등"], "entities": ["관련 인물"] }
    ]
  },
  "entities": [
    {
      "name": "이름", "sex": "male|female|", "appearance": "외모", "personality": "성격", "background": "배경",
      "identity": { "age": "", "occupation": "", "affiliation": "", "roleInStory": "", "summary": "", "aliases": [], "honorifics": [] },
      "profile": { "personality": { "values": [], "fears": [], "likes": [], "dislikes": [], "boundaries": [] }, "speechStyle": { "defaultTone": "", "honorificStyle": "", "pressureMarkers": [], "catchphrases": [], "notes": [] }, "psychology": { "baseline": "", "currentConflict": "", "copingStyle": "", "notes": [] } },
      "currentState": { "summary": "", "sceneTime": "", "location": "", "physicalState": [], "emotionalState": [], "cognitiveFocus": [], "immediateGoal": "", "activeProblems": [] },
      "continuity": { "openThreads": [{ "label": "", "status": "active", "pressure": 0 }], "unresolvedNeeds": [], "commitments": [], "nextActionHints": [] },
      "povKnowledge": { "knownToSelf": [], "unknownToSelf": [], "knownToOthers": [], "visibleTo": [], "privateExperiences": [], "privacy": "" },
      "episodeLedger": [{ "turn": 0, "summary": "", "impact": "", "stability": "current_state" }],
      "evidence": [{ "sourceKind": "cold_start", "turn": 0, "snippet": "짧은 근거 단서", "confidence": 0.7 }],
      "quality": { "confidence": 0.7, "salience": 0.5, "importance": 0.5, "pressure": 0, "needsReview": false }
    }
  ],
  "relations": [
    {
      "entityA": "이름", "entityB": "이름", "type": "관계유형", "sentiment": "감정상태",
      "currentStatus": { "summary": "", "publicLayer": "", "privateLayer": "", "boundaryState": "" },
      "metrics": { "closeness": 0, "trust": 0, "tension": 0, "risk": 0, "ambiguity": 0, "pressure": 0 },
      "dynamics": { "fromAtoB": [], "fromBtoA": [], "unresolvedIssues": [], "recentChanges": [] },
      "sharedContext": { "location": "", "workplace": "", "privateThreads": [], "notes": [] },
      "eventLedger": [{ "turn": 0, "summary": "", "impact": "", "stability": "current_state" }],
      "evidence": [{ "sourceKind": "cold_start", "turn": 0, "snippet": "짧은 근거 단서", "confidence": 0.7 }],
      "quality": { "confidence": 0.7, "salience": 0.5, "importance": 0.5, "pressure": 0 }
    }
  ],
  "world": { "tech": "기술수준", "rules": ["규칙들"] }
}

규칙:
- 새 후보 데이터는 기본적으로 기존 데이터에 누적 병합하십시오.
- 원문 근거 없이 기존 정보를 삭제하지 마십시오.
- 명백한 충돌만 보수적으로 교정하십시오.
- narrativeDetails.storylines도 누적 병합하되, 같은 스토리라인은 더 구체적인 정보를 우선하십시오.
- 반드시 JSON만 반환하십시오.${STRICT_JSON_OUTPUT_RULES}`;

        const ANALYSIS_MAX_LINE_CHARS = 900;
        const ANALYSIS_MAX_CHUNK_CHARS = 9000;
        const SYNTHESIS_MAX_INPUT_CHARS = 12000;
        const REVIEW_DATA_MAX_CHARS = 3600;
        const IMPORT_KNOWLEDGE_MAX_ITEM_CHARS = 1800;
        const HIERARCHICAL_SYNTHESIS_MAX_BATCHES = 12;
        const HIERARCHICAL_SYNTHESIS_MAX_LAYERS = 4;

        const isColdStartPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
        const coerceColdStartTextArray = (value) => {
            if (value == null) return [];
            if (Array.isArray(value)) return value.flatMap(coerceColdStartTextArray);
            if (isColdStartPlainObject(value)) {
                const fields = [
                    value.summary,
                    value.details,
                    value.status,
                    value.text,
                    value.value,
                    value.description,
                    value.label,
                    value.name,
                    ...(Array.isArray(value.events) ? value.events : []),
                    ...(Array.isArray(value.keyPoints) ? value.keyPoints : []),
                    ...(Array.isArray(value.rules) ? value.rules : []),
                    ...(Array.isArray(value.notes) ? value.notes : [])
                ];
                return fields.flatMap(coerceColdStartTextArray);
            }
            const text = String(value || '').trim();
            return text ? [text] : [];
        };
        const coerceColdStartObjectArray = (value) => {
            if (value == null) return [];
            if (Array.isArray(value)) return value.flatMap(coerceColdStartObjectArray);
            if (!isColdStartPlainObject(value)) return [];
            const knownShape = [
                'name', 'details', 'summary', 'status', 'pair', 'entityA', 'entityB',
                'character', 'entity', 'role', 'appearance', 'personality', 'background'
            ].some(key => Object.prototype.hasOwnProperty.call(value, key));
            if (knownShape) return [value];
            return Object.entries(value)
                .map(([key, entry]) => {
                    if (isColdStartPlainObject(entry)) return { name: entry.name || key, ...entry };
                    const details = String(entry || '').trim();
                    return details ? { name: key, details } : null;
                })
                .filter(Boolean);
        };
        const compactTextArray = (items, maxItems = 6, maxItemChars = 240) => {
            return dedupeTextArray(coerceColdStartTextArray(items))
                .slice(0, maxItems)
                .map(item => truncateForLLM(item, maxItemChars, ' ...[TRUNCATED]... '));
        };

        const normalizeColdStart01 = (value, fallback = 0) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, Number(fallback || 0)));
            return Math.max(0, Math.min(1, numeric));
        };
        const compactColdStartText = (value = '', maxChars = 240) => {
            if (value == null) return '';
            if (Array.isArray(value)) {
                return compactTextArray(value.map(item => compactColdStartText(item, maxChars)).filter(Boolean), 6, maxChars).join('; ');
            }
            if (isColdStartPlainObject(value)) {
                const commonParts = [
                    value.summary, value.details, value.status, value.text, value.value, value.description, value.label, value.name,
                    ...(Array.isArray(value.features) ? value.features : []),
                    ...(Array.isArray(value.traits) ? value.traits : []),
                    ...(Array.isArray(value.history) ? value.history : []),
                    ...(Array.isArray(value.notes) ? value.notes : [])
                ].map(item => String(item || '').trim()).filter(Boolean);
                return compactColdStartText(
                    commonParts.join('; '),
                    maxChars
                );
            }
            return truncateForLLM(String(value || '').replace(/\s+/g, ' ').trim(), maxChars, ' ...[TRUNCATED]... ');
        };
        const compactColdStartList = (value, maxItems = 6, maxItemChars = 160) => {
            const out = [];
            const visit = (item) => {
                if (item == null || item === '') return;
                if (Array.isArray(item)) {
                    item.forEach(visit);
                    return;
                }
                if (isColdStartPlainObject(item)) {
                    const text = compactColdStartText(item, maxItemChars);
                    if (text) out.push(text);
                    return;
                }
                const raw = String(item || '').replace(/\s+/g, ' ').trim();
                if (!raw) return;
                const parts = raw.length <= maxItemChars && /[;,|]/.test(raw)
                    ? normalizeDelimitedList(raw)
                    : [raw];
                out.push(...(parts.length > 0 ? parts : [raw]));
            };
            visit(value);
            return dedupeTextArray(out.map(item => truncateForLLM(item, maxItemChars, ' ...[TRUNCATED]... ')).filter(Boolean)).slice(0, maxItems);
        };
        const compactColdStartObject = (value) => isColdStartPlainObject(value) ? value : {};
        const pickColdStartObject = (...values) => {
            for (const value of values) {
                if (isColdStartPlainObject(value) && Object.keys(value).length > 0) return value;
            }
            return {};
        };
        const compactColdStartEvidence = (value, options = {}) => {
            const source = Array.isArray(value) ? value : (value ? [value] : []);
            const out = [];
            const fallbackSnippet = compactColdStartText(options.fallbackSnippet || '', 220);
            for (const item of source) {
                if (item == null || item === '') continue;
                if (typeof item === 'string') {
                    out.push({
                        sourceKind: options.sourceKind || 'cold_start',
                        turn: Math.max(0, Number(options.turn || 0) || 0),
                        messageId: '',
                        snippet: compactColdStartText(item, 220),
                        confidence: normalizeColdStart01(options.confidence, 0.65)
                    });
                    continue;
                }
                if (isColdStartPlainObject(item)) {
                    out.push({
                        sourceKind: compactColdStartText(item.sourceKind || item.source_kind || item.kind || item.source || options.sourceKind || 'cold_start', 64),
                        turn: Math.max(0, Number(item.turn ?? item.sourceTurn ?? item.turnNumber ?? options.turn ?? 0) || 0),
                        messageId: compactColdStartText(item.messageId || item.m_id || item.sourceMessageId || '', 96),
                        snippet: compactColdStartText(item.snippet || item.quote || item.text || item.summary || item.evidence || fallbackSnippet, 220),
                        confidence: normalizeColdStart01(item.confidence, options.confidence ?? 0.65)
                    });
                }
            }
            if (out.length === 0 && fallbackSnippet) {
                out.push({
                    sourceKind: options.sourceKind || 'cold_start',
                    turn: Math.max(0, Number(options.turn || 0) || 0),
                    messageId: '',
                    snippet: fallbackSnippet,
                    confidence: normalizeColdStart01(options.confidence, 0.55)
                });
            }
            const seen = new Set();
            return out.filter(item => {
                if (!item.snippet && !item.sourceKind && !item.turn && !item.messageId) return false;
                const key = `${item.sourceKind}|${item.turn}|${item.messageId}|${item.snippet}`.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, Math.max(1, Number(options.limit || 8) || 8));
        };
        const compactColdStartThreads = (value, maxItems = 6) => {
            const source = [];
            const visit = (item) => {
                if (item == null || item === '') return;
                if (Array.isArray(item)) {
                    item.forEach(visit);
                    return;
                }
                source.push(item);
            };
            visit(value);
            return source.map(item => {
                if (typeof item === 'string') {
                    const label = compactColdStartText(item, 180);
                    return label ? { label, status: 'active', pressure: 0 } : null;
                }
                if (!isColdStartPlainObject(item)) return null;
                const label = compactColdStartText(item.label || item.summary || item.text || item.name || '', 180);
                if (!label) return null;
                return {
                    label,
                    status: compactColdStartText(item.status || 'active', 48) || 'active',
                    pressure: normalizeColdStart01(item.pressure, 0)
                };
            }).filter(Boolean).slice(0, maxItems);
        };
        const compactColdStartEpisodes = (value, options = {}) => {
            const source = Array.isArray(value) ? value : (value ? [value] : []);
            const out = source.map(item => {
                if (typeof item === 'string') {
                    const summary = compactColdStartText(item, 220);
                    return summary ? { turn: Math.max(0, Number(options.turn || 0) || 0), summary, impact: '', stability: 'current_state' } : null;
                }
                if (!isColdStartPlainObject(item)) return null;
                const summary = compactColdStartText(item.summary || item.event || item.text || item.brief || '', 220);
                if (!summary) return null;
                return {
                    turn: Math.max(0, Number(item.turn ?? item.sourceTurn ?? item.turnNumber ?? options.turn ?? 0) || 0),
                    summary,
                    impact: compactColdStartText(item.impact || item.effect || '', 180),
                    stability: compactColdStartText(item.stability || item.scope || 'current_state', 64) || 'current_state'
                };
            }).filter(Boolean);
            return out.slice(0, Math.max(1, Number(options.limit || 8) || 8));
        };
        const compactColdStartEntityExtension = (entity = {}) => {
            const storedExtension = compactColdStartObject(entity.extension);
            const identity = pickColdStartObject(entity.identity, storedExtension.identity);
            const profile = pickColdStartObject(entity.profile, storedExtension.profile);
            const profileAppearance = compactColdStartObject(profile.appearance);
            const profilePersonality = compactColdStartObject(profile.personality || entity.profilePersonality);
            const profileSpeech = compactColdStartObject(profile.speechStyle || entity.speechStyle);
            const profilePsychology = compactColdStartObject(profile.psychology || entity.psychology);
            const currentState = pickColdStartObject(entity.currentState, entity.current_state, storedExtension.currentState);
            const continuity = pickColdStartObject(entity.continuity, storedExtension.continuity);
            const povKnowledge = pickColdStartObject(entity.povKnowledge, entity.pov_knowledge, entity.knowledge, storedExtension.povKnowledge);
            const quality = pickColdStartObject(entity.quality, storedExtension.quality);
            const evidence = compactColdStartEvidence(entity.evidence || entity.evidenceItems || entity.sourceEvidence || storedExtension.evidence || [], {
                fallbackSnippet: entity.details || entity.background || entity.personality || entity.appearance,
                sourceKind: 'cold_start',
                confidence: quality.confidence ?? 0.65,
                limit: 6
            });
            return {
                identity: {
                    age: identity.age ?? entity.age ?? '',
                    occupation: compactColdStartText(identity.occupation || entity.occupation || '', 120),
                    affiliation: compactColdStartText(identity.affiliation || identity.organization || entity.affiliation || '', 120),
                    roleInStory: compactColdStartText(identity.roleInStory || identity.role || entity.roleInStory || entity.role || '', 160),
                    summary: compactColdStartText(identity.summary || entity.identitySummary || entity.summary || '', 220),
                    aliases: compactColdStartList(identity.aliases || entity.aliases || [], 10, 100),
                    honorifics: compactColdStartList(identity.honorifics || entity.honorifics || [], 8, 80)
                },
                profile: {
                    appearance: {
                        features: compactColdStartList(profileAppearance.features || entity.appearance, 8, 140),
                        distinctiveMarks: compactColdStartList(profileAppearance.distinctiveMarks || profileAppearance.distinctive_marks || [], 6, 140),
                        clothing: compactColdStartList(profileAppearance.clothing || [], 6, 140),
                        confidence: normalizeColdStart01(profileAppearance.confidence, evidence.length ? 0.65 : 0)
                    },
                    personality: {
                        traits: compactColdStartList(profilePersonality.traits || entity.personality || entity.details, 10, 150),
                        values: compactColdStartList(profilePersonality.values || [], 8, 150),
                        fears: compactColdStartList(profilePersonality.fears || [], 8, 150),
                        likes: compactColdStartList(profilePersonality.likes || [], 8, 150),
                        dislikes: compactColdStartList(profilePersonality.dislikes || [], 8, 150),
                        boundaries: compactColdStartList(profilePersonality.boundaries || [], 8, 150),
                        confidence: normalizeColdStart01(profilePersonality.confidence, evidence.length ? 0.6 : 0)
                    },
                    speechStyle: {
                        defaultTone: compactColdStartText(profileSpeech.defaultTone || profileSpeech.tone || entity.speechStyle || '', 120),
                        honorificStyle: compactColdStartText(profileSpeech.honorificStyle || profileSpeech.honorifics || '', 120),
                        pressureMarkers: compactColdStartList(profileSpeech.pressureMarkers || profileSpeech.pressure_markers || [], 8, 100),
                        catchphrases: compactColdStartList(profileSpeech.catchphrases || profileSpeech.verbalTics || [], 8, 100),
                        notes: compactColdStartList(profileSpeech.notes || [], 8, 140)
                    },
                    psychology: {
                        baseline: compactColdStartText(profilePsychology.baseline || profilePsychology.defaultState || profilePsychology.default_state || profilePsychology.core || entity.psychology || entity.psyche || '', 200),
                        currentConflict: compactColdStartText(profilePsychology.currentConflict || profilePsychology.current_conflict || profilePsychology.innerConflict || profilePsychology.inner_conflict || profilePsychology.internalConflict || profilePsychology.internal_conflict || profilePsychology.conflict || entity.currentConflict || entity.current_conflict || entity.innerConflict || entity.inner_conflict || entity.internalConflict || entity.internal_conflict || entity.conflict || '', 200),
                        copingStyle: compactColdStartText(profilePsychology.copingStyle || profilePsychology.coping_style || profilePsychology.coping || entity.copingStyle || entity.coping_style || entity.coping || '', 160),
                        notes: compactColdStartList([profilePsychology.notes, profilePsychology.cues, profilePsychology.signals, entity.psychologicalNotes, entity.psychological_notes, entity.mentalNotes, entity.mental_notes], 8, 150)
                    }
                },
                currentState: {
                    summary: compactColdStartText(currentState.summary || currentState.current_state || entity.currentState || entity.current_state || '', 220),
                    sceneTime: compactColdStartText(currentState.sceneTime || currentState.scene_time || '', 80),
                    location: '',
                    physicalState: compactColdStartList(currentState.physicalState || currentState.physical_state || [], 8, 140),
                    emotionalState: compactColdStartList(currentState.emotionalState || currentState.emotional_state || [], 8, 140),
                    cognitiveFocus: compactColdStartList(currentState.cognitiveFocus || currentState.cognitive_focus || [], 8, 150),
                    immediateGoal: compactColdStartText(currentState.immediateGoal || currentState.immediate_goal || '', 180),
                    activeProblems: compactColdStartList(currentState.activeProblems || currentState.active_problems || [], 8, 150)
                },
                continuity: {
                    openThreads: compactColdStartThreads([continuity.openThreads, continuity.open_threads, continuity.activeThreads, continuity.active_threads, continuity.threads, continuity.unresolvedThreads, continuity.unresolved_threads, continuity.openLoops, continuity.open_loops, continuity.openHooks, continuity.open_hooks, continuity.plotHooks, continuity.plot_hooks, continuity.looseEnds, continuity.loose_ends, continuity.pendingQuestions, continuity.pending_questions, continuity.unresolved], 6),
                    unresolvedNeeds: compactColdStartList([continuity.unresolvedNeeds, continuity.unresolved_needs, continuity.needs, continuity.pendingNeeds, continuity.pending_needs], 8, 150),
                    commitments: compactColdStartList([continuity.commitments, continuity.promises, continuity.obligations], 8, 150),
                    nextActionHints: compactColdStartList([continuity.nextActionHints, continuity.next_action_hints, continuity.next_actions, continuity.nextActions, continuity.nextSteps, continuity.next_steps, continuity.plannedNextSteps, continuity.planned_next_steps], 8, 150)
                },
                povKnowledge: {
                    knownToSelf: compactColdStartList(povKnowledge.knownToSelf || povKnowledge.known_to_self || [], 8, 150),
                    unknownToSelf: compactColdStartList(povKnowledge.unknownToSelf || povKnowledge.unknown_to_self || [], 8, 150),
                    knownToOthers: compactColdStartList(povKnowledge.knownToOthers || povKnowledge.known_to_others || [], 8, 150),
                    visibleTo: compactColdStartList(povKnowledge.visibleTo || povKnowledge.visible_to || [], 8, 100),
                    privateExperiences: compactColdStartList(povKnowledge.privateExperiences || povKnowledge.private_experiences || [], 8, 150),
                    privacy: compactColdStartText(povKnowledge.privacy || povKnowledge.privacyLevel || '', 80)
                },
                episodeLedger: compactColdStartEpisodes(entity.episodeLedger || entity.episode_ledger || entity.events || storedExtension.episodeLedger || [], { limit: 8 }),
                evidence,
                quality: {
                    confidence: normalizeColdStart01(quality.confidence, evidence.length ? 0.65 : 0),
                    salience: normalizeColdStart01(quality.salience, 0),
                    importance: normalizeColdStart01(quality.importance, 0),
                    pressure: normalizeColdStart01(quality.pressure, 0),
                    needsReview: !!quality.needsReview
                }
            };
        };
        const compactColdStartRelationExtension = (relation = {}) => {
            const storedExtension = compactColdStartObject(relation.extension);
            const currentStatus = pickColdStartObject(relation.currentStatus, relation.current_state, relation.status, storedExtension.currentStatus);
            const metrics = pickColdStartObject(relation.metrics, storedExtension.metrics);
            const dynamics = pickColdStartObject(relation.dynamics, storedExtension.dynamics);
            const rawDynamicsItems = isColdStartPlainObject(relation.dynamics) ? [] : relation.dynamics;
            const sharedContext = pickColdStartObject(relation.sharedContext, relation.shared_context, storedExtension.sharedContext);
            const quality = pickColdStartObject(relation.quality, storedExtension.quality);
            const evidence = compactColdStartEvidence(relation.evidence || relation.evidenceItems || storedExtension.evidence || [], {
                fallbackSnippet: relation.status || relation.sentiment || relation.type,
                sourceKind: 'cold_start_relation',
                confidence: quality.confidence ?? 0.65,
                limit: 6
            });
            return {
                currentStatus: {
                    summary: compactColdStartText(currentStatus.summary || relation.status || relation.sentiment || relation.type || '', 200),
                    publicLayer: compactColdStartText(currentStatus.publicLayer || currentStatus.public_layer || '', 150),
                    privateLayer: compactColdStartText(currentStatus.privateLayer || currentStatus.private_layer || '', 160),
                    boundaryState: compactColdStartText(currentStatus.boundaryState || currentStatus.boundary_state || '', 120)
                },
                metrics: {
                    closeness: normalizeColdStart01(metrics.closeness, 0),
                    trust: normalizeColdStart01(metrics.trust, 0),
                    tension: normalizeColdStart01(metrics.tension ?? metrics.currentTension, 0),
                    risk: normalizeColdStart01(metrics.risk, 0),
                    ambiguity: normalizeColdStart01(metrics.ambiguity, 0),
                    pressure: normalizeColdStart01(metrics.pressure, 0)
                },
                dynamics: {
                    fromAtoB: compactColdStartList([dynamics.fromAtoB, dynamics.from_a_to_b, relation.sentiment], 8, 150),
                    fromBtoA: compactColdStartList([dynamics.fromBtoA, dynamics.from_b_to_a], 8, 150),
                    unresolvedIssues: compactColdStartList([
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
                        relation.unresolvedIssues,
                        relation.unresolved_issues,
                        relation.openIssues,
                        relation.open_issues,
                        relation.pendingIssues,
                        relation.pending_issues,
                        relation.issues,
                        relation.unresolved
                    ], 8, 150),
                    recentChanges: compactColdStartList([
                        dynamics.recentChanges,
                        dynamics.recent_changes,
                        dynamics.changes,
                        dynamics.relationshipChanges,
                        dynamics.relationship_changes,
                        dynamics.relationshipDeltas,
                        dynamics.relationship_deltas,
                        relation.recentChanges,
                        relation.recent_changes,
                        relation.changes,
                        relation.relationshipChanges,
                        relation.relationship_changes,
                        relation.relationshipDeltas,
                        relation.relationship_deltas,
                        rawDynamicsItems,
                        relation.event,
                        relation.summary || relation.status
                    ], 8, 150)
                },
                sharedContext: {
                    location: compactColdStartText(sharedContext.location || '', 140),
                    workplace: compactColdStartText(sharedContext.workplace || '', 140),
                    privateThreads: compactColdStartList(sharedContext.privateThreads || sharedContext.private_threads || [], 8, 120),
                    notes: compactColdStartList(sharedContext.notes || [], 8, 150)
                },
                eventLedger: compactColdStartEpisodes(relation.eventLedger || relation.event_ledger || relation.events || storedExtension.eventLedger || [], { limit: 8 }),
                evidence,
                quality: {
                    confidence: normalizeColdStart01(quality.confidence, evidence.length ? 0.65 : 0),
                    salience: normalizeColdStart01(quality.salience, 0),
                    importance: normalizeColdStart01(quality.importance, 0),
                    pressure: normalizeColdStart01(quality.pressure, 0)
                }
            };
        };

        const normalizeColdStartChunkSummary = (summary = {}) => {
            const source = isColdStartPlainObject(summary) ? summary : {};
            const characters = coerceColdStartObjectArray(source.characters || source.entities || source.people)
                .map(ch => ({
                    name: compactColdStartText(ch?.name || ch?.character || ch?.entity || ch?.id || '', 80),
                    details: compactColdStartText(ch?.details || ch?.summary || ch?.description || ch?.appearance || ch?.personality || ch?.background || '', 420),
                    role: compactColdStartText(ch?.role || ch?.roleInStory || ch?.occupation || '', 160),
                    currentState: compactColdStartText(ch?.currentState || ch?.current_state || ch?.status || ch?.location || '', 240),
                    speechStyle: compactColdStartText(ch?.speechStyle || ch?.speech_style || '', 180),
                    psychology: compactColdStartText(ch?.psychology || ch?.currentConflict || ch?.motivation || '', 220),
                    evidence: compactColdStartList(ch?.evidence || ch?.evidenceItems || ch?.evidence_items || [], 4, 140)
                }))
                .filter(ch => ch.name || ch.details || ch.currentState);
            const relationships = coerceColdStartObjectArray(source.relationships || source.relations)
                .map(rel => {
                    const pair = Array.isArray(rel?.pair)
                        ? rel.pair
                        : [rel?.entityA || rel?.from || rel?.a || rel?.source, rel?.entityB || rel?.to || rel?.b || rel?.target];
                    const relDynamics = isColdStartPlainObject(rel?.dynamics) ? rel.dynamics : {};
                    const rawDynamics = isColdStartPlainObject(rel?.dynamics) ? [] : rel?.dynamics;
                    const statusText = compactColdStartText(rel?.status || rel?.type || rel?.sentiment || rel?.summary || rel?.details || '', 260);
                    const recentChanges = compactColdStartList([rawDynamics, relDynamics.recentChanges, relDynamics.recent_changes, relDynamics.changes, rel?.recentChanges, rel?.recent_changes, rel?.changes, statusText], 4, 150);
                    const unresolvedIssues = compactColdStartList([relDynamics.unresolvedIssues, relDynamics.unresolved_issues, relDynamics.openIssues, relDynamics.open_issues, rel?.unresolvedIssues, rel?.unresolved_issues, rel?.openIssues, rel?.open_issues, rel?.issues, rel?.unresolved], 4, 150);
                    return {
                        pair: pair.map(name => compactColdStartText(name || '', 80)).filter(Boolean).slice(0, 2),
                        status: statusText,
                        dynamics: recentChanges,
                        recent_changes: recentChanges,
                        unresolved_issues: unresolvedIssues,
                        evidence: compactColdStartList(rel?.evidence || rel?.evidenceItems || rel?.evidence_items || [], 4, 140)
                    };
                })
                .filter(rel => rel.pair.length === 2 || rel.status);
            return {
                events: compactTextArray(source.events || source.event || source.summary || source.narrative || source.keyPoints || source.memory_seeds, 10, 260),
                characters,
                relationships,
                world_rules: compactTextArray(source.world_rules || source.worldRules || source.rules || source.world?.rules || source.world?.custom, 12, 240),
                memory_seeds: Array.isArray(source.memory_seeds) ? source.memory_seeds.slice(-8) : []
            };
        };

        const compactChunkSummary = (summary) => {
            const normalized = normalizeColdStartChunkSummary(summary);
            return {
                events: compactTextArray(normalized.events, 6, 220),
                characters: normalized.characters
                    .slice(0, 8)
                    .map(ch => ({
                        name: truncateForLLM(ch?.name || '', 80, ' ... '),
                        details: truncateForLLM(ch?.details || '', 420, ' ...[TRUNCATED]... '),
                        role: truncateForLLM(ch?.role || ch?.roleInStory || '', 160, ' ...[TRUNCATED]... '),
                        currentState: truncateForLLM(ch?.currentState || ch?.current_state || '', 240, ' ...[TRUNCATED]... '),
                        speechStyle: truncateForLLM(ch?.speechStyle || ch?.speech_style || '', 180, ' ...[TRUNCATED]... '),
                        psychology: truncateForLLM(ch?.psychology || ch?.currentConflict || '', 220, ' ...[TRUNCATED]... '),
                        evidence: compactColdStartList(ch?.evidence || ch?.evidenceItems || [], 3, 140)
                    }))
                    .filter(ch => ch.name || ch.details),
                relationships: normalized.relationships
                    .slice(0, 8)
                    .map(rel => ({
                        pair: Array.isArray(rel?.pair) ? rel.pair.slice(0, 2).map(name => truncateForLLM(name || '', 80, ' ... ')) : [],
                        status: truncateForLLM(rel?.status || '', 260, ' ...[TRUNCATED]... '),
                        dynamics: compactColdStartList([rel?.dynamics, rel?.recent_changes, rel?.recentChanges], 4, 150),
                        recent_changes: compactColdStartList([rel?.recent_changes, rel?.recentChanges, rel?.dynamics], 4, 150),
                        unresolved_issues: compactColdStartList([rel?.unresolved_issues, rel?.unresolvedIssues], 4, 150),
                        evidence: compactColdStartList(rel?.evidence || rel?.evidenceItems || [], 3, 140)
                    }))
                    .filter(rel => rel.pair.length === 2 || rel.status),
                world_rules: compactTextArray(normalized.world_rules, 8, 220)
            };
        };

        const compactOptionalWorldBoolean = (value) => typeof value === 'boolean' ? value : undefined;

        const buildBoundedJsonArray = (items, maxChars, fallbackValue = []) => {
            const list = Array.isArray(items) ? items : [];
            if (list.length === 0) return JSON.stringify(fallbackValue);
            const out = [];
            for (const item of list) {
                out.push(item);
                const serialized = JSON.stringify(out);
                if (serialized.length > maxChars) {
                    out.pop();
                    break;
                }
            }
            if (out.length === 0) {
                return truncateForLLM(JSON.stringify([list[0]]), maxChars);
            }
            return JSON.stringify(out);
        };

        const compactStructuredSnapshot = (data) => ({
            narrative: truncateForLLM(data?.narrative || '', 1200, ' ...[TRUNCATED]... '),
            narrativeDetails: {
                storylines: normalizeNarrativeStorylinesForMerge(data?.narrativeDetails?.storylines, data?.narrative || '')
                    .slice(0, 4)
                    .map(storyline => ({
                        name: truncateForLLM(storyline?.name || '', 100, ' ... '),
                        context: truncateForLLM(storyline?.context || '', 260, ' ...[TRUNCATED]... '),
                        keyPoints: compactTextArray(storyline?.keyPoints, 4, 160),
                        ongoingTensions: compactTextArray(storyline?.ongoingTensions, 4, 160),
                        entities: compactTextArray(storyline?.entities, 5, 80)
                    }))
            },
            entities: (Array.isArray(data?.entities) ? data.entities : [])
                .slice(0, 10)
                .map(entity => {
                    const extension = compactColdStartEntityExtension(entity || {});
                    return {
                        name: truncateForLLM(entity?.name || '', 80, ' ... '),
                        sex: truncateForLLM(entity?.sex || entity?.biologicalSex || '', 16, ' ... '),
                        appearance: truncateForLLM(compactColdStartText(entity?.appearance || '', 260), 260, ' ...[TRUNCATED]... '),
                        personality: truncateForLLM(compactColdStartText(entity?.personality || '', 260), 260, ' ...[TRUNCATED]... '),
                        background: truncateForLLM(compactColdStartText(entity?.background || '', 260), 260, ' ...[TRUNCATED]... '),
                        identity: extension.identity,
                        profile: extension.profile,
                        currentState: extension.currentState,
                        continuity: extension.continuity,
                        povKnowledge: extension.povKnowledge,
                        episodeLedger: extension.episodeLedger,
                        evidence: extension.evidence,
                        quality: extension.quality
                    };
                })
                .filter(entity => entity.name),
            relations: (Array.isArray(data?.relations) ? data.relations : [])
                .slice(0, 12)
                .map(relation => {
                    const extension = compactColdStartRelationExtension(relation || {});
                    return {
                        entityA: truncateForLLM(relation?.entityA || '', 80, ' ... '),
                        entityB: truncateForLLM(relation?.entityB || '', 80, ' ... '),
                        type: truncateForLLM(relation?.type || relation?.relationType || '', 180, ' ...[TRUNCATED]... '),
                        sentiment: truncateForLLM(relation?.sentiment || '', 220, ' ...[TRUNCATED]... '),
                        currentStatus: extension.currentStatus,
                        metrics: extension.metrics,
                        dynamics: extension.dynamics,
                        sharedContext: extension.sharedContext,
                        eventLedger: extension.eventLedger,
                        evidence: extension.evidence,
                        quality: extension.quality
                    };
                })
                .filter(relation => relation.entityA && relation.entityB),
            world: {
                tech: truncateForLLM(data?.world?.tech || '', 120, ' ... '),
                classification: {
                    primary: truncateForLLM(data?.world?.classification?.primary || '', 80, ' ... ')
                },
                exists: {
                    technology: truncateForLLM(data?.world?.exists?.technology || '', 80, ' ... '),
                    magic: compactOptionalWorldBoolean(data?.world?.exists?.magic),
                    ki: compactOptionalWorldBoolean(data?.world?.exists?.ki),
                    supernatural: compactOptionalWorldBoolean(data?.world?.exists?.supernatural)
                },
                systems: {
                    leveling: compactOptionalWorldBoolean(data?.world?.systems?.leveling),
                    skills: compactOptionalWorldBoolean(data?.world?.systems?.skills),
                    stats: compactOptionalWorldBoolean(data?.world?.systems?.stats),
                    classes: compactOptionalWorldBoolean(data?.world?.systems?.classes)
                },
                physics: {
                    gravity: truncateForLLM(data?.world?.physics?.gravity || '', 60, ' ... '),
                    time_flow: truncateForLLM(data?.world?.physics?.time_flow || data?.world?.physics?.timeFlow || '', 60, ' ... '),
                    space: truncateForLLM(data?.world?.physics?.space || '', 80, ' ... ')
                },
                custom: compactTextArray(Object.values(normalizeWorldCustomRules(data?.world?.custom)), 10, 220),
                rules: compactTextArray(data?.world?.rules, 10, 220)
            }
        });

        const buildCompactStructuredJson = (data, maxChars = REVIEW_DATA_MAX_CHARS) => {
            return buildBoundedJsonArray([compactStructuredSnapshot(data)], maxChars, [{}]).replace(/^\[(.*)\]$/s, '$1');
        };


        const COLD_START_MESSAGE_AUDIT_LIMIT = 120;
        const COLD_START_AUX_HINT_LIMIT = 8;
        const parseColdStartTagAttributes = (tag = '') => {
            const attrs = {};
            String(tag || '').replace(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, key, dq, sq, bare) => {
                attrs[String(key || '').toLowerCase()] = String(dq ?? sq ?? bare ?? '').trim();
                return _;
            });
            return attrs;
        };
        const compactColdStartHintValue = (value, depth = 0) => {
            if (value == null) return '';
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                return truncateForLLM(String(value).replace(/\s+/g, ' ').trim(), 180, ' ... ');
            }
            if (Array.isArray(value)) {
                return value.map(item => compactColdStartHintValue(item, depth + 1)).filter(Boolean).slice(0, 4).join('; ');
            }
            if (typeof value === 'object') {
                const preferred = [
                    'name', 'character', 'characterName', 'entity', 'summary', 'state', 'current_state', 'currentState',
                    'emotion', 'emotional_state', 'location', 'scene', 'relationship', 'status', 'goal', 'intent',
                    'appearance', 'clothing', 'speechStyle', 'speech_style', 'world', 'time'
                ];
                const parts = [];
                for (const key of preferred) {
                    if (!(key in value)) continue;
                    const text = compactColdStartHintValue(value[key], depth + 1);
                    if (text) parts.push(`${key}: ${text}`);
                    if (parts.length >= 6) break;
                }
                if (parts.length > 0 || depth >= 1) return parts.join('; ');
                for (const [key, val] of Object.entries(value).slice(0, 8)) {
                    const text = compactColdStartHintValue(val, depth + 1);
                    if (text) parts.push(`${key}: ${text}`);
                    if (parts.length >= 6) break;
                }
                return parts.join('; ');
            }
            return '';
        };
        const extractColdStartHayakuPackets = (rawText = '') => {
            const raw = String(rawText || '');
            if (!raw) return [];
            const packets = [];
            const pattern = /HAYAKU_([A-Z0-9_]+)_START\s*([\s\S]*?)\s*HAYAKU_\1_END/gi;
            let match;
            while ((match = pattern.exec(raw))) {
                const kind = `HAYAKU_${String(match[1] || '').toUpperCase()}`;
                const payload = String(match[2] || '')
                    .replace(/^\s*<!--\s*/, '')
                    .replace(/\s*-->\s*$/, '')
                    .trim();
                const parsed = extractStructuredJson(payload);
                const summary = compactColdStartHintValue(parsed || payload);
                if (summary) packets.push({ kind, summary: truncateForLLM(summary, 420, ' ... ') });
                if (packets.length >= COLD_START_AUX_HINT_LIMIT) break;
            }
            return packets;
        };
        const extractColdStartImageCues = (rawText = '') => {
            const cues = [];
            String(rawText || '').replace(/<img\b[^>]*>/gi, (tag) => {
                const attrs = parseColdStartTagAttributes(tag);
                const hasCommand = Object.prototype.hasOwnProperty.call(attrs, 'cmd') || /\bcmd\s*=/i.test(tag);
                if (!hasCommand) return tag;
                const summary = [
                    attrs.cmd ? `cmd: ${attrs.cmd}` : '',
                    attrs.prompt ? `prompt: ${attrs.prompt}` : '',
                    attrs.alt ? `alt: ${attrs.alt}` : '',
                    attrs.title ? `title: ${attrs.title}` : '',
                    attrs.src ? `src: ${attrs.src}` : ''
                ].filter(Boolean).join('; ');
                cues.push({
                    kind: 'image_command',
                    summary: truncateForLLM(summary || tag.replace(/\s+/g, ' ').trim(), 360, ' ... ')
                });
                return tag;
            });
            return cues.slice(0, COLD_START_AUX_HINT_LIMIT);
        };
        const stripColdStartAnalysisArtifacts = (rawText = '') => {
            return String(rawText || '')
                .replace(/<!--[\s\S]{0,240}HAYAKU_[A-Z0-9_]+_START[\s\S]*?HAYAKU_[A-Z0-9_]+_END[\s\S]{0,240}?-->/gi, ' ')
                .replace(/HAYAKU_([A-Z0-9_]+)_START\s*[\s\S]*?\s*HAYAKU_\1_END/gi, ' ')
                .replace(/<img\b[^>]*\bcmd\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        };
        const formatColdStartAuxiliaryHints = (hayakuPackets = [], imageCues = []) => {
            const lines = [];
            for (const packet of hayakuPackets) {
                if (!packet?.summary) continue;
                lines.push(`- ${packet.kind || 'HAYAKU'}: ${packet.summary}`);
                if (lines.length >= COLD_START_AUX_HINT_LIMIT) break;
            }
            for (const cue of imageCues) {
                if (!cue?.summary || lines.length >= COLD_START_AUX_HINT_LIMIT) continue;
                lines.push(`- VisualCue: ${cue.summary}`);
            }
            return dedupeTextArray(lines).slice(0, COLD_START_AUX_HINT_LIMIT);
        };
        const normalizeColdStartMessageForAnalysis = (msg, sourceIndex = -1) => {
            const roleHint = getMessageRoleHint(msg);
            const rawText = Utils.getMessageText(msg);
            const hayakuPackets = extractColdStartHayakuPackets(rawText);
            const imageCues = extractColdStartImageCues(rawText);
            const strippedRaw = stripColdStartAnalysisArtifacts(rawText);
            const narrativeText = Utils.getNarrativeComparableText(strippedRaw, roleHint);
            const auxHintLines = formatColdStartAuxiliaryHints(hayakuPackets, imageCues);
            const text = [
                narrativeText,
                auxHintLines.length ? '[Auxiliary module hints - lower priority than visible prose]' : '',
                ...auxHintLines
            ].filter(Boolean).join('\n').trim();
            return {
                msg,
                text,
                narrativeText,
                rawText,
                roleHint,
                sourceIndex,
                hayakuPackets,
                imageCues,
                auxHintCount: auxHintLines.length,
                rawChars: String(rawText || '').length,
                narrativeChars: String(narrativeText || '').length,
                textChars: String(text || '').length
            };
        };
        const coldStartMessageDigest = (text = '') => {
            const raw = String(text || '');
            const trimmed = raw.trim();
            return {
                chars: raw.length,
                trimmedChars: trimmed.length,
                hash: trimmed ? stableHash(trimmed) : '',
                empty: !trimmed
            };
        };
        const getColdStartMessageSourceCandidates = (chat) => {
            const candidates = [];
            const push = (label, value) => {
                if (!Array.isArray(value)) return;
                const messages = value.filter(item => item != null);
                if (!messages.length) return;
                const rawSignature = messages.slice(0, 3).map(getMessageSignature).join('||') || `${label}:${messages.length}`;
                const signature = stableHash(rawSignature);
                if (candidates.some(item => item.signature === signature)) return;
                const roleCounts = DebugExportManager.countRoles(messages);
                const textChars = messages.reduce((sum, msg) => sum + String(Utils.getMessageText(msg) || '').length, 0);
                const score = messages.length * 1000 + Math.min(textChars, 50000) + Math.min(Number(roleCounts.user || 0), Number(roleCounts.assistant || roleCounts.ai || roleCounts.char || 0)) * 200;
                candidates.push({ label, messages, count: messages.length, textChars, roleCounts, score, signature });
            };
            push('getChatMessages', getChatMessages(chat));
            push('chat.msgs', chat?.msgs);
            push('chat.messages', chat?.messages);
            push('chat.message', chat?.message);
            push('chat.log', chat?.log);
            push('chat.mes', chat?.mes);
            push('chat.chat', chat?.chat);
            push('chat.data.messages', readNested(chat, ['data', 'messages']));
            push('chat.data.message', readNested(chat, ['data', 'message']));
            push('chat.history.messages', readNested(chat, ['history', 'messages']));
            push('chat.history.message', readNested(chat, ['history', 'message']));
            return candidates.sort((a, b) => b.score - a.score || b.count - a.count);
        };
        const resolveColdStartMessageSource = (chat) => {
            const candidates = getColdStartMessageSourceCandidates(chat);
            const selected = candidates[0] || { label: 'none', messages: [], count: 0, textChars: 0, roleCounts: {}, score: 0 };
            return {
                label: selected.label,
                messages: selected.messages || [],
                candidates: candidates.map(item => ({
                    label: item.label,
                    count: item.count,
                    textChars: item.textChars,
                    roleCounts: item.roleCounts,
                    selected: item.label === selected.label
                })).slice(0, 10)
            };
        };
        const summarizeColdStartFilterAudit = (audit = []) => {
            const items = Array.isArray(audit) ? audit : [];
            const kept = items.filter(item => item.kept).length;
            const dropped = items.length - kept;
            const dropReasons = {};
            let hayakuPackets = 0;
            let imageCues = 0;
            for (const item of items) {
                if (!item.kept) dropReasons[item.dropReason || 'unknown'] = Number(dropReasons[item.dropReason || 'unknown'] || 0) + 1;
                hayakuPackets += Number(item.hayakuPackets || 0);
                imageCues += Number(item.imageCues || 0);
            }
            return { total: items.length, kept, dropped, dropReasons, hayakuPackets, imageCues };
        };
        const buildAnalysisMessageChunks = (msgs, maxChunkMessages = 25) => {
            const source = Array.isArray(msgs) ? msgs : [];
            const chunks = [];
            let current = [];
            let currentChars = 0;

            for (const item of source) {
                if (!item?.msg) continue;
                const role = getMessageRoleHint(item) === 'user' ? 'User' : 'AI';
                const line = `${role}: ${truncateForLLM(item.text || '', ANALYSIS_MAX_LINE_CHARS, ' ...[TRUNCATED]... ')}`;
                if (!line.trim()) continue;

                const delta = line.length + (current.length > 0 ? 2 : 0);
                const wouldOverflow = current.length > 0 && (currentChars + delta > ANALYSIS_MAX_CHUNK_CHARS || current.length >= maxChunkMessages);
                if (wouldOverflow) {
                    chunks.push(current);
                    current = [];
                    currentChars = 0;
                }

                current.push(item);
                currentChars += line.length + (current.length > 1 ? 2 : 0);
            }

            if (current.length > 0) chunks.push(current);
            return chunks;
        };

        const buildAnalysisChunkText = (chunk, options = {}) => {
            const evidenceMode = String(options?.evidenceMode || 'assistant_canonical').trim().toLowerCase();
            const lines = (Array.isArray(chunk) ? chunk : [])
                .filter(item => item?.msg != null)
                .map((item) => {
                    const { msg, text } = item;
                    const roleHint = getMessageRoleHint(item);
                    if (evidenceMode === 'assistant_canonical' && roleHint === 'user') return '';
                    const role = roleHint === 'user' ? 'User Request Metadata' : 'AI';
                    return `${role}: ${truncateForLLM(text, ANALYSIS_MAX_LINE_CHARS, ' ...[TRUNCATED]... ')}`;
                })
                .filter(Boolean);
            if (lines.length === 0) return '';
            return [
                evidenceMode === 'assistant_canonical' ? LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY : '',
                lines.join('\n\n')
            ].filter(Boolean).join('\n\n');
        };

        const buildSynthesisInput = (chunkSummaries) => {
            const compacted = (Array.isArray(chunkSummaries) ? chunkSummaries : []).map(compactChunkSummary);
            return buildBoundedJsonArray(compacted, SYNTHESIS_MAX_INPUT_CHARS, []);
        };
        const buildFallbackChunkSummary = (items = [], label = 'analysis') => {
            const sourceItems = Array.isArray(items) ? items : [];
            const sourceTexts = sourceItems
                .filter(item => getMessageRoleHint(item) !== 'user')
                .map(item => String(item?.text || getComparableMessageText(item?.msg || item) || '').trim())
                .filter(Boolean);
            const combined = sourceTexts.join('\n');
            const events = sourceTexts
                .map(text => truncateForLLM(text, 260, ' ...[TRUNCATED]... '))
                .filter(Boolean)
                .slice(-10);
            return {
                events: events.length ? events : [`${label}: source text preserved for later analysis.`],
                characters: [],
                relationships: [],
                world_rules: combined ? ['Fallback continuity seed: preserve the source conversation text as tentative evidence; do not invent unsupported facts.'] : [],
                memory_seeds: sourceTexts.slice(-8).map((text, index) => ({
                    summary: truncateForLLM(text, 900, ' ...[TRUNCATED]... '),
                    topics: [],
                    evidence: `fallback chunk memory ${index + 1}`
                }))
            };
        };
        const buildStructuredMergeInput = (reports) => {
            const compacted = (Array.isArray(reports) ? reports : []).map(compactStructuredSnapshot);
            return buildBoundedJsonArray(compacted, SYNTHESIS_MAX_INPUT_CHARS, []);
        };
        const COLD_START_BASELINE_MEMORY_MAX_ROWS = 64;
        const buildColdStartReplayableTurnPairs = (msgs, chat = null) => {
            const pairs = [];
            const source = Array.isArray(msgs) ? msgs : [];
            let pendingUser = null;
            let pendingAssistantParts = [];
            let pendingAssistantMsgs = [];
            let turn = 0;
            const flushPendingPair = () => {
                if (!pendingUser || pendingAssistantParts.length === 0) {
                    pendingAssistantParts = [];
                    pendingAssistantMsgs = [];
                    return;
                }
                const aiText = pendingAssistantParts.join('\n\n').trim();
                if (!aiText) {
                    pendingAssistantParts = [];
                    pendingAssistantMsgs = [];
                    return;
                }
                const userText = String(
                    getStrictNarrativeUserText(pendingUser.text || Utils.getMessageText(pendingUser.msg) || '')
                    || Utils.getMemorySourceText(pendingUser.text || Utils.getMessageText(pendingUser.msg) || '')
                    || ''
                ).trim();
                if (!userText && !aiText) {
                    pendingAssistantParts = [];
                    pendingAssistantMsgs = [];
                    return;
                }
                const combined = `${userText}\n${aiText}`.trim();
                if (Utils.shouldExcludeStoredMemoryContent(aiText)) {
                    pendingAssistantParts = [];
                    pendingAssistantMsgs = [];
                    return;
                }
                const normalizedTurn = normalizeLegacyMemoryTurnAnchor(pendingUser.turn || pairs.length + 1) || pairs.length + 1;
                const sourceHash = TokenizerEngine.simpleHash(aiText || combined);
                const primaryAssistant = pendingAssistantMsgs[pendingAssistantMsgs.length - 1] || pendingAssistantMsgs[0] || null;
                const primaryAssistantMsg = primaryAssistant?.msg || null;
                const primaryIndex = Number.isFinite(Number(primaryAssistant?.index)) ? Number(primaryAssistant.index) : pendingUser.index;
                const stableMessageId = getNarrativeMessageStableId(chat, primaryAssistantMsg, { indexHint: primaryIndex, aiText })
                    || getLiveMessageId(primaryAssistantMsg)
                    || buildAfterRequestSyntheticMessageId(chat, normalizedTurn, sourceHash);
                const liveMessageIds = normalizeCanonicalMessageIds([
                    stableMessageId,
                    ...pendingAssistantMsgs.map(item => getLiveMessageId(item?.msg)),
                    getLiveMessageId(pendingUser.msg)
                ]);
                const messageSignature = compactTurnMessageSignature(getMessageSignature(primaryAssistantMsg) || `ai::cold-start::${normalizedTurn}::${sourceHash}`);
                const userTurnKey = buildLogicalUserTurnKey(userText, userText, false);
                const turnKey = buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, messageSignature, liveMessageIds);
            pairs.push({
                turn: normalizedTurn,
                userText,
                aiText,
                canonicalEvidenceText: aiText,
                userRequestMetadata: '',
                combined,
                    sourceHash,
                    messageSignature,
                    userTurnKey,
                    turnKey,
                    liveMessageIds,
                    sourceMessageIds: liveMessageIds,
                    messageId: stableMessageId,
                    userMsg: pendingUser.msg || null,
                    aiMsg: primaryAssistantMsg,
                    assistantMsgs: pendingAssistantMsgs.map(item => item?.msg).filter(Boolean),
                    index: primaryIndex
                });
                pendingUser = null;
                pendingAssistantParts = [];
                pendingAssistantMsgs = [];
            };
            for (let i = 0; i < source.length; i++) {
                const item = source[i];
                const msg = item?.msg || item;
                if (!msg) continue;
                const isUser = getMessageRoleHint(item) === 'user';
                const rawText = Utils.getMessageText(msg);
                if (isUser) {
                    flushPendingPair();
                    turn += 1;
                    pendingUser = { item, msg, index: i, text: item?.text || rawText || '', turn };
                    continue;
                }
                const analysisText = item?.text || rawText || '';
                const aiText = String(
                    Utils.getNarrativeComparableText(analysisText, 'ai')
                    || Utils.getMemorySourceText(analysisText)
                    || ''
                ).trim();
                if (!aiText) continue;
                if (!pendingUser) continue;
                pendingAssistantParts.push(aiText);
                pendingAssistantMsgs.push({ msg, index: i });
            }
            flushPendingPair();
            return pairs;
        };
        const buildColdStartUserOnlyTurnPairs = (msgs, chat = null) => {
            const pairs = [];
            const source = Array.isArray(msgs) ? msgs : [];
            let turn = 0;
            for (let i = 0; i < source.length; i++) {
                const item = source[i];
                const msg = item?.msg || item;
                if (!msg) continue;
                const isUser = getMessageRoleHint(item) === 'user';
                if (!isUser) continue;
                turn += 1;
                const userText = String(
                    getStrictNarrativeUserText(item?.text || Utils.getMessageText(msg) || '')
                    || Utils.getMemorySourceText(item?.text || Utils.getMessageText(msg) || '')
                    || ''
                ).trim();
                if (!userText || Utils.shouldExcludeStoredMemoryContent(userText)) continue;
                const aiText = '[Cold-start source note: no assistant response was available; preserve only the user-provided context.]';
                const combined = `${userText}\n${aiText}`.trim();
                const sourceHash = TokenizerEngine.simpleHash(combined);
                const stableMessageId = getNarrativeMessageStableId(chat, msg, { indexHint: i, aiText: userText })
                    || getLiveMessageId(msg)
                    || buildAfterRequestSyntheticMessageId(chat, turn || pairs.length + 1, sourceHash);
                const liveMessageIds = normalizeCanonicalMessageIds([stableMessageId, getLiveMessageId(msg)]);
                const messageSignature = compactTurnMessageSignature(getMessageSignature(msg) || `user::cold-start::${turn || pairs.length + 1}::${sourceHash}`);
                const userTurnKey = buildLogicalUserTurnKey(userText, userText, false);
                const turnKey = buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, messageSignature, liveMessageIds);
                pairs.push({
                    turn: normalizeLegacyMemoryTurnAnchor(turn || pairs.length + 1) || pairs.length + 1,
                    userText,
                    aiText,
                    combined,
                    sourceHash,
                    messageSignature,
                    userTurnKey,
                    turnKey,
                    liveMessageIds,
                    sourceMessageIds: liveMessageIds,
                    messageId: stableMessageId,
                    userMsg: msg,
                    aiMsg: null,
                    index: i,
                    userOnlyFallback: true
                });
            }
            return pairs.slice(-Math.min(16, COLD_START_BASELINE_MEMORY_MAX_ROWS));
        };
        const scoreColdStartMemoryPair = (pair = {}) => {
            const text = String(pair.aiText || pair.canonicalEvidenceText || '');
            let score = 1;
            if (text.length >= 120) score += 1;
            if (String(pair.aiText || '').trim()) score += 1;
            if (Array.isArray(pair.sourceMessageIds) && pair.sourceMessageIds.length > 0) score += 1;
            return score;
        };
        const selectColdStartMemoryPairs = (pairs = [], maxRows = COLD_START_BASELINE_MEMORY_MAX_ROWS) => {
            const source = Array.isArray(pairs) ? pairs.filter(Boolean) : [];
            const limit = Math.max(16, Math.min(COLD_START_BASELINE_MEMORY_MAX_ROWS, Number(maxRows || COLD_START_BASELINE_MEMORY_MAX_ROWS) || COLD_START_BASELINE_MEMORY_MAX_ROWS));
            if (source.length <= limit) return source.map(pair => ({ ...pair, _coldStartScore: scoreColdStartMemoryPair(pair) }));
            const scored = source
                .map(pair => ({ ...pair, _coldStartScore: scoreColdStartMemoryPair(pair) }))
                .sort((a, b) => Number(b._coldStartScore || 0) - Number(a._coldStartScore || 0) || Number(a.turn || 0) - Number(b.turn || 0));
            const selected = new Map();
            const add = (pair) => {
                if (!pair || selected.size >= limit) return;
                const key = pair.turnKey || `${pair.turn}:${pair.sourceHash}:${pair.index}`;
                if (!selected.has(key)) selected.set(key, pair);
            };
            const topLimit = Math.max(12, Math.floor(limit * 0.45));
            const recentLimit = Math.max(8, Math.floor(limit * 0.15));
            scored.slice(0, topLimit).forEach(add);
            source.slice(-recentLimit).forEach(add);
            const remaining = Math.max(0, limit - selected.size);
            if (remaining > 0) {
                const stride = Math.max(1, source.length / remaining);
                for (let i = 0; i < remaining; i++) {
                    add(source[Math.min(source.length - 1, Math.floor(i * stride))]);
                }
            }
            for (const pair of scored) {
                if (selected.size >= limit) break;
                add(pair);
            }
            return Array.from(selected.values()).sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0));
        };
        const buildColdStartSummaryMemoryPayload = (pair = {}, options = {}) => {
            const importance = Number(options.importance || 6) || 6;
            const basePayload = CompactMemoryCodec.buildTurnPayload('', pair.aiText || '', {
                turn: pair.turn,
                firstSeenTurn: pair.turn,
                importance,
                impression: options.impression,
                sourceHash: pair.sourceHash,
                sourceMessageIds: pair.sourceMessageIds,
                knownEntityNames: options.knownEntityNames || [],
                source: 'cold_start_summary'
            });
            if (!basePayload) return null;
            const brief = compactColdStartText(
                NarrativeTracker?.buildHeuristicTurnBrief?.('', pair.aiText || '')
                || basePayload.summary
                || pair.aiText
                || '',
                320
            );
            if (!brief) return null;
            const entityRefs = Array.isArray(basePayload.mentionedEntityNames)
                ? basePayload.mentionedEntityNames
                : (Array.isArray(options.knownEntityNames) ? options.knownEntityNames.filter(name => String(pair.aiText || '').includes(name)) : []);
            basePayload.summary = brief;
            basePayload.summaryV2 = {
                oneLine: brief,
                continuity: '',
                recall: brief
            };
            basePayload.directEvidenceSnippets = [];
            basePayload.evidenceRecords = [];
            basePayload.facts = [{
                id: `fact.${normalizeLegacyMemoryTurnAnchor(pair.turn) || 0}.summary.${TokenizerEngine.simpleHash(brief)}`,
                type: 'scene_summary',
                text: brief,
                entities: entityRefs.slice(0, 8),
                subjects: entityRefs.slice(0, 8),
                observerEntities: entityRefs.slice(0, 8),
                evidence: [],
                confidence: 0.72,
                importance: Math.max(0.1, Math.min(1, importance / 10))
            }];
            basePayload.beats = [];
            basePayload.recallAnchors = [{
                summary: compactColdStartText(brief, 180),
                hint: compactColdStartText(entityRefs.slice(0, 6).join(' / '), 180),
                entityRefs: entityRefs.slice(0, 6),
                confidence: 0.72
            }];
            basePayload.rawRetention = 'summary_only_with_turn_record_reference';
            basePayload.rawDiscarded = true;
            return basePayload;
        };
        const buildColdStartAnchorMeta = (pair = {}, chat = null, options = {}) => {
            const turn = normalizeLegacyMemoryTurnAnchor(pair.turn) || 1;
            const sourceHash = String(pair.sourceHash || TokenizerEngine.simpleHash(pair.aiText || pair.combined || '')).trim();
            const sourceMessageIds = normalizeCanonicalMessageIds(pair.sourceMessageIds || pair.liveMessageIds || pair.messageId);
            const messageSignature = String(pair.messageSignature || '').trim();
            const userTurnKey = String(pair.userTurnKey || buildLogicalUserTurnKey(pair.userText, pair.userText, false)).trim();
            const turnKey = String(pair.turnKey || buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, messageSignature, sourceMessageIds)).trim();
            return {
                t: turn,
                turn,
                firstTurn: turn,
                originalTurn: turn,
                lockedTurn: turn,
                finalizedTurn: turn,
                turnAnchorTurn: turn,
                turnAnchor: turn,
                turnLocked: true,
                turnAnchorReason: String(options.turnAnchorReason || 'cold-start-baseline-hydration'),
                sourceMessageIds,
                liveMessageIds: normalizeCanonicalMessageIds(pair.liveMessageIds || sourceMessageIds),
                m_id: getPrimaryCanonicalMessageId(sourceMessageIds, true) || pair.messageId || '',
                messageId: getPrimaryCanonicalMessageId(sourceMessageIds, true) || pair.messageId || '',
                sourceHash,
                aiHash: sourceHash,
                responseHash: sourceHash,
                userTurnKey,
                turnKey,
                messageSignature,
                messageCount: Number(pair.index || 0) + 1,
                liveOrder: Number(pair.index || 0) + 1,
                chatId: String(chat?.id || '').trim(),
                runtimeMode: 'cold-start-baseline',
                runtimeReliability: 'historical-replay',
                source: 'cold_start_baseline',
                s_id: String(options.sourceId || 'baseline')
            };
        };
        const ensureColdStartNarrativeTurnCoverage = (options = {}) => {
            const state = NarrativeTracker.getState?.();
            if (!state || typeof state !== 'object') return { skipped: true, reason: 'missing_state' };
            const turnLog = (Array.isArray(state.turnLog) ? state.turnLog : [])
                .map(entry => ({ ...entry, turn: normalizeLegacyMemoryTurnAnchor(entry?.turn || 0) }))
                .filter(entry => entry.turn > 0)
                .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0));
            if (turnLog.length === 0) return { skipped: true, reason: 'empty_turn_log' };

            const nextState = safeClone(state);
            nextState.storylines = Array.isArray(nextState.storylines) ? nextState.storylines : [];
            const maxTurn = Math.max(
                Number(options.maxTurn || 0),
                ...turnLog.map(entry => Number(entry.turn || 0)).filter(Boolean)
            );
            const fallbackEntities = dedupeTextArray(options.entityNames || []).slice(0, 12);
            if (nextState.storylines.length === 0) {
                nextState.storylines.push({
                    id: 1,
                    name: 'Cold Start Timeline',
                    arcKey: 'cold_start_timeline',
                    phase: '',
                    primaryConflict: '',
                    entities: [...fallbackEntities],
                    turns: [],
                    firstTurn: 0,
                    lastTurn: 0,
                    recentEvents: [],
                    summaries: [],
                    currentContext: '',
                    keyPoints: [],
                    ongoingTensions: [],
                    meta: { manualLocked: false, manualLockedAt: 0, baseline: true, sourceId: options.sourceId || 'baseline' }
                });
            }

            const primary = nextState.storylines.find(storyline => storyline?.meta?.baseline === true)
                || nextState.storylines.find(storyline => /imported|canonical|cold start|timeline|현재 장면/i.test(String(storyline?.name || storyline?.arcKey || '')))
                || nextState.storylines[0];
            primary.turns = Array.isArray(primary.turns) ? primary.turns.map(normalizeLegacyMemoryTurnAnchor).filter(Boolean) : [];
            primary.recentEvents = Array.isArray(primary.recentEvents) ? primary.recentEvents : [];
            primary.entities = dedupeTextArray([...(Array.isArray(primary.entities) ? primary.entities : []), ...fallbackEntities]).slice(0, 20);

            const coveredTurns = new Set(nextState.storylines.flatMap(storyline =>
                (Array.isArray(storyline?.turns) ? storyline.turns : []).map(normalizeLegacyMemoryTurnAnchor).filter(Boolean)
            ));
            let addedTurns = 0;
            for (const entry of turnLog) {
                if (!coveredTurns.has(entry.turn)) {
                    primary.turns.push(entry.turn);
                    coveredTurns.add(entry.turn);
                    addedTurns += 1;
                }
                const brief = compactColdStartText(entry.lastDistinctEvent || entry.responseBrief || entry.summary || entry.response || '', 220);
                if (brief && !primary.recentEvents.some(event => Number(event?.turn || 0) === Number(entry.turn || 0))) {
                    primary.recentEvents.push({ turn: entry.turn, brief, arcKey: primary.arcKey || '' });
                }
            }

            primary.turns = Array.from(new Set(primary.turns.map(normalizeLegacyMemoryTurnAnchor).filter(Boolean))).sort((a, b) => a - b);
            primary.firstTurn = primary.turns[0] || 0;
            primary.lastTurn = primary.turns[primary.turns.length - 1] || 0;
            primary.recentEvents = primary.recentEvents
                .filter(event => normalizeLegacyMemoryTurnAnchor(event?.turn || 0) > 0 && String(event?.brief || '').trim())
                .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0))
                .slice(-10);
            if (Array.isArray(primary.summaries)) {
                primary.summaries = primary.summaries.map(summary => {
                    if (summary?.baseline === true && Number(summary?.upToTurn || 0) < maxTurn) {
                        return { ...summary, upToTurn: maxTurn };
                    }
                    return summary;
                });
            }
            nextState.lastSummaryTurn = Math.max(Number(nextState.lastSummaryTurn || 0), maxTurn);
            NarrativeTracker.resetState(nextState);
            return {
                skipped: false,
                turnLogCount: turnLog.length,
                storylineCount: nextState.storylines.length,
                addedTurns,
                maxTurn
            };
        };
        const flattenColdStartIds = (items = []) => {
            const out = [];
            const visit = (value) => {
                if (value == null) return;
                if (Array.isArray(value)) {
                    value.forEach(visit);
                    return;
                }
                const text = String(value || '').trim();
                if (text) out.push(text);
            };
            visit(items);
            return out;
        };
        const buildColdStartMemoryFingerprints = (parts = {}) => {
            const turn = normalizeLegacyMemoryTurnAnchor(parts.turn || parts.t || parts.finalizedTurn || parts.turnAnchorTurn || 0) || 0;
            const sourceHash = String(parts.sourceHash || parts.aiHash || parts.responseHash || '').trim();
            const turnKey = String(parts.turnKey || '').trim();
            const userTurnKey = String(parts.userTurnKey || '').trim();
            const messageSignature = compactTurnMessageSignature(parts.messageSignature || '');
            const ids = normalizeCanonicalMessageIds(flattenColdStartIds([
                parts.sourceMessageIds,
                parts.liveMessageIds,
                parts.m_id,
                parts.messageId
            ]));
            const keys = [];
            if (turnKey) keys.push(`turnKey:${turnKey}`);
            if (sourceHash) keys.push(`sourceHash:${sourceHash}`);
            if (turn && sourceHash) keys.push(`turnSource:${turn}:${sourceHash}`);
            if (turn && messageSignature) keys.push(`turnSignature:${turn}:${messageSignature}`);
            if (userTurnKey && sourceHash) keys.push(`userSource:${userTurnKey}:${sourceHash}`);
            ids.forEach(id => keys.push(`messageId:${id}`));
            return dedupeTextArray(keys);
        };
        const collectExistingColdStartMemoryFingerprints = (lore = []) => {
            const keys = new Set();
            const memoryKeyByFingerprint = new Map();
            const add = (fingerprint, memoryKey = '') => {
                const key = String(fingerprint || '').trim();
                if (!key) return;
                keys.add(key);
                if (memoryKey && !memoryKeyByFingerprint.has(key)) memoryKeyByFingerprint.set(key, memoryKey);
            };
            const entries = MemoryEngine.getManagedEntries(Array.isArray(lore) ? lore : []);
            for (const entry of entries) {
                const entryKey = entry?.key || TokenizerEngine.getSafeMapKey(entry?.content || '');
                const meta = parseLibraMetaObject(entry?.content || '', {});
                const payload = CompactMemoryCodec.parsePayloadFromEntry(entry);
                const payloadSource = payload?.source && typeof payload.source === 'object' ? payload.source : {};
                const fingerprints = buildColdStartMemoryFingerprints({
                    turn: payload?.turn || payloadSource.turn || meta.turn || meta.t,
                    finalizedTurn: meta.finalizedTurn,
                    turnAnchorTurn: meta.turnAnchorTurn,
                    sourceHash: payload?.sourceHash || payloadSource.sourceHash || meta.sourceHash,
                    aiHash: meta.aiHash,
                    responseHash: meta.responseHash,
                    turnKey: meta.turnKey,
                    userTurnKey: meta.userTurnKey,
                    messageSignature: meta.messageSignature,
                    sourceMessageIds: [
                        payload?.sourceMessageIds,
                        payloadSource.sourceMessageIds,
                        meta.sourceMessageIds,
                        meta.liveMessageIds
                    ],
                    liveMessageIds: meta.liveMessageIds,
                    m_id: meta.m_id,
                    messageId: meta.messageId
                });
                fingerprints.forEach(fingerprint => add(fingerprint, entryKey));
            }
            return { keys, memoryKeyByFingerprint };
        };
        const hydrateColdStartBaselineMemory = async (sanitized, options = {}) => {
            const lore = Array.isArray(options.lore) ? options.lore : null;
            const chat = options.chat || null;
            const char = options.char || null;
            const sourceMessages = Array.isArray(options.sourceMessages) ? options.sourceMessages : [];
            const hydrationDisabled = options.hydrateBaselineMemory === false;
            if (!lore || !chat || sourceMessages.length === 0 || hydrationDisabled) {
                return { skipped: true, reason: !sourceMessages.length ? 'no_source_messages' : 'disabled_or_missing_context' };
            }
            const hydrateWorldMemory = options.hydrateWorldMemory !== false;
            let pairs = buildColdStartReplayableTurnPairs(sourceMessages, chat);
            let userOnlyFallback = false;
            if (pairs.length === 0) userOnlyFallback = false;
            if (pairs.length === 0) return { skipped: true, reason: 'no_turn_pairs' };

            const existingMemoryCount = MemoryEngine.getManagedEntries(lore).length;
            const maxRows = Math.max(16, Math.min(
                COLD_START_BASELINE_MEMORY_MAX_ROWS,
                Math.floor(Number(MemoryEngine.CONFIG?.maxLimit || COLD_START_BASELINE_MEMORY_MAX_ROWS) * 0.55) || COLD_START_BASELINE_MEMORY_MAX_ROWS
            ));
            const selectedPairs = selectColdStartMemoryPairs(pairs, maxRows);
            const selectedKeys = new Set(selectedPairs.map(pair => pair.turnKey || `${pair.turn}:${pair.sourceHash}:${pair.index}`));
            const entityNames = dedupeTextArray([
                ...(Array.isArray(sanitized?.entities) ? sanitized.entities.map(entity => entity?.name).filter(Boolean) : []),
                ...Array.from(EntityManager.getEntityCache?.().values?.() || []).map(entity => entity?.name).filter(Boolean)
            ]).slice(0, 80);
            const addedMemories = [];
            const memoryKeyByTurnKey = new Map();
            const existingFingerprints = collectExistingColdStartMemoryFingerprints(lore);
            let skippedExistingMemoryCount = 0;
            let maxTurn = 0;

            for (const pair of selectedPairs) {
                maxTurn = Math.max(maxTurn, normalizeLegacyMemoryTurnAnchor(pair.turn) || 0);
                const score = Number(pair._coldStartScore || scoreColdStartMemoryPair(pair) || 0);
                const importance = Math.max(5, Math.min(9, 5 + Math.floor(score / 4)));
                const anchorMeta = buildColdStartAnchorMeta(pair, chat, { sourceId: options.sourceId });
                const pairFingerprints = buildColdStartMemoryFingerprints({
                    ...anchorMeta,
                    turn: pair.turn,
                    sourceHash: pair.sourceHash,
                    turnKey: pair.turnKey || anchorMeta.turnKey,
                    userTurnKey: pair.userTurnKey || anchorMeta.userTurnKey,
                    messageSignature: pair.messageSignature || anchorMeta.messageSignature,
                    sourceMessageIds: [pair.sourceMessageIds, anchorMeta.sourceMessageIds],
                    liveMessageIds: [pair.liveMessageIds, anchorMeta.liveMessageIds],
                    m_id: anchorMeta.m_id,
                    messageId: pair.messageId || anchorMeta.messageId
                });
                const existingMemoryKey = pairFingerprints
                    .map(fingerprint => existingFingerprints.memoryKeyByFingerprint.get(fingerprint))
                    .find(Boolean) || '';
                if (pairFingerprints.some(fingerprint => existingFingerprints.keys.has(fingerprint))) {
                    skippedExistingMemoryCount += 1;
                    if (pair.turnKey && existingMemoryKey) memoryKeyByTurnKey.set(pair.turnKey, existingMemoryKey);
                    continue;
                }
                const payload = buildColdStartSummaryMemoryPayload(pair, {
                    importance,
                    impression: Math.max(0.55, Math.min(0.9, 0.55 + score * 0.035)),
                    knownEntityNames: entityNames
                });
                if (!payload) continue;
                const newMemory = await MemoryEngine.prepareMemory(
                    { content: CompactMemoryCodec.serialize(payload), importance, forceCreate: true },
                    pair.turn,
                    lore,
                    lore,
                    char,
                    chat,
                    anchorMeta.m_id || null,
                    anchorMeta
                );
                if (!newMemory) continue;
                forceMemoryTurnAnchor(newMemory, anchorMeta);
                lore.push(newMemory);
                addedMemories.push(newMemory);
                const memoryKey = newMemory.key || TokenizerEngine.getSafeMapKey(newMemory.content || '');
                if (pair.turnKey) memoryKeyByTurnKey.set(pair.turnKey, memoryKey);
                pairFingerprints.forEach(fingerprint => {
                    existingFingerprints.keys.add(fingerprint);
                    if (memoryKey && !existingFingerprints.memoryKeyByFingerprint.has(fingerprint)) {
                        existingFingerprints.memoryKeyByFingerprint.set(fingerprint, memoryKey);
                    }
                });
            }

            for (const pair of pairs) {
                maxTurn = Math.max(maxTurn, normalizeLegacyMemoryTurnAnchor(pair.turn) || 0);
                const anchorMeta = buildColdStartAnchorMeta(pair, chat, { sourceId: options.sourceId });
                const involvedEntities = entityNames.filter(name => name && String(pair.aiText || '').includes(name)).slice(0, 8);
                await NarrativeTracker.recordTurn(pair.turn, '', pair.aiText, involvedEntities, MemoryEngine.CONFIG, {
                    anchorMeta,
                    channel: 'scene'
                });
                TurnRecordLedger.upsertRecord(lore, {
                    ...anchorMeta,
                    userPreview: String(pair.userText || pair.userMsg || '').replace(/\s+/g, ' ').trim().slice(0, 90),
                    aiPreview: pair.aiText || '',
                    memoryKey: memoryKeyByTurnKey.get(pair.turnKey) || '',
                    status: 'active',
                    reason: selectedKeys.has(pair.turnKey || `${pair.turn}:${pair.sourceHash}:${pair.index}`)
                        ? 'cold-start-baseline-memory'
                        : 'cold-start-baseline-turn'
                }, chat, char);
            }
            const narrativeCoverage = ensureColdStartNarrativeTurnCoverage({
                entityNames,
                maxTurn,
                sourceId: options.sourceId
            });
            if (MemoryEngine.CONFIG.debug && narrativeCoverage && narrativeCoverage.skipped !== true) {
                recordRuntimeDebug('log', '[LIBRA] Cold-start narrative coverage:', narrativeCoverage);
            }

            let worldMemoryDecision = { create: false, reason: hydrateWorldMemory ? 'not_evaluated' : 'hydrate_world_memory_disabled' };
            if (hydrateWorldMemory) {
                const currentWorldNode = HierarchicalWorldManager.getCurrentNode?.();
                const currentWorldRules = HierarchicalWorldManager.getCurrentRules?.();
                const currentWorldProfile = HierarchicalWorldManager.getProfile?.();
                const worldMemoryContent = buildWorldRecallMemoryContent(currentWorldNode?.meta || {}, currentWorldRules || {}, {
                    turn: maxTurn || pairs.length,
                    importance: 7,
                    sourceHash: stableHash(JSON.stringify(sanitized?.world || {})),
                    sourceMessageIds: [],
                    activePath: currentWorldProfile?.activePath || []
                });
                const worldMemoryPayload = worldMemoryContent ? (CompactMemoryCodec.parsePayloadFromContent(worldMemoryContent) || null) : null;
                worldMemoryDecision = worldMemoryContent
                    ? shouldCreateWorldRecallMemorySnapshot(lore, worldMemoryPayload, { turn: maxTurn || pairs.length })
                    : { create: false, reason: 'empty_content' };
                if (worldMemoryContent && worldMemoryDecision.create) {
                    const anchorMeta = {
                        turn: maxTurn || pairs.length,
                        turnAnchorTurn: maxTurn || pairs.length,
                        finalizedTurn: maxTurn || pairs.length,
                        sourceHash: worldMemoryPayload?.sourceHash || stableHash(worldMemoryContent),
                        sourceMessageIds: [],
                        turnAnchorReason: 'cold-start-world-memory'
                    };
                    const worldMemory = await MemoryEngine.prepareMemory(
                        { content: worldMemoryContent, importance: 7, forceCreate: true },
                        maxTurn || pairs.length,
                        lore,
                        lore,
                        char,
                        chat,
                        null,
                        anchorMeta
                    );
                    if (worldMemory) {
                        forceMemoryTurnAnchor(worldMemory, anchorMeta);
                        lore.push(worldMemory);
                        addedMemories.push(worldMemory);
                    }
                }
            }

            if (addedMemories.length > 0) {
                MemoryEngine.upsertHybridScopeIndexRows(lore, addedMemories, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    currentTurn: maxTurn || pairs.length,
                    reason: 'cold-start-baseline-hydration'
                });
            } else {
                MemoryEngine.ensureHybridScopeIndex?.(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    currentTurn: maxTurn || pairs.length,
                    force: true,
                    reason: 'cold-start-empty-hydration'
                });
            }
            if (maxTurn > 0) MemoryEngine.setTurn(maxTurn);
            await NarrativeTracker.summarizeIfNeeded(maxTurn || pairs.length);
            await NarrativeTracker.saveState(lore);
            await StoryAuthor.saveState?.(lore);
            await Director.saveState?.(lore);
            await SecretKnowledgeCore.saveState(lore, {
                scopeKey: getChatRuntimeScopeKey(chat, char),
                chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
            });
            await EntityKnowledgeVaultCore.saveState(lore, {
                scopeKey: getChatRuntimeScopeKey(chat, char),
                chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
            });
            await TimeEngine.saveState(lore, {
                scopeKey: getChatRuntimeScopeKey(chat, char),
                chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
            });
            MemoryEngine.rebuildIndex(lore);
            return {
                skipped: false,
                sourcePairs: pairs.length,
                selectedPairs: selectedPairs.length,
                existingMemoryCount,
                skippedExistingMemoryCount,
                addedMemoryCount: addedMemories.length,
                worldMemoryDecision,
                turnRecordCount: pairs.length,
                userOnlyFallback,
                maxTurn: maxTurn || pairs.length
            };
        };
        const batchItemsByCharLimit = (items, serializeItem, maxChars = SYNTHESIS_MAX_INPUT_CHARS) => {
            const source = Array.isArray(items) ? items : [];
            const batches = [];
            let current = [];

            for (const item of source) {
                const candidate = [...current, item];
                const serialized = JSON.stringify(candidate.map(serializeItem));
                if (current.length > 0 && serialized.length > maxChars) {
                    batches.push(current);
                    current = [item];
                    continue;
                }
                current = candidate;
            }

            if (current.length > 0) batches.push(current);
            return batches;
        };

        const check = async () => {
            if (isProcessing) return;
            
            const char = await RisuCompat.getCharacter();
            if (!char) return;

            const chat = await getActiveChatForCharacter(char);
            if (!chat || getChatMessages(chat).length < 5) return;

            const lore = MemoryEngine.getEffectiveLorebook(char, chat);
            const hasLibraData = lore.some(e => [
                'lmai_narrative',
                'lmai_entity',
                'lmai_relation',
                'lmai_memory'
            ].includes(String(e?.comment || '').trim()));

            if (!hasLibraData) {
                const confirmed = await Utils.confirmEx(
                    "이 채팅방에서 LIBRA가 처음 실행되었습니다.\n과거 대화 내역을 분석하여 초기 구조 데이터와 세계관을 구축하시겠습니까?\n(LLM 토큰이 소모됩니다)"
                );
                if (confirmed) {
                    await startAutoSummarization();
                }
            }
        };

        const coalesceKnowledgeField = (...values) => {
            let best = '';
            for (const value of values) {
                const text = String(value || '').trim();
                if (!text) continue;
                if (!best || text.length > best.length) best = text;
            }
            return best;
        };
        const extractImportedEntityFields = (entity) => {
            const appearance = typeof entity?.appearance === 'string'
                ? entity.appearance.trim()
                : [
                    ...(Array.isArray(entity?.appearance?.features) ? entity.appearance.features : []),
                    ...(Array.isArray(entity?.appearance?.distinctiveMarks) ? entity.appearance.distinctiveMarks : []),
                    ...(Array.isArray(entity?.appearance?.clothing) ? entity.appearance.clothing : [])
                ].map(String).map(v => v.trim()).filter(Boolean).join('. ');
            const personality = typeof entity?.personality === 'string'
                ? entity.personality.trim()
                : [
                    ...(Array.isArray(entity?.personality?.traits) ? entity.personality.traits : []),
                    typeof entity?.personality?.sexualOrientation === 'string' && entity.personality.sexualOrientation.trim()
                        ? [`Sexual attitude: ${entity.personality.sexualOrientation.trim()}`]
                        : [],
                    ...(Array.isArray(entity?.personality?.sexualPreferences) && entity.personality.sexualPreferences.length > 0
                        ? [`Sexual preferences: ${entity.personality.sexualPreferences.map(String).map(v => v.trim()).filter(Boolean).join(', ')}`]
                        : [])
                ].flat().map(String).map(v => v.trim()).filter(Boolean).join('. ');
            const background = typeof entity?.background === 'string'
                ? entity.background.trim()
                : [
                    typeof entity?.background?.origin === 'string' ? entity.background.origin : '',
                    typeof entity?.background?.occupation === 'string' && entity.background.occupation.trim()
                        ? `Occupation: ${entity.background.occupation.trim()}`
                        : '',
                    ...(Array.isArray(entity?.background?.history) ? entity.background.history : []),
                ].map(String).map(v => v.trim()).filter(Boolean).join('. ');
            const explicitOccupation = String(entity?.occupation || entity?.background?.occupation || '').trim();
            const explicitLocation = String(entity?.currentLocation || entity?.location || entity?.status?.currentLocation || '').trim();
            const parsedSex = extractBiologicalSexFromEntityPayload(entity);
            const explicitSexualOrientation = String(entity?.sexualOrientation || entity?.sexualAttitude || entity?.personality?.sexualOrientation || entity?.personality?.sexualAttitude || '').trim();
            const explicitSexualPreferences = Array.isArray(entity?.sexualPreferences)
                ? entity.sexualPreferences.map(String).filter(Boolean)
                : (Array.isArray(entity?.personality?.sexualPreferences) ? entity.personality.sexualPreferences.map(String).filter(Boolean) : []);

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
            const occupationPatterns = [
                /\b(?:current|present|latest)\s+occupation\s*[:\-]\s*([^.;\n]+)/i,
                /\boccupation\s*[:\-]\s*([^.;\n]+)/i,
                /\bjob\s*[:\-]\s*([^.;\n]+)/i,
                /직업\s*[:\-]\s*([^.;\n]+)/i
            ];
            const locationPatterns = [
                /\b(?:currently|currently at|current|present|latest)\s+(?:location|whereabouts|place)\s*[:\-]\s*([^.;\n]+)/i,
                /\bcurrent location\s*[:\-]\s*([^.;\n]+)/i,
                /\blocation\s*[:\-]\s*([^.;\n]+)/i,
                /현재\s*위치\s*[:\-]\s*([^.;\n]+)/i,
                /위치\s*[:\-]\s*([^.;\n]+)/i
            ];

            const parsedSexualOrientation = explicitSexualOrientation || pickLatestExplicitField(personality, sexualOrientationPatterns);
            const parsedSexualPreferences = explicitSexualPreferences.length > 0
                ? dedupeTextArray(explicitSexualPreferences)
                : normalizeDelimitedList(pickLatestExplicitField(personality, sexualPreferencePatterns));
            const parsedOccupation = explicitOccupation || pickLatestExplicitField(background, occupationPatterns);
            const parsedLocation = explicitLocation || pickLatestExplicitField(background, locationPatterns);

            const cleanedPersonality = stripLabeledFragments(personality, [
                /sexual attitudes?\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /sexual orientation\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /성관념\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /sexual preferences?\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /sexual preference\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /성적취향\s*[:\-]\s*[^.;\n]+[.;]?/gi
            ]);
            const cleanedBackground = stripLabeledFragments(background, [
                /\b(?:current|present|latest)\s+occupation\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /\boccupation\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /\bjob\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /직업\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /\b(?:currently|currently at|current|present|latest)\s+(?:location|whereabouts|place)\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /\bcurrent location\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /\blocation\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /현재\s*위치\s*[:\-]\s*[^.;\n]+[.;]?/gi,
                /위치\s*[:\-]\s*[^.;\n]+[.;]?/gi
            ]);

            return {
                name: String(entity?.name || '').trim(),
                sex: parsedSex,
                appearance,
                personality: cleanedPersonality,
                background: cleanedBackground,
                occupation: parsedOccupation,
                currentLocation: '',
                sexualOrientation: parsedSexualOrientation,
                sexualPreferences: parsedSexualPreferences
            };
        };

        const mergeColdStartArrayValues = (left, right, limit = 24) => {
            const out = [];
            const seen = new Set();
            for (const item of [...(Array.isArray(left) ? left : (left ? [left] : [])), ...(Array.isArray(right) ? right : (right ? [right] : []))]) {
                if (item == null || item === '') continue;
                const key = isColdStartPlainObject(item)
                    ? JSON.stringify({
                        id: item.id || item.eventId || '',
                        label: item.label || item.summary || item.snippet || item.text || '',
                        turn: item.turn || 0
                    }).toLowerCase()
                    : normalizeKnowledgeText(item);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(isColdStartPlainObject(item) ? safeClone(item) : item);
            }
            return out.slice(-Math.max(1, Number(limit || 24) || 24));
        };
        const hasColdStartMergeValue = (value) => {
            if (Array.isArray(value)) return value.some(hasColdStartMergeValue);
            if (isColdStartPlainObject(value)) return Object.values(value).some(hasColdStartMergeValue);
            return value !== null && value !== undefined && String(value).trim() !== '';
        };
        const mergeColdStartStructuredValue = (left, right, path = '') => {
            if (!hasColdStartMergeValue(left)) return isColdStartPlainObject(right) || Array.isArray(right) ? safeClone(right) : right;
            if (!hasColdStartMergeValue(right)) return isColdStartPlainObject(left) || Array.isArray(left) ? safeClone(left) : left;
            if (Array.isArray(left) || Array.isArray(right)) return mergeColdStartArrayValues(left, right);
            if (isColdStartPlainObject(left) || isColdStartPlainObject(right)) {
                const out = {};
                const lObj = isColdStartPlainObject(left) ? left : {};
                const rObj = isColdStartPlainObject(right) ? right : {};
                for (const key of new Set([...Object.keys(lObj), ...Object.keys(rObj)])) {
                    out[key] = mergeColdStartStructuredValue(lObj[key], rObj[key], `${path}.${key}`);
                }
                return out;
            }
            if (typeof left === 'number' || typeof right === 'number') {
                const lNum = Number(left);
                const rNum = Number(right);
                if (/confidence|salience|importance|pressure|turn|last/i.test(path)) {
                    return Math.max(Number.isFinite(lNum) ? lNum : 0, Number.isFinite(rNum) ? rNum : 0);
                }
                return Number.isFinite(lNum) ? lNum : right;
            }
            if (typeof left === 'boolean' || typeof right === 'boolean') return !!left || !!right;
            return coalesceKnowledgeField(left, right);
        };
        const buildColdStartEntityV2Fields = (entity, normalized = {}, options = {}) => {
            const sourceEntity = {
                ...(entity && typeof entity === 'object' ? entity : {}),
                sex: normalized.sex || entity?.sex || entity?.biologicalSex || '',
                appearance: entity?.appearance || normalized.appearance || '',
                personality: entity?.personality || normalized.personality || entity?.details || '',
                background: entity?.background || normalized.background || '',
                occupation: entity?.occupation || normalized.occupation || '',
                currentLocation: ''
            };
            const extension = compactColdStartEntityExtension(sourceEntity);
            const anchorTurn = Math.max(0, Number(options.anchorTurn || 0) || 0);
            const suppressSyntheticEvidence = options.suppressSyntheticEvidence === true;
            const evidence = compactColdStartEvidence(entity?.evidence || entity?.evidenceItems || extension.evidence, {
                fallbackSnippet: suppressSyntheticEvidence ? '' : (entity?.details || normalized.background || normalized.personality || normalized.appearance || entity?.summary || ''),
                sourceKind: options.sourceKind || 'cold_start_entity',
                turn: suppressSyntheticEvidence ? 0 : anchorTurn,
                confidence: extension.quality?.confidence || 0.65,
                limit: 10
            });
            const stateSummary = coalesceKnowledgeField(extension.currentState?.summary, entity?.currentState, entity?.current_state);
            const baselineEpisode = stateSummary && !suppressSyntheticEvidence
                ? [{ turn: anchorTurn, summary: stateSummary, impact: '', stability: 'baseline' }]
                : [];
            return mergeColdStartStructuredValue(extension, {
                identity: {
                    sex: normalized.sex || '',
                    occupation: normalized.occupation || extension.identity?.occupation || '',
                    source: evidence[0] || null
                },
                currentState: {
                    summary: stateSummary,
                    location: '',
                    lastObservedTurn: anchorTurn
                },
                episodeLedger: extension.episodeLedger?.length ? extension.episodeLedger : baselineEpisode,
                evidence,
                quality: {
                    confidence: Math.max(extension.quality?.confidence || 0, evidence.length ? 0.65 : 0),
                    salience: extension.quality?.salience || 0,
                    importance: extension.quality?.importance || 0,
                    pressure: extension.quality?.pressure || 0,
                    lastUpdatedTurn: suppressSyntheticEvidence ? 0 : anchorTurn,
                    sourceMix: suppressSyntheticEvidence
                        ? []
                        : compactColdStartList([options.sourceId || '', options.sourceKind || 'cold_start_entity'].filter(Boolean), 6, 64),
                    needsReview: !!extension.quality?.needsReview
                }
            }, 'entity');
        };
        const buildColdStartRelationV2Fields = (relation = {}, options = {}) => {
            const extension = compactColdStartRelationExtension(relation);
            const anchorTurn = Math.max(0, Number(options.anchorTurn || 0) || 0);
            const suppressSyntheticEvidence = options.suppressSyntheticEvidence === true;
            const statusSummary = coalesceKnowledgeField(extension.currentStatus?.summary, relation?.status, relation?.sentiment, relation?.type);
            const evidence = compactColdStartEvidence(relation?.evidence || relation?.evidenceItems || extension.evidence, {
                fallbackSnippet: suppressSyntheticEvidence ? '' : statusSummary,
                sourceKind: options.sourceKind || 'cold_start_relation',
                turn: suppressSyntheticEvidence ? 0 : anchorTurn,
                confidence: extension.quality?.confidence || 0.65,
                limit: 10
            });
            const baselineEvent = statusSummary && !suppressSyntheticEvidence
                ? [{ turn: anchorTurn, summary: statusSummary, impact: '', stability: 'baseline' }]
                : [];
            return mergeColdStartStructuredValue(extension, {
                currentStatus: {
                    summary: statusSummary,
                    lastChangedTurn: anchorTurn
                },
                eventLedger: extension.eventLedger?.length ? extension.eventLedger : baselineEvent,
                evidence,
                quality: {
                    confidence: Math.max(extension.quality?.confidence || 0, evidence.length ? 0.65 : 0),
                    salience: extension.quality?.salience || 0,
                    importance: extension.quality?.importance || 0,
                    pressure: extension.quality?.pressure || 0,
                    lastUpdatedTurn: suppressSyntheticEvidence ? 0 : anchorTurn,
                    sourceMix: suppressSyntheticEvidence
                        ? []
                        : compactColdStartList([options.sourceId || '', options.sourceKind || 'cold_start_relation'].filter(Boolean), 6, 64)
                }
            }, 'relation');
        };

        const dedupeEntitiesForMerge = (entities) => {
            const merged = new Map();
            for (const entity of (Array.isArray(entities) ? entities : [])) {
                const normalized = extractImportedEntityFields(entity);
                const name = String(normalized?.name || '').trim();
                if (!name) continue;
                const key = EntityManager.normalizeName(name);
                const extension = buildColdStartEntityV2Fields(entity, normalized, { sourceKind: 'cold_start_entity' });
                const prev = merged.get(key) || { name, sex: '', appearance: '', personality: '', background: '', occupation: '', currentLocation: '', sexualOrientation: '', sexualPreferences: [], extension: {} };
                merged.set(key, {
                    name: prev.name || name,
                    sex: prev.sex || normalized?.sex || '',
                    appearance: coalesceKnowledgeField(prev.appearance, normalized?.appearance),
                    personality: coalesceKnowledgeField(prev.personality, normalized?.personality),
                    background: coalesceKnowledgeField(prev.background, normalized?.background),
                    occupation: coalesceKnowledgeField(prev.occupation, normalized?.occupation),
                    currentLocation: '',
                    sexualOrientation: coalesceKnowledgeField(prev.sexualOrientation, normalized?.sexualOrientation),
                    sexualPreferences: dedupeTextArray([...(Array.isArray(prev.sexualPreferences) ? prev.sexualPreferences : []), ...(Array.isArray(normalized?.sexualPreferences) ? normalized.sexualPreferences : [])]),
                    extension: mergeColdStartStructuredValue(prev.extension || {}, extension, 'entity')
                });
            }
            return Array.from(merged.values());
        };

        const dedupeRelationsForMerge = (relations) => {
            const merged = new Map();
            for (const relation of (Array.isArray(relations) ? relations : [])) {
                const entityA = EntityManager.normalizeName(relation?.entityA || '');
                const entityB = EntityManager.normalizeName(relation?.entityB || '');
                if (!entityA || !entityB || entityA === entityB) continue;
                const key = [entityA, entityB].sort().join('__');
                const extension = buildColdStartRelationV2Fields(relation, { sourceKind: 'cold_start_relation' });
                const prev = merged.get(key) || { entityA, entityB, type: '', sentiment: '', extension: {} };
                merged.set(key, {
                    entityA: prev.entityA || entityA,
                    entityB: prev.entityB || entityB,
                    type: coalesceKnowledgeField(prev.type, relation?.type),
                    sentiment: coalesceKnowledgeField(prev.sentiment, relation?.sentiment),
                    extension: mergeColdStartStructuredValue(prev.extension || {}, extension, 'relation')
                });
            }
            return Array.from(merged.values());
        };

        const looksLikePhenomenaRule = (text) => false;
        const rebuildWorldCustomRules = (items) => {
            const rules = {};
            dedupeTextArray(items).forEach((item, index) => {
                rules[`rule_${index + 1}`] = item;
            });
            return rules;
        };
        const normalizeImportedWorldStatements = (world) => {
            const statements = [];
            const pushStatement = (value) => {
                for (const line of normalizeWorldCanonTextList(value, 40)) statements.push(line);
            };
            // Only explicit schema free-form rule fields are normalized here. Tech,
            // setting, systems, and physics fields stay in their structured buckets.
            for (const rule of (Array.isArray(world?.rules) ? world.rules : [])) pushStatement(rule);
            const customRules = normalizeWorldCustomRules(world?.custom);
            for (const value of Object.values(customRules)) pushStatement(value);
            return dedupeTextArray(statements);
        };
        const mergeImportedWorldRules = (existingRules, world = {}, fallbackNarrative = '') => {
            const base = safeClone(existingRules || {});
            base.exists = (base.exists && typeof base.exists === 'object') ? base.exists : {};
            base.systems = (base.systems && typeof base.systems === 'object') ? base.systems : {};
            base.physics = (base.physics && typeof base.physics === 'object') ? base.physics : {};
            base.setting = normalizeWorldSettingRules(base.setting);
            const incoming = buildImportedWorldRuleUpdate(world, fallbackNarrative);

            base.exists = {
                ...base.exists,
                ...incoming.exists,
                mythical_creatures: dedupeTextArray([...(Array.isArray(base.exists?.mythical_creatures) ? base.exists.mythical_creatures : []), ...(Array.isArray(incoming.exists?.mythical_creatures) ? incoming.exists.mythical_creatures : [])]),
                non_human_races: dedupeTextArray([...(Array.isArray(base.exists?.non_human_races) ? base.exists.non_human_races : []), ...(Array.isArray(incoming.exists?.non_human_races) ? incoming.exists.non_human_races : [])])
            };
            base.systems = { ...base.systems, ...incoming.systems };
            base.setting = normalizeWorldSettingRules({
                places: [...base.setting.places, ...normalizeWorldSettingRules(incoming.setting).places],
                organizations: [...base.setting.organizations, ...normalizeWorldSettingRules(incoming.setting).organizations],
                socialRules: [...base.setting.socialRules, ...normalizeWorldSettingRules(incoming.setting).socialRules]
            });
            base.physics = { ...base.physics, ...incoming.physics };

            const legacyCustomValues = Object.values(normalizeWorldCustomRules(base.custom || {}));
            const legacyPhysicsValues = Array.isArray(base.physics?.special_phenomena) ? base.physics.special_phenomena : [];
            const incomingCustomValues = Object.values(normalizeWorldCustomRules(incoming.custom || {}));
            const incomingPhysicsValues = Array.isArray(incoming.physics?.special_phenomena) ? incoming.physics.special_phenomena : [];

            // Preserve only the structured bucket chosen by the LLM/schema. Do not
            // re-bucket custom rules into phenomena through local keywords.
            base.physics.special_phenomena = dedupeTextArray([
                ...legacyPhysicsValues,
                ...incomingPhysicsValues
            ].filter(value => !isDiscardableWorldCanonFragment(value)));
            base.custom = rebuildWorldCustomRules([
                ...legacyCustomValues,
                ...incomingCustomValues
            ].filter(value => !isDiscardableWorldCanonFragment(value)));
            return sanitizeWorldRuleUpdateForPolicy(base, [
                fallbackNarrative,
                collectWorldRuleEvidenceText(world),
                collectWorldRuleEvidenceText(base)
            ].filter(Boolean).join('\n'));
        };
        const hasImportedWorldNegatedSignal = () => false;
        const hasImportedWorldAffirmedSignal = () => false;
        const buildImportedWorldRuleUpdate = (world = {}, fallbackNarrative = '') => {
            const statements = normalizeImportedWorldStatements(world);
            const sourceText = [
                String(world?.__genreSourceText || '').trim(),
                statements.join('\n')
            ].filter(Boolean).join('\n');
            const normalized = {
                classification: world?.classification && typeof world.classification === 'object'
                    ? safeClone(world.classification)
                    : {},
                exists: world?.exists && typeof world.exists === 'object' && !Array.isArray(world.exists)
                    ? safeClone(world.exists)
                    : {},
                systems: world?.systems && typeof world.systems === 'object' && !Array.isArray(world.systems)
                    ? safeClone(world.systems)
                    : {},
                physics: world?.physics && typeof world.physics === 'object' && !Array.isArray(world.physics)
                    ? safeClone(world.physics)
                    : {},
                setting: normalizeWorldSettingRules(world?.setting),
                custom: normalizeWorldCustomRules(world?.custom),
                __genreSourceText: sourceText
            };
            const rawTech = String(world?.tech || '').trim();
            if (rawTech && !String(normalized.exists.technology || '').trim()) {
                // `world.tech` is an explicit LLM field from the import schema, so it
                // may be preserved. No technology default is inferred from prose.
                normalized.exists.technology = rawTech;
            }

            const classifiedStatements = classifyWorldCanonStatements(statements);
            normalized.setting = normalizeWorldSettingRules({
                places: [
                    normalized.setting.places,
                    world?.places,
                    world?.locations,
                    world?.facilities,
                    classifiedStatements.places
                ],
                organizations: [
                    normalized.setting.organizations,
                    world?.organizations,
                    world?.orgs,
                    world?.factions,
                    classifiedStatements.organizations
                ],
                socialRules: [
                    normalized.setting.socialRules,
                    world?.social_rules,
                    world?.socialRules,
                    world?.culture,
                    world?.customs,
                    classifiedStatements.socialRules
                ]
            });
            const explicitPhenomena = normalizeWorldCanonTextList([
                world?.phenomena,
                world?.special_phenomena,
                world?.specialPhenomena,
                classifiedStatements.phenomena
            ], 20);
            if (explicitPhenomena.length > 0) {
                normalized.physics.special_phenomena = dedupeTextArray([
                    ...(Array.isArray(normalized.physics.special_phenomena) ? normalized.physics.special_phenomena : []),
                    ...explicitPhenomena
                ]);
            }
            const explicitCustom = [
                ...Object.values(normalizeWorldCustomRules(world?.custom)),
                ...classifiedStatements.custom
            ];
            normalized.custom = rebuildWorldCustomRules(explicitCustom);

            return normalizeWorldRuleUpdate(normalized);
        };
        const normalizeNarrativeStorylinesForMerge = (storylines, fallbackNarrative = '') => {
            const source = Array.isArray(storylines) ? storylines : [];
            const normalized = source.map((storyline, idx) => ({
                name: String(storyline?.name || `Storyline ${idx + 1}`).trim(),
                context: String(storyline?.context || storyline?.currentContext || fallbackNarrative || '').trim(),
                keyPoints: dedupeTextArray(storyline?.keyPoints),
                ongoingTensions: dedupeTextArray(storyline?.ongoingTensions),
                entities: dedupeTextArray(storyline?.entities)
            })).filter(item => item.name || item.context || item.keyPoints.length > 0 || item.ongoingTensions.length > 0 || item.entities.length > 0);
            if (normalized.length > 0) return normalized.slice(0, 6);
            if (!String(fallbackNarrative || '').trim()) return [];
            return [{
                name: 'Imported Storyline',
                context: String(fallbackNarrative || '').trim(),
                keyPoints: [],
                ongoingTensions: [],
                entities: []
            }];
        };
        const fallbackChunkSummariesToStructured = (chunkSummaries, fallbackNarrative = "Cold Start: Initial analysis applied.") => {
            const normalizedSummaries = (Array.isArray(chunkSummaries) ? chunkSummaries : [])
                .map(normalizeColdStartChunkSummary)
                .filter(summary =>
                    summary.events.length > 0
                    || summary.characters.length > 0
                    || summary.relationships.length > 0
                    || summary.world_rules.length > 0
                );
            const merged = {
                narrative: normalizedSummaries.map(c => c.events.join('; ')).filter(Boolean).join(' ') || fallbackNarrative,
                narrativeDetails: {
                    storylines: normalizeNarrativeStorylinesForMerge(normalizedSummaries.map((chunk, idx) => ({
                        name: `Imported Storyline ${idx + 1}`,
                        context: chunk.events.join('; '),
                        keyPoints: chunk.events,
                        ongoingTensions: [],
                        entities: chunk.characters.map(ch => ch?.name).filter(Boolean)
                    })), fallbackNarrative)
                },
                entities: [],
                relations: [],
                world: { tech: "unknown", rules: [] }
            };
            const nameSet = new Set();
            for (const chunk of normalizedSummaries) {
                for (const ch of chunk.characters) {
                    if (ch.name && !nameSet.has(ch.name)) {
                        nameSet.add(ch.name);
                        merged.entities.push({
                            name: ch.name,
                            appearance: "",
                            personality: ch.details || "",
                            background: "",
                            identity: {
                                roleInStory: ch.role || '',
                                summary: ch.details || ''
                            },
                            profile: {
                                speechStyle: { notes: compactColdStartList(ch.speechStyle || [], 4, 120) },
                                psychology: { baseline: compactColdStartText(ch.psychology || '', 180) }
                            },
                            currentState: { summary: compactColdStartText(ch.currentState || '', 220) },
                            evidence: compactColdStartEvidence(ch.evidence || [], {
                                fallbackSnippet: ch.details || ch.currentState || '',
                                sourceKind: 'cold_start_fallback',
                                confidence: 0.55,
                                limit: 4
                            })
                        });
                    }
                }
                for (const rel of chunk.relationships) {
                    if (rel.pair?.length === 2) {
                        merged.relations.push({
                            entityA: rel.pair[0],
                            entityB: rel.pair[1],
                            type: rel.status || "",
                            sentiment: "",
                            currentStatus: { summary: rel.status || '' },
                            dynamics: { recentChanges: compactColdStartList(rel.dynamics || [], 4, 140) },
                            evidence: compactColdStartEvidence(rel.evidence || [], {
                                fallbackSnippet: rel.status || '',
                                sourceKind: 'cold_start_relation_fallback',
                                confidence: 0.55,
                                limit: 4
                            })
                        });
                    }
                }
                merged.world.rules.push(...chunk.world_rules);
            }
            return sanitizeStructuredKnowledge(merged);
        };
        const mergeStructuredKnowledgeSnapshots = (...snapshots) => {
            const valid = snapshots.filter(item => item && typeof item === 'object');
            if (valid.length === 0) return null;
            const mergeWorldObjectField = (field) => valid.reduce((acc, item) => {
                const value = item?.world?.[field];
                return isColdStartPlainObject(value) ? { ...acc, ...safeClone(value) } : acc;
            }, {});
            return sanitizeStructuredKnowledge({
                narrative: valid.map(item => item?.narrative).find(value => String(value || '').trim()) || '',
                narrativeDetails: {
                    storylines: normalizeNarrativeStorylinesForMerge(valid.flatMap(item => Array.isArray(item?.narrativeDetails?.storylines) ? item.narrativeDetails.storylines : []))
                },
                entities: valid.flatMap(item => Array.isArray(item?.entities) ? item.entities : []),
                relations: valid.flatMap(item => Array.isArray(item?.relations) ? item.relations : []),
                world: {
                    tech: valid.map(item => item?.world?.tech).find(value => String(value || '').trim()) || '',
                    summary: valid.map(item => item?.world?.summary).find(value => String(value || '').trim()) || '',
                    description: valid.map(item => item?.world?.description).find(value => String(value || '').trim()) || '',
                    classification: mergeWorldObjectField('classification'),
                    exists: mergeWorldObjectField('exists'),
                    systems: mergeWorldObjectField('systems'),
                    physics: mergeWorldObjectField('physics'),
                    custom: mergeWorldObjectField('custom'),
                    __genreSourceText: valid.map(item => item?.world?.__genreSourceText).find(value => String(value || '').trim()) || '',
                    rules: valid.flatMap(item => Array.isArray(item?.world?.rules) ? item.world.rules : [])
                }
            });
        };
        const isLikelyFinalStructuredPayload = (value) => isColdStartPlainObject(value) && (
            Object.prototype.hasOwnProperty.call(value, 'narrative')
            || Object.prototype.hasOwnProperty.call(value, 'narrativeDetails')
            || Object.prototype.hasOwnProperty.call(value, 'entities')
            || Object.prototype.hasOwnProperty.call(value, 'relations')
            || Object.prototype.hasOwnProperty.call(value, 'world')
        );
        const isLikelyChunkSummaryPayload = (value) => isColdStartPlainObject(value) && (
            Object.prototype.hasOwnProperty.call(value, 'events')
            || Object.prototype.hasOwnProperty.call(value, 'characters')
            || Object.prototype.hasOwnProperty.call(value, 'relationships')
            || Object.prototype.hasOwnProperty.call(value, 'world_rules')
            || Object.prototype.hasOwnProperty.call(value, 'memory_seeds')
        );
        const coerceFinalSynthesisCandidate = (payload) => {
            if (Array.isArray(payload)) {
                const snapshots = payload
                    .map(item => coerceFinalSynthesisCandidate(item))
                    .filter(item => hasMeaningfulStructuredSnapshot(item));
                return mergeStructuredKnowledgeSnapshots(...snapshots);
            }
            if (!isColdStartPlainObject(payload)) return null;
            if (isLikelyFinalStructuredPayload(payload)) {
                const sanitized = sanitizeStructuredKnowledge(payload);
                if (hasMeaningfulStructuredSnapshot(sanitized)) return sanitized;
            }
            if (isLikelyChunkSummaryPayload(payload)) {
                const synthesized = fallbackChunkSummariesToStructured([payload], "Cold Start: Synthesis fallback applied.");
                if (hasMeaningfulStructuredSnapshot(synthesized)) return synthesized;
            }
            const sanitized = sanitizeStructuredKnowledge(payload);
            return hasMeaningfulStructuredSnapshot(sanitized) ? sanitized : null;
        };
        const normalizeFinalSynthesisPayload = (payload, fallbackSummaries = [], fallbackNarrative = "Cold Start: Synthesis fallback applied.") => {
            return coerceFinalSynthesisCandidate(payload)
                || fallbackChunkSummariesToStructured(fallbackSummaries, fallbackNarrative);
        };
        const hasColdStartCanonicalPacketShape = (value) => {
            if (!isColdStartPlainObject(value)) return false;
            const axisKeys = ['meta', 'memory', 'entity', 'world', 'narrative', 'guards', 'importance'];
            const axisCount = axisKeys.reduce((count, key) => count + (Object.prototype.hasOwnProperty.call(value, key) ? 1 : 0), 0);
            return axisCount >= 3 && !Array.isArray(value.entities);
        };
        const extractColdStartCanonicalPacket = (payload) => {
            if (Array.isArray(payload)) {
                for (const item of payload) {
                    const packet = extractColdStartCanonicalPacket(item);
                    if (packet) return packet;
                }
                return null;
            }
            if (!isColdStartPlainObject(payload)) return null;
            const candidates = [
                payload.canonicalPacket,
                payload.canonical_packet,
                payload.packet,
                payload.packet_patch,
                payload.canonical,
                payload.delta,
                payload
            ];
            return candidates.find(hasColdStartCanonicalPacketShape) || null;
        };
        const normalizeColdStartImportance = (value, fallback = 0.5) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return normalizeColdStart01(fallback, 0.5);
            return normalizeColdStart01(numeric > 1 ? numeric / 10 : numeric, fallback);
        };
        const collectColdStartPacketItems = (...values) => {
            const items = [];
            for (const value of values) {
                if (value == null) continue;
                if (Array.isArray(value)) items.push(...value);
                else if (isColdStartPlainObject(value)) items.push(...coerceColdStartObjectArray(value));
                else {
                    const text = compactColdStartText(value, 260);
                    if (text) items.push({ summary: text });
                }
            }
            return items.filter(Boolean);
        };
        const buildPacketEvidence = (value, fallbackSnippet = '', sourceKind = 'cold_start_packet', confidence = 0.68) => {
            const direct = isColdStartPlainObject(value)
                ? (value.evidence || value.evidence_snippet || value.source || value.reason || value.snippet)
                : value;
            return compactColdStartEvidence(direct, {
                fallbackSnippet,
                sourceKind,
                confidence,
                limit: 5
            });
        };
        const classifyColdStartEntityDetailFragments = (...values) => {
            const out = { appearance: [], personality: [], background: [], speech: [], psychology: [] };
            const fragments = compactColdStartList(values, 24, 220)
                .flatMap(item => normalizeDelimitedList(item).length > 1 ? normalizeDelimitedList(item) : [item])
                .map(item => String(item || '').trim())
                .filter(Boolean);
            const appearanceRe = /(hair|eye|skin|face|body|height|clothing|outfit|wearing|glasses|breast|chest|머리|눈동자|눈빛|안경|피부|체형|키|복장|옷|착용|블라우스|스커트|스타킹|가디건|가터|유방|가슴|쇄골|어깨|허리|맨발|금속 장식)/i;
            const speechRe = /(voice|tone|speech|말투|어조|목소리|말|존댓말|반말|허락을 구|정중한|낮고|부드러운 목소리)/i;
            const backgroundRe = /(teacher|student|librarian|academy|school|club|council|occupation|affiliation|origin|backstory|history|교사|학생|사서|아카데미|교육원|도서관|직업|소속|출신|과거|배경|역할|담당|고전문학|심리학)/i;
            const psychologyRe = /(psych|conflict|trauma|fear|desire|긴장|기대|갈등|두려움|욕망|수용적|불안|망설임|진심|존중|인내|상대방의 속도)/i;
            const personalityRe = /(personality|trait|attitude|value|kind|strict|gentle|careful|bold|성격|태도|가치관|친절|단호|신중|조심|우아|자애|적극|차분|헌신|장난|사려|인내심)/i;
            for (const fragment of fragments) {
                if (appearanceRe.test(fragment)) out.appearance.push(fragment);
                else if (speechRe.test(fragment)) out.speech.push(fragment);
                else if (backgroundRe.test(fragment)) out.background.push(fragment);
                else if (psychologyRe.test(fragment)) out.psychology.push(fragment);
                else if (personalityRe.test(fragment)) out.personality.push(fragment);
                else out.personality.push(fragment);
            }
            Object.keys(out).forEach(key => { out[key] = dedupeTextArray(out[key]).slice(0, 10); });
            return out;
        };
        const canonicalPacketToStructuredSnapshot = (packet, fallbackSnapshot = {}) => {
            if (!hasColdStartCanonicalPacketShape(packet)) return null;
            const meta = compactColdStartObject(packet.meta);
            const memory = compactColdStartObject(packet.memory);
            const entityAxis = compactColdStartObject(packet.entity);
            const world = compactColdStartObject(packet.world);
            const narrative = compactColdStartObject(packet.narrative);
            const guards = compactColdStartObject(packet.guards);

            const memoryEvents = collectColdStartPacketItems(memory.events, memory.timeline, memory.memories);
            const memoryFacts = collectColdStartPacketItems(memory.facts, memory.stable_facts);
            const memoryThreads = collectColdStartPacketItems(memory.open_threads, memory.unresolved, narrative.unresolved_threads);
            const memoryEventTexts = memoryEvents.map(item => compactColdStartText(item.summary || item.text || item.event || item, 260)).filter(Boolean);
            const narrativeSummary = compactColdStartText(
                narrative.summary
                || narrative.scene_summary
                || narrative.current_arc
                || meta.summary_memory?.summary
                || memoryEventTexts.join('; '),
                1400
            );

            const packetStorylines = collectColdStartPacketItems(narrative.storylines, narrative.arcs);
            const storylines = packetStorylines.map((storyline, idx) => {
                const context = compactColdStartText(
                    storyline.context
                    || storyline.currentContext
                    || storyline.summary
                    || storyline.current_arc
                    || storyline.status
                    || narrativeSummary,
                    420
                );
                return {
                    name: compactColdStartText(storyline.name || storyline.title || `Canonical Storyline ${idx + 1}`, 80),
                    context,
                    keyPoints: compactColdStartList([
                        storyline.keyPoints,
                        storyline.key_points,
                        storyline.events,
                        storyline.scene_deltas,
                        narrative.scene_deltas
                    ], 10, 180),
                    ongoingTensions: compactColdStartList([
                        storyline.ongoingTensions,
                        storyline.ongoing_tensions,
                        storyline.tensions,
                        storyline.unresolved_threads,
                        narrative.unresolved_threads,
                        narrative.conflict_traces
                    ], 10, 180),
                    entities: compactColdStartList(storyline.entities || storyline.characters, 12, 80)
                };
            });
            if (storylines.length === 0 && narrativeSummary) {
                storylines.push({
                    name: 'Canonical Timeline',
                    context: narrativeSummary,
                    keyPoints: compactColdStartList(memoryEventTexts, 10, 180),
                    ongoingTensions: compactColdStartList([memoryThreads, guards.uncertain, guards.conflicts], 10, 180),
                    entities: []
                });
            }

            const entityCandidates = collectColdStartPacketItems(
                entityAxis.characters,
                entityAxis.entities,
                entityAxis.people,
                entityAxis.character_states,
                entityAxis.current_state
            );
            const entities = entityCandidates.map((character) => {
                const name = compactColdStartText(character.name || character.character || character.entity || character.id || '', 120);
                if (!name) return null;
                const currentSummary = compactColdStartText(character.current_state || character.currentState || character.status || character.scene_state || '', 320);
                const classifiedDetails = classifyColdStartEntityDetailFragments(
                    character.details,
                    character.summary,
                    character.profile,
                    character.description
                );
                const appearanceText = compactColdStartText([
                    character.appearance,
                    character.looks,
                    character.visual,
                    classifiedDetails.appearance
                ], 360);
                const personalityText = compactColdStartText([
                    character.personality,
                    character.traits,
                    character.temperament,
                    classifiedDetails.personality
                ], 360);
                const backgroundText = compactColdStartText([
                    character.background,
                    character.history,
                    character.backstory,
                    classifiedDetails.background
                ], 420);
                const speechNotes = compactColdStartList([
                    character.speech_style,
                    character.speechStyle,
                    character.speech,
                    classifiedDetails.speech
                ], 8, 140);
                const characterPsychology = isColdStartPlainObject(character.psychology) ? character.psychology : {};
                const psychologyText = compactColdStartText([
                    characterPsychology.baseline,
                    characterPsychology.defaultState,
                    characterPsychology.default_state,
                    characterPsychology.core,
                    isColdStartPlainObject(character.psychology) ? '' : character.psychology,
                    character.psyche,
                    character.baselinePsychology,
                    character.psychologicalBaseline,
                    character.psychological_baseline,
                    classifiedDetails.psychology
                ], 240);
                const psychologyConflict = compactColdStartText([
                    characterPsychology.currentConflict,
                    characterPsychology.current_conflict,
                    characterPsychology.innerConflict,
                    characterPsychology.inner_conflict,
                    characterPsychology.internalConflict,
                    characterPsychology.internal_conflict,
                    characterPsychology.conflict,
                    character.current_conflict,
                    character.currentConflict,
                    character.inner_conflict,
                    character.innerConflict,
                    character.internal_conflict,
                    character.internalConflict,
                    character.conflict
                ], 220);
                const psychologyCopingStyle = compactColdStartText([
                    characterPsychology.copingStyle,
                    characterPsychology.coping_style,
                    characterPsychology.coping,
                    character.coping_style,
                    character.copingStyle,
                    character.coping
                ], 160);
                const psychologyNotes = compactColdStartList([
                    characterPsychology.notes,
                    characterPsychology.cues,
                    characterPsychology.signals,
                    character.psychology_notes,
                    character.psychological_notes,
                    character.mental_notes,
                    character.mentalNotes
                ], 8, 140);
                const profileSummary = compactColdStartText(character.identity || character.bio || backgroundText || '', 420);
                const importance = normalizeColdStartImportance(character.importance || character.salience || packet.importance?.entity, 0.55);
                const confidence = normalizeColdStartImportance(character.confidence || character.quality?.confidence, 0.68);
                return {
                    name,
                    sex: /^(male|female)$/i.test(String(character.sex || '').trim()) ? String(character.sex).trim().toLowerCase() : '',
                    appearance: appearanceText,
                    personality: personalityText,
                    background: backgroundText,
                    identity: {
                        age: compactColdStartText(character.age || '', 60),
                        occupation: compactColdStartText(character.occupation || character.job || '', 120),
                        affiliation: compactColdStartText(character.affiliation || character.group || '', 160),
                        roleInStory: compactColdStartText(character.role || character.roleInStory || '', 160),
                        summary: profileSummary,
                        aliases: compactColdStartList(character.aliases, 8, 80),
                        honorifics: compactColdStartList(character.honorifics, 8, 80)
                    },
                    profile: {
                        personality: {
                            values: compactColdStartList(character.values, 8, 120),
                            fears: compactColdStartList(character.fears, 8, 120),
                            likes: compactColdStartList(character.likes, 8, 120),
                            dislikes: compactColdStartList(character.dislikes, 8, 120),
                            boundaries: compactColdStartList(character.boundaries, 8, 120)
                        },
                        speechStyle: {
                            defaultTone: compactColdStartText(character.defaultTone || character.tone || '', 120),
                            honorificStyle: compactColdStartText(character.honorificStyle || '', 120),
                            pressureMarkers: compactColdStartList(character.pressureMarkers, 6, 120),
                            catchphrases: compactColdStartList(character.catchphrases, 6, 120),
                            notes: speechNotes
                        },
                        psychology: {
                            baseline: psychologyText,
                            currentConflict: psychologyConflict,
                            copingStyle: psychologyCopingStyle,
                            notes: psychologyNotes
                        }
                    },
                    currentState: {
                        summary: currentSummary,
                        sceneTime: compactColdStartText(character.time || character.sceneTime || world.time || '', 100),
                        location: '',
                        physicalState: compactColdStartList(character.physical_state || character.physicalState, 8, 120),
                        emotionalState: compactColdStartList(character.emotional_state || character.emotionalState, 8, 120),
                        cognitiveFocus: compactColdStartList(character.cognitive_focus || character.cognitiveFocus || character.focus, 8, 120),
                        immediateGoal: compactColdStartText(character.goal || character.immediateGoal || '', 180),
                        activeProblems: compactColdStartList(character.active_problems || character.activeProblems || character.problems, 8, 140)
                    },
                    continuity: {
                        openThreads: compactColdStartList([
                            character.open_threads,
                            character.openThreads,
                            character.activeThreads,
                            character.active_threads,
                            character.threads,
                            character.unresolvedThreads,
                            character.unresolved_threads,
                            character.openLoops,
                            character.open_loops,
                            character.openHooks,
                            character.open_hooks,
                            character.plotHooks,
                            character.plot_hooks,
                            character.looseEnds,
                            character.loose_ends,
                            character.pendingQuestions,
                            character.pending_questions,
                            character.unresolved
                        ], 8, 140)
                            .map(label => ({ label, status: 'active', pressure: 0 })),
                        unresolvedNeeds: compactColdStartList([character.unresolved_needs, character.unresolvedNeeds, character.needs, character.pendingNeeds, character.pending_needs], 8, 140),
                        commitments: compactColdStartList([character.commitments, character.promises, character.obligations], 8, 140),
                        nextActionHints: compactColdStartList([character.next_action_hints, character.nextActionHints, character.next_actions, character.nextActions, character.nextSteps, character.next_steps, character.plannedNextSteps, character.planned_next_steps], 8, 140)
                    },
                    povKnowledge: {
                        knownToSelf: compactColdStartList(character.known_to_self || character.knownToSelf, 8, 140),
                        unknownToSelf: compactColdStartList(character.unknown_to_self || character.unknownToSelf, 8, 140),
                        knownToOthers: compactColdStartList(character.known_to_others || character.knownToOthers, 8, 140),
                        visibleTo: compactColdStartList(character.visible_to || character.visibleTo, 8, 100),
                        privateExperiences: compactColdStartList(character.private_experiences || character.privateExperiences, 8, 140),
                        privacy: compactColdStartText(character.privacy || '', 120)
                    },
                    episodeLedger: currentSummary ? [{ turn: 0, summary: currentSummary, impact: '', stability: 'current_state' }] : [],
                    evidence: buildPacketEvidence(character, profileSummary || currentSummary, 'cold_start_entity_packet', confidence),
                    quality: {
                        confidence,
                        salience: importance,
                        importance,
                        pressure: normalizeColdStartImportance(character.pressure, 0),
                        needsReview: false
                    }
                };
            }).filter(Boolean);

            const relationCandidates = collectColdStartPacketItems(entityAxis.relations, entityAxis.relationships, packet.relations);
            const relations = relationCandidates.map((relation) => {
                const pair = Array.isArray(relation.pair) ? relation.pair : [];
                const entityA = compactColdStartText(relation.entityA || relation.a || relation.from || pair[0] || '', 120);
                const entityB = compactColdStartText(relation.entityB || relation.b || relation.to || pair[1] || '', 120);
                if (!entityA || !entityB) return null;
                const summary = compactColdStartText(relation.summary || relation.status || relation.currentStatus || relation.details || '', 360);
                const relationDynamics = isColdStartPlainObject(relation.dynamics) ? relation.dynamics : {};
                const rawDynamicsItems = isColdStartPlainObject(relation.dynamics) ? [] : relation.dynamics;
                const unresolvedIssues = compactColdStartList([
                    relation.unresolvedIssues,
                    relation.unresolved_issues,
                    relation.openIssues,
                    relation.open_issues,
                    relation.pendingIssues,
                    relation.pending_issues,
                    relation.issues,
                    relation.unresolved,
                    relation.pendingQuestions,
                    relation.pending_questions,
                    relationDynamics.unresolvedIssues,
                    relationDynamics.unresolved_issues,
                    relationDynamics.openIssues,
                    relationDynamics.open_issues,
                    relationDynamics.pendingIssues,
                    relationDynamics.pending_issues,
                    relationDynamics.issues,
                    relationDynamics.unresolved
                ], 8, 140);
                const recentChanges = compactColdStartList([
                    relation.recentChanges,
                    relation.recent_changes,
                    relation.changes,
                    relation.relationshipChanges,
                    relation.relationship_changes,
                    relation.relationshipDeltas,
                    relation.relationship_deltas,
                    relationDynamics.recentChanges,
                    relationDynamics.recent_changes,
                    relationDynamics.changes,
                    relationDynamics.relationshipChanges,
                    relationDynamics.relationship_changes,
                    relationDynamics.relationshipDeltas,
                    relationDynamics.relationship_deltas,
                    rawDynamicsItems,
                    relation.event,
                    summary
                ], 8, 140);
                const confidence = normalizeColdStartImportance(relation.confidence || relation.quality?.confidence, 0.65);
                const importance = normalizeColdStartImportance(relation.importance || relation.salience || packet.importance?.entity, 0.5);
                return {
                    entityA,
                    entityB,
                    type: compactColdStartText(relation.type || relation.relation || relation.label || summary, 120),
                    sentiment: compactColdStartText(relation.sentiment || relation.emotion || relation.affect || '', 120),
                    currentStatus: {
                        summary,
                        publicLayer: compactColdStartText(relation.publicLayer || relation.public_layer || '', 180),
                        privateLayer: compactColdStartText(relation.privateLayer || relation.private_layer || '', 180),
                        boundaryState: compactColdStartText(relation.boundaryState || relation.boundary_state || '', 180)
                    },
                    metrics: {
                        closeness: relation.closeness == null ? null : normalizeColdStartImportance(relation.closeness, 0),
                        trust: relation.trust == null ? null : normalizeColdStartImportance(relation.trust, 0),
                        tension: normalizeColdStartImportance(relation.tension, 0),
                        risk: normalizeColdStartImportance(relation.risk, 0),
                        ambiguity: relation.closeness == null && relation.trust == null ? 0.65 : normalizeColdStartImportance(relation.ambiguity, 0),
                        pressure: normalizeColdStartImportance(relation.pressure, 0)
                    },
                    dynamics: {
                        fromAtoB: compactColdStartList([relation.fromAtoB, relation.from_a_to_b, relationDynamics.fromAtoB, relationDynamics.from_a_to_b], 8, 140),
                        fromBtoA: compactColdStartList([relation.fromBtoA, relation.from_b_to_a, relationDynamics.fromBtoA, relationDynamics.from_b_to_a], 8, 140),
                        unresolvedIssues,
                        recentChanges
                    },
                    sharedContext: {
                        location: compactColdStartText(relation.location || '', 140),
                        workplace: compactColdStartText(relation.workplace || '', 140),
                        privateThreads: compactColdStartList(relation.private_threads || relation.privateThreads, 8, 140),
                        notes: compactColdStartList(relation.notes, 8, 140)
                    },
                    eventLedger: summary ? [{ turn: 0, summary, impact: '', stability: 'current_state' }] : [],
                    evidence: buildPacketEvidence(relation, summary, 'cold_start_relation_packet', confidence),
                    quality: {
                        confidence,
                        salience: importance,
                        importance,
                        pressure: normalizeColdStartImportance(relation.pressure, 0)
                    }
                };
            }).filter(Boolean);

            const worldRules = compactColdStartList([
                world.rules,
                world.laws,
                world.constraints
            ], 40, 240);
            const classifiedWorldRules = classifyWorldCanonStatements(worldRules);
            const worldSetting = normalizeWorldSettingRules({
                places: [
                    world.places,
                    world.locations,
                    world.facilities,
                    classifiedWorldRules.places
                ],
                organizations: [
                    world.organizations,
                    world.orgs,
                    world.factions,
                    classifiedWorldRules.organizations
                ],
                socialRules: [
                    world.social_rules,
                    world.socialRules,
                    world.culture,
                    world.customs,
                    classifiedWorldRules.socialRules
                ]
            });
            const worldPhenomena = normalizeWorldCanonTextList([
                world.phenomena,
                world.special_phenomena,
                world.specialPhenomena,
                classifiedWorldRules.phenomena
            ], 16);
            const customRules = {};
            classifiedWorldRules.custom.forEach((rule, index) => { customRules[`packet_rule_${index + 1}`] = rule; });
            const worldExists = {
                ...(isColdStartPlainObject(world.exists) ? safeClone(world.exists) : {}),
            };
            delete worldExists.currentTime;
            delete worldExists.currentLocation;
            delete worldExists.currentScene;
            Object.keys(worldExists).forEach(key => {
                if (worldExists[key] == null || worldExists[key] === '') delete worldExists[key];
            });
            const worldPhysics = isColdStartPlainObject(world.physics) ? safeClone(world.physics) : {};
            if (worldPhenomena.length > 0) {
                worldPhysics.special_phenomena = dedupeTextArray([...(Array.isArray(worldPhysics.special_phenomena) ? worldPhysics.special_phenomena : []), ...worldPhenomena]);
            }
            const worldState = {
                time: compactColdStartText(world.state?.time || world.time || '', 120),
                location: compactColdStartText(world.state?.location || world.location || '', 160),
                scene: compactColdStartText(world.state?.scene || world.scene || '', 260),
                activeEvents: compactColdStartList([world.state?.active_events, world.state?.activeEvents, world.active_events, world.activeEvents], 12, 220),
                offscreenThreads: compactColdStartList([world.state?.offscreen_threads, world.state?.offscreenThreads, world.offscreen_threads, world.offscreenThreads], 12, 220)
            };
            const worldSummary = compactColdStartText(world.summary || world.scene || world.description || worldRules.join('; '), 1200);

            return sanitizeStructuredKnowledge({
                narrative: narrativeSummary,
                narrativeDetails: { storylines },
                entities,
                relations,
                world: {
                    tech: compactColdStartText(world.tech || world.technology || worldExists.technology || '', 160),
                    summary: worldSummary,
                    description: compactColdStartText(world.description || worldSummary, 1200),
                    classification: isColdStartPlainObject(world.classification) ? safeClone(world.classification) : {},
                    exists: worldExists,
                    systems: isColdStartPlainObject(world.systems) ? safeClone(world.systems) : {},
                    setting: worldSetting,
                    physics: worldPhysics,
                    custom: customRules,
                    rules: normalizeWorldCanonTextList(worldRules, 40),
                    state: worldState
                }
            });
        };
        const normalizeCanonicalColdStartPayload = (payload, fallbackSummaries = [], fallbackNarrative = "Cold Start: Canonical packet fallback applied.") => {
            const packet = extractColdStartCanonicalPacket(payload);
            const structuredCandidates = isColdStartPlainObject(payload)
                ? [
                    payload.structuredSnapshot,
                    payload.structured_snapshot,
                    payload.snapshot,
                    payload.compatibilitySnapshot,
                    payload.compatibility_snapshot,
                    payload.compatibility?.structuredSnapshot,
                    payload.compatibility?.structured_snapshot
                ]
                : [];
            let structured = null;
            for (const candidate of structuredCandidates) {
                structured = coerceFinalSynthesisCandidate(candidate);
                if (hasMeaningfulStructuredSnapshot(structured)) break;
            }
            if (!structured && !packet) {
                structured = coerceFinalSynthesisCandidate(payload);
            }
            const packetSnapshot = packet ? canonicalPacketToStructuredSnapshot(packet, structured || {}) : null;
            const normalized = mergeStructuredKnowledgeSnapshots(
                ...(structured ? [structured] : []),
                ...(packetSnapshot ? [packetSnapshot] : [])
            ) || structured || packetSnapshot;
            return hasMeaningfulStructuredSnapshot(normalized)
                ? normalized
                : normalizeFinalSynthesisPayload(null, fallbackSummaries, fallbackNarrative);
        };
        const synthesizeChunkSummariesHierarchically = async (chunkSummaries, taskLabel = 'cold-start') => {
            const sourceSummaries = Array.isArray(chunkSummaries) ? chunkSummaries.filter(Boolean) : [];
            if (sourceSummaries.length === 0) return null;
            const isFastTask = /^cold-(?:start|reanalysis)/.test(String(taskLabel || ''));
            const fastLlm = isFastTask ? buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 3200 }) : null;

            const directInput = buildSynthesisInput(sourceSummaries);
            if (sourceSummaries.length <= HIERARCHICAL_SYNTHESIS_MAX_BATCHES && directInput.length <= SYNTHESIS_MAX_INPUT_CHARS) {
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const synthesisResult = await runMaintenanceLLM(() =>
                            LLMProvider.call(
                                isFastTask ? fastLlm.config : MemoryEngine.CONFIG,
                                ColdStartCanonicalPacketPrompt,
                                directInput,
                                { maxTokens: isFastTask ? 3600 : 4200, profile: isFastTask ? fastLlm.profile : 'primary', label: `${taskLabel}-canonical-synthesis-${attempt + 1}` }
                            )
                        , `${taskLabel}-canonical-synthesis-${attempt + 1}`);
                        if (synthesisResult.skipped) throw new Error("LLM이 구성되지 않았습니다.");
                        const parsed = extractStructuredJson(synthesisResult?.content || '');
                        const normalized = parsed ? normalizeCanonicalColdStartPayload(parsed, sourceSummaries) : null;
                        if (hasMeaningfulStructuredSnapshot(normalized)) return normalized;
                    } catch (e) {
                        if (attempt === 0) recordRuntimeDebug('warn', "[LIBRA] Direct synthesis attempt failed, retrying:", e?.message || e);
                    }
                }
                return normalizeFinalSynthesisPayload(null, sourceSummaries);
            }

            let layerReports = [];
            let currentBatches = batchItemsByCharLimit(sourceSummaries, compactChunkSummary, SYNTHESIS_MAX_INPUT_CHARS);

            for (let i = 0; i < currentBatches.length; i++) {
                const batch = currentBatches[i];
                const synthesisInput = buildSynthesisInput(batch);
                let parsed = null;
                for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
                    try {
                        const synthesisResult = await runMaintenanceLLM(() =>
                            LLMProvider.call(
                                isFastTask ? fastLlm.config : MemoryEngine.CONFIG,
                                ColdStartCanonicalPacketPrompt,
                                synthesisInput,
                                { maxTokens: isFastTask ? 3600 : 4200, profile: isFastTask ? fastLlm.profile : 'primary', label: `${taskLabel}-canonical-layer-1-batch-${i + 1}-attempt-${attempt + 1}` }
                            )
                        , `${taskLabel}-canonical-layer-1-batch-${i + 1}-attempt-${attempt + 1}`);
                        const candidate = extractStructuredJson(synthesisResult?.content || '');
                        parsed = candidate ? normalizeCanonicalColdStartPayload(candidate, batch, "Cold Start: Layer canonical fallback applied.") : null;
                    } catch (e) {
                        if (attempt === 0) recordRuntimeDebug('warn', '[LIBRA] Layer-1 synthesis retry:', e?.message || e);
                    }
                }
                layerReports.push(hasMeaningfulStructuredSnapshot(parsed) ? parsed : fallbackChunkSummariesToStructured(batch, "Cold Start: Layer synthesis fallback applied."));
            }

            for (let layer = 2; layer <= HIERARCHICAL_SYNTHESIS_MAX_LAYERS && layerReports.length > 1; layer++) {
                const nextReports = [];
                const reportBatches = batchItemsByCharLimit(layerReports, compactStructuredSnapshot, SYNTHESIS_MAX_INPUT_CHARS);
                for (let i = 0; i < reportBatches.length; i++) {
                    const batch = reportBatches[i];
                    const mergeInput = buildStructuredMergeInput(batch);
                    let parsed = null;
                    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
                        try {
                            const mergeResult = await runMaintenanceLLM(() =>
                                LLMProvider.call(
                                    isFastTask ? fastLlm.config : MemoryEngine.CONFIG,
                                    ColdStartCanonicalMergePrompt,
                                    mergeInput,
                                    { maxTokens: isFastTask ? 3800 : 4400, profile: isFastTask ? fastLlm.profile : 'primary', label: `${taskLabel}-canonical-layer-${layer}-batch-${i + 1}-attempt-${attempt + 1}` }
                            )
                        , `${taskLabel}-canonical-layer-${layer}-batch-${i + 1}-attempt-${attempt + 1}`);
                            const candidate = extractStructuredJson(mergeResult?.content || '');
                            parsed = candidate ? normalizeCanonicalColdStartPayload(candidate, batch, "Cold Start: Canonical merge fallback applied.") : null;
                        } catch (e) {
                            if (attempt === 0) recordRuntimeDebug('warn', `[LIBRA] Layer-${layer} merge retry:`, e?.message || e);
                        }
                    }
                    nextReports.push(hasMeaningfulStructuredSnapshot(parsed) ? parsed : (mergeStructuredKnowledgeSnapshots(...batch) || batch[0]));
                }
                layerReports = nextReports;
            }

            if (layerReports.length > 1) {
                return mergeStructuredKnowledgeSnapshots(...layerReports) || layerReports[0];
            }
            return layerReports[0] || fallbackChunkSummariesToStructured(sourceSummaries);
        };
        const sanitizeStructuredKnowledge = (finalData) => ({
            narrative: String(finalData?.narrative || '').trim(),
            narrativeDetails: {
                storylines: normalizeNarrativeStorylinesForMerge(finalData?.narrativeDetails?.storylines, finalData?.narrative || '')
            },
            entities: dedupeEntitiesForMerge(finalData?.entities),
            relations: dedupeRelationsForMerge(finalData?.relations),
            world: {
                tech: String(finalData?.world?.tech || '').trim(),
                summary: String(finalData?.world?.summary || '').trim(),
                description: String(finalData?.world?.description || '').trim(),
                classification: finalData?.world?.classification && typeof finalData.world.classification === 'object'
                    ? safeClone(finalData.world.classification)
                    : {},
                exists: finalData?.world?.exists && typeof finalData.world.exists === 'object' && !Array.isArray(finalData.world.exists)
                    ? safeClone(finalData.world.exists)
                    : {},
                systems: finalData?.world?.systems && typeof finalData.world.systems === 'object' && !Array.isArray(finalData.world.systems)
                    ? safeClone(finalData.world.systems)
                    : {},
                setting: normalizeWorldSettingRules(finalData?.world?.setting),
                physics: finalData?.world?.physics && typeof finalData.world.physics === 'object' && !Array.isArray(finalData.world.physics)
                    ? safeClone(finalData.world.physics)
                    : {},
                custom: normalizeWorldCustomRules(finalData?.world?.custom),
                state: {
                    time: String(finalData?.world?.state?.time || '').trim(),
                    location: String(finalData?.world?.state?.location || '').trim(),
                    scene: String(finalData?.world?.state?.scene || '').trim(),
                    activeEvents: normalizeWorldCanonTextList(finalData?.world?.state?.activeEvents || finalData?.world?.state?.active_events, 12),
                    offscreenThreads: normalizeWorldCanonTextList(finalData?.world?.state?.offscreenThreads || finalData?.world?.state?.offscreen_threads, 12)
                },
                __genreSourceText: String(finalData?.world?.__genreSourceText || '').trim(),
                rules: dedupeTextArray([
                    ...(Array.isArray(finalData?.world?.rules) ? finalData.world.rules : []),
                    ...normalizeWorldSettingRules(finalData?.world?.setting).places,
                    ...normalizeWorldSettingRules(finalData?.world?.setting).organizations,
                    ...normalizeWorldSettingRules(finalData?.world?.setting).socialRules,
                    ...Object.values(normalizeWorldCustomRules(finalData?.world?.custom))
                ].filter(value => !isDiscardableWorldCanonFragment(value)))
            }
        });
        const buildImportedKnowledgeSignalText = (sanitized) => {
            const parts = [
                String(sanitized?.narrative || '').trim(),
                String(sanitized?.world?.tech || '').trim(),
                String(sanitized?.world?.summary || '').trim(),
                String(sanitized?.world?.description || '').trim(),
                ...(Array.isArray(sanitized?.world?.rules) ? sanitized.world.rules : []),
                ...normalizeWorldSettingRules(sanitized?.world?.setting).places,
                ...normalizeWorldSettingRules(sanitized?.world?.setting).organizations,
                ...normalizeWorldSettingRules(sanitized?.world?.setting).socialRules,
                ...(Array.isArray(sanitized?.world?.physics?.special_phenomena) ? sanitized.world.physics.special_phenomena : []),
                ...((sanitized?.narrativeDetails?.storylines || []).flatMap(storyline => [
                    storyline?.name || '',
                    storyline?.context || '',
                    ...(Array.isArray(storyline?.keyPoints) ? storyline.keyPoints : []),
                    ...(Array.isArray(storyline?.ongoingTensions) ? storyline.ongoingTensions : [])
                ])),
                ...((sanitized?.entities || []).flatMap(entity => [
                    entity?.name || '',
                    entity?.appearance || '',
                    entity?.personality || '',
                    entity?.background || ''
                ]))
            ].map(item => String(item || '').trim()).filter(Boolean);
            return parts.join('\n');
        };
        const readStructuredWorldFlag = (world = {}, keys = []) => {
            const roots = [world?.global, world?.structure, world?.flags, world?.meta];
            for (const root of roots) {
                if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
                for (const key of keys) {
                    if (root[key] === true) return true;
                    if (root[key] === false) return false;
                }
            }
            return undefined;
        };
        const applyGlobalWorldFeaturesFromImportedKnowledge = (profile, sanitized) => {
            if (!profile?.global) return;
            const world = (sanitized?.world && typeof sanitized.world === 'object' && !Array.isArray(sanitized.world)) ? sanitized.world : {};
            const systems = (world.systems && typeof world.systems === 'object' && !Array.isArray(world.systems)) ? world.systems : {};
            const applyFlag = (targetKey, sourceKeys) => {
                const value = readStructuredWorldFlag(world, sourceKeys);
                if (value === true || value === false) profile.global[targetKey] = value;
            };
            applyFlag('multiverse', ['multiverse', 'multiVerse', 'multipleWorlds', 'multiple_worlds']);
            applyFlag('dimensionTravel', ['dimensionTravel', 'dimension_travel', 'interdimensionalTravel', 'interdimensional_travel']);
            applyFlag('timeTravel', ['timeTravel', 'time_travel', 'timeLoop', 'time_loop']);
            applyFlag('metaNarrative', ['metaNarrative', 'meta_narrative', 'fourthWall', 'fourth_wall']);
            applyFlag('virtualReality', ['virtualReality', 'virtual_reality', 'simulation']);
            applyFlag('dreamWorld', ['dreamWorld', 'dream_world']);
            applyFlag('reincarnationPossession', ['reincarnationPossession', 'reincarnation_possession', 'reincarnation', 'possession', 'transmigration']);
            const explicitSystemInterface = readStructuredWorldFlag(world, ['systemInterface', 'system_interface']);
            const structuredSystemInterface = [
                systems.systemInterface,
                systems.system_interface,
                systems.leveling,
                systems.skills,
                systems.stats,
                systems.classes,
                systems.quests,
                systems.inventory
            ].some(value => value === true);
            if (explicitSystemInterface === true || explicitSystemInterface === false) {
                profile.global.systemInterface = explicitSystemInterface;
            } else if (structuredSystemInterface) {
                profile.global.systemInterface = true;
            }
        };
        const refreshSectionWorldFromImportedKnowledge = async (sanitized, opts = {}) => {
            try {
                const worldPrompt = HierarchicalWorldManager.formatForPrompt();
                const worldStatePrompt = WorldStateTracker.formatForPrompt();
                const narrativePrompt = NarrativeTracker.formatForPrompt();
                const focusCharacters = dedupeTextArray([
                    ...(Array.isArray(sanitized?.entities) ? sanitized.entities.map(entity => entity?.name) : []),
                    ...((sanitized?.narrativeDetails?.storylines || []).flatMap(storyline => Array.isArray(storyline?.entities) ? storyline.entities : []))
                ]).slice(0, 8);
                const worldSettingHints = normalizeWorldSettingRules(sanitized?.world?.setting);
                const memoryHints = compactTextArray([
                    sanitized?.world?.rules,
                    worldSettingHints.places,
                    worldSettingHints.organizations,
                    worldSettingHints.socialRules,
                    sanitized?.world?.physics?.special_phenomena
                ], 8, 140);
                const loreHints = compactTextArray((sanitized?.narrativeDetails?.storylines || []).flatMap(storyline => Array.isArray(storyline?.keyPoints) ? storyline.keyPoints : []), 8, 140);
                if (!worldPrompt && !worldStatePrompt && !narrativePrompt && memoryHints.length === 0 && loreHints.length === 0) {
                    SectionWorldInferenceManager.resetState();
                    return '';
                }
                return await SectionWorldInferenceManager.inferPrompt(MemoryEngine.CONFIG, {
                    turn: MemoryEngine.getCurrentTurn?.() || 0,
                    userMsg: String(opts?.sourceLabel || opts?.worldNote || 'Imported knowledge').trim(),
                    worldPrompt,
                    worldStatePrompt,
                    narrativePrompt,
                    focusCharacters,
                    memoryHints,
                    loreHints
                });
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Section world refresh after import failed:', e?.message || e);
                return '';
            }
        };
        const resolveStructuredKnowledgeSourceLabel = (sourceId = 'baseline') => {
            const id = String(sourceId || 'baseline').trim();
            if (id === 'baseline') return 'cold_start';
            if (id === 'reanalysis') return 'reanalysis';
            if (id === 'hypa_v3') return 'hypa_v3_import';
            if (id === 'user_lorebook') return 'user_lorebook';
            return id || 'structured_import';
        };
        const getStructuredKnowledgeBaselineAnchorTurn = () => {
            const current = Number(MemoryEngine.getCurrentTurn?.() || MemoryState.currentTurn || 0);
            return Math.max(1, Number.isFinite(current) ? Math.floor(current) : 1);
        };
        const hasStructuredWorldStateValue = (state = {}) => !!(
            String(state?.time || '').trim()
            || String(state?.location || '').trim()
            || String(state?.scene || '').trim()
            || (Array.isArray(state?.activeEvents) && state.activeEvents.length > 0)
            || (Array.isArray(state?.offscreenThreads) && state.offscreenThreads.length > 0)
        );
        const recordStructuredWorldState = (sanitized = {}, anchorTurn = 0) => {
            const state = sanitized?.world?.state || {};
            if (!hasStructuredWorldStateValue(state)) return false;
            const profile = HierarchicalWorldManager.getProfile?.();
            const currentNode = HierarchicalWorldManager.getCurrentNode?.();
            const currentRules = HierarchicalWorldManager.getCurrentRules?.();
            WorldStateTracker.replaceState(Math.max(1, Number(anchorTurn || 0) || 1), {
                activePath: profile?.activePath || [],
                rules: currentRules || {},
                global: profile?.global || {},
                classification: currentNode?.meta?.classification || sanitized?.world?.classification?.primary || '',
                worldSummary: sanitized?.world?.summary || state.scene || '',
                currentTime: state.time || '',
                currentLocation: state.location || '',
                currentScene: state.scene || '',
                activeEvents: state.activeEvents || [],
                offscreenThreads: state.offscreenThreads || [],
                notes: compactTextArray([state.activeEvents, state.offscreenThreads], 8, 180).join(' | ')
            });
            return true;
        };
        const getColdStartSourceMessagesMaxTurn = (messages = []) => {
            const pairs = buildColdStartReplayableTurnPairs(Array.isArray(messages) ? messages : [], null);
            return Math.max(0, ...pairs.map(pair => normalizeLegacyMemoryTurnAnchor(pair?.turn || 0)).filter(Boolean));
        };
        const ROLLBACK_REPAIR_SOURCE_IDS = new Set([
            'rollback-delete-augment',
            'rollback-delete-augment-existing-data-verify',
            'rollback-repair'
        ]);
        const isRollbackRepairSourceLabel = (value = '') => {
            const text = String(value || '').trim().toLowerCase();
            return text && ROLLBACK_REPAIR_SOURCE_IDS.has(text);
        };
        const sanitizeRollbackAugmentStructuredData = (finalData, options = {}) => {
            const candidateTurns = new Set((Array.isArray(options?.candidateTurns) ? options.candidateTurns : [])
                .map(normalizeLegacyMemoryTurnAnchor)
                .filter(Boolean));
            const turnMatches = (value) => {
                const turn = normalizeLegacyMemoryTurnAnchor(value);
                return turn > 0 && candidateTurns.has(turn);
            };
            const turnLabelMatches = (value) => {
                const text = String(value || '').trim();
                const match = /^T?(\d+)$/i.exec(text);
                return !!(match && turnMatches(match[1]));
            };
            const evidenceArrayKeys = new Set(['evidence', 'evidenceItems', 'evidenceLog', 'sourceEvidence']);
            const turnArrayKeys = new Set(['turns', 'evidenceTurns']);
            const ledgerArrayKeys = new Set(['recentEvents', 'summaries', 'episodeLedger', 'eventLedger', 'turnLog', 'metaTurnLog']);
            const shouldDropEvidenceObject = (item = {}) => {
                if (!item || typeof item !== 'object') return false;
                const sourceValues = [item.sourceKind, item.source_kind, item.kind, item.source, item.sourceId, item.source_id, item.s_id];
                if (sourceValues.some(isRollbackRepairSourceLabel)) return true;
                return turnMatches(item.turn ?? item.sourceTurn ?? item.turnNumber ?? item.upToTurn ?? item.turnAnchor ?? item.turnAnchorTurn);
            };
            const sanitizeArray = (items = [], key = '') => {
                const source = Array.isArray(items) ? items : [];
                if (evidenceArrayKeys.has(key)) {
                    return source
                        .filter(item => {
                            if (typeof item === 'string') return !isRollbackRepairSourceLabel(item) && !turnLabelMatches(item);
                            return !shouldDropEvidenceObject(item);
                        })
                        .map(item => sanitizeValue(item, key))
                        .filter(item => item !== undefined && item !== null && String(typeof item === 'string' ? item : JSON.stringify(item || {})).trim());
                }
                if (key === 'sourceMix') {
                    return source.filter(item => !isRollbackRepairSourceLabel(item));
                }
                if (turnArrayKeys.has(key)) {
                    return source.filter(item => !turnMatches(item) && !turnLabelMatches(item));
                }
                if (ledgerArrayKeys.has(key)) {
                    return source
                        .filter(item => {
                            if (!item || typeof item !== 'object') return !turnMatches(item);
                            return !shouldDropEvidenceObject(item);
                        })
                        .map(item => sanitizeValue(item, key))
                        .filter(Boolean);
                }
                return source.map(item => sanitizeValue(item, key)).filter(item => item !== undefined);
            };
            const sanitizeValue = (value, key = '') => {
                if (Array.isArray(value)) return sanitizeArray(value, key);
                if (!value || typeof value !== 'object') {
                    if (['source', 'sourceId', 'sourceKind', 's_id'].includes(key) && isRollbackRepairSourceLabel(value)) return '';
                    return value;
                }
                const out = {};
                for (const [childKey, childValue] of Object.entries(value)) {
                    if (['source', 'sourceId', 'sourceKind', 's_id'].includes(childKey) && isRollbackRepairSourceLabel(childValue)) continue;
                    if (/^(turn|sourceTurn|turnNumber|upToTurn|turnAnchor|turnAnchorTurn|lockedTurn|finalizedTurn|lastUpdatedTurn|lastObservedTurn|lastChangedTurn)$/i.test(childKey) && turnMatches(childValue)) {
                        out[childKey] = 0;
                        continue;
                    }
                    out[childKey] = sanitizeValue(childValue, childKey);
                }
                if (out.quality && typeof out.quality === 'object' && Array.isArray(out.quality.sourceMix)) {
                    out.quality.sourceMix = out.quality.sourceMix.filter(item => !isRollbackRepairSourceLabel(item));
                }
                if (out.meta && typeof out.meta === 'object') {
                    if (isRollbackRepairSourceLabel(out.meta.source)) delete out.meta.source;
                    if (isRollbackRepairSourceLabel(out.meta.s_id)) delete out.meta.s_id;
                    if (isRollbackRepairSourceLabel(out.meta.sourceId)) delete out.meta.sourceId;
                }
                return out;
            };
            return sanitizeValue(safeClone(finalData || {}), '');
        };

        const buildMergedNarrativeStateFromImportedKnowledge = (sanitized, existingState = null, options = {}) => {
            const currentState = existingState && typeof existingState === 'object'
                ? safeClone(existingState)
                : { storylines: [], turnLog: [], lastSummaryTurn: 0 };
            const incomingStorylines = normalizeNarrativeStorylinesForMerge(
                sanitized?.narrativeDetails?.storylines,
                sanitized?.narrative || ''
            );
            if (incomingStorylines.length === 0 && !String(sanitized?.narrative || '').trim()) {
                return currentState;
            }

            const baselineAnchorTurn = Math.max(1, Number(options?.anchorTurn || getStructuredKnowledgeBaselineAnchorTurn()));
            const baselineSourceId = String(options?.sourceId || 'baseline');
            const baselineReason = baselineSourceId === 'baseline' ? 'cold-start-baseline' : `${baselineSourceId}-structured-baseline`;
            const suppressSyntheticAnchors = options?.suppressSyntheticEvidence === true || options?.suppressSyntheticNarrativeAnchors === true;
            const byKey = new Map();
            const makeKey = (storyline) => {
                const name = String(storyline?.name || '').trim().toLowerCase();
                if (name) return `name:${name}`;
                const entities = Array.isArray(storyline?.entities) ? storyline.entities.map(v => String(v || '').trim().toLowerCase()).filter(Boolean).sort().join('|') : '';
                return entities ? `entities:${entities}` : `fallback:${TokenizerEngine.simpleHash(JSON.stringify(storyline || {}))}`;
            };

            for (const storyline of (Array.isArray(currentState.storylines) ? currentState.storylines : [])) {
                const cloned = safeClone(storyline);
                byKey.set(makeKey(cloned), cloned);
            }

            incomingStorylines.forEach((storyline, idx) => {
                const key = makeKey(storyline);
                const prev = byKey.get(key);
                const summaryText = storyline.context || sanitized.narrative || '';
                const summaryEntry = {
                    upToTurn: baselineAnchorTurn,
                    summary: summaryText,
                    keyPoints: [...storyline.keyPoints],
                    ongoingTensions: [...storyline.ongoingTensions],
                    timestamp: Date.now(),
                    baseline: true,
                    sourceId: baselineSourceId,
                    turnAnchor: baselineAnchorTurn,
                    turnAnchorTurn: baselineAnchorTurn,
                    lockedTurn: baselineAnchorTurn,
                    finalizedTurn: baselineAnchorTurn,
                    turnAnchorReason: baselineReason
                };
                if (prev) {
                    prev.name = storyline.name || prev.name || `Imported Storyline ${idx + 1}`;
                    prev.entities = dedupeTextArray([...(Array.isArray(prev.entities) ? prev.entities : []), ...(Array.isArray(storyline.entities) ? storyline.entities : []), ...((sanitized.entities || []).map(e => e.name).filter(Boolean))]);
                    prev.currentContext = coalesceKnowledgeField(prev.currentContext, summaryText);
                    prev.keyPoints = dedupeTextArray([...(Array.isArray(prev.keyPoints) ? prev.keyPoints : []), ...storyline.keyPoints]);
                    prev.ongoingTensions = dedupeTextArray([...(Array.isArray(prev.ongoingTensions) ? prev.ongoingTensions : []), ...storyline.ongoingTensions]);
                    prev.recentEvents = Array.isArray(prev.recentEvents) ? prev.recentEvents : [];
                    if (summaryText && !suppressSyntheticAnchors) {
                        prev.recentEvents.push({ turn: baselineAnchorTurn, brief: summaryText });
                        prev.recentEvents = prev.recentEvents.slice(-10);
                    }
                    prev.summaries = Array.isArray(prev.summaries) ? prev.summaries.filter(entry => entry?.live !== true) : [];
                    if (!suppressSyntheticAnchors && (summaryText || summaryEntry.keyPoints.length > 0 || summaryEntry.ongoingTensions.length > 0)) {
                        prev.summaries.push(summaryEntry);
                        prev.summaries = prev.summaries.slice(-12);
                    }
                } else {
                    byKey.set(key, {
                        id: idx + 1,
                        name: storyline.name || `Imported Storyline ${idx + 1}`,
                        entities: storyline.entities.length > 0 ? storyline.entities : (sanitized.entities || []).map(e => e.name).filter(Boolean),
                        turns: suppressSyntheticAnchors ? [] : [baselineAnchorTurn],
                        firstTurn: suppressSyntheticAnchors ? 0 : baselineAnchorTurn,
                        lastTurn: suppressSyntheticAnchors ? 0 : baselineAnchorTurn,
                        recentEvents: summaryText && !suppressSyntheticAnchors ? [{ turn: baselineAnchorTurn, brief: summaryText }] : [],
                        summaries: !suppressSyntheticAnchors && (summaryText || summaryEntry.keyPoints.length > 0 || summaryEntry.ongoingTensions.length > 0) ? [summaryEntry] : [],
                        currentContext: summaryText,
                        keyPoints: [...storyline.keyPoints],
                        ongoingTensions: [...storyline.ongoingTensions],
                        meta: { manualLocked: false, manualLockedAt: 0, baseline: true, sourceId: baselineSourceId, turnAnchor: baselineAnchorTurn, turnAnchorTurn: baselineAnchorTurn, lockedTurn: baselineAnchorTurn, finalizedTurn: baselineAnchorTurn, turnAnchorReason: baselineReason }
                    });
                }
            });

            return {
                ...currentState,
                storylines: Array.from(byKey.values()),
                turnLog: Array.isArray(currentState.turnLog) ? currentState.turnLog : [],
                lastSummaryTurn: suppressSyntheticAnchors
                    ? Number(currentState.lastSummaryTurn || 0)
                    : Math.max(Number(currentState.lastSummaryTurn || 0), baselineAnchorTurn)
            };
        };

        const mergeStructuredKnowledge = async (finalData, options = {}) => {
            const opts = {
                updateNarrative: true,
                worldNote: "Updated via Cold Start",
                sourceId: 'baseline',
                suppressSyntheticEvidence: false,
                suppressSyntheticNarrativeAnchors: false,
                preserveExistingMetaSource: false,
                ...options
            };
            const sanitized = sanitizeStructuredKnowledge(finalData);
            if (!hasMeaningfulStructuredSnapshot(sanitized)) {
                throw new Error('적용할 구조화 데이터가 없습니다.');
            }
            const resolvedSource = resolveStructuredKnowledgeSourceLabel(opts.sourceId);
            const sourceMaxTurn = getColdStartSourceMessagesMaxTurn(opts.sourceMessages);
            const baselineAnchorTurn = Math.max(1, Number(opts.anchorTurn || sourceMaxTurn || getStructuredKnowledgeBaselineAnchorTurn()));
            await loreLock.writeLock();
            try {
                let char = null;
                let chat = null;
                if (opts.targetChat?.id) {
                    const targetCtx = await resolveActiveChatContext(opts.targetChat);
                    if (!targetCtx?.char || !targetCtx?.chat || String(targetCtx.chat?.id || '') !== String(opts.targetChat.id || '')) {
                        throw new Error('구조 반영 대상 채팅방을 찾을 수 없습니다.');
                    }
                    char = targetCtx.char;
                    chat = targetCtx.chat;
                } else {
                    char = opts.targetChar || await requireLoadedCharacter();
                    chat = await getActiveChatForCharacter(char);
                }
                let lore = [...MemoryEngine.getLorebook(char, chat)];
                EntityManager.rebuildCache(lore);
                
                LMAI_GUI.toast("데이터 반영 중...");
                const activityContext = { scopeKey: getChatRuntimeScopeKey(chat, char), activityDashboard: MemoryEngine.CONFIG.activityDashboard };
                ActivityDashboardCore.update(activityContext, {
                    phase: 'structured-merge',
                    status: 'running',
                    progress: 82,
                    step: '데이터 반영',
                    stepStatus: 'running',
                    message: '엔티티, 관계, 세계관, 내러티브를 로어북에 반영합니다.'
                });

                if (opts.updateNarrative) {
                    const mergedNarrativeState = buildMergedNarrativeStateFromImportedKnowledge(
                        sanitized,
                        NarrativeTracker.getState(),
                        {
                            sourceId: opts.sourceId,
                            anchorTurn: baselineAnchorTurn,
                            suppressSyntheticEvidence: opts.suppressSyntheticEvidence,
                            suppressSyntheticNarrativeAnchors: opts.suppressSyntheticNarrativeAnchors
                        }
                    );
                    NarrativeTracker.resetState(mergedNarrativeState);
                }

                // 2. Entities & Relations 반영
                for (const ent of (sanitized.entities || [])) {
                    if (!ent.name) continue;
                    const normalizedEntity = extractImportedEntityFields(ent);
                    const extendedEntity = mergeColdStartStructuredValue(
                        ent.extension || {},
                        buildColdStartEntityV2Fields(ent, normalizedEntity, {
                            sourceId: opts.suppressSyntheticEvidence ? '' : resolvedSource,
                            sourceKind: opts.suppressSyntheticEvidence ? '' : 'cold_start_entity',
                            anchorTurn: baselineAnchorTurn,
                            suppressSyntheticEvidence: opts.suppressSyntheticEvidence
                        }),
                        'entity'
                    );
                    const entityPatch = {
                        sex: normalizedEntity.sex || '',
                        appearance: { features: [normalizedEntity.appearance || ''] },
                        personality: {
                            traits: [normalizedEntity.personality || ''],
                            sexualOrientation: normalizedEntity.sexualOrientation || '',
                            sexualPreferences: Array.isArray(normalizedEntity.sexualPreferences) ? normalizedEntity.sexualPreferences : []
                        },
                        background: {
                            origin: normalizedEntity.background || '',
                            occupation: normalizedEntity.occupation || ''
                        },
                        status: {},
                        identity: extendedEntity.identity,
                        profile: extendedEntity.profile,
                        currentState: extendedEntity.currentState,
                        continuity: extendedEntity.continuity,
                        povKnowledge: extendedEntity.povKnowledge,
                        episodeLedger: extendedEntity.episodeLedger,
                        evidence: extendedEntity.evidence,
                        quality: extendedEntity.quality
                    };
                    if (!opts.preserveExistingMetaSource) {
                        entityPatch.source = resolvedSource;
                        entityPatch.s_id = opts.sourceId;
                    }
                    EntityManager.updateEntity(ent.name, entityPatch, lore);
                }

                for (const rel of (sanitized.relations || [])) {
                    if (!rel.entityA || !rel.entityB) continue;
                    const extendedRelation = mergeColdStartStructuredValue(
                        rel.extension || {},
                        buildColdStartRelationV2Fields(rel, {
                            sourceId: opts.suppressSyntheticEvidence ? '' : resolvedSource,
                            sourceKind: opts.suppressSyntheticEvidence ? '' : 'cold_start_relation',
                            anchorTurn: baselineAnchorTurn,
                            suppressSyntheticEvidence: opts.suppressSyntheticEvidence
                        }),
                        'relation'
                    );
                    const relationPatch = {
                        relationType: rel.type || '',
                        sentiments: { fromAtoB: rel.sentiment || '' },
                        currentStatus: extendedRelation.currentStatus,
                        metrics: extendedRelation.metrics,
                        dynamics: extendedRelation.dynamics,
                        sharedContext: extendedRelation.sharedContext,
                        eventLedger: extendedRelation.eventLedger,
                        evidence: extendedRelation.evidence,
                        quality: extendedRelation.quality
                    };
                    if (!opts.preserveExistingMetaSource) {
                        relationPatch.source = resolvedSource;
                        relationPatch.s_id = opts.sourceId;
                    }
                    EntityManager.updateRelation(rel.entityA, rel.entityB, relationPatch, lore);
                }

                // 3. World Rules 반영 (Root Node)
                HierarchicalWorldManager.loadWorldGraph(lore, true);
                const profile = HierarchicalWorldManager.getProfile();
                const rootNode = profile?.nodes?.get(profile?.rootId);
                if (rootNode && sanitized.world) {
                    rootNode.rules = mergeImportedWorldRules(rootNode.rules, sanitized.world, sanitized.narrative || '');
                    const worldMetaPayload = buildWorldMetaPayload(sanitized.world, rootNode.meta || {});
                    rootNode.meta.classification = worldMetaPayload.classification;
                    rootNode.meta.worldSummary = worldMetaPayload.worldSummary;
                    rootNode.meta.worldMetadata = worldMetaPayload.worldMetadata;
                    rootNode.meta.notes = opts.worldNote;
                    if (!opts.preserveExistingMetaSource) rootNode.meta.s_id = opts.sourceId;
                    recordStructuredWorldState(sanitized, baselineAnchorTurn);
                }
                applyGlobalWorldFeaturesFromImportedKnowledge(profile, sanitized);
                await refreshSectionWorldFromImportedKnowledge(sanitized, opts);

                // 4. 모든 매니저의 상태를 하나의 로어북 배열로 통합
                // 각 saveState는 lore 배열을 직접 수정하며, 최종 저장은 아래에서 한 번만 수행합니다.
                
                await HierarchicalWorldManager.saveWorldGraphUnsafe(lore);
                await NarrativeTracker.saveState(lore);
                await StoryAuthor.saveState?.(lore);
                await Director.saveState?.(lore);
                await CharacterStateTracker.saveState(lore);
                await WorldStateTracker.saveState(lore);
                await SecretKnowledgeCore.saveState(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                });
                await EntityKnowledgeVaultCore.saveState(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                });
                await TimeEngine.saveState(lore, {
                    scopeKey: getChatRuntimeScopeKey(chat, char),
                    chatId: String(chat?.id || getActiveManagedChatId() || '').trim()
                });
                
                // EntityManager의 캐시를 로어북 엔트리로 변환하여 병합
                for (const [name, entity] of EntityManager.getEntityCache()) {
                    if (!opts.preserveExistingMetaSource) entity.meta.s_id = entity.meta.s_id || opts.sourceId || 'baseline';
                    const entry = {
                        key: LibraLoreKeys.entityFromName(name),
                        comment: "lmai_entity",
                        content: JSON.stringify(entity, null, 2),
                        mode: 'normal',
                        insertorder: 50,
                        alwaysActive: false
                    };
                    const existingIdx = lore.findIndex(e => {
                        if (e.comment !== "lmai_entity") return false;
                        try {
                            const parsed = JSON.parse(e.content || '{}');
                            return EntityManager.normalizeName(parsed.name || '') === name;
                        } catch {
                            return false;
                        }
                    });
                    if (existingIdx >= 0) lore[existingIdx] = entry;
                    else lore.push(entry);
                }

                for (const [id, relation] of EntityManager.getRelationCache()) {
                    if (!opts.preserveExistingMetaSource) relation.meta.s_id = relation.meta.s_id || opts.sourceId || 'baseline';
                    const entry = {
                        key: LibraLoreKeys.relationFromNames(relation.entityA, relation.entityB),
                        comment: "lmai_relation",
                        content: JSON.stringify(relation, null, 2),
                        mode: 'normal',
                        insertorder: 60,
                        alwaysActive: false
                    };
                    const existingIdx = lore.findIndex(e => {
                        if (e.comment !== "lmai_relation") return false;
                        try {
                            const parsed = JSON.parse(e.content || '{}');
                            const parsedId = parsed.id || `${EntityManager.normalizeName(parsed.entityA || '')}_${EntityManager.normalizeName(parsed.entityB || '')}`;
                            return parsedId === id;
                        } catch {
                            return false;
                        }
                    });
                    if (existingIdx >= 0) lore[existingIdx] = entry;
                    else lore.push(entry);
                }

                const coldStartHydration = await hydrateColdStartBaselineMemory(sanitized, {
                    char,
                    chat,
                    lore,
                    sourceMessages: opts.sourceMessages,
                    sourceId: opts.sourceId,
                    hydrateBaselineMemory: opts.hydrateBaselineMemory,
                    baselineAnchorTurn
                });
                if (MemoryEngine.CONFIG.debug && coldStartHydration && coldStartHydration.skipped !== true) {
                    recordRuntimeDebug('log', '[LIBRA] Cold-start baseline hydration:', coldStartHydration);
                }
                ActivityDashboardCore.update(activityContext, {
                    phase: 'structured-merge',
                    status: 'running',
                    progress: 92,
                    step: '데이터 반영',
                    stepStatus: 'done',
                    message: `콜드 스타트 메모리 ${coldStartHydration?.addedMemoryCount || 0}개를 반영했습니다.`
                });

                // 최종 저장
                if (chat) {
                    chat.localLore = lore;
                } else {
                    char.lorebook = lore;
                }
                const persistResult = await persistLoreToActiveChat(chat, lore);
                if (!persistResult?.ok) {
                    throw new Error(`구조 데이터 저장 실패: ${persistResult?.reason || 'unknown'}`);
                }
                enterRefreshStabilizeWindow();
                ActivityDashboardCore.finish(activityContext, 'ok', '구조 데이터 저장 완료');

            } catch (e) {
                recordRuntimeDebug('error', "[LIBRA] Cold Start Apply Error:", e);
                ActivityDashboardCore.finish({
                    scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                    activityDashboard: MemoryEngine.CONFIG.activityDashboard
                }, 'failed', `구조 데이터 반영 실패: ${e?.message || e}`);
                throw e;
            } finally {
                loreLock.writeUnlock();
            }
        };

        const applyFinalData = async (finalData, options = {}) => mergeStructuredKnowledge(finalData, {
            updateNarrative: true,
            worldNote: "Updated via Cold Start",
            sourceId: 'baseline',
            ...options
        });

        const buildCurrentStructuredSnapshot = (lore) => {
            if (Array.isArray(lore)) EntityManager.rebuildCache(lore);
            const narrativeState = NarrativeTracker.getState?.() || { storylines: [] };
            const storylines = Array.isArray(narrativeState.storylines) ? narrativeState.storylines : [];
            const narrative = storylines
                .map(storyline => {
                    const parts = [];
                    if (storyline.name) parts.push(storyline.name);
                    if (storyline.currentContext) parts.push(storyline.currentContext);
                    if (Array.isArray(storyline.keyPoints) && storyline.keyPoints.length > 0) parts.push(`Key: ${storyline.keyPoints.join('; ')}`);
                    if (Array.isArray(storyline.ongoingTensions) && storyline.ongoingTensions.length > 0) parts.push(`Flow: ${storyline.ongoingTensions.join('; ')}`);
                    return parts.join(' | ');
                })
                .filter(Boolean)
                .join('\n');
            const entities = Array.from(EntityManager.getEntityCache().values()).map(entity => ({
                name: entity.name || '',
                appearance: [...(entity.appearance?.features || []), ...(entity.appearance?.distinctiveMarks || []), ...(entity.appearance?.clothing || [])].filter(Boolean).join(', '),
                personality: [...(entity.personality?.traits || []), ...(entity.personality?.likes || []), ...(entity.personality?.dislikes || [])].filter(Boolean).join(', '),
                background: [entity.background?.origin || '', ...(entity.background?.history || [])].filter(Boolean).join(', '),
                occupation: entity.background?.occupation || '',
                currentLocation: '',
                sexualOrientation: entity.personality?.sexualOrientation || '',
                sexualPreferences: Array.isArray(entity.personality?.sexualPreferences) ? entity.personality.sexualPreferences : [],
                identity: safeClone(entity.identity || {}),
                profile: safeClone(entity.profile || {}),
                currentState: safeClone(entity.currentState || {}),
                continuity: safeClone(entity.continuity || {}),
                povKnowledge: safeClone(entity.povKnowledge || {}),
                episodeLedger: safeClone(entity.episodeLedger || []),
                evidence: safeClone(entity.evidence || []),
                quality: safeClone(entity.quality || {})
            }));
            const relations = Array.from(EntityManager.getRelationCache().values()).map(relation => ({
                entityA: relation.entityA || '',
                entityB: relation.entityB || '',
                type: relation.relationType || '',
                sentiment: [relation.sentiments?.fromAtoB || '', relation.sentiments?.fromBtoA || ''].filter(Boolean).join(' / '),
                currentStatus: safeClone(relation.currentStatus || {}),
                metrics: safeClone(relation.metrics || {}),
                dynamics: safeClone(relation.dynamics || {}),
                sharedContext: safeClone(relation.sharedContext || {}),
                eventLedger: safeClone(relation.eventLedger || []),
                evidence: safeClone(relation.evidence || []),
                quality: safeClone(relation.quality || {})
            }));
            const profile = HierarchicalWorldManager.getProfile();
            const rootNode = profile?.nodes?.get(profile?.rootId);
            const rootRules = rootNode?.rules || {};
            const rootMeta = rootNode?.meta || {};
            return sanitizeStructuredKnowledge({
                narrative,
                narrativeDetails: {
                    storylines: storylines.map(storyline => ({
                        name: storyline?.name || '',
                        context: storyline?.currentContext || '',
                        keyPoints: Array.isArray(storyline?.keyPoints) ? storyline.keyPoints : [],
                        ongoingTensions: Array.isArray(storyline?.ongoingTensions) ? storyline.ongoingTensions : [],
                        entities: Array.isArray(storyline?.entities) ? storyline.entities : []
                    }))
                },
                entities,
                relations,
                world: {
                    tech: rootRules?.exists?.technology || '',
                    summary: String(rootMeta?.worldSummary || '').trim(),
                    description: String(rootMeta?.worldMetadata?.description || '').trim(),
                    classification: { primary: inferWorldClassificationLabel(rootRules, '') },
                    exists: safeClone(rootRules?.exists || {}),
                    systems: safeClone(rootRules?.systems || {}),
                    physics: safeClone(rootRules?.physics || {}),
                    custom: safeClone(rootRules?.custom || {}),
                    rules: [
                        ...(Array.isArray(rootRules?.physics?.special_phenomena) ? rootRules.physics.special_phenomena : []),
                        ...Object.values(normalizeWorldCustomRules(rootRules?.custom || {}))
                    ]
                }
            });
        };
        const hasMeaningfulStructuredSnapshot = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') return false;
            if (String(snapshot?.narrative || '').trim()) return true;
            if (Array.isArray(snapshot?.entities) && snapshot.entities.length > 0) return true;
            if (Array.isArray(snapshot?.relations) && snapshot.relations.length > 0) return true;
            if (String(snapshot?.world?.summary || '').trim()) return true;
            if (String(snapshot?.world?.description || '').trim()) return true;
            if (Array.isArray(snapshot?.world?.rules) && snapshot.world.rules.length > 0) return true;
            if (Array.isArray(snapshot?.narrativeDetails?.storylines) && snapshot.narrativeDetails.storylines.length > 0) return true;
            return false;
        };
        const summarizeStructuredSnapshotForDebug = (snapshot) => ({
            narrative: DebugExportManager.textDigest(snapshot?.narrative || ''),
            storylines: Array.isArray(snapshot?.narrativeDetails?.storylines) ? snapshot.narrativeDetails.storylines.length : 0,
            entities: Array.isArray(snapshot?.entities) ? snapshot.entities.length : 0,
            relations: Array.isArray(snapshot?.relations) ? snapshot.relations.length : 0,
            worldRules: Array.isArray(snapshot?.world?.rules) ? snapshot.world.rules.length : 0,
            meaningful: hasMeaningfulStructuredSnapshot(snapshot)
        });
        const verifyMergedStructuredKnowledge = async (currentData, incomingData, taskLabel = 'merge-verify') => {
            const currentSnapshot = sanitizeStructuredKnowledge(currentData || {});
            const incomingSnapshot = sanitizeStructuredKnowledge(incomingData || {});
            if (!hasMeaningfulStructuredSnapshot(incomingSnapshot)) {
                return hasMeaningfulStructuredSnapshot(currentSnapshot) ? currentSnapshot : null;
            }
            if (!hasMeaningfulStructuredSnapshot(currentSnapshot)) {
                return incomingSnapshot;
            }
            const fallbackMerged = sanitizeStructuredKnowledge(
                mergeStructuredKnowledgeSnapshots(currentSnapshot, incomingSnapshot) || incomingSnapshot
            );
            if (!(LLMProvider.isConfigured(MemoryEngine.CONFIG, 'primary') || LLMProvider.isConfigured(MemoryEngine.CONFIG, 'aux'))) {
                return fallbackMerged;
            }
            const isFastTask = /^cold-(?:start|reanalysis)|merge-verify|import-verify/.test(String(taskLabel || ''));
            const fastLlm = isFastTask ? buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 3000 }) : null;
            try {
                const reviewInput = [
                    `[기존 구조 데이터 / Existing Structured Data]`,
                    buildCompactStructuredJson(currentSnapshot, REVIEW_DATA_MAX_CHARS),
                    ``,
                    `[새 후보 데이터 / Incoming Candidate Data]`,
                    buildCompactStructuredJson(incomingSnapshot, REVIEW_DATA_MAX_CHARS)
                ].join('\n');
                const profile = isFastTask ? fastLlm.profile : resolveAnalysisProfile(MemoryEngine.CONFIG);
                const verified = await runMaintenanceLLM(() =>
                    LLMProvider.call(isFastTask ? fastLlm.config : MemoryEngine.CONFIG, MergeVerificationPrompt, reviewInput, { maxTokens: isFastTask ? 2400 : 3000, profile, label: `${taskLabel}-${profile}` })
                , `${taskLabel}-${profile}`);
                const parsed = extractStructuredJson(verified?.content || '');
                const normalized = parsed ? coerceFinalSynthesisCandidate(parsed) : null;
                return hasMeaningfulStructuredSnapshot(normalized) ? normalized : fallbackMerged;
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Structured merge verification fallback:', e?.message || e);
                return fallbackMerged;
            }
        };

        const synthesizeStructuredKnowledge = async (rawTexts, taskLabel = 'knowledge-import') => {
            const texts = (Array.isArray(rawTexts) ? rawTexts : [])
                .map(v => String(v || '').trim())
                .filter(Boolean);
            if (texts.length === 0) return null;

            const textChunks = [];
            const chunkSize = 8;
            for (let i = 0; i < texts.length; i += chunkSize) {
                textChunks.push(texts.slice(i, i + chunkSize));
            }

            const chunkPromises = textChunks.map((chunk, i) => {
                const chunkText = chunk.map((text, idx) => `Knowledge ${idx + 1}: ${truncateForLLM(text, IMPORT_KNOWLEDGE_MAX_ITEM_CHARS, ' ...[TRUNCATED]... ')}`).join('\n\n');
                return runMaintenanceLLM(() =>
                    LLMProvider.call(MemoryEngine.CONFIG, ColdStartSummaryPrompt, chunkText, { maxTokens: 1800, profile: resolveAnalysisProfile(MemoryEngine.CONFIG), label: `${taskLabel}-chunk-${i + 1}` })
                , `${taskLabel}-chunk-${i + 1}`);
            });
            const chunkResults = await Promise.allSettled(chunkPromises);

            const chunkSummaries = [];
            let settledChunkCount = 0;
            for (const result of chunkResults) {
                settledChunkCount += 1;
                if (result.status === 'fulfilled' && result.value.content) {
                    const parsed = extractStructuredJson(result.value.content);
                    if (parsed) chunkSummaries.push(parsed);
                }
            }
            if (chunkSummaries.length === 0) return null;

            let finalData = null;
            for (let attempt = 0; attempt < 2 && !finalData; attempt++) {
                try {
                    const synthesisInput = buildSynthesisInput(chunkSummaries);
                    const synthesisResult = await runMaintenanceLLM(() =>
                        LLMProvider.call(
                            MemoryEngine.CONFIG,
                            FinalSynthesisPrompt,
                            synthesisInput,
                            { maxTokens: 3000, profile: resolveAnalysisProfile(MemoryEngine.CONFIG), label: `${taskLabel}-synthesis-${attempt + 1}` }
                    )
                    , `${taskLabel}-synthesis-${attempt + 1}`);
                    if (synthesisResult?.content) {
                        const parsed = extractStructuredJson(synthesisResult.content);
                        const normalized = parsed ? coerceFinalSynthesisCandidate(parsed) : null;
                        if (hasMeaningfulStructuredSnapshot(normalized)) finalData = normalized;
                    }
                } catch (e) {
                    if (attempt === 0) recordRuntimeDebug('warn', '[LIBRA] Knowledge synthesis retry:', e?.message || e);
                }
            }

            if (!finalData) {
                finalData = fallbackChunkSummariesToStructured(chunkSummaries, "Imported knowledge summary applied.");
            }
            return finalData;
        };

        const buildAnalyzableMessagesWithAudit = (chat, options = {}) => {
            const sourceInfo = options.sourceInfo || null;
            const msgs_all = Array.isArray(options.sourceMessages)
                ? options.sourceMessages
                : (sourceInfo?.messages || getChatMessages(chat));
            const historyLimit = resolveColdStartHistoryLimit(
                MemoryEngine.CONFIG.coldStartScopePreset,
                MemoryEngine.CONFIG.coldStartHistoryLimit
            );
            const sourceMsgs = historyLimit > 0 ? msgs_all.slice(-historyLimit) : msgs_all;
            const messages = [];
            const audit = [];
            sourceMsgs.forEach((m, index) => {
                const normalized = normalizeColdStartMessageForAnalysis(m, index);
                const isUser = normalized.roleHint === 'user';
                const ignoredGreeting = getMessageSignature(m) === MemoryState.ignoredGreetingSignature;
                const metaLike = Utils.isMetaPromptLike(normalized.narrativeText || normalized.rawText);
                const tagOnlyTool = Utils.isTagOnlyToolResponse(normalized.narrativeText || normalized.rawText);
                const excludedMemory = !normalized.auxHintCount && Utils.shouldExcludeMemoryContent(normalized.text || normalized.narrativeText);
                let dropReason = '';
                if (!m) dropReason = 'missing_message';
                else if (ignoredGreeting) dropReason = 'ignored_greeting';
                else if (!normalized.text) dropReason = 'empty_after_artifact_strip';
                else if (isUser && metaLike && !normalized.auxHintCount) dropReason = 'user_meta_prompt';
                else if (!isUser && (metaLike || tagOnlyTool) && !normalized.auxHintCount) dropReason = tagOnlyTool ? 'ai_tag_only_tool' : 'ai_meta_prompt';
                else if (excludedMemory) dropReason = 'excluded_memory_content';

                const kept = !dropReason;
                audit.push({
                    index,
                    role: isUser ? 'user' : 'ai',
                    kept,
                    dropReason,
                    raw: coldStartMessageDigest(normalized.rawText),
                    narrative: coldStartMessageDigest(normalized.narrativeText),
                    final: coldStartMessageDigest(normalized.text),
                    metaLike,
                    tagOnlyTool,
                    ignoredGreeting,
                    hayakuPackets: normalized.hayakuPackets.length,
                    imageCues: normalized.imageCues.length,
                    auxHintCount: normalized.auxHintCount
                });
                if (kept) {
                    messages.push({
                        msg: normalized.msg,
                        roleHint: normalized.roleHint,
                        text: normalized.text,
                        narrativeText: normalized.narrativeText,
                        auxiliaryHints: {
                            hayakuPackets: normalized.hayakuPackets,
                            imageCues: normalized.imageCues,
                            count: normalized.auxHintCount
                        }
                    });
                }
            });
            return {
                messages,
                audit,
                summary: summarizeColdStartFilterAudit(audit),
                source: {
                    label: sourceInfo?.label || 'getChatMessages',
                    rawMessages: Array.isArray(msgs_all) ? msgs_all.length : 0,
                    scopedMessages: sourceMsgs.length,
                    historyLimit,
                    candidates: sourceInfo?.candidates || []
                }
            };
        };
        const buildAnalyzableMessages = (chat, options = {}) => {
            if (Array.isArray(options.sourceMessages) || options.sourceInfo) {
                return buildAnalyzableMessagesWithAudit(chat, options).messages;
            }
            const sourceInfo = resolveColdStartMessageSource(chat);
            return buildAnalyzableMessagesWithAudit(chat, {
                ...options,
                sourceInfo,
                sourceMessages: sourceInfo.messages
            }).messages;
        };

        const analyzeConversationMessages = async (msgs, taskLabel = 'cold-start') => {
            if (!Array.isArray(msgs) || msgs.length === 0) return null;
            const isColdStartTask = String(taskLabel || '').startsWith('cold-start');
            const isReanalysisTask = String(taskLabel || '').startsWith('cold-reanalysis');
            const shouldUseFastPath = isColdStartTask || isReanalysisTask;
            const chunks = buildAnalysisMessageChunks(msgs, shouldUseFastPath ? 40 : 25);
            const fastLlm = shouldUseFastPath ? buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 2400 }) : null;
            const activityContext = {
                scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                activityDashboard: MemoryEngine.CONFIG.activityDashboard
            };

            LMAI_GUI.toast(`총 ${chunks.length}개 청크 병렬 분석 시작...`);
            ActivityDashboardCore.update(activityContext, {
                phase: taskLabel,
                status: 'running',
                progress: 24,
                step: '청크 분석',
                stepStatus: 'running',
                message: `대화 청크 ${chunks.length}개를 분석합니다.`
            });

            let completedChunkCount = 0;
            const chunkPromises = chunks.map((chunk, i) => {
                const chunkText = buildAnalysisChunkText(chunk, { evidenceMode: 'assistant_canonical' });
                return runMaintenanceLLM(() =>
                    (async () => {
                        if (!String(chunkText || '').trim()) {
                            return { skipped: true, reason: 'empty_assistant_canonical_chunk' };
                        }
                        if (shouldUseFastPath) {
                            return LLMProvider.call(
                                fastLlm.config,
                                ColdStartSummaryPrompt,
                                chunkText,
                                { maxTokens: 1600, profile: fastLlm.profile, label: `${taskLabel}-fast-chunk-${i + 1}` }
                            );
                        }
                        let auxDraft = null;
                        const draftProfile = resolveAnalysisProfile(MemoryEngine.CONFIG);
                        if (!LLMProvider.isConfigured(MemoryEngine.CONFIG, 'primary') && LLMProvider.isConfigured(MemoryEngine.CONFIG, 'aux')) {
                            const auxResult = await LLMProvider.call(
                                MemoryEngine.CONFIG,
                                ColdStartSummaryPrompt,
                                chunkText,
                                { maxTokens: 1300, profile: draftProfile, label: `${taskLabel}-${draftProfile}-chunk-${i + 1}` }
                            );
                            auxDraft = extractStructuredJson(auxResult?.content || '');
                        }

                        const primaryInput = auxDraft
                            ? [
                                `[원문 대화 청크 / Source Conversation Chunk]`,
                                chunkText,
                                ``,
                                `[보조 요약 초안 / Auxiliary Draft]`,
                                JSON.stringify(compactChunkSummary(auxDraft))
                            ].join('\n')
                            : chunkText;

                        return LLMProvider.call(
                            MemoryEngine.CONFIG,
                            auxDraft ? ColdStartChunkArbiterPrompt : ColdStartSummaryPrompt,
                            primaryInput,
                            { maxTokens: 1900, profile: 'primary', label: `${taskLabel}-primary-chunk-${i + 1}` }
                        );
                    })()
                , `${taskLabel}-chunk-${i + 1}`).finally(() => {
                    completedChunkCount += 1;
                    ActivityDashboardCore.update(activityContext, {
                        phase: taskLabel,
                        status: 'running',
                        progress: 24 + Math.round((completedChunkCount / Math.max(1, chunks.length)) * 44),
                        step: '청크 분석',
                        stepStatus: completedChunkCount >= chunks.length ? 'done' : 'running',
                        message: `청크 분석 ${completedChunkCount}/${chunks.length} 완료`
                    });
                });
            });
            const chunkResults = await Promise.allSettled(chunkPromises);

            const chunkSummaries = [];
            let skippedChunkCount = 0;
            let failedChunkCount = 0;
            const totalChunkCount = Math.max(1, chunkResults.length);
            let settledChunkCount = 0;
            for (const result of chunkResults) {
                settledChunkCount += 1;
                if (result.status === 'fulfilled' && result.value?.skipped) {
                    skippedChunkCount++;
                    continue;
                }
                if (result.status === 'fulfilled' && result.value?.content) {
                    const parsed = extractStructuredJson(result.value.content);
                    if (parsed) chunkSummaries.push(parsed);
                    else failedChunkCount++;
                    continue;
                }
                failedChunkCount++;
            }
            if (chunkSummaries.length === 0) {
                if (skippedChunkCount > 0 && failedChunkCount === 0) {
                    throw new Error("assistant 정본 응답이 없어 과거 대화 분석을 실행할 수 없습니다.");
                }
                chunkSummaries.push(buildFallbackChunkSummary(msgs, taskLabel));
                if (MemoryEngine.CONFIG?.debug) {
                    recordRuntimeDebug('warn', '[LIBRA] Conversation analysis used deterministic fallback summary', {
                        taskLabel,
                        chunks: chunks.length,
                        skippedChunkCount,
                        failedChunkCount,
                        settledChunkCount,
                        totalChunkCount
                    });
                }
                ActivityDashboardCore.update(activityContext, {
                    phase: taskLabel,
                    status: 'running',
                    progress: 70,
                    step: '청크 분석',
                    stepStatus: 'done',
                    message: '청크 JSON 파싱에 실패해 원문 기반 fallback summary로 합성을 계속합니다.'
                });
            }

            LMAI_GUI.toast(chunkSummaries.length > HIERARCHICAL_SYNTHESIS_MAX_BATCHES ? "초대형 대화 계층 합성 중..." : "최종 데이터 합성 중...");
            ActivityDashboardCore.update(activityContext, {
                phase: taskLabel,
                status: 'running',
                progress: 74,
                step: '계층 합성',
                stepStatus: 'running',
                message: chunkSummaries.length > HIERARCHICAL_SYNTHESIS_MAX_BATCHES ? '초대형 대화 계층 합성 중입니다.' : '최종 구조 데이터를 합성합니다.'
            });
            return await synthesizeChunkSummariesHierarchically(chunkSummaries, taskLabel);
        };

        const reanalyzeHistoricalConversation = async () => {
            if (isProcessing) throw new Error("이미 콜드 스타트/재분석이 진행 중입니다.");
            isProcessing = true;
            notifyLibraTask('과거 대화 재분석을 시작했습니다.', { key: 'libra-cold-reanalysis-start', duration: 1600 });
            try {
                const char = await RisuCompat.getCharacter();
                if (!char) throw new Error("캐릭터 데이터를 불러올 수 없습니다.");
                const chat = await getActiveChatForCharacter(char);
                if (!chat) throw new Error("채팅방을 찾을 수 없습니다.");
                const activityContext = { scopeKey: getChatRuntimeScopeKey(chat, char), activityDashboard: MemoryEngine.CONFIG.activityDashboard };
                ActivityDashboardCore.beginRequest({
                    flow: 'cold-reanalysis',
                    title: '과거 대화 재분석',
                    stageLabel: '과거 대화 재분석을 준비합니다.',
                    status: 'running',
                    progress: 8,
                    forceVisible: true
                }, activityContext);
                const lore = MemoryEngine.getLorebook(char, chat);
                const reanalysisSource = resolveColdStartMessageSource(chat);
                const msgs = buildAnalyzableMessages(chat, {
                    sourceMessages: reanalysisSource.messages,
                    sourceInfo: reanalysisSource
                });
                if (msgs.length === 0) throw new Error("재분석할 대화 내역이 없습니다.");

                const candidateData = await analyzeConversationMessages(msgs, 'cold-reanalysis');
                if (!hasMeaningfulStructuredSnapshot(candidateData)) {
                    throw new Error("재분석 결과가 비어 있습니다.");
                }
                const currentData = buildCurrentStructuredSnapshot(lore);
                const verifiedMergedData = await verifyMergedStructuredKnowledge(currentData, candidateData, 'cold-reanalysis-verify');
                await mergeStructuredKnowledge(verifiedMergedData, {
                    updateNarrative: true,
                    sourceId: 'reanalysis',
                    worldNote: 'Merged via Reanalysis Verification',
                    sourceMessages: msgs,
                    targetChar: char,
                    targetChat: chat
                });
                ActivityDashboardCore.finish(activityContext, 'ok', '과거 대화 재분석 완료');
                notifyLibraTask('과거 대화 재분석을 완료했습니다.', { key: 'libra-cold-reanalysis-complete', duration: 1600 });
                return verifiedMergedData;
            } catch (e) {
                recordRuntimeDebug('error', "[LIBRA] Reanalysis Error:", e);
                ActivityDashboardCore.finish({
                    scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                    activityDashboard: MemoryEngine.CONFIG.activityDashboard
                }, 'failed', `재분석 실패: ${e.message || e}`);
                throw e;
            } finally {
                isProcessing = false;
            }
        };

        const reanalyzeRollbackDeleteCandidates = async (details = {}) => {
            if (isProcessing) throw new Error("이미 콜드 스타트/재분석이 진행 중입니다.");
            isProcessing = true;
            notifyLibraTask('롤백 삭제 후보 보강 분석을 시작했습니다.', { key: 'libra-rollback-augment-start', duration: 1400 });
            try {
                const char = await RisuCompat.getCharacter();
                if (!char) throw new Error("캐릭터 데이터를 불러올 수 없습니다.");
                const chat = await getActiveChatForCharacter(char);
                if (!chat) throw new Error("채팅방을 찾을 수 없습니다.");
                const lore = MemoryEngine.getLorebook(char, chat) || [];
                const candidateTurns = (Array.isArray(details?.candidateTurns) ? details.candidateTurns : [])
                    .map(normalizeLegacyMemoryTurnAnchor)
                    .filter(Boolean)
                    .sort((a, b) => a - b);
                const currentData = buildCurrentStructuredSnapshot(lore);
                const compactHints = (typeof AnalysisMemoryHintBridge !== 'undefined' && AnalysisMemoryHintBridge?.build)
                    ? AnalysisMemoryHintBridge.build(lore, `rollback delete candidates ${candidateTurns.join(' ')}`, { limit: 10, minImportance: 1 })
                    : [];
                const compactHintBlock = (typeof AnalysisMemoryHintBridge !== 'undefined' && AnalysisMemoryHintBridge?.format)
                    ? AnalysisMemoryHintBridge.format(compactHints, { title: 'Surviving Compact Memory Hints', maxItems: 10 })
                    : '';
                const rollbackSource = resolveColdStartMessageSource(chat);
                const analyzable = buildAnalyzableMessages(chat, {
                    sourceMessages: rollbackSource.messages,
                    sourceInfo: rollbackSource
                });
                const recentMessages = analyzable.slice(-18);
                const transcript = buildAnalysisChunkText(recentMessages, { evidenceMode: 'assistant_canonical' });
                const dirtyEntries = LibraLoreConsolidator.unpack(lore)
                    .filter(entry => /^lmai_/.test(String(entry?.comment || '')))
                    .map(entry => {
                        try {
                            const parsed = JSON.parse(String(entry.content || '{}'));
                            const meta = parsed?.meta || parsed?.metadata || {};
                            if (!meta?.rollbackDirty && !meta?.needsReanalysis && !Array.isArray(parsed?.rollbackDeletedTurns)) return null;
                            return {
                                comment: String(entry.comment || ''),
                                key: String(entry.key || '').slice(0, 120),
                                name: String(parsed?.name || parsed?.entityA && parsed?.entityB ? `${parsed.entityA}-${parsed.entityB}` : parsed?.classification?.primary || '').slice(0, 160),
                                dirty: true,
                                candidates: (meta?.rollbackDeleteCandidates || parsed?.rollbackDeletedTurns || []).slice(-4)
                            };
                        } catch (_) { return null; }
                    })
                    .filter(Boolean)
                    .slice(0, 20);
                const context = [
                    '[Rollback Delete-Candidate Augment / 롤백 삭제 후보 보강 분석]',
                    'The existing LIBRA structured data is the baseline and must be preserved. Do not rebuild from scratch. Produce only missing/repair information supported by surviving chat, compact memory hints, and dirty candidate markers.',
                    'High-confidence stable existing facts must not be deleted or replaced. Deleted candidate turns are untrusted and should only be used as tombstone context.',
                    '',
                    `[Candidate Turns] ${candidateTurns.length ? candidateTurns.join(', ') : '(unknown)'}`,
                    '',
                    '[Dirty Structured Entries]',
                    JSON.stringify(dirtyEntries, null, 2),
                    '',
                    compactHintBlock,
                    '',
                    '[Surviving Recent Live Conversation]',
                    truncateForLLM(transcript, 9000, '\n...[TRUNCATED]...\n')
                ].filter(Boolean).join('\n');
                const candidateData = await synthesizeStructuredKnowledge([context], 'rollback-delete-augment');
                if (!hasMeaningfulStructuredSnapshot(candidateData)) {
                    throw new Error('롤백 보강 분석 결과가 비어 있습니다.');
                }
                const verifiedMergedData = await verifyMergedStructuredKnowledge(currentData, candidateData, 'rollback-delete-augment-existing-data-verify');
                const rollbackSanitizedData = sanitizeRollbackAugmentStructuredData(verifiedMergedData, { candidateTurns });
                await mergeStructuredKnowledge(rollbackSanitizedData, {
                    updateNarrative: true,
                    sourceId: 'rollback-repair',
                    suppressSyntheticEvidence: true,
                    suppressSyntheticNarrativeAnchors: true,
                    preserveExistingMetaSource: true,
                    worldNote: 'Augmented via rollback delete-candidate cleanup',
                    targetChar: char,
                    targetChat: chat
                });
                notifyLibraTask('롤백 삭제 후보 보강 병합을 완료했습니다.', { key: 'libra-rollback-augment-complete', duration: 1600 });
                return rollbackSanitizedData;
            } catch (e) {
                recordRuntimeDebug('error', '[LIBRA] Rollback delete-candidate augment error:', e);
                LMAI_GUI.toast(`❌ 롤백 보강 실패: ${e.message || e}`);
                throw e;
            } finally {
                isProcessing = false;
            }
        };

        const integrateImportedKnowledge = async (rawTexts, sourceLabel = 'Hypa V3', options = {}) => {
            if (!MemoryEngine.CONFIG.useLLM) {
                throw new Error("LLM 사용이 꺼져 있어 구조화 분석을 진행할 수 없습니다.");
            }
            const opts = {
                sourceId: 'hypa_v3',
                updateNarrative: true,
                worldNote: `Updated via ${sourceLabel} Import`,
                ...options
            };
            const synthesizedData = await synthesizeStructuredKnowledge(rawTexts, `import-${String(sourceLabel || 'knowledge').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`);
            if (!hasMeaningfulStructuredSnapshot(synthesizedData)) {
                throw new Error("가져온 지식 데이터를 구조화하지 못했습니다.");
            }
            let char = null;
            let chat = null;
            if (opts.targetChat?.id) {
                const targetCtx = await resolveActiveChatContext(opts.targetChat);
                if (!targetCtx?.char || !targetCtx?.chat || String(targetCtx.chat?.id || '') !== String(opts.targetChat.id || '')) {
                    throw new Error('가져온 지식 반영 대상 채팅방을 찾을 수 없습니다.');
                }
                char = targetCtx.char;
                chat = targetCtx.chat;
            } else {
                char = opts.targetChar || await requireLoadedCharacter();
                chat = await getActiveChatForCharacter(char);
            }
            const lore = MemoryEngine.getLorebook(char, chat);
            const currentData = buildCurrentStructuredSnapshot(lore);
            const finalData = await verifyMergedStructuredKnowledge(
                currentData,
                synthesizedData,
                `import-verify-${String(sourceLabel || 'knowledge').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`
            );
            if (!hasMeaningfulStructuredSnapshot(finalData)) {
                throw new Error("가져온 지식 데이터를 구조화하지 못했습니다.");
            }
            await mergeStructuredKnowledge(finalData, {
                updateNarrative: opts.updateNarrative,
                worldNote: opts.worldNote,
                sourceId: opts.sourceId,
                targetChar: char,
                targetChat: chat
            });
            return finalData;
        };

        const startAutoSummarization = async () => {
            if (isProcessing) throw new Error("이미 콜드 스타트/재분석이 진행 중입니다.");
            isProcessing = true;
            let coldStartDebugKey = '';
            notifyLibraTask('콜드 스타트 작업을 시작했습니다.', { key: 'libra-cold-start-start', duration: 1800 });
            try {
                coldStartDebugKey = DebugExportManager.startRequest('cold-start', {
                    scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || 'global',
                    requestType: 'manual-cold-start',
                    request: {
                        historyPreset: MemoryEngine.CONFIG.coldStartScopePreset,
                        historyLimit: MemoryEngine.CONFIG.coldStartHistoryLimit
                    }
                });
                DebugExportManager.recordPhase(coldStartDebugKey, 'start', {
                    historyPreset: MemoryEngine.CONFIG.coldStartScopePreset,
                    historyLimit: MemoryEngine.CONFIG.coldStartHistoryLimit
                }, 'running');
                const char = await RisuCompat.getCharacter();
                if (!char) throw new Error("캐릭터 데이터를 불러올 수 없습니다.");

                const chat = await getActiveChatForCharacter(char);
                const messageSource = resolveColdStartMessageSource(chat);
                const msgs_all = messageSource.messages;

                if (!chat || msgs_all.length === 0) {
                    throw new Error("분석할 대화 내역이 없습니다.");
                }
                const activityContext = { scopeKey: getChatRuntimeScopeKey(chat, char), activityDashboard: MemoryEngine.CONFIG.activityDashboard };
                DebugExportManager.updateRequestContext(coldStartDebugKey, {
                    scopeKey: activityContext.scopeKey,
                    chatId: String(chat?.id || '').trim(),
                    request: {
                        rawMessages: msgs_all.length,
                        messageSource: messageSource.label,
                        chatName: String(chat?.name || '').trim()
                    }
                });
                DebugExportManager.recordPhase(coldStartDebugKey, 'collect_messages', {
                    rawMessages: msgs_all.length,
                    chatId: String(chat?.id || '').trim(),
                    source: messageSource.label,
                    sourceCandidates: messageSource.candidates
                }, 'done');
                ActivityDashboardCore.beginRequest({
                    flow: 'cold-start',
                    title: '초기 구조 분석',
                    stageLabel: '과거 대화를 수집합니다.',
                    status: 'running',
                    progress: 8,
                    forceVisible: true
                }, activityContext);
                const analysisBuild = buildAnalyzableMessagesWithAudit(chat, {
                    sourceMessages: msgs_all,
                    sourceInfo: messageSource
                });
                const msgs = analysisBuild.messages;
                
                if (msgs.length === 0) throw new Error("분석할 대화 내역이 없습니다.");
                DebugExportManager.recordPhase(coldStartDebugKey, 'analyzable_messages', {
                    messages: msgs.length,
                    roleCounts: DebugExportManager.countRoles(msgs.map(item => item?.msg).filter(Boolean)),
                    filteredMessages: Math.max(0, msgs_all.length - msgs.length),
                    source: analysisBuild.source,
                    filterSummary: analysisBuild.summary,
                    filterAudit: analysisBuild.audit.slice(-COLD_START_MESSAGE_AUDIT_LIMIT)
                }, 'done');
                ActivityDashboardCore.update(activityContext, {
                    phase: 'cold-start',
                    status: 'running',
                    progress: 16,
                    step: '대화 수집',
                    stepStatus: 'done',
                    message: `분석 대상 메시지 ${msgs.length}개를 수집했습니다.`
                });
                const analyzedData = await analyzeConversationMessages(msgs, 'cold-start');
                if (!hasMeaningfulStructuredSnapshot(analyzedData)) {
                    throw new Error("초기 구조 분석 결과가 비어 있습니다.");
                }
                DebugExportManager.recordPhase(coldStartDebugKey, 'final_synthesis', {
                    result: summarizeStructuredSnapshotForDebug(analyzedData)
                }, 'done');

                if (MemoryEngine.CONFIG.debug) recordRuntimeDebug('log', "[LIBRA] Cold Start Synthesis Data:", analyzedData);
                
                // 데이터 반영 실행. Existing LIBRA data must be augmented, not replaced.
                const currentLore = MemoryEngine.getLorebook(char, chat) || [];
                const currentData = buildCurrentStructuredSnapshot(currentLore);
                const hasExistingData = hasMeaningfulStructuredSnapshot(currentData);
                DebugExportManager.recordPhase(coldStartDebugKey, 'existing_data', {
                    hasExistingData,
                    current: summarizeStructuredSnapshotForDebug(currentData)
                }, hasExistingData ? 'augment' : 'baseline');
                if (hasExistingData) {
                    const verifiedMergedData = await verifyMergedStructuredKnowledge(currentData, analyzedData, 'cold-start-existing-data-augment-verify');
                    DebugExportManager.recordPhase(coldStartDebugKey, 'merge_verify', {
                        result: summarizeStructuredSnapshotForDebug(verifiedMergedData)
                    }, 'done');
                    await mergeStructuredKnowledge(verifiedMergedData, {
                        updateNarrative: true,
                        worldNote: 'Augmented via Cold Start',
                        sourceId: 'cold-start-augment',
                        sourceMessages: msgs,
                        targetChar: char,
                        targetChat: chat
                    });
                    notifyLibraTask('콜드 스타트 보강 병합을 완료했습니다.', { key: 'libra-cold-start-augment-complete', duration: 1800 });
                    ActivityDashboardCore.finish(activityContext, 'ok', '콜드 스타트 보강 병합 완료');
                    DebugExportManager.finishRequest(coldStartDebugKey, 'committed', {
                        mode: 'augment',
                        result: summarizeStructuredSnapshotForDebug(verifiedMergedData)
                    });
                    return verifiedMergedData;
                }
                await applyFinalData(analyzedData, { sourceMessages: msgs });
                notifyLibraTask('콜드 스타트 작업을 완료했습니다.', { key: 'libra-cold-start-complete', duration: 1800 });
                ActivityDashboardCore.finish(activityContext, 'ok', '콜드 스타트 완료');
                DebugExportManager.finishRequest(coldStartDebugKey, 'committed', {
                    mode: 'baseline',
                    result: summarizeStructuredSnapshotForDebug(analyzedData)
                });
                return analyzedData;

            } catch (e) {
                recordRuntimeDebug('error', "[LIBRA] Cold Start Error:", e);
                DebugExportManager.finishRequest(coldStartDebugKey, 'failed', {
                    error: e?.message || String(e || 'unknown')
                });
                ActivityDashboardCore.finish({
                    scopeKey: MemoryState._activeScopeKey || MemoryState._activeChatId || '',
                    activityDashboard: MemoryEngine.CONFIG.activityDashboard
                }, 'failed', `콜드 스타트 실패: ${e.message || e}`);
                throw e;
            } finally {
                isProcessing = false;
            }
        };

        return {
            check,
            startAutoSummarization,
            reanalyzeHistoricalConversation,
            reanalyzeRollbackDeleteCandidates,
            integrateImportedKnowledge,
            buildAnalyzableMessages,
            prompts: Object.freeze({})
        };
    })();

    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Transition Manager
    // ══════════════════════════════════════════════════════════════
    const TransitionManager = (() => {
        const SCENE_CONTEXT_KEY = 'LIBRA_SCENE_CONTEXT';

        const TransitionSummaryPrompt = `당신은 대화 세션 전환을 돕는 맥락 브릿지 전문가입니다.
제공된 마지막 대화 내역을 바탕으로, 새 채팅방에서 대화를 자연스럽게 이어갈 수 있도록 현재 상황을 요약하십시오.

[정본 규칙 / Canonical Evidence]
- assistant/AI 응답에서 실제로 묘사된 내용만 직전 상황으로 요약하십시오.
- 사용자 입력/요청/명령은 발생한 사건으로 취급하지 마십시오.
- 마지막 사용자 입력이 아직 assistant 응답으로 처리되지 않았다면 요약에 포함하지 마십시오.

[필수 포함 내용]
1. 현재 장소 및 시간적 배경
2. 주요 등장인물들이 직전에 수행하던 구체적인 행동
3. 현재 대화의 핵심 분위기와 진행 중인 사건의 긴박함 정도

요약은 1~2문단으로 간결하고 명확하게 작성하십시오.`;

        const _generateUUID = () => {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = (Math.random() * 16) | 0;
                return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
            });
        };

        const _libraComments = [
            "lmai_entity",
            "lmai_relation", "lmai_narrative", "lmai_char_states",
            "lmai_world_states", "lmai_memory", "lmai_rp_longterm"
        ];
        const _libraInheritedComments = [
            ..._libraComments,
            'lmai_user',
            'lmai_hypa_v3_source',
            'hypa_v3_import'
        ];

        const _buildInheritedLore = (sourceLore, sceneSummary) => {
            const inherited = sourceLore.filter(e => _libraInheritedComments.includes(e.comment) && e.key !== SCENE_CONTEXT_KEY);

            const memoryEntries = inherited.filter(e => e.comment === 'lmai_memory');
            const structuralEntries = inherited.filter(e => e.comment !== 'lmai_memory');
            const baselineEntries = structuralEntries.map(e => {
                try {
                    const content = JSON.parse(e.content);
                    if (content.meta) content.meta.s_id = 'baseline';
                    return { ...e, content: JSON.stringify(content) };
                } catch { return e; }
            });

            let newLore = [...baselineEntries, ...memoryEntries];

            if (sceneSummary) {
                const anchorTurn = Math.max(1, deriveMaxTurnFromLorebook(newLore) + 1);
                const sourceHash = TokenizerEngine.simpleHash(sceneSummary);
                const userTurnKey = `baseline:${sourceHash}`;
                const meta = {
                    imp: 10,
                    t: anchorTurn,
                    ttl: -1,
                    cat: 'system',
                    ent: [],
                    summary: 'Previous Scene Context',
                    source: 'transition_scene_context',
                    sourceHint: 'Inherited previous-scene context for the new chat scope.',
                    s_id: 'baseline',
                    sourceMessageIds: [],
                    liveMessageIds: [],
                    sourceHash,
                    aiHash: sourceHash,
                    userTurnKey,
                    turnKey: buildCanonicalTurnKey('', userTurnKey, sourceHash, '', []),
                    messageSignature: '',
                    messageCount: 0,
                    firstTurn: anchorTurn,
                    originalTurn: anchorTurn,
                    lockedTurn: anchorTurn,
                    finalizedTurn: anchorTurn,
                    turnAnchorTurn: anchorTurn,
                    turnAnchor: anchorTurn,
                    turnLocked: true,
                    turnAnchorReason: 'transition-scene-context',
                    recallHints: StrengthenedJaccardCore.buildRecallHints(sceneSummary, { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 })
                };
                const sceneEntry = {
                    key: SCENE_CONTEXT_KEY,
                    comment: "lmai_memory",
                    content: `[META:${JSON.stringify(meta)}]\n【직전 상황 요약 / Previous Scene Context】\n${sceneSummary}`,
                    mode: 'normal',
                    insertorder: 10,
                    alwaysActive: false
                };
                newLore.unshift(sceneEntry);
            }

            return newLore;
        };

        const executeTransition = async () => {
            try {
                const sourceChar = await requireLoadedCharacter();
                const sourceChat = await getActiveChatForCharacter(sourceChar);
                const effectiveLore = MemoryEngine.getEffectiveLorebook(sourceChar, sourceChat);
                const lore = Array.isArray(effectiveLore) && effectiveLore.length > 0
                    ? [...effectiveLore]
                    : [...MemoryEngine.getLorebook(sourceChar, sourceChat)];
                const sourceChatId = sourceChat?.id || null;

                LMAI_GUI.toast("데이터 패키징 중...");

                // 1. 직전 상황 요약 생성 (Graceful Degradation 적용)
                let sceneSummary = "";
                try {
                    const msgs_all = getChatMessages(sourceChat);
                    const lastMsgs = msgs_all.slice(-10)
                        .filter(m => getMessageSignature(m) !== MemoryState.ignoredGreetingSignature)
                        .map(m => ({ msg: m, text: getComparableMessageText(m) }))
                        .filter(item => item.text);
                    if (lastMsgs.length > 0) {
                        LMAI_GUI.toast("직전 상황 요약 중...");
                        const contextText = buildAssistantCanonicalTranscript(lastMsgs, {
                            maxChars: 6000,
                            perItemChars: 1600,
                            includeTurn: false
                        });
                        if (contextText) {
                            const result = await LLMProvider.call(MemoryEngine.CONFIG, TransitionSummaryPrompt, contextText, { maxTokens: 800, label: 'transition-summary' });
                            if (result.content) sceneSummary = Utils.stripLLMThinkingTags(result.content).trim();
                        }
                    }
                } catch (summaryError) {
                    recordRuntimeDebug('warn', "[LIBRA] Transition Summary generation failed, but continuing transition:", summaryError);
                }

                // 2. 새 채팅방에 주입할 로어 구축
                const inheritedLore = _buildInheritedLore(lore, sceneSummary);

                await loreLock.writeLock();
                try {
                    // 3. 새 채팅방 생성 및 데이터 직접 주입
                    LMAI_GUI.toast("새 채팅방 생성 중...");
                    const latestChar = await requireLoadedCharacter();
                    const latestChat = await getActiveChatForCharacter(latestChar);
                    const latestSourceChatId = latestChat?.id || null;
                    if (latestSourceChatId !== sourceChatId) {
                        throw new LIBRAError('Active chat changed during transition', 'CHAT_CHANGED');
                    }

                    const nextChar = cloneForMutation(latestChar);
                    nextChar.chats = Array.isArray(nextChar.chats) ? nextChar.chats : [];
                    const chatCount = nextChar.chats.length;
                    const newChat = {
                        message: [],
                        note: String(sourceChat?.note || ''),
                        name: `Session ${chatCount + 1} (LIBRA)`,
                        localLore: inheritedLore,
                        fmIndex: -1,
                        id: _generateUUID()
                    };

                    nextChar.chats.unshift(newChat);
                    nextChar.chatPage = 0;

                    const newScopeKey = getChatRuntimeScopeKey(newChat, nextChar);
                    try {
                        const db = await getLibraAllowedDatabase();
                        SecretKnowledgeCore.loadState(inheritedLore, {
                            scopeKey: newScopeKey,
                            chatId: String(newChat?.id || '').trim()
                        });
                        EntityKnowledgeVaultCore.loadState(inheritedLore, {
                            scopeKey: newScopeKey,
                            chatId: String(newChat?.id || '').trim()
                        });
                        TimeEngine.loadState(inheritedLore, {
                            scopeKey: newScopeKey,
                            chatId: String(newChat?.id || '').trim()
                        });
                        EntityManager.rebuildCache(inheritedLore);
                        const personaSync = await SourceReflectionManager.syncPersonaIdentity(nextChar, newChat, inheritedLore, db);
                        if (personaSync.changed) {
                            await EntityManager.saveToLorebook(nextChar, newChat, inheritedLore);
                        }
                        MemoryEngine.setLorebook(nextChar, newChat, inheritedLore);
                    } catch (personaSyncError) {
                        recordRuntimeDebug('warn', '[LIBRA] Transition persona sync skipped:', personaSyncError?.message || personaSyncError);
                    }

                    await RisuCompat.setCharacter(safeClone(nextChar));

                    // 4. 세션 추적 갱신
                    MemoryState.rollbackTracker.clear();
                    MemoryState.pendingTurnCommits.clear();
                    MemoryState.transientMissing.clear();
                    MemoryState.finalizedTurnMetaByScope.clear();
                    MemoryState.liveSyncStateByScope.clear();
                    MemoryState.commitRevisionByScope.clear();
                    enterRefreshStabilizeWindow();
                    MemoryState._activeChatId = newChat.id;
                    MemoryState._activeScopeKey = newScopeKey;
                    MemoryState.currentSessionId = buildScopedSessionId(newScopeKey);
                    MemoryState.greetingIsolationChatId = newChat.id;
                    MemoryState.greetingIsolationRearmAvailable = false;
                    MemoryState.pendingGreetingIsolationChatId = newChat.id;
                    MemoryState.pendingGreetingIsolationArmed = true;
                    MemoryState.ignoredGreetingSignature = null;

                    // 5. 엔진 재로드
                    MemoryEngine.rebuildIndex(inheritedLore);
                    SecretKnowledgeCore.loadState(inheritedLore, {
                        scopeKey: newScopeKey,
                        chatId: String(newChat?.id || '').trim()
                    });
                    EntityKnowledgeVaultCore.loadState(inheritedLore, {
                        scopeKey: newScopeKey,
                        chatId: String(newChat?.id || '').trim()
                    });
                    TimeEngine.loadState(inheritedLore, {
                        scopeKey: newScopeKey,
                        chatId: String(newChat?.id || '').trim()
                    });
                    HierarchicalWorldManager.loadWorldGraph(inheritedLore, true);
                    EntityManager.rebuildCache(inheritedLore);
                    NarrativeTracker.loadState(inheritedLore);
                    StoryAuthor.loadState(inheritedLore);
                    Director.loadState(inheritedLore);
                    CharacterStateTracker.loadState(inheritedLore);
                    WorldStateTracker.loadState(inheritedLore);
                    MemoryEngine.setTurn(deriveMaxTurnFromLorebook(inheritedLore));

                    // 6. 상태 복구
                    MemoryState.isSessionRestored = true;
                    await identifyGreeting();
                } finally {
                    loreLock.writeUnlock();
                }

                recordRuntimeDebug('log', "[LIBRA] Session transition complete. New chat created with inherited data.");
                LMAI_GUI.toast("✨ 새 세션이 생성되었습니다! 모든 기억이 계승되었습니다.");
                return true;
            } catch (e) {
                recordRuntimeDebug('error', "[LIBRA] Execute Transition Error:", e);
                return false;
            }
        };


        const identifyGreeting = async () => {
            if (!MemoryState.isSessionRestored) return;
            
            try {
                const char = await RisuCompat.getCharacter();
                const chat = await getActiveChatForCharacter(char);
                const msgs_all = getChatMessages(chat);
                const currentChatId = chat?.id || null;
                const pendingChatId = MemoryState.pendingGreetingIsolationChatId || null;
                const pendingArmed = MemoryState.pendingGreetingIsolationArmed === true;

                if (!pendingArmed || !currentChatId || !pendingChatId || currentChatId !== pendingChatId) {
                    MemoryState.pendingGreetingIsolationChatId = null;
                    MemoryState.pendingGreetingIsolationArmed = false;
                    return;
                }
                
                if (chat && msgs_all.length === 1) {
                    const firstMsg = msgs_all[0];
                    if (firstMsg && !isUserLikeMessage(firstMsg)) {
                        MemoryState.ignoredGreetingSignature = getMessageSignature(firstMsg);
                        MemoryState.greetingIsolationChatId = currentChatId;
                        MemoryState.greetingIsolationRearmAvailable = true;
                        recordRuntimeDebug('log', '[LIBRA] Initial greeting identified and will be isolated');
                    }
                }
                MemoryState.pendingGreetingIsolationChatId = null;
                MemoryState.pendingGreetingIsolationArmed = false;
            } catch (e) {
                recordRuntimeDebug('warn', "[LIBRA] Failed to identify greeting:", e);
            }
        };

        return { executeTransition, identifyGreeting };
    })();
