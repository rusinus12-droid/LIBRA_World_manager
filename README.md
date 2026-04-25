[README_LIBRA_V4_Narrative_Core_X.md](https://github.com/user-attachments/files/27086093/README_LIBRA_V4_Narrative_Core_X.md)
# LIBRA World Manager · V4 Narrative Core X

LIBRA World Manager V4 Narrative Core X는 RisuAI 장기 RP와 시뮬레이션 채팅을 위한 통합 내러티브 오케스트레이션 시스템이다. 단일 메모리 저장기나 단순 로어북 보조기가 아니라, 현재 유저 입력, 최근 raw 장면, 직접 증거, 인물 연속성, 세계 압력, 갈등/결과/복선, Story Author 계획, Director 실행 지시를 하나의 우선순위 파이프라인으로 정렬하는 런타임 구조다.

최종 확정본의 핵심은 다음 다섯 파일이다.

| 구분 | 파일 | 역할 |
|---|---|---|
| 본체 | `LIBRA World Manager v4 Narrative Core X(2).js` | 최상위 내러티브 오케스트레이터 |
| 서브 플러그인 | `LIBRA_SubPlugin - Direct Memory Archive(8).js` | 원문/직접 증거 보존층 |
| 서브 플러그인 | `LIBRA_SubPlugin - Entity Core X(11).js` | 인물·심리·관계 연속성 엔진 |
| 서브 플러그인 | `LIBRA_SubPlugin - World Core X(10).js` | 세계·세력·지역·오프스크린 압력 엔진 |
| 서브 플러그인 | `LIBRA_SubPlugin - Story Ledger X(3).js` | 갈등·결과·복선·장면 변화 장부 |

---

## 1. 설계 목표

LIBRA가 해결하려는 핵심 문제는 다음과 같다.

1. 긴 채팅에서 AI가 최근 장면보다 오래된 요약을 우선하는 문제
2. 캐릭터의 욕망, 두려움, 관계, 감정선이 장기 대화에서 평면화되는 문제
3. 세계관 규칙, 세력 관계, 장소 제약, 오프스크린 진행이 사라지는 문제
4. 복선, 갈등, 결정의 결과가 후속 장면에서 회수되지 않는 문제
5. regenerate, rollback, refresh, session transition 과정에서 구조 데이터가 오염되거나 끊기는 문제
6. 서브 플러그인이 많아질수록 프롬프트 주입 권한과 저장 권한이 충돌하는 문제

V4 Narrative Core X는 이 문제를 “메모리를 더 많이 넣는 방식”으로 해결하지 않는다. 대신 근거의 위계를 정하고, 각 모듈의 책임을 분리한다.

---

## 2. 최상위 우선순위

World Manager는 최종 오케스트레이터로서 다음 순서를 기준으로 판단한다.

1. Safety / platform constraints
2. Current user input
3. Explicit user corrections
4. Hard world rules / Hypa / user manual lore
5. Recent live raw turns
6. DMA direct evidence
7. Scene contract
8. Entity Core X continuity guidance
9. World Core X pressure hints
10. Narrative diagnostics
11. Story Author plan
12. Director directive
13. DMA previous archive
14. Legacy memory compatibility
15. Low-confidence inferred context

이 우선순위에서 중요한 점은 `Entity Core X`, `World Core X`, `Story Ledger X`가 최종 권한자가 아니라는 것이다. 이들은 World Manager에 재료를 제공하며, 현재 유저 입력과 직접 증거를 덮어쓰면 안 된다.

---

## 3. 본체 사양: World Manager / V4 Narrative Core X

### 3.1 역할

World Manager는 LIBRA 전체의 중심이다. 다음 영역을 담당한다.

- 현재 유저 입력 우선순위 관리
- 라이브 채팅 감사 및 최근 턴 정렬
- 장면 계약(scene contract)
- DMA direct evidence intake
- 내러티브 진단
- Story Author 계획 호출 및 정규화
- Director 실행 지시 호출 및 정규화
- 출력 성능 지시
- 친밀도/경계 정책
- 캐논 변경 gate
- Reliability Guard
- Cache Keeper / LLM Call Governor
- GUI / Runtime Workspace / Activity Dashboard
- Extension Host와 서브 플러그인 인터롭

### 3.2 Story Author

Story Author는 장면을 직접 쓰지 않는다. 현재 상태를 바탕으로 다음 서사 흐름을 계획한다.

주요 출력 필드:

- `currentArc`
- `narrativeGoal`
- `scenePhase`
- `activeTensions`
- `primaryTension`
- `openQuestions`
- `payoffCandidates`
- `recommendedBeatType`
- `nextBeats`
- `guardrails`
- `doNotResolveYet`
- `entityContextHints`
- `relationStateSignals`
- `environmentPressures`
- `storylineCarryoverSignals`
- `focusCharacters`
- `recentDecisions`
- `userIntentAlignment`

### 3.3 Director

Director는 Story Author의 계획을 메인 응답 모델이 따를 수 있는 실행 지시로 변환한다.

주요 출력 필드:

- `sceneMandate`
- `executionMode`
- `beatTypeToExecute`
- `requiredOutcomes`
- `forbiddenMoves`
- `emphasis`
- `stagingInstructions`
- `dialogueInstructions`
- `pacingInstructions`
- `continuityLocks`
- `targetPacing`
- `pressureLevel`
- `endingRequirement`

### 3.4 Reliability Guard

지원 서브시스템이 실패한 경우, World Manager는 보수적인 응답 방침을 주입한다.

- established continuity 우선
- 새 캐논 생성 억제
- visible scene evidence 우선
- hard failure 시 최근 visible turn 중심으로 후퇴

---

## 4. 서브 플러그인 사양

## 4.1 Direct Memory Archive

DMA는 LIBRA의 canonical raw/direct evidence preservation layer다.

### 소유 데이터

- `directEntries`
- `previousEntries`
- `pendingCaptures`
- `repairQueue`
- `deletedTurnTombstones`
- `sourceMessageIds`
- archive grouping metadata

### 핵심 설정

| 설정 | 기본 성격 |
|---|---|
| `directPromptLimit` | 프롬프트에 노출할 direct evidence 수 |
| `previousPromptLimit` | previous archive 요약 노출 수 |
| `maxDirectEntries` | direct evidence 최대 보존량 |
| `maxPreviousEntries` | previous archive 최대 보존량 |
| `maxPendingCaptures` | pending capture 보존량 |
| `maxRepairQueue` | repair queue 보존량 |
| `archiveMinAgeTurns` | archive 전 최소 턴 거리 |
| `archiveGroupTurns` | archive grouping 단위 |
| `previousEvidencePerItem` | previous 요약당 evidence ref 수 |

### 설계 원칙

- raw/direct evidence는 요약보다 강한 근거다.
- legacy memory는 호환, 이전, fallback 계층이다.
- regenerate/rollback/삭제/refresh 상황에서도 source lineage를 최대한 유지한다.
- 스트리밍 환경에서는 pending/repair queue를 통해 중간 캡처 문제를 완화한다.

---

## 4.2 Entity Core X

Entity Core X는 메모리 저장소가 아니라 entity continuity engine이다.

### 핵심 역할

- DMA evidence 소비
- 인물별 continuity guidance 생성
- branch state 관리
- emotion state 관리
- relation signal 산출
- genre affect signal 제공
- conservative patch proposal 생성

### Branch Registry

| Branch | 의미 |
|---|---|
| `desire` | 인물이 원하는 것, 목표, 갈망 |
| `fear` | 두려움, 회피, 불안 |
| `wound` | 상처, 후회, 트라우마, 상실 |
| `mask` | 가면, 숨김, 연기, 태연한 척 |
| `bond` | 유대, 신뢰, 사랑, 보호, 질투 |
| `fixation` | 집착, 강박, 미련 |

### 주요 설정

| 설정 | 권장값 | 설명 |
|---|---:|---|
| `maxPromptEntities` | 3 | 한 턴에 강하게 노출할 인물 수 |
| `promptBudget` | 1700 | Entity guidance 예산 |
| `promptRecallHighlights` | 3 | 회상 highlight 수 |
| `promptContinuityLocks` | 3 | continuity lock 수 |
| `recallTopK` | 4 | 검색 후보 수 |
| `activationGain` | 9 | 활성도 상승량 |
| `activationDecay` | 7 | 활성도 감소량 |
| `patchAutoApplyThreshold` | 0.9 | 자동 적용 임계값 |
| `patchOverwriteThreshold` | 0.97 | overwrite 임계값 |

### Analysis Provider

Entity Core X의 analysis provider는 기본적으로 보수적으로 사용해야 한다.

권장값:

- `enabled`: 필요할 때만 true
- `autoRun`: false 또는 gated auto
- `manualRun`: true
- `requireGovernorApproval`: true
- `onlyWhenDirty`: true
- `minDirtySeverity`: high
- `outputMode`: proposal
- `autoApply`: false

---

## 4.3 World Core X

World Core X는 world continuity coprocessor다.

### 핵심 역할

- setting ontology 압축
- world rules 추적
- factions / regions / organizations 추적
- offscreen threads 유지
- genre/tone weights 제공
- propagation risk 판단
- World Manager에 world pressure hint 제공

### 주요 설정

| 설정 | 설명 |
|---|---|
| `worldPromptMode` | light / balanced / heavy |
| `worldPromptDensity` | light / balanced / heavy |
| `worldDossierMode` | off / focused / expanded |
| `offscreenThreadStrength` | light / balanced / heavy |
| `factionEmphasis` | light / balanced / heavy |
| `regionAwareness` | 지역 인식 여부 |
| `bgListMode` | 장면 밖 후보 주입 방식 |
| `bgScope` | 장면 밖 후보 탐색 범위 |
| `bgContextMode` | direct / indirect / time_shared / random |

### 권장값

일반 RP:

```text
worldPromptMode = balanced
worldPromptDensity = balanced
worldDossierMode = focused
offscreenThreadStrength = balanced
factionEmphasis = balanced
regionAwareness = true
```

성능 우선:

```text
worldPromptMode = light
worldPromptDensity = light
worldDossierMode = focused
bgListMode = off
```

세계관/세력극 우선:

```text
worldPromptMode = heavy
worldPromptDensity = balanced
worldDossierMode = expanded
offscreenThreadStrength = heavy
factionEmphasis = heavy
```

---

## 4.4 Story Ledger X

Story Ledger X는 deterministic narrative memory ledger다. LLM을 호출하지 않으며, World Manager를 대체하지 않는다.

### 소유 데이터

| 필드 | 설명 |
|---|---|
| `conflictTraces` | 미해결 갈등과 긴장 |
| `consequenceLedger` | 결정과 그 결과 |
| `payoffTracker` | 회수 후보, 열린 질문, continuity lock |
| `sceneDeltaLog` | 장면 변화와 턴 단위 요약 |
| `themeMotifTrace` | 반복되는 주제와 모티프 |

### 주요 설정

| 설정 | 권장값 | 설명 |
|---|---:|---|
| `maxConflictTraces` | 32 | 갈등 기록 최대 수 |
| `maxConsequences` | 48 | 결과 장부 최대 수 |
| `maxPayoffs` | 48 | 복선/회수 후보 최대 수 |
| `maxSceneDeltas` | 24 | 장면 변화 로그 수 |
| `maxThemeMotifs` | 16 | 모티프 기록 수 |
| `guidanceMaxItems` | 6 | prompt guidance 항목 수 |
| `guidanceMaxChars` | 1200 | prompt guidance 최대 글자 수 |
| `minPriorityForPrompt` | 0.25 | 프롬프트 노출 최소 우선도 |

### API

```js
await LIBRA_StoryLedgerXAPI.selfCheck()
await LIBRA_StoryLedgerXAPI.ingestNarrativeFrame(frame)
await LIBRA_StoryLedgerXAPI.finalizeTurn(context)
await LIBRA_StoryLedgerXAPI.getLedgerGuidance(context)
await LIBRA_StoryLedgerXAPI.getPromptBundle(context)
await LIBRA_StoryLedgerXAPI.getState({ scopeId })
await LIBRA_StoryLedgerXAPI.exportScopeStore({ scopeId })
await LIBRA_StoryLedgerXAPI.importScopeStore({ scopeId, store })
await LIBRA_StoryLedgerXAPI.importFromCopiedChat({ targetScopeId, sourceScopeId })
await LIBRA_StoryLedgerXAPI.rebuild({ scopeId })
await LIBRA_StoryLedgerXAPI.clearScope({ scopeId })
```

### 저장 안정화

최종 확정본에서는 scope별 `saveTimers` Map을 사용한다. 따라서 A scope의 저장 예약이 B scope의 저장 예약으로 취소되는 문제가 발생하지 않도록 설계되어 있다.

---

## 5. 런타임 파이프라인

## 5.1 Bootstrap / Extension Host

초기 로딩 단계다.

작업:

- World Manager GUI 등록
- Extension Host 확인
- 서브 플러그인 등록
- RuntimeBridge 확인
- PluginCoordinator 상태 보고
- active scope 확인
- dashboard queue 초기화

점검:

```js
!!globalThis.LIBRA
!!globalThis.LIBRA_StoryLedgerXAPI
!!globalThis.LIBRA?.EntityCoreX
!!globalThis.LIBRA?.WorldCoreX
```

## 5.2 beforeRequest

메인 모델 요청 직전 단계다.

작업:

- 현재 유저 입력 분석
- 최근 raw turn 정렬
- DMA direct evidence projection
- Entity Core X prompt bundle
- World Core X pressure hints
- Story Ledger supporting hints
- Hypa / manual lore / world codex 정렬
- Story Author planning
- Director execution directive
- prompt budget trim

사용자가 확인할 것:

- 현재 유저 입력이 무시되지 않는가
- 최근 장면이 summary보다 우선되는가
- prompt budget 때문에 중요한 섹션이 잘리지 않는가
- Entity/World/Story guidance가 과도하게 중복되지 않는가

## 5.3 afterRequest

메인 응답 수신 직후 단계다.

작업:

- 응답 정화
- interop guard
- DMA capture 예약
- Entity/World 상태 업데이트 예약
- Story Ledger ingest 후보 생성
- pending turn metadata 생성

주의:

스트리밍 환경에서는 응답 중간 캡처가 발생할 수 있다. 이 경우 DMA pending/repair queue와 finalize 시점을 확인한다.

## 5.4 pending / finalize

응답을 확정하는 단계다.

작업:

- pending turn 확정
- DMA direct/previous archive 갱신
- Story Ledger finalize
- Entity/World trim 또는 rebuild
- checkpoint 저장
- runtime report 갱신

## 5.5 recovery / audit

복구 단계다.

작업:

- refresh checkpoint restore
- live poll 기반 누락 턴 확인
- rollback/regenerate 감지
- copied chat import
- scope store 재정렬
- degraded runtime 복구

---

## 6. 추천 설정 프리셋

### 6.1 Balanced 기본형

대부분의 장기 RP에 추천한다.

```text
World Manager: core prompt injection on
DMA: default
Entity Core X: maxPromptEntities 3, promptBudget 1700
World Core X: worldPromptMode balanced, density balanced
Story Ledger X: guidanceMaxItems 6, guidanceMaxChars 1200
Analysis Provider: manual/proposal 중심
```

### 6.2 인물 몰입형

캐릭터 심리와 관계가 가장 중요한 경우.

```text
Entity Core X:
  maxPromptEntities = 3~4
  promptRecallHighlights = 3~4
  promptContinuityLocks = 3
  recallTopK = 4
  analysisProvider.autoRun = false
  analysisProvider.manualRun = true

World Core X:
  worldPromptMode = balanced
  worldPromptDensity = light~balanced

Story Ledger X:
  guidanceMaxItems = 4~6
```

### 6.3 세계관/세력극 강화형

정치극, 조직전, 세계 규칙이 중요한 경우.

```text
World Core X:
  worldPromptMode = heavy
  worldPromptDensity = balanced
  worldDossierMode = expanded
  offscreenThreadStrength = heavy
  factionEmphasis = heavy
  regionAwareness = true

Entity Core X:
  maxPromptEntities = 2~3

Story Ledger X:
  minPriorityForPrompt = 0.25
```

### 6.4 성능 우선 경량형

토큰과 속도를 우선할 때.

```text
Entity Core X:
  maxPromptEntities = 2
  promptBudget = 1000~1300

World Core X:
  worldPromptMode = light
  worldPromptDensity = light
  bgListMode = off

Story Ledger X:
  guidanceMaxItems = 3~4
  guidanceMaxChars = 600~900

Analysis Provider:
  autoRun = false
```

### 6.5 복선 회수 강화형

장기 플롯, 미회수 갈등, 결과 회수가 중요한 경우.

```text
Story Ledger X:
  enabled = true
  promptGuidanceEnabled = true
  guidanceMaxItems = 6
  guidanceMaxChars = 1200~1600
  minPriorityForPrompt = 0.25~0.35
  decayEnabled = true
```

---

## 7. 운용 체크리스트

### 최초 설치 후

- [ ] World Manager GUI가 열리는가
- [ ] DMA API가 ready인가
- [ ] Entity Core X API가 ready인가
- [ ] World Core X API가 ready인가
- [ ] Story Ledger X selfCheck가 성공하는가
- [ ] 첫 응답 후 DMA direct entry가 생성되는가
- [ ] 5~10턴 후 Entity guidance가 비어 있지 않은가
- [ ] 5~10턴 후 Story Ledger conflict/payoff가 쌓이는가

### 장기 RP 중

- [ ] 현재 유저 입력이 항상 최우선으로 반영되는가
- [ ] 최근 raw 장면과 오래된 요약이 충돌할 때 최근 장면이 우선되는가
- [ ] 인물 감정선이 튀지 않는가
- [ ] 세계 규칙이 임의로 바뀌지 않는가
- [ ] 복선과 결과가 너무 많이 주입되어 장면을 방해하지 않는가
- [ ] prompt budget 초과로 핵심 섹션이 잘리지 않는가

### 문제가 생겼을 때

1. Runtime status / degraded 여부 확인
2. DMA pending / repair queue 확인
3. Story Ledger `selfCheck()` 실행
4. Entity/World prompt bundle이 비정상적으로 큰지 확인
5. World Manager Reliability Guard가 작동했는지 확인
6. refresh checkpoint 또는 live audit 실행
7. 필요 시 해당 scope store export 후 수동 점검

---

## 8. 권장 개발 원칙

최종 확정본 이후에는 새 코어를 추가하는 것보다 다음 원칙을 지키는 편이 좋다.

1. 본체 최종 오케스트레이션 권한을 유지한다.
2. 서브 플러그인은 guidance 또는 evidence provider로 제한한다.
3. current user input을 덮어쓰는 모듈을 만들지 않는다.
4. DMA direct evidence를 장면 사실 판정의 핵심 근거로 둔다.
5. Story Ledger는 낮은 우선순위 supporting hints로 유지한다.
6. analysis provider 자동 실행은 제한적으로만 허용한다.
7. prompt budget 경쟁이 생기면 기능을 더하는 대신 density를 낮춘다.
8. scope별 저장과 copied chat import를 항상 고려한다.

---

## 9. 알려진 점검 포인트

- 스트리밍 응답에서는 afterRequest 타이밍이 불완전할 수 있다.
- prompt guidance가 많아지면 메인 장면의 생동감이 줄 수 있다.
- Entity / World / Story guidance가 같은 사실을 반복할 수 있으므로 중복 주입량을 관찰해야 한다.
- 분석 provider를 자동으로 많이 켜면 비용과 지연이 커질 수 있다.
- 채팅 복사 후 scope import가 정상 작동하는지 테스트가 필요하다.
- 대규모 장기 채팅에서는 30턴, 100턴 단위 실전 테스트가 필요하다.

---

## 10. 최종 구조 요약

```text
Current User Input
  ↓
World Manager / V4 Narrative Core X
  ├─ DMA: direct evidence / previous archive / repair queue
  ├─ Entity Core X: character continuity / emotion / relation / branch state
  ├─ World Core X: world rules / factions / regions / offscreen pressure
  ├─ Story Ledger X: conflicts / consequences / payoffs / scene deltas
  ├─ Story Author: narrative plan
  └─ Director: execution directive
  ↓
Prompt Injection / Main Model Response
  ↓
afterRequest → pending → finalize → recovery/audit
```

LIBRA V4 Narrative Core X의 핵심은 “더 많은 기억”이 아니라 “근거의 위계와 책임 분리”다. 증거는 DMA, 인물은 Entity Core X, 세계는 World Core X, 복선과 결과는 Story Ledger X, 최종 판단과 주입은 World Manager가 담당한다.
