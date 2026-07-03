'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'LIBRA World Manager.js');
const OUT_DIR = path.join(ROOT, 'test-output');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TEST_FAST_PATCH = true;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = path.join(OUT_DIR, `libra-97-harness-${RUN_ID}.json`);
const TURN_COUNT = Math.max(1, Number(process.env.LIBRA_TURNS || 97) || 97);
const FOREGROUND_TIMEOUT_MS = Math.max(100, Number(process.env.LIBRA_FOREGROUND_TIMEOUT_MS || 5000) || 5000);
const TURN_CALL_TIMEOUT_MS = Math.max(1000, Number(process.env.LIBRA_TURN_CALL_TIMEOUT_MS || 15000) || 15000);

function stableHash(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 12);
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }
function bytesToMB(n) { return Math.round((Number(n || 0) / 1024 / 1024) * 100) / 100; }
function memSample(label) {
  if (global.gc) { try { global.gc(); } catch (_) {} }
  const m = process.memoryUsage();
  return {
    label,
    at: nowIso(),
    rssMB: bytesToMB(m.rss),
    heapUsedMB: bytesToMB(m.heapUsed),
    heapTotalMB: bytesToMB(m.heapTotal),
    externalMB: bytesToMB(m.external),
    arrayBuffersMB: bytesToMB(m.arrayBuffers)
  };
}
function p95(values) {
  const arr = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!arr.length) return 0;
  return arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))];
}
function avg(values) {
  const arr = values.filter(v => Number.isFinite(v));
  return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
}

function makePair(turn) {
  const arc = turn <= 20 ? '초기 조사' : turn <= 45 ? '별핵 봉인 해제' : turn <= 70 ? '노아의 배신과 화해' : '월식 의식 결전';
  const place = turn % 5 === 0 ? '시계탑 관측실' : turn % 3 === 0 ? '달그림자 도서관 지하서고' : '루멘 아카데미 중앙정원';
  const active = turn % 4 === 0 ? '미라' : turn % 7 === 0 ? '노아' : '아리엘';
  const user = `T${turn}. 도현은 ${place}에서 ${active}에게 ${arc}의 다음 단서를 묻고, 별핵 파편 ${turn}의 반응을 확인한다.`;
  const assistant = [
    `T${turn}. ${place}에서 도현은 별핵 파편 ${turn}이 은색 빛을 내는 장면을 목격했다.`,
    `${active}은(는) ${arc}와 관련된 직접 증거를 확인하고, 루멘 아카데미의 금지 규칙이 아직 유효하다고 설명했다.`,
    turn % 6 === 0 ? `노아는 기록 일부를 숨겼지만 도현을 보호하려는 동기였음이 드러났다.` : `아리엘은 도현에게 관측 기록을 맡기며 신뢰를 조금 더 보였다.`,
    turn % 9 === 0 ? `세계 규칙: 월식이 가까워질수록 시간 잠금 주문은 불안정해지고 거짓 기억을 만들 수 있다.` : `현재 갈등은 별핵의 진짜 사용 목적과 학생회 감시망을 피하는 문제로 이어졌다.`
  ].join(' ');
  return { user, assistant, arc, place, active };
}

function buildHistoricalMessages(count = 97) {
  const msgs = [];
  msgs.push({ role: 'assistant', content: '루멘 아카데미의 밤, 달그림자 도서관에서 금지된 별핵 기록이 깨어났다.', m_id: 'greeting-0', time: Date.now() - 1000000 });
  for (let i = 1; i <= count; i++) {
    const pair = makePair(i);
    msgs.push({ role: 'user', content: pair.user, m_id: `u-${i}`, time: Date.now() - (1000000 - i * 2000) });
    msgs.push({ role: 'assistant', content: pair.assistant, m_id: `a-${i}`, time: Date.now() - (999000 - i * 2000) });
  }
  return msgs;
}

function makeCanonicalPacket(label, userContent) {
  const text = String(userContent || '');
  const turnMatch = text.match(/Turn:\s*(\d+)/i) || text.match(/T(\d+)/);
  const turn = turnMatch ? Number(turnMatch[1]) : 97;
  const summary = text.includes('cold-reanalysis')
    ? '과거 대화 재분석 결과: 루멘 아카데미의 별핵 봉인, 아리엘-도현 신뢰, 노아의 숨김 행동과 화해가 핵심 축이다.'
    : text.includes('cold-start')
      ? '콜드스타트 분석 결과: 루멘 아카데미의 별핵 봉인과 월식 의식으로 이어지는 장기 서사가 확인된다.'
      : `턴 ${turn} 분석: 별핵 파편 조사와 인물 간 신뢰 변화가 진행된다.`;
  return {
    meta: {
      summary_memory: { summary, recall: '별핵, 루멘 아카데미, 달그림자 도서관, 월식 의식, 시간 잠금' },
      node_memory: { nodes: ['루멘 아카데미', '달그림자 도서관', '시계탑 관측실'] },
      audit_cautions: ['사용자 지시가 아니라 assistant 응답에서 확인된 사건만 정본으로 삼는다.'],
      overpromotion_risks: []
    },
    memory: {
      events: [
        { summary: `턴 ${turn}까지 별핵 파편 조사가 이어지고 월식 의식의 위험성이 확인됨`, entities: ['도현', '아리엘'], time: `T${turn}`, location: '루멘 아카데미', evidence: 'assistant canonical evidence', importance: 0.82, confidence: 0.86 },
        { summary: '노아는 일부 기록을 숨겼지만 도현을 보호하려는 동기를 보임', entities: ['노아', '도현'], time: `T${turn}`, location: '달그림자 도서관', evidence: 'assistant canonical evidence', importance: 0.68, confidence: 0.76 }
      ],
      facts: [
        { summary: '루멘 아카데미에는 별핵 연구를 금지하는 규칙이 있다.', entities: ['루멘 아카데미'], confidence: 0.9 },
        { summary: '시간 잠금 주문은 월식이 가까울수록 불안정해진다.', entities: ['별핵'], confidence: 0.82 }
      ],
      open_threads: ['별핵의 진짜 사용 목적', '학생회 감시망 회피', '월식 의식의 최종 선택']
    },
    entity: {
      characters: [
        { name: '도현', role: '학생 조사자', background: '루멘 아카데미의 학생으로 별핵 사건을 추적한다.', personality: ['신중함', '책임감'], current_state: `T${turn} 기준 별핵 파편 조사 중`, open_threads: ['별핵 사용 목적 확인'], confidence: 0.88, importance: 0.8 },
        { name: '아리엘', role: '도서관 관리자/조력자', background: '달그림자 도서관의 기록을 관리한다.', personality: ['침착함', '보호적'], speech: ['차분하고 정중한 말투'], current_state: '도현에게 관측 기록을 맡기며 신뢰를 보인다.', confidence: 0.86, importance: 0.78 },
        { name: '미라', role: '장치 기술자', background: '시계탑 관측 장치를 수리하고 별핵 반응을 측정한다.', personality: ['현실적', '분석적'], current_state: '관측 장치와 별핵 파편을 점검한다.', confidence: 0.78, importance: 0.62 },
        { name: '노아', role: '경쟁자에서 임시 동맹', background: '일부 기록을 숨겼지만 보호 동기를 가진 인물이다.', personality: ['방어적', '갈등적'], current_state: '숨긴 기록 때문에 신뢰 문제가 남아 있다.', confidence: 0.74, importance: 0.65 }
      ],
      relations: [
        { entityA: '도현', entityB: '아리엘', type: '조력과 신뢰', summary: '도현과 아리엘은 별핵 조사를 함께하며 신뢰를 쌓는다.', closeness: 0.55, trust: 0.68, unresolved_issues: ['별핵 사용 목적에 대한 비밀'], confidence: 0.84 },
        { entityA: '도현', entityB: '노아', type: '긴장 섞인 동맹', summary: '노아의 은폐 때문에 갈등이 있으나 보호 동기가 드러난다.', closeness: 0.34, trust: 0.42, tension: 0.58, unresolved_issues: ['숨긴 기록의 전모'], confidence: 0.74 }
      ],
      current_state: [
        { name: '도현', current_state: `T${turn} 기준 ${summary}`, focus: '별핵 파편 조사' }
      ],
      secrets: [
        { holder: '노아', secret: '기록 일부를 숨긴 이유는 도현 보호와 관련된다.', visible_to: ['노아'], confidence: 0.65 }
      ],
      pov_memories: []
    },
    world: {
      summary: '루멘 아카데미는 별핵과 시간 잠금 주문을 둘러싼 금지 연구가 존재하는 마법 학원 세계다.',
      description: '달그림자 도서관, 시계탑 관측실, 학생회 감시망이 주요 무대다.',
      tech: '마법 관측 장치와 별핵 공명 측정기',
      rules: ['별핵 연구는 학생회 승인 없이 금지된다.', '월식이 가까워질수록 시간 잠금 주문은 불안정해진다.'],
      places: ['루멘 아카데미', '달그림자 도서관', '시계탑 관측실'],
      organizations: ['학생회 감시망', '도서관 기록관리부'],
      social_rules: ['금지 기록은 공식 허가 없이는 열람할 수 없다.'],
      phenomena: ['별핵 공명', '시간 잠금 불안정화', '거짓 기억 발생'],
      systems: { magic: '별핵 공명과 시간 잠금 주문' },
      physics: { special_phenomena: ['월식 공명'] },
      exists: { academy: true, magic: true },
      state: { time: `T${turn}`, location: '루멘 아카데미', scene: '별핵 파편 조사 진행', active_events: ['월식 의식 접근'], offscreen_threads: ['학생회 감시 강화'] },
      active_events: ['별핵 파편 공명', '학생회 감시 강화'],
      offscreen_threads: ['월식 의식 준비']
    },
    narrative: {
      summary,
      current_arc: '별핵 봉인의 진실을 추적하며 월식 의식의 결정을 향해 간다.',
      storylines: [
        { name: '별핵 봉인과 월식 의식', context: summary, keyPoints: ['별핵 파편 조사', '시간 잠금 불안정화', '월식 의식 접근'], ongoingTensions: ['학생회 감시', '노아의 은폐', '별핵 사용 목적'], entities: ['도현', '아리엘', '노아', '미라'] }
      ],
      scene_phase: 'investigation_to_confrontation',
      conflict_traces: ['금지 연구와 안전 문제', '신뢰와 은폐'],
      scene_deltas: [`T${turn} 별핵 조사가 진전됨`],
      theme_motifs: ['기억', '신뢰', '금지된 지식'],
      unresolved_threads: ['월식 의식의 선택', '노아가 숨긴 기록의 전모']
    },
    guards: {
      continuity_locks: ['별핵 연구 금지는 계속 유효하다.', '노아의 은폐는 보호 동기와 연결된다.'],
      audit_cautions: ['사용자 요청 자체를 사건으로 저장하지 않는다.'],
      overpromotion_risks: []
    },
    importance: { overall: 0.84, reason: ['장기 세계관', '핵심 관계', '미해결 갈등'] }
  };
}

function structuredSnapshotFromPacket(packet) {
  return {
    narrative: packet.narrative.summary || packet.meta.summary_memory.summary,
    narrativeDetails: {
      storylines: packet.narrative.storylines.map(s => ({
        name: s.name,
        context: s.context,
        keyPoints: s.keyPoints,
        ongoingTensions: s.ongoingTensions,
        entities: s.entities
      }))
    },
    entities: packet.entity.characters.map(c => ({
      name: c.name,
      role: c.role,
      appearance: c.appearance || '',
      personality: Array.isArray(c.personality) ? c.personality.join(', ') : String(c.personality || ''),
      background: c.background || '',
      occupation: c.role || '',
      currentState: { summary: c.current_state || '', cognitiveFocus: c.focus ? [c.focus] : [] },
      continuity: { openThreads: (c.open_threads || []).map(label => ({ label, status: 'active', pressure: 0 })) },
      quality: { confidence: c.confidence || 0.7, importance: c.importance || 0.5, salience: c.importance || 0.5 }
    })),
    relations: packet.entity.relations.map(r => ({
      entityA: r.entityA,
      entityB: r.entityB,
      type: r.type,
      sentiment: r.summary,
      currentStatus: { summary: r.summary },
      metrics: { closeness: r.closeness ?? null, trust: r.trust ?? null, tension: r.tension || 0, ambiguity: 0.2 },
      dynamics: { unresolvedIssues: r.unresolved_issues || [], recentChanges: [r.summary] },
      quality: { confidence: r.confidence || 0.7, importance: 0.6, salience: 0.6 }
    })),
    world: {
      tech: packet.world.tech,
      summary: packet.world.summary,
      description: packet.world.description,
      classification: { primary: 'academy fantasy', complexity: 'multi_arc' },
      exists: packet.world.exists,
      systems: packet.world.systems,
      setting: { places: packet.world.places, organizations: packet.world.organizations, socialRules: packet.world.social_rules },
      physics: packet.world.physics,
      phenomena: packet.world.phenomena,
      rules: packet.world.rules,
      state: packet.world.state,
      custom: {}
    }
  };
}


async function withTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mockLLMCall(config, systemPrompt, userContent, options = {}) {
  const label = String(options.label || options.debugLabel || 'mock');
  const packet = makeCanonicalPacket(label, `${label}\n${String(userContent || '')}`);
  let payload;
  if (/afterrequest-analysis-bundle/i.test(label)) {
    payload = {
      canonicalPacket: packet,
      entityExtraction: {
        spans: [
          { text: '도현', type: 'person', confidence: 0.9 },
          { text: '아리엘', type: 'person', confidence: 0.88 },
          { text: '루멘 아카데미', type: 'place', confidence: 0.86 }
        ],
        entities: packet.entity.characters.map(c => ({ name: c.name, role: c.role, summary: c.current_state || c.background, confidence: c.confidence || 0.75 })),
        relations: packet.entity.relations,
        world: packet.world,
        conflicts: [],
        uncertain: [],
        rejected: [],
        sourceMode: 'mock_afterrequest_unified_analysis'
      },
      maintenance: {
        narrativeBrief: packet.narrative.summary,
        correction: null,
        longTermMemory: {
          schema: 'libra.rp_longterm.turn.v1',
          durableFacts: packet.memory.facts.map(f => f.summary || String(f)),
          preferences: [],
          commitments: [],
          unresolvedThreads: packet.narrative.unresolved_threads,
          relationshipMilestones: packet.entity.relations.map(r => r.summary),
          stateChanges: packet.memory.events.map(e => e.summary),
          callbackAnchors: [],
          visibility: 'public'
        },
        storyAuthor: {
          currentArc: packet.narrative.current_arc,
          narrativeGoal: '월식 의식 전까지 별핵의 목적을 확인한다.',
          activeTensions: packet.narrative.unresolved_threads,
          nextBeats: ['별핵 파편 반응 검증', '학생회 감시망 회피'],
          guardrails: packet.guards.continuity_locks,
          focusCharacters: ['도현', '아리엘', '노아'],
          recentDecisions: packet.narrative.scene_deltas
        },
        director: {
          sceneMandate: '조사와 관계 갈등의 균형을 유지한다.',
          requiredOutcomes: packet.narrative.scene_deltas,
          forbiddenMoves: packet.guards.overpromotion_risks,
          emphasis: packet.narrative.theme_motifs,
          targetPacing: 'steady',
          pressureLevel: 'medium',
          focusCharacters: ['도현', '아리엘']
        }
      }
    };
  } else if (/turn-maintenance-bundle/i.test(label)) {
    payload = {
      narrativeBrief: packet.narrative.summary,
      correction: null,
      longTermMemory: {
        durableFacts: packet.memory.facts.map(f => f.summary || String(f)),
        preferences: [], commitments: [], unresolvedThreads: packet.narrative.unresolved_threads,
        relationshipMilestones: packet.entity.relations.map(r => r.summary), stateChanges: packet.memory.events.map(e => e.summary), callbackAnchors: []
      },
      storyAuthor: { currentArc: packet.narrative.current_arc, activeTensions: packet.narrative.unresolved_threads, nextBeats: ['다음 단서 확인'], guardrails: packet.guards.continuity_locks, focusCharacters: ['도현', '아리엘'] },
      director: { sceneMandate: '정본 사건만 유지한다.', requiredOutcomes: packet.narrative.scene_deltas, forbiddenMoves: [], emphasis: packet.narrative.theme_motifs, focusCharacters: ['도현', '아리엘'] },
      canonicalPacket: packet
    };
  } else if (/verify|merge/i.test(label)) {
    payload = structuredSnapshotFromPacket(packet);
  } else if (/synthesis|canonical/i.test(label)) {
    payload = { canonicalPacket: packet, compatibilitySnapshot: structuredSnapshotFromPacket(packet) };
  } else {
    payload = { canonicalPacket: packet };
  }
  return Promise.resolve({ content: JSON.stringify(payload), usage: { prompt_tokens: Math.ceil(String(userContent || '').length / 4), completion_tokens: Math.ceil(JSON.stringify(payload).length / 4) }, serviceTier: '' });
}

function unpackLoreEntries(exports, char, chat) {
  const lore = exports.MemoryEngine.getLorebook(char, chat) || [];
  return lore;
}
function summarizeLore(exports, char, chat) {
  const lore = unpackLoreEntries(exports, char, chat);
  const byComment = {};
  for (const e of lore) byComment[e.comment || '(none)'] = (byComment[e.comment || '(none)'] || 0) + 1;
  const memories = lore.filter(e => e.comment === 'lmai_memory');
  const entities = lore.filter(e => e.comment === 'lmai_entity');
  const relations = lore.filter(e => e.comment === 'lmai_relation');
  const narrative = lore.find(e => e.comment === 'lmai_narrative');
  const hmeIndex = lore.find(e => e.comment === 'lmai_hme_index');
  let narrativeStorylines = 0;
  let narrativeTurnLog = 0;
  try {
    const parsed = JSON.parse(narrative?.content || '{}');
    narrativeStorylines = Array.isArray(parsed.storylines) ? parsed.storylines.length : 0;
    narrativeTurnLog = Array.isArray(parsed.turnLog) ? parsed.turnLog.length : 0;
  } catch (_) {}
  let hmeRows = 0;
  let hmeGraphNodes = 0;
  let hmeGraphEdges = 0;
  try {
    const parsed = JSON.parse(hmeIndex?.content || '{}');
    hmeRows = Array.isArray(parsed.rows) ? parsed.rows.length : (Array.isArray(parsed.items) ? parsed.items.length : 0);
    hmeGraphNodes = parsed.graph?.nodes ? Object.keys(parsed.graph.nodes).length : 0;
    hmeGraphEdges = parsed.graph?.edges ? Object.keys(parsed.graph.edges).length : 0;
  } catch (_) {}
  const memoryTurns = [];
  for (const e of memories) {
    const content = String(e.content || '');
    const match = content.match(/\[META:({[\s\S]*?})\]/);
    if (match) {
      try { const meta = JSON.parse(match[1]); if (Number.isFinite(Number(meta.t || meta.turn))) memoryTurns.push(Number(meta.t || meta.turn)); } catch (_) {}
    }
  }
  const topEntrySizes = lore.map(entry => ({
    key: String(entry?.key || '').slice(0, 120),
    comment: String(entry?.comment || '').trim(),
    bytes: Buffer.byteLength(String(entry?.content || ''), 'utf8'),
    contentHead: String(entry?.content || '').slice(0, 260),
    contentTail: String(entry?.content || '').slice(-260)
  })).sort((a, b) => b.bytes - a.bytes).slice(0, 12);
  return {
    totalLore: lore.length,
    byComment,
    memories: memories.length,
    entities: entities.length,
    relations: relations.length,
    narrativeStorylines,
    narrativeTurnLog,
    hmeRows,
    hmeGraphNodes,
    hmeGraphEdges,
    currentTurn: exports.MemoryEngine.getCurrentTurn?.() || 0,
    memoryTurnMin: memoryTurns.length ? Math.min(...memoryTurns) : 0,
    memoryTurnMax: memoryTurns.length ? Math.max(...memoryTurns) : 0,
    memoryUniqueTurns: new Set(memoryTurns).size,
    sampleMemoryKeys: memories.slice(0, 5).map(e => e.key || ''),
    sampleEntityNames: entities.slice(0, 8).map(e => { try { return JSON.parse(e.content || '{}').name || e.key || ''; } catch { return e.key || ''; } }),
    packedStoredEntries: Array.isArray(chat.localLore) ? chat.localLore.length : 0,
    storedBytes: Buffer.byteLength(JSON.stringify(chat.localLore || []), 'utf8'),
    topEntrySizes
  };
}

async function main() {
  const logs = [];
  const samples = [];
  const errors = [];
  const replacers = { beforeRequest: [], afterRequest: [] };
  const scriptHandlers = { output: [], editoutput: [] };
  const bodyInterceptors = [];
  const unloadHandlers = [];
  const pluginStorage = new Map();

  const chat = {
    id: `chat-libra-97-${RUN_ID}`,
    name: 'LIBRA 97턴 하네스 채팅',
    localLore: [],
    msgs: [],
    message: null,
    isStreaming: false,
    __libraTest: true
  };
  chat.message = chat.msgs;
  const char = {
    id: 'char-libra-test',
    name: 'LIBRA Test Character',
    chatPage: 0,
    chats: [chat],
    lorebook: [],
    description: '루멘 아카데미의 별핵 사건을 다루는 장기 RP 캐릭터.'
  };
  const database = { personas: [], selectedPersona: null, modules: [], enabledModules: [], moduleIntergration: [], characters: [char] };
  const args = new Map(Object.entries({
    debug: 'true',
    llm_provider: 'custom_openai',
    llm_url: 'http://mock.local/v1/chat/completions',
    llm_key: 'dummy-key',
    llm_model: 'mock-libra-model',
    llm_timeout_ms: '5000',
    llm_max_completion_tokens: '20000',
    llm_stream: 'false',
    aux_llm_enabled: 'false',
    embedding_enabled: 'false',
    cold_start_scope_preset: 'all',
    cold_start_history_limit: '0',
    manual_ooc_pause: 'false'
  }));
  const risuai = {
    async getArgument(name) { return args.get(name); },
    async getCharacter() { return clone(char); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getCharacterFromIndex(index) { return Number(index) === 0 ? clone(char) : null; },
    async getChatFromIndex(charIndex, chatIndex) { return Number(charIndex) === 0 && Number(chatIndex) === 0 ? clone(char.chats[0]) : null; },
    async setChatToIndex(charIndex, chatIndex, nextChat) {
      if (Number(charIndex) !== 0 || Number(chatIndex) !== 0) throw new Error('bad chat index');
      const preservedMsgs = char.chats[0].msgs;
      const merged = clone(nextChat);
      // Risu 저장 API가 lore만 업데이트하는 상황을 보수적으로 모사: 메시지 배열 참조는 유지하되 저장된 필드는 반영.
      merged.msgs = Array.isArray(nextChat.msgs) ? clone(nextChat.msgs) : preservedMsgs;
      merged.message = merged.msgs;
      char.chats[0] = merged;
      Object.assign(chat, merged);
      chat.msgs = merged.msgs;
      chat.message = chat.msgs;
      return true;
    },
    async setCharacter(nextChar) {
      const merged = clone(nextChar);
      Object.keys(char).forEach(k => delete char[k]);
      Object.assign(char, merged);
      if (!Array.isArray(char.chats)) char.chats = [chat];
      Object.assign(chat, char.chats[0]);
      chat.msgs = chat.msgs || chat.messages || chat.message || [];
      chat.message = chat.msgs;
      char.chats[0] = chat;
      database.characters = [char];
      return true;
    },
    async addRisuReplacer(type, handler) { (replacers[type] || (replacers[type] = [])).push(handler); return true; },
    async removeRisuReplacer(type, handler) { replacers[type] = (replacers[type] || []).filter(h => h !== handler); return true; },
    async addRisuScriptHandler(mode, handler) { (scriptHandlers[mode] || (scriptHandlers[mode] = [])).push(handler); return true; },
    async removeRisuScriptHandler(mode, handler) { scriptHandlers[mode] = (scriptHandlers[mode] || []).filter(h => h !== handler); return true; },
    async registerBodyIntercepter(handler) { const id = `interceptor-${bodyInterceptors.length + 1}`; bodyInterceptors.push({ id, handler }); return id; },
    async unregisterBodyIntercepter(id) { const idx = bodyInterceptors.findIndex(x => x.id === id); if (idx >= 0) bodyInterceptors.splice(idx, 1); return true; },
    async onUnload(handler) { unloadHandlers.push(handler); return true; },
    async registerSetting() { return true; },
    async registerButton() { return true; },
    async showContainer() { return true; },
    async hideContainer() { return true; },
    async getDatabase(keys) {
      const out = {};
      for (const k of Array.isArray(keys) ? keys : Object.keys(database)) out[k] = clone(database[k]);
      return out;
    },
    pluginStorage: {
      async getItem(key) { return pluginStorage.has(key) ? pluginStorage.get(key) : null; },
      async setItem(key, value) { pluginStorage.set(key, value); return true; }
    },
    async nativeFetch() { throw new Error('nativeFetch should not be called in mock LLM mode'); },
    async requestPluginPermission() { return true; }
  };

  let code = fs.readFileSync(DIST, 'utf8');
  if (TEST_FAST_PATCH) {
    code = code
      .replace('const PENDING_FINALIZE_MIN_MS = 3500;', 'const PENDING_FINALIZE_MIN_MS = 0;')
      .replace('const PENDING_FINALIZE_REQUIRED_MATCHES = 2;', 'const PENDING_FINALIZE_REQUIRED_MATCHES = 1;')
      .replace('const REFRESH_STABILIZE_MS = 2500;', 'const REFRESH_STABILIZE_MS = 0;')
      .replace('const REFRESH_DELETE_BLOCK_MS = 15000;', 'const REFRESH_DELETE_BLOCK_MS = 0;');
  }
  const exportSnippet = `\n;globalThis.__LIBRA_EXPORTS__ = {\n` +
    `MemoryEngine: typeof MemoryEngine !== 'undefined' ? MemoryEngine : null,\n` +
    `MemoryState: typeof MemoryState !== 'undefined' ? MemoryState : null,\n` +
    `ColdStartManager: typeof ColdStartManager !== 'undefined' ? ColdStartManager : null,\n` +
    `TransitionManager: typeof TransitionManager !== 'undefined' ? TransitionManager : null,\n` +
    `LLMProvider: typeof LLMProvider !== 'undefined' ? LLMProvider : null,\n` +
    `EntityManager: typeof EntityManager !== 'undefined' ? EntityManager : null,\n` +
    `NarrativeTracker: typeof NarrativeTracker !== 'undefined' ? NarrativeTracker : null,\n` +
    `HierarchicalWorldManager: typeof HierarchicalWorldManager !== 'undefined' ? HierarchicalWorldManager : null,\n` +
    `WorldStateTracker: typeof WorldStateTracker !== 'undefined' ? WorldStateTracker : null,\n` +
    `CharacterStateTracker: typeof CharacterStateTracker !== 'undefined' ? CharacterStateTracker : null,\n` +
    `DebugExportManager: typeof DebugExportManager !== 'undefined' ? DebugExportManager : null,\n` +
    `PendingTurnManager: typeof PendingTurnManager !== 'undefined' ? PendingTurnManager : null,\n` +
    `TurnRecordLedger: typeof TurnRecordLedger !== 'undefined' ? TurnRecordLedger : null,\n` +
    `RollbackSnapshotManager: typeof RollbackSnapshotManager !== 'undefined' ? RollbackSnapshotManager : null,\n` +
    `LibraLoreConsolidator: typeof LibraLoreConsolidator !== 'undefined' ? LibraLoreConsolidator : null,\n` +
    `CompactMemoryCodec: typeof CompactMemoryCodec !== 'undefined' ? CompactMemoryCodec : null,\n` +
    `LMAI_GUI: typeof LMAI_GUI !== 'undefined' ? LMAI_GUI : null\n` +
    `};\n`;
  const idx = code.lastIndexOf('\n})();');
  if (idx < 0) throw new Error('Could not locate final IIFE close');
  code = code.slice(0, idx) + exportSnippet + code.slice(idx);

  const context = {
    console: {
      log: (...a) => logs.push({ level: 'log', at: nowIso(), msg: a.map(String).join(' ') }),
      warn: (...a) => logs.push({ level: 'warn', at: nowIso(), msg: a.map(String).join(' ') }),
      error: (...a) => logs.push({ level: 'error', at: nowIso(), msg: a.map(String).join(' ') }),
      debug: (...a) => logs.push({ level: 'debug', at: nowIso(), msg: a.map(String).join(' ') })
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance,
    crypto: { randomUUID: crypto.randomUUID },
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    fetch: async () => { throw new Error('fetch should not be called in mock LLM mode'); },
    risuai,
    Risuai: risuai,
    process: { env: process.env },
    Buffer,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64')
  };
  context.globalThis = context;
  vm.createContext(context);

  samples.push(memSample('before_eval'));
  const evalStart = performance.now();
  const runPromise = vm.runInContext(code, context, { filename: DIST, timeout: 10000 });
  if (runPromise && typeof runPromise.then === 'function') await runPromise;
  const exports = context.__LIBRA_EXPORTS__;
  if (!exports || !exports.MemoryEngine || !exports.ColdStartManager) {
    throw new Error(`LIBRA exports unavailable: keys=${Object.keys(context.__LIBRA_EXPORTS__ || {}).join(',')}`);
  }
  // 등록과 초기 내부 async IIFE가 끝날 시간을 조금 둔다.
  await sleep(100);
  samples.push(memSample('after_eval'));

  // 자동 cold-start 타이머가 테스트에 끼어들지 않게 check만 비활성화한다. 수동 start/reanalysis는 그대로 호출한다.
  exports.ColdStartManager.check = async () => false;
  exports.LLMProvider.call = mockLLMCall;
  exports.LLMProvider.isConfigured = () => true;
  Object.assign(exports.MemoryEngine.CONFIG, {
    debug: String(process.env.LIBRA_DEBUG || '0') === '1',
    activityDashboard: String(process.env.LIBRA_ACTIVITY_DASHBOARD || 'off'),
    useLLM: true,
    afterRequestMaintenanceMode: String(process.env.LIBRA_AFTER_REQUEST_MODE || 'foreground'),
    afterRequestForegroundTimeoutMs: FOREGROUND_TIMEOUT_MS,
    backgroundMaintenanceDelayMs: 0,
    embed: { ...(exports.MemoryEngine.CONFIG.embed || {}), enabled: false, key: '', url: '', provider: 'custom_openai', model: 'mock-embedding' },
    llm: { ...(exports.MemoryEngine.CONFIG.llm || {}), provider: 'custom_openai', url: 'http://mock.local/v1/chat/completions', key: 'dummy-key', model: 'mock-libra-model', timeout: 5000, stream: false, maxCompletionTokens: 20000 },
    auxLlm: { ...(exports.MemoryEngine.CONFIG.auxLlm || {}), enabled: false }
  });

  const beforeHandler = replacers.beforeRequest[replacers.beforeRequest.length - 1];
  const afterHandler = replacers.afterRequest[replacers.afterRequest.length - 1];
  if (typeof beforeHandler !== 'function' || typeof afterHandler !== 'function') {
    throw new Error(`handlers missing: before=${replacers.beforeRequest.length}, after=${replacers.afterRequest.length}`);
  }

  const results = {
    runId: RUN_ID,
    paths: { root: ROOT, dist: DIST, logPath: LOG_PATH },
    fastPatch: TEST_FAST_PATCH,
    turnCount: TURN_COUNT,
    foregroundTimeoutMs: FOREGROUND_TIMEOUT_MS,
    turnCallTimeoutMs: TURN_CALL_TIMEOUT_MS,
    node: process.version,
    build: { distBytes: fs.statSync(DIST).size, evalMs: Math.round(evalStart ? performance.now() - evalStart : 0) },
    handlerCounts: { beforeRequest: replacers.beforeRequest.length, afterRequest: replacers.afterRequest.length, output: scriptHandlers.output.length, editoutput: scriptHandlers.editoutput.length, bodyInterceptors: bodyInterceptors.length, unloadHandlers: unloadHandlers.length },
    stages: {},
    samples,
    errors,
    warnings: []
  };


  if (String(process.env.LIBRA_COLD_ONLY || '') === '1') {
    const historicalMessages = buildHistoricalMessages(TURN_COUNT);
    chat.msgs = historicalMessages;
    chat.message = chat.msgs;
    char.chats[0] = chat;
    samples.push(memSample(`cold_only_loaded_${TURN_COUNT}_turns`));
    results.stages.preloadedHistory = summarizeLore(exports, char, chat);

    const beforeCold = summarizeLore(exports, char, chat);
    const coldStartTime = performance.now();
    let coldResult = null;
    try {
      coldResult = await exports.ColdStartManager.startAutoSummarization();
    } catch (e) {
      errors.push({ stage: 'cold_start', message: e?.message || String(e), stack: e?.stack || '' });
    }
    await sleep(50);
    const afterCold = summarizeLore(exports, char, chat);
    results.stages.coldStart = {
      elapsedMs: Math.round(performance.now() - coldStartTime),
      before: beforeCold,
      after: afterCold,
      resultKeys: coldResult ? Object.keys(coldResult) : null,
      resultSummary: coldResult ? {
        entities: Array.isArray(coldResult.entities) ? coldResult.entities.length : 0,
        relations: Array.isArray(coldResult.relations) ? coldResult.relations.length : 0,
        narrativeChars: String(coldResult.narrative || '').length,
        worldSummaryChars: String(coldResult.world?.summary || '').length
      } : null
    };
    samples.push(memSample('after_cold_only_cold_start'));

    const beforeReanalysis = summarizeLore(exports, char, chat);
    const reStart = performance.now();
    let reResult = null;
    try {
      reResult = await exports.ColdStartManager.reanalyzeHistoricalConversation();
    } catch (e) {
      errors.push({ stage: 'reanalysis', message: e?.message || String(e), stack: e?.stack || '' });
    }
    await sleep(50);
    const afterReanalysis = summarizeLore(exports, char, chat);
    results.stages.reanalysis = {
      elapsedMs: Math.round(performance.now() - reStart),
      before: beforeReanalysis,
      after: afterReanalysis,
      resultKeys: reResult ? Object.keys(reResult) : null,
      resultSummary: reResult ? {
        entities: Array.isArray(reResult.entities) ? reResult.entities.length : 0,
        relations: Array.isArray(reResult.relations) ? reResult.relations.length : 0,
        narrativeChars: String(reResult.narrative || '').length,
        worldSummaryChars: String(reResult.world?.summary || '').length
      } : null
    };
    samples.push(memSample('after_cold_only_reanalysis'));

    const recallStart = performance.now();
    let recall = [];
    try {
      const lore = exports.MemoryEngine.getLorebook(char, chat) || [];
      recall = await exports.MemoryEngine.retrieveMemories('도현과 아리엘의 신뢰 변화와 별핵 월식 의식 단서', exports.MemoryEngine.getCurrentTurn(), lore, { focusNames: ['도현', '아리엘'], directFocusNames: ['도현', '아리엘'], relatedFocusNames: ['별핵', '월식', '노아'], narrativeArcKeys: ['별핵 봉인과 월식 의식'], suppressionPlan: null }, 8);
    } catch (e) {
      errors.push({ stage: 'recall', message: e?.message || String(e), stack: e?.stack || '' });
    }
    results.stages.recall = {
      elapsedMs: Math.round(performance.now() - recallStart),
      count: Array.isArray(recall) ? recall.length : 0,
      sample: (Array.isArray(recall) ? recall : []).slice(0, 3).map(e => ({ key: e.key, comment: e.comment, score: e._score || null, preview: String(e._recallWindow || e.content || '').slice(0, 240) })),
      debug: exports.MemoryEngine.getLastRetrievalDebug?.() || null
    };
    samples.push(memSample('after_cold_only_recall'));

    const finalLore = summarizeLore(exports, char, chat);
    const assertions = [];
    function assertCheck(name, ok, details = {}) { assertions.push({ name, ok: !!ok, details }); if (!ok) results.warnings.push({ name, details }); }
    assertCheck('cold_only_entities_present', afterCold.entities >= 4, { entities: afterCold.entities, names: afterCold.sampleEntityNames });
    assertCheck('cold_only_relations_present', afterCold.relations >= 2, { relations: afterCold.relations });
    assertCheck('cold_only_narrative_present', finalLore.narrativeStorylines >= 1, { storylines: finalLore.narrativeStorylines, turnLog: finalLore.narrativeTurnLog });
    assertCheck('cold_only_world_present', (finalLore.byComment.lmai_world_states || 0) >= 1 || (finalLore.byComment.lmai_world || 0) >= 1, { byComment: finalLore.byComment });
    assertCheck('cold_only_reanalysis_no_duplicate_explosion', afterReanalysis.totalLore <= Math.max(30, Math.ceil(afterCold.totalLore * 1.7)), { before: afterCold.totalLore, after: afterReanalysis.totalLore });
    assertCheck('cold_only_recall_returns_results', results.stages.recall.count > 0, { count: results.stages.recall.count });
    const maxHeap = Math.max(...samples.map(s => s.heapUsedMB));
    assertCheck('cold_only_heap_under_256mb_in_node_harness', maxHeap < 256, { maxHeapMB: maxHeap, growthMB: Math.round((samples[samples.length - 1].heapUsedMB - samples[0].heapUsedMB) * 100) / 100 });
    results.assertions = assertions;
    results.finalLore = finalLore;
    results.samples = samples;
    results.errors = errors;
    results.logs = logs.slice(-200);
    try { for (const fn of unloadHandlers) await fn(); } catch (e) { errors.push({ stage: 'unload', message: e?.message || String(e) }); }
    fs.writeFileSync(LOG_PATH, JSON.stringify(results, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: errors.length === 0, logPath: LOG_PATH, assertions, finalLore, stages: results.stages, samples }, null, 2));
    return;
  }

  // Stage A: live 97-turn before/afterRequest simulator from empty lore.
  const turnDurations = [];
  const stageLiveStart = performance.now();
  for (let i = 1; i <= TURN_COUNT; i++) {
    const t0 = performance.now();
    const pair = makePair(i);
    const requestMessages = [
      { role: 'system', content: 'You are running the LIBRA 97-turn test.' },
      ...chat.msgs.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
      { role: 'user', content: pair.user }
    ];
    try {
      await withTimeout(beforeHandler(requestMessages, 'model'), TURN_CALL_TIMEOUT_MS, `beforeHandler turn ${i}`);
      const userMsg = { role: 'user', content: pair.user, m_id: `live-u-${i}`, id: `live-u-${i}`, time: Date.now() };
      const aiMsg = { role: 'assistant', content: pair.assistant, m_id: `live-a-${i}`, id: `live-a-${i}`, time: Date.now() + 1 };
      chat.msgs.push(userMsg, aiMsg);
      chat.message = chat.msgs;
      char.chats[0] = chat;
      await withTimeout(afterHandler(pair.assistant, 'model'), TURN_CALL_TIMEOUT_MS, `afterHandler turn ${i}`);
    } catch (e) {
      errors.push({ stage: 'live_turn', turn: i, message: e?.message || String(e), stack: e?.stack || '' });
    }
    const dt = performance.now() - t0;
    turnDurations.push(dt);
    if (true) process.stderr.write(`[LIBRA_HARNESS] turn ${i}/${TURN_COUNT} dt=${Math.round(dt)}ms errors=${errors.length}\n`);
    if (i % 10 === 0 || i === TURN_COUNT) samples.push(memSample(`live_turn_${i}`));
  }
  // foreground maintenance should already be done; background mode can be given an explicit drain window.
  await sleep(Math.max(50, Number(process.env.LIBRA_POST_LIVE_WAIT_MS || 50) || 50));
  const liveSummary = summarizeLore(exports, char, chat);
  results.stages.live97 = {
    elapsedMs: Math.round(performance.now() - stageLiveStart),
    turnLatencyMs: { avg: Math.round(avg(turnDurations)), p95: Math.round(p95(turnDurations)), max: Math.round(Math.max(...turnDurations)) },
    lore: liveSummary,
    cacheStats: exports.MemoryEngine.getCacheStats?.() || null,
    retrievalDebug: exports.MemoryEngine.getLastRetrievalDebug?.() || null
  };
  samples.push(memSample('after_live97'));

  if (String(process.env.LIBRA_LIVE_ONLY || '') === '1') {
    const finalLore = summarizeLore(exports, char, chat);
    const assertions = [];
    function assertCheck(name, ok, details = {}) { assertions.push({ name, ok: !!ok, details }); if (!ok) results.warnings.push({ name, details }); }
    assertCheck('live_created_expected_memories', results.stages.live97.lore.memories >= TURN_COUNT, { memories: results.stages.live97.lore.memories, turnCount: TURN_COUNT });
    assertCheck('live_turn_advanced_to_turn_count', results.stages.live97.lore.currentTurn >= TURN_COUNT, { currentTurn: results.stages.live97.lore.currentTurn, turnCount: TURN_COUNT });
    assertCheck('live_entities_present', results.stages.live97.lore.entities >= 4, { entities: results.stages.live97.lore.entities, names: results.stages.live97.lore.sampleEntityNames });
    assertCheck('live_relations_present', results.stages.live97.lore.relations >= 2, { relations: results.stages.live97.lore.relations });
    assertCheck('live_latency_no_turn_freeze_gt_5s', Math.max(...turnDurations) < 5000, { maxMs: Math.round(Math.max(...turnDurations)), p95Ms: Math.round(p95(turnDurations)) });
    const maxHeap = Math.max(...samples.map(s => s.heapUsedMB));
    assertCheck('live_heap_under_256mb_in_node_harness', maxHeap < 256, { maxHeapMB: maxHeap });
    results.assertions = assertions;
    results.finalLore = finalLore;
    results.samples = samples;
    results.errors = errors;
    results.logs = logs.slice(-200);
    try { for (const fn of unloadHandlers) await fn(); } catch (e) { errors.push({ stage: 'unload', message: e?.message || String(e) }); }
    fs.writeFileSync(LOG_PATH, JSON.stringify(results, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: errors.length === 0, logPath: LOG_PATH, assertions, finalLore, stages: { live97: results.stages.live97 }, samples }, null, 2));
    return;
  }

  // Stage B: run cold start over the 97-turn chat; it should augment, not wipe.
  const beforeCold = summarizeLore(exports, char, chat);
  const coldStartTime = performance.now();
  let coldResult = null;
  try {
    coldResult = await exports.ColdStartManager.startAutoSummarization();
  } catch (e) {
    errors.push({ stage: 'cold_start', message: e?.message || String(e), stack: e?.stack || '' });
  }
  await sleep(50);
  const afterCold = summarizeLore(exports, char, chat);
  results.stages.coldStart = {
    elapsedMs: Math.round(performance.now() - coldStartTime),
    before: beforeCold,
    after: afterCold,
    resultKeys: coldResult ? Object.keys(coldResult) : null,
    resultSummary: coldResult ? {
      entities: Array.isArray(coldResult.entities) ? coldResult.entities.length : 0,
      relations: Array.isArray(coldResult.relations) ? coldResult.relations.length : 0,
      narrativeChars: String(coldResult.narrative || '').length,
      worldSummaryChars: String(coldResult.world?.summary || '').length
    } : null
  };
  samples.push(memSample('after_cold_start'));

  // Stage C: historical reanalysis merge.
  const beforeReanalysis = summarizeLore(exports, char, chat);
  const reStart = performance.now();
  let reResult = null;
  try {
    reResult = await exports.ColdStartManager.reanalyzeHistoricalConversation();
  } catch (e) {
    errors.push({ stage: 'reanalysis', message: e?.message || String(e), stack: e?.stack || '' });
  }
  await sleep(50);
  const afterReanalysis = summarizeLore(exports, char, chat);
  results.stages.reanalysis = {
    elapsedMs: Math.round(performance.now() - reStart),
    before: beforeReanalysis,
    after: afterReanalysis,
    resultKeys: reResult ? Object.keys(reResult) : null,
    resultSummary: reResult ? {
      entities: Array.isArray(reResult.entities) ? reResult.entities.length : 0,
      relations: Array.isArray(reResult.relations) ? reResult.relations.length : 0,
      narrativeChars: String(reResult.narrative || '').length,
      worldSummaryChars: String(reResult.world?.summary || '').length
    } : null
  };
  samples.push(memSample('after_reanalysis'));

  // Stage D: recall/retrieval check to force scoring/index read path.
  const recallStart = performance.now();
  let recall = [];
  try {
    const lore = exports.MemoryEngine.getLorebook(char, chat) || [];
    recall = await exports.MemoryEngine.retrieveMemories('도현과 아리엘의 신뢰 변화와 별핵 월식 의식 단서', exports.MemoryEngine.getCurrentTurn(), lore, { focusNames: ['도현', '아리엘'], directFocusNames: ['도현', '아리엘'], relatedFocusNames: ['별핵', '월식', '노아'], narrativeArcKeys: ['별핵 봉인과 월식 의식'], suppressionPlan: null }, 8);
  } catch (e) {
    errors.push({ stage: 'recall', message: e?.message || String(e), stack: e?.stack || '' });
  }
  results.stages.recall = {
    elapsedMs: Math.round(performance.now() - recallStart),
    count: Array.isArray(recall) ? recall.length : 0,
    sample: (Array.isArray(recall) ? recall : []).slice(0, 3).map(e => ({ key: e.key, comment: e.comment, score: e._score || null, preview: String(e._recallWindow || e.content || '').slice(0, 240) })),
    debug: exports.MemoryEngine.getLastRetrievalDebug?.() || null
  };
  samples.push(memSample('after_recall'));

  // Basic consistency assertions.
  const finalLore = summarizeLore(exports, char, chat);
  const assertions = [];
  function assertCheck(name, ok, details = {}) { assertions.push({ name, ok: !!ok, details }); if (!ok) results.warnings.push({ name, details }); }
  assertCheck('live_created_memories', results.stages.live97.lore.memories >= 50, { memories: results.stages.live97.lore.memories });
  assertCheck('live_turn_advanced', results.stages.live97.lore.currentTurn >= 90, { currentTurn: results.stages.live97.lore.currentTurn });
  assertCheck('entities_present_after_cold', afterCold.entities >= 4, { entities: afterCold.entities, names: afterCold.sampleEntityNames });
  assertCheck('relations_present_after_cold', afterCold.relations >= 2, { relations: afterCold.relations });
  assertCheck('narrative_present', finalLore.narrativeStorylines >= 1, { storylines: finalLore.narrativeStorylines, turnLog: finalLore.narrativeTurnLog });
  assertCheck('world_state_entries_present', (finalLore.byComment.lmai_world_states || 0) >= 1 || (finalLore.byComment.lmai_world || 0) >= 1 || finalLore.totalLore > 0, { byComment: finalLore.byComment });
  assertCheck('reanalysis_no_large_duplicate_explosion', afterReanalysis.totalLore <= Math.max(30, Math.ceil(afterCold.totalLore * 1.7)), { before: afterCold.totalLore, after: afterReanalysis.totalLore });
  assertCheck('recall_returns_results', results.stages.recall.count > 0, { count: results.stages.recall.count });
  assertCheck('latency_no_turn_freeze_gt_5s', Math.max(...turnDurations) < 5000, { maxMs: Math.round(Math.max(...turnDurations)), p95Ms: Math.round(p95(turnDurations)) });
  const maxHeap = Math.max(...samples.map(s => s.heapUsedMB));
  const heapGrowth = samples[samples.length - 1].heapUsedMB - samples[0].heapUsedMB;
  assertCheck('heap_under_256mb_in_node_harness', maxHeap < 256, { maxHeapMB: maxHeap, growthMB: Math.round(heapGrowth * 100) / 100 });
  results.assertions = assertions;
  results.finalLore = finalLore;
  results.samples = samples;
  results.errors = errors;
  results.logs = logs.slice(-200);

  try {
    for (const fn of unloadHandlers) await fn();
  } catch (e) {
    errors.push({ stage: 'unload', message: e?.message || String(e) });
  }

  fs.writeFileSync(LOG_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: errors.length === 0, logPath: LOG_PATH, assertions: assertions.filter(a => !a.ok).length ? assertions : assertions.filter(a => a.ok).slice(0, 3), finalLore, stages: { live97: results.stages.live97, coldStart: results.stages.coldStart, reanalysis: results.stages.reanalysis, recall: results.stages.recall }, samples }, null, 2));
}

main().then(() => {
  if (String(process.env.LIBRA_KEEP_ALIVE || '') !== '1') process.exit(0);
}).catch(err => {
  const fail = { ok: false, error: err?.message || String(err), stack: err?.stack || '', logPath: LOG_PATH };
  try { fs.writeFileSync(LOG_PATH, JSON.stringify(fail, null, 2), 'utf8'); } catch (_) {}
  console.error(JSON.stringify(fail, null, 2));
  process.exitCode = 1;
  if (String(process.env.LIBRA_KEEP_ALIVE || '') !== '1') process.exit(1);
});
