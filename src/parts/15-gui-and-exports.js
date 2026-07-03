// ══════════════════════════════════════════════════════════════
// [GUI] LIBRA World Manager UI (V1.1 Rendering Method Applied)
// ══════════════════════════════════════════════════════════════
const LMAI_GUI = (() => {
    const GUI_CSS = `/* ============================================================
   LIBRA World Manager — redesign mockup
   구조/기능 유지 계약:
   - 모든 id 속성은 실제 플러그인 JS(overlay.querySelector)가
     그대로 바인딩할 수 있도록 원본과 100% 동일하게 유지했습니다.
   - 기능에 쓰이는 class(panel, tb, on, act-*, rC-val,
     source-module-check, is-ok/is-failed/is-running/is-disabled)와
     data-vertex-json-* 속성도 원본 그대로 유지했습니다.
   - 순수 스타일용 class/마크업 구조는 자유롭게 재구성했습니다.
   ============================================================ */
*{box-sizing:border-box;margin:0;padding:0}
:root{
  /* Risu 테마 변수를 우선 따르되, 폴백값을 "카드 카탈로그 / 필드 기록부" 톤으로 재설계 */
  --bg:        var(--risu-theme-bgcolor, #0c1013);
  --bg2:       var(--risu-theme-darkbg, #12171b);
  --bg3:       var(--risu-theme-selected, #1a2227);
  --bg4:       #212b31;
  --accent:    var(--risu-theme-primary-600, var(--risu-theme-borderc, #c9a15a));
  --accent2:   var(--risu-theme-secondary-500, var(--risu-theme-borderc, #e0bd7c));
  --accent-ink:#3a2f16;
  --text:      var(--risu-theme-textcolor, #ece6d6);
  --text2:     var(--risu-theme-textcolor2, #98a3a6);
  --text3:     #667075;
  --border:    var(--risu-theme-borderc, #283136);
  --line:      var(--border);
  --success:   var(--risu-theme-success-500, #5c9d6e);
  --danger:    var(--risu-theme-danger-500, #b5584c);
  --teal:      #4f8f95;
  --violet:    #8079ab;
  --radius:    7px;
  --radius-lg: 12px;
  --fs-body:   13px;
  --fs-label:  12px;
  --fs-small:  10.5px;
  --fs-title:  14px;
  --lh-ui:     1.5;
  --serif:     Georgia, 'Noto Serif KR', 'Nanum Myeongjo', serif;
  --mono:      ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans:      var(--risu-font-family, -apple-system, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif);
}
.demo-frame{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px}

/* ---------- overlay shell ---------- */
.lmai-overlay{position:fixed;inset:0;padding:18px;background:color-mix(in srgb,var(--risu-theme-darkbg,#05070a) 72%, transparent);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:var(--sans);font-size:var(--fs-body);line-height:var(--lh-ui);color:var(--text);overflow:auto}
.lmai-overlay [data-libra-gui-backdrop="true"]{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.gui-wrap{position:relative;width:100%;max-width:1160px;height:min(92dvh,900px);max-height:calc(100dvh - 32px);background:var(--bg);border:1px solid color-mix(in srgb,var(--border) 70%, transparent);border-radius:var(--radius-lg);box-shadow:0 20px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.02) inset;color:var(--text);font-size:var(--fs-body);line-height:var(--lh-ui);overflow:hidden;display:grid;grid-template-columns:76px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}

/* ---------- top strip (title + close) ---------- */
.hdr{grid-column:1/3;grid-row:1;display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;border-bottom:1px solid var(--border);background:linear-gradient(180deg, var(--bg2), var(--bg));}
.hdr .brand{display:flex;align-items:baseline;gap:9px}
.hdr .brand .mark{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--accent);
  border:1px solid color-mix(in srgb,var(--accent) 45%, transparent);border-radius:4px;padding:2px 6px;text-transform:uppercase}
.hdr h1{font-family:var(--serif);font-size:17px;font-weight:600;letter-spacing:.2px}
.hdr .ver{font-family:var(--mono);font-size:10px;color:var(--text3);margin-left:6px}
.hdr .sub{font-size:var(--fs-small);color:var(--text3);margin-top:1px}
.xbtn{background:transparent;border:1px solid var(--border);color:var(--text2);cursor:pointer;
  font-size:14px;line-height:1;width:30px;height:30px;border-radius:8px;transition:all .15s;display:flex;align-items:center;justify-content:center}
.xbtn:hover{background:var(--danger);border-color:var(--danger);color:#fff}

/* ---------- left rail (index-tab style nav) ---------- */
.tabs{grid-column:1;grid-row:2;display:flex;flex-direction:column;align-items:stretch;
  border-right:1px solid var(--border);background:var(--bg2);padding:10px 0;gap:2px;overflow-y:auto}
.tb{appearance:none;background:transparent;border:none;color:var(--text3);cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 4px 11px;
  font-size:10.5px;font-family:var(--sans);line-height:1.25;position:relative;transition:color .15s,background .15s}
.tb .ic{font-size:17px;line-height:1}
.tb:hover{color:var(--text)}
.tb.on{color:var(--text);background:color-mix(in srgb, var(--accent) 12%, transparent)}
.tb.on::before{content:'';position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)}

/* ---------- content ---------- */
.content{grid-column:2;grid-row:2;overflow:hidden;min-height:0;position:relative}
.panel{display:none;height:100%;overflow-y:auto;padding:18px 20px 90px;min-height:0}
.panel.on{display:block}

.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
input,select,textarea{background:var(--bg2);border:1px solid var(--border);color:var(--text);
  padding:7px 10px;border-radius:var(--radius);font-size:var(--fs-body);line-height:var(--lh-ui);
  outline:none;transition:border-color .15s,box-shadow .15s;font-family:var(--sans)}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)}
.si{flex:1;min-width:180px}
.stat{font-size:var(--fs-label);color:var(--text2);white-space:nowrap;font-family:var(--mono)}
.stat strong{color:var(--accent2);font-weight:600}

.btn{padding:7px 12px;border:none;border-radius:var(--radius);font-size:var(--fs-label);
  cursor:pointer;transition:all .15s;min-height:32px;font-family:var(--sans);font-weight:500;letter-spacing:.1px}
.bp{background:var(--accent);color:#1b1607}.bp:hover{filter:brightness(1.1)}
.bs{background:var(--bg4);color:var(--text);border:1px solid var(--border)}.bs:hover{border-color:var(--accent)}
.bd{background:transparent;border:1px solid var(--danger);color:var(--danger)}.bd:hover{background:var(--danger);color:#fff}

/* section eyebrow / divider */
.sec{font-family:var(--mono);font-size:10px;font-weight:600;color:var(--accent);
  text-transform:uppercase;letter-spacing:.16em;margin:20px 0 9px;padding-bottom:6px;
  border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.sec:first-child{margin-top:0}
.sec::before{content:'';width:5px;height:5px;border-radius:1px;background:var(--accent);display:inline-block;transform:rotate(45deg)}

/* ---------- index-card list (memory/entity/relation/narrative) ---------- */
.list{display:flex;flex-direction:column;gap:8px}
.card{background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--stub, var(--accent));
  border-radius:var(--radius);padding:12px 13px;transition:border-color .15s,transform .1s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 55%, var(--border))}
.card.mem{--stub:var(--accent)}
.card.ent{--stub:var(--teal)}
.card.rel{--stub:var(--violet)}
.card.nar{--stub:var(--violet)}
.card-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px}
.card-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px}
.card-title{font-weight:600;font-size:var(--fs-body)}
.card-.hint{margin-top:7px;font-size:var(--fs-label);color:var(--text3)}
.empty{padding:26px 10px;text-align:center;color:var(--text3);font-size:var(--fs-label);border:1px dashed var(--border);border-radius:var(--radius)}

.bdg{font-family:var(--mono);font-size:9.5px;padding:2px 6px;border-radius:4px;font-weight:600;white-space:nowrap;letter-spacing:.03em}
.bh{background:color-mix(in srgb, var(--success) 22%, transparent);color:#8fd39f}
.bm{background:color-mix(in srgb, var(--accent) 22%, transparent);color:var(--accent2)}
.bl{background:var(--bg4);color:var(--text3)}
.bt{background:var(--bg4);color:var(--text2);border:1px solid var(--border)}
.acts{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap}
.acts .btn{padding:5px 9px;min-height:26px;font-size:10.5px}

/* add-form drawer */
.add-form{display:none;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-lg);
  padding:14px;margin-bottom:14px}
.add-form.on{display:block;animation:drop .15s ease}
@keyframes drop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.fld{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.fld label{font-size:var(--fs-label);color:var(--text2)}
.fld input,.fld select,.fld textarea{width:100%}
.ef{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ec{resize:vertical}

.entity-band{border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--bg2)}
.entity-band-title{font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;
  letter-spacing:.12em;margin-bottom:9px}
.entity-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.entity-wide{grid-column:1/3}
.entity-state-log{grid-column:1/3;border:1px solid color-mix(in srgb,var(--border) 70%, transparent);
  border-radius:var(--radius);background:var(--bg);overflow:hidden}
.entity-state-log summary{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;
  list-style:none;padding:8px 10px;font-family:var(--mono);font-size:10px;color:var(--text2);user-select:none}
.entity-state-log summary::-webkit-details-marker{display:none}
.entity-state-log summary::before{content:'▶';font-size:9px;color:var(--text3);transition:transform .16s}
.entity-state-log[open] summary::before{transform:rotate(90deg);color:var(--accent)}
.entity-state-log-title{display:flex;align-items:center;gap:7px;min-width:0}
.entity-state-log-body{border-top:1px solid var(--border);max-height:184px;overflow-y:auto;padding:8px 10px;
  display:flex;flex-direction:column;gap:6px}
.entity-state-row{border:1px solid color-mix(in srgb,var(--border) 60%, transparent);border-radius:var(--radius);
  padding:7px 8px;background:var(--bg2)}
.entity-state-row-head{display:flex;align-items:center;gap:7px;margin-bottom:4px;flex-wrap:wrap}
.entity-state-turn{font-family:var(--mono);font-size:10px;color:var(--accent2)}
.entity-state-source{font-family:var(--mono);font-size:9px;color:var(--text3)}
.entity-state-summary{font-size:var(--fs-label);line-height:1.55;color:var(--text);word-break:break-word}
.entity-state-meta{margin-top:4px;font-size:var(--fs-small);line-height:1.45;color:var(--text2);word-break:break-word}
.entity-state-empty{font-size:var(--fs-label);color:var(--text3);padding:10px;text-align:center}

.rw{display:flex;align-items:center;gap:9px}
.rw input[type=range]{flex:1;accent-color:var(--accent)}
.rv{font-family:var(--mono);font-size:var(--fs-label);color:var(--text2);min-width:34px;text-align:right}

.tr{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
.tr:last-child{border-bottom:none}
.tr label{font-size:var(--fs-body)}
.tog{position:relative;display:inline-flex;width:36px;height:20px;flex:0 0 36px}
.tog input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer;z-index:2}
.tsl{position:absolute;inset:0;background:var(--bg4);border:1px solid var(--border);border-radius:999px;transition:background .15s}
.tsl::before{content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;background:var(--text2);
  border-radius:50%;transition:transform .15s}
.tog input:checked+.tsl{background:color-mix(in srgb, var(--accent) 55%, var(--bg4));border-color:var(--accent)}
.tog input:checked+.tsl::before{transform:translateX(16px);background:#1b1607}

/* ---------- world tree text block ---------- */
.wt{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px;color:var(--text2);font-size:var(--fs-label);min-height:38px;white-space:pre-wrap;line-height:1.6}
.sbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.inline-actions{margin-bottom:4px}

/* ---------- accordion (world sub-structure + settings) ---------- */
.acc{border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:10px;background:var(--bg2)}
.acc-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;cursor:pointer;
  user-select:none;transition:background .15s}
.acc-h:hover{background:var(--bg3)}
.acc-h .ttl{display:flex;align-items:center;gap:9px;font-family:var(--serif);font-size:14px;font-weight:600}
.acc-h .idx{font-family:var(--mono);font-size:10px;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 45%, transparent);
  border-radius:4px;padding:1px 6px}
.acc-h .chev{color:var(--text3);transition:transform .18s;font-size:11px}
.acc.open .acc-h .chev{transform:rotate(90deg);color:var(--accent)}
.acc-b{display:none;padding:4px 14px 16px;border-top:1px solid var(--border)}
.acc.open .acc-b{display:block}
.acc-hint{font-size:var(--fs-small);color:var(--text3);padding:0 14px 12px;margin-top:-4px}

.settings-subblock{border:1px solid color-mix(in srgb,var(--border) 75%, transparent);border-radius:var(--radius);
  padding:11px;background:var(--bg);margin-top:12px}
.settings-subblock:first-of-type{margin-top:4px}
.settings-subtitle{font-family:var(--mono);font-size:10px;font-weight:600;color:var(--text3);
  text-transform:uppercase;letter-spacing:.12em;margin-bottom:9px}
.setting-note{font-size:var(--fs-small);color:var(--text3);margin-top:5px;line-height:1.5}
.settings-note-line{font-size:var(--fs-small);color:var(--text3);margin-top:6px;font-family:var(--mono)}
.settings-2col{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.field-wide{grid-column:1/3}

.vertex-json-tools{border:1px dashed var(--border);border-radius:var(--radius);padding:10px;margin:8px 0 10px;background:var(--bg)}
.vertex-json-tools[hidden]{display:none}
.vertex-json-actions{margin:6px 0 4px}
.vertex-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}

.llm-test-toolbar{margin-top:6px}
.llm-test-status.is-ok{color:#8fd39f}
.llm-test-status.is-failed{color:var(--danger)}
.llm-test-status.is-running{color:var(--accent2)}
.llm-test-status.is-disabled{color:var(--text3)}

.source-module-tools{display:flex;gap:7px;flex-wrap:wrap;margin:6px 0}
.source-module-list{display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto;
  border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--bg)}

.cs{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px}
.ci{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:9px 10px;
  font-family:var(--mono);font-size:11px;color:var(--text2)}

.settings-actions{padding-top:14px;border-top:1px solid var(--border);margin-top:6px}

.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);
  background:var(--bg4);border:1px solid var(--accent);color:var(--text);padding:9px 16px;
  border-radius:8px;font-size:var(--fs-label);opacity:0;pointer-events:none;transition:all .2s;z-index:50}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:5px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:var(--text3)}

.note-banner{grid-column:1/3;background:var(--accent-ink);color:var(--accent2);font-family:var(--mono);
  font-size:10.5px;padding:6px 16px;border-bottom:1px solid var(--border);display:none}

/* Plugin-host compatibility and dynamic row states. */
.card.mem{--stub:var(--accent)}
.card.ent{--stub:var(--teal)}
.card.rel,.card.nar{--stub:var(--violet)}
.card{border-left:3px solid var(--stub,var(--accent))}
.card.mem .mt-val{display:block;width:100%;min-height:118px;margin-top:8px;font-family:var(--mono);font-size:12px;line-height:1.55;resize:vertical}
.card.mem .mi-val{width:70px}
.memory-importance-row{display:flex;gap:8px;align-items:center;margin-top:8px}
.rel-score-head{display:flex;align-items:center;justify-content:space-between;gap:6px}
.rel-score-head label{margin:0}
.rel-score-tools{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.rel-define{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0 8px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--border) 65%, transparent);border-radius:var(--radius);background:color-mix(in srgb,var(--bg) 60%, transparent)}
.rel-define-main{font-size:var(--fs-label);font-weight:700;color:var(--text)}
.rel-define-note{font-size:var(--fs-small);color:var(--text2);line-height:var(--lh-ui)}
.rw input[type=range][data-unset="1"]{opacity:.45;accent-color:var(--border)}
.source-module-item{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:8px;border:1px solid color-mix(in srgb,var(--border) 70%, transparent);border-radius:8px;background:color-mix(in srgb,var(--bg2) 74%, transparent)}
.source-module-item.is-on{border-color:color-mix(in srgb,var(--accent) 70%, transparent);background:color-mix(in srgb,var(--accent) 14%, var(--bg2))}
.source-module-item.is-disabled,.source-module-list.is-disabled{opacity:.55}
.source-module-main{min-width:0;flex:1}
.source-module-name{font-size:var(--fs-label);line-height:var(--lh-ui);font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.source-module-meta{font-size:var(--fs-label);color:var(--text2);line-height:var(--lh-ui);margin-top:2px;word-break:break-word}
.source-module-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
.source-module-badge{font-size:var(--fs-small);line-height:var(--lh-ui);padding:2px 6px;border-radius:999px;background:var(--bg3);color:var(--text2);border:1px solid color-mix(in srgb,var(--border) 70%, transparent)}
.source-module-badge.ok{color:#fff;background:color-mix(in srgb,var(--success) 70%, var(--bg3));border-color:color-mix(in srgb,var(--success) 70%, transparent)}
.source-module-badge.off{color:var(--text2)}
.ec{resize:vertical}
.hdr .sub{font-size:var(--fs-small);color:var(--text3);margin-top:1px}
@media(max-width:780px){
  .lmai-overlay{padding:0;align-items:stretch;justify-content:stretch}
  .lmai-overlay [data-libra-gui-backdrop="true"]{align-items:stretch;justify-content:stretch}
  .gui-wrap{width:100%;max-width:100%;height:100dvh;max-height:100dvh;border-radius:0;grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}
  .hdr{grid-column:1;grid-row:1;padding:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px}
  .hdr h1{font-size:15px}
  .hdr .sub{grid-column:1}
  .xbtn{grid-column:2;grid-row:1 / 3}
  .tabs{grid-column:1;grid-row:2;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-right:0;border-bottom:1px solid var(--border);padding:6px;background:var(--bg2);overflow-x:auto}
  .tb{padding:7px 3px;font-size:10px;border-radius:var(--radius);min-width:48px}
  .tb.on::before{left:8px;right:8px;top:auto;bottom:0;width:auto;height:2px;border-radius:2px}
  .content{grid-column:1;grid-row:3}
  .panel{padding:12px 10px 84px}
  .ef,.entity-grid,.settings-2col,.vertex-preview-grid{grid-template-columns:1fr}
  .entity-wide,.field-wide{grid-column:1}
  .toolbar{display:grid;grid-template-columns:1fr 1fr;align-items:stretch}
  .toolbar .si,.toolbar .stat{grid-column:1 / -1}
  .toolbar .btn,.toolbar select,.toolbar input{width:100%}
  .card-hdr{flex-direction:column;align-items:stretch}
  .acts{width:100%;justify-content:flex-end}
}
@media(max-width:480px){
  .tabs{grid-template-columns:repeat(5,minmax(48px,1fr))}
  .toolbar{grid-template-columns:1fr}
  .toolbar .si,.toolbar .stat{grid-column:auto}
  .acts{justify-content:stretch}
  .acts .btn{flex:1 1 100%}
}
`;

    const GUI_BODY = `
<div class="gui-wrap">
<div class="hdr">
  <div>
    <div class="brand"><span class="mark">LIBRA</span><h1>World Manager <span class="ver">V5.3.1</span></h1></div>
    <div class="sub">RP 장기 기억 · 세계관 · 엔티티 관리 콘솔</div>
  </div>
  <button class="xbtn" id="xbtn" title="닫기">✕</button>
</div>
  <div class="tabs" aria-label="LIBRA GUI tabs">
    <button class="tb on" data-tab="memory"><span class="ic">📚</span><span>메모리</span></button>
    <button class="tb" data-tab="entity"><span class="ic">👤</span><span>엔티티</span></button>
    <button class="tb" data-tab="narrative"><span class="ic">🧵</span><span>내러티브</span></button>
    <button class="tb" data-tab="world"><span class="ic">🌍</span><span>세계관</span></button>
    <button class="tb" data-tab="settings"><span class="ic">⚙</span><span>설정</span></button>
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
      <div class="entity-band" style="margin-top:0">
        <div class="entity-band-title">기본 정본 카드</div>
        <div class="fld"><label>이름</label><input type="text" id="ae-name" placeholder="캐릭터 이름"></div>
        <div class="entity-grid">
          <div class="fld entity-wide"><label>역할</label><input type="text" id="ae-role" placeholder="서사 역할"></div>
          <div class="fld entity-wide"><label>외모 특징 (쉼표 구분)</label><input type="text" id="ae-feat" placeholder="검은 머리, 키 큰"></div>
          <div class="fld entity-wide"><label>성격 특성 (쉼표 구분)</label><input type="text" id="ae-trait" placeholder="친절한, 용감한"></div>
          <div class="fld entity-wide"><label>배경</label><textarea id="ae-bg" rows="3" class="ec" placeholder="근거 있는 배경만 입력"></textarea></div>
          <div class="fld entity-wide"><label>현재 상태</label><textarea id="ae-current-state" rows="3" class="ec" placeholder="현재 장면에서의 상태"></textarea></div>
          <div class="fld entity-wide"><label>말투 단서 (쉼표 구분)</label><input type="text" id="ae-speech-notes" placeholder="짧게 말함, 존칭 사용"></div>
          <div class="fld entity-wide"><label>심리</label><input type="text" id="ae-psychology" placeholder="심리 기준선 또는 현재 갈등"></div>
          <div class="fld entity-wide"><label>열린 떡밥 (줄바꿈 구분)</label><textarea id="ae-open-threads" rows="3" class="ec" placeholder="아직 해결되지 않은 인물 관련 흐름"></textarea></div>
        </div>
      </div>
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
        <div class="fld"><label>관계 수치</label><div class="tr"><label>직접 지정</label><label class="tog"><input type="checkbox" id="ar-score-enabled"><span class="tsl"></span></label></div><div class="hint">끄면 첫 대면 · 정의 보류로 저장됩니다.</div></div>
      </div>
      <div class="ef" id="ar-score-wrap">
        <div class="fld"><label>친밀도</label><div class="rw"><input type="range" id="ar-cls" min="0" max="100" value="10" disabled><span id="ar-clsv" class="rv">미정</span></div></div>
        <div class="fld"><label>신뢰도</label><div class="rw"><input type="range" id="ar-trs" min="0" max="100" value="10" disabled><span id="ar-trsv" class="rv">미정</span></div></div>
      </div>
      <div class="ef">
        <div class="fld"><label>감정 (A→B)</label><input type="text" id="ar-sent" placeholder="호감, 경계 등"></div>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bs" id="btn-add-rel">추가</button>
        <button class="btn bd" id="btn-cancel-rel">취소</button>
      </div>
    </div>
    <div class="sec">⛔ 엔티티 차단 리스트</div>
    <div class="toolbar">
      <input type="text" id="entity-block-input" class="si" placeholder="차단할 엔티티 이름">
      <button class="btn bs" id="btn-add-entity-block">⛔ 차단 추가</button>
    </div>
    <div id="entity-block-list" class="list"></div>
    <div class="sec">👥 인물 목록</div>
    <div id="el" class="list"></div>
    <div class="sec">🤝 관계 목록</div>
    <div id="rl" class="list"></div>
  </div>
  <div id="tab-narrative" class="panel">
    <div class="toolbar">
      <span class="stat">총 <strong id="nc">0</strong>개 스토리라인</span>
      <button class="btn bs" id="btn-add-narrative">➕ 스토리라인 추가</button>
      <button class="btn bp" id="btn-save-narrative">💾 내러티브 저장</button>
    </div>
    <div id="narrative-list" class="list"></div>
  </div>
  <div id="tab-world" class="panel">
    <div class="sec">🗺 세계관 트리</div>
    <div id="wt" class="wt"></div>
    <div class="sec">🌐 전역 세계 특성</div>
    <div id="world-global-features" class="wt" style="font-size:var(--fs-body)"></div>
    <div class="sec">📋 현재 세계 규칙</div>
    <div id="wr" class="wt" style="font-size:var(--fs-body)"></div>
    <div class="sec">🧱 세계관 정본 필드</div>
    <div class="entity-band" style="margin-top:0">
      <div class="entity-band-title">영구 세계 구조</div>
      <div class="entity-grid">
        <div class="fld"><label>세계 이름</label><input type="text" id="world-node-name" placeholder="주요 세계"></div>
        <div class="fld"><label>세계 분류</label><input type="text" id="world-classification" placeholder="현대 현실, 현대 판타지, 아카데미 등"></div>
        <div class="fld entity-wide"><label>세계 요약</label><textarea id="world-summary" class="ec" rows="3" placeholder="이 세계의 안정적인 배경 요약"></textarea></div>
        <div class="fld"><label>시대·기술 수준</label><input type="text" id="world-tech" placeholder="modern, medieval, futuristic, unknown"></div>
        <div class="fld"><label>마법</label><select id="world-magic"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>기/무공</label><select id="world-ki"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>초자연</label><select id="world-supernatural"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>레벨</label><select id="world-system-leveling"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>스킬</label><select id="world-system-skills"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>스탯</label><select id="world-system-stats"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>직업/클래스</label><select id="world-system-classes"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>길드</label><select id="world-system-guilds"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>세력</label><select id="world-system-factions"><option value="">불명</option><option value="true">있음</option><option value="false">없음</option></select></div>
        <div class="fld"><label>중력</label><input type="text" id="world-gravity" placeholder="normal"></div>
        <div class="fld"><label>시간 흐름</label><input type="text" id="world-time-flow" placeholder="linear"></div>
        <div class="fld"><label>공간</label><input type="text" id="world-space" placeholder="three_dimensional"></div>
        <div class="fld entity-wide"><label>주요 장소·시설 (줄바꿈 구분)</label><textarea id="world-places" class="ec" rows="3"></textarea></div>
        <div class="fld entity-wide"><label>조직·권력 구조 (줄바꿈 구분)</label><textarea id="world-organizations" class="ec" rows="3"></textarea></div>
        <div class="fld entity-wide"><label>사회·문화 규칙 (줄바꿈 구분)</label><textarea id="world-social-rules" class="ec" rows="4"></textarea></div>
        <div class="fld entity-wide"><label>신화적 존재 (줄바꿈 구분)</label><textarea id="world-mythical" class="ec" rows="2"></textarea></div>
        <div class="fld entity-wide"><label>비인간 종족 (줄바꿈 구분)</label><textarea id="world-races" class="ec" rows="2"></textarea></div>
        <div class="fld entity-wide"><label>특수 현상 (줄바꿈 구분)</label><textarea id="world-phenomena" class="ec" rows="3"></textarea></div>
        <div class="fld entity-wide"><label>추가 규칙 (줄바꿈 구분)</label><textarea id="world-custom-rules" class="ec" rows="4"></textarea></div>
      </div>
    </div>
    <div class="sbar inline-actions"><button class="btn bs" id="btn-save-world-fields">💾 세계관 필드 저장</button></div>
    <div class="sec">🧭 현재 세계 상태 로그</div>
    <div id="world-state-log" class="wt" style="font-size:var(--fs-body)"></div>
    <div class="sec">🌐 세계관 코덱스 상태</div>
    <div id="world-codex-status" class="wt" style="font-size:var(--fs-body)"></div>
    <div class="sec">✍ 수동 세계관 보정</div>
    <div class="fld">
      <label>잘못 기록된 세계관을 직접 고치기</label>
      <textarea id="world-user-correction" class="ec" rows="5" placeholder="예: 이 세계는 현대물이 아니라 현대 판타지다. 마법은 공개되지 않았고, 시스템창은 실제가 아니라 연출이다."></textarea>
    </div>
    <div class="sbar inline-actions"><button class="btn bs" id="btn-save-world-correction">💾 세계관 보정 저장</button></div>
    <div class="sec">🧭 현재 장면용 세계관 보정</div>
    <div id="world-lens-meta" class="wt" style="font-size:var(--fs-body)"></div>
    <div class="fld">
      <label>현재 구조에서 선택·압축한 장면용 세계관 보정 프롬프트</label>
      <textarea id="world-lens-prompt" class="ec" rows="10" readonly placeholder="아직 생성된 장면용 세계관 보정이 없습니다."></textarea>
    </div>
  </div>
  <div id="tab-settings" class="panel">
    <div class="sgrid">
      <div class="ss">
        <h3>🤖 LLM 설정</h3>
        <div class="fld"><label>Provider</label><select id="slp"><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="lmstudio">LM Studio</option><option value="ollama">Ollama(local)</option><option value="ollama_cloud">Ollama Cloud</option><option value="nanogpt">NanoGPT</option><option value="vertex">Vertex Gemini</option><option value="vertex-openai">Vertex OpenAI</option><option value="copilot">Copilot</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="slu" placeholder="https://api.openai.com/v1/chat/completions"></div>
        <div class="fld"><label>API Key / Vertex JSON</label><input type="password" id="slk" placeholder="sk-... 또는 Vertex service account JSON"></div>
        <div class="vertex-json-tools" data-vertex-json-slot="llm" hidden>
          <label class="fld"><span>Vertex 서비스 계정 JSON 파일</span><input type="file" accept=".json,application/json" data-vertex-json-file="llm"><small>JSON 파일을 선택하면 URL과 인증 JSON을 자동으로 채웁니다. 저장 전까지는 설정에 반영되지 않습니다.</small></label>
          <label class="fld"><span>Vertex 서비스 계정 JSON 붙여넣기</span><textarea data-vertex-json-paste="llm" spellcheck="false" placeholder='{&quot;type&quot;:&quot;service_account&quot;,&quot;project_id&quot;:&quot;my-project&quot;}'></textarea></label>
          <div class="vertex-json-actions"><button class="btn bs" type="button" data-vertex-json-apply="llm">JSON 적용</button></div>
          <div class="vertex-preview-grid">
            <label class="fld"><span>Project ID</span><input type="text" readonly data-vertex-json-preview="llm:project_id" placeholder="my-gcp-project"></label>
            <label class="fld"><span>Client Email</span><input type="text" readonly data-vertex-json-preview="llm:client_email" placeholder="service-account@project.iam.gserviceaccount.com"></label>
            <label class="fld field-wide"><span>Private Key Preview</span><textarea readonly rows="2" data-vertex-json-preview="llm:private_key" spellcheck="false"></textarea></label>
          </div>
          <div class="settings-note-line" data-vertex-json-status="llm">Vertex provider를 선택하면 JSON 도구가 활성화됩니다.</div>
        </div>
        <div class="fld"><label>Model</label><input type="text" id="slm" list="slm-provider-models" placeholder="gpt-4o-mini"><datalist id="slm-provider-models"></datalist></div>
        <div class="fld"><label>Temperature</label><div class="rw"><input type="range" id="slt" min="0" max="1" step="0.1"><span id="sltv" class="rv">0.3</span></div></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="slto" placeholder="120000"></div>
        <div class="fld"><label>Reasoning Preset</label><select id="slrp"><option value="auto">자동 감지</option><option value="gpt">GPT</option><option value="gemini">Gemini</option><option value="claude">Claude</option><option value="deepseek">DeepSeek</option><option value="kimi">Kimi</option><option value="glm">GLM</option><option value="custom">커스텀</option></select></div>
        <div class="fld"><label>Reasoning Guide</label><div id="slrh" style="font-size:var(--fs-label);color:var(--text2);line-height:var(--lh-ui);padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,0.04)">모델 계열에 맞는 추론 설정을 자동 안내합니다.</div></div>
        <div class="fld" id="slre-wrap"><label>Reasoning Effort</label><select id="slre"><option value="none">사용 안 함</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        <div class="fld" id="slrb-wrap"><label>Reasoning Budget Tokens</label><input type="number" id="slrb" placeholder="16384"></div>
        <div class="fld" id="slgt-wrap"><label>GLM Thinking</label><select id="slgt"><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div>
        <div class="fld"><label>Max Completion Tokens</label><input type="number" id="slmc" placeholder="16000"></div>
        <div class="fld"><label>Service Tier</label><select id="slst"><option value="off">Off / Standard</option><option value="auto">auto</option><option value="default">default</option><option value="flex">flex</option><option value="priority">priority</option><option value="scale">scale</option></select><div class="setting-note">Flex routing이 켜진 경우 지원 provider에만 전달됩니다.</div></div>
        <div class="tr"><label>스트리밍 응답 집계</label><label class="tog"><input type="checkbox" id="slstream"><span class="tsl"></span></label></div>
        <div class="toolbar llm-test-toolbar"><button class="btn bs" id="btn-test-main-llm" type="button">메인 LLM 호출 테스트</button></div>
        <div class="settings-note-line llm-test-status" id="llm-test-status">테스트 대기 중</div>
      </div>
      <div class="ss">
        <h3>⚡ 보조 LLM 설정</h3>
        <div class="tr"><label>듀얼 LLM 사용</label><label class="tog"><input type="checkbox" id="sax"><span class="tsl"></span></label></div>
        <div class="fld"><label>Provider</label><select id="saxp"><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="lmstudio">LM Studio</option><option value="ollama">Ollama(local)</option><option value="ollama_cloud">Ollama Cloud</option><option value="nanogpt">NanoGPT</option><option value="vertex">Vertex Gemini</option><option value="vertex-openai">Vertex OpenAI</option><option value="copilot">Copilot</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="saxu" placeholder="비우면 메인 URL 폴백"></div>
        <div class="fld"><label>API Key / Vertex JSON</label><input type="password" id="saxk" placeholder="비우면 메인 LLM 사용 또는 Vertex service account JSON"></div>
        <div class="vertex-json-tools" data-vertex-json-slot="aux" hidden>
          <label class="fld"><span>AUX Vertex 서비스 계정 JSON 파일</span><input type="file" accept=".json,application/json" data-vertex-json-file="aux"><small>JSON 파일을 선택하면 AUX URL과 인증 JSON을 자동으로 채웁니다.</small></label>
          <label class="fld"><span>AUX Vertex 서비스 계정 JSON 붙여넣기</span><textarea data-vertex-json-paste="aux" spellcheck="false" placeholder='{&quot;type&quot;:&quot;service_account&quot;,&quot;project_id&quot;:&quot;my-project&quot;}'></textarea></label>
          <div class="vertex-json-actions"><button class="btn bs" type="button" data-vertex-json-apply="aux">JSON 적용</button></div>
          <div class="vertex-preview-grid">
            <label class="fld"><span>Project ID</span><input type="text" readonly data-vertex-json-preview="aux:project_id" placeholder="my-gcp-project"></label>
            <label class="fld"><span>Client Email</span><input type="text" readonly data-vertex-json-preview="aux:client_email" placeholder="service-account@project.iam.gserviceaccount.com"></label>
            <label class="fld field-wide"><span>Private Key Preview</span><textarea readonly rows="2" data-vertex-json-preview="aux:private_key" spellcheck="false"></textarea></label>
          </div>
          <div class="settings-note-line" data-vertex-json-status="aux">Vertex provider를 선택하면 JSON 도구가 활성화됩니다.</div>
        </div>
        <div class="fld"><label>Model</label><input type="text" id="saxm" list="saxm-provider-models" placeholder="gpt-4o-mini"><datalist id="saxm-provider-models"></datalist></div>
        <div class="fld"><label>Temperature</label><div class="rw"><input type="range" id="saxt" min="0" max="1" step="0.1"><span id="saxtv" class="rv">0.2</span></div></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="saxto" placeholder="90000"></div>
        <div class="fld"><label>Reasoning Preset</label><select id="saxrp"><option value="auto">자동 감지</option><option value="gpt">GPT</option><option value="gemini">Gemini</option><option value="claude">Claude</option><option value="deepseek">DeepSeek</option><option value="kimi">Kimi</option><option value="glm">GLM</option><option value="custom">커스텀</option></select></div>
        <div class="fld"><label>Reasoning Guide</label><div id="saxrh" style="font-size:var(--fs-label);color:var(--text2);line-height:var(--lh-ui);padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,0.04)">모델 계열에 맞는 추론 설정을 자동 안내합니다.</div></div>
        <div class="fld" id="saxre-wrap"><label>Reasoning Effort</label><select id="saxre"><option value="none">사용 안 함</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        <div class="fld" id="saxrb-wrap"><label>Reasoning Budget Tokens</label><input type="number" id="saxrb" placeholder="16384"></div>
        <div class="fld" id="saxgt-wrap"><label>GLM Thinking</label><select id="saxgt"><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div>
        <div class="fld"><label>Max Completion Tokens</label><input type="number" id="saxmc" placeholder="12000"></div>
        <div class="fld"><label>Service Tier</label><select id="saxst"><option value="off">Off / Standard</option><option value="auto">auto</option><option value="default">default</option><option value="flex">flex</option><option value="priority">priority</option><option value="scale">scale</option></select></div>
        <div class="tr"><label>AUX 스트리밍 응답 집계</label><label class="tog"><input type="checkbox" id="saxstream"><span class="tsl"></span></label></div>
        <div class="toolbar llm-test-toolbar"><button class="btn bs" id="btn-test-aux-llm" type="button">보조 LLM 호출 테스트</button></div>
        <div class="settings-note-line llm-test-status" id="aux-llm-test-status">테스트 대기 중</div>
      </div>
      <div class="ss">
        <h3>💸 Flex / Service Tier</h3>
        <div class="setting-note">Flex는 지연을 감수하는 저비용 tier입니다. 기본값은 꺼짐이며, 콜드 스타트·재분석·소스 반영 같은 백그라운드 작업에만 쓰는 것을 권장합니다.</div>
        <div class="fld"><label>Flex Routing</label><select id="sfrm"><option value="off">Off</option><option value="background">Background only</option><option value="all">All supported LLM calls</option></select></div>
        <div class="fld"><label>Flex Timeout (ms)</label><input type="number" id="sfto" min="60000" max="1800000" placeholder="600000"></div>
        <div class="tr"><label>429/503/timeout 시 Standard 1회 fallback</label><label class="tog"><input type="checkbox" id="sffb"><span class="tsl"></span></label></div>
        <div class="fld"><label>Vertex Flex Mode</label><select id="svfm"><option value="provisioned_then_flex">Provisioned 우선, Flex fallback</option><option value="flex_only">Flex only</option></select></div>
        <div class="tr"><label>Custom provider에 service_tier 전달</label><label class="tog"><input type="checkbox" id="scstp"><span class="tsl"></span></label></div>
      </div>
      <div class="ss">
        <h3>🌉 Hosting Bridge</h3>
        <div class="fld"><label>Mode</label><select id="sbhm"><option value="off">Off</option><option value="auto">Auto</option><option value="hosted">Hosted</option></select></div>
        <div class="fld"><label>Backend URL</label><input type="text" id="sbhu" placeholder="https://xxxx.trycloudflare.com"></div>
        <div class="fld"><label>Backend Token</label><input type="password" id="sbht" placeholder="x-libra-backend-token"></div>
        <div class="toolbar llm-test-toolbar"><button class="btn bs" id="btn-detect-hosting-bridge" type="button">자동 감지</button><button class="btn bs" id="btn-test-hosting-bridge" type="button">연결 테스트</button></div>
        <div class="settings-note-line llm-test-status" id="hosting-bridge-status">브릿지 대기 중</div>
      </div>
      <div class="ss">
        <h3>🧠 Embedding 설정</h3>
        <div class="fld"><label>Provider</label><select id="sep"><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="gemini-embedding">Gemini Embedding</option><option value="lmstudio">LM Studio</option><option value="ollama">Ollama(local)</option><option value="vertex">Vertex</option><option value="vertex-embedding">Vertex Embedding</option><option value="voyageai">VoyageAI</option><option value="custom">Custom</option></select></div>
        <div class="fld"><label>URL</label><input type="text" id="seu" placeholder="https://api.openai.com/v1/embeddings"></div>
        <div class="fld"><label>API Key / Vertex JSON</label><input type="password" id="sek" placeholder="sk-... 또는 Vertex service account JSON"></div>
        <div class="vertex-json-tools" data-vertex-json-slot="embedding" hidden>
          <label class="fld"><span>Embedding Vertex 서비스 계정 JSON 파일</span><input type="file" accept=".json,application/json" data-vertex-json-file="embedding"><small>JSON 파일을 선택하면 Embedding URL과 인증 JSON을 자동으로 채웁니다.</small></label>
          <label class="fld"><span>Embedding Vertex 서비스 계정 JSON 붙여넣기</span><textarea data-vertex-json-paste="embedding" spellcheck="false" placeholder='{&quot;type&quot;:&quot;service_account&quot;,&quot;project_id&quot;:&quot;my-project&quot;}'></textarea></label>
          <div class="vertex-json-actions"><button class="btn bs" type="button" data-vertex-json-apply="embedding">JSON 적용</button></div>
          <div class="vertex-preview-grid">
            <label class="fld"><span>Project ID</span><input type="text" readonly data-vertex-json-preview="embedding:project_id" placeholder="my-gcp-project"></label>
            <label class="fld"><span>Client Email</span><input type="text" readonly data-vertex-json-preview="embedding:client_email" placeholder="service-account@project.iam.gserviceaccount.com"></label>
            <label class="fld field-wide"><span>Private Key Preview</span><textarea readonly rows="2" data-vertex-json-preview="embedding:private_key" spellcheck="false"></textarea></label>
          </div>
          <div class="settings-note-line" data-vertex-json-status="embedding">Vertex embedding provider를 선택하면 JSON 도구가 활성화됩니다.</div>
        </div>
        <div class="fld"><label>Model</label><input type="text" id="sem" list="sem-provider-models" placeholder="text-embedding-3-small"><datalist id="sem-provider-models"></datalist></div>
        <div class="fld"><label>Timeout (ms)</label><input type="number" id="seto" placeholder="120000"></div>
      </div>
      <div class="ss">
        <h3>⚖ 데이터 작성 & 가중치</h3>
        <div class="settings-subblock">
          <div class="settings-subtitle">초기 구조 분석</div>
          <div class="fld"><label>분석 범위</label><select id="scsp"><option value="all">전체 대화</option><option value="recent100">최근 100개 메시지</option><option value="recent200">최근 200개 메시지</option><option value="recent500">최근 500개 메시지</option><option value="custom">사용자 지정</option></select></div>
          <div class="fld" id="schl-wrap"><label>사용자 지정 메시지 수</label><input type="number" id="schl" min="1" placeholder="예: 300"><div class="setting-note">전체 대화가 너무 길면 최근 N개만 구조 분석합니다.</div></div>
          <div class="fld"><label>현재 턴 분석 근거</label><select id="saem"><option value="assistant_only">AI 응답만 분석</option><option value="user_and_assistant">유저 입력 + AI 응답 분석</option></select><div class="setting-note">기본값은 현행 유지입니다. 유저 입력까지 켜면 사용자가 직접 쓴 행동/대사도 엔티티·세계관 분석 근거가 됩니다.</div></div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="btn bp" id="btn-cold-start">🔄 초기 구조 분석</button>
            <button class="btn bp" id="btn-cold-reanalyze">♻️ 과거 대화 재분석</button>
            <button class="btn bs" id="btn-import-hypa-v3">📥 하이파 V3 → 로어북</button>
            <button class="btn bs" id="btn-add-user-lorebook">✍️ 수동 로어북 추가</button>
          </div>
        </div>
        <div class="settings-subblock">
          <div class="settings-subtitle">내부 데이터 언어</div>
          <div class="fld"><label>내부 데이터 작성 언어</label><select id="sidlang"><option value="off">Off / 원문·기존 프롬프트 따름</option><option value="fixed_korean">한국어 고정</option><option value="fixed_english">English fixed</option><option value="follow_main_response">메인 응답 언어 따름</option></select><div class="setting-note">요약, 상태, 월드/엔티티 설명처럼 LIBRA가 새로 생성하는 내부 데이터 값에만 적용됩니다. raw memory, direct evidence, 원문 인용은 번역하지 않습니다.</div></div>
          <div class="toolbar"><button class="btn bs" id="btn-migrate-internal-language" type="button">기존 내부 데이터 언어 정규화</button></div>
          <div class="settings-note-line" id="internal-language-migration-status">마이그레이션 대기 중</div>
        </div>
      </div>
      <div class="ss">
        <h3>🔧 플러그인 기능</h3>
        <div class="tr"><label>수동 OOC 정지 모드 <span class="setting-note">켜면 LIBRA가 모든 요청을 원본 그대로 통과시키고, 주입/저장/리콜/백그라운드 정리를 모두 멈춥니다.</span></label><label class="tog"><input type="checkbox" id="soocpause" title="수동 OOC 정지 모드가 켜져 있으면 LIBRA는 beforeRequest/afterRequest/유지보수 작업을 모두 바이패스합니다."><span class="tsl"></span></label></div>
        <div class="settings-subblock">
          <div class="settings-subtitle">응답 개선</div>
          <div class="fld"><label>스토리 작가 모드</label><select id="ssam"><option value="disabled">비활성</option><option value="supportive">서포트형</option><option value="proactive">주도형</option><option value="aggressive">강공형</option></select></div>
          <div class="fld"><label>감독 모드</label><select id="sdm"><option value="disabled">비활성</option><option value="light">라이트</option><option value="standard">표준</option><option value="strong">강함</option><option value="absolute">절대감독</option></select></div>
        </div>
      </div>
      <div class="ss">
        <h3>📚 데이터 소스 반영</h3>
        <div class="tr"><label>하이파 V3 모달 자동 반영 <span class="setting-note">직접 주입 없이 chat.hypaV3Data를 구조 데이터로 반영</span></label><label class="tog"><input type="checkbox" id="ssrchypa"><span class="tsl"></span></label></div>
        <div class="tr"><label>모듈 로어북 반영 <span class="setting-note">기본 꺼짐. 아래 모듈 목록에서 켠 모듈만 읽습니다.</span></label><label class="tog"><input type="checkbox" id="ssrcmodule"><span class="tsl"></span></label></div>
        <div class="fld" id="source-module-row"><label>반영할 모듈 로어북 <span class="setting-note">V4.2 방식처럼 전체 모듈을 나열하고 토글로 선택합니다.</span></label>
          <input type="hidden" id="ssrcmoduleids">
          <div class="source-module-tools"><button class="btn bs" id="btn-refresh-source-modules" type="button">목록 새로고침</button><button class="btn" id="btn-fill-active-modules" type="button">활성 모듈 선택</button><button class="btn bd" id="btn-clear-source-modules" type="button">전체 해제</button></div>
          <div class="settings-note-line" id="source-module-status">모듈 목록 대기 중</div>
          <div class="source-module-list" id="source-module-list"><div class="hint">Risu DB에서 모듈 목록을 읽는 중입니다.</div></div>
          <div class="setting-note">모듈의 regex/trigger/code는 실행하지 않고 lorebook 텍스트만 구조 데이터 반영에 사용합니다.</div>
        </div>
        <div class="settings-note-line" id="source-reflection-status">원천 데이터 반영 상태 대기 중</div>
      </div>
      </div>
    <div class="sec">📊 캐시 통계</div>
    <div id="cst" class="cs"></div>
    <input type="file" id="settings-file-input" accept=".json,application/json" style="display:none">
    <div class="sbar settings-actions">
      <button class="btn bp" id="btn-transition">🚀 다음 세션으로 대화 이어가기</button>
      <button class="btn" id="btn-export-settings-file">📤 설정 내보내기</button>
      <button class="btn" id="btn-import-settings-file">📥 설정 가져오기</button>
      <button class="btn" id="btn-export-debug-file">🧪 디버그 내보내기</button>
      <button class="btn bp" id="btn-save-settings">💾 설정 저장</button>
      <button class="btn bd" id="btn-reset-settings">🔄 설정 초기화</button>
      <button class="btn bd" id="lmai-cache-reset">🔄 캐시 초기화</button>
    </div>
  </div>
</div>
</div>
<div id="toast" class="toast"></div>
    `;

    const show = async () => {
        const R = RisuCompat.host('getCharacter') || RisuCompat.api();
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
        bodyWrap.setAttribute('data-libra-gui-backdrop', 'true');
        bodyWrap.innerHTML = GUI_BODY;
        overlay.appendChild(bodyWrap);

        document.body.appendChild(overlay);

        const makeGuiSectionLabel = (text = '') => {
            const node = document.createElement('div');
            node.className = 'sec';
            node.textContent = text;
            return node;
        };
        const makeGuiAccordion = (index, title, nodes = [], options = {}) => {
            const acc = document.createElement('div');
            acc.className = `acc${options.open ? ' open' : ''}`;
            const header = document.createElement('div');
            header.className = 'acc-h';
            header.dataset.acc = String(options.key || `gui-${index}`);
            const safeTitle = String(title || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
            header.innerHTML = `<span class="ttl"><span class="idx">${String(index).padStart(2, '0')}</span>${safeTitle}</span><span class="chev">›</span>`;
            acc.appendChild(header);
            if (options.hint) {
                const hint = document.createElement('div');
                hint.className = 'acc-hint';
                hint.textContent = String(options.hint || '');
                acc.appendChild(hint);
            }
            const body = document.createElement('div');
            body.className = 'acc-b';
            nodes.filter(Boolean).forEach(node => body.appendChild(node));
            acc.appendChild(body);
            return acc;
        };
        const upgradeWorldPanelLayout = () => {
            const tab = overlay.querySelector('#tab-world');
            if (!tab || tab.dataset.libraLayoutUpgraded === '1') return;
            const tree = overlay.querySelector('#wt');
            const globalFeatures = overlay.querySelector('#world-global-features');
            const rules = overlay.querySelector('#wr');
            const fieldBand = overlay.querySelector('#world-node-name')?.closest('.entity-band');
            const saveWorldFields = overlay.querySelector('#btn-save-world-fields')?.closest('.sbar');
            const stateLog = overlay.querySelector('#world-state-log');
            const codexStatus = overlay.querySelector('#world-codex-status');
            const correctionField = overlay.querySelector('#world-user-correction')?.closest('.fld');
            const saveCorrection = overlay.querySelector('#btn-save-world-correction')?.closest('.sbar');
            const lensMeta = overlay.querySelector('#world-lens-meta');
            const lensPromptField = overlay.querySelector('#world-lens-prompt')?.closest('.fld');
            tab.replaceChildren(
                makeGuiAccordion(1, '세계관 트리 · 전역 특성', [
                    makeGuiSectionLabel('세계관 트리'),
                    tree,
                    makeGuiSectionLabel('전역 세계 특성'),
                    globalFeatures,
                    makeGuiSectionLabel('현재 세계 규칙'),
                    rules
                ], { open: true, key: 'world-tree' }),
                makeGuiAccordion(2, '세계관 정본 필드', [
                    fieldBand,
                    saveWorldFields
                ], {
                    key: 'world-canon',
                    hint: '영구적으로 저장되는 세계 구조 값입니다. 잘못된 값을 발견하면 직접 고쳐서 저장하세요.'
                }),
                makeGuiAccordion(3, '상태 로그 · 코덱스', [
                    makeGuiSectionLabel('현재 세계 상태 로그'),
                    stateLog,
                    makeGuiSectionLabel('세계관 코덱스 상태'),
                    codexStatus
                ], { key: 'world-status' }),
                makeGuiAccordion(4, '수동 보정', [
                    makeGuiSectionLabel('수동 세계관 보정'),
                    correctionField,
                    saveCorrection
                ], { key: 'world-correction' }),
                makeGuiAccordion(5, '현재 장면 렌즈', [
                    makeGuiSectionLabel('현재 장면용 세계관 보정'),
                    lensMeta,
                    lensPromptField
                ], { key: 'world-lens' })
            );
            tab.dataset.libraLayoutUpgraded = '1';
        };
        const upgradeSettingsPanelLayout = () => {
            const tab = overlay.querySelector('#tab-settings');
            const grid = tab?.querySelector('.sgrid');
            if (!tab || !grid || tab.dataset.libraLayoutUpgraded === '1') return;
            const sections = Array.from(grid.children).filter(node => node?.classList?.contains('ss'));
            const rest = Array.from(tab.childNodes).filter(node => node !== grid);
            const accordions = sections.map((section, index) => {
                const titleNode = section.querySelector('h3');
                const title = titleNode?.textContent?.trim() || `설정 ${index + 1}`;
                if (titleNode) titleNode.remove();
                return makeGuiAccordion(index + 1, title, Array.from(section.childNodes), {
                    open: index === 0,
                    key: `settings-${index + 1}`
                });
            });
            const tailNodes = rest.filter(node => {
                if (node.nodeType === Node.TEXT_NODE) return String(node.textContent || '').trim();
                return true;
            });
            if (tailNodes.length) {
                accordions.push(makeGuiAccordion(accordions.length + 1, '캐시 통계 · 작업', tailNodes, {
                    key: 'settings-cache-actions'
                }));
            }
            tab.replaceChildren(...accordions);
            tab.dataset.libraLayoutUpgraded = '1';
        };
        const upgradeGuiLayoutShell = () => {
            upgradeWorldPanelLayout();
            upgradeSettingsPanelLayout();
            overlay.addEventListener('click', (event) => {
                const header = event.target?.closest?.('.acc-h');
                if (!header || !overlay.contains(header)) return;
                const acc = header.closest('.acc');
                if (acc) acc.classList.toggle('open');
            });
        };
        upgradeGuiLayoutShell();

        // 2. 데이터 준비
        const guiContext = await resolveActiveChatContext();
        const char = guiContext?.char || await R.getCharacter();
        const chat = guiContext?.chat || await getActiveChatForCharacter(char);
        const guiChatId = String(chat?.id || '').trim();
        let lore = [];
        if (char) {
            if (await MemoryEngine.normalizeLoreStorage(char, chat)) {
                await persistLoreToActiveChat(chat, MemoryEngine.getLorebook(char, chat), {
                    globalLore: Array.isArray(char?.lorebook) ? char.lorebook : []
                });
            }
            lore = MemoryEngine.getLorebook(char, chat) || [];
        }
        let effectiveGuiLore = char ? (MemoryEngine.getEffectiveLorebook(char, chat) || lore) : lore;
        HierarchicalWorldManager.loadWorldGraph(effectiveGuiLore, true);

        let _MEM = effectiveGuiLore.filter(e => e.comment === 'lmai_memory');
        let _ENT = effectiveGuiLore.filter(e => e.comment === 'lmai_entity');
        let _REL = effectiveGuiLore.filter(e => e.comment === 'lmai_relation');
        const narrativeEntry = effectiveGuiLore.find(e => e.comment === 'lmai_narrative');
        let _NAR = { storylines: [], turnLog: [], lastSummaryTurn: 0 };
        try {
            if (narrativeEntry) {
                _NAR = JSON.parse(narrativeEntry.content);
            } else {
                _NAR = safeClone(NarrativeTracker.getState?.() || _NAR);
            }
        } catch (error) {
            recordSuppressedRuntimeError('gui.initial_narrative_parse_failed', error, {
                comment: String(narrativeEntry?.comment || '').trim(),
                key: String(narrativeEntry?.key || '').trim(),
                chatId: guiChatId
            });
        }

        let _WLD = { nodes: [], activePath: [], global: {}, rootId: null };
        try {
            const profile = HierarchicalWorldManager.getProfile();
            if (profile) {
                _WLD = { nodes: Array.from(profile.nodes.entries()), activePath: profile.activePath || [], global: profile.global || {}, rootId: profile.rootId };
            }
        } catch (error) {
            recordSuppressedRuntimeError('gui.initial_world_graph_parse_failed', error, {
                comment: '',
                key: '',
                chatId: guiChatId
            });
        }

        let _CFG = { ...MemoryEngine.CONFIG };
        try {
            const saved = await readCommonPluginSettings();
            if (saved) {
                const p = (() => {
                    try {
                        const v = typeof saved === 'string' ? JSON.parse(saved) : saved;
                        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
                    } catch (error) {
                        recordSuppressedRuntimeError('gui.initial_config_parse_failed', error, {
                            chatId: guiChatId,
                            rawChars: String(saved || '').length
                        });
                        return {};
                    }
                })();
                _CFG = { ..._CFG, ...p };
            }
        } catch (error) {
            recordSuppressedRuntimeError('gui.initial_config_read_failed', error, {
                chatId: guiChatId
            });
        }
        _CFG.entityBlocklist = normalizeEntityBlocklistCollection(_CFG.entityBlocklist || []);
        let lastHypaImportSignature = null;
        let guiSourceModuleDbSnapshot = null;
        let guiSourceModuleSelectedIds = SourceReflectionManager.splitIds(_CFG.moduleLorebookSelectedIds || '');

        // 유틸리티 함수
        const esc = (s) => { const d = document.createElement("div"); d.appendChild(document.createTextNode(s||"")); return d.innerHTML; };
        const escAttr = (s) => esc(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;");
        let toastHideTimer = null;
        const toast = (m, d) => {
            const t = overlay.querySelector("#toast");
            if (!t) return;
            if (toastHideTimer) clearTimeout(toastHideTimer);
            t.textContent = m;
            t.classList.add("on");
            toastHideTimer = setTimeout(() => t.classList.remove("on"), d || 2000);
        };
        const createReanalysisProgressToast = (label) => {
            let shownPercent = 0;
            let lastToastAt = 0;
            const activityContext = () => ({
                scopeKey: getChatRuntimeScopeKey(chat, char),
                activityDashboard: MemoryEngine.CONFIG.activityDashboard
            });
            const waitForToastGap = async () => {
                const gap = 180;
                const elapsed = Date.now() - lastToastAt;
                if (elapsed < gap) await sleep(gap - elapsed);
                lastToastAt = Date.now();
            };
            const show = async (message, duration = 1800) => {
                await waitForToastGap();
                toast(message, duration);
            };
            const advanceTo = async (percent) => {
                const target = Math.max(0, Math.min(100, Math.floor(Number(percent || 0) / 10) * 10));
                while (shownPercent < target) {
                    shownPercent += 10;
                    ActivityDashboardCore.update(activityContext(), {
                        phase: `${label} 재분석`,
                        status: 'running',
                        progress: shownPercent,
                        step: `${label} 재분석`,
                        stepStatus: shownPercent >= 100 ? 'done' : 'running',
                        message: `${label} 재분석 중 ${shownPercent}%`,
                        forceVisible: true
                    });
                }
            };
            const buildCompleteMessage = (result = null) => {
                if (result?.partialFailure) return `${label} 재분석이 끝났습니다. 기존 데이터는 보존되었습니다.`;
                if (label === '메모리' && result && typeof result === 'object') {
                    const added = Number(result.addedCount || 0);
                    return added > 0 ? `${label} 재분석 완료: ${added}개 반영` : `${label} 재분석이 완료되었습니다.`;
                }
                if (label === '엔티티' && result && typeof result === 'object') {
                    const entityCount = Number(result.entityCount || 0);
                    const relationCount = Number(result.relationCount || 0);
                    return (entityCount || relationCount)
                        ? `${label} 재분석 완료: 엔티티 ${entityCount}개, 관계 ${relationCount}개 반영`
                        : `${label} 재분석이 완료되었습니다.`;
                }
                if (label === '내러티브' && result && typeof result === 'object') {
                    const applied = Number(result.appliedCount || 0);
                    return applied > 0 ? `${label} 재분석 완료: ${applied}개 반영` : `${label} 재분석이 완료되었습니다.`;
                }
                return `${label} 재분석이 완료되었습니다.`;
            };
            return {
                start: () => {
                    ActivityDashboardCore.beginRequest({
                        flow: `${label} 재분석`,
                        title: `${label} 재분석`,
                        stageLabel: `${label} 재분석을 시작합니다.`,
                        status: 'running',
                        progress: 6,
                        forceVisible: true
                    }, activityContext());
                    return show(`${label} 재분석을 시작합니다.`, 1800);
                },
                advanceTo,
                applying: async () => {
                    await advanceTo(100);
                    ActivityDashboardCore.update(activityContext(), {
                        phase: `${label} 재분석`,
                        status: 'running',
                        progress: 96,
                        step: '반영',
                        stepStatus: 'running',
                        message: `${label} 재분석 결과를 반영합니다.`,
                        forceVisible: true
                    });
                    await show(`${label} 재분석 반영 중...`, 2200);
                },
                complete: (result = null) => {
                    const message = buildCompleteMessage(result);
                    ActivityDashboardCore.finish(activityContext(), 'ok', message);
                    return show(message, 2200);
                },
                fail: (error) => {
                    ActivityDashboardCore.finish(activityContext(), 'failed', `${label} 재분석 실패: ${error?.message || error}`);
                    return show(`❌ ${label} 재분석 실패: ${error?.message || error}`, 2600);
                }
            };
        };
        const parseMeta = (c) => parseLibraMetaObject(c || '', { imp: 5, t: 0, ttl: 0, cat: '' });
        const stripMeta = (c) => {
            const raw = String(c || '');
            const metaJson = extractLibraMetaJsonString(raw);
            if (!metaJson) return raw.trim();
            const markerStart = raw.indexOf('[META:');
            const jsonStart = raw.indexOf(metaJson, markerStart >= 0 ? markerStart : 0);
            const close = jsonStart >= 0 ? raw.indexOf(']', jsonStart + metaJson.length) : -1;
            return (close >= 0 ? raw.slice(close + 1) : raw).trim();
        };
        const impBdg = (i) => { const cls = i>=7?"bh":i>=4?"bm":"bl"; return `<span class="bdg ${cls}">중요도 ${i}</span>`; };
        const GUI_PARTIAL_MANAGED_COMMENTS = new Set(['lmai_memory', 'lmai_hme_index', 'lmai_entity', 'lmai_relation', 'lmai_world_graph', 'lmai_world_node']);
        const buildFullManagedLoreSnapshot = (partialLore) => {
            const baseLore = Array.isArray(lore) ? lore : [];
            const additions = (Array.isArray(partialLore) ? partialLore : []).map(entry => safeClone(entry));
            const additionComments = new Set(additions.map(entry => String(entry?.comment || '')));
            const replaceComments = new Set(GUI_PARTIAL_MANAGED_COMMENTS);
            if (!additionComments.has('lmai_world_graph') && !additionComments.has('lmai_world_node')) {
                replaceComments.delete('lmai_world_graph');
                replaceComments.delete('lmai_world_node');
            }
            const preserved = baseLore
                .filter(entry => {
                    const comment = String(entry?.comment || '');
                    if (!comment.startsWith('lmai_')) return true;
                    return !replaceComments.has(comment);
                })
                .map(entry => safeClone(entry));
            return [...preserved, ...additions];
        };
        const resolveGuiTargetContext = async () => {
            const targetCtx = await resolveActiveChatContext(chat);
            const targetChar = targetCtx?.char || null;
            const targetChat = targetCtx?.chat || null;
            if (!targetChar || !targetChat) {
                throw new Error('GUI가 열린 채팅방을 찾을 수 없습니다. 작업을 중단합니다.');
            }
            if (guiChatId && String(targetChat?.id || '').trim() !== guiChatId) {
                throw new Error('GUI가 열린 채팅방을 찾을 수 없습니다. 작업을 중단합니다.');
            }
            return { targetChar, targetChat, targetCtx };
        };
        
        const saveLoreToChar = async (newLore, cb) => {
            if (!char) return;
            await loreLock.writeLock();
            try {
                const { targetChar, targetChat } = await resolveGuiTargetContext();
                if (targetChat && Array.isArray(targetChat.localLore)) targetChat.localLore = newLore;
                else if (Array.isArray(targetChar?.lorebook)) targetChar.lorebook = newLore;
                else if (targetChat) targetChat.localLore = newLore;
                const persistResult = await persistLoreToActiveChat(targetChat, newLore);
                if (!persistResult?.ok) {
                    throw new Error(`저장 대상 채팅방에 기록하지 못했습니다: ${persistResult?.reason || 'unknown'}`);
                }
                const persistedLore = Array.isArray(persistResult?.chat?.localLore)
                    ? persistResult.chat.localLore.map(entry => safeClone(entry))
                    : (Array.isArray(newLore) ? newLore.map(entry => safeClone(entry)) : []);
                lore = persistedLore;
                effectiveGuiLore = MemoryEngine.getEffectiveLorebook(targetChar, targetChat) || lore;
                if (targetChat) targetChat.localLore = persistedLore.map(entry => safeClone(entry));
                MemoryEngine.rebuildIndex(lore);
                HierarchicalWorldManager.loadWorldGraph(lore);
                SecretKnowledgeCore.loadState(lore, {
                    scopeKey: getChatRuntimeScopeKey(targetChat, targetChar),
                    chatId: String(targetChat?.id || getActiveManagedChatId() || '').trim()
                });
                EntityKnowledgeVaultCore.loadState(lore, {
                    scopeKey: getChatRuntimeScopeKey(targetChat, targetChar),
                    chatId: String(targetChat?.id || getActiveManagedChatId() || '').trim()
                });
                TimeEngine.loadState(lore, {
                    scopeKey: getChatRuntimeScopeKey(targetChat, targetChar),
                    chatId: String(targetChat?.id || getActiveManagedChatId() || '').trim()
                });
                EntityManager.rebuildCache(lore);
                NarrativeTracker.loadState(lore);
                StoryAuthor.loadState(lore);
                Director.loadState(lore);
                CharacterStateTracker.loadState(lore);
                WorldStateTracker.loadState(lore);
                if (cb) cb();
            } catch (e) {
                toast("❌ 저장 실패");
                recordRuntimeDebug('error', "[LIBRA] Save Error:", e);
                throw e;
            } finally {
                loreLock.writeUnlock();
            }
        };
        const renderSourceReflectionStatus = async () => {
            const box = overlay.querySelector('#source-reflection-status');
            if (!box) return;
            try {
                const ctx = await resolveActiveChatContext(chat);
                const statusLore = MemoryEngine.getLorebook(ctx?.char || char, ctx?.chat || chat) || lore || [];
                const status = SourceReflectionManager.getStatus(statusLore, ctx?.chat || chat, ctx?.char || char);
                const counts = status.counts || {};
                const parts = [
                    `캐릭터:${Number(counts.character_card || 0)}`,
                    `페르소나:${Number(counts.persona_binding || 0)}`,
                    `하이파:${Number(counts.hypa_v3 || 0)}`,
                    `모듈:${Number(counts.module_lorebook || 0)}`
                ];
                const time = status.reflectedAt ? new Date(status.reflectedAt).toLocaleString() : '아직 없음';
                box.textContent = `최근 반영: ${time} / ${parts.join(' · ')}`;
            } catch {
                box.textContent = '원천 데이터 반영 상태를 읽을 수 없습니다.';
            }
        };
        const getSourceModuleIdentityKeys = (module = null) => SourceReflectionManager.splitIds([
            module?.id,
            module?._id,
            module?.key,
            module?.namespace,
            module?.name,
            module?.displayName
        ]);
        const getSourceModuleKey = (module = null) => getSourceModuleIdentityKeys(module)[0] || '';
        const getSourceModuleDisplayName = (module = null, index = 0) => String(
            module?.name || module?.displayName || module?.namespace || module?.id || module?._id || module?.key || `Module ${index + 1}`
        ).trim();
        const getSourceModuleLoreEntries = (module = null) => {
            const lore = Array.isArray(module?.lorebook)
                ? module.lorebook
                : Array.isArray(module?.data?.lorebook)
                    ? module.data.lorebook
                    : Array.isArray(module?.lore)
                        ? module.lore
                        : [];
            return lore.filter(entry => entry && entry.disabled !== true && entry.enabled !== false);
        };
        const getSourceModuleRows = () => {
            const db = guiSourceModuleDbSnapshot || {};
            const activeSet = new Set(SourceReflectionManager.getSelectedActiveModuleIds(db, chat, char));
            const modules = Array.isArray(db?.modules) ? db.modules : [];
            return modules.map((module, index) => {
                const key = getSourceModuleKey(module);
                const keys = getSourceModuleIdentityKeys(module);
                const loreCount = getSourceModuleLoreEntries(module).length;
                const id = String(module?.id || module?._id || '').trim();
                const namespace = String(module?.namespace || '').trim();
                const active = keys.some(value => activeSet.has(value));
                return {
                    module,
                    index,
                    key,
                    keys,
                    id,
                    namespace,
                    name: getSourceModuleDisplayName(module, index),
                    loreCount,
                    active,
                    selectable: !!key && loreCount > 0
                };
            }).sort((a, b) => Number(b.active) - Number(a.active) || Number(b.loreCount > 0) - Number(a.loreCount > 0) || a.name.localeCompare(b.name));
        };
        const readSourceModuleSelectedIds = () => {
            const raw = overlay.querySelector('#ssrcmoduleids')?.value || _CFG.moduleLorebookSelectedIds || guiSourceModuleSelectedIds;
            return SourceReflectionManager.splitIds(raw);
        };
        const readSourceModuleSelectedIdsString = () => readSourceModuleSelectedIds().join(', ');
        const writeSourceModuleSelectedIds = (ids = [], options = {}) => {
            guiSourceModuleSelectedIds = [...new Set(SourceReflectionManager.splitIds(ids))];
            _CFG.moduleLorebookSelectedIds = guiSourceModuleSelectedIds.join(', ');
            const hidden = overlay.querySelector('#ssrcmoduleids');
            if (hidden) hidden.value = _CFG.moduleLorebookSelectedIds;
            if (options.render !== false) renderSourceModuleSelector();
            syncSourceModuleReflectionUi();
            return guiSourceModuleSelectedIds;
        };
        const syncSourceModuleReflectionUi = () => {
            const enabled = overlay.querySelector('#ssrcmodule')?.checked === true;
            const row = overlay.querySelector('#source-module-row');
            if (row) row.classList.toggle('is-disabled', !enabled);
            const list = overlay.querySelector('#source-module-list');
            if (list) list.classList.toggle('is-disabled', !enabled);
            overlay.querySelectorAll('.source-module-check').forEach((input) => {
                input.disabled = !enabled || input.dataset.moduleSelectable !== '1';
            });
            ['#btn-refresh-source-modules', '#btn-fill-active-modules', '#btn-clear-source-modules'].forEach(selector => {
                const button = overlay.querySelector(selector);
                if (button) button.disabled = !enabled;
            });
        };
        const renderSourceModuleSelector = () => {
            const list = overlay.querySelector('#source-module-list');
            const status = overlay.querySelector('#source-module-status');
            if (!list) return;
            const rows = getSourceModuleRows();
            const selected = new Set(readSourceModuleSelectedIds());
            const withLoreCount = rows.filter(row => row.loreCount > 0).length;
            const activeCount = rows.filter(row => row.active).length;
            const selectedCount = rows.filter(row => row.selectable && row.keys.some(key => selected.has(key))).length;
            if (status) status.textContent = `모듈 ${rows.length}개 · 로어북 있음 ${withLoreCount}개 · Risu 활성 ${activeCount}개 · 현재 선택 ${selectedCount}개`;
            if (!rows.length) {
                list.innerHTML = '<div class="hint">Risu DB에서 모듈 목록을 읽지 못했습니다. 목록 새로고침을 눌러 다시 시도하세요.</div>';
                syncSourceModuleReflectionUi();
                return;
            }
            list.innerHTML = rows.map(row => {
                const checked = row.selectable && row.keys.some(key => selected.has(key));
                const rawMeta = [row.id ? `id:${row.id}` : '', row.namespace ? `namespace:${row.namespace}` : '', row.key ? `key:${row.key}` : ''].filter(Boolean).join(' · ');
                const badges = [
                    row.active ? '<span class="source-module-badge ok">Risu 활성</span>' : '<span class="source-module-badge off">비활성</span>',
                    row.loreCount > 0 ? `<span class="source-module-badge ok">로어 ${row.loreCount}</span>` : '<span class="source-module-badge off">로어 없음</span>'
                ].join('');
                return `<div class="source-module-item ${checked ? 'is-on' : ''} ${row.selectable ? '' : 'is-disabled'}">
                  <div class="source-module-main">
                    <div class="source-module-name">${esc(row.name)}</div>
                    <div class="source-module-meta">${esc(rawMeta || row.key || 'module')}</div>
                    <div class="source-module-badges">${badges}</div>
                  </div>
                  <label class="tog" title="${row.selectable ? '이 모듈 로어북을 LIBRA 데이터 반영에 사용' : '읽을 수 있는 lorebook이 없습니다'}"><input type="checkbox" class="source-module-check" data-module-key="${escAttr(row.key)}" data-module-selectable="${row.selectable ? '1' : '0'}" ${checked ? 'checked' : ''} ${row.selectable ? '' : 'disabled'}><span class="tsl"></span></label>
                </div>`;
            }).join('');
            syncSourceModuleReflectionUi();
        };
        const refreshSourceModuleSelector = async (options = {}) => {
            const status = overlay.querySelector('#source-module-status');
            try {
                if (status && !options.quiet) status.textContent = 'Risu DB에서 모듈 목록을 읽는 중입니다...';
                guiSourceModuleDbSnapshot = await getLibraAllowedDatabase(['modules', 'enabledModules', 'moduleIntergration']);
                renderSourceModuleSelector();
                return guiSourceModuleDbSnapshot;
            } catch (error) {
                if (status) status.textContent = `모듈 목록을 읽지 못했습니다: ${error?.message || error}`;
                return null;
            }
        };
        const updateSourceModuleSelectedIdsFromChecks = () => writeSourceModuleSelectedIds(
            Array.from(overlay.querySelectorAll('.source-module-check:checked')).map(input => input.dataset.moduleKey || '')
        );

        const NANO_GPT_UI_PROVIDER = 'nanogpt';
        const NANO_GPT_CHAT_COMPLETIONS_URL = 'https://nano-gpt.com/api/v1/chat/completions';
        const PROVIDER_PRESETS = Object.freeze({
            llm: {
                openai: {
                    url: 'https://api.openai.com/v1/chat/completions',
                    urlAliases: ['https://api.openai.com'],
                    models: []
                },
                claude: {
                    url: 'https://api.anthropic.com/v1/messages',
                    urlAliases: ['https://api.anthropic.com'],
                    models: []
                },
                gemini: {
                    url: 'https://generativelanguage.googleapis.com/v1beta',
                    models: []
                },
                openrouter: {
                    url: 'https://openrouter.ai/api/v1/chat/completions',
                    urlAliases: ['https://openrouter.ai/api'],
                    models: []
                },
                lmstudio: {
                    url: 'http://localhost:1234/v1/chat/completions',
                    urlAliases: ['http://localhost:1234/v1'],
                    models: []
                },
                ollama: {
                    url: 'http://127.0.0.1:11434',
                    urlAliases: ['http://localhost:11434'],
                    models: []
                },
                ollama_cloud: {
                    url: 'https://ollama.com/v1/chat/completions',
                    urlAliases: ['https://ollama.com'],
                    models: [
                        'glm-5.2:cloud',
                        'glm-5.1:cloud',
                        'glm-5:cloud',
                        'kimi-k2.5:cloud',
                        'kimi-k2.6:cloud',
                        'kimi-k2.7-code:cloud',
                        'deepseek-v4-pro:cloud',
                        'deepseek-v3.2:cloud',
                        'deepseek-v4-flash:cloud',
                        'gemini-3-flash-preview:cloud',
                        'gemma4:26b-a4b-it-q4_K_M',
                        'gemma4:31b-cloud'
                    ]
                },
                nanogpt: {
                    url: NANO_GPT_CHAT_COMPLETIONS_URL,
                    urlAliases: ['https://nano-gpt.com/api', 'https://nano-gpt.com/api/v1'],
                    models: [
                        'zai-org/glm-5.2',
                        'zai-org/glm-5.1',
                        'zai-org/glm-5',
                        'moonshotai/kimi-k2.5',
                        'moonshotai/kimi-k2.6',
                        'moonshotai/kimi-k2.7-code',
                        'deepseek/deepseek-v4-pro',
                        'deepseek/deepseek-v3.2',
                        'deepseek/deepseek-v4-flash',
                        'google/gemma-4-26b-a4b-it',
                        'google/gemma-4-31b-it'
                    ]
                },
                vertex: {
                    url: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/publishers/google/models',
                    models: []
                },
                'vertex-openai': {
                    url: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi',
                    models: []
                },
                copilot: {
                    url: 'https://api.githubcopilot.com/chat/completions',
                    urlAliases: ['https://api.githubcopilot.com'],
                    models: []
                },
                custom: { url: '', models: [] }
            },
            embedding: {
                openai: {
                    url: 'https://api.openai.com/v1/embeddings',
                    urlAliases: ['https://api.openai.com'],
                    models: []
                },
                gemini: {
                    url: 'https://generativelanguage.googleapis.com/v1beta',
                    models: []
                },
                'gemini-embedding': {
                    url: 'https://generativelanguage.googleapis.com/v1beta',
                    models: []
                },
                lmstudio: {
                    url: 'http://localhost:1234/v1/embeddings',
                    urlAliases: ['http://localhost:1234/v1'],
                    models: []
                },
                ollama: {
                    url: 'http://127.0.0.1:11434',
                    urlAliases: ['http://localhost:11434'],
                    models: []
                },
                vertex: {
                    url: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/publishers/google/models',
                    models: []
                },
                'vertex-embedding': {
                    url: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/publishers/google/models',
                    models: []
                },
                voyageai: {
                    url: 'https://api.voyageai.com/v1/embeddings',
                    urlAliases: ['https://api.voyageai.com'],
                    models: []
                },
                custom: { url: '', models: [] }
            }
        });

        const vertexSlotSelectors = (slot = 'llm') => {
            const normalized = String(slot || 'llm').trim().toLowerCase();
            if (normalized === 'aux') return { provider: '#saxp', url: '#saxu', key: '#saxk', model: '#saxm', defaultProvider: 'vertex', defaultModel: 'gemini-2.5-flash' };
            if (normalized === 'embedding') return { provider: '#sep', url: '#seu', key: '#sek', model: '#sem', defaultProvider: 'vertex-embedding', defaultModel: 'text-embedding-004' };
            return { provider: '#slp', url: '#slu', key: '#slk', model: '#slm', defaultProvider: 'vertex', defaultModel: 'gemini-2.5-flash' };
        };
        const normalizePresetProviderKey = (provider = '') => {
            const raw = String(provider || '').trim().toLowerCase();
            if (raw === 'anthropic') return 'claude';
            if (raw === 'lm_studio') return 'lmstudio';
            if (raw === 'vertex_openai' || raw === 'vertex-openai-compatible' || raw === 'vertex_openai_compatible') return 'vertex-openai';
            if (raw === 'vertex_embedding') return 'vertex-embedding';
            if (raw === 'nano-gpt' || raw === 'nano_gpt') return NANO_GPT_UI_PROVIDER;
            return raw;
        };
        const providerPresetGroupForSlot = (slot = 'llm') => String(slot || 'llm').trim().toLowerCase() === 'embedding'
            ? PROVIDER_PRESETS.embedding
            : PROVIDER_PRESETS.llm;
        const providerPresetFor = (slot = 'llm', provider = '') => {
            const group = providerPresetGroupForSlot(slot);
            return group[normalizePresetProviderKey(provider)] || group.custom || { url: '', models: [] };
        };
        const normalizePresetCompare = (value = '') => String(value || '').trim().replace(/\/+$/, '').toLowerCase();
        const collectPresetValues = (slot = 'llm', field = 'url') => {
            const group = providerPresetGroupForSlot(slot);
            const values = [];
            Object.values(group).forEach((preset = {}) => {
                if (field === 'model') {
                    values.push(...(Array.isArray(preset.models) ? preset.models : []));
                } else {
                    if (preset.url) values.push(preset.url);
                    if (Array.isArray(preset.urlAliases)) values.push(...preset.urlAliases);
                }
            });
            return new Set(values.map(normalizePresetCompare).filter(Boolean));
        };
        const isKnownProviderPresetUrl = (value = '', slot = 'llm') => {
            const raw = String(value || '').trim();
            if (!raw) return true;
            if (/PROJECT_ID|my-gcp-project|test-project/i.test(raw)) return true;
            return collectPresetValues(slot, 'url').has(normalizePresetCompare(raw));
        };
        const isKnownProviderPresetModel = (value = '', slot = 'llm') => {
            const raw = String(value || '').trim();
            if (!raw) return true;
            return collectPresetValues(slot, 'model').has(normalizePresetCompare(raw));
        };
        const providerModelDatalistId = (slot = 'llm') => {
            const normalized = String(slot || 'llm').trim().toLowerCase();
            if (normalized === 'aux') return '#saxm-provider-models';
            if (normalized === 'embedding') return '#sem-provider-models';
            return '#slm-provider-models';
        };
        const syncProviderModelDatalist = (slot = 'llm') => {
            const selectors = vertexSlotSelectors(slot);
            const providerValue = overlay.querySelector(selectors.provider)?.value || '';
            const list = overlay.querySelector(providerModelDatalistId(slot));
            if (!list) return;
            const models = providerPresetFor(slot, providerValue).models || [];
            list.innerHTML = models.map(model => `<option value="${escAttr(model)}"></option>`).join('');
        };
        const applyProviderPresetToSlot = (slot = 'llm', options = {}) => {
            const selectors = vertexSlotSelectors(slot);
            const providerEl = overlay.querySelector(selectors.provider);
            const urlEl = overlay.querySelector(selectors.url);
            const modelEl = overlay.querySelector(selectors.model);
            const providerValue = providerEl?.value || '';
            const preset = providerPresetFor(slot, providerValue);
            syncProviderModelDatalist(slot);
            if (options.fill === false) return;
            const force = options.force === true;
            if (urlEl && preset.url && (force || isKnownProviderPresetUrl(urlEl.value, slot))) urlEl.value = preset.url;
            const primaryModel = Array.isArray(preset.models) ? preset.models[0] : '';
            if (modelEl && primaryModel && (force || isKnownProviderPresetModel(modelEl.value, slot))) modelEl.value = primaryModel;
        };
        const isNanoGPTUrl = (url = '') => /nano-gpt\.com\/api/i.test(String(url || '').trim());
        const providerValueForSettingsUI = (llm = {}, fallback = 'openai') => {
            const provider = normalizePresetProviderKey(llm?.provider || fallback || 'openai');
            if (provider === 'custom' && isNanoGPTUrl(llm?.url)) return NANO_GPT_UI_PROVIDER;
            if (providerPresetFor('llm', provider) !== PROVIDER_PRESETS.llm.custom || provider === 'custom') return provider;
            return fallback || 'openai';
        };
        const normalizeLLMRuntimeProviderFromUI = (llm = {}) => {
            const provider = normalizePresetProviderKey(llm?.provider || 'openai');
            if (provider !== NANO_GPT_UI_PROVIDER) return { ...llm, provider };
            return {
                ...llm,
                provider: 'custom',
                url: String(llm?.url || '').trim() || NANO_GPT_CHAT_COMPLETIONS_URL
            };
        };
        const isVertexProviderValue = (value = '', slot = 'llm') => {
            const raw = String(value || '').trim().toLowerCase();
            return slot === 'embedding'
                ? /^(?:vertex|vertex[-_]?embedding)$/.test(raw)
                : /^(?:vertex|vertex[-_]?openai(?:[-_]?compatible)?)$/.test(raw);
        };
        const vertexProjectIdFromCredential = (credential = {}) => {
            const direct = String(credential?.project_id || credential?.projectId || '').trim();
            if (direct) return direct;
            const email = String(credential?.client_email || '').trim();
            const match = email.match(/@([^.@]+)\.iam\.gserviceaccount\.com$/i);
            return match ? match[1] : '';
        };
        const compactVertexPreview = (value = '', max = 260) => {
            const raw = String(value || '').replace(/\s+/g, ' ').trim();
            return raw.length <= max ? raw : `${raw.slice(0, Math.max(0, max - 14))}...[redacted]`;
        };
        const vertexSuggestedUrlFor = (provider = '', projectId = '') => {
            const project = encodeURIComponent(String(projectId || '').trim());
            if (!project) return '';
            const p = String(provider || '').trim().toLowerCase();
            if (/vertex[-_]?openai/.test(p)) return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi`;
            return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models`;
        };
        const shouldReplaceVertexUrl = (value = '') => {
            const raw = String(value || '').trim();
            return !raw || /PROJECT_ID|my-gcp-project|test-project|aiplatform\.googleapis\.com\/v1\/projects\/[^/]+\/locations\/global$/i.test(raw);
        };
        const setVertexPreview = (slot = 'llm', name = '', value = '') => {
            const node = overlay.querySelector(`[data-vertex-json-preview="${slot}:${name}"]`);
            if (node) node.value = String(value || '');
        };
        const syncVertexCredentialPreviewFromKey = (slot = 'llm') => {
            const selectors = vertexSlotSelectors(slot);
            const raw = overlay.querySelector(selectors.key)?.value || '';
            try {
                const credential = JSON.parse(String(raw || '').trim());
                if (!credential || typeof credential !== 'object' || Array.isArray(credential)) throw new Error('not-json-object');
                setVertexPreview(slot, 'project_id', vertexProjectIdFromCredential(credential));
                setVertexPreview(slot, 'client_email', credential.client_email || '');
                setVertexPreview(slot, 'private_key', compactVertexPreview(credential.private_key || credential.access_token || credential.token || ''));
            } catch (_) {
                setVertexPreview(slot, 'project_id', '');
                setVertexPreview(slot, 'client_email', '');
                setVertexPreview(slot, 'private_key', '');
            }
        };
        const syncVertexCredentialPanels = () => {
            ['llm', 'aux', 'embedding'].forEach((slot) => {
                const selectors = vertexSlotSelectors(slot);
                const providerValue = overlay.querySelector(selectors.provider)?.value || '';
                const active = isVertexProviderValue(providerValue, slot);
                const panel = overlay.querySelector(`[data-vertex-json-slot="${slot}"]`);
                if (panel) panel.hidden = !active;
                syncVertexCredentialPreviewFromKey(slot);
            });
        };
        const loadVertexServiceAccountText = async (slot = 'llm', raw = '') => {
            const selectors = vertexSlotSelectors(slot);
            const statusNode = overlay.querySelector(`[data-vertex-json-status="${slot}"]`);
            try {
                const credential = JSON.parse(String(raw || '').trim());
                if (!credential || typeof credential !== 'object' || Array.isArray(credential)) throw new Error('JSON object required');
                if (!credential.client_email || !credential.private_key) throw new Error('service account client_email/private_key missing');
                const projectId = vertexProjectIdFromCredential(credential);
                const providerEl = overlay.querySelector(selectors.provider);
                const urlEl = overlay.querySelector(selectors.url);
                const keyEl = overlay.querySelector(selectors.key);
                const modelEl = overlay.querySelector(selectors.model);
                const currentProvider = String(providerEl?.value || '').trim().toLowerCase();
                if (providerEl && !isVertexProviderValue(currentProvider, slot)) providerEl.value = selectors.defaultProvider;
                const nextProvider = String(providerEl?.value || selectors.defaultProvider || '').trim().toLowerCase();
                const suggestedUrl = vertexSuggestedUrlFor(nextProvider, projectId);
                if (urlEl && suggestedUrl && shouldReplaceVertexUrl(urlEl.value)) urlEl.value = suggestedUrl;
                if (keyEl) keyEl.value = JSON.stringify(credential);
                if (modelEl && !String(modelEl.value || '').trim()) modelEl.value = selectors.defaultModel;
                setVertexPreview(slot, 'project_id', projectId);
                setVertexPreview(slot, 'client_email', credential.client_email || '');
                setVertexPreview(slot, 'private_key', compactVertexPreview(credential.private_key || ''));
                syncVertexCredentialPanels();
                if (slot !== 'embedding') syncReasoningPresetUi(slot === 'aux' ? 'sax' : 'sl');
                if (statusNode) statusNode.textContent = `JSON 로드 완료: ${credential.client_email}`;
                toast('✅ Vertex 서비스 계정 JSON을 불러왔습니다. 설정 저장을 누르면 반영됩니다.');
            } catch (error) {
                if (statusNode) statusNode.textContent = `JSON 로드 실패: ${error?.message || error}`;
                toast(`❌ Vertex JSON 로드 실패: ${error?.message || error}`);
            }
        };
        const loadVertexServiceAccountFile = async (slot = 'llm', file = null) => {
            if (!file?.text) return;
            await loadVertexServiceAccountText(slot, await file.text());
        };

        const promptManualLorebookText = () => new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.style.position = 'fixed';
            backdrop.style.inset = '0';
            backdrop.style.background = 'rgba(0,0,0,0.55)';
            backdrop.style.display = 'flex';
            backdrop.style.alignItems = 'center';
            backdrop.style.justifyContent = 'center';
            backdrop.style.zIndex = '100000';

            const modal = document.createElement('div');
            modal.style.width = 'min(92vw, 680px)';
            modal.style.background = 'var(--bg)';
            modal.style.border = '1px solid var(--border)';
            modal.style.borderRadius = '12px';
            modal.style.padding = '14px';
            modal.style.boxShadow = '0 10px 32px rgba(0,0,0,0.45)';

            const title = document.createElement('div');
            title.textContent = '수동 로어북 추가';
            title.style.fontSize = '14px';
            title.style.fontWeight = '600';
            title.style.marginBottom = '8px';

            const hint = document.createElement('div');
            hint.textContent = '손요약, 정리 메모, 설정 문서를 그대로 붙여넣으면 원본은 lmai_user 로 저장되고, 메인 LLM이 분석해 LIBRA 데이터에 병합합니다.';
            hint.style.fontSize = '12px';
            hint.style.color = 'var(--text2)';
            hint.style.lineHeight = '1.5';
            hint.style.marginBottom = '10px';

            const textarea = document.createElement('textarea');
            textarea.className = 'ec';
            textarea.rows = 14;
            textarea.placeholder = '직접 정리한 요약, 설정, 인물 메모, 세계관 노트 등을 입력하세요.';
            textarea.style.width = '100%';
            textarea.style.resize = 'vertical';

            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.justifyContent = 'flex-end';
            actions.style.gap = '8px';
            actions.style.marginTop = '12px';

            const slotWrap = document.createElement('div');
            slotWrap.style.display = 'flex';
            slotWrap.style.alignItems = 'center';
            slotWrap.style.gap = '6px';
            slotWrap.style.marginRight = 'auto';

            const slotLabel = document.createElement('span');
            slotLabel.textContent = '저장 번호';
            slotLabel.style.fontSize = '12px';
            slotLabel.style.color = 'var(--text2)';

            const minusBtn = document.createElement('button');
            minusBtn.className = 'btn bd';
            minusBtn.textContent = '-';
            minusBtn.style.minWidth = '36px';

            const slotInput = document.createElement('input');
            slotInput.type = 'number';
            slotInput.min = '1';
            slotInput.step = '1';
            slotInput.value = '1';
            slotInput.style.width = '72px';

            const plusBtn = document.createElement('button');
            plusBtn.className = 'btn bs';
            plusBtn.textContent = '+';
            plusBtn.style.minWidth = '36px';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn bd';
            cancelBtn.textContent = '취소';
            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn bp';
            saveBtn.textContent = '저장';

            const close = (value) => {
                backdrop.remove();
                resolve(value);
            };
            const getSlotNumber = () => Math.max(1, parseInt(slotInput.value, 10) || 1);
            minusBtn.onclick = () => { slotInput.value = String(Math.max(1, getSlotNumber() - 1)); };
            plusBtn.onclick = () => { slotInput.value = String(getSlotNumber() + 1); };
            cancelBtn.onclick = () => close(null);
            saveBtn.onclick = () => {
                const text = String(textarea.value || '').trim();
                close(text ? { text, slotNumber: getSlotNumber() } : null);
            };
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) close(null);
            });

            slotWrap.appendChild(slotLabel);
            slotWrap.appendChild(minusBtn);
            slotWrap.appendChild(slotInput);
            slotWrap.appendChild(plusBtn);
            actions.appendChild(slotWrap);
            actions.appendChild(cancelBtn);
            actions.appendChild(saveBtn);
            modal.appendChild(title);
            modal.appendChild(hint);
            modal.appendChild(textarea);
            modal.appendChild(actions);
            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);
            textarea.focus();
        });
        const buildUserLorebookEntry = (text, slotNumber) => ({
            key: `lmai_user_${Math.max(1, parseInt(slotNumber, 10) || 1)}`,
            secondkey: 'user manual summary, libra user lorebook',
            comment: 'lmai_user',
            content: String(text || '').trim(),
            mode: 'normal',
            insertorder: 2,
            alwaysActive: true
        });
        const addManualUserLorebook = async () => {
            const payload = await promptManualLorebookText();
            if (!payload?.text) return;
            if (!char || !chat) throw new Error("채팅방을 찾을 수 없습니다.");

            try {
                const { targetChar, targetChat } = await resolveGuiTargetContext();
                const entry = buildUserLorebookEntry(payload.text, payload.slotNumber);
                const hasExistingSlot = lore.some(item => item?.comment === 'lmai_user' && String(item?.key || '') === entry.key);
                if (hasExistingSlot) {
                    const shouldOverwrite = await Utils.confirmEx('데이터가 덮어씌워집니다. 정말 저장하시겠습니까?');
                    if (!shouldOverwrite) {
                        toast('↩️ 수동 로어북 저장이 취소되었습니다');
                        return;
                    }
                }
                const nextLore = [
                    ...lore.filter(item => !(item?.comment === 'lmai_user' && String(item?.key || '') === entry.key)),
                    entry
                ];
                await saveLoreToChar(nextLore);
                syncGuiSnapshotsFromRuntime();

                await ColdStartManager.integrateImportedKnowledge(
                    [payload.text],
                    `User Lorebook #${entry.key.replace('lmai_user_', '')}`,
                    {
                        sourceId: 'user_lorebook',
                        updateNarrative: true,
                        worldNote: `Updated via User Lorebook #${entry.key.replace('lmai_user_', '')}`,
                        targetChar,
                        targetChat
                    }
                );

                lore = MemoryEngine.getLorebook(targetChar, targetChat) || lore;
                syncGuiSnapshotsFromRuntime();
                renderEnts();
                renderNarrative();
                renderWorld();
                filterMems();
                toast('✅ 수동 로어북 저장 및 병합 완료');
            } catch (e) {
                throw e;
            }
        };
        const syncGuiSnapshotsFromRuntime = () => {
            _MEM = lore.filter(e => e.comment === 'lmai_memory');
            _ENT = lore.filter(e => e.comment === 'lmai_entity');
            _REL = lore.filter(e => e.comment === 'lmai_relation');
            applyGuiEntityBlocklistToLocalSnapshots();
            _NAR = safeClone(NarrativeTracker.getState?.() || { storylines: [], turnLog: [], lastSummaryTurn: 0 });
            syncWorldSnapshotFromRuntime();
        };
        const syncWorldSnapshotFromRuntime = () => {
            const profile = HierarchicalWorldManager.getProfile();
            if (!profile) return;
            _WLD = {
                version: profile.version || '6.0',
                nodes: Array.from(profile.nodes.entries()),
                activePath: Array.isArray(profile.activePath) ? [...profile.activePath] : [],
                global: { ...(profile.global || {}) },
                interference: safeClone(profile.interference || { level: 0, recentEvents: [] }),
                meta: safeClone(profile.meta || {}),
                rootId: profile.rootId || null
            };
        };
        const getGuiEntityBlocklist = () => normalizeEntityBlocklistCollection(_CFG.entityBlocklist || MemoryEngine.CONFIG.entityBlocklist || []);
        const getGuiBlockedEntityLoreEntryName = (entry) => {
            try {
                const parsed = JSON.parse(entry?.content || '{}');
                return String(parsed?.name || '').trim();
            } catch {
                return '';
            }
        };
        const getGuiBlockedRelationNames = (entry) => {
            try {
                const parsed = JSON.parse(entry?.content || '{}');
                return [String(parsed?.entityA || '').trim(), String(parsed?.entityB || '').trim()].filter(Boolean);
            } catch {
                return [];
            }
        };
        const applyGuiEntityBlocklistToLocalSnapshots = () => {
            _ENT = _ENT.filter(entry => {
                const name = getGuiBlockedEntityLoreEntryName(entry);
                return !name || !EntityManager.isBlockedEntityName(name, lore);
            });
            _REL = _REL.filter(entry => {
                const names = getGuiBlockedRelationNames(entry);
                return !names.some(name => EntityManager.isBlockedEntityName(name, lore));
            });
        };
        const applyEntityBlocklistConfig = async (names, options = {}) => {
            const normalized = normalizeEntityBlocklistCollection(names);
            _CFG.entityBlocklist = normalized;
            MemoryEngine.CONFIG.entityBlocklist = normalized;
            applyGuiEntityBlocklistToLocalSnapshots();
            EntityManager.pruneBlockedEntries(lore);
            try {
                EntityCandidateCore?.prunePromotedOrBlocked?.(lore, {
                    source: 'gui.entityBlocklist',
                    blocklist: normalized
                });
            } catch (candidatePruneError) {
                if (MemoryEngine.CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA] Entity candidate blocklist prune skipped:', candidatePruneError?.message || candidatePruneError);
            }
            if (options.persist !== false) {
                await writeCommonPluginSettings(JSON.stringify(_CFG));
            }
            return normalized;
        };
        const persistGuiEntitySnapshots = async (successMessage = '') => {
            let newLore = [];
            _ENT.forEach(e => newLore.push(e));
            _REL.forEach(r => newLore.push(r));
            _MEM.forEach(m => newLore.push(m));
            await saveLoreToChar(buildFullManagedLoreSnapshot(newLore), () => {
                if (successMessage) toast(successMessage);
            });
        };
        const blockEntityFromGui = async (rawName, options = {}) => {
            const name = String(rawName || '').trim();
            if (!name) throw new Error('차단할 엔티티 이름이 비어 있습니다.');
            const canonical = EntityManager.normalizeName(name, lore) || name;
            const nextList = [...getGuiEntityBlocklist(), canonical];
            await applyEntityBlocklistConfig(nextList, { persist: true });
            if (options.removeStoredData !== false) {
                await persistGuiEntitySnapshots();
            }
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            return canonical;
        };
        const renameEntityAcrossRuntime = async (oldNameRaw, newNameRaw, options = {}) => {
            const oldName = String(oldNameRaw || '').trim();
            const newName = String(newNameRaw || '').trim();
            if (!oldName || !newName) throw new Error('기존 이름과 새 이름이 모두 필요합니다.');
            const { targetChar, targetChat } = await resolveGuiTargetContext();
            const scopeKey = getChatRuntimeScopeKey(targetChat, targetChar);
            const chatId = String(targetChat?.id || getActiveManagedChatId() || '').trim();
            const workingLore = MemoryEngine.getLorebook(targetChar, targetChat) || lore || [];
            lore = Array.isArray(workingLore) ? workingLore : [];
            effectiveGuiLore = MemoryEngine.getEffectiveLorebook(targetChar, targetChat) || lore;
            SecretKnowledgeCore.loadState(lore, { scopeKey, chatId });
            EntityKnowledgeVaultCore.loadState(lore, { scopeKey, chatId });
            TimeEngine.loadState(lore, { scopeKey, chatId });
            EntityManager.rebuildCache(lore);
            NarrativeTracker.loadState(lore);
            StoryAuthor.loadState(lore);
            Director.loadState(lore);
            CharacterStateTracker.loadState(lore);
            WorldStateTracker.loadState(lore);

            const oldCanonical = EntityManager.normalizeName(oldName, lore) || oldName;
            const newCanonical = String(newName || '').trim();
            if (!oldCanonical || !newCanonical) throw new Error('이름 정규화에 실패했습니다.');
            if (oldCanonical === newCanonical) return { ok: false, reason: 'same_name', oldName: oldCanonical, newName: newCanonical };
            const oldViewerId = SecretKnowledgeCore.entityViewerId(oldCanonical);
            const newViewerId = `entity:${newCanonical}`;
            const oldTimeKey = oldCanonical.toLowerCase();
            const newTimeKey = newCanonical.toLowerCase();
            const renameResult = EntityManager.renameEntity(oldCanonical, newCanonical, lore, {
                source: 'gui_rename',
                keepOldNameAsAlias: options.keepOldNameAsAlias
            });
            if (!renameResult?.ok) {
                throw new Error(`이름 변경 실패: ${renameResult?.reason || 'unknown'}`);
            }
            const renameContext = {
                oldName: renameResult.oldName || oldCanonical,
                newName: renameResult.newName || newCanonical,
                oldViewerId,
                newViewerId,
                previousNames: renameResult.previousNames || [oldCanonical]
            };
            SecretKnowledgeCore.renameEntityReferences?.(renameContext);
            EntityKnowledgeVaultCore.renameEntityViewer?.(renameContext);
            TimeEngine.renameEntityAnchor?.(oldCanonical, newCanonical, { oldKey: oldTimeKey, newKey: newTimeKey });
            NarrativeTracker.renameEntityReferences?.(oldCanonical, newCanonical, renameContext);
            StoryAuthor.renameEntityReferences?.(oldCanonical, newCanonical, renameContext);
            Director.renameEntityReferences?.(oldCanonical, newCanonical, renameContext);
            CharacterStateTracker.renameEntityKey?.(oldCanonical, newCanonical, renameContext);
            MemoryEngine.renameEntityReferencesInLore?.(lore, oldCanonical, newCanonical, { ...renameContext, scopeKey, currentTurn: MemoryEngine.getCurrentTurn?.() || 0 });

            await EntityManager.saveToLorebook(targetChar, targetChat, lore);
            await SecretKnowledgeCore.saveState(lore, { scopeKey, chatId });
            await EntityKnowledgeVaultCore.saveState(lore, { scopeKey, chatId });
            await TimeEngine.saveState(lore, { scopeKey, chatId });
            await NarrativeTracker.saveState(lore);
            await StoryAuthor.saveState?.(lore);
            await Director.saveState?.(lore);
            await CharacterStateTracker.saveState(lore);
            await WorldStateTracker.saveState(lore);
            await saveLoreToChar(lore);
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            return renameResult;
        };
        const markEntityAbsorptionFromGui = async (sourceNameRaw, targetNameRaw, options = {}) => {
            const sourceName = String(sourceNameRaw || '').trim();
            const targetName = String(targetNameRaw || '').trim();
            if (!sourceName || !targetName) throw new Error('흡수 소스와 대상 이름이 모두 필요합니다.');
            const { targetChar, targetChat } = await resolveGuiTargetContext();
            const scopeKey = getChatRuntimeScopeKey(targetChat, targetChar);
            const chatId = String(targetChat?.id || getActiveManagedChatId() || '').trim();
            const workingLore = MemoryEngine.getLorebook(targetChar, targetChat) || lore || [];
            lore = Array.isArray(workingLore) ? workingLore : [];
            effectiveGuiLore = MemoryEngine.getEffectiveLorebook(targetChar, targetChat) || lore;
            SecretKnowledgeCore.loadState(lore, { scopeKey, chatId });
            EntityKnowledgeVaultCore.loadState(lore, { scopeKey, chatId });
            TimeEngine.loadState(lore, { scopeKey, chatId });
            EntityManager.rebuildCache(lore);
            NarrativeTracker.loadState(lore);
            StoryAuthor.loadState(lore);
            Director.loadState(lore);
            CharacterStateTracker.loadState(lore);
            WorldStateTracker.loadState(lore);

            const result = EntityManager.markEntityAbsorption(sourceName, targetName, lore, {
                source: 'gui_absorption',
                reason: options.reason || 'manual_gui_absorption'
            });
            if (!result?.ok) throw new Error(`흡수 지정 실패: ${result?.reason || 'unknown'}`);
            await EntityManager.saveToLorebook(targetChar, targetChat, lore);
            await saveLoreToChar(lore);
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            return result;
        };
        const cancelEntityAbsorptionFromGui = async (sourceNameRaw) => {
            const sourceName = String(sourceNameRaw || '').trim();
            if (!sourceName) throw new Error('흡수 취소할 엔티티 이름이 비어 있습니다.');
            const { targetChar, targetChat } = await resolveGuiTargetContext();
            const workingLore = MemoryEngine.getLorebook(targetChar, targetChat) || lore || [];
            lore = Array.isArray(workingLore) ? workingLore : [];
            effectiveGuiLore = MemoryEngine.getEffectiveLorebook(targetChar, targetChat) || lore;
            EntityManager.rebuildCache(lore);
            const result = EntityManager.cancelEntityAbsorption(sourceName, lore);
            if (!result?.ok) throw new Error(`흡수 취소 실패: ${result?.reason || 'unknown'}`);
            await EntityManager.saveToLorebook(targetChar, targetChat, lore);
            await saveLoreToChar(lore);
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            return result;
        };
        const unblockEntityFromGui = async (rawName) => {
            const name = String(rawName || '').trim();
            if (!name) return '';
            const nextList = getGuiEntityBlocklist().filter(item => item !== name);
            await applyEntityBlocklistConfig(nextList, { persist: true });
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            toast(`✅ ${name} 차단 해제됨`);
            return name;
        };
        const persistWorldGraphFromGui = async (successMessage = '', renderAfterSave = true) => {
            let newLore = [];
            _ENT.forEach(e => newLore.push(e));
            _REL.forEach(r => newLore.push(r));
            _MEM.forEach(m => newLore.push(m));
            const nextLore = buildFullManagedLoreSnapshot(newLore);
            HierarchicalWorldManager.saveWorldGraphUnsafe?.(nextLore);
            await saveLoreToChar(nextLore, () => {
                if (renderAfterSave) renderWorld();
                if (successMessage) toast(successMessage);
            });
            return true;
        };
        const buildWorldFallbackFromText = (sourceText = '') => {
            const raw = String(sourceText || '').trim();
            // Fallback is intentionally non-inferential: when LLM extraction fails,
            // preserve source context for a retry/audit but never synthesize world
            // rules from local genre or keyword heuristics.
            return normalizeWorldRuleUpdate({
                classification: { primary: '' },
                exists: {},
                systems: {},
                physics: {},
                custom: {},
                __genreSourceText: truncateForLLM(raw, 2000, ' ... ')
            });
        };
        const readStructuredWorldFlagFromPayload = (worldPayload = {}, keys = []) => {
            const roots = [worldPayload?.global, worldPayload?.structure, worldPayload?.flags, worldPayload?.meta];
            for (const root of roots) {
                if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
                for (const key of keys) {
                    if (root[key] === true) return true;
                    if (root[key] === false) return false;
                }
            }
            return undefined;
        };
        const applyGlobalFlagsFromWorldSignals = (signalText = '', worldPayload = {}) => {
            const profile = HierarchicalWorldManager.getProfile?.();
            if (!profile?.global) return;
            const extractedSystems = worldPayload?.systems && typeof worldPayload.systems === 'object' ? worldPayload.systems : {};
            const applyFlag = (targetKey, sourceKeys) => {
                const value = readStructuredWorldFlagFromPayload(worldPayload, sourceKeys);
                if (value === true || value === false) profile.global[targetKey] = value;
            };
            applyFlag('multiverse', ['multiverse', 'multiVerse', 'multipleWorlds', 'multiple_worlds']);
            applyFlag('dimensionTravel', ['dimensionTravel', 'dimension_travel', 'interdimensionalTravel', 'interdimensional_travel']);
            applyFlag('timeTravel', ['timeTravel', 'time_travel', 'timeLoop', 'time_loop']);
            applyFlag('metaNarrative', ['metaNarrative', 'meta_narrative', 'fourthWall', 'fourth_wall']);
            applyFlag('virtualReality', ['virtualReality', 'virtual_reality', 'simulation']);
            applyFlag('dreamWorld', ['dreamWorld', 'dream_world']);
            applyFlag('reincarnationPossession', ['reincarnationPossession', 'reincarnation_possession', 'reincarnation', 'possession', 'transmigration']);
            const explicitSystemInterface = readStructuredWorldFlagFromPayload(worldPayload, ['systemInterface', 'system_interface']);
            const structuredSystemInterface = [
                extractedSystems.systemInterface,
                extractedSystems.system_interface,
                extractedSystems.leveling,
                extractedSystems.stats,
                extractedSystems.skills,
                extractedSystems.classes,
                extractedSystems.quests,
                extractedSystems.inventory
            ].some(value => value === true);
            if (explicitSystemInterface === true || explicitSystemInterface === false) {
                profile.global.systemInterface = explicitSystemInterface;
            } else if (structuredSystemInterface) {
                profile.global.systemInterface = true;
            }
        };
        const getWorldCorrectionNegations = (sourceText = '') => ({
            timeTravel: false,
            systemInterface: false,
            multiverse: false,
            dimensionTravel: false,
            metaNarrative: false,
            virtualReality: false,
            dreamWorld: false,
            reincarnationPossession: false,
            magic: false,
            ki: false,
            modern: false,
            medieval: false,
            future: false
        });
        const pruneWorldCustomEntriesByKeywords = (customRules, patterns = []) => {
            if (!customRules || typeof customRules !== 'object') return {};
            const next = {};
            for (const [key, value] of Object.entries(customRules)) {
                const keyText = String(key || '');
                const valueText = Array.isArray(value) ? value.join(' ') : String(value || '');
                const combined = `${keyText} ${valueText}`;
                if (patterns.some(pattern => pattern.test(combined))) continue;
                next[key] = value;
            }
            return next;
        };
        const mergeWorldCorrectionRules = (base, overlay) => {
            const target = (base && typeof base === 'object' && !Array.isArray(base)) ? safeClone(base) : {};
            const source = (overlay && typeof overlay === 'object' && !Array.isArray(overlay)) ? overlay : {};
            for (const [key, value] of Object.entries(source)) {
                if (Array.isArray(value)) {
                    target[key] = [...new Set([...(Array.isArray(target[key]) ? target[key] : []), ...value])];
                } else if (value && typeof value === 'object') {
                    const nextBase = (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) ? target[key] : {};
                    target[key] = mergeWorldCorrectionRules(nextBase, value);
                } else {
                    target[key] = value;
                }
            }
            return target;
        };
        const applyCorrectionPriorityWorldRules = (existingRules, interpretedWorld, correctionText = '') => {
            const baseRules = existingRules && typeof existingRules === 'object' ? safeClone(existingRules) : {};
            const merged = mergeWorldCorrectionRules(baseRules, normalizeWorldRuleUpdate(interpretedWorld || {}));
            return sanitizeWorldRuleUpdateForPolicy(merged, collectWorldRuleEvidenceText(interpretedWorld || {}, correctionText));
        };
        const interpretUserWorldCorrection = async (rawText) => {
            const correctionText = String(rawText || '').trim();
            if (!correctionText) return null;
            try {
                const analysisConfig = buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 1800 }).config;
                const currentWorldPrompt = HierarchicalWorldManager.formatForPrompt() || '(none)';
                const storedInfo = EntityAwareProcessor.formatStoredInfoForExtraction(8, {
                    conversationText: correctionText,
                    maxChars: 4200
                });
                let correctionLorebook = lore;
                try {
                    const correctionContext = await resolveGuiTargetContext();
                    correctionLorebook = MemoryEngine.getLorebook(correctionContext?.targetChar || char, correctionContext?.targetChat) || lore;
                } catch (contextError) {
                    recordRuntimeDebug('warn', '[LIBRA] User world correction lorebook fallback:', contextError?.message || contextError);
                }
                const extraction = await EntityAwareProcessor.extractFromConversation(
                    '[세계관 수동 보정 요청]\n사용자가 직접 입력한 세계관 수정 원문을 기반으로, 현재 세계 규칙을 다시 해석해 world JSON만 보정하라.',
                    [
                        '[User World Correction]',
                        correctionText,
                        '',
                        '[Current World Context]',
                        currentWorldPrompt
                ].join('\n'),
                storedInfo,
                analysisConfig,
                {
                    taskInstruction: '[세계관 수동 보정 요청]\n사용자가 직접 입력한 세계관 수정 원문을 기반으로, 현재 세계 규칙을 다시 해석해 world JSON만 보정하라.',
                    canonicalEvidenceText: [
                        '[User World Correction]',
                        correctionText,
                        '',
                        '[Current World Context]',
                        currentWorldPrompt
                    ].join('\n'),
                    evidenceLabel: 'Authoritative User World Correction',
                    evidencePolicy: false,
                    lorebook: Array.isArray(correctionLorebook) ? correctionLorebook : []
                }
            );
                let worldPayload = extraction?.success === false
                    ? buildWorldFallbackFromText(correctionText)
                    : (extraction?.world && typeof extraction.world === 'object'
                        ? extraction.world
                        : buildWorldFallbackFromText(correctionText));
                const verified = await EntityAwareProcessor.verifyTurnCorrections(
                    '[world correction]',
                    correctionText,
                    { entities: [], relations: [], world: worldPayload },
                    analysisConfig
                );
                if (verified?.world && Object.keys(verified.world).length > 0) {
                    worldPayload = {
                        ...worldPayload,
                        ...verified.world,
                        __genreSourceText: String(worldPayload?.__genreSourceText || correctionText).trim()
                    };
                }
                return {
                    ...safeClone(worldPayload),
                    ...normalizeWorldRuleUpdate(worldPayload)
                };
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] User world correction interpretation fallback:', e?.message || e);
                const fallbackWorld = buildWorldFallbackFromText(correctionText);
                return {
                    ...safeClone(fallbackWorld),
                    ...normalizeWorldRuleUpdate(fallbackWorld)
                };
            }
        };
        const saveWorldCorrectionFromGui = async () => {
            if (!_WLD || !Array.isArray(_WLD.nodes) || _WLD.nodes.length === 0) {
                throw new Error("세계관 데이터가 없습니다.");
            }
            const box = overlay.querySelector('#world-user-correction');
            const nextText = String(box?.value || '').trim();
            const activePath = Array.isArray(_WLD.activePath) && _WLD.activePath.length > 0 ? _WLD.activePath : [];
            const targetId = activePath[activePath.length - 1] || _WLD.rootId || (_WLD.nodes[0] && _WLD.nodes[0][0]);
            if (!targetId) throw new Error("현재 세계 노드를 찾을 수 없습니다.");
            const nodeIndex = _WLD.nodes.findIndex(entry => entry && entry[0] === targetId);
            if (nodeIndex < 0) throw new Error("현재 세계 노드를 찾을 수 없습니다.");
            const entry = _WLD.nodes[nodeIndex];
            const node = entry?.[1] && typeof entry[1] === 'object' ? safeClone(entry[1]) : {};
            node.meta = node.meta && typeof node.meta === 'object' ? safeClone(node.meta) : {};
            node.meta.worldMetadata = node.meta.worldMetadata && typeof node.meta.worldMetadata === 'object' ? safeClone(node.meta.worldMetadata) : {};
            node.meta.userWorldCorrection = nextText;
            node.meta.worldMetadata.userWorldCorrection = nextText;
            let interpretedWorld = null;
            if (nextText) {
                try {
                    interpretedWorld = await interpretUserWorldCorrection(nextText);
                } catch (e) {
                    recordRuntimeDebug('warn', '[LIBRA] saveWorldCorrectionFromGui interpretation skipped:', e?.message || e);
                    interpretedWorld = null;
                }
            }
            if (interpretedWorld) {
                const worldMetaPayload = buildWorldMetaPayload(interpretedWorld, node.meta || {});
                node.rules = applyCorrectionPriorityWorldRules(node.rules, interpretedWorld, nextText);
                node.meta.classification = worldMetaPayload.classification;
                node.meta.worldSummary = worldMetaPayload.worldSummary;
                node.meta.worldMetadata = {
                    ...(worldMetaPayload.worldMetadata || {}),
                    userWorldCorrection: nextText
                };
                applyGlobalFlagsFromWorldSignals(nextText, interpretedWorld);
            }
            node.meta.updated = Date.now();
            _WLD.nodes[nodeIndex] = [entry[0], node];

            const liveProfile = HierarchicalWorldManager.getProfile?.();
            if (liveProfile?.nodes instanceof Map && liveProfile.nodes.has(targetId)) {
                const liveUpdate = {
                    meta: {
                        userWorldCorrection: nextText,
                        worldMetadata: { userWorldCorrection: nextText }
                    }
                };
                if (interpretedWorld) {
                    const worldMetaPayload = buildWorldMetaPayload(interpretedWorld, liveProfile.nodes.get(targetId)?.meta || {});
                    liveUpdate.rules = applyCorrectionPriorityWorldRules(liveProfile.nodes.get(targetId)?.rules, interpretedWorld, nextText);
                    liveUpdate.meta = {
                        ...liveUpdate.meta,
                        classification: worldMetaPayload.classification,
                        worldSummary: worldMetaPayload.worldSummary,
                        worldMetadata: {
                            ...(worldMetaPayload.worldMetadata || {}),
                            userWorldCorrection: nextText
                        }
                    };
                }
                HierarchicalWorldManager.updateNode(targetId, liveUpdate);
            }
            syncWorldSnapshotFromRuntime();
            await persistWorldGraphFromGui(nextText ? "💾 세계관 보정 저장 완료" : "🧹 세계관 보정 삭제 완료", true);
            return true;
        };
        const stringifyWorldSourceValue = (value) => {
            if (value == null) return '';
            if (typeof value === 'string') return value.trim();
            if (Array.isArray(value)) {
                return value.map(item => stringifyWorldSourceValue(item)).filter(Boolean).join('\n');
            }
            if (typeof value === 'object') {
                try { return JSON.stringify(value, null, 2); }
                catch { return String(value || '').trim(); }
            }
            return String(value || '').trim();
        };
        const collectCharacterWorldSourceTexts = (targetChar = null, targetChat = null) => {
            const texts = [];
            const seen = new Set();
            const pushSource = (label, value, maxChars = 3000) => {
                const raw = stringifyWorldSourceValue(value);
                if (!raw) return;
                const signature = `${label}:${TokenizerEngine.simpleHash(raw)}`;
                if (seen.has(signature)) return;
                seen.add(signature);
                texts.push(`[${label}]\n${truncateForLLM(raw, maxChars, ' ...[TRUNCATED]... ')}`);
            };
            if (targetChar && typeof targetChar === 'object') {
                pushSource('Character Name', targetChar.name || targetChar.displayName, 300);
                pushSource('Character Description', targetChar.description || targetChar.desc || targetChar.detail || targetChar.details, 4000);
                pushSource('Character Personality', targetChar.personality || targetChar.persona || targetChar.traits, 2500);
                pushSource('Scenario', targetChar.scenario || targetChar.situation || targetChar.context, 3000);
                pushSource('First Message', targetChar.firstMessage || targetChar.first_message || targetChar.greeting, 2200);
                pushSource('Creator Notes', targetChar.creatorNotes || targetChar.creator_notes || targetChar.note || targetChar.notes, 2500);
                pushSource('Default Variables', targetChar.defaultVariables, 2200);
            }
            try {
                const effectiveLore = MemoryEngine.getEffectiveLorebook(targetChar, targetChat) || [];
                effectiveLore
                    .filter(entry => !entry?.comment || !String(entry.comment).startsWith('lmai_'))
                    .slice(0, 24)
                    .forEach((entry, index) => {
                        const key = [entry?.key, entry?.secondkey].map(v => String(v || '').trim()).filter(Boolean).join(' / ');
                        const title = key || entry?.comment || entry?.id || `entry-${index + 1}`;
                        pushSource(`Character Lorebook: ${title}`, entry?.content || '', 2600);
                    });
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Character world source lore collection failed:', e?.message || e);
            }
            return texts.slice(0, 32);
        };
        const buildCharacterWorldSourceBundle = (targetChar = null, targetChat = null, maxChars = 10000) => {
            const sourceTexts = collectCharacterWorldSourceTexts(targetChar, targetChat);
            return {
                count: sourceTexts.length,
                context: sourceTexts.length > 0
                    ? truncateForLLM(sourceTexts.join('\n\n'), maxChars, '\n...[TRUNCATED CHARACTER WORLD SOURCES]...\n')
                    : ''
            };
        };
        const reanalyzeWorldFromChat = async () => {
            const { targetChat: activeChat } = await resolveGuiTargetContext();
            if (!char || !activeChat) throw new Error("채팅방을 찾을 수 없습니다.");
            const msgs = ColdStartManager.buildAnalyzableMessages(activeChat);
            if (msgs.length === 0) throw new Error("재분석할 대화 내역이 없습니다.");

            const transcript = buildAssistantCanonicalTranscript(msgs, {
                maxChars: 12000,
                perItemChars: 1800,
                includeTurn: false
            });
            if (!transcript) throw new Error("세계관 재분석에 사용할 assistant 정본 응답이 없습니다.");
            const analysisConfig = buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 1800 }).config;
            const sourceBundle = buildCharacterWorldSourceBundle(char, activeChat, 10000);
            const retrievedWorldLoreCues = await CharacterLoreCueIndex.search(char, activeChat, transcript, {
                limit: 10,
                buckets: ['world', 'relation', 'narrative'],
                allowQueryEmbedding: true
            });
            const worldLoreCueBlock = CharacterLoreCueIndex.format(retrievedWorldLoreCues.items, {
                title: 'Retrieved Character/Lorebook World Cues',
                maxChars: 4200,
                itemChars: 520,
                policy: 'Lower-priority retrieved cues from the character card/lorebook cue index. Use these for persistent genre, era, location, social rules, organizations, technology level, supernatural/system absence, and recurring world constraints. Manual world correction and stored current world rules outrank these cues. Do not treat style/output instructions or one-off emotion as world rules.'
            });
            const worldMemoryHints = AnalysisMemoryHintBridge.build(MemoryEngine.getLorebook(char, activeChat) || lore, transcript, {
                limit: 8,
                maxChars: 240,
                purpose: 'world_reanalysis'
            });
            const worldMemoryHintBlock = AnalysisMemoryHintBridge.format(worldMemoryHints, {
                title: 'Long-Term Compact Memory Hints for World Reanalysis',
                policy: 'Lower-priority compact memory hints. Use only for recurring setting constraints, genre continuity, organization rules, persistent social rules, and repeated world facts. Never treat old mood, one-off metaphor, or isolated wording as a new world rule. Manual world correction and stored current world rules outrank these hints.'
            });
            const worldAnalysisInput = [
                worldLoreCueBlock || (sourceBundle.context ? `[Character Description and Character Lorebook]\n${sourceBundle.context}` : ''),
                worldMemoryHintBlock,
                `[Canonical Assistant Evidence]\n${transcript}`
            ].filter(Boolean).join('\n\n');
            const userWorldCorrection = String(HierarchicalWorldManager.getUserWorldCorrection?.() || '').trim();
            const currentWorldPrompt = HierarchicalWorldManager.formatForPrompt() || '';
            const buildWorldFallbackFromTranscript = (sourceText) => ({
                classification: { primary: '' },
                exists: {},
                systems: {},
                physics: {},
                custom: {},
                __genreSourceText: truncateForLLM(String(sourceText || '').trim(), 6000, '\n...[TRUNCATED WORLD SOURCE]...\n')
            });
            const storedInfo = EntityAwareProcessor.formatStoredInfoForExtraction(8, {
                conversationText: worldAnalysisInput,
                maxChars: 4600
            });
            const extraction = await EntityAwareProcessor.extractFromConversation(
                [
                    '[세계관 재분석 요청]',
                    '캐릭터 설명, 캐릭터 로어북, 현재 채팅 로그의 assistant 정본 근거를 기준으로 현재 세계 규칙만 다시 추출하라.',
                    '유저 입력은 발생 사실의 근거가 아니다. assistant evidence에서 확인되지 않은 장소 이동, 행동 결과, 세계 규칙은 확정하지 말라.',
                    '세계관의 장르, 물리 법칙, 초자연/시스템/기술 수준처럼 캐릭터 설명이나 로어북에 명시된 설정은 대화의 일회성 표현보다 우선 참고하라.',
                    worldLoreCueBlock ? `캐릭터/로어북 세계관 cue ${retrievedWorldLoreCues.count}개가 [Retrieved Character/Lorebook World Cues] 블록으로 제공된다.` : (sourceBundle.context ? `캐릭터 세계관 소스 ${sourceBundle.count}개가 [Character Description and Character Lorebook] 블록으로 제공된다.` : '캐릭터 세계관 소스가 없으면 기존처럼 대화 로그와 저장된 세계 규칙을 기준으로 판단하라.'),
                    currentWorldPrompt ? `\n[현재 저장된 세계 규칙]\n${currentWorldPrompt}\n일회성 표현보다 이 누적 세계 규칙과 반복 등장 신호를 우선 참고하라.` : '',
                    userWorldCorrection ? `\n[사용자 직접 세계관 보정]\n${userWorldCorrection}\n이 보정과 충돌하는 자동 추론은 버리고, 가능하면 이 보정을 반영하라.` : ''
                ].join('\n'),
                transcript,
                storedInfo,
                analysisConfig,
                {
                    taskInstruction: [
                        '[세계관 재분석 요청]',
                        'assistant 정본 응답, 캐릭터/로어북 세계관 cue, 장기 메모리 hint를 기준으로 세계 규칙만 추출하라.',
                        '유저 요청만 있는 사건이나 장소 이동은 세계 상태로 확정하지 말라.'
                    ].join('\n'),
                    canonicalEvidenceText: transcript,
                    characterEntityHintBlock: worldLoreCueBlock || (sourceBundle.context ? `[Character Description and Character Lorebook]\n${sourceBundle.context}` : ''),
                    memoryHints: worldMemoryHints,
                    memoryHintTitle: 'Long-Term Compact Memory Hints for World Reanalysis',
                    lorebook: MemoryEngine.getLorebook(char, activeChat) || lore
                }
            );

            const worldPayload = extraction?.success === false
                ? buildWorldFallbackFromTranscript(worldAnalysisInput)
                : (extraction?.world && typeof extraction.world === 'object'
                    ? extraction.world
                    : buildWorldFallbackFromTranscript(worldAnalysisInput));
            if (!String(worldPayload.__genreSourceText || '').trim()) {
                worldPayload.__genreSourceText = truncateForLLM(worldAnalysisInput, 6000, '\n...[TRUNCATED WORLD SOURCE]...\n');
            }
            if (Object.keys(worldPayload).length === 0 && !String(worldPayload.__genreSourceText || '').trim()) {
                throw new Error("세계관 재분석 결과가 비어 있습니다.");
            }
            const extractedSystems = worldPayload?.systems && typeof worldPayload.systems === 'object'
                ? worldPayload.systems
                : {};

            await EntityAwareProcessor.applyExtractions({
                entities: [],
                relations: [],
                world: worldPayload,
                conflicts: [],
                sourceMode: 'correction'
            }, lore, analysisConfig, null);

            const profile = HierarchicalWorldManager.getProfile();
            if (profile?.global) {
                applyGlobalFlagsFromWorldSignals('', worldPayload);
            }

            syncWorldSnapshotFromRuntime();
            await persistWorldGraphFromGui("🔄 세계관 재분석 완료", true);
            lore = MemoryEngine.getLorebook(char, activeChat) || lore;
            syncGuiSnapshotsFromRuntime();
        };
        const buildReplayableTurnPairs = (msgs, chat = null) => {
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
                const userText = getStrictNarrativeUserText(pendingUser.text || Utils.getMessageText(pendingUser.msg) || '');
                const aiText = pendingAssistantParts.join('\n\n').trim();
                if (!aiText) {
                    pendingAssistantParts = [];
                    pendingAssistantMsgs = [];
                    return;
                }
                if (Utils.shouldBypassNarrativeSystems('', aiText)) {
                    pendingAssistantParts = [];
                    pendingAssistantMsgs = [];
                    return;
                }
                const normalizedTurn = normalizeLegacyMemoryTurnAnchor(pendingUser.turn || pairs.length + 1) || pairs.length + 1;
                const combined = `${userText || ''}\n${aiText || ''}`.trim();
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
                const messageSignature = compactTurnMessageSignature(getMessageSignature(primaryAssistantMsg) || `ai::reanalysis::${normalizedTurn}::${sourceHash}`);
                const userTurnKey = buildLogicalUserTurnKey(userText, userText, false);
                const turnKey = buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, messageSignature, liveMessageIds);
                pairs.push({
                    turn: normalizedTurn,
                    userText: userText || '',
                    aiText,
                    canonicalEvidenceText: aiText,
                    userRequestMetadata: userText || '',
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
                    sourceMessage: primaryAssistantMsg,
                    index: primaryIndex
                });
                pendingUser = null;
                pendingAssistantParts = [];
                pendingAssistantMsgs = [];
            };
            for (let i = 0; i < source.length; i++) {
                const item = source[i];
                if (!item) continue;
                const rawMsg = unwrapAnalyzableMessage(item);
                const roleHint = getMessageRoleHint(item);
                const isUser = roleHint === 'user';
                const rawText = getAnalyzableMessageText(item);
                if (isUser) {
                    flushPendingPair();
                    turn += 1;
                    pendingUser = { msg: rawMsg, index: i, text: rawText || '', turn, roleHint };
                    continue;
                }
                const aiText = Utils.getNarrativeComparableText(rawText, 'ai');
                if (!aiText) continue;
                if (!pendingUser) continue;
                pendingAssistantParts.push(aiText);
                pendingAssistantMsgs.push({ msg: rawMsg, index: i, roleHint });
            }
            flushPendingPair();
            return pairs;
        };
        const normalizeReanalysisTurnLimit = (value, fallback = 20) => {
            const parsed = parseInt(value, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
            return Math.max(1, Math.min(200, Math.floor(parsed)));
        };
        const readReanalysisTurnLimit = (selector, fallback = 20) => {
            const value = overlay.querySelector(selector)?.value;
            return normalizeReanalysisTurnLimit(value, fallback);
        };
        const getRecentReplayableTurnPairs = (msgs, turnLimit = 20, chat = null) => {
            const allPairs = buildReplayableTurnPairs(msgs, chat);
            const limit = normalizeReanalysisTurnLimit(turnLimit, 20);
            const turnPairs = allPairs.slice(-limit);
            return {
                allPairs,
                turnPairs,
                startIndex: Math.max(0, allPairs.length - turnPairs.length),
                limit
            };
        };
        const buildTurnPairTranscript = (pairs, options = {}) => {
            const {
                baseTurn = 1,
                startIndex = 0,
                turnByIndex = [],
                maxTurn = 0,
                maxChars = 12000,
                evidenceMode = 'assistant_canonical'
            } = options || {};
            if (String(evidenceMode || '').trim().toLowerCase() === 'assistant_canonical') {
                return buildAssistantCanonicalTranscriptFromPairs(pairs, {
                    baseTurn,
                    startIndex,
                    turnByIndex,
                    maxTurn,
                    maxChars,
                    perItemChars: 2400
                });
            }
            const safeMaxTurn = normalizeLegacyMemoryTurnAnchor(maxTurn || 0) || 0;
            const blocks = (Array.isArray(pairs) ? pairs : []).map((pair, idx) => {
                const mappedTurn = normalizeLegacyMemoryTurnAnchor(Array.isArray(turnByIndex) ? turnByIndex[idx] : 0);
                const rawTurn = mappedTurn || normalizeLegacyMemoryTurnAnchor(pair?.turn) || (baseTurn + startIndex + idx);
                const turn = safeMaxTurn ? Math.min(rawTurn, safeMaxTurn) : rawTurn;
                return [
                    `[Turn ${turn}]`,
                    pair?.userText ? `[User]\n${truncateForLLM(pair.userText, 1600, '\n...[TRUNCATED]...\n')}` : '',
                    pair?.aiText ? `[Assistant]\n${truncateForLLM(pair.aiText, 2400, '\n...[TRUNCATED]...\n')}` : ''
                ].filter(Boolean).join('\n');
            }).filter(Boolean);
            return truncateForLLM(blocks.join('\n\n'), maxChars, '\n...[TRUNCATED]...\n');
        };
        const buildReanalysisTurnContext = (replay = {}, currentTurnValue = 0) => {
            const pairs = Array.isArray(replay?.turnPairs) ? replay.turnPairs : [];
            const currentTurn = Math.max(
                1,
                normalizeLegacyMemoryTurnAnchor(currentTurnValue || 0)
                    || normalizeLegacyMemoryTurnAnchor(MemoryEngine.getCurrentTurn?.() || 0)
                    || pairs.length
                    || 1
            );
            const baseTurn = Math.max(1, currentTurn - pairs.length + 1);
            const turnByIndex = pairs.map((pair, idx) => {
                const anchoredTurn = normalizeLegacyMemoryTurnAnchor(pair?.turn || 0);
                if (anchoredTurn > 0 && anchoredTurn <= currentTurn) return anchoredTurn;
                return Math.min(currentTurn, baseTurn + idx);
            });
            const allowedTurns = Array.from(new Set(turnByIndex.map(turn => normalizeLegacyMemoryTurnAnchor(turn)).filter(Boolean)))
                .sort((a, b) => a - b);
            return {
                currentTurn,
                maxTurn: currentTurn,
                baseTurn,
                startIndex: 0,
                turnByIndex,
                allowedTurns,
                latestTurn: allowedTurns[allowedTurns.length - 1] || currentTurn
            };
        };
        const resolveReanalysisTurnAtIndex = (idx = 0, options = {}) => {
            const index = Math.max(0, Math.floor(Number(idx || 0)));
            const maxTurn = normalizeLegacyMemoryTurnAnchor(options?.maxTurn || options?.currentTurn || MemoryEngine.getCurrentTurn?.() || 0) || 0;
            const mapped = normalizeLegacyMemoryTurnAnchor(Array.isArray(options?.turnByIndex) ? options.turnByIndex[index] : 0);
            if (mapped) return maxTurn ? Math.min(mapped, maxTurn) : mapped;
            const fallback = normalizeLegacyMemoryTurnAnchor((Number(options?.baseTurn || 1) || 1) + index);
            return maxTurn ? Math.min(fallback || maxTurn, maxTurn) : (fallback || 1);
        };
        const normalizeNarrativeSupplementEvidenceTurns = (candidate = {}, options = {}) => {
            const maxTurn = normalizeLegacyMemoryTurnAnchor(options?.maxTurn || options?.currentTurn || MemoryEngine.getCurrentTurn?.() || 0) || 0;
            const allowedTurns = Array.isArray(options?.allowedTurns)
                ? Array.from(new Set(options.allowedTurns.map(turn => normalizeLegacyMemoryTurnAnchor(turn)).filter(Boolean))).sort((a, b) => a - b)
                : [];
            const allowedSet = new Set(allowedTurns);
            const fallbackTurn = normalizeLegacyMemoryTurnAnchor(options?.fallbackTurn || options?.turn || 0)
                || resolveReanalysisTurnAtIndex(options?.candidateIndex || 0, options)
                || allowedTurns[allowedTurns.length - 1]
                || maxTurn
                || 1;
            const rawTurns = [
                ...(Array.isArray(candidate?.evidenceTurns) ? candidate.evidenceTurns : []),
                candidate?.turn,
                candidate?.sourceTurn,
                candidate?.upToTurn
            ];
            let turns = [];
            for (const rawTurn of rawTurns) {
                const turn = normalizeLegacyMemoryTurnAnchor(rawTurn);
                if (!turn) continue;
                if (maxTurn && turn > maxTurn) continue;
                if (allowedSet.size > 0 && !allowedSet.has(turn)) continue;
                if (!turns.includes(turn)) turns.push(turn);
            }
            if (turns.length === 0 && fallbackTurn) {
                const safeFallback = maxTurn ? Math.min(fallbackTurn, maxTurn) : fallbackTurn;
                if (!allowedSet.size || allowedSet.has(safeFallback)) turns.push(safeFallback);
                else if (allowedTurns.length > 0) turns.push(allowedTurns[allowedTurns.length - 1]);
            }
            return Array.from(new Set(turns.map(turn => maxTurn ? Math.min(turn, maxTurn) : turn).filter(Boolean))).slice(0, 8);
        };
        const clampNarrativeSupplementStateTurns = (state = {}, maxTurnValue = 0) => {
            const maxTurn = normalizeLegacyMemoryTurnAnchor(maxTurnValue || 0);
            if (!state || typeof state !== 'object' || !maxTurn || !Array.isArray(state.storylines)) return state;
            state.storylines = state.storylines.map(storyline => {
                if (!storyline || typeof storyline !== 'object') return storyline;
                const next = { ...storyline };
                next.turns = Array.from(new Set((Array.isArray(next.turns) ? next.turns : [])
                    .map(turn => normalizeLegacyMemoryTurnAnchor(turn))
                    .filter(Boolean)
                    .map(turn => Math.min(turn, maxTurn)))).sort((a, b) => a - b);
                if (Array.isArray(next.recentEvents)) {
                    next.recentEvents = next.recentEvents.map(event => {
                        if (!event || typeof event !== 'object') return event;
                        const turn = normalizeLegacyMemoryTurnAnchor(event.turn || 0);
                        return { ...event, turn: turn ? Math.min(turn, maxTurn) : maxTurn };
                    }).filter(event => normalizeLegacyMemoryTurnAnchor(event?.turn || 0));
                }
                if (Array.isArray(next.summaries)) {
                    next.summaries = next.summaries.map(summary => {
                        if (!summary || typeof summary !== 'object') return summary;
                        const upToTurn = normalizeLegacyMemoryTurnAnchor(summary.upToTurn || 0);
                        const evidenceTurns = Array.isArray(summary.evidenceTurns)
                            ? Array.from(new Set(summary.evidenceTurns
                                .map(turn => normalizeLegacyMemoryTurnAnchor(turn))
                                .filter(Boolean)
                                .map(turn => Math.min(turn, maxTurn)))).sort((a, b) => a - b)
                            : [];
                        return {
                            ...summary,
                            upToTurn: upToTurn ? Math.min(upToTurn, maxTurn) : (evidenceTurns[evidenceTurns.length - 1] || maxTurn),
                            evidenceTurns
                        };
                    }).filter(summary => normalizeLegacyMemoryTurnAnchor(summary?.upToTurn || 0));
                }
                const observedTurns = [
                    ...(Array.isArray(next.turns) ? next.turns : []),
                    ...(Array.isArray(next.recentEvents) ? next.recentEvents.map(event => event?.turn) : []),
                    ...(Array.isArray(next.summaries) ? next.summaries.map(summary => summary?.upToTurn) : [])
                ].map(turn => normalizeLegacyMemoryTurnAnchor(turn)).filter(Boolean);
                if (observedTurns.length > 0) {
                    next.firstTurn = Math.min(...observedTurns);
                    next.lastTurn = Math.min(maxTurn, Math.max(...observedTurns));
                } else {
                    next.firstTurn = Math.min(normalizeLegacyMemoryTurnAnchor(next.firstTurn || maxTurn) || maxTurn, maxTurn);
                    next.lastTurn = Math.min(normalizeLegacyMemoryTurnAnchor(next.lastTurn || next.firstTurn || maxTurn) || maxTurn, maxTurn);
                }
                return next;
            }).filter(Boolean);
            return state;
        };
        const buildEntityReanalysisNameVariants = (name = '') => {
            const raw = String(name || '').replace(/[“”"'`‘’]/g, '').trim();
            if (!raw) return [];
            const variants = new Set([raw]);
            const bilingual = raw.match(/^([^()[\]]+?)\s*\(([^()]+?)\)\s*$/);
            if (bilingual) {
                variants.add(String(bilingual[1] || '').trim());
                variants.add(String(bilingual[2] || '').trim());
            }
            raw
                .replace(/[()[\]]/g, ' ')
                .split(/\s*\/\s*|\s*\|\s*|\s*;\s*|\s*,\s*|\s*[·・]\s*|\s+/)
                .map(part => String(part || '').trim())
                .filter(Boolean)
                .forEach(part => variants.add(part));
            for (const variant of Array.from(variants)) {
                const compact = String(variant || '').replace(/\s+/g, '').trim();
                if (compact) variants.add(compact);
            }
            return dedupeTextArray(Array.from(variants).map(value => String(value || '').trim()).filter(value => value.length >= 2));
        };
        const escapeEntityReanalysisRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const KOREAN_ENTITY_REANALYSIS_PARTICLES = '(?:에게서는|에게서|에게는|에게|한테서는|한테서|한테는|한테|께서는|께서|께|으로서는|으로서|로서는|로서|으로써|로써|으로는|으로|에서는|에서|부터|까지|처럼|하고|이며|이랑|랑|은|는|이|가|을|를|의|도|와|과|로|만|에)';
        const hasEntityReanalysisMentionEvidence = (variant = '', conversationText = '') => {
            const rawVariant = String(variant || '').trim();
            const text = String(conversationText || '');
            if (!rawVariant || !text.trim()) return false;
            const escaped = escapeEntityReanalysisRegex(rawVariant);
            if (!escaped) return false;
            const isHangul = /^[가-힣]+$/.test(rawVariant);
            const pattern = isHangul
                ? new RegExp(`(^|[^가-힣])${escaped}(?:${KOREAN_ENTITY_REANALYSIS_PARTICLES})?(?=$|[^가-힣])`, 'u')
                : new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'iu');
            return pattern.test(text);
        };
        const hasEntityReanalysisConversationEvidence = (name = '', conversationText = '') => {
            const text = String(conversationText || '');
            if (!text.trim()) return false;
            return buildEntityReanalysisNameVariants(name)
                .some(variant => hasEntityReanalysisMentionEvidence(variant, text));
        };
        const normalizeEntitySupplementPayload = (extraction, workingLore = [], options = {}) => {
            EntityManager.rebuildCache(workingLore);
            const entityCache = EntityManager.getEntityCache();
            const relationCache = EntityManager.getRelationCache();
            const conversationText = String(options?.conversationText || extraction?.conversationText || '').trim();
            const requireConversationEvidence = options?.requireConversationEvidence === true;
            const requireConversationEvidenceForKnown = options?.requireConversationEvidenceForKnown === true;
            const extractionForSupplement = typeof EntityAwareProcessor?.sanitizeExtractionPayload === 'function'
                ? EntityAwareProcessor.sanitizeExtractionPayload(extraction, workingLore, {
                    sourceMode: options?.sourceMode || extraction?.sourceMode || 'reanalysis_supplement',
                    conversationText,
                    requireConversationEvidenceForNew: requireConversationEvidence,
                    requireConversationEvidenceForKnown
                })
                : extraction;
            const acceptedEntityNames = new Set();
            const buildSupplementEvidenceNames = (name = '') => {
                const normalized = EntityManager.normalizeName(name || '', workingLore) || String(name || '').trim();
                const names = new Set([name, normalized].map(value => String(value || '').trim()).filter(Boolean));
                const existing = normalized ? entityCache.get(normalized) : null;
                if (existing) {
                    names.add(String(existing.name || '').trim());
                    (Array.isArray(existing.meta?.aliases) ? existing.meta.aliases : [])
                        .map(value => String(value || '').trim())
                        .filter(Boolean)
                        .forEach(value => names.add(value));
                    (Array.isArray(existing.meta?.hiddenNameKeys) ? existing.meta.hiddenNameKeys : [])
                        .map(value => String(value || '').trim())
                        .filter(value => /^[가-힣]{2,4}$/.test(value))
                        .forEach(value => names.add(value));
                }
                return dedupeTextArray(Array.from(names).filter(Boolean));
            };
            const hasSupplementConversationEvidence = (name = '') => {
                return buildSupplementEvidenceNames(name)
                    .some(candidate => hasEntityReanalysisConversationEvidence(candidate, conversationText));
            };
            const isAllowedEntitySupplementName = (name = '') => {
                const normalized = EntityManager.normalizeName(name || '', workingLore) || String(name || '').trim();
                if (!normalized) return false;
                if (!requireConversationEvidence) return true;
                if (entityCache.has(normalized) && !requireConversationEvidenceForKnown) return true;
                return hasSupplementConversationEvidence(normalized);
            };
            const entities = (Array.isArray(extractionForSupplement?.entities) ? extractionForSupplement.entities : []).map(entity => {
                const next = safeClone(entity || {});
                const name = EntityManager.normalizeName(next.name || '', workingLore) || String(next.name || '').trim();
                if (!name) return null;
                if (!isAllowedEntitySupplementName(name)) return null;
                next.name = name;
                next.aliases = dedupeTextArray([
                    ...(Array.isArray(next.aliases) ? next.aliases : []),
                    ...buildSupplementEvidenceNames(name)
                ]);
                acceptedEntityNames.add(String(name).toLowerCase());
                const existing = entityCache.get(name);
                if (next.status && typeof next.status === 'object' && !Array.isArray(next.status)) {
                    const status = { ...next.status };
                    for (const key of ['currentLocation', 'currentMood', 'healthStatus']) {
                        if (existing?.status?.[key] && status[key]) delete status[key];
                    }
                    if (Object.values(status).some(value => String(value || '').trim())) next.status = status;
                    else delete next.status;
                }
                return next;
            }).filter(Boolean);
            const relations = (Array.isArray(extractionForSupplement?.relations) ? extractionForSupplement.relations : []).map(relation => {
                const next = safeClone(relation || {});
                if (!next.entityA || !next.entityB) return null;
                const entityA = EntityManager.normalizeName(next.entityA || '', workingLore) || String(next.entityA || '').trim();
                const entityB = EntityManager.normalizeName(next.entityB || '', workingLore) || String(next.entityB || '').trim();
                if (!entityA || !entityB) return null;
                if (requireConversationEvidence) {
                    const allowedA = acceptedEntityNames.has(entityA.toLowerCase()) || isAllowedEntitySupplementName(entityA);
                    const allowedB = acceptedEntityNames.has(entityB.toLowerCase()) || isAllowedEntitySupplementName(entityB);
                    if (!allowedA || !allowedB) return null;
                }
                next.entityA = entityA;
                next.entityB = entityB;
                const relationId = EntityManager.makeRelationId(next.entityA, next.entityB, workingLore);
                const existing = relationCache.get(relationId);
                if (existing) {
                    if (existing.relationType && (next.relationType || next.type)) {
                        delete next.relationType;
                        delete next.type;
                    }
                    if (next.sentiments && typeof next.sentiments === 'object' && !Array.isArray(next.sentiments)) {
                        const sentiments = { ...next.sentiments };
                        for (const key of ['fromAtoB', 'fromBtoA']) {
                            if (existing?.sentiments?.[key] && sentiments[key]) delete sentiments[key];
                        }
                        if (Object.values(sentiments).some(value => String(value || '').trim())) next.sentiments = sentiments;
                        else delete next.sentiments;
                    }
                }
                return next;
            }).filter(Boolean);
            return { entities, relations };
        };
        const normalizeNarrativeSupplementState = (state = {}) => ({
            storylines: Array.isArray(state?.storylines) ? state.storylines : [],
            turnLog: Array.isArray(state?.turnLog) ? state.turnLog : [],
            lastSummaryTurn: Number(state?.lastSummaryTurn || 0)
        });
        const normalizeNarrativeCandidateEntities = (items) => dedupeTextArray(
            (Array.isArray(items) ? items : [])
                .map(item => typeof item === 'string' ? item : item?.name)
                .map(item => EntityManager.normalizeName(item || '') || item)
                .map(item => String(item || '').trim())
                .filter(Boolean)
        ).slice(0, 10);
        const scoreNarrativeStorylineMatch = (storyline, candidate = {}) => {
            const candidateEntities = normalizeNarrativeCandidateEntities(candidate.entities);
            const storylineEntities = normalizeNarrativeCandidateEntities(storyline?.entities);
            const overlap = candidateEntities.filter(entity => storylineEntities.includes(entity)).length;
            const entityScore = candidateEntities.length > 0 ? overlap / candidateEntities.length : 0;
            const candidateName = String(candidate?.name || '').trim().toLowerCase();
            const storylineName = String(storyline?.name || '').trim().toLowerCase();
            const nameScore = candidateName && storylineName && (candidateName.includes(storylineName) || storylineName.includes(candidateName)) ? 0.25 : 0;
            return entityScore + nameScore;
        };
        const findNarrativeSupplementTarget = (state, candidate = {}) => {
            let best = null;
            let bestScore = 0;
            for (const storyline of state.storylines || []) {
                const score = scoreNarrativeStorylineMatch(storyline, candidate);
                if (score > bestScore) {
                    best = storyline;
                    bestScore = score;
                }
            }
            return bestScore >= 0.3 ? best : null;
        };
        const pushUniqueLimited = (items, additions, limit = 12) => {
            const next = dedupeTextArray([...(Array.isArray(items) ? items : []), ...(Array.isArray(additions) ? additions : [additions])]);
            return next.slice(-limit);
        };
        const pushUniqueNumberLimited = (items, additions, limit = 80) => {
            const out = [];
            const seen = new Set();
            for (const item of [...(Array.isArray(items) ? items : []), ...(Array.isArray(additions) ? additions : [additions])]) {
                const value = Number(item || 0);
                if (!Number.isFinite(value) || value <= 0 || seen.has(value)) continue;
                seen.add(value);
                out.push(value);
            }
            return out.slice(-limit);
        };
        const hasNarrativeEvent = (storyline, brief) => {
            const needle = String(brief || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!needle) return true;
            return (Array.isArray(storyline?.recentEvents) ? storyline.recentEvents : []).some(event => {
                const text = String(event?.brief || '').replace(/\s+/g, ' ').trim().toLowerCase();
                return text && (text === needle || text.includes(needle) || needle.includes(text));
            });
        };
        const applyNarrativeSupplementCandidate = (state, candidate = {}, options = {}) => {
            const entities = normalizeNarrativeCandidateEntities(candidate.entities);
            const brief = String(candidate.brief || candidate.summary || candidate.context || '').trim();
            const context = String(candidate.context || '').trim();
            const type = String(candidate.type || 'event').trim().toLowerCase();
            const evidenceTurns = normalizeNarrativeSupplementEvidenceTurns(candidate, options);
            const turn = evidenceTurns[0] || normalizeLegacyMemoryTurnAnchor(options?.turn || options?.fallbackTurn || options?.baseTurn || 0);
            if (!brief && !context) return { applied: false, created: false };

            let target = findNarrativeSupplementTarget(state, { ...candidate, entities });
            let created = false;
            if (!target) {
                const id = (state.storylines || []).reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1;
                target = {
                    id,
                    name: String(candidate.name || '').trim() || (entities.length > 0 ? `${entities.slice(0, 2).join(', ')} 관련 흐름` : `보강 스토리라인 ${id}`),
                    entities: [...entities],
                    turns: turn ? [turn] : [],
                    firstTurn: turn || Number(options?.baseTurn || 1),
                    lastTurn: turn || Number(options?.baseTurn || 1),
                    recentEvents: [],
                    summaries: [],
                    currentContext: context || brief,
                    keyPoints: [],
                    ongoingTensions: [],
                    meta: { manualLocked: false, manualLockedAt: 0, source: 'reanalysis_supplement' }
                };
                state.storylines.push(target);
                created = true;
            }

            target.entities = pushUniqueLimited(target.entities, entities, 16);
            if (turn) {
                target.turns = pushUniqueNumberLimited(target.turns, [turn], 80);
                target.firstTurn = Math.min(Number(target.firstTurn || turn), turn);
                target.lastTurn = Math.max(Number(target.lastTurn || turn), turn);
            }
            if (!target.currentContext && (context || brief)) target.currentContext = context || brief;

            const keyPoints = dedupeTextArray([
                ...(Array.isArray(candidate.keyPoints) ? candidate.keyPoints : []),
                ...(type === 'event' || type === 'backstory' ? [brief] : [])
            ]).filter(Boolean);
            const tensions = dedupeTextArray([
                ...(Array.isArray(candidate.ongoingTensions) ? candidate.ongoingTensions : []),
                ...(type === 'tension' ? [brief] : [])
            ]).filter(Boolean);
            target.keyPoints = pushUniqueLimited(target.keyPoints, keyPoints, 16);
            target.ongoingTensions = pushUniqueLimited(target.ongoingTensions, tensions, 12);

            if (brief && !hasNarrativeEvent(target, brief)) {
                target.recentEvents = Array.isArray(target.recentEvents) ? target.recentEvents : [];
                target.recentEvents.push({ turn: turn || Number(options?.baseTurn || 0), brief, source: 'reanalysis_supplement' });
                target.recentEvents = target.recentEvents.slice(-10);
            }
            const summaryText = context || brief;
            if (summaryText) {
                target.summaries = Array.isArray(target.summaries) ? target.summaries.filter(entry => entry?.live !== true) : [];
                const duplicateSummary = target.summaries.some(entry => String(entry?.summary || '').trim() === summaryText);
                if (!duplicateSummary) {
                    target.summaries.push({
                        upToTurn: turn || Number(options?.baseTurn || 0),
                        summary: summaryText,
                        keyPoints,
                        ongoingTensions: tensions,
                        timestamp: Date.now(),
                        source: 'reanalysis_supplement',
                        evidenceTurns
                    });
                    target.summaries = target.summaries.slice(-12);
                }
            }
            return { applied: true, created };
        };
        const buildHeuristicNarrativeSupplement = (turnPairs, entityCacheValues, options = {}) => {
            const candidates = [];
            for (let i = 0; i < (Array.isArray(turnPairs) ? turnPairs : []).length; i++) {
                const pair = turnPairs[i];
                const combinedText = String(pair?.aiText || '');
                const entities = (Array.isArray(entityCacheValues) ? entityCacheValues : [])
                    .filter(entity => EntityManager.mentionsEntity(combinedText, entity))
                    .map(entity => entity.name);
                const brief = NarrativeTracker.buildHeuristicTurnBrief('', pair?.aiText || '');
                if (!brief || entities.length === 0) continue;
                candidates.push({
                    type: 'event',
                    brief,
                    entities,
                    evidenceTurns: [resolveReanalysisTurnAtIndex(i, options)],
                    confidence: 0.55
                });
            }
            return { events: candidates, storylines: [] };
        };
        const analyzeNarrativeSupplementCandidates = async (turnPairs, transcript, entityCacheValues, analysisBundle, options = {}) => {
            const heuristic = buildHeuristicNarrativeSupplement(turnPairs, entityCacheValues, options);
            if (!(LLMProvider.isConfigured(MemoryEngine.CONFIG, 'primary') || LLMProvider.isConfigured(MemoryEngine.CONFIG, 'aux'))) {
                return heuristic;
            }
            const currentNarrative = NarrativeTracker.formatForPrompt() || '(none)';
            const knownEntities = (Array.isArray(entityCacheValues) ? entityCacheValues : [])
                .map(entity => entity?.name)
                .filter(Boolean)
                .slice(0, 30)
                .join(', ') || '(none)';
            const systemPrompt = [
                'You are LIBRA Narrative Supplement Analyst.',
                'Analyze only the provided recent turns and return narrative supplement candidates.',
                LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY,
                'Do not replace, delete, or rewrite existing narrative state.',
                'Only propose grounded additions: events, backstory, unresolved tensions, or new/expanded storylines.',
                'Use only the exact turn numbers shown in [Recent Turns] headers for evidenceTurns. Never invent future turn numbers.',
                'Respond only as JSON: {"events":[{"type":"event|backstory|tension","brief":"","entities":[],"evidenceTurns":[],"confidence":0.0}],"storylines":[{"name":"","context":"","keyPoints":[],"ongoingTensions":[],"entities":[],"evidenceTurns":[],"confidence":0.0}]}'
            ].join('\n');
            const allowedTurnText = Array.isArray(options?.allowedTurns) && options.allowedTurns.length > 0
                ? options.allowedTurns.join(', ')
                : '(use only shown headers)';
            const userPrompt = [
                '[Current Narrative]',
                truncateForLLM(currentNarrative, 3000, '\n...[TRUNCATED]...\n'),
                '',
                '[Known Entities]',
                knownEntities,
                '',
                '[Turn Bounds]',
                `Current turn: ${normalizeLegacyMemoryTurnAnchor(options?.maxTurn || MemoryEngine.getCurrentTurn?.() || 0) || 'unknown'}`,
                `Valid evidence turns: ${allowedTurnText}`,
                '',
                '[Recent Turns]',
                transcript
            ].join('\n');
            try {
                const result = await runMaintenanceLLM(() =>
                    LLMProvider.call(
                        analysisBundle.config,
                        systemPrompt,
                        userPrompt,
                        { maxTokens: 1300, profile: analysisBundle.profile, label: 'narrative-reanalysis-supplement' }
                    )
                , 'narrative-reanalysis-supplement');
                const parsed = extractStructuredJson(result?.content || '');
                if (!parsed || typeof parsed !== 'object') return heuristic;
                return {
                    events: Array.isArray(parsed.events) ? parsed.events : heuristic.events,
                    storylines: Array.isArray(parsed.storylines) ? parsed.storylines : []
                };
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA] Narrative supplement LLM fallback:', e?.message || e);
                return heuristic;
            }
        };
        const reanalyzeMemoriesFromChat = async (progress = null) => {
            const { targetChat: activeChat } = await resolveGuiTargetContext();
            if (!char || !activeChat) throw new Error("채팅방을 찾을 수 없습니다.");
            await progress?.advanceTo?.(10);
            if (!LLMProvider.isConfigured(MemoryEngine.CONFIG, 'primary') && !LLMProvider.isConfigured(MemoryEngine.CONFIG, 'aux')) {
                throw new Error("메모리 재분석에 사용할 LLM이 구성되지 않았습니다.");
            }
            const memoryReanalysisPrompt = ColdStartManager.prompts?.memoryReanalysis;
            const memoryReanalysisVerificationPrompt = ColdStartManager.prompts?.memoryReanalysisVerification;
            if (!memoryReanalysisPrompt || !memoryReanalysisVerificationPrompt) {
                throw new Error("메모리 재분석 프롬프트를 불러오지 못했습니다.");
            }
            await progress?.advanceTo?.(20);

            const msgs = ColdStartManager.buildAnalyzableMessages(activeChat);
            if (msgs.length === 0) throw new Error("재분석할 대화 내역이 없습니다.");

            const turnPairs = buildReplayableTurnPairs(msgs, activeChat);
            if (turnPairs.length === 0) throw new Error("메모리 재분석에 필요한 턴 쌍이 없습니다.");
            await progress?.advanceTo?.(30);

            const config = MemoryEngine.CONFIG;
            const activeLore = MemoryEngine.getLorebook(char, activeChat) || lore;
            const existingMemoryEntries = MemoryEngine.getManagedEntries(activeLore);
            const workingSimilarityEntries = [...existingMemoryEntries];
            const existingSnippets = existingMemoryEntries
                .slice(-20)
                .map(entry => CompactMemoryCodec.buildDisplayTextFromEntry(entry, 220))
                .filter(Boolean);
            const replayMaxTurn = Math.max(
                1,
                turnPairs.length,
                ...turnPairs.map(pair => normalizeLegacyMemoryTurnAnchor(pair?.turn || 0)).filter(Boolean)
            );
            const profile = resolveAnalysisProfile(config);
            const buildMemoryReanalysisConfig = () => {
                const nextConfig = safeClone(config || {});
                const targetProfile = profile === 'aux' ? 'auxLlm' : 'llm';
                const currentProfile = (nextConfig && nextConfig[targetProfile] && typeof nextConfig[targetProfile] === 'object')
                    ? nextConfig[targetProfile]
                    : {};
                nextConfig[targetProfile] = {
                    ...currentProfile,
                    reasoningPreset: 'custom',
                    reasoningEffort: 'none',
                    reasoningBudgetTokens: 0,
                    glmThinkingType: 'disabled',
                    maxCompletionTokens: Math.min(
                        3000,
                        Math.max(800, parseInt(currentProfile.maxCompletionTokens, 10) || (profile === 'aux' ? DEFAULT_AUX_MAX_COMPLETION_TOKENS : DEFAULT_MAX_COMPLETION_TOKENS))
                    )
                };
                return nextConfig;
            };
            const memoryReanalysisConfig = buildMemoryReanalysisConfig();
            await progress?.advanceTo?.(40);
            const formatMemoryReanalysisSnippetBlock = (items, maxItems = 8, maxItemChars = 260) => {
                const source = Array.isArray(items) ? items : [];
                if (source.length === 0) return '(none)';
                return source
                    .slice(-Math.max(1, maxItems))
                    .map((item, idx) => `#${idx + 1} ${truncateForLLM(String(item || ''), maxItemChars, ' ...[TRUNCATED]... ')}`)
                    .join('\n');
            };
            const tokenizeReanalysisEvidence = (text = '') => {
                const matches = String(text || '').toLowerCase().match(/[0-9a-z가-힣]{2,}/gi) || [];
                return Array.from(new Set(matches.map(token => token.trim()).filter(token => token.length >= 2))).slice(0, 80);
            };
            const scoreReanalysisPairSupport = (candidateText = '', pair = {}) => {
                const candidateTokens = tokenizeReanalysisEvidence(candidateText);
                if (candidateTokens.length === 0) return 0;
                const pairTokens = new Set(tokenizeReanalysisEvidence(pair?.aiText || ''));
                if (pairTokens.size === 0) return 0;
                let hits = 0;
                candidateTokens.forEach(token => {
                    if (pairTokens.has(token)) hits += 1;
                });
                return hits / Math.max(1, Math.min(candidateTokens.length, 12));
            };
            const resolveMemoryReanalysisPair = (rawCandidate = {}, candidateText = '', batchPairs = []) => {
                const source = Array.isArray(batchPairs) ? batchPairs.filter(Boolean) : [];
                if (source.length === 0) return null;
                const rawTurn = rawCandidate?.turn ?? rawCandidate?.sourceTurn ?? rawCandidate?.turnNumber ?? rawCandidate?.pairTurn;
                const normalizedTurn = normalizeLegacyMemoryTurnAnchor(rawTurn);
                if (normalizedTurn) {
                    const exact = source.find(pair => normalizeLegacyMemoryTurnAnchor(pair?.turn) === normalizedTurn);
                    if (exact) return exact;
                }
                const scored = source
                    .map(pair => ({ pair, score: scoreReanalysisPairSupport(candidateText, pair) }))
                    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
                return Number(scored[0]?.score || 0) >= 0.16 ? scored[0].pair : null;
            };
            const buildMemoryReanalysisAnchorMeta = (pair = {}, sourceTurn = 0, sourceHash = '', sourceMessageIds = []) => {
                const turn = normalizeLegacyMemoryTurnAnchor(sourceTurn || pair?.turn || 0) || 1;
                const ids = normalizeCanonicalMessageIds(sourceMessageIds || pair?.sourceMessageIds || pair?.liveMessageIds || pair?.messageId);
                const hash = String(sourceHash || pair?.sourceHash || TokenizerEngine.simpleHash(pair?.aiText || pair?.combined || '')).trim();
                const messageSignature = compactTurnMessageSignature(pair?.messageSignature || `ai::memory-reanalysis::${turn}::${hash || 'nohash'}`);
                const userTurnKey = String(pair?.userTurnKey || buildLogicalUserTurnKey(pair?.userText || '', pair?.userText || '', false)).trim();
                const turnKey = String(pair?.turnKey || buildCanonicalTurnKey(activeChat?.id || '', userTurnKey, hash, messageSignature, ids)).trim();
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
                    turnAnchorReason: 'memory-reanalysis-replay',
                    sourceMessageIds: ids,
                    liveMessageIds: normalizeCanonicalMessageIds(pair?.liveMessageIds || ids),
                    m_id: getPrimaryCanonicalMessageId(ids, true) || pair?.messageId || '',
                    messageId: getPrimaryCanonicalMessageId(ids, true) || pair?.messageId || '',
                    sourceHash: hash,
                    aiHash: hash,
                    responseHash: hash,
                    userTurnKey,
                    turnKey,
                    messageSignature,
                    messageCount: Number(pair?.index || 0) + 1,
                    liveOrder: Number(pair?.index || 0) + 1,
                    chatId: String(activeChat?.id || '').trim(),
                    runtimeMode: 'memory-reanalysis',
                    runtimeReliability: 'historical-replay',
                    source: 'memory_reanalysis',
                    sourceHint: 'Reconstructed from historical chat reanalysis and anchored to the original assistant turn.',
                    s_id: 'memory_reanalysis'
                };
            };
            const pruneInvalidMemoryReanalysisArtifacts = (workingLore = [], maxLiveTurn = 0) => {
                const liveMax = normalizeLegacyMemoryTurnAnchor(maxLiveTurn) || 0;
                if (!Array.isArray(workingLore) || !liveMax) return { removed: 0, turns: [] };
                const removedTurns = [];
                let removed = 0;
                for (let i = workingLore.length - 1; i >= 0; i--) {
                    const entry = workingLore[i];
                    if (!entry || String(entry.comment || '') !== 'lmai_memory') continue;
                    const split = splitManagedMemoryMetaPrefix(entry.content || '');
                    const meta = split.meta || {};
                    const payload = CompactMemoryCodec.parsePayloadFromEntry(entry)
                        || CompactMemoryCodec.parsePayloadFromContent(split.body || entry.content || '')
                        || null;
                    if (!payload || payload.migratedFrom !== 'legacy_raw_memory') continue;
                    const hme = payload.hybridRow || payload.hme || meta.hme || {};
                    const turns = [
                        payload.turn,
                        payload.firstSeenTurn,
                        meta.t,
                        meta.turn,
                        meta.finalizedTurn,
                        meta.turnAnchorTurn,
                        ...(asHybridArray(hme.sourceTurnIds))
                    ].map(normalizeLegacyMemoryTurnAnchor).filter(Boolean);
                    const entryMaxTurn = turns.length ? Math.max(...turns) : 0;
                    if (!entryMaxTurn || entryMaxTurn <= liveMax) continue;
                    const ids = normalizeCanonicalMessageIds([
                        payload.sourceMessageIds,
                        meta.sourceMessageIds,
                        meta.liveMessageIds,
                        meta.m_id,
                        meta.m_ids,
                        meta.messageId
                    ]);
                    const hashes = [payload.sourceHash, meta.sourceHash, meta.aiHash, meta.responseHash]
                        .map(value => String(value || '').trim())
                        .filter(Boolean);
                    const sourceText = [
                        payload.migratedFrom,
                        meta.source,
                        meta.sourceHint,
                        meta.turnAnchorReason,
                        hme.source
                    ].map(value => String(value || '')).join(' ');
                    const reanalysisLike = /legacy_raw_memory|memory[-_ ]?reanalysis|reanalysis[-_ ]?candidate/i.test(sourceText);
                    const weakSource = ids.length === 0 && hashes.length === 0;
                    if (!reanalysisLike || !weakSource) continue;
                    workingLore.splice(i, 1);
                    removed += 1;
                    removedTurns.push(entryMaxTurn);
                }
                return { removed, turns: uniqLimit(removedTurns, 24).sort((a, b) => a - b) };
            };
            const buildMemoryReanalysisBatchPromptText = (pairs, options = {}) => {
                const {
                    maxPairs = 4,
                    turnMaxChars = 1800,
                    memoryMaxItems = 10,
                    memoryMaxItemChars = 180
                } = options;
                const source = (Array.isArray(pairs) ? pairs : []).slice(0, Math.max(1, maxPairs));
                const blocks = source.map((pair, idx) => {
                    const turnText = pair?.aiText ? `[Canonical Assistant Evidence]\n${pair.aiText}` : '';
                    return [
                        `[Turn ${normalizeLegacyMemoryTurnAnchor(pair?.turn) || (idx + 1)}]`,
                        truncateForLLM(turnText, turnMaxChars, '\n...[TRUNCATED]...\n')
                    ].join('\n');
                }).filter(Boolean);
                return [
                    '[Memory Reanalysis Batch]',
                    'Review the turn pairs below together and return only durable memories worth saving.',
                    'Each memory must include the exact source turn number shown in the block header.',
                    'Avoid duplicates, trivia, and memories already covered by existing snippets.',
                    '',
                    blocks.join('\n\n'),
                    '',
                    '[Existing Memory Snippets]',
                    formatMemoryReanalysisSnippetBlock(existingSnippets, memoryMaxItems, memoryMaxItemChars)
                ].join('\n');
            };
            const buildMemoryReanalysisVerifyText = (pair, candidateText, similarItems, options = {}) => {
                const {
                    turnMaxChars = 4800,
                    candidateMaxChars = 420,
                    similarMaxItems = 3,
                    similarMaxItemChars = 220
                } = options;
                const turnText = [
                    pair?.aiText ? `[Canonical Assistant Evidence]\n${pair.aiText}` : ''
                ].filter(Boolean).join('\n\n');
                return [
                    LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY,
                    '',
                    `[Current Turn ${normalizeLegacyMemoryTurnAnchor(pair?.turn) || '?'}]`,
                    truncateForLLM(turnText, turnMaxChars, '\n...[TRUNCATED]...\n'),
                    '',
                    `[Candidate Memory]`,
                    truncateForLLM(candidateText, candidateMaxChars, ' ...[TRUNCATED]... '),
                    '',
                    `[Existing Similar Memories]`,
                    formatMemoryReanalysisSnippetBlock(similarItems, similarMaxItems, similarMaxItemChars)
                ].join('\n');
            };
            const verifyMemoryReanalysisCandidate = async (pair = {}, candidateText = '', similarItems = [], fallbackImportance = 5, labelSuffix = '') => {
                const verifyInput = buildMemoryReanalysisVerifyText(pair, candidateText, similarItems, {
                    turnMaxChars: 4200,
                    candidateMaxChars: 420,
                    similarMaxItems: 3,
                    similarMaxItemChars: 220
                });
                const result = await callMemoryReanalysisLLM(
                    memoryReanalysisVerificationPrompt,
                    verifyInput,
                    {
                        baseMaxTokens: 420,
                        fallbackContent: '{"accept":false,"content":"","importance":1,"reason":"verification unavailable"}',
                        label: `memory-reanalysis-verify${labelSuffix ? `-${labelSuffix}` : ''}`
                    }
                );
                const parsed = extractStructuredJson(result?.content || '');
                if (!parsed || parsed.accept !== true) return { accept: false, reason: parsed?.reason || 'rejected' };
                const content = Utils.getMemorySourceText(String(parsed.content || candidateText || '').trim());
                if (!content || content.length < 5) return { accept: false, reason: 'empty_verified_content' };
                return {
                    accept: true,
                    content,
                    importance: Math.max(1, Math.min(10, parseInt(parsed.importance, 10) || fallbackImportance || 5)),
                    reason: String(parsed.reason || '').trim()
                };
            };
            const markMemoryReanalysisPayload = (payload = null, candidateText = '', sourcePair = {}) => {
                if (!payload || typeof payload !== 'object') return payload;
                const next = safeClone(payload);
                const candidate = truncateForLLM(String(candidateText || next.summary || '').trim(), 360, ' ... ');
                const sourceExcerpt = truncateForLLM([
                    sourcePair?.aiText ? `[Assistant] ${sourcePair.aiText}` : ''
                ].filter(Boolean).join('\n'), 520, ' ... ');
                next.source = {
                    ...(next.source && typeof next.source === 'object' ? next.source : {}),
                    reconstruction: 'memory_reanalysis_candidate',
                    evidencePolicy: 'candidate_summary_with_source_turn_excerpt'
                };
                next.audit = {
                    ...(next.audit && typeof next.audit === 'object' ? next.audit : {}),
                    cautions: uniqLimit([
                        ...(Array.isArray(next.audit?.cautions) ? next.audit.cautions : []),
                        'memory_reanalysis_candidate_not_raw_assistant_text'
                    ], 12),
                    overpromotionRisks: uniqLimit([
                        ...(Array.isArray(next.audit?.overpromotionRisks) ? next.audit.overpromotionRisks : []),
                        'llm_reanalysis_summary'
                    ], 12)
                };
                if (Array.isArray(next.facts)) {
                    next.facts = next.facts.map(fact => fact && typeof fact === 'object' ? {
                        ...fact,
                        type: fact.type === 'scene_result' ? 'reanalysis_candidate' : fact.type,
                        evidence: [
                            { source: 'reanalysis_candidate', text: candidate },
                            ...(sourceExcerpt ? [{ source: 'source_turn_excerpt', text: sourceExcerpt }] : [])
                        ]
                    } : fact).filter(Boolean);
                }
                next.directEvidenceSnippets = [
                    { source: 'reanalysis_candidate', text: candidate },
                    ...(sourceExcerpt ? [{ source: 'source_turn_excerpt', text: sourceExcerpt }] : [])
                ].slice(0, 2);
                return CompactMemoryCodec.normalizePayloadForWrite(next, {
                    t: next.turn,
                    sourceHash: next.sourceHash,
                    sourceMessageIds: next.sourceMessageIds
                });
            };
            const isLengthFailure = (error) => /finishReason=length|EMPTY_RESPONSE|returned no text content|API Error:\s*422|context(?:_| )length|maximum context length|too many tokens|prompt (?:is )?too long|input (?:is )?too long/i.test(String(error?.message || error || ''));
            const isTransientProviderFailure = (error) => /API Error:\s*(429|500|502|503|504)\b|service_unavailable|all_fallbacks_failed|temporarily unavailable|upstream|gateway|timeout/i.test(String(error?.message || error || ''));
            const callMemoryReanalysisLLM = async (systemPrompt, userPrompt, options = {}) => {
                const {
                    baseMaxTokens = 600,
                    fallbackContent = '{"memories":[]}',
                    label = 'memory-reanalysis',
                    retryUserPrompt = ''
                } = options;
                const callOnce = (promptText, maxTokens, taskLabel) => runMaintenanceLLM(() =>
                    LLMProvider.call(
                        memoryReanalysisConfig,
                        systemPrompt,
                        promptText,
                        { maxTokens, profile, label: taskLabel }
                    )
                , taskLabel);
                try {
                    return await callOnce(userPrompt, baseMaxTokens, label);
                } catch (error) {
                    if (isTransientProviderFailure(error)) {
                        let lastTransientError = error;
                        for (let attempt = 1; attempt <= 2; attempt++) {
                            await sleep(700 * attempt);
                            try {
                                return await callOnce(userPrompt, baseMaxTokens, `${label}-transient-retry-${attempt}`);
                            } catch (retryTransientError) {
                                if (!isTransientProviderFailure(retryTransientError)) throw retryTransientError;
                                lastTransientError = retryTransientError;
                            }
                        }
                        throw lastTransientError;
                    }
                    if (!isLengthFailure(error)) throw error;
                }
                try {
                    const retryPrompt = String(retryUserPrompt || userPrompt || '');
                    return await callOnce(retryPrompt, Math.max(180, Math.floor(baseMaxTokens * 0.55)), `${label}-retry`);
                } catch (retryError) {
                    if (isTransientProviderFailure(retryError)) {
                        let lastTransientError = retryError;
                        for (let attempt = 1; attempt <= 2; attempt++) {
                            await sleep(700 * attempt);
                            try {
                                const retryPrompt = String(retryUserPrompt || userPrompt || '');
                                return await callOnce(retryPrompt, Math.max(180, Math.floor(baseMaxTokens * 0.55)), `${label}-retry-transient-${attempt}`);
                            } catch (retryTransientError) {
                                if (!isTransientProviderFailure(retryTransientError)) throw retryTransientError;
                                lastTransientError = retryTransientError;
                            }
                        }
                        throw lastTransientError;
                    }
                    if (!isLengthFailure(retryError)) throw retryError;
                    return { content: fallbackContent, usage: {}, fallback: true };
                }
            };

            const acceptedCandidates = [];
            let generatedCount = 0;
            let verifiedOutCount = 0;
            const BATCH_SIZE = 4;
            await progress?.advanceTo?.(50);
            for (let batchStart = 0; batchStart < turnPairs.length; batchStart += BATCH_SIZE) {
                const batchPairs = turnPairs.slice(batchStart, batchStart + BATCH_SIZE).filter(pair => {
                    const turnText = [
                        pair?.aiText ? `[Assistant]\n${pair.aiText}` : ''
                    ].filter(Boolean).join('\n\n');
                    return !!turnText.trim();
                });
                if (batchPairs.length === 0) continue;

                const candidateInput = buildMemoryReanalysisBatchPromptText(batchPairs, {
                    maxPairs: BATCH_SIZE,
                    turnMaxChars: 1800,
                    memoryMaxItems: 10,
                    memoryMaxItemChars: 180
                });
                const compactCandidateInput = buildMemoryReanalysisBatchPromptText(batchPairs, {
                    maxPairs: BATCH_SIZE,
                    turnMaxChars: 1000,
                    memoryMaxItems: 6,
                    memoryMaxItemChars: 120
                });
                const batchedPrompt = [
                    memoryReanalysisPrompt,
                    LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY,
                    '',
                    'You may receive multiple turn pairs in one request.',
                    'Return only the durable, non-duplicate memories worth saving across the whole batch.',
                    'Prefer at most 1-2 strong memories per turn pair and omit weak candidates.',
                    'Each item must include the exact source turn number from the [Turn N] header.',
                    'Respond as JSON: {"memories":[{"turn":1,"content":"","importance":5}]}'
                ].join('\n');

                const candidateResult = await callMemoryReanalysisLLM(
                    batchedPrompt,
                    candidateInput,
                    {
                        baseMaxTokens: 1200,
                        fallbackContent: '{"memories":[]}',
                        label: `memory-reanalysis-batch-${Math.floor(batchStart / BATCH_SIZE) + 1}`,
                        retryUserPrompt: compactCandidateInput
                    }
                );
                const parsed = extractStructuredJson(candidateResult?.content || '');
                const candidates = Array.isArray(parsed?.memories) ? parsed.memories : [];
                generatedCount += candidates.length;

                for (let candidateIndex = 0; candidateIndex < candidates.slice(0, Math.max(2, batchPairs.length * 2)).length; candidateIndex += 1) {
                    const rawCandidate = candidates[candidateIndex];
                    const rawCandidateText = Utils.getMemorySourceText(String(rawCandidate?.content || '').trim());
                    let importance = Math.max(1, Math.min(10, parseInt(rawCandidate?.importance, 10) || 5));
                    const sourcePair = resolveMemoryReanalysisPair(rawCandidate, rawCandidateText, batchPairs);
                    const sourceTurn = normalizeLegacyMemoryTurnAnchor(sourcePair?.turn || 0) || 1;
                    const supportScore = scoreReanalysisPairSupport(rawCandidateText, sourcePair || {});
                    if (!sourcePair || supportScore < 0.16) {
                        verifiedOutCount += 1;
                        continue;
                    }
                    const preVerifySimilar = await MemoryEngine.retrieveMemories(
                        rawCandidateText,
                        sourceTurn,
                        workingSimilarityEntries,
                        {},
                        3
                    );
                    const preVerifySimilarSnippets = (Array.isArray(preVerifySimilar) ? preVerifySimilar : [])
                        .map(entry => CompactMemoryCodec.buildDisplayTextFromEntry(entry, 220))
                        .filter(Boolean);
                    const verifiedCandidate = await verifyMemoryReanalysisCandidate(
                        sourcePair,
                        rawCandidateText,
                        preVerifySimilarSnippets,
                        importance,
                        `${Math.floor(batchStart / BATCH_SIZE) + 1}-${candidateIndex + 1}`
                    );
                    if (!verifiedCandidate.accept) {
                        verifiedOutCount += 1;
                        continue;
                    }
                    const verifiedCandidateText = Utils.getMemorySourceText(verifiedCandidate.content || rawCandidateText);
                    importance = verifiedCandidate.importance;
                    if (scoreReanalysisPairSupport(verifiedCandidateText, sourcePair || {}) < 0.16) {
                        verifiedOutCount += 1;
                        continue;
                    }
                    const sourceHash = String(sourcePair?.sourceHash || TokenizerEngine.simpleHash(sourcePair?.aiText || rawCandidateText)).trim();
                    const sourceMessageIds = normalizeCanonicalMessageIds(sourcePair?.sourceMessageIds || sourcePair?.liveMessageIds || sourcePair?.messageId);
                    const sourceText = [
                        `[응답] ${verifiedCandidateText}`
                    ].filter(Boolean).join('\n');
                    let payloadCandidate = CompactMemoryCodec.buildPayloadFromLegacyContent(sourceText, {
                        imp: importance,
                        t: sourceTurn,
                        turn: sourceTurn,
                        firstSeenTurn: sourceTurn,
                        sourceHash,
                        sourceMessageIds
                    });
                    payloadCandidate = markMemoryReanalysisPayload(payloadCandidate, verifiedCandidateText, sourcePair);
                    const content = payloadCandidate ? CompactMemoryCodec.serialize(payloadCandidate) : rawCandidateText;
                    if (!content || content.length < 5) continue;
                    if (Utils.shouldExcludeStoredMemoryContent(content)) continue;
                    const candidateSearchText = CompactMemoryCodec.buildSearchTextFromContent(content);
                    if (!candidateSearchText || candidateSearchText.length < 5) continue;
                    if (acceptedCandidates.some(item => CompactMemoryCodec.buildSearchTextFromContent(item?.content || '') === candidateSearchText)) continue;

                    const similarExisting = await MemoryEngine.retrieveMemories(
                        candidateSearchText,
                        sourceTurn,
                        workingSimilarityEntries,
                        {},
                        2
                    );
                    const nearDuplicate = (Array.isArray(similarExisting) ? similarExisting : []).some(entry => {
                        const existingText = CompactMemoryCodec.buildSearchTextFromEntry(entry);
                        return existingText && (
                            existingText === candidateSearchText ||
                            existingText.includes(candidateSearchText) ||
                            candidateSearchText.includes(existingText)
                        );
                    });
                    if (nearDuplicate) {
                        verifiedOutCount += 1;
                        continue;
                    }

                    acceptedCandidates.push({ content, searchText: candidateSearchText, importance, sourcePair, sourceTurn, sourceHash, sourceMessageIds });
                    existingSnippets.push(CompactMemoryCodec.buildDisplayTextFromEntry({ content }, 220));
                    workingSimilarityEntries.push({
                        key: `reanalysis_candidate_${TokenizerEngine.simpleHash(`${sourceTurn}:${content}`)}`,
                        comment: 'lmai_memory',
                        content: `[META:${JSON.stringify({ t: sourceTurn, ttl: -1, imp: importance, source: 'memory_reanalysis_candidate', sourceHash, sourceMessageIds })}]\n${content}`,
                        mode: 'normal',
                        insertorder: 100,
                        alwaysActive: false
                    });
                }
                const processedPairs = Math.min(turnPairs.length, batchStart + BATCH_SIZE);
                const batchPercent = 50 + Math.floor((processedPairs / Math.max(1, turnPairs.length)) * 40);
                await progress?.advanceTo?.(batchPercent);

            }

            let addedCount = 0;
            await progress?.advanceTo?.(90);
            await progress?.applying?.();
            await loreLock.writeLock();
            let prunedInvalidCount = 0;
            try {
                let workingLore = MemoryEngine.getLorebook(char, activeChat) || lore;
                const pruneResult = pruneInvalidMemoryReanalysisArtifacts(workingLore, replayMaxTurn);
                prunedInvalidCount = Number(pruneResult.removed || 0);
                if (prunedInvalidCount > 0) {
                    recordRuntimeDebug('warn', `[LIBRA] Pruned ${prunedInvalidCount} invalid memory reanalysis artifact(s) beyond live turn ${replayMaxTurn}: ${JSON.stringify(pruneResult.turns || [])}`);
                }
                const addedMemories = [];
                for (let i = 0; i < acceptedCandidates.length; i++) {
                    const candidate = acceptedCandidates[i];
                    const sourceTurn = normalizeLegacyMemoryTurnAnchor(candidate.sourceTurn || candidate.sourcePair?.turn || 0) || replayMaxTurn;
                    const sourceMessageIds = normalizeCanonicalMessageIds(candidate.sourceMessageIds || candidate.sourcePair?.sourceMessageIds || candidate.sourcePair?.liveMessageIds || candidate.sourcePair?.messageId);
                    const anchorMeta = buildMemoryReanalysisAnchorMeta(candidate.sourcePair || {}, sourceTurn, candidate.sourceHash || '', sourceMessageIds);
                    const newMemory = await MemoryEngine.prepareMemory(
                        { content: candidate.content, importance: candidate.importance },
                        sourceTurn,
                        workingLore,
                        workingLore,
                        char,
                        activeChat,
                        getPrimaryCanonicalMessageId(sourceMessageIds, true) || null,
                        anchorMeta
                    );
                    if (!newMemory) continue;
                    workingLore.push(newMemory);
                    addedMemories.push(newMemory);
                    addedCount += 1;
                }
                if (addedMemories.length > 0) {
                    MemoryEngine.upsertHybridScopeIndexRows(workingLore, addedMemories, {
                        scopeKey: getChatRuntimeScopeKey(activeChat, char),
                        currentTurn: replayMaxTurn,
                        reason: 'memory-reanalysis'
                    });
                }
                MemoryEngine.setLorebook(char, activeChat, workingLore);
                lore = workingLore;
                MemoryEngine.rebuildIndex(lore);
                const persistResult = await persistLoreToActiveChat(activeChat, workingLore, {});
                if (!persistResult?.ok) {
                    throw new Error(`메모리 재분석 저장 실패: ${persistResult?.reason || 'unknown'}`);
                }
            } finally {
                loreLock.writeUnlock();
            }

            syncGuiSnapshotsFromRuntime();
            filterMems();
            return { addedCount, generatedCount, verifiedOutCount, prunedInvalidCount };
        };
        const reanalyzeEntitiesFromChat = async (turnLimit = 20, progress = null) => {
            const { targetChat: activeChat } = await resolveGuiTargetContext();
            if (!char || !activeChat) throw new Error("채팅방을 찾을 수 없습니다.");
            await progress?.advanceTo?.(10);
            const msgs = ColdStartManager.buildAnalyzableMessages(activeChat);
            if (msgs.length === 0) throw new Error("재분석할 대화 내역이 없습니다.");
            await progress?.advanceTo?.(20);

            const replay = getRecentReplayableTurnPairs(msgs, turnLimit, activeChat);
            if (replay.turnPairs.length === 0) {
                const rawMessages = getChatMessages(activeChat);
                recordRuntimeDebug('warn', '[LIBRA] Entity reanalysis found no replayable turn pairs:', {
                    rawMessages: Array.isArray(rawMessages) ? rawMessages.length : 0,
                    analyzableMessages: msgs.length,
                    turnLimit,
                    rawRoleCounts: DebugExportManager.countRoles(rawMessages),
                    analyzableRoleCounts: DebugExportManager.countRoles(msgs),
                    latestUser: DebugExportManager.latestUserDigest(rawMessages)
                });
                throw new Error("엔티티 보강에 필요한 최근 턴 쌍이 없습니다.");
            }
            await progress?.advanceTo?.(30);
            const currentTurn = Math.max(1, Number(MemoryEngine.getCurrentTurn() || replay.allPairs.length || replay.turnPairs.length));
            const baseTurn = Math.max(1, currentTurn - replay.allPairs.length + 1);
            const transcript = buildTurnPairTranscript(replay.turnPairs, {
                baseTurn,
                startIndex: replay.startIndex,
                maxChars: 12000
            });
            await progress?.advanceTo?.(40);
            const analysisBundle = buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 1800 });
            const analysisConfig = {
                ...analysisBundle.config,
                __preferredProfile: analysisBundle.profile
            };
            const storedInfo = EntityAwareProcessor.formatStoredInfoForExtraction(8, {
                conversationText: transcript,
                maxChars: 5600
            });
            const reanalysisLore = MemoryEngine.getLorebook(char, activeChat) || lore;
            const reanalysisCharacterEntityHints = await CharacterEntitySourceHintBridge.build(char, activeChat, transcript, {
                limit: 14,
                maxChars: 5200,
                purpose: 'entity_relation_reanalysis',
                allowQueryEmbedding: true
            });
            const reanalysisMemoryHints = AnalysisMemoryHintBridge.build(reanalysisLore, transcript, {
                limit: 6,
                maxChars: 220,
                purpose: 'entity_relation_reanalysis'
            });
            const rpLongTermEntityCueBlock = EntityAnalysisHintBridge.buildRpLongTermCueBlock(reanalysisLore, transcript, {
                maxChars: 1600,
                currentTurn
            });
            await progress?.advanceTo?.(50);
            const extraction = await EntityAwareProcessor.extractFromConversation(
                [
                    '[엔티티/관계 보강 요청]',
                    `최근 ${replay.turnPairs.length}턴, 캐릭터 설명/캐릭터 로어북의 안정 엔티티 단서, 관련 장기 compact memory hint를 기준으로 기존 정보를 삭제하거나 대체하지 말고 누락된 엔티티/관계 보강 후보만 추출하라.`,
                    reanalysisCharacterEntityHints.count ? `캐릭터 카드/로어북 엔티티 단서 ${reanalysisCharacterEntityHints.count}개가 [Character Card / Lorebook Entity Cues] 블록으로 제공된다.` : '캐릭터 카드/로어북 엔티티 단서가 없으면 최근 대화와 저장 구조 데이터만 기준으로 판단하라.',
                    '새 엔티티/관계는 반드시 [Turn N] transcript 안에 이름 또는 명확한 호칭이 직접 등장한 경우에만 추출하라.',
                    '캐릭터 카드/로어북/장기기억 힌트에만 있고 최근 transcript에 직접 등장하지 않은 인물은 절대 새 엔티티로 만들지 말라.',
                    '캐릭터 설명/로어북은 biological sex, appearance, personality, speechStyle, background, occupation, alias, stable relationship facts처럼 명시된 안정 필드 보강에만 사용하라.',
                    '장기기억 힌트는 alias, stable trait, long-term relationship, recurring motive 보강에만 사용하라.',
                    '이미 값이 있는 현재 위치/현재 기분/현재 건강 상태는 과거 대화나 로어북 근거로 덮어쓰지 말라.',
                    '불확실하거나 일시적인 정보는 비워 두라.'
                ].join('\n'),
                transcript,
                storedInfo,
                analysisConfig,
                {
                    characterEntityHintBlock: [
                        reanalysisCharacterEntityHints.block,
                        rpLongTermEntityCueBlock
                    ].filter(Boolean).join('\n\n'),
                    memoryHints: reanalysisMemoryHints,
                    memoryHintTitle: 'Long-Term Compact Memory Hints for Entity Reanalysis',
                    lorebook: reanalysisLore
                }
            );
            await progress?.advanceTo?.(70);
            const extractionPartialFailure = extraction?.success === false && (extraction?.degraded || extraction?.fallbackReason);
            if (extractionPartialFailure) {
                recordRuntimeDebug('warn', '[LIBRA] Entity reanalysis extraction degraded; preserving existing entities:', {
                    reason: extraction?.fallbackReason || '',
                    error: extraction?.error || ''
                });
            }
            if (extraction?.success === false && extraction?.error && !extractionPartialFailure) {
                throw new Error(extraction.error);
            }
            const rawPacketTranscript = replay.turnPairs
                .map(pair => Utils.getMessageText(pair?.aiMsg || pair?.sourceMessage || ''))
                .filter(Boolean)
                .join('\n\n');
            const structuredPacketSupplement = EntityAwareProcessor.extractStructuredEntitySignals(rawPacketTranscript, {
                lorebook: reanalysisLore,
                conversationText: transcript,
                turn: currentTurn
            });
            const hasStructuredPacketSupplement = !!structuredPacketSupplement?.success;
            if ((!Array.isArray(extraction?.entities) || extraction.entities.length === 0)
                && (!Array.isArray(extraction?.relations) || extraction.relations.length === 0)
                && !hasStructuredPacketSupplement) {
                if (extractionPartialFailure) {
                    return {
                        turnCount: replay.turnPairs.length,
                        entityCount: 0,
                        relationCount: 0,
                        partialFailure: true,
                        reason: extraction?.fallbackReason || extraction?.error || 'entity_reanalysis_degraded'
                    };
                }
                throw new Error("엔티티 재분석 결과가 비어 있습니다.");
            }
            await progress?.advanceTo?.(80);

            await progress?.advanceTo?.(90);
            await progress?.applying?.();
            await loreLock.writeLock();
            try {
                let workingLore = MemoryEngine.getLorebook(char, activeChat) || lore;
                EntityManager.rebuildCache(workingLore);
                const supplement = normalizeEntitySupplementPayload(extraction, workingLore, {
                    conversationText: transcript,
                    requireConversationEvidence: true,
                    requireConversationEvidenceForKnown: true
                });
                await EntityAwareProcessor.applyExtractions({
                    entities: supplement.entities,
                    relations: supplement.relations,
                    world: {},
                    conflicts: [],
                    conversationText: transcript,
                    sourceMode: 'reanalysis_supplement',
                    allowManualOverride: false
                }, workingLore, analysisConfig, null);
                if (hasStructuredPacketSupplement) {
                    await EntityAwareProcessor.applyExtractions({
                        ...structuredPacketSupplement,
                        conversationText: transcript,
                        sourceMode: 'structured_packet',
                        allowManualOverride: false
                    }, workingLore, analysisConfig, null);
                }
                await EntityManager.saveToLorebook(char, activeChat, workingLore);
                MemoryEngine.setLorebook(char, activeChat, workingLore);
                lore = workingLore;
                const persistResult = await persistLoreToActiveChat(activeChat, workingLore, {});
                if (!persistResult?.ok) {
                    throw new Error(`엔티티 재분석 저장 실패: ${persistResult?.reason || 'unknown'}`);
                }
            } finally {
                loreLock.writeUnlock();
            }
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            return {
                turnCount: replay.turnPairs.length,
                entityCount: (Array.isArray(extraction.entities) ? extraction.entities.length : 0) + (Array.isArray(structuredPacketSupplement.entities) ? structuredPacketSupplement.entities.length : 0),
                relationCount: (Array.isArray(extraction.relations) ? extraction.relations.length : 0) + (Array.isArray(structuredPacketSupplement.relations) ? structuredPacketSupplement.relations.length : 0)
            };
        };
        const reanalyzeNarrativeFromChat = async (turnLimit = 20, progress = null) => {
            const { targetChat: activeChat } = await resolveGuiTargetContext();
            if (!char || !activeChat) throw new Error("채팅방을 찾을 수 없습니다.");
            await progress?.advanceTo?.(10);
            const msgs = ColdStartManager.buildAnalyzableMessages(activeChat);
            if (msgs.length === 0) throw new Error("재분석할 대화 내역이 없습니다.");
            await progress?.advanceTo?.(20);
            const analysisBundle = buildFastAnalysisProfile(MemoryEngine.CONFIG, { maxCompletionTokens: 1600 });
            const engineCurrentTurn = normalizeLegacyMemoryTurnAnchor(MemoryEngine.getCurrentTurn?.() || 0);
            const effectiveTurnLimit = engineCurrentTurn
                ? Math.min(normalizeReanalysisTurnLimit(turnLimit, 20), engineCurrentTurn)
                : turnLimit;
            const replay = getRecentReplayableTurnPairs(msgs, effectiveTurnLimit, activeChat);
            if (replay.turnPairs.length === 0) throw new Error("내러티브 보강에 필요한 최근 턴 쌍이 없습니다.");
            await progress?.advanceTo?.(30);
            const entityCacheValues = Array.from(EntityManager.getEntityCache().values());
            const currentTurn = Math.max(1, engineCurrentTurn || replay.turnPairs.length || replay.allPairs.length);
            const turnContext = buildReanalysisTurnContext(replay, currentTurn);
            const transcript = buildTurnPairTranscript(replay.turnPairs, {
                ...turnContext,
                maxChars: 12000
            });
            await progress?.advanceTo?.(40);
            await progress?.advanceTo?.(50);
            const candidates = await analyzeNarrativeSupplementCandidates(
                replay.turnPairs,
                transcript,
                entityCacheValues,
                analysisBundle,
                turnContext
            );
            await progress?.advanceTo?.(70);

            let appliedCount = 0;
            let createdCount = 0;
            const nextState = normalizeNarrativeSupplementState(safeClone(NarrativeTracker.getState?.() || {}));
            clampNarrativeSupplementStateTurns(nextState, turnContext.maxTurn);
            const applyOptions = {
                ...turnContext,
                fallbackTurn: turnContext.latestTurn
            };
            const storylineCandidates = Array.isArray(candidates?.storylines) ? candidates.storylines : [];
            for (let i = 0; i < storylineCandidates.length; i++) {
                const storyline = storylineCandidates[i];
                const result = applyNarrativeSupplementCandidate(nextState, { ...storyline, type: 'storyline' }, { ...applyOptions, candidateIndex: i });
                if (result.applied) appliedCount += 1;
                if (result.created) createdCount += 1;
            }
            const eventCandidates = Array.isArray(candidates?.events) ? candidates.events : [];
            for (let i = 0; i < eventCandidates.length; i++) {
                const event = eventCandidates[i];
                const result = applyNarrativeSupplementCandidate(nextState, event, { ...applyOptions, candidateIndex: i });
                if (result.applied) appliedCount += 1;
                if (result.created) createdCount += 1;
            }
            if (appliedCount === 0) throw new Error("내러티브에 보강할 후보가 없습니다.");
            clampNarrativeSupplementStateTurns(nextState, turnContext.maxTurn);
            await progress?.advanceTo?.(90);

            await progress?.applying?.();
            await loreLock.writeLock();
            try {
                let workingLore = MemoryEngine.getLorebook(char, activeChat) || lore;
                NarrativeTracker.resetState(nextState);
                await NarrativeTracker.saveState(workingLore);
                MemoryEngine.setLorebook(char, activeChat, workingLore);
                lore = workingLore;
                const persistResult = await persistLoreToActiveChat(activeChat, workingLore, {});
                if (!persistResult?.ok) {
                    throw new Error(`내러티브 재분석 저장 실패: ${persistResult?.reason || 'unknown'}`);
                }
            } finally {
                loreLock.writeUnlock();
            }
            syncGuiSnapshotsFromRuntime();
            renderNarrative();
            return { turnCount: replay.turnPairs.length, appliedCount, createdCount };
        };

        const toHypaArchiveKey = (prefix, payload, idx) => `${prefix}::${TokenizerEngine.simpleHash(`${idx}::${JSON.stringify(payload)}`)}`;
        const buildHypaArchiveEntriesFromChatData = (hypaData) => {
            const categoryMap = getHypaCategoryMap(hypaData);
            const summaries = Array.isArray(hypaData?.summaries) ? hypaData.summaries : [];
            const sourceEntries = [];
            const knowledgeTexts = [];

            summaries.forEach((summary, idx) => {
                const text = String(summary?.text || '').trim();
                if (!text) return;

                const normalized = {
                    text,
                    chatMemos: Array.isArray(summary?.chatMemos) ? summary.chatMemos.map(v => String(v || '')).filter(Boolean) : [],
                    isImportant: summary?.isImportant === true,
                    categoryId: String(summary?.categoryId || ''),
                    categoryName: categoryMap.get(String(summary?.categoryId || '')) || '',
                    tags: Array.isArray(summary?.tags) ? summary.tags.map(tag => String(tag || '').trim()).filter(Boolean) : [],
                    source: 'chat.hypaV3Data'
                };
                knowledgeTexts.push(text);
                sourceEntries.push({
                    key: toHypaArchiveKey('lmai_hypa_v3_source', normalized, idx),
                    comment: 'lmai_hypa_v3_source',
                    content: JSON.stringify(normalized, null, 2),
                    mode: 'normal',
                    insertorder: 96,
                    alwaysActive: false
                });
            });

            return { sourceEntries, knowledgeTexts, count: knowledgeTexts.length, sourceLabel: 'chat.hypaV3Data' };
        };
        const loadHypaV3ImportPayload = async (targetChar, targetChat = null) => {
            const activeChat = targetChat || await getActiveChatForCharacter(targetChar);
            if (Array.isArray(activeChat?.hypaV3Data?.summaries) && activeChat.hypaV3Data.summaries.length > 0) {
                return buildHypaArchiveEntriesFromChatData(activeChat.hypaV3Data);
            }

            // Static knowledge is imported only from visible chat/lorebook data.
            // pluginStorage is used for common settings and bounded runtime debug traces.
            return null;
        };
        const getHypaImportSignature = (payload) => TokenizerEngine.simpleHash(JSON.stringify({
            count: Number(payload?.count || 0),
            sourceLabel: String(payload?.sourceLabel || ''),
            knowledgeTexts: Array.isArray(payload?.knowledgeTexts) ? payload.knowledgeTexts.map(text => String(text || '').trim()) : []
        }));

        const importHypaV3ToLorebook = async () => {
            if (!char || !chat) {
                toast("❌ 캐릭터 또는 채팅방을 찾을 수 없습니다");
                return;
            }


            try {
                const { targetChar, targetChat } = await resolveGuiTargetContext();
                const payload = await loadHypaV3ImportPayload(targetChar, targetChat);
                if (!payload || !Array.isArray(payload.knowledgeTexts) || payload.knowledgeTexts.length === 0) {
                    toast("❌ 하이파 V3 데이터가 없습니다");
                    return;
                }
                const hypaSignature = getHypaImportSignature(payload);
                if (lastHypaImportSignature && lastHypaImportSignature === hypaSignature) {
                    if (!await Utils.confirmEx(`같은 하이파 V3 데이터(${payload.count}개, ${payload.sourceLabel})를 다시 반영하려고 합니다. 구조화 반영이 중복 실행될 수 있는데 계속할까요?`)) {
                        toast("↩️ 하이파 V3 재반영 취소됨");
                        return;
                    }
                }

                const preserved = lore.filter(e => e.comment !== 'hypa_v3_import' && e.comment !== 'lmai_hypa_v3_source');
                await saveLoreToChar([...preserved, ...payload.sourceEntries], () => {
                    toast(`✅ 하이파 V3 ${payload.count}개 요약을 보존했습니다 (${payload.sourceLabel})`);
                });

                toast("🧠 하이파 V3 지식을 캐릭터/세계관에 반영 중...");
                await ColdStartManager.integrateImportedKnowledge(payload.knowledgeTexts, 'Hypa V3', {
                    targetChar,
                    targetChat
                });
                lore = MemoryEngine.getLorebook(targetChar, targetChat) || lore;
                syncGuiSnapshotsFromRuntime();
                renderEnts();
                renderNarrative();
                renderWorld();
                filterMems();
                lastHypaImportSignature = hypaSignature;
                toast("✨ 하이파 V3 지식이 캐릭터/세계관에 반영되었습니다");
            } catch (e) {
                recordRuntimeDebug('error', '[LIBRA] Hypa V3 import failed:', e);
                toast(`⚠️ 하이파 V3 가져오기/반영 실패: ${e?.message || e}`);
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
            if (n === 'world') {
                renderWorld();
                Promise.resolve().then(() => refreshSectionWorldLensFromGui(false)).catch(() => {});
            }
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
                const originBadge = meta.source === 'narrative_source_record' ? `<span class="bdg bt">서사 요약 원본</span>` : '';
                return `<div class="card mem" id="mc-${idx}">
                    <div class="card-hdr">
                        <div class="card-meta">${impBdg(meta.imp||5)}<span class="bdg bt">턴 ${meta.t||0}</span><span class="bdg bt">TTL:${ttl}</span>${originBadge}${meta.cat ? `<span class="bdg bt">${esc(meta.cat)}</span>` : ''}</div>
                        <div class="acts">
                            <button class="btn bp act-save-mem" data-idx="${idx}">저장</button>
                            <button class="btn bd act-del-mem" data-idx="${idx}">삭제</button>
                        </div>
                    </div>
                    <textarea class="ec mt-val" data-idx="${idx}" rows="6">${esc(content)}</textarea>
                    ${meta.sourceHint ? `<div class="hint">${esc(meta.sourceHint)}</div>` : ''}
                    <div class="memory-importance-row">
                        <label style="font-size:var(--fs-label);line-height:var(--lh-ui);color:var(--text2)">중요도:</label>
                        <input type="number" class="mi-val" data-idx="${idx}" min="1" max="10" value="${meta.imp||5}">
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

        const renderEntityBlocklist = () => {
            const blockListEl = overlay.querySelector("#entity-block-list");
            if (!blockListEl) return;
            const blocked = getGuiEntityBlocklist();
            if (!blocked.length) {
                blockListEl.innerHTML = '<div class="empty">차단된 엔티티가 없습니다</div>';
                return;
            }
            blockListEl.innerHTML = blocked.map(name => `<div class="card ent"><div class="card-hdr"><strong>${esc(name)}</strong><div class="acts"><button class="btn bs act-unblock-ent" data-name="${escAttr(name)}">차단 해제</button></div></div></div>`).join("");
        };
        const guiArray = (value) => Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
        const guiCsv = (value) => dedupeTextArray(guiArray(value).map(item => String(item || '').trim()).filter(Boolean)).join(", ");
        const guiLines = (value) => guiArray(value).map(item => String(item || '').trim()).filter(Boolean).join("\n");
        const guiFirstText = (...values) => {
            for (const value of values) {
                const text = String(value || '').trim();
                if (text) return text;
            }
            return '';
        };
        const guiFirstList = (...values) => {
            for (const value of values) {
                const list = guiArray(value).map(item => String(item || '').trim()).filter(Boolean);
                if (list.length) return list;
            }
            return [];
        };
        const parseGuiCsv = (value) => dedupeTextArray(String(value || '').split(",").map(s => s.trim()).filter(Boolean));
        const parseGuiLines = (value) => String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const parseGui01 = (value, fallback = 0) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return Math.max(0, Math.min(1, Number(fallback || 0)));
            return Math.max(0, Math.min(1, numeric));
        };
        const hasGuiValue = (value) => {
            if (Array.isArray(value)) return value.some(hasGuiValue);
            if (value && typeof value === 'object') return Object.values(value).some(hasGuiValue);
            return String(value || '').trim().length > 0;
        };
        const formatGuiThreads = (items) => guiArray(items).map(item => {
            if (typeof item === 'string') return item.trim();
            if (!item || typeof item !== 'object') return '';
            const label = String(item.label || item.summary || item.name || '').trim();
            if (!label) return '';
            return [
                String(item.id || '').trim(),
                String(item.status || '').trim(),
                Number.isFinite(Number(item.pressure)) ? Number(item.pressure).toFixed(2) : '',
                label
            ].join(" | ").replace(/^(?:\s*\|\s*)+/, '').trim();
        }).filter(Boolean).join("\n");
        const parseGuiThreads = (value) => parseGuiLines(value).map(line => {
            const parts = line.split("|").map(part => part.trim());
            if (parts.length >= 4) {
                return {
                    id: parts[0] || `thread_${TokenizerEngine.simpleHash(line)}`,
                    status: parts[1] || 'active',
                    pressure: parseGui01(parts[2], 0),
                    label: parts.slice(3).join(" | ").trim()
                };
            }
            return {
                id: `thread_${TokenizerEngine.simpleHash(line)}`,
                status: 'active',
                pressure: 0,
                label: line
            };
        }).filter(item => item.label);
        const formatGuiOpenThreadLabels = (items) => guiArray(items).map(item => {
            if (typeof item === 'string') return item.trim();
            if (!item || typeof item !== 'object') return '';
            return String(item.label || item.summary || item.text || item.name || '').trim();
        }).filter(Boolean).join("\n");
        const parseGuiOpenThreadLabels = (value) => parseGuiLines(value).map(line => ({
            id: `thread_${TokenizerEngine.simpleHash(line)}`,
            status: 'active',
            pressure: 0,
            label: line
        })).filter(item => item.label);
        const formatGuiEntityBackground = (entity = {}) => {
            const background = entity?.background && typeof entity.background === 'object' ? entity.background : entity?.background;
            if (typeof background === 'string') return background.trim();
            return guiFirstText(
                background?.summary,
                background?.origin,
                guiLines(background?.history || []),
                entity?.identity?.summary
            );
        };
        const formatGuiEpisodes = (items) => guiArray(items).map(item => {
            if (typeof item === 'string') return item.trim();
            if (!item || typeof item !== 'object') return '';
            return [
                item.turn ? `T${item.turn}` : '',
                String(item.stability || '').trim(),
                String(item.summary || item.event || '').trim(),
                String(item.impact || '').trim()
            ].filter(Boolean).join(" | ");
        }).filter(Boolean).join("\n");
        const parseGuiEpisodes = (value) => parseGuiLines(value).map(line => {
            const parts = line.split("|").map(part => part.trim());
            const turnMatch = (parts[0] || '').match(/^T?(\d+)$/i);
            const turn = turnMatch ? Number(turnMatch[1]) : 0;
            const offset = turnMatch ? 1 : 0;
            const stability = parts[offset] || 'current_state';
            const summary = parts[offset + 1] || (offset ? '' : parts[0]) || line;
            const impact = parts.slice(offset + 2).join(" | ").trim();
            return {
                eventId: `gui_event_${TokenizerEngine.simpleHash(`${turn}:${summary}:${impact}`)}`,
                turn,
                summary,
                impact,
                stability,
                evidence: []
            };
        }).filter(item => item.summary);
        const normalizeGuiStateTimelineRows = (items) => guiArray(items).map(item => {
            if (typeof item === 'string') {
                const summary = item.trim();
                return summary ? { turn: 0, summary, meta: [], sourceKind: '' } : null;
            }
            if (!item || typeof item !== 'object') return null;
            const turn = Number(item.turn ?? item.sourceTurn ?? item.lastObservedTurn ?? 0) || 0;
            const summary = String(item.summary || item.state || item.text || item.description || item.note || '').trim();
            const physicalState = guiArray(item.physicalState || item.physical_state || []).map(v => String(v || '').trim()).filter(Boolean);
            const emotionalState = guiArray(item.emotionalState || item.emotional_state || []).map(v => String(v || '').trim()).filter(Boolean);
            const cognitiveFocus = guiArray(item.cognitiveFocus || item.cognitive_focus || []).map(v => String(v || '').trim()).filter(Boolean);
            const meta = [
                physicalState.length ? `신체: ${physicalState.join(', ')}` : '',
                emotionalState.length ? `감정: ${emotionalState.join(', ')}` : '',
                cognitiveFocus.length ? `초점: ${cognitiveFocus.join(', ')}` : ''
            ].filter(Boolean);
            return summary || meta.length ? {
                turn,
                summary,
                meta,
                sourceKind: String(item.sourceKind || item.source || item.stability || '').trim()
            } : null;
        }).filter(Boolean).slice(-24);
        const formatGuiStateTimelineHtml = (items) => {
            const rows = normalizeGuiStateTimelineRows(items);
            if (!rows.length) return { count: 0, html: '<div class="entity-state-empty">턴별 상태 로그가 없습니다</div>' };
            return {
                count: rows.length,
                html: rows.slice().reverse().map(row => `
                    <div class="entity-state-row">
                        <div class="entity-state-row-head">
                            <span class="entity-state-turn">${row.turn ? `T${row.turn}` : 'T?'}</span>
                            ${row.sourceKind ? `<span class="entity-state-source">${esc(row.sourceKind)}</span>` : ''}
                        </div>
                        ${row.summary ? `<div class="entity-state-summary">${esc(row.summary)}</div>` : ''}
                        ${row.meta.length ? `<div class="entity-state-meta">${esc(row.meta.join(' | '))}</div>` : ''}
                    </div>
                `).join("")
            };
        };
        const formatGuiEvidence = (items) => guiArray(items).map(item => {
            if (typeof item === 'string') return item.trim();
            if (!item || typeof item !== 'object') return '';
            return [
                item.turn ? `T${item.turn}` : '',
                String(item.sourceKind || item.kind || '').trim(),
                Number.isFinite(Number(item.confidence)) ? Number(item.confidence).toFixed(2) : '',
                String(item.snippet || item.quote || item.text || '').trim()
            ].filter(Boolean).join(" | ");
        }).filter(Boolean).join("\n");
        const parseGuiEvidence = (value) => parseGuiLines(value).map(line => {
            const parts = line.split("|").map(part => part.trim());
            const turnMatch = (parts[0] || '').match(/^T?(\d+)$/i);
            const turn = turnMatch ? Number(turnMatch[1]) : 0;
            const offset = turnMatch ? 1 : 0;
            return {
                sourceKind: parts[offset] || 'gui',
                turn,
                messageId: '',
                confidence: parseGui01(parts[offset + 1], 0.7),
                snippet: parts.slice(offset + 2).join(" | ").trim() || (offset ? '' : line)
            };
        }).filter(item => item.snippet || item.turn || item.sourceKind);
        const parseGuiStoredJson = (entry = null, kind = 'gui-entry', index = -1) => {
            try {
                const parsed = JSON.parse(String(entry?.content || '{}'));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch (error) {
                recordSuppressedRuntimeError(`gui.${kind}.parse_failed`, error, {
                    comment: String(entry?.comment || '').trim(),
                    key: String(entry?.key || '').trim(),
                    index: Number(index || 0) || 0
                });
                return {};
            }
        };
        const renderEnts = () => {
            applyGuiEntityBlocklistToLocalSnapshots();
            const ec = overlay.querySelector("#el");
            if (!_ENT.length) { ec.innerHTML = '<div class="empty">추적된 인물이 없습니다</div>'; }
            else {
                ec.innerHTML = _ENT.map((e, i) => {
                    let d = parseGuiStoredJson(e, 'entity.render', i);
                    if (typeof EntityManager?.normalizeEntityRecord === 'function') d = EntityManager.normalizeEntityRecord(d);
                    const isManualLocked = !!d?.meta?.manualLocked;
                    const identity = d.identity && typeof d.identity === 'object' ? d.identity : {};
                    const profile = d.profile && typeof d.profile === 'object' ? d.profile : {};
                    const profileAppearance = profile.appearance && typeof profile.appearance === 'object' ? profile.appearance : {};
                    const profilePersonality = profile.personality && typeof profile.personality === 'object' ? profile.personality : {};
                    const profileSpeech = profile.speechStyle && typeof profile.speechStyle === 'object' ? profile.speechStyle : {};
                    const profilePsychology = profile.psychology && typeof profile.psychology === 'object' ? profile.psychology : {};
                    const currentState = d.currentState && typeof d.currentState === 'object' ? d.currentState : {};
                    const stateTimeline = formatGuiStateTimelineHtml(d.stateTimeline || d.state_timeline || []);
                    const isNameLocked = !!d?.meta?.nameManualLocked;
                    const feats = guiCsv(guiFirstList(profileAppearance.features, d?.appearance?.features));
                    const traits = guiCsv(guiFirstList(profilePersonality.traits, d?.personality?.traits));
                    const speechNotes = guiCsv(guiFirstList(profileSpeech.notes, d?.speechStyle?.notes));
                    const continuity = d.continuity && typeof d.continuity === 'object' ? d.continuity : {};
                    const backgroundText = formatGuiEntityBackground(d);
                    const psychologyText = guiFirstText(profilePsychology.baseline, profilePsychology.currentConflict, guiLines(profilePsychology.notes || []));
                    const openThreadsText = formatGuiOpenThreadLabels(continuity.openThreads || []);
                    const absorptionMeta = d?.meta?.absorption && typeof d.meta.absorption === 'object' ? d.meta.absorption : null;
                    const absorptionStatus = String(absorptionMeta?.status || '').trim().toLowerCase();
                    const isAbsorptionPending = absorptionStatus === 'pending';
                    const absorptionTarget = String(absorptionMeta?.targetName || '').trim();
                    const absorptionBadge = isAbsorptionPending
                        ? `<span class="bdg bm">흡수 대기 → ${esc(absorptionTarget || '?')}</span>`
                        : (absorptionStatus === 'applied' ? '<span class="bdg bt">흡수 완료</span>' : '');
                    const absorptionButton = isAbsorptionPending
                        ? `<button class="btn bd act-absorb-ent" data-idx="${i}" data-mode="cancel">흡수 취소</button>`
                        : `<button class="btn bs act-absorb-ent" data-idx="${i}" data-mode="mark">흡수 지정</button>`;
                    return `<div class="card ent">
                        <div class="card-hdr"><strong>${esc(d.name || e.key || "?")}</strong>
                            <div class="card-meta">${isManualLocked ? '<span class="bdg bh">수동 보호됨</span>' : '<span class="bdg bt">자동 수정 가능</span>'}${isNameLocked ? '<span class="bdg bm">이름 고정</span>' : ''}${absorptionBadge}</div>
                            <div class="acts"><button class="btn bp act-save-ent" data-idx="${i}">저장</button><button class="btn bs act-rename-ent" data-idx="${i}">이름 변경</button>${absorptionButton}<button class="btn bs act-toggle-lock-ent" data-idx="${i}">${isManualLocked ? '보호 해제' : '보호 설정'}</button><button class="btn bs act-block-ent" data-idx="${i}">차단</button><button class="btn bd act-del-ent" data-idx="${i}">삭제</button></div>
                        </div>
                        <div class="entity-band">
                            <div class="entity-band-title">기본 정본 카드</div>
                            <div class="entity-grid">
                                <div class="fld entity-wide"><label>서사 역할</label><input type="text" class="eRole-val" data-idx="${i}" value="${escAttr(identity.roleInStory || '')}"></div>
                                <div class="fld entity-wide"><label>외모 특징</label><input type="text" class="eF-val" data-idx="${i}" value="${escAttr(feats)}"></div>
                                <div class="fld entity-wide"><label>성격 특성</label><input type="text" class="eP-val" data-idx="${i}" value="${escAttr(traits)}"></div>
                                <div class="fld entity-wide"><label>배경</label><textarea class="ec eBg-val" data-idx="${i}" rows="3">${esc(backgroundText)}</textarea></div>
                                <div class="fld entity-wide"><label>현재 상태</label><textarea class="ec eCSummary-val" data-idx="${i}" rows="3">${esc(currentState.summary || '')}</textarea></div>
                                <details class="entity-state-log">
                                    <summary><span class="entity-state-log-title">턴별 상태 로그</span><span class="bdg bt">${stateTimeline.count}개</span></summary>
                                    <div class="entity-state-log-body">${stateTimeline.html}</div>
                                </details>
                                <div class="fld entity-wide"><label>말투 단서</label><input type="text" class="eSpeechNotes-val" data-idx="${i}" value="${escAttr(speechNotes)}"></div>
                                <div class="fld entity-wide"><label>심리</label><input type="text" class="ePsychBase-val" data-idx="${i}" value="${escAttr(psychologyText)}"></div>
                                <div class="fld entity-wide"><label>열린 떡밥</label><textarea class="ec eThreads-val" data-idx="${i}" rows="3">${esc(openThreadsText)}</textarea></div>
                            </div>
                        </div>
                    </div>`;
                }).join("");
            }
            renderEntityBlocklist();

            const rc = overlay.querySelector("#rl");
            if (!_REL.length) { rc.innerHTML = '<div class="empty">추적된 관계가 없습니다</div>'; }
            else {
                rc.innerHTML = _REL.map((r, i) => {
                    let d = parseGuiStoredJson(r, 'relation.render', i);
                    const isManualLocked = !!d?.meta?.manualLocked;
                    const hasCls = Number.isFinite(Number(d?.details?.closeness));
                    const hasTrs = Number.isFinite(Number(d?.details?.trust));
                    const cls = hasCls ? Math.round(Number(d.details.closeness) * 100) : null;
                    const trs = hasTrs ? Math.round(Number(d.details.trust) * 100) : null;
                    const assessment = d.relationshipAssessment && typeof d.relationshipAssessment === 'object' ? d.relationshipAssessment : {};
                    const definitionConfidence = Number.isFinite(Number(assessment.definitionConfidence))
                        ? Math.round(Number(assessment.definitionConfidence) * 100)
                        : null;
                    const currentStatus = d.currentStatus && typeof d.currentStatus === 'object' ? d.currentStatus : {};
                    const dynamics = d.dynamics && typeof d.dynamics === 'object' ? d.dynamics : {};
                    return `<div class="card rel">
                        <div class="card-hdr"><strong>${esc(d.entityA || "?")} ↔ ${esc(d.entityB || "?")}</strong>
                            <div class="card-meta">${isManualLocked ? '<span class="bdg bh">수동 보호됨</span>' : '<span class="bdg bt">자동 수정 가능</span>'}</div>
                            <div class="acts"><button class="btn bp act-save-rel" data-idx="${i}">저장</button><button class="btn bs act-toggle-lock-rel" data-idx="${i}">${isManualLocked ? '보호 해제' : '보호 설정'}</button><button class="btn bd act-del-rel" data-idx="${i}">삭제</button></div>
                        </div>
                        <div class="rel-define">
                            <div>
                                <div class="rel-define-main">${esc(assessment.label || (hasCls || hasTrs ? '관계 정의됨' : '첫 대면 · 정의 보류'))}${definitionConfidence != null ? ` · ${definitionConfidence}%` : ''}</div>
                                <div class="rel-define-note">${esc(assessment.note || (hasCls || hasTrs ? '관계 수치가 기록되어 있습니다.' : '관계를 정의하기에는 근거가 부족합니다.'))}</div>
                            </div>
                            <span class="bdg ${assessment.inferred === false ? 'bh' : 'bt'}">${assessment.inferred === false ? '정의됨' : '추정'}</span>
                        </div>
                        <div class="ef">
                            <div class="fld"><label>관계 유형</label><input type="text" class="rT-val" data-idx="${i}" value="${escAttr(d.relationType || "")}"></div>
                            <div class="fld"><label>감정 (A→B)</label><input type="text" class="rS-val" data-idx="${i}" value="${escAttr((d.sentiments && d.sentiments.fromAtoB) || "")}"></div>
                        </div>
                        <div class="fld"><label>관계 요약</label><input type="text" class="rState-val" data-idx="${i}" value="${escAttr(currentStatus.summary || '')}"></div>
                        <div class="fld"><label>최근 변화</label><textarea class="ec rChanges-val" data-idx="${i}" rows="3">${esc(guiLines(dynamics.recentChanges || []))}</textarea></div>
                        <div class="fld"><label>미해결 이슈</label><textarea class="ec rIssues-val" data-idx="${i}" rows="3">${esc(guiLines(dynamics.unresolvedIssues || []))}</textarea></div>
                        <div class="ef">
                            <div class="fld">
                                <div class="rel-score-head"><label>친밀도 ${cls == null ? '판단 보류' : `${cls}%`}</label><div class="rel-score-tools">${cls == null ? '<span class="bdg bt">근거 부족</span>' : ''}<button class="btn bd act-unset-rel-score" data-idx="${i}" data-field="closeness" type="button">미정</button></div></div>
                                <div class="rw"><input type="range" class="rC-val" data-idx="${i}" min="0" max="100" value="${cls ?? 0}" data-unset="${cls == null ? '1' : '0'}"></div>
                            </div>
                            <div class="fld">
                                <div class="rel-score-head"><label>신뢰도 ${trs == null ? '판단 보류' : `${trs}%`}</label><div class="rel-score-tools">${trs == null ? '<span class="bdg bt">근거 부족</span>' : ''}<button class="btn bd act-unset-rel-score" data-idx="${i}" data-field="trust" type="button">미정</button></div></div>
                                <div class="rw"><input type="range" class="rR-val" data-idx="${i}" min="0" max="100" value="${trs ?? 0}" data-unset="${trs == null ? '1' : '0'}"></div>
                            </div>
                        </div>
                    </div>`;
                }).join("");
            }
        };

        const formatNarrativeRecentEvents = (storyline) => {
            const events = Array.isArray(storyline?.recentEvents) ? storyline.recentEvents : [];
            return events.map(evt => {
                if (evt && typeof evt === 'object') {
                    const turn = evt.turn ?? '?';
                    const brief = String(evt.brief || '').trim();
                    return brief ? `T${turn}: ${brief}` : '';
                }
                return String(evt || '').trim();
            }).filter(Boolean).join("\n");
        };

        const formatNarrativeSummaryHistory = (storyline) => {
            const summaries = Array.isArray(storyline?.summaries) ? storyline.summaries : [];
            return summaries.map((entry, idx) => {
                const turn = entry?.upToTurn ?? '?';
                const summary = String(entry?.summary || '').trim();
                const keyPoints = Array.isArray(entry?.keyPoints) && entry.keyPoints.length > 0
                    ? ` | Key: ${entry.keyPoints.join('; ')}`
                    : '';
                const tensions = Array.isArray(entry?.ongoingTensions) && entry.ongoingTensions.length > 0
                    ? ` | Flow: ${entry.ongoingTensions.join('; ')}`
                    : '';
                return `${idx + 1}. T${turn} | ${summary}${keyPoints}${tensions}`.trim();
            }).filter(Boolean).join("\n");
        };

        const formatNarrativeTurnFlow = (storyline) => {
            const turns = new Set(Array.isArray(storyline?.turns) ? storyline.turns : []);
            const logs = Array.isArray(_NAR?.turnLog) ? _NAR.turnLog : [];
            return logs
                .filter(entry => turns.has(entry.turn))
                .map(entry => `T${entry.turn} | ${String(entry.summary || entry.response || entry.responseBrief || '').trim()}`)
                .filter(line => !/^\s*T\d+\s*\|\s*$/.test(line))
                .join("\n\n");
        };

        const renderNarrative = () => {
            const list = overlay.querySelector("#narrative-list");
            const counter = overlay.querySelector("#nc");
            const storylines = Array.isArray(_NAR?.storylines) ? _NAR.storylines : [];
            counter.textContent = storylines.length;
            if (!storylines.length) {
                list.innerHTML = '<div class="empty">저장된 내러티브가 없습니다</div>';
                return;
            }

            list.innerHTML = storylines.map((storyline, i) => {
                const entities = Array.isArray(storyline.entities) ? storyline.entities.join(", ") : "";
                const keyPoints = Array.isArray(storyline.keyPoints) ? storyline.keyPoints.join(", ") : "";
                const recentEvents = formatNarrativeRecentEvents(storyline);
                const ongoingFlow = Array.isArray(storyline.ongoingTensions) ? storyline.ongoingTensions.join(", ") : "";
                const summaryHistory = formatNarrativeSummaryHistory(storyline);
                const turnFlow = formatNarrativeTurnFlow(storyline);
                const summary = Array.isArray(storyline.summaries) && storyline.summaries.length > 0
                    ? (storyline.summaries[storyline.summaries.length - 1]?.summary || "")
                    : "";
                const isManualLocked = storyline?.meta?.manualLocked === true;
                return `<div class="card nar">
                    <div class="card-hdr">
                        <strong>${esc(storyline.name || `Storyline ${i + 1}`)}</strong>
                        <div class="card-meta">${isManualLocked ? '<span class="bdg bh">수동 보호됨</span>' : '<span class="bdg bt">자동 요약 가능</span>'}</div>
                        <div class="acts">
                            <button class="btn bp act-save-nar" data-idx="${i}">저장</button>
                            <button class="btn bs act-toggle-lock-nar" data-idx="${i}">${isManualLocked ? '보호 해제' : '보호 설정'}</button>
                            <button class="btn bd act-del-nar" data-idx="${i}">삭제</button>
                        </div>
                    </div>
                    <div class="fld"><label>이름</label><input type="text" class="nN-val" data-idx="${i}" value="${escAttr(storyline.name || '')}"></div>
                    <div class="fld"><label>등장 인물 (쉼표 구분)</label><input type="text" class="nE-val" data-idx="${i}" value="${escAttr(entities)}"></div>
                    <div class="fld"><label>현재 맥락</label><textarea class="ec nC-val" data-idx="${i}" rows="3">${esc(storyline.currentContext || '')}</textarea></div>
                    <div class="fld"><label>핵심 포인트 (쉼표 구분)</label><textarea class="ec nK-val" data-idx="${i}" rows="3">${esc(keyPoints)}</textarea></div>
                    <div class="fld"><label>진행 중 흐름 (쉼표 구분)</label><textarea class="ec nO-val" data-idx="${i}" rows="3">${esc(ongoingFlow)}</textarea></div>
                    <div class="fld"><label>최근 이벤트 (줄바꿈 구분)</label><textarea class="ec nR-val" data-idx="${i}" rows="4">${esc(recentEvents)}</textarea></div>
                    <div class="fld"><label>최근 요약</label><textarea class="ec nS-val" data-idx="${i}" rows="3">${esc(summary)}</textarea></div>
                    <div class="fld"><label>요약 이력 (읽기 전용)</label><textarea class="ec" rows="6" readonly>${esc(summaryHistory)}</textarea></div>
                    <div class="fld"><label>턴별 서사 흐름 (읽기 전용)</label><textarea class="ec" rows="8" readonly>${esc(turnFlow)}</textarea></div>
                </div>`;
            }).join("");
        };

        const getActiveWorldNodeSnapshot = () => {
            if (!_WLD || !Array.isArray(_WLD.nodes) || _WLD.nodes.length === 0) return null;
            const activePath = Array.isArray(_WLD.activePath) ? _WLD.activePath : [];
            const targetId = activePath[activePath.length - 1] || _WLD.rootId || (_WLD.nodes[0] && _WLD.nodes[0][0]);
            const index = _WLD.nodes.findIndex(entry => entry && entry[0] === targetId);
            if (index < 0) return null;
            const entry = _WLD.nodes[index];
            return { targetId, index, entry, node: entry?.[1] && typeof entry[1] === 'object' ? entry[1] : {} };
        };
        const worldListToTextarea = (value, limit = 48) => normalizeWorldCanonTextList(value, limit).join('\n');
        const worldTextareaToList = (selector, limit = 48) => normalizeWorldCanonTextList(String(overlay.querySelector(selector)?.value || '').split('\n'), limit);
        const worldBooleanToSelectValue = (value) => value === true ? 'true' : (value === false ? 'false' : '');
        const setWorldSelectValue = (selector, value) => {
            const el = overlay.querySelector(selector);
            if (el) el.value = worldBooleanToSelectValue(value);
        };
        const applyWorldSelectValue = (target, key, selector) => {
            const value = String(overlay.querySelector(selector)?.value || '').trim();
            if (value === 'true') target[key] = true;
            else if (value === 'false') target[key] = false;
            else delete target[key];
        };
        const getWorldCustomRuleLines = (custom = {}) => Object.values(normalizeWorldCustomRules(custom))
            .flatMap(value => normalizeWorldCanonTextList(value, 24));
        const buildGuiWorldCustomRules = (lines = []) => {
            const rules = {};
            normalizeWorldCanonTextList(lines, 48).forEach((line, index) => { rules[`rule_${index + 1}`] = line; });
            return rules;
        };
        const renderWorldFields = (currentNode = null, effectiveRules = null) => {
            const node = currentNode || {};
            const rules = effectiveRules || node.rules || {};
            const meta = node.meta || {};
            const metadata = meta.worldMetadata && typeof meta.worldMetadata === 'object' ? meta.worldMetadata : {};
            const exists = rules.exists || {};
            const systems = rules.systems || {};
            const setting = normalizeWorldSettingRules(rules.setting);
            const physics = rules.physics || {};
            const customLines = getWorldCustomRuleLines(rules.custom || {});
            const classifiedCustom = classifyWorldCanonStatements(customLines);
            const displaySetting = normalizeWorldSettingRules({
                places: [setting.places, classifiedCustom.places],
                organizations: [setting.organizations, classifiedCustom.organizations],
                socialRules: [setting.socialRules, classifiedCustom.socialRules]
            });
            const displayPhenomena = normalizeWorldCanonTextList([physics.special_phenomena || [], classifiedCustom.phenomena], 24);
            const setValue = (selector, value) => {
                const el = overlay.querySelector(selector);
                if (el) el.value = String(value || '');
            };
            setValue('#world-node-name', node.name || '');
            setValue('#world-classification', meta.classification || metadata.classification || '');
            setValue('#world-summary', meta.worldSummary || metadata.summary || metadata.description || '');
            setValue('#world-tech', exists.technology || metadata.tech || '');
            setWorldSelectValue('#world-magic', exists.magic);
            setWorldSelectValue('#world-ki', exists.ki);
            setWorldSelectValue('#world-supernatural', exists.supernatural);
            for (const key of ['leveling', 'skills', 'stats', 'classes', 'guilds', 'factions']) {
                setWorldSelectValue(`#world-system-${key}`, systems[key]);
            }
            setValue('#world-gravity', physics.gravity || '');
            setValue('#world-time-flow', physics.time_flow || physics.timeFlow || '');
            setValue('#world-space', physics.space || '');
            setValue('#world-places', displaySetting.places.join('\n'));
            setValue('#world-organizations', displaySetting.organizations.join('\n'));
            setValue('#world-social-rules', displaySetting.socialRules.join('\n'));
            setValue('#world-mythical', worldListToTextarea(exists.mythical_creatures || [], 24));
            setValue('#world-races', worldListToTextarea(exists.non_human_races || [], 24));
            setValue('#world-phenomena', worldListToTextarea(displayPhenomena, 24));
            setValue('#world-custom-rules', classifiedCustom.custom.join('\n'));
        };
        const renderWorldStateLog = () => {
            const box = overlay.querySelector('#world-state-log');
            if (!box) return;
            const state = WorldStateTracker.getState?.() || { turnLog: [], consolidated: [] };
            const logs = Array.isArray(state.turnLog) ? state.turnLog.slice(-8) : [];
            if (logs.length === 0) {
                box.innerHTML = '<div class="empty">현재 세계 상태 로그가 없습니다</div>';
                return;
            }
            box.innerHTML = logs.map(entry => {
                const parts = [];
                if (entry.turn) parts.push(`T${entry.turn}`);
                if (entry.currentTime) parts.push(`시간: ${entry.currentTime}`);
                if (entry.currentLocation) parts.push(`위치: ${entry.currentLocation}`);
                if (entry.currentScene) parts.push(`장면: ${entry.currentScene}`);
                if (Array.isArray(entry.activeEvents) && entry.activeEvents.length > 0) parts.push(`진행: ${entry.activeEvents.slice(0, 3).join(', ')}`);
                if (Array.isArray(entry.offscreenThreads) && entry.offscreenThreads.length > 0) parts.push(`오프스크린: ${entry.offscreenThreads.slice(0, 3).join(', ')}`);
                if (Array.isArray(entry.ruleHighlights) && entry.ruleHighlights.length > 0) parts.push(`규칙: ${entry.ruleHighlights.slice(0, 3).join(', ')}`);
                return `<div style="margin-bottom:8px;white-space:pre-wrap;word-break:break-word">${esc(parts.join('\n'))}</div>`;
            }).join('');
        };
        const saveWorldFieldsFromGui = async () => {
            const snapshot = getActiveWorldNodeSnapshot();
            if (!snapshot) throw new Error('현재 세계 노드를 찾을 수 없습니다.');
            const node = safeClone(snapshot.node || {});
            node.name = String(overlay.querySelector('#world-node-name')?.value || node.name || '주요 세계').trim() || '주요 세계';
            node.rules = node.rules && typeof node.rules === 'object' ? safeClone(node.rules) : {};
            node.meta = node.meta && typeof node.meta === 'object' ? safeClone(node.meta) : {};
            node.meta.worldMetadata = node.meta.worldMetadata && typeof node.meta.worldMetadata === 'object' ? safeClone(node.meta.worldMetadata) : {};

            const rules = node.rules;
            rules.exists = rules.exists && typeof rules.exists === 'object' ? rules.exists : {};
            rules.systems = rules.systems && typeof rules.systems === 'object' ? rules.systems : {};
            rules.physics = rules.physics && typeof rules.physics === 'object' ? rules.physics : {};

            const classification = String(overlay.querySelector('#world-classification')?.value || '').trim();
            const summary = String(overlay.querySelector('#world-summary')?.value || '').trim();
            const tech = String(overlay.querySelector('#world-tech')?.value || '').trim();
            node.meta.classification = classification;
            node.meta.worldSummary = summary;
            node.meta.worldMetadata = {
                ...node.meta.worldMetadata,
                classification,
                summary,
                description: summary,
                tech
            };
            if (tech) rules.exists.technology = tech;
            else delete rules.exists.technology;

            applyWorldSelectValue(rules.exists, 'magic', '#world-magic');
            applyWorldSelectValue(rules.exists, 'ki', '#world-ki');
            applyWorldSelectValue(rules.exists, 'supernatural', '#world-supernatural');
            rules.exists.mythical_creatures = worldTextareaToList('#world-mythical', 24);
            rules.exists.non_human_races = worldTextareaToList('#world-races', 24);

            for (const key of ['leveling', 'skills', 'stats', 'classes', 'guilds', 'factions']) {
                applyWorldSelectValue(rules.systems, key, `#world-system-${key}`);
            }
            rules.setting = normalizeWorldSettingRules({
                places: worldTextareaToList('#world-places', 32),
                organizations: worldTextareaToList('#world-organizations', 32),
                socialRules: worldTextareaToList('#world-social-rules', 48)
            });
            rules.physics.gravity = String(overlay.querySelector('#world-gravity')?.value || '').trim() || 'normal';
            rules.physics.time_flow = String(overlay.querySelector('#world-time-flow')?.value || '').trim() || 'linear';
            rules.physics.space = String(overlay.querySelector('#world-space')?.value || '').trim() || 'three_dimensional';
            rules.physics.special_phenomena = worldTextareaToList('#world-phenomena', 24);
            rules.custom = buildGuiWorldCustomRules(worldTextareaToList('#world-custom-rules', 48));
            const guiRuleEvidence = [
                rules.exists.magic === true ? 'magic present' : '',
                rules.exists.magic === false ? 'no magic' : '',
                rules.exists.ki === true ? 'ki present' : '',
                rules.exists.ki === false ? 'no ki' : '',
                rules.exists.supernatural === true ? 'supernatural present' : '',
                rules.exists.supernatural === false ? 'no supernatural' : '',
                ...['leveling', 'skills', 'stats', 'classes'].flatMap(key => [
                    rules.systems[key] === true ? `${key} system present` : '',
                    rules.systems[key] === false ? `no ${key} system` : ''
                ])
            ].filter(Boolean);
            node.rules = sanitizeWorldRuleUpdateForPolicy(rules, [classification, summary, collectWorldRuleEvidenceText(rules), ...guiRuleEvidence].filter(Boolean).join('\n'));
            node.meta.updated = Date.now();

            _WLD.nodes[snapshot.index] = [snapshot.entry[0], node];
            const liveProfile = HierarchicalWorldManager.getProfile?.();
            if (liveProfile?.nodes instanceof Map && liveProfile.nodes.has(snapshot.targetId)) {
                liveProfile.nodes.set(snapshot.targetId, safeClone(node));
                if (liveProfile.global && _WLD.global) liveProfile.global = { ..._WLD.global };
            }
            syncWorldSnapshotFromRuntime();
            await persistWorldGraphFromGui('💾 세계관 필드 저장 완료', true);
            return true;
        };

        const renderWorld = () => {
            const tc = overlay.querySelector("#wt");
            const rc = overlay.querySelector("#wr");
            const userCorrectionBox = overlay.querySelector("#world-user-correction");
            const lensMeta = overlay.querySelector("#world-lens-meta");
            const lensPrompt = overlay.querySelector("#world-lens-prompt");
            const codexStatus = overlay.querySelector("#world-codex-status");
            if (!_WLD || !_WLD.nodes || !_WLD.nodes.length) {
                tc.innerHTML = '<div class="empty">세계관 데이터가 없습니다</div>';
                if (rc) rc.innerHTML = '<span style="color:var(--text2)">규칙 없음</span>';
                if (userCorrectionBox) userCorrectionBox.value = '';
                if (lensMeta) lensMeta.innerHTML = '<span style="color:var(--text2)">아직 생성된 장면용 세계관 보정이 없습니다</span>';
                if (lensPrompt) {
                    lensPrompt.value = '';
                    lensPrompt.placeholder = '아직 생성된 장면용 세계관 보정이 없습니다.';
                }
                if (codexStatus) codexStatus.innerHTML = '<span style="color:var(--text2)">세계관 코덱스 데이터가 없습니다</span>';
                renderWorldFields(null, null);
                renderWorldStateLog();
                return;
            }
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
            const featureBox = overlay.querySelector("#world-global-features");
            const activeFeatures = [
                g.multiverse ? '멀티버스' : '',
                g.dimensionTravel ? '차원 이동' : '',
                g.timeTravel ? '시간 여행' : '',
                g.metaNarrative ? '메타 서술' : '',
                g.virtualReality ? '가상현실' : '',
                g.dreamWorld ? '꿈 세계' : '',
                g.reincarnationPossession ? '회귀·환생·빙의' : '',
                g.systemInterface ? '시스템 인터페이스' : ''
            ].filter(Boolean);
            featureBox.innerHTML = activeFeatures.length > 0
                ? `<div>${esc(activeFeatures.join(', '))}</div>`
                : '<div class="empty">감지된 전역 세계 특성이 없습니다</div>';
            
            const lid = ap[ap.length - 1];
            let currentNode = null;
            if (lid) {
                for (let i = 0; i < _WLD.nodes.length; i++) {
                    if (_WLD.nodes[i][0] === lid) {
                        currentNode = _WLD.nodes[i][1];
                        break;
                    }
                }
            }
            const effectiveRules = lid ? sanitizeWorldRuleUpdateForPolicy(HierarchicalWorldManager.getEffectiveRules(lid), collectWorldRuleEvidenceText(HierarchicalWorldManager.getEffectiveRules(lid))) : null;
            renderWorldFields(currentNode, effectiveRules || currentNode?.rules || null);
            renderWorldStateLog();
            if (effectiveRules) {
                const nodeMeta = currentNode?.meta || {};
                const worldSummaryLines = [];
                if (nodeMeta.classification) worldSummaryLines.push(`분류: ${String(nodeMeta.classification)}`);
                if (nodeMeta.worldSummary) worldSummaryLines.push(String(nodeMeta.worldSummary));
                if (nodeMeta.worldMetadata?.description) worldSummaryLines.push(`설명: ${String(nodeMeta.worldMetadata.description)}`);
                if (nodeMeta.worldMetadata?.tech) worldSummaryLines.push(`기술 메모: ${String(nodeMeta.worldMetadata.tech)}`);
                const manualCorrection = String(nodeMeta.userWorldCorrection || nodeMeta.worldMetadata?.userWorldCorrection || '').trim();
                if (userCorrectionBox) userCorrectionBox.value = manualCorrection;
                const ex = effectiveRules.exists || {};
                const sys = effectiveRules.systems || {};
                const physics = effectiveRules.physics || {};
                const custom = Array.isArray(effectiveRules.custom)
                    ? effectiveRules.custom.map(v => String(v || '').trim()).filter(Boolean)
                    : (effectiveRules.custom && typeof effectiveRules.custom === 'object')
                        ? Object.entries(effectiveRules.custom)
                            .flatMap(([key, value]) => splitImportedWorldRuleFragments(String(value || '')).map(fragment => {
                                if (!fragment || isDiscardableWorldCanonFragment(fragment)) return '';
                                return /^rule_\d+$/i.test(String(key || '').trim()) ? fragment : `${key}: ${fragment}`;
                            }))
                            .filter(Boolean)
                        : [];
                const lines = [];
                if (worldSummaryLines.length > 0) {
                    lines.push(...worldSummaryLines);
                    lines.push('---');
                }
                const existingElements = [];
                if (shouldEmitWorldPresentRule(effectiveRules, 'magic')) existingElements.push("마법");
                if (shouldEmitWorldPresentRule(effectiveRules, 'ki')) existingElements.push("기(氣)");
                if (shouldEmitWorldPresentRule(effectiveRules, 'supernatural')) existingElements.push("초자연");
                if (Array.isArray(ex.mythical_creatures) && ex.mythical_creatures.length > 0) existingElements.push(...ex.mythical_creatures);
                if (Array.isArray(ex.non_human_races) && ex.non_human_races.length > 0) existingElements.push(...ex.non_human_races);
                if (existingElements.length > 0) lines.push(existingElements.join(', '));
                const absentElements = [];
                if (shouldEmitWorldAbsentRule(effectiveRules, 'magic')) absentElements.push("마법 없음");
                if (shouldEmitWorldAbsentRule(effectiveRules, 'ki')) absentElements.push("기 없음");
                if (shouldEmitWorldAbsentRule(effectiveRules, 'supernatural')) absentElements.push("초자연 없음");
                if (absentElements.length > 0) lines.push(`부재: ${absentElements.join(', ')}`);

                const activeSystems = [];
                if (sys.leveling) activeSystems.push("레벨링");
                if (sys.skills) activeSystems.push("스킬");
                if (sys.stats) activeSystems.push("스탯");
                if (sys.classes) activeSystems.push("직업");
                if (sys.guilds) activeSystems.push("길드");
                if (sys.factions) activeSystems.push("세력");
                if (activeSystems.length > 0) lines.push(activeSystems.join(', '));
                const inactiveSystems = [];
                if (shouldEmitWorldInactiveSystem(effectiveRules, 'leveling')) inactiveSystems.push("레벨");
                if (shouldEmitWorldInactiveSystem(effectiveRules, 'skills')) inactiveSystems.push("스킬");
                if (shouldEmitWorldInactiveSystem(effectiveRules, 'stats')) inactiveSystems.push("스탯");
                if (shouldEmitWorldInactiveSystem(effectiveRules, 'classes')) inactiveSystems.push("직업");
                if (inactiveSystems.length > 0) lines.push(`비활성 시스템: ${inactiveSystems.join(', ')}`);

                if (ex.technology) lines.push(`기술: ${String(ex.technology)}`);
                const setting = normalizeWorldSettingRules(effectiveRules.setting);
                if (setting.places.length > 0) lines.push(`장소·시설: ${setting.places.join(', ')}`);
                if (setting.organizations.length > 0) lines.push(`조직: ${setting.organizations.join(', ')}`);
                if (setting.socialRules.length > 0) lines.push(`사회·문화 규칙:\n${setting.socialRules.map(rule => `- ${rule}`).join('\n')}`);
                if (physics.gravity && !isDefaultWorldGravity(physics.gravity)) lines.push(`중력: ${String(physics.gravity)}`);
                if ((physics.time_flow || physics.timeFlow) && !isDefaultWorldTimeFlow(physics.time_flow || physics.timeFlow)) lines.push(`시간 흐름: ${String(physics.time_flow || physics.timeFlow)}`);
                if (physics.space && !isDefaultWorldSpace(physics.space)) lines.push(`공간: ${String(physics.space)}`);
                if (physics.dimensionStability) lines.push(String(physics.dimensionStability));
                if (Array.isArray(physics.special_phenomena) && physics.special_phenomena.length > 0) {
                    const phenomena = physics.special_phenomena
                        .flatMap(v => splitImportedWorldRuleFragments(v))
                        .filter(fragment => fragment && !isDiscardableWorldCanonFragment(fragment));
                    if (phenomena.length > 0) lines.push(dedupeTextArray(phenomena).join(', '));
                }
                if (custom.length > 0) lines.push(custom.join('\n'));

                rc.innerHTML = lines.length
                    ? `<div style="white-space:pre-wrap;word-break:break-word;line-height:1.55">${esc(lines.join('\n'))}</div>`
                    : '<span style="color:var(--text2)">규칙 없음</span>';
            } else {
                rc.innerHTML = '<span style="color:var(--text2)">규칙 없음</span>';
                if (userCorrectionBox) userCorrectionBox.value = '';
            }
            const sectionWorldMeta = SectionWorldInferenceManager.getLastMeta();
            const sectionWorldPrompt = SectionWorldInferenceManager.getLastPrompt();
            if (lensMeta) {
                const chips = [];
                if (sectionWorldMeta.title) chips.push(`<span class="bdg bt" style="display:inline-block;margin:2px">${esc(sectionWorldMeta.title)}</span>`);
                if (Array.isArray(sectionWorldMeta.activeRules)) {
                    sectionWorldMeta.activeRules.slice(0, 4).forEach(rule => chips.push(`<span class="bdg bt" style="display:inline-block;margin:2px">${esc(rule)}</span>`));
                }
                if (Array.isArray(sectionWorldMeta.scenePressures)) {
                    sectionWorldMeta.scenePressures.slice(0, 3).forEach(item => chips.push(`<span class="bdg bt" style="display:inline-block;margin:2px">${esc(item)}</span>`));
                }
                if (Array.isArray(sectionWorldMeta.sourceRefs) && sectionWorldMeta.sourceRefs.length > 0) {
                    chips.push(`<span class="bdg bh" style="display:inline-block;margin:2px">근거: ${esc(sectionWorldMeta.sourceRefs.slice(0, 5).join(', '))}</span>`);
                }
                lensMeta.innerHTML = chips.length > 0
                    ? chips.join("")
                    : '<span style="color:var(--text2)">아직 생성된 장면용 세계관 보정이 없습니다</span>';
            }
            if (lensPrompt) {
                lensPrompt.value = sectionWorldPrompt || '';
                lensPrompt.placeholder = sectionWorldPrompt
                    ? ''
                    : '아직 생성된 장면용 세계관 보정이 없습니다.';
            }
            if (codexStatus) {
                const nodeCount = Array.isArray(_WLD.nodes) ? _WLD.nodes.length : 0;
                const activeNames = (Array.isArray(ap) ? ap : []).map(id => {
                    const found = (_WLD.nodes || []).find(item => item && item[0] === id);
                    return found?.[1]?.name || id;
                }).filter(Boolean);
                const currentClassification = currentNode?.meta?.classification || currentNode?.meta?.worldMetadata?.classification || '';
                const promptTokens = TokenizerEngine.estimateTokens(HierarchicalWorldManager.formatForPrompt() || '', 'simple');
                const sourceBundle = buildCharacterWorldSourceBundle(char, chat, 3000);
                codexStatus.innerHTML = [
                    `<div>노드 수: <b>${nodeCount}</b> / 활성 경로: ${esc(activeNames.join(' › ') || '없음')}</div>`,
                    currentClassification ? `<div>분류: ${esc(String(currentClassification))}</div>` : '',
                    `<div>캐릭터 세계관 소스: <b>${sourceBundle.count}</b>개 참고 가능</div>`,
                    `<div>주입 토큰 추정: 약 ${promptTokens} tokens / 장면 보정: ${_CFG?.sectionWorldInferenceEnabled !== false ? '사용' : '꺼짐'}</div>`,
                    '<div style="color:var(--text2);margin-top:4px">세계관 코덱스는 저장된 LIBRA world graph를 요약해 주입합니다. 재분석과 장면 보정은 캐릭터 설명과 캐릭터 로어북도 세계관 정의 근거로 함께 참고합니다.</div>'
                ].filter(Boolean).join('');
            }
        };
        const refreshSectionWorldLensFromGui = async (force = false) => {
            if (!_CFG?.sectionWorldInferenceEnabled) return false;
            if (!force && SectionWorldInferenceManager.getLastPrompt()) return true;
            const worldPrompt = HierarchicalWorldManager.formatForPrompt();
            const worldStatePrompt = WorldStateTracker.formatForPrompt();
            const narrativePrompt = NarrativeTracker.formatForPrompt();
            const sourceBundle = buildCharacterWorldSourceBundle(char, chat, 5000);
            if (!worldPrompt && !worldStatePrompt && !narrativePrompt && !sourceBundle.context) return false;
            const activeUser = String(_lastUserMessage || _lastUserMessageRaw || '').trim();
            const focusCharacters = Array.from(EntityManager.getEntityCache().values()).slice(0, 6).map(entity => String(entity?.name || '').trim()).filter(Boolean);
            await SectionWorldInferenceManager.inferPrompt(_CFG, {
                turn: MemoryEngine.getCurrentTurn(),
                userMsg: activeUser,
                worldPrompt,
                worldStatePrompt,
                narrativePrompt,
                focusCharacters,
                memoryHints: [],
                loreHints: sourceBundle.context
                    ? [`[Character Description and Character Lorebook]\n${sourceBundle.context}`]
                    : []
            });
            renderWorld();
            return true;
        };

        const buildNarrativeLoreEntry = () => ({
            key: LibraLoreKeys.narrative(),
            comment: 'lmai_narrative',
            content: JSON.stringify(_NAR),
            mode: 'normal',
            insertorder: 70,
            alwaysActive: false
        });

        const applyColdStartScopePresetToUI = (preset = 'all', limit = null) => {
            const select = overlay.querySelector('#scsp');
            const limitInput = overlay.querySelector('#schl');
            const limitWrap = overlay.querySelector('#schl-wrap');
            const normalizedPreset = String(preset || 'all').trim() || 'all';
            if (select) select.value = ['all', 'recent100', 'recent200', 'recent500', 'custom'].includes(normalizedPreset) ? normalizedPreset : 'custom';
            const resolvedLimit = Number(limit ?? _CFG?.coldStartHistoryLimit ?? MemoryEngine.CONFIG?.coldStartHistoryLimit ?? 0);
            if (limitInput) limitInput.value = Number.isFinite(resolvedLimit) && resolvedLimit > 0 ? Math.floor(resolvedLimit) : '';
            if (limitWrap) limitWrap.style.display = (select?.value === 'custom') ? 'block' : 'none';
        };

        const getReasoningUiSelectors = (prefix) => ({
            preset: `#${prefix}rp`,
            provider: prefix === 'sl' ? '#slp' : '#saxp',
            url: prefix === 'sl' ? '#slu' : '#saxu',
            model: prefix === 'sl' ? '#slm' : '#saxm',
            effort: `#${prefix}re`,
            budget: `#${prefix}rb`,
            maxCompletion: `#${prefix}mc`,
            glmThinking: `#${prefix}gt`,
            hint: `#${prefix}rh`,
            effortWrap: `#${prefix}re-wrap`,
            budgetWrap: `#${prefix}rb-wrap`,
            glmWrap: `#${prefix}gt-wrap`
        });
        const detectReasoningFamilyFromUI = (prefix) => {
            const ids = getReasoningUiSelectors(prefix);
            return detectReasoningFamily({
                provider: overlay.querySelector(ids.provider)?.value || '',
                url: overlay.querySelector(ids.url)?.value || '',
                model: overlay.querySelector(ids.model)?.value || ''
            });
        };
        const syncReasoningPresetUi = (prefix, options = {}) => {
            const ids = getReasoningUiSelectors(prefix);
            const presetSelect = overlay.querySelector(ids.preset);
            if (!presetSelect) return;
            const selectedPreset = String(presetSelect.value || 'auto').toLowerCase();
            const activeFamily = selectedPreset === 'auto' ? detectReasoningFamilyFromUI(prefix) : selectedPreset;
            const presetDef = getReasoningPresetDefinition(selectedPreset === 'auto' ? activeFamily : selectedPreset);
            const hintEl = overlay.querySelector(ids.hint);
            if (hintEl) {
                const autoNotice = selectedPreset === 'auto' ? `자동 감지 결과: ${presetDef.label}` : `현재 프리셋: ${presetDef.label}`;
                hintEl.textContent = `${autoNotice} · ${presetDef.hint}`;
            }
            const showEffort = activeFamily === 'gpt' || selectedPreset === 'custom';
            const showBudget = REASONING_BUDGET_FAMILIES.includes(activeFamily) || selectedPreset === 'custom';
            const showGlm = activeFamily === 'glm' || selectedPreset === 'custom';
            const effortWrap = overlay.querySelector(ids.effortWrap);
            const budgetWrap = overlay.querySelector(ids.budgetWrap);
            const glmWrap = overlay.querySelector(ids.glmWrap);
            if (effortWrap) effortWrap.style.display = showEffort ? '' : 'none';
            if (budgetWrap) budgetWrap.style.display = showBudget ? '' : 'none';
            if (glmWrap) glmWrap.style.display = showGlm ? '' : 'none';
            if (options.applyPresetValues) {
                const presetValues = getReasoningPresetDefinition(activeFamily);
                const effortEl = overlay.querySelector(ids.effort);
                const budgetEl = overlay.querySelector(ids.budget);
                const maxCompletionEl = overlay.querySelector(ids.maxCompletion);
                const glmThinkingEl = overlay.querySelector(ids.glmThinking);
                if (effortEl) effortEl.value = presetValues.reasoningEffort || 'none';
                if (budgetEl) budgetEl.value = Number(presetValues.reasoningBudgetTokens || 0);
                if (maxCompletionEl) {
                    const fallbackMax = prefix === 'sl' ? DEFAULT_MAX_COMPLETION_TOKENS : DEFAULT_AUX_MAX_COMPLETION_TOKENS;
                    maxCompletionEl.value = Number(presetValues.maxCompletionTokens || fallbackMax);
                }
                if (glmThinkingEl) glmThinkingEl.value = presetValues.glmThinkingType || 'enabled';
            }
        };
        const buildSettingsConfigFromUI = () => {
            const coldStartScopePreset = String(overlay.querySelector('#scsp')?.value || _CFG.coldStartScopePreset || MemoryEngine.CONFIG.coldStartScopePreset || 'all');
            const coldStartCustomLimit = Number(overlay.querySelector('#schl')?.value || _CFG.coldStartHistoryLimit || MemoryEngine.CONFIG.coldStartHistoryLimit || 0);
            const analysisEvidenceMode = normalizeAnalysisEvidenceMode(overlay.querySelector('#saem')?.value || _CFG.analysisEvidenceMode || MemoryEngine.CONFIG.analysisEvidenceMode);
            const storyAuthorMode = String(overlay.querySelector("#ssam")?.value || _CFG.storyAuthorMode || MemoryEngine.CONFIG.storyAuthorMode || 'disabled').toLowerCase();
            const directorMode = String(overlay.querySelector("#sdm")?.value || _CFG.directorMode || MemoryEngine.CONFIG.directorMode || 'disabled').toLowerCase();
            return {
                ...buildOptimizedHiddenSettingsDefaults({ coldStartScopePreset, coldStartHistoryLimit: coldStartCustomLimit, analysisEvidenceMode }),
                manualOocPause: overlay.querySelector("#soocpause")?.checked === true,
                entityBlocklist: normalizeEntityBlocklistCollection(_CFG.entityBlocklist || MemoryEngine.CONFIG.entityBlocklist || []),
                storyAuthorEnabled: storyAuthorMode !== 'disabled',
                storyAuthorMode: storyAuthorMode === 'disabled' ? 'disabled' : storyAuthorMode,
                directorEnabled: directorMode !== 'disabled',
                directorMode: directorMode === 'disabled' ? 'disabled' : directorMode,
                internalDataLanguageMode: normalizeInternalDataLanguageMode(overlay.querySelector("#sidlang")?.value || _CFG.internalDataLanguageMode || MemoryEngine.CONFIG.internalDataLanguageMode || 'off'),
                internalDataLanguageDebug: _CFG.internalDataLanguageDebug === true || MemoryEngine.CONFIG.internalDataLanguageDebug === true,
                flexRoutingMode: FlexTierPolicy.normalizeRoutingMode(overlay.querySelector("#sfrm")?.value || 'off'),
                flexTimeoutMs: FlexTierPolicy.normalizeTimeout(parseInt(overlay.querySelector("#sfto")?.value || 600000, 10) || 600000),
                flexFallbackToStandard: overlay.querySelector("#sffb")?.checked === true,
                vertexFlexMode: FlexTierPolicy.normalizeVertexFlexMode(overlay.querySelector("#svfm")?.value || 'provisioned_then_flex'),
                customServiceTierPassthrough: overlay.querySelector("#scstp")?.checked === true,
                backendHosting: normalizeBackendHostingConfig({
                    mode: overlay.querySelector("#sbhm")?.value || _CFG.backendHosting?.mode || 'off',
                    url: overlay.querySelector("#sbhu")?.value || '',
                    token: overlay.querySelector("#sbht")?.value || '',
                    autoDetected: _CFG.backendHosting?.autoDetected === true
                        && normalizeBackendHostingUrl(_CFG.backendHosting?.url || '') === normalizeBackendHostingUrl(overlay.querySelector("#sbhu")?.value || '')
                        && String(_CFG.backendHosting?.token || '').trim() === String(overlay.querySelector("#sbht")?.value || '').trim(),
                    lastDetectedAt: _CFG.backendHosting?.lastDetectedAt || '',
                    lastManifest: _CFG.backendHosting?.lastManifest || null
                }),
                hypaV3AutoReflectEnabled: overlay.querySelector("#ssrchypa")?.checked === true,
                moduleLorebookReflectionEnabled: overlay.querySelector("#ssrcmodule")?.checked === true,
                moduleLorebookSelectedIds: readSourceModuleSelectedIdsString(),
                llm: normalizeLLMRuntimeProviderFromUI({
                    provider: overlay.querySelector("#slp").value,
                    url: overlay.querySelector("#slu").value,
                    key: overlay.querySelector("#slk").value,
                    model: overlay.querySelector("#slm").value,
                    temp: parseFloat(overlay.querySelector("#slt").value) || 0.3,
                    timeout: parseInt(overlay.querySelector("#slto").value) || 120000,
                    serviceTier: FlexTierPolicy.normalizeServiceTier(overlay.querySelector("#slst")?.value || 'off'),
                    stream: overlay.querySelector("#slstream")?.checked === true,
                    reasoningPreset: overlay.querySelector("#slrp").value || "auto",
                    reasoningEffort: overlay.querySelector("#slre").value || "none",
                    reasoningBudgetTokens: parseInt(overlay.querySelector("#slrb").value) || DEFAULT_REASONING_BUDGET_TOKENS,
                    maxCompletionTokens: parseInt(overlay.querySelector("#slmc").value) || DEFAULT_MAX_COMPLETION_TOKENS,
                    glmThinkingType: overlay.querySelector("#slgt").value || "enabled"
                }),
                auxLlm: normalizeLLMRuntimeProviderFromUI({
                    enabled: overlay.querySelector("#sax").checked,
                    provider: overlay.querySelector("#saxp").value,
                    url: overlay.querySelector("#saxu").value,
                    key: overlay.querySelector("#saxk").value,
                    model: overlay.querySelector("#saxm").value,
                    temp: parseFloat(overlay.querySelector("#saxt").value) || 0.2,
                    timeout: parseInt(overlay.querySelector("#saxto").value) || 90000,
                    serviceTier: FlexTierPolicy.normalizeServiceTier(overlay.querySelector("#saxst")?.value || 'off'),
                    stream: overlay.querySelector("#saxstream")?.checked === true,
                    reasoningPreset: overlay.querySelector("#saxrp").value || "auto",
                    reasoningEffort: overlay.querySelector("#saxre").value || "none",
                    reasoningBudgetTokens: parseInt(overlay.querySelector("#saxrb").value) || DEFAULT_REASONING_BUDGET_TOKENS,
                    maxCompletionTokens: parseInt(overlay.querySelector("#saxmc").value) || DEFAULT_AUX_MAX_COMPLETION_TOKENS,
                    glmThinkingType: overlay.querySelector("#saxgt").value || "enabled"
                }),
                embed: {
                    provider: overlay.querySelector("#sep").value,
                    url: overlay.querySelector("#seu").value,
                    key: overlay.querySelector("#sek").value,
                    model: overlay.querySelector("#sem").value,
                    timeout: parseInt(overlay.querySelector("#seto").value) || 120000
                }
            };
        };
        const getLLMProviderTestElements = (profile = 'primary') => {
            const isAux = String(profile || 'primary').toLowerCase() === 'aux';
            return {
                button: overlay.querySelector(isAux ? '#btn-test-aux-llm' : '#btn-test-main-llm'),
                status: overlay.querySelector(isAux ? '#aux-llm-test-status' : '#llm-test-status')
            };
        };
        const setLLMProviderTestStatus = (profile = 'primary', message = '', state = 'idle') => {
            const { status } = getLLMProviderTestElements(profile);
            if (!status) return;
            status.textContent = message || '테스트 대기 중';
            status.classList.remove('is-running', 'is-ok', 'is-failed');
            if (state === 'running') status.classList.add('is-running');
            else if (state === 'ok') status.classList.add('is-ok');
            else if (state === 'failed') status.classList.add('is-failed');
        };
        const getHostingBridgeElements = () => ({
            mode: overlay.querySelector('#sbhm'),
            url: overlay.querySelector('#sbhu'),
            token: overlay.querySelector('#sbht'),
            detectButton: overlay.querySelector('#btn-detect-hosting-bridge'),
            testButton: overlay.querySelector('#btn-test-hosting-bridge'),
            status: overlay.querySelector('#hosting-bridge-status')
        });
        const setHostingBridgeStatus = (message = '', state = 'idle') => {
            const { status } = getHostingBridgeElements();
            if (!status) return;
            status.textContent = message || '브릿지 대기 중';
            status.classList.remove('is-running', 'is-ok', 'is-failed');
            if (state === 'running') status.classList.add('is-running');
            else if (state === 'ok') status.classList.add('is-ok');
            else if (state === 'failed') status.classList.add('is-failed');
        };
        const setHostingBridgeButtonsDisabled = (disabled = false) => {
            const { detectButton, testButton } = getHostingBridgeElements();
            if (detectButton) detectButton.disabled = !!disabled;
            if (testButton) testButton.disabled = !!disabled;
        };
        const readHostingBridgeConfigFromUI = () => {
            const { mode, url, token } = getHostingBridgeElements();
            return normalizeBackendHostingConfig({
                ...(_CFG.backendHosting || {}),
                mode: mode?.value || 'off',
                url: url?.value || '',
                token: token?.value || ''
            });
        };
        const writeHostingBridgeConfigToUI = (hostingConfig = {}) => {
            const hosting = normalizeBackendHostingConfig(hostingConfig);
            const { mode, url, token } = getHostingBridgeElements();
            if (mode) mode.value = hosting.mode || 'off';
            if (url) url.value = hosting.url || '';
            if (token) token.value = hosting.token || '';
            _CFG.backendHosting = hosting;
            MemoryEngine.CONFIG.backendHosting = hosting;
            return hosting;
        };
        const hostingBridgeEndpoint = (baseUrl = '', path = '') => `${normalizeBackendHostingUrl(baseUrl)}${path}`;
        const fetchHostingBridge = async (url, init = {}, timeoutMs = 8000) => {
            const requestInit = { ...init };
            delete requestInit.cache;
            delete requestInit.signal;
            return await RisuCompat.request(url, requestInit, { timeoutMs: Math.max(1000, timeoutMs) });
        };
        const readHostingBridgeJson = async (response) => {
            try { return await response.json(); } catch (_) {
                const text = await response.text().catch(() => '');
                return { ok: false, error: text || `HTTP ${response.status}` };
            }
        };
        const detectHostingBridgeFromGUI = async () => {
            setHostingBridgeButtonsDisabled(true);
            setHostingBridgeStatus('로컬 브릿지 감지 중...', 'running');
            try {
                const response = await fetchHostingBridge(LIBRA_HOSTING_BRIDGE_LOCAL_BOOTSTRAP_URL, {
                    method: 'GET',
                    headers: { 'x-libra-bootstrap-probe': '1' }
                }, 7000);
                const data = await readHostingBridgeJson(response);
                if (!response.ok || data?.ok === false) {
                    throw new Error(data?.error || `HTTP ${response.status}`);
                }
                const hosting = normalizeBackendHostingConfig({
                    mode: 'hosted',
                    url: data.backendUrl || data.publicUrl || data.localUrl || '',
                    token: data.backendToken || '',
                    autoDetected: true,
                    lastDetectedAt: new Date().toISOString(),
                    lastManifest: data.manifest || null
                });
                if (!hosting.url || !hosting.token) {
                    throw new Error('bootstrap 응답에 backendUrl 또는 backendToken이 없습니다');
                }
                writeHostingBridgeConfigToUI(hosting);
                setHostingBridgeStatus(`감지 완료 · ${hosting.url}`, 'ok');
                toast('🌉 Hosting Bridge 감지 완료');
            } catch (error) {
                setHostingBridgeStatus(`감지 실패 · ${error?.message || error}`, 'failed');
                toast('❌ Hosting Bridge 감지 실패');
            } finally {
                setHostingBridgeButtonsDisabled(false);
            }
        };
        const testHostingBridgeFromGUI = async () => {
            const hosting = writeHostingBridgeConfigToUI(readHostingBridgeConfigFromUI());
            if (hosting.mode === 'off') {
                setHostingBridgeStatus('브릿지 모드가 Off입니다', 'failed');
                return;
            }
            if (!hosting.url || !hosting.token) {
                setHostingBridgeStatus('Backend URL과 Token이 필요합니다', 'failed');
                return;
            }
            setHostingBridgeButtonsDisabled(true);
            setHostingBridgeStatus('브릿지 연결 테스트 중...', 'running');
            try {
                const manifestResponse = await fetchHostingBridge(hostingBridgeEndpoint(hosting.url, '/__libra_host__/manifest'), { method: 'GET' }, 8000);
                const manifest = await readHostingBridgeJson(manifestResponse);
                if (!manifestResponse.ok || manifest?.schema !== 'libra.hosting_backend.v1') {
                    throw new Error(manifest?.error || `manifest HTTP ${manifestResponse.status}`);
                }
                const tokenResponse = await fetchHostingBridge(hostingBridgeEndpoint(hosting.url, '/__libra_host__/fetch'), {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-libra-backend-token': hosting.token
                    },
                    body: '{}'
                }, 8000);
                const tokenPayload = await readHostingBridgeJson(tokenResponse);
                if (tokenResponse.status === 401) {
                    throw new Error(tokenPayload?.error || 'backend token rejected');
                }
                const updated = normalizeBackendHostingConfig({
                    ...hosting,
                    lastManifest: manifest
                });
                writeHostingBridgeConfigToUI(updated);
                setHostingBridgeStatus(`연결 OK · ${manifest.version || 'unknown'} · ${manifest.tunnel?.ready ? 'tunnel ready' : manifest.tunnel?.mode || 'local'}`, 'ok');
                toast('✅ Hosting Bridge 연결 확인');
            } catch (error) {
                setHostingBridgeStatus(`연결 실패 · ${error?.message || error}`, 'failed');
                toast('❌ Hosting Bridge 연결 실패');
            } finally {
                setHostingBridgeButtonsDisabled(false);
            }
        };
        const formatProviderTestUsage = (usage = {}) => {
            const input = Number(usage.prompt_tokens ?? usage.promptTokenCount ?? usage.input_tokens ?? 0) || 0;
            const output = Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens ?? 0) || 0;
            const total = Number(usage.total_tokens ?? usage.totalTokenCount ?? usage.total_tokens ?? 0) || (input + output);
            if (!input && !output && !total) return '';
            return `tokens ${total || '?'}${input || output ? ` (in ${input || '?'}, out ${output || '?'})` : ''}`;
        };
        const formatProviderTestStream = (stream = {}) => {
            const requested = stream.requested === true ? 'stream 요청' : 'non-stream';
            const used = stream.used === true ? 'stream 사용' : '일반 응답';
            const fallback = stream.meta?.fallbackNonStream ? 'reader 폴백' : '';
            return [requested, used, fallback].filter(Boolean).join(' / ');
        };
        const formatProviderTestResult = (result = {}) => {
            const provider = [result.provider || 'provider', result.model || 'model'].filter(Boolean).join('/');
            const duration = Number.isFinite(Number(result.durationMs)) ? `${Math.max(0, Math.round(Number(result.durationMs)))}ms` : '';
            const stream = formatProviderTestStream(result.stream || {});
            const usage = formatProviderTestUsage(result.usage || {});
            const flex = result.flex?.serviceTier || result.serviceTier ? `tier ${result.flex?.serviceTier || result.serviceTier}` : '';
            const endpoint = result.fallbackEndpoint ? `fallback /api/${result.fallbackEndpoint}` : '';
            const diagnostic = result.diagnostic ? `진단 ${result.diagnostic}` : '';
            const prefix = result.ok ? '성공' : (result.skipped ? '건너뜀' : '실패');
            const detail = result.ok
                ? (result.preview ? `응답 "${result.preview}"` : '테스트 토큰 확인')
                : `오류 ${result.error || 'unknown'}`;
            return [prefix, provider, duration, stream, usage, flex, endpoint, detail, diagnostic].filter(Boolean).join(' · ');
        };
        const runLLMProviderTestFromGUI = async (profile = 'primary') => {
            const isAux = String(profile || 'primary').toLowerCase() === 'aux';
            const label = isAux ? '보조 LLM' : '메인 LLM';
            const allButtons = ['#btn-test-main-llm', '#btn-test-aux-llm']
                .map(selector => overlay.querySelector(selector))
                .filter(Boolean);
            try {
                allButtons.forEach(button => { button.disabled = true; });
                setLLMProviderTestStatus(profile, `${label} 호출 테스트 중...`, 'running');
                toast(`${label} 호출 테스트 중...`, 1800);
                const cfg = buildSettingsConfigFromUI();
                const result = await LLMProviderCallTest.run(cfg, isAux ? 'aux' : 'primary');
                const uiProvider = overlay.querySelector(isAux ? '#saxp' : '#slp')?.value || '';
                if (normalizePresetProviderKey(uiProvider) === NANO_GPT_UI_PROVIDER) result.provider = 'nanogpt';
                setLLMProviderTestStatus(profile, formatProviderTestResult(result), result.ok ? 'ok' : 'failed');
                toast(result.ok ? `${label} 호출 테스트 성공` : `${label} 호출 테스트 실패`, 2600);
                return result;
            } catch (error) {
                const message = error?.message || String(error || 'unknown error');
                setLLMProviderTestStatus(profile, `${label} 호출 테스트 실패 · ${message}`, 'failed');
                toast(`${label} 호출 테스트 실패: ${message}`, 3000);
                return { ok: false, error: message };
            } finally {
                allButtons.forEach(button => { button.disabled = false; });
            }
        };
        const setInternalLanguageMigrationStatus = (message = '', state = 'idle') => {
            const status = overlay.querySelector('#internal-language-migration-status');
            if (!status) return;
            status.textContent = message || '마이그레이션 대기 중';
            status.classList.remove('is-running', 'is-ok', 'is-failed');
            if (state === 'running') status.classList.add('is-running');
            else if (state === 'ok') status.classList.add('is-ok');
            else if (state === 'failed') status.classList.add('is-failed');
        };
        const mergeRuntimeConfigFromSettingsUI = () => {
            const cfg = buildSettingsConfigFromUI();
            _CFG = {
                ..._CFG,
                ...cfg,
                llm: { ...(_CFG.llm || {}), ...(cfg.llm || {}) },
                auxLlm: { ...(_CFG.auxLlm || {}), ...(cfg.auxLlm || {}) },
                embed: { ...(_CFG.embed || {}), ...(cfg.embed || {}) }
            };
            Object.assign(MemoryEngine.CONFIG, _CFG);
            MemoryEngine.CONFIG.llm = { ...(MemoryEngine.CONFIG.llm || {}), ...(_CFG.llm || {}) };
            MemoryEngine.CONFIG.auxLlm = { ...(MemoryEngine.CONFIG.auxLlm || {}), ...(_CFG.auxLlm || {}) };
            MemoryEngine.CONFIG.embed = { ...(MemoryEngine.CONFIG.embed || {}), ...(_CFG.embed || {}) };
            MemoryEngine.CONFIG.backendHosting = normalizeBackendHostingConfig(_CFG.backendHosting || {});
            return _CFG;
        };
        const runInternalLanguageMigrationFromGUI = async () => {
            const button = overlay.querySelector('#btn-migrate-internal-language');
            const mode = normalizeInternalDataLanguageMode(overlay.querySelector('#sidlang')?.value || _CFG.internalDataLanguageMode || 'off');
            if (mode === 'follow_main_response') {
                setInternalLanguageMigrationStatus('기존 데이터 일괄 정규화는 목표 언어가 필요합니다. 한국어 고정 또는 English fixed를 선택하세요.', 'failed');
                toast('❌ 일괄 정규화는 고정 언어를 선택해야 합니다');
                return;
            }
            const targetLanguage = resolveInternalDataLanguageTarget({ ...MemoryEngine.CONFIG, ..._CFG, internalDataLanguageMode: mode });
            if (!targetLanguage) {
                setInternalLanguageMigrationStatus('내부 데이터 작성 언어가 Off입니다. 한국어 또는 English fixed를 선택하세요.', 'failed');
                toast('❌ 내부 데이터 작성 언어가 Off입니다');
                return;
            }
            const ok = await Utils.confirmEx([
                `현재 채팅의 LIBRA 내부 JSON 데이터를 ${targetLanguage}로 정규화합니다.`,
                'raw memory, direct evidence, 원문 인용, ID, 이름, 고유 식별자는 제외합니다.',
                '계속할까요?'
            ].join('\n'));
            if (!ok) {
                setInternalLanguageMigrationStatus('마이그레이션이 취소되었습니다.', 'idle');
                toast('↩️ 내부 데이터 언어 정규화 취소');
                return;
            }
            try {
                if (button) button.disabled = true;
                setInternalLanguageMigrationStatus(`${targetLanguage} 마이그레이션 준비 중...`, 'running');
                const cfg = mergeRuntimeConfigFromSettingsUI();
                const { targetChar, targetChat } = await resolveGuiTargetContext();
                const sourceLore = MemoryEngine.getLorebook(targetChar, targetChat) || lore || [];
                const result = await InternalDataTranslationManager.migrateLorebook(sourceLore, cfg, targetLanguage, {
                    onProgress: (progress = {}) => {
                        const comment = String(progress.entry?.comment || '').replace(/^lmai_/, '');
                        const entryPart = progress.entryCount
                            ? `엔트리 ${progress.entryIndex || 0}/${progress.entryCount}`
                            : comment || '엔트리';
                        const batchPart = progress.batchCount
                            ? `배치 ${progress.batchIndex || 0}/${progress.batchCount}`
                            : '';
                        const itemPart = progress.itemCount
                            ? `문자열 ${progress.translated || 0}/${progress.itemCount}`
                            : '';
                        setInternalLanguageMigrationStatus([`${targetLanguage} 정규화 중`, entryPart, comment, batchPart, itemPart].filter(Boolean).join(' · '), 'running');
                    }
                });
                await saveLoreToChar(result.lorebook);
                lore = MemoryEngine.getLorebook(targetChar, targetChat) || result.lorebook || lore;
                HierarchicalWorldManager.loadWorldGraph(lore, true);
                SecretKnowledgeCore.loadState(lore, {
                    scopeKey: getChatRuntimeScopeKey(targetChat, targetChar),
                    chatId: String(targetChat?.id || getActiveManagedChatId() || '').trim()
                });
                EntityKnowledgeVaultCore.loadState(lore, {
                    scopeKey: getChatRuntimeScopeKey(targetChat, targetChar),
                    chatId: String(targetChat?.id || getActiveManagedChatId() || '').trim()
                });
                TimeEngine.loadState(lore, {
                    scopeKey: getChatRuntimeScopeKey(targetChat, targetChar),
                    chatId: String(targetChat?.id || getActiveManagedChatId() || '').trim()
                });
                syncGuiSnapshotsFromRuntime();
                renderEnts();
                renderNarrative();
                renderWorld();
                filterMems();
                const stats = result.stats || {};
                const message = `완료 · 엔트리 ${stats.entriesChanged || 0}/${stats.entriesScanned || 0}개 변경 · 문자열 ${stats.stringsTranslated || 0}/${stats.stringsScanned || 0}개 처리`;
                setInternalLanguageMigrationStatus(message, 'ok');
                toast(`✅ 내부 데이터 ${targetLanguage} 정규화 완료`, 2600);
                return result;
            } catch (error) {
                const message = error?.message || String(error || 'unknown error');
                setInternalLanguageMigrationStatus(`마이그레이션 실패 · ${message}`, 'failed');
                toast(`❌ 내부 데이터 언어 정규화 실패: ${message}`, 3200);
                recordRuntimeDebug('error', '[LIBRA] Internal data language migration failed:', message);
                return { ok: false, error: message };
            } finally {
                if (button) button.disabled = false;
            }
        };
        const normalizeImportedSettingsConfig = (importedConfig) => {
            const incoming = (importedConfig && typeof importedConfig === 'object' && !Array.isArray(importedConfig)) ? importedConfig : {};
            const merged = {
                ..._CFG,
                ...incoming,
                llm: {
                    ...(_CFG.llm || {}),
                    ...(incoming.llm && typeof incoming.llm === 'object' && !Array.isArray(incoming.llm) ? incoming.llm : {})
                },
                auxLlm: {
                    ...(_CFG.auxLlm || {}),
                    ...(incoming.auxLlm && typeof incoming.auxLlm === 'object' && !Array.isArray(incoming.auxLlm) ? incoming.auxLlm : {})
                },
                embed: {
                    ...(_CFG.embed || {}),
                    ...(incoming.embed && typeof incoming.embed === 'object' && !Array.isArray(incoming.embed) ? incoming.embed : {})
                },
                backendHosting: {
                    ...(_CFG.backendHosting || {}),
                    ...(incoming.backendHosting && typeof incoming.backendHosting === 'object' && !Array.isArray(incoming.backendHosting) ? incoming.backendHosting : {})
                }
            };
            if (merged.storyAuthorMode === undefined) merged.storyAuthorMode = merged.storyAuthorEnabled === true ? 'proactive' : 'disabled';
            merged.storyAuthorMode = ['disabled', 'supportive', 'proactive', 'aggressive'].includes(String(merged.storyAuthorMode || '').toLowerCase())
                ? String(merged.storyAuthorMode).toLowerCase()
                : 'disabled';
            merged.storyAuthorEnabled = merged.storyAuthorEnabled !== false && merged.storyAuthorMode !== 'disabled';
            if (!merged.storyAuthorEnabled) merged.storyAuthorMode = 'disabled';
            if (merged.directorMode === undefined) merged.directorMode = merged.directorEnabled === true ? 'strong' : 'disabled';
            merged.directorMode = ['disabled', 'light', 'standard', 'strong', 'absolute'].includes(String(merged.directorMode || '').toLowerCase())
                ? String(merged.directorMode).toLowerCase()
                : 'disabled';
            merged.directorEnabled = merged.directorEnabled !== false && merged.directorMode !== 'disabled';
            if (!merged.directorEnabled) merged.directorMode = 'disabled';
            merged.bypassAuxRequests = true;
            merged.responseStreamingCompatEnabled = true;
            if (merged.manualOocPause === undefined) merged.manualOocPause = false;
            merged.manualOocPause = merged.manualOocPause === true || /^(1|true|yes|on|enabled)$/i.test(String(merged.manualOocPause || '').trim());
            merged.entityBlocklist = normalizeEntityBlocklistCollection(merged.entityBlocklist || []);
            merged.internalDataLanguageMode = normalizeInternalDataLanguageMode(merged.internalDataLanguageMode || 'off');
            merged.internalDataLanguageDebug = merged.internalDataLanguageDebug === true;
            const coldStartScopePreset = ['all', 'recent100', 'recent200', 'recent500', 'custom'].includes(String(merged.coldStartScopePreset || '').trim())
                ? String(merged.coldStartScopePreset).trim()
                : inferColdStartScopePreset(merged.coldStartHistoryLimit);
            Object.assign(merged, buildOptimizedHiddenSettingsDefaults({
                coldStartScopePreset,
                coldStartHistoryLimit: merged.coldStartHistoryLimit,
                analysisEvidenceMode: merged.analysisEvidenceMode
            }));
            merged.flexRoutingMode = FlexTierPolicy.normalizeRoutingMode(merged.flexRoutingMode || 'off');
            merged.flexTimeoutMs = FlexTierPolicy.normalizeTimeout(merged.flexTimeoutMs || 600000);
            merged.flexFallbackToStandard = merged.flexFallbackToStandard === true;
            merged.vertexFlexMode = FlexTierPolicy.normalizeVertexFlexMode(merged.vertexFlexMode || 'provisioned_then_flex');
            merged.customServiceTierPassthrough = merged.customServiceTierPassthrough === true;
            merged.backendHosting = normalizeBackendHostingConfig(merged.backendHosting || {});
            if (merged.llm) {
                merged.llm = normalizeLLMRuntimeProviderFromUI(merged.llm);
                merged.llm.serviceTier = FlexTierPolicy.normalizeServiceTier(merged.llm.serviceTier || 'off');
                merged.llm.stream = merged.llm.stream === true || /^(1|true|yes|on|enabled)$/i.test(String(merged.llm.stream || '').trim());
            }
            if (merged.auxLlm) {
                merged.auxLlm = normalizeLLMRuntimeProviderFromUI(merged.auxLlm);
                merged.auxLlm.serviceTier = FlexTierPolicy.normalizeServiceTier(merged.auxLlm.serviceTier || 'off');
                merged.auxLlm.stream = merged.auxLlm.stream === true || /^(1|true|yes|on|enabled)$/i.test(String(merged.auxLlm.stream || '').trim());
            }
            return merged;
        };
        const applyImportedSettingsToUI = (importedConfig) => {
            _CFG = normalizeImportedSettingsConfig(importedConfig);
            loadSettings();
            return _CFG;
        };

        const loadSettings = () => {
            const c = _CFG;
            overlay.querySelector("#slp").value = providerValueForSettingsUI(c.llm || {}, "openai");
            overlay.querySelector("#slu").value = (c.llm && c.llm.url) || "";
            overlay.querySelector("#slk").value = (c.llm && c.llm.key) || "";
            overlay.querySelector("#slm").value = (c.llm && c.llm.model) || "gpt-4o-mini";
            const t = overlay.querySelector("#slt"); t.value = (c.llm && c.llm.temp) || 0.3; overlay.querySelector("#sltv").textContent = t.value;
            overlay.querySelector("#slto").value = (c.llm && c.llm.timeout) || 120000;
            if (overlay.querySelector("#slst")) overlay.querySelector("#slst").value = FlexTierPolicy.normalizeServiceTier(c.llm?.serviceTier || 'off');
            if (overlay.querySelector("#slstream")) overlay.querySelector("#slstream").checked = c.llm?.stream === true;
            overlay.querySelector("#slrp").value = (c.llm && c.llm.reasoningPreset) || "auto";
            overlay.querySelector("#slre").value = (c.llm && c.llm.reasoningEffort) || "none";
            overlay.querySelector("#slrb").value = (c.llm && c.llm.reasoningBudgetTokens) || DEFAULT_REASONING_BUDGET_TOKENS;
            overlay.querySelector("#slmc").value = (c.llm && c.llm.maxCompletionTokens) || DEFAULT_MAX_COMPLETION_TOKENS;
            overlay.querySelector("#slgt").value = (c.llm && c.llm.glmThinkingType) || "enabled";
            overlay.querySelector("#sax").checked = !!(c.auxLlm && c.auxLlm.enabled);
            overlay.querySelector("#saxp").value = providerValueForSettingsUI(c.auxLlm || {}, providerValueForSettingsUI(c.llm || {}, "openai"));
            overlay.querySelector("#saxu").value = (c.auxLlm && c.auxLlm.url) || "";
            overlay.querySelector("#saxk").value = (c.auxLlm && c.auxLlm.key) || "";
            overlay.querySelector("#saxm").value = (c.auxLlm && c.auxLlm.model) || (c.llm && c.llm.model) || "gpt-4o-mini";
            const at = overlay.querySelector("#saxt"); at.value = (c.auxLlm && c.auxLlm.temp) || 0.2; overlay.querySelector("#saxtv").textContent = at.value;
            overlay.querySelector("#saxto").value = (c.auxLlm && c.auxLlm.timeout) || 90000;
            if (overlay.querySelector("#saxst")) overlay.querySelector("#saxst").value = FlexTierPolicy.normalizeServiceTier(c.auxLlm?.serviceTier || 'off');
            if (overlay.querySelector("#saxstream")) overlay.querySelector("#saxstream").checked = c.auxLlm?.stream === true;
            overlay.querySelector("#saxrp").value = (c.auxLlm && c.auxLlm.reasoningPreset) || "auto";
            overlay.querySelector("#saxre").value = (c.auxLlm && c.auxLlm.reasoningEffort) || "none";
            overlay.querySelector("#saxrb").value = (c.auxLlm && c.auxLlm.reasoningBudgetTokens) || DEFAULT_REASONING_BUDGET_TOKENS;
            overlay.querySelector("#saxmc").value = (c.auxLlm && c.auxLlm.maxCompletionTokens) || DEFAULT_AUX_MAX_COMPLETION_TOKENS;
            overlay.querySelector("#saxgt").value = (c.auxLlm && c.auxLlm.glmThinkingType) || "enabled";
            if (overlay.querySelector("#sfrm")) overlay.querySelector("#sfrm").value = FlexTierPolicy.normalizeRoutingMode(c.flexRoutingMode || 'off');
            if (overlay.querySelector("#sfto")) overlay.querySelector("#sfto").value = FlexTierPolicy.normalizeTimeout(c.flexTimeoutMs || 600000);
            if (overlay.querySelector("#sffb")) overlay.querySelector("#sffb").checked = c.flexFallbackToStandard === true;
            if (overlay.querySelector("#svfm")) overlay.querySelector("#svfm").value = FlexTierPolicy.normalizeVertexFlexMode(c.vertexFlexMode || 'provisioned_then_flex');
            if (overlay.querySelector("#scstp")) overlay.querySelector("#scstp").checked = c.customServiceTierPassthrough === true;
            const backendHosting = normalizeBackendHostingConfig(c.backendHosting || {});
            if (overlay.querySelector("#sbhm")) overlay.querySelector("#sbhm").value = backendHosting.mode || 'off';
            if (overlay.querySelector("#sbhu")) overlay.querySelector("#sbhu").value = backendHosting.url || '';
            if (overlay.querySelector("#sbht")) overlay.querySelector("#sbht").value = backendHosting.token || '';
            if (overlay.querySelector("#hosting-bridge-status")) {
                const bridgeReady = backendHosting.mode !== 'off' && backendHosting.url && backendHosting.token;
                setHostingBridgeStatus(
                    bridgeReady
                        ? `브릿지 설정됨 · ${backendHosting.autoDetected ? '자동 감지' : '수동 입력'}${backendHosting.lastDetectedAt ? ` · ${backendHosting.lastDetectedAt}` : ''}`
                        : '브릿지 대기 중',
                    bridgeReady ? 'ok' : 'idle'
                );
            }
            syncReasoningPresetUi('sl');
            syncReasoningPresetUi('sax');
            if (overlay.querySelector("#soocpause")) overlay.querySelector("#soocpause").checked = c.manualOocPause === true;
            const loadedStoryAuthorMode = ['disabled', 'supportive', 'proactive', 'aggressive'].includes(String(c.storyAuthorMode || '').toLowerCase())
                ? String(c.storyAuthorMode).toLowerCase()
                : 'disabled';
            const loadedDirectorMode = ['disabled', 'light', 'standard', 'strong', 'absolute'].includes(String(c.directorMode || '').toLowerCase())
                ? String(c.directorMode).toLowerCase()
                : 'disabled';
            if (overlay.querySelector("#ssam")) overlay.querySelector("#ssam").value = c.storyAuthorEnabled === false ? 'disabled' : loadedStoryAuthorMode;
            if (overlay.querySelector("#sdm")) overlay.querySelector("#sdm").value = c.directorEnabled === false ? 'disabled' : loadedDirectorMode;
            if (overlay.querySelector("#sidlang")) overlay.querySelector("#sidlang").value = normalizeInternalDataLanguageMode(c.internalDataLanguageMode || 'off');
            if (overlay.querySelector("#ssrchypa")) overlay.querySelector("#ssrchypa").checked = c.hypaV3AutoReflectEnabled === true;
            if (overlay.querySelector("#ssrcmodule")) overlay.querySelector("#ssrcmodule").checked = c.moduleLorebookReflectionEnabled === true;
            writeSourceModuleSelectedIds(c.moduleLorebookSelectedIds || '', { render: false });
            renderSourceModuleSelector();
            syncSourceModuleReflectionUi();
            overlay.querySelector("#sep").value = (c.embed && c.embed.provider) || "openai";
            overlay.querySelector("#seu").value = (c.embed && c.embed.url) || "";
            overlay.querySelector("#sek").value = (c.embed && c.embed.key) || "";
            overlay.querySelector("#sem").value = (c.embed && c.embed.model) || "text-embedding-3-small";
            overlay.querySelector("#seto").value = (c.embed && c.embed.timeout) || 120000;
            syncProviderModelDatalist('llm');
            syncProviderModelDatalist('aux');
            syncProviderModelDatalist('embedding');
            syncVertexCredentialPanels();
            applyColdStartScopePresetToUI(c.coldStartScopePreset || inferColdStartScopePreset(c.coldStartHistoryLimit), c.coldStartHistoryLimit);
            if (overlay.querySelector("#saem")) overlay.querySelector("#saem").value = normalizeAnalysisEvidenceMode(c.analysisEvidenceMode || 'assistant_only');

            const cacheStats = MemoryEngine.getCacheStats();
            overlay.querySelector("#cst").innerHTML = `
                <div class="ci">메모리: ${_MEM.length}</div>
                <div class="ci">인물: ${_ENT.length}</div>
                <div class="ci">관계: ${_REL.length}</div>
                <div class="ci">메타캐시 히트율: ${(parseFloat(cacheStats?.meta?.hitRate) * 100 || 0).toFixed(1)}%</div>
                <div class="ci">유사도캐시: ${cacheStats?.sim?.size ?? 0}</div>
            `;
        };

        const closeGuiOverlay = () => {
            try {
                const activeEl = document.activeElement;
                if (activeEl instanceof HTMLElement && overlay.contains(activeEl)) {
                    activeEl.blur();
                }
            } catch {}
            overlay.style.pointerEvents = 'none';
            overlay.style.display = 'none';
            overlay.remove();
            try { R.hideContainer(); } catch {}
        };
        // 3. 자바스크립트로 직접 이벤트 연결 (Event Delegation)
        overlay.querySelector('#xbtn').onclick = () => {
            closeGuiOverlay();
        };
        overlay.addEventListener('input', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            if (target.matches('.rC-val, .rR-val')) {
                target.dataset.unset = '0';
                return;
            }
        });
        overlay.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            if (target.matches('.source-module-check')) {
                updateSourceModuleSelectedIdsFromChecks();
                return;
            }
            if (target.matches('#ssrcmodule')) {
                syncSourceModuleReflectionUi();
                return;
            }
            if (target.matches('#ar-score-enabled')) {
                syncAddRelationScoreControls();
                return;
            }
        });
        overlay.querySelectorAll('.tb').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
        
        // 상단 툴바 및 폼 액션
        overlay.querySelector('#btn-toggle-add-mem').onclick = () => overlay.querySelector('#amf').classList.toggle('on');
        overlay.querySelector('#btn-cancel-mem').onclick = () => overlay.querySelector('#amf').classList.remove('on');
        overlay.querySelector('#btn-toggle-add-ent').onclick = () => {
            overlay.querySelector('#aef').classList.toggle('on');
        };
        overlay.querySelector('#btn-cancel-ent').onclick = () => {
            overlay.querySelector('#aef').classList.remove('on');
        };
        const syncAddRelationScoreControls = () => {
            const enabled = overlay.querySelector('#ar-score-enabled')?.checked === true;
            const cls = overlay.querySelector('#ar-cls');
            const trs = overlay.querySelector('#ar-trs');
            const clsv = overlay.querySelector('#ar-clsv');
            const trsv = overlay.querySelector('#ar-trsv');
            if (cls) cls.disabled = !enabled;
            if (trs) trs.disabled = !enabled;
            if (clsv) clsv.textContent = enabled ? String(cls?.value || '0') : '미정';
            if (trsv) trsv.textContent = enabled ? String(trs?.value || '0') : '미정';
        };
        overlay.querySelector('#btn-toggle-add-rel').onclick = () => {
            overlay.querySelector('#arf').classList.toggle('on');
            syncAddRelationScoreControls();
        };
        overlay.querySelector('#btn-cancel-rel').onclick = () => {
            overlay.querySelector('#arf').classList.remove('on');
            syncAddRelationScoreControls();
        };

        overlay.querySelector('#ms').oninput = filterMems;
        overlay.querySelector('#mf').onchange = filterMems;
        ['#slp', '#slu', '#slm'].forEach(id => {
            overlay.querySelector(id).addEventListener('change', () => {
                if (id === '#slp') applyProviderPresetToSlot('llm', { force: true });
                syncReasoningPresetUi('sl');
                syncVertexCredentialPanels();
            });
            overlay.querySelector(id).addEventListener('input', () => {
                syncProviderModelDatalist('llm');
                syncReasoningPresetUi('sl');
                syncVertexCredentialPanels();
            });
        });
        ['#saxp', '#saxu', '#saxm'].forEach(id => {
            overlay.querySelector(id).addEventListener('change', () => {
                if (id === '#saxp') applyProviderPresetToSlot('aux', { force: true });
                syncReasoningPresetUi('sax');
                syncVertexCredentialPanels();
            });
            overlay.querySelector(id).addEventListener('input', () => {
                syncProviderModelDatalist('aux');
                syncReasoningPresetUi('sax');
                syncVertexCredentialPanels();
            });
        });
        ['#sep', '#seu', '#sem', '#slk', '#saxk', '#sek'].forEach(id => {
            const node = overlay.querySelector(id);
            if (!node) return;
            node.addEventListener('change', () => {
                if (id === '#sep') applyProviderPresetToSlot('embedding', { force: true });
                syncVertexCredentialPanels();
            });
            node.addEventListener('input', () => {
                if (id === '#sep' || id === '#seu' || id === '#sem') syncProviderModelDatalist('embedding');
                syncVertexCredentialPanels();
            });
        });
        overlay.querySelectorAll('[data-vertex-json-file]').forEach(input => {
            input.addEventListener('change', async (event) => {
                const file = event?.target?.files?.[0];
                const slot = event?.target?.dataset?.vertexJsonFile || 'llm';
                if (file) await loadVertexServiceAccountFile(slot, file);
                event.target.value = '';
            });
        });
        overlay.querySelectorAll('[data-vertex-json-apply]').forEach(button => {
            button.addEventListener('click', async () => {
                const slot = button.dataset.vertexJsonApply || 'llm';
                const raw = overlay.querySelector(`[data-vertex-json-paste="${slot}"]`)?.value || '';
                await loadVertexServiceAccountText(slot, raw);
            });
        });
        overlay.querySelector('#slrp').onchange = () => syncReasoningPresetUi('sl', { applyPresetValues: true });
        overlay.querySelector('#saxrp').onchange = () => syncReasoningPresetUi('sax', { applyPresetValues: true });
        overlay.querySelector('#btn-test-main-llm')?.addEventListener('click', () => {
            void runLLMProviderTestFromGUI('primary');
        });
        overlay.querySelector('#btn-test-aux-llm')?.addEventListener('click', () => {
            void runLLMProviderTestFromGUI('aux');
        });
        overlay.querySelector('#btn-detect-hosting-bridge')?.addEventListener('click', () => {
            void detectHostingBridgeFromGUI();
        });
        overlay.querySelector('#btn-test-hosting-bridge')?.addEventListener('click', () => {
            void testHostingBridgeFromGUI();
        });
        overlay.querySelector('#btn-migrate-internal-language')?.addEventListener('click', () => {
            void runInternalLanguageMigrationFromGUI();
        });
        overlay.querySelector('#btn-import-hypa-v3').onclick = importHypaV3ToLorebook;
        overlay.querySelector('#btn-refresh-source-modules')?.addEventListener('click', async () => {
            await refreshSourceModuleSelector({ quiet: false });
            toast('🔄 모듈 목록을 새로고침했습니다');
        });
        overlay.querySelector('#btn-fill-active-modules')?.addEventListener('click', async () => {
            try {
                const dbNow = await refreshSourceModuleSelector({ quiet: true });
                const activeIds = new Set(SourceReflectionManager.getSelectedActiveModuleIds(dbNow, chat, char));
                const selected = getSourceModuleRows()
                    .filter(row => row.selectable && row.keys.some(key => activeIds.has(key)))
                    .map(row => row.key);
                writeSourceModuleSelectedIds(selected);
                toast(selected.length ? `✅ 활성 모듈 ${selected.length}개를 선택했습니다` : 'ℹ️ 활성 모듈 중 읽을 수 있는 로어북을 찾지 못했습니다');
            } catch (e) {
                toast(`❌ 활성 모듈 확인 실패: ${e?.message || e}`);
            }
        });
        overlay.querySelector('#btn-clear-source-modules')?.addEventListener('click', () => {
            writeSourceModuleSelectedIds([]);
            toast('🧹 모듈 로어북 선택을 비웠습니다');
        });
        overlay.querySelector('#btn-add-user-lorebook').onclick = async () => {
            try {
                await addManualUserLorebook();
            } catch (e) {
                toast(`❌ 수동 로어북 반영 실패: ${e?.message || e}`);
            }
        };
        overlay.querySelector('#btn-export-settings-file').onclick = () => {
            try {
                const cfg = buildSettingsConfigFromUI();
                const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                link.href = url;
                link.download = `libra-settings-${stamp}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                toast("📤 설정 파일 내보내기 완료");
            } catch (e) {
                toast(`❌ 설정 파일 내보내기 실패: ${e?.message || e}`);
            }
        };
        overlay.querySelector('#btn-export-debug-file').onclick = async () => {
            try {
                const { targetChar: exportChar, targetChat: exportChat, targetCtx: ctx } = await resolveGuiTargetContext();
                const exportScopeKey = ctx?.scopeKey || getChatRuntimeScopeKey(exportChat, exportChar);
                const exportLore = MemoryEngine.getLorebook(exportChar, exportChat) || lore || [];
                const payload = await DebugExportManager.buildExportPayloadAsync(exportLore, {
                    chatId: String(exportChat?.id || '').trim(),
                    scopeKey: exportScopeKey
                });
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                link.href = url;
                link.download = `libra-v5-runtime-debug-${stamp}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                toast("🧪 런타임 디버그 내보내기 완료");
            } catch (e) {
                toast(`❌ 디버그 내보내기 실패: ${e?.message || e}`);
            }
        };
        overlay.querySelector('#btn-import-settings-file').onclick = () => {
            const input = overlay.querySelector('#settings-file-input');
            if (!input) {
                toast("❌ 파일 입력을 찾을 수 없습니다");
                return;
            }
            input.value = '';
            input.click();
        };
        overlay.querySelector('#settings-file-input').onchange = async (e) => {
            const file = e?.target?.files?.[0];
            if (!file) return;
            try {
                const raw = await file.text();
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('invalid settings object');
                }
                const mergedConfig = normalizeImportedSettingsConfig(parsed);
                await writeCommonPluginSettings(JSON.stringify(mergedConfig));
                applyImportedSettingsToUI(mergedConfig);
                Object.assign(MemoryEngine.CONFIG, mergedConfig);
                MemoryEngine.CONFIG.llm = { ...(MemoryEngine.CONFIG.llm || {}), ...(mergedConfig.llm || {}) };
                MemoryEngine.CONFIG.auxLlm = { ...(MemoryEngine.CONFIG.auxLlm || {}), ...(mergedConfig.auxLlm || {}) };
                MemoryEngine.CONFIG.embed = { ...(MemoryEngine.CONFIG.embed || {}), ...(mergedConfig.embed || {}) };
                syncManualOocPauseConfig(MemoryEngine.CONFIG, { reason: 'settings-import' });
                applyGuiEntityBlocklistToLocalSnapshots();
                renderEnts();
                toast(`📥 설정 파일 가져오기 완료: ${file.name}`);
            } catch (err) {
                toast(`❌ 설정 파일 가져오기 실패: ${err?.message || err}`);
            }
        };

        overlay.querySelector('#soocpause')?.addEventListener('change', async (e) => {
            const enabled = e?.target?.checked === true;
            _CFG.manualOocPause = enabled;
            MemoryEngine.CONFIG.manualOocPause = enabled;
            syncManualOocPauseConfig(MemoryEngine.CONFIG, { reason: 'gui-toggle' });
            try {
                await writeCommonPluginSettings(JSON.stringify(_CFG));
                toast(enabled ? "⏸ LIBRA 수동 OOC 정지 모드 켜짐" : "▶ LIBRA 수동 OOC 정지 모드 꺼짐");
            } catch (err) {
                toast(`❌ OOC 정지 모드 저장 실패: ${err?.message || err}`);
            }
        });

        // 슬라이더 값 실시간 반영
        overlay.querySelector('#scsp')?.addEventListener('change', () => {
            const preset = overlay.querySelector('#scsp')?.value || 'all';
            const limitInput = overlay.querySelector('#schl');
            if (preset === 'recent100' && limitInput) limitInput.value = 100;
            else if (preset === 'recent200' && limitInput) limitInput.value = 200;
            else if (preset === 'recent500' && limitInput) limitInput.value = 500;
            else if (preset === 'all' && limitInput) limitInput.value = '';
            applyColdStartScopePresetToUI(preset, Number(limitInput?.value || 0));
        });

        const bindSlider = (id, targetId) => overlay.querySelector(id).oninput = (e) => overlay.querySelector(targetId).textContent = e.target.value;
        bindSlider('#slt', '#sltv');
        bindSlider('#saxt', '#saxtv');
        bindSlider('#ar-cls', '#ar-clsv');
        bindSlider('#ar-trs', '#ar-trsv');
        syncAddRelationScoreControls();

        // 메모리 액션
        overlay.querySelector('#btn-add-mem').onclick = () => {
            const c = Utils.getMemorySourceText(overlay.querySelector("#am-c").value);
            if (!c) { toast("❌ 내용을 입력하세요"); return; }
            const imp = parseInt(overlay.querySelector("#am-i").value) || 5;
            const cat = overlay.querySelector("#am-cat").value.trim() || "";
            const anchorTurn = Math.max(
                1,
                normalizeLegacyMemoryTurnAnchor(MemoryEngine.getCurrentTurn?.() || 0),
                deriveRuntimeTurnFromLorebook(lore),
                TurnRecordLedger.deriveMaxTurn(lore, chat, char)
            );
            const sourceHash = TokenizerEngine.simpleHash(c);
            const userTurnKey = `manual:${sourceHash}`;
            const turnKey = buildCanonicalTurnKey(chat?.id || '', userTurnKey, sourceHash, '', []);
            const meta = {
                imp: Math.max(1, Math.min(10, imp)),
                t: anchorTurn,
                ttl: -1,
                cat: cat,
                ent: [],
                summary: '',
                source: 'manual_memory',
                sourceHint: 'User-created LIBRA memory entry.',
                s_id: MemoryState.currentSessionId,
                sourceMessageIds: [],
                liveMessageIds: [],
                sourceHash,
                aiHash: sourceHash,
                userTurnKey,
                turnKey,
                messageSignature: '',
                messageCount: getChatMessages(chat).length,
                firstTurn: anchorTurn,
                originalTurn: anchorTurn,
                lockedTurn: anchorTurn,
                finalizedTurn: anchorTurn,
                turnAnchorTurn: anchorTurn,
                turnAnchor: anchorTurn,
                turnLocked: true,
                turnAnchorReason: 'manual-memory-entry',
                chatId: String(chat?.id || '').trim(),
                recallHints: StrengthenedJaccardCore.buildRecallHints(c, { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 })
            };
            _MEM.push({ key: "", comment: "lmai_memory", content: `[META:${JSON.stringify(meta)}]\n${c}`, mode: "normal", insertorder: 100, alwaysActive: false });
            overlay.querySelector("#am-c").value = "";
            overlay.querySelector('#amf').classList.remove('on');
            filterMems(); toast("✅ 메모리 추가됨");
        };

        overlay.querySelector('#btn-save-all-mem').onclick = async () => {
            try {
                let newLore = [];
                _ENT.forEach(e => newLore.push(e));
                _REL.forEach(r => newLore.push(r));
                _MEM.forEach(m => newLore.push({ key: m.key || "", comment: "lmai_memory", content: m.content, mode: "normal", insertorder: 100, alwaysActive: false }));
                await saveLoreToChar(buildFullManagedLoreSnapshot(newLore), () => toast("💾 메모리 저장됨"));
            } catch (e) {
                toast(`❌ 메모리 저장 실패: ${e?.message || e}`);
            }
        };

        // 엔티티 및 관계 액션
        overlay.querySelector('#btn-add-ent').onclick = () => {
            const name = overlay.querySelector("#ae-name").value.trim();
            if (!name) { toast("❌ 이름을 입력하세요"); return; }
            const normalizedName = EntityManager.normalizeName(name);
            const roleInStory = (overlay.querySelector("#ae-role")?.value || '').trim();
            const features = parseGuiCsv(overlay.querySelector("#ae-feat")?.value || '');
            const traits = parseGuiCsv(overlay.querySelector("#ae-trait")?.value || '');
            const backgroundSummary = (overlay.querySelector("#ae-bg")?.value || '').trim();
            const currentSummary = (overlay.querySelector("#ae-current-state")?.value || '').trim();
            const speechNotes = parseGuiCsv(overlay.querySelector("#ae-speech-notes")?.value || '');
            const psychology = (overlay.querySelector("#ae-psychology")?.value || '').trim();
            const openThreads = parseGuiOpenThreadLabels(overlay.querySelector("#ae-open-threads")?.value || '');
            let d = {
                id: TokenizerEngine.simpleHash(normalizedName),
                name: normalizedName,
                type: 'character',
                sex: '',
                appearance: {
                    features,
                    distinctiveMarks: [],
                    clothing: []
                },
                personality: {
                    traits,
                    values: [],
                    fears: [],
                    likes: [],
                    dislikes: [],
                    sexualOrientation: '',
                    sexualPreferences: []
                },
                background: {
                    origin: backgroundSummary,
                    occupation: '',
                    history: backgroundSummary ? [backgroundSummary] : [],
                    secrets: []
                },
                speechStyle: {
                    defaultTone: '',
                    honorificStyle: '',
                    toSuperiors: '',
                    toSubordinates: '',
                    toPeers: '',
                    toYounger: '',
                    notes: speechNotes
                },
                status: {
                    currentLocation: '',
                    currentMood: '',
                    healthStatus: '',
                    lastUpdated: MemoryState.currentTurn
                },
                identity: { age: '', sex: '', occupation: '', affiliation: '', roleInStory, summary: backgroundSummary, aliases: [], honorifics: [], source: null },
                profile: {
                    appearance: { features, distinctiveMarks: [], clothing: [], confidence: features.length ? 0.7 : 0 },
                    personality: { traits, values: [], fears: [], likes: [], dislikes: [], vulnerabilities: [], boundaries: [], workStyle: '', socialStyle: '', confidence: traits.length ? 0.7 : 0 },
                    speechStyle: { defaultTone: '', honorificStyle: '', pressureMarkers: [], intimacyShift: '', catchphrases: [], notes: speechNotes },
                    psychology: { baseline: psychology, currentConflict: '', copingStyle: '', notes: [], confidence: psychology ? 0.7 : 0 }
                },
                currentState: { summary: currentSummary, sceneTime: '', location: '', physicalState: [], emotionalState: [], cognitiveFocus: [], immediateGoal: '', activeProblems: [], lastObservedTurn: MemoryState.currentTurn },
                continuity: { openThreads, unresolvedNeeds: [], commitments: [], nextActionHints: [] },
                povKnowledge: { knownToSelf: [], unknownToSelf: [], knownToOthers: [], visibleTo: [], privateExperiences: [], privacy: '' },
                episodeLedger: [],
                stateTimeline: [],
                evidence: [],
                quality: { confidence: 0.7, salience: 0, importance: 0, pressure: 0, lastUpdatedTurn: MemoryState.currentTurn, sourceMix: ['gui'], staleness: '', needsReview: false },
                meta: { created: MemoryState.currentTurn, updated: MemoryState.currentTurn, confidence: 0.7, source: 'gui', manualLocked: true, manualLockedAt: Date.now() }
            };
            if (typeof EntityManager?.normalizeEntityRecord === 'function') d = EntityManager.normalizeEntityRecord(d);
            _ENT.push({ key: LibraLoreKeys.entityFromName(normalizedName), comment: "lmai_entity", content: JSON.stringify(d), mode: "normal", insertorder: 50, alwaysActive: false });
            overlay.querySelector("#ae-name").value = ""; overlay.querySelector("#ae-role").value = ""; overlay.querySelector("#ae-feat").value = ""; overlay.querySelector("#ae-trait").value = ""; overlay.querySelector("#ae-bg").value = ""; overlay.querySelector("#ae-current-state").value = ""; overlay.querySelector("#ae-speech-notes").value = ""; overlay.querySelector("#ae-psychology").value = ""; overlay.querySelector("#ae-open-threads").value = "";
            overlay.querySelector('#aef').classList.remove('on');
            renderEnts(); toast("✅ 인물 추가됨");
        };

        overlay.querySelector('#btn-add-rel').onclick = () => {
            const a = overlay.querySelector("#ar-a").value.trim();
            const b = overlay.querySelector("#ar-b").value.trim();
            if (!a || !b) { toast("❌ 인물을 입력하세요"); return; }
            const entityA = EntityManager.normalizeName(a);
            const entityB = EntityManager.normalizeName(b);
            const sortedPair = [entityA, entityB].sort();
            const scoreEnabled = overlay.querySelector('#ar-score-enabled')?.checked === true;
            const closeness = scoreEnabled ? (parseInt(overlay.querySelector("#ar-cls").value) || 0) / 100 : null;
            const trust = scoreEnabled ? (parseInt(overlay.querySelector("#ar-trs").value) || 0) / 100 : null;
            const d = {
                id: `${sortedPair[0]}_${sortedPair[1]}`,
                entityA,
                entityB,
                relationType: overlay.querySelector("#ar-type").value.trim() || "첫 대면",
                details: {
                    howMet: '',
                    duration: '',
                    closeness,
                    trust,
                    events: []
                },
                sentiments: {
                    fromAtoB: overlay.querySelector("#ar-sent").value.trim(),
                    fromBtoA: '',
                    currentTension: 0,
                    lastInteraction: MemoryState.currentTurn
                },
                currentStatus: { summary: '', publicLayer: '', privateLayer: '', boundaryState: '', lastChangedTurn: 0 },
                metrics: { closeness, trust, tension: 0, risk: 0, ambiguity: scoreEnabled ? 0 : 0.65, pressure: 0 },
                dynamics: { fromAtoB: [], fromBtoA: [], unresolvedIssues: [], recentChanges: [] },
                sharedContext: { location: '', workplace: '', privateThreads: [], notes: [] },
                eventLedger: [],
                evidence: [],
                quality: { confidence: scoreEnabled ? 0.7 : 0.3, salience: 0, importance: 0, pressure: 0, lastUpdatedTurn: MemoryState.currentTurn, sourceMix: ['gui'], staleness: '', needsReview: !scoreEnabled },
                relationshipAssessment: {
                    stage: scoreEnabled ? 'defined_manual' : 'first_contact',
                    definitionConfidence: scoreEnabled ? 0.7 : 0.08,
                    evidenceCount: 0,
                    label: scoreEnabled ? '수동 정의됨' : '첫 대면 · 정의 보류',
                    note: scoreEnabled ? '사용자가 직접 관계 수치를 지정함' : '관계를 정의하기에는 근거가 부족함',
                    inferred: !scoreEnabled
                },
                meta: { created: MemoryState.currentTurn, updated: MemoryState.currentTurn, confidence: 0.6, source: 'gui', manualLocked: true, manualLockedAt: Date.now() }
            };
            _REL.push({ key: LibraLoreKeys.relationFromNames(entityA, entityB), comment: "lmai_relation", content: JSON.stringify(d), mode: "normal", insertorder: 51, alwaysActive: false });
            overlay.querySelector("#ar-a").value = ""; overlay.querySelector("#ar-b").value = ""; overlay.querySelector("#ar-type").value = ""; overlay.querySelector("#ar-sent").value = "";
            overlay.querySelector("#ar-score-enabled").checked = false;
            syncAddRelationScoreControls();
            overlay.querySelector('#arf').classList.remove('on');
            renderEnts(); toast("✅ 관계 추가됨");
        };
        overlay.querySelector('#btn-add-entity-block').onclick = async () => {
            try {
                const input = overlay.querySelector("#entity-block-input");
                const blockedName = await blockEntityFromGui(input?.value || '', { removeStoredData: true });
                if (input) input.value = '';
                toast(`⛔ ${blockedName} 차단됨`);
            } catch (e) {
                toast(`❌ 엔티티 차단 실패: ${e?.message || e}`);
            }
        };

        overlay.querySelector('#btn-save-ents').onclick = async () => {
            try {
                applyGuiEntityBlocklistToLocalSnapshots();
                let newLore = [];
                _ENT.forEach(e => newLore.push(e));
                _REL.forEach(r => newLore.push(r));
                _MEM.forEach(m => newLore.push(m));
                await saveLoreToChar(buildFullManagedLoreSnapshot(newLore), () => toast("💾 저장됨"));
            } catch (e) {
                toast(`❌ 저장 실패: ${e?.message || e}`);
            }
        };
        const runUnifiedHistoricalReanalysisFromGui = async (label = '통합 재분석') => {
            if (!confirm(`${label}은(는) 메모리/엔티티/내러티브/세계관을 한 번에 재분석하는 정본 재구축으로 실행됩니다. 계속할까요?`)) {
                return false;
            }
            toast(`♻️ ${label} 시작`);
            await ColdStartManager.reanalyzeHistoricalConversation();
            lore = MemoryEngine.getLorebook(char, chat) || lore;
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            renderNarrative();
            renderWorld();
            filterMems();
            toast(`✅ ${label} 완료`);
            return true;
        };
        overlay.querySelector('#btn-save-world-correction').onclick = async () => {
            try {
                await saveWorldCorrectionFromGui();
            } catch (e) {
                toast(`❌ 세계관 보정 저장 실패: ${e?.message || e}`);
            }
        };
        overlay.querySelector('#btn-save-world-fields').onclick = async () => {
            try {
                await saveWorldFieldsFromGui();
            } catch (e) {
                toast(`❌ 세계관 필드 저장 실패: ${e?.message || e}`);
            }
        };
        overlay.querySelector('#btn-save-settings').onclick = () => {
            const cfg = buildSettingsConfigFromUI();
            recordRuntimeDebug('warn', "[LIBRA Debug] Saved Settings:", {
                ...cfg,
                llm: { ...(cfg.llm || {}), key: cfg.llm?.key ? '[REDACTED]' : '' },
                auxLlm: { ...(cfg.auxLlm || {}), key: cfg.auxLlm?.key ? '[REDACTED]' : '' },
                embed: { ...(cfg.embed || {}), key: cfg.embed?.key ? '[REDACTED]' : '' },
                backendHosting: { ...(cfg.backendHosting || {}), token: cfg.backendHosting?.token ? '[REDACTED]' : '' }
            });
            writeCommonPluginSettings(JSON.stringify(cfg)).then(() => {
                Object.assign(MemoryEngine.CONFIG, cfg);
                _CFG = { ...MemoryEngine.CONFIG };
                syncManualOocPauseConfig(MemoryEngine.CONFIG, { reason: 'settings-save' });
                if (MemoryEngine.CONFIG.responseStreamingCompatEnabled !== false) {
                    try { ensureResponseStreamingCompatibilityHandlers?.(); } catch (_) {}
                }
                applyGuiEntityBlocklistToLocalSnapshots();
                renderEnts();
                toast("💾 설정 저장됨");
            }).catch(() => toast("❌ 저장 실패"));
        };

        overlay.querySelector('#btn-reset-settings').onclick = async () => {
            if (!await Utils.confirmEx("모든 설정을 초기값으로 되돌리시겠습니까?")) return;
            const resetConfig = {
                ...buildOptimizedHiddenSettingsDefaults({ coldStartScopePreset: 'all', coldStartHistoryLimit: 0 }),
                manualOocPause: false,
                entityBlocklist: [],
                storyAuthorEnabled: false,
                storyAuthorMode: 'disabled',
                directorEnabled: false,
                directorMode: 'disabled',
                internalDataLanguageMode: 'off',
                internalDataLanguageDebug: false,
                flexRoutingMode: 'off',
                flexTimeoutMs: 600000,
                flexFallbackToStandard: false,
                vertexFlexMode: 'provisioned_then_flex',
                customServiceTierPassthrough: false,
                backendHosting: { mode: 'off', url: '', token: '', autoDetected: false, lastDetectedAt: '', lastManifest: null },
                hypaV3AutoReflectEnabled: false,
                moduleLorebookReflectionEnabled: false,
                moduleLorebookSelectedIds: '',
                llm: { provider: "openai", url: "", key: "", model: "gpt-4o-mini", temp: 0.3, timeout: 120000, serviceTier: "off", reasoningPreset: "auto", reasoningEffort: "none", reasoningBudgetTokens: DEFAULT_REASONING_BUDGET_TOKENS, maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS, glmThinkingType: "enabled", stream: false },
                auxLlm: { enabled: false, provider: "openai", url: "", key: "", model: "gpt-4o-mini", temp: 0.2, timeout: 90000, serviceTier: "off", reasoningPreset: "auto", reasoningEffort: "none", reasoningBudgetTokens: DEFAULT_REASONING_BUDGET_TOKENS, maxCompletionTokens: DEFAULT_AUX_MAX_COMPLETION_TOKENS, glmThinkingType: "enabled", stream: false },
                embed: { enabled: true, provider: "openai", url: "", key: "", model: "text-embedding-3-small", timeout: 120000 }
            };
            try {
                await writeCommonPluginSettings(JSON.stringify(resetConfig));
            } catch (err) {
                toast(`❌ 설정 초기화 저장 실패: ${err?.message || err}`);
                return;
            }
            _CFG = resetConfig;
            Object.assign(MemoryEngine.CONFIG, _CFG);
            MemoryEngine.CONFIG.llm = { ...(_CFG.llm || {}) };
            MemoryEngine.CONFIG.auxLlm = { ...(_CFG.auxLlm || {}) };
            MemoryEngine.CONFIG.embed = { ...(_CFG.embed || {}) };
            syncManualOocPauseConfig(MemoryEngine.CONFIG, { reason: 'settings-reset' });
            if (MemoryEngine.CONFIG.responseStreamingCompatEnabled !== false) {
                try { ensureResponseStreamingCompatibilityHandlers?.(); } catch (_) {}
            }
            applyGuiEntityBlocklistToLocalSnapshots();
            loadSettings(); renderEnts(); toast("🔄 설정 초기화됨");
        };

        overlay.querySelector('#lmai-cache-reset').onclick = async () => {
            if (!await Utils.confirmEx("현재 채팅의 LIBRA 로어북 데이터와 런타임 캐시를 모두 삭제하고, 콜드 스타트를 다시 돌릴 수 있는 빈 상태로 만들까요? 일반 로어북 항목은 보존됩니다.")) return;

            let droppedBg = 0;
            let droppedLlm = 0;
            try { droppedBg = BackgroundMaintenanceQueue?.clearPending?.('manual-cache-reset') || 0; } catch (error) {
                recordSuppressedRuntimeError('manual_cache_reset.clear_background_queue', error);
            }
            try { droppedLlm = MaintenanceLLMQueue?.clearPending?.('manual-cache-reset') || 0; } catch (error) {
                recordSuppressedRuntimeError('manual_cache_reset.clear_llm_queue', error);
            }
            clearLibraTransientRuntimeState();

            const activeChatId = chat?.id || null;
            const activeScopeKey = getChatRuntimeScopeKey(chat, char);
            const purgeResult = await purgeLibraManagedLoreForActiveChat(chat, { purgeGlobal: true });
            if (!purgeResult?.ok) {
                toast(`❌ 캐시 초기화 실패: ${purgeResult?.reason || 'unknown'}`);
                return;
            }

            if (chat && purgeResult.storedChat && typeof purgeResult.storedChat === 'object') {
                if (Array.isArray(purgeResult.storedChat.localLore)) chat.localLore = purgeResult.storedChat.localLore.map(entry => safeClone(entry));
                if (Array.isArray(purgeResult.storedChat.lorebook)) chat.lorebook = purgeResult.storedChat.lorebook.map(entry => safeClone(entry));
                if (Array.isArray(purgeResult.storedChat.lore)) chat.lore = purgeResult.storedChat.lore.map(entry => safeClone(entry));
            }

            lore = [];
            effectiveGuiLore = [];
            _MEM = [];
            _ENT = [];
            _REL = [];
            _NAR = { storylines: [], turnLog: [], metaTurnLog: [], lastSummaryTurn: 0 };
            _WLD = { nodes: [], activePath: [], global: {}, rootId: null };

            MemoryState.reset({ preserveSessionCache: false });
            MemoryState.isInitialized = false;
            MemoryState.currentSessionId = buildScopedSessionId(activeScopeKey);
            MemoryState._activeChatId = activeChatId || null;
            MemoryState._activeScopeKey = activeScopeKey || activeChatId || null;
            MemoryEngine.rebuildIndex([]);
            MemoryEngine.setTurn(0);
            EntityManager.clearCache();
            if (typeof EntityManager.getRelationCache === 'function' && EntityManager.getRelationCache().clear) {
                EntityManager.getRelationCache().clear();
            }
            NarrativeTracker.resetState({ storylines: [], turnLog: [], metaTurnLog: [], lastSummaryTurn: 0 });
            StoryAuthor.resetState();
            Director.resetState();
            CharacterStateTracker.resetState();
            WorldStateTracker.resetState();
            SecretKnowledgeCore.resetState();
            EntityKnowledgeVaultCore.resetState();
            SectionWorldInferenceManager.resetState();
            
            syncGuiSnapshotsFromRuntime();
            renderEnts();
            renderNarrative();
            renderWorld();
            filterMems();
            
            toast(`✅ LIBRA 데이터 초기화 완료 · 삭제 ${purgeResult.removed || 0}개 · 대기작업 ${droppedBg + droppedLlm}개 정리 · 콜드 스타트 준비됨`);
        };

        // 리스트 동적 버튼 이벤트 위임 (Event Delegation)
        overlay.addEventListener('click', async (e) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            if (target.classList.contains('act-save-mem')) {
                const idx = parseInt(target.dataset.idx, 10);
                if (isNaN(idx) || idx < 0 || idx >= _MEM.length) return;
                const nc = Utils.getMemorySourceText(overlay.querySelector(".mt-val[data-idx='"+idx+"']")?.value || '');
                const ni = parseInt(overlay.querySelector(".mi-val[data-idx='"+idx+"']")?.value) || 5;
                const previousMeta = parseMeta(_MEM[idx].content);
                const previousTurn = normalizeLegacyMemoryTurnAnchor(previousMeta.t || previousMeta.turn || previousMeta.finalizedTurn || previousMeta.turnAnchorTurn || 0);
                const meta = { ...previousMeta };
                meta.imp = Math.max(1, Math.min(10, ni));
                meta.summary = '';
                meta.source = meta.source || 'narrative_source_record';
                meta.sourceHint = meta.sourceHint || 'Used as source evidence for narrative summaries.';
                _MEM[idx].content = `[META:${JSON.stringify(meta)}]
${nc}`;
                if (_CFG.rpLongTermMemoryEnabled !== false && previousTurn > 0) {
                    try {
                        RPContinuityCore.pruneRollbackTurns(lore, [previousTurn], { reason: 'gui-memory-edit' });
                        const editedPayload = CompactMemoryCodec.parsePayloadFromEntry(_MEM[idx]);
                        if (editedPayload?.rpLongTerm) {
                            RPContinuityCore.upsertFromTurn(lore, editedPayload.rpLongTerm, {
                                turn: previousTurn,
                                entityRefs: editedPayload?.participants?.canonicalEntities || editedPayload?.mentionedEntityNames || [],
                                source: 'gui-memory-edit',
                                sourceMemoryKey: String(_MEM[idx]?.key || '').trim() || `memory_hash:${TokenizerEngine.simpleHash(String(_MEM[idx]?.content || ''))}`
                            });
                        }
                    } catch (error) {
                        if (_CFG.debug) recordRuntimeDebug('warn', '[LIBRA][RP-LTM] GUI memory edit reconciliation skipped:', error?.message || error);
                    }
                }
                toast("✅ 메모리 수정됨");
            } else if (target.classList.contains('act-del-mem')) {
                const idx = parseInt(target.dataset.idx, 10);
                if (isNaN(idx) || idx < 0 || idx >= _MEM.length) return;
                if (!await Utils.confirmEx("이 메모리를 삭제하시겠습니까?")) return;
                const removedEntry = _MEM[idx];
                const removedMeta = parseMeta(removedEntry?.content || '');
                const removedTurn = normalizeLegacyMemoryTurnAnchor(removedMeta.t || removedMeta.turn || removedMeta.finalizedTurn || removedMeta.turnAnchorTurn || 0);
                _MEM.splice(idx, 1);
                if (_CFG.rpLongTermMemoryEnabled !== false && removedTurn > 0) {
                    try { RPContinuityCore.pruneRollbackTurns(lore, [removedTurn], { reason: 'gui-memory-delete' }); }
                    catch (error) { if (_CFG.debug) recordRuntimeDebug('warn', '[LIBRA][RP-LTM] GUI memory delete reconciliation skipped:', error?.message || error); }
                }
                filterMems(); toast("🗑 메모리가 삭제됨");
            } else if (target.classList.contains('act-rename-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                const d = parseGuiStoredJson(_ENT[i], 'entity.rename', i);
                const currentName = String(d.name || '').trim();
                if (!currentName) return;
                const nextName = typeof window !== 'undefined'
                    ? window.prompt('새 인물 이름을 입력하세요', currentName)
                    : '';
                if (nextName == null) return;
                const cleanName = String(nextName || '').trim();
                if (!cleanName || cleanName === currentName) return;
                try {
                    toast('이름 변경 중...', 1800);
                    const result = await renameEntityAcrossRuntime(currentName, cleanName);
                    if (result?.ok) {
                        toast(`✅ ${result.oldName} → ${result.newName} 이름 변경됨${result.aliasKept ? ' · 기존 이름 별칭 유지' : ' · 기존 이름 별칭 제외'}`, 3200);
                    }
                } catch (e) {
                    toast(`❌ 이름 변경 실패: ${e?.message || e}`, 3600);
                }
            } else if (target.classList.contains('act-absorb-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                const d = parseGuiStoredJson(_ENT[i], 'entity.absorb', i);
                if (typeof EntityManager?.normalizeEntityRecord === 'function') EntityManager.normalizeEntityRecord(d);
                const sourceName = String(d.name || '').trim();
                if (!sourceName) return;
                const mode = String(target.dataset.mode || '').trim();
                const absorptionMeta = d?.meta?.absorption && typeof d.meta.absorption === 'object' ? d.meta.absorption : null;
                if (mode === 'cancel' || String(absorptionMeta?.status || '').toLowerCase() === 'pending') {
                    if (!await Utils.confirmEx(`"${sourceName}"의 흡수 대기 상태를 취소하시겠습니까?`)) return;
                    try {
                        const result = await cancelEntityAbsorptionFromGui(sourceName);
                        toast(`↩ ${result.sourceName} 흡수 대기 취소됨`, 2800);
                    } catch (err) {
                        toast(`❌ 흡수 취소 실패: ${err?.message || err}`, 3600);
                    }
                    return;
                }

                const sourceCanonical = EntityManager.normalizeName(sourceName, lore) || sourceName;
                const candidates = _ENT
                    .map((entry, idx) => {
                        if (idx === i) return null;
                        const candidate = parseGuiStoredJson(entry, 'entity.absorb_candidate', idx);
                        if (typeof EntityManager?.normalizeEntityRecord === 'function') EntityManager.normalizeEntityRecord(candidate);
                        const name = String(candidate.name || '').trim();
                        if (!name) return null;
                        if (EntityManager.isPromptVisibleEntityRecord?.(candidate) === false) return null;
                        const canonical = EntityManager.normalizeName(name, lore) || name;
                        if (!canonical || canonical === sourceCanonical) return null;
                        return { idx, name, canonical };
                    })
                    .filter(Boolean);
                if (candidates.length === 0) {
                    toast('흡수 대상으로 삼을 정규 엔티티가 없습니다.', 3000);
                    return;
                }
                const promptText = [
                    `"${sourceCanonical}"를 어느 정규 엔티티에 흡수할까요?`,
                    '',
                    ...candidates.slice(0, 40).map((item, idx) => `${idx + 1}. ${item.canonical}`)
                ].join('\n');
                const answer = typeof window !== 'undefined' ? window.prompt(promptText, candidates[0]?.canonical || '') : '';
                if (answer == null) return;
                const cleaned = String(answer || '').trim();
                if (!cleaned) return;
                const numericChoice = Number(cleaned);
                const chosen = Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= candidates.length
                    ? candidates[numericChoice - 1]
                    : candidates.find(item => item.canonical === cleaned || item.name === cleaned);
                if (!chosen) {
                    toast('목록에 있는 정규 엔티티 이름이나 번호를 입력해야 합니다.', 3600);
                    return;
                }
                if (!await Utils.confirmEx(`"${sourceCanonical}"를 "${chosen.canonical}"에 흡수 대기 표시할까요? 다음 유지보수 턴에서 LLM 병합이 진행됩니다.`)) return;
                try {
                    toast('흡수 대기 표시 저장 중...', 1800);
                    const result = await markEntityAbsorptionFromGui(sourceCanonical, chosen.canonical);
                    toast(`✅ ${result.sourceName} → ${result.targetName} 흡수 대기 등록됨`, 3200);
                } catch (err) {
                    toast(`❌ 흡수 지정 실패: ${err?.message || err}`, 3600);
                }
            } else if (target.classList.contains('act-save-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                let d = parseGuiStoredJson(_ENT[i], 'entity.save', i);
                d.meta = d.meta || {};
                d.meta.source = 'gui';
                d.meta.manualLocked = true;
                d.meta.manualLockedAt = Date.now();
                const guiFeatures = parseGuiCsv(overlay.querySelector(".eF-val[data-idx='"+i+"']")?.value || '');
                const guiTraits = parseGuiCsv(overlay.querySelector(".eP-val[data-idx='"+i+"']")?.value || '');
                const guiRole = (overlay.querySelector(".eRole-val[data-idx='"+i+"']")?.value || '').trim();
                const guiBackground = (overlay.querySelector(".eBg-val[data-idx='"+i+"']")?.value || '').trim();
                const guiCurrentSummary = (overlay.querySelector(".eCSummary-val[data-idx='"+i+"']")?.value || '').trim();
                const guiSpeechNotes = parseGuiCsv(
                    overlay.querySelector(".eSpeechNotes-val[data-idx='"+i+"']")?.value
                    || overlay.querySelector(".eSN-val[data-idx='"+i+"']")?.value
                    || ''
                );
                const guiPsychology = (overlay.querySelector(".ePsychBase-val[data-idx='"+i+"']")?.value || '').trim();
                const guiOpenThreads = parseGuiOpenThreadLabels(overlay.querySelector(".eThreads-val[data-idx='"+i+"']")?.value || '');
                d.appearance = d.appearance && typeof d.appearance === 'object' ? d.appearance : {};
                d.personality = d.personality && typeof d.personality === 'object' ? d.personality : {};
                d.speechStyle = d.speechStyle && typeof d.speechStyle === 'object' ? d.speechStyle : {};
                d.background = d.background && typeof d.background === 'object' ? d.background : {};
                d.status = d.status && typeof d.status === 'object' ? d.status : {};
                d.identity = d.identity && typeof d.identity === 'object' ? d.identity : {};
                d.identity.roleInStory = guiRole;
                d.identity.summary = guiBackground;
                d.profile = d.profile && typeof d.profile === 'object' ? d.profile : {};
                d.profile.appearance = d.profile.appearance && typeof d.profile.appearance === 'object' ? d.profile.appearance : {};
                d.profile.appearance.features = [...guiFeatures];
                d.profile.appearance.distinctiveMarks = Array.isArray(d.appearance.distinctiveMarks) ? d.appearance.distinctiveMarks : [];
                d.profile.appearance.clothing = Array.isArray(d.appearance.clothing) ? d.appearance.clothing : [];
                d.profile.personality = d.profile.personality && typeof d.profile.personality === 'object' ? d.profile.personality : {};
                d.profile.personality.traits = [...guiTraits];
                d.profile.personality.likes = Array.isArray(d.profile.personality.likes) ? d.profile.personality.likes : (Array.isArray(d.personality?.likes) ? d.personality.likes : []);
                d.profile.personality.dislikes = Array.isArray(d.profile.personality.dislikes) ? d.profile.personality.dislikes : (Array.isArray(d.personality?.dislikes) ? d.personality.dislikes : []);
                d.profile.speechStyle = d.profile.speechStyle && typeof d.profile.speechStyle === 'object' ? d.profile.speechStyle : {};
                d.profile.speechStyle.notes = [...guiSpeechNotes];
                d.background = d.background || {};
                d.background.origin = guiBackground;
                d.background.history = guiBackground ? [guiBackground] : [];
                d.appearance = d.appearance || {}; d.appearance.features = [...guiFeatures];
                d.personality = d.personality || {};
                d.personality.traits = [...guiTraits];
                d.speechStyle = d.speechStyle || {};
                d.speechStyle.notes = [...guiSpeechNotes];
                d.profile.psychology = d.profile.psychology && typeof d.profile.psychology === 'object' ? d.profile.psychology : {};
                d.profile.psychology.baseline = guiPsychology;
                d.currentState = d.currentState && typeof d.currentState === 'object' ? d.currentState : {};
                d.currentState.summary = guiCurrentSummary;
                d.currentState.lastObservedTurn = Number(d.currentState.lastObservedTurn || MemoryEngine.getCurrentTurn?.() || 0);
                d.continuity = d.continuity && typeof d.continuity === 'object' ? d.continuity : {};
                d.continuity.openThreads = guiOpenThreads;
                d.quality = d.quality && typeof d.quality === 'object' ? d.quality : {};
                d.quality.lastUpdatedTurn = Number(MemoryEngine.getCurrentTurn?.() || d.quality.lastUpdatedTurn || 0);
                d.quality.sourceMix = Array.isArray(d.quality.sourceMix) ? d.quality.sourceMix : [];
                if (!d.quality.sourceMix.includes('gui')) d.quality.sourceMix.push('gui');
                if (typeof EntityManager?.normalizeEntityRecord === 'function') d = EntityManager.normalizeEntityRecord(d);
                _ENT[i].content = JSON.stringify(d); toast("✅ 인물 데이터 수정됨");
            } else if (target.classList.contains('act-del-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                if (!await Utils.confirmEx("이 인물 데이터를 삭제하시겠습니까?")) return;
                _ENT.splice(i, 1); renderEnts(); toast("🗑 삭제됨");
            } else if (target.classList.contains('act-block-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                let d = parseGuiStoredJson(_ENT[i], 'entity.block', i);
                const entityName = String(d.name || '').trim();
                if (!entityName) return;
                if (!await Utils.confirmEx(`"${entityName}" 엔티티를 차단 리스트에 넣고 기존 구조 데이터도 정리하시겠습니까?`)) return;
                try {
                    const blockedName = await blockEntityFromGui(entityName, { removeStoredData: true });
                    toast(`⛔ ${blockedName} 차단됨`);
                } catch (err) {
                    toast(`❌ 엔티티 차단 실패: ${err?.message || err}`);
                }
            } else if (target.classList.contains('act-toggle-lock-ent')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _ENT.length) return;
                let d = parseGuiStoredJson(_ENT[i], 'entity.toggle_lock', i);
                d.meta = d.meta || {};
                const nextLocked = !d.meta.manualLocked;
                d.meta.manualLocked = nextLocked;
                d.meta.manualLockedAt = nextLocked ? Date.now() : 0;
                if (nextLocked) d.meta.source = 'gui';
                _ENT[i].content = JSON.stringify(d);
                renderEnts();
                toast(nextLocked ? "🔒 인물 수동 보호 설정됨" : "🔓 인물 수동 보호 해제됨");
            } else if (target.classList.contains('act-save-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                let d = parseGuiStoredJson(_REL[i], 'relation.save', i);
                d.meta = d.meta || {};
                d.meta.source = 'gui';
                d.meta.manualLocked = true;
                d.meta.manualLockedAt = Date.now();
                d.relationType = overlay.querySelector(".rT-val[data-idx='"+i+"']")?.value || '';
                d.sentiments = d.sentiments || {}; d.sentiments.fromAtoB = overlay.querySelector(".rS-val[data-idx='"+i+"']")?.value || '';
                const closenessInput = overlay.querySelector(".rC-val[data-idx='"+i+"']");
                const trustInput = overlay.querySelector(".rR-val[data-idx='"+i+"']");
                d.details = d.details || {};
                d.details.closeness = closenessInput?.dataset?.unset === '1'
                    ? null
                    : (parseInt(closenessInput?.value) || 0) / 100;
                d.details.trust = trustInput?.dataset?.unset === '1'
                    ? null
                    : (parseInt(trustInput?.value) || 0) / 100;
                const floors = (() => {
                    const text = String(d.relationType || '').toLowerCase();
                    if (['연인', '애인', 'lover', 'romantic partner', 'spouse', 'wife', 'husband'].some(k => text.includes(k))) return { closeness: 0.75, trust: 0.75 };
                    if (['썸', '호감', 'crush', 'flirt'].some(k => text.includes(k))) return { closeness: 0.55, trust: 0.45 };
                    if (['친구', '동료', 'friend', 'teammate', 'partner'].some(k => text.includes(k))) return { closeness: 0.45, trust: 0.45 };
                    if (['가족', '형제', '자매', '남매', '모녀', '부녀', 'family', 'sibling', 'parent'].some(k => text.includes(k))) return { closeness: 0.65, trust: 0.6 };
                    if (['스승', '제자', 'mentor', 'student', 'teacher'].some(k => text.includes(k))) return { closeness: 0.35, trust: 0.55 };
                    if (['라이벌', '경쟁', 'rival'].some(k => text.includes(k))) return { closeness: 0.3, trust: 0.2 };
                    if (['적', '원수', 'enemy', 'hostile'].some(k => text.includes(k))) return { closeness: 0.05, trust: 0.05 };
                    return null;
                })();
                if (floors) {
                    d.details.closeness = Math.max(Number.isFinite(Number(d.details.closeness)) ? Number(d.details.closeness) : 0, floors.closeness);
                    d.details.trust = Math.max(Number.isFinite(Number(d.details.trust)) ? Number(d.details.trust) : 0, floors.trust);
                }
                d.currentStatus = d.currentStatus && typeof d.currentStatus === 'object' ? d.currentStatus : {};
                d.currentStatus.summary = (overlay.querySelector(".rState-val[data-idx='"+i+"']")?.value || '').trim();
                d.currentStatus.lastChangedTurn = Number(MemoryEngine.getCurrentTurn?.() || d.currentStatus.lastChangedTurn || 0);
                d.metrics = d.metrics && typeof d.metrics === 'object' ? d.metrics : {};
                d.metrics.closeness = Number.isFinite(Number(d.details.closeness)) ? Number(d.details.closeness) : null;
                d.metrics.trust = Number.isFinite(Number(d.details.trust)) ? Number(d.details.trust) : null;
                d.metrics.ambiguity = d.metrics.closeness == null && d.metrics.trust == null ? 0.65 : (d.metrics.ambiguity || 0);
                d.dynamics = d.dynamics && typeof d.dynamics === 'object' ? d.dynamics : {};
                d.dynamics.unresolvedIssues = parseGuiLines(overlay.querySelector(".rIssues-val[data-idx='"+i+"']")?.value || '');
                d.dynamics.recentChanges = parseGuiLines(overlay.querySelector(".rChanges-val[data-idx='"+i+"']")?.value || '');
                d.quality = d.quality && typeof d.quality === 'object' ? d.quality : {};
                d.quality.lastUpdatedTurn = Number(MemoryEngine.getCurrentTurn?.() || d.quality.lastUpdatedTurn || 0);
                d.quality.sourceMix = Array.isArray(d.quality.sourceMix) ? d.quality.sourceMix : [];
                if (!d.quality.sourceMix.includes('gui')) d.quality.sourceMix.push('gui');
                const hasRelationScores = d.metrics.closeness != null || d.metrics.trust != null;
                const relationEvidenceCount = [
                    ...(Array.isArray(d.details.events) ? d.details.events : []),
                    ...(Array.isArray(d.eventLedger) ? d.eventLedger : []),
                    ...(Array.isArray(d.evidence) ? d.evidence : [])
                ].filter(Boolean).length;
                d.relationshipAssessment = {
                    ...(d.relationshipAssessment && typeof d.relationshipAssessment === 'object' ? d.relationshipAssessment : {}),
                    stage: hasRelationScores ? 'defined_manual' : 'first_contact',
                    definitionConfidence: hasRelationScores ? 0.7 : (relationEvidenceCount > 0 ? 0.18 : 0.08),
                    evidenceCount: relationEvidenceCount,
                    label: hasRelationScores ? '수동 정의됨' : '첫 대면 · 정의 보류',
                    note: hasRelationScores ? '사용자가 직접 관계 수치를 지정함' : '관계를 정의하기에는 근거가 부족함',
                    inferred: !hasRelationScores
                };
                _REL[i].content = JSON.stringify(d);
                renderEnts();
                toast("✅ 관계 데이터 수정됨");
            } else if (target.classList.contains('act-unset-rel-score')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                const field = String(target.dataset.field || '').trim();
                const selector = field === 'trust' ? '.rR-val' : '.rC-val';
                const input = overlay.querySelector(`${selector}[data-idx='${i}']`);
                if (input) {
                    input.dataset.unset = '1';
                    input.value = '0';
                }
                toast(field === 'trust' ? '신뢰도를 미정으로 표시합니다. 저장을 눌러 반영하세요.' : '친밀도를 미정으로 표시합니다. 저장을 눌러 반영하세요.');
            } else if (target.classList.contains('act-toggle-lock-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                let d = parseGuiStoredJson(_REL[i], 'relation.toggle_lock', i);
                d.meta = d.meta || {};
                const nextLocked = !d.meta.manualLocked;
                d.meta.manualLocked = nextLocked;
                d.meta.manualLockedAt = nextLocked ? Date.now() : 0;
                if (nextLocked) d.meta.source = 'gui';
                _REL[i].content = JSON.stringify(d);
                renderEnts();
                toast(nextLocked ? "🔒 관계 수동 보호 설정됨" : "🔓 관계 수동 보호 해제됨");
            } else if (target.classList.contains('act-del-rel')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= _REL.length) return;
                if (!await Utils.confirmEx("이 관계 데이터를 삭제하시겠습니까?")) return;
                _REL.splice(i, 1); renderEnts(); toast("🗑 삭제됨");
            } else if (target.classList.contains('act-unblock-ent')) {
                const name = String(target.dataset.name || '').trim();
                if (!name) return;
                await unblockEntityFromGui(name);
            } else if (target.classList.contains('act-save-nar')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= (_NAR.storylines || []).length) return;
                const storyline = _NAR.storylines[i] || {};
                storyline.meta = storyline.meta || {};
                storyline.meta.manualLocked = true;
                storyline.meta.manualLockedAt = Date.now();
                storyline.name = (overlay.querySelector(".nN-val[data-idx='"+i+"']")?.value || '').trim() || `Storyline ${i + 1}`;
                storyline.entities = (overlay.querySelector(".nE-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                storyline.currentContext = (overlay.querySelector(".nC-val[data-idx='"+i+"']")?.value || '').trim();
                storyline.keyPoints = (overlay.querySelector(".nK-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                storyline.ongoingTensions = (overlay.querySelector(".nO-val[data-idx='"+i+"']")?.value || '').split(",").map(s => s.trim()).filter(Boolean);
                storyline.recentEvents = (overlay.querySelector(".nR-val[data-idx='"+i+"']")?.value || '')
                    .split(/\r?\n/)
                    .map(s => s.trim())
                    .filter(Boolean)
                    .map((line, idx) => {
                        const match = line.match(/^T(\d+)\s*:\s*(.+)$/i);
                        if (match) return { turn: Number(match[1]), brief: match[2].trim() };
                        return { turn: idx + 1, brief: line };
                    });
                const latestSummary = (overlay.querySelector(".nS-val[data-idx='"+i+"']")?.value || '').trim();
                storyline.summaries = Array.isArray(storyline.summaries) ? storyline.summaries : [];
                if (latestSummary) {
                    const upToTurn = MemoryEngine.getCurrentTurn();
                    const last = storyline.summaries[storyline.summaries.length - 1];
                    if (last) {
                        last.summary = latestSummary;
                        last.upToTurn = upToTurn;
                        last.keyPoints = [...storyline.keyPoints];
                        last.ongoingTensions = [...storyline.ongoingTensions];
                    } else {
                        storyline.summaries.push({ upToTurn, summary: latestSummary, keyPoints: [...storyline.keyPoints], ongoingTensions: [...storyline.ongoingTensions], timestamp: Date.now() });
                    }
                }
                _NAR.storylines[i] = storyline;
                renderNarrative();
                toast("✅ 내러티브 수정됨");
            } else if (target.classList.contains('act-toggle-lock-nar')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= (_NAR.storylines || []).length) return;
                const storyline = _NAR.storylines[i] || {};
                storyline.meta = storyline.meta || {};
                const nextLocked = !storyline.meta.manualLocked;
                storyline.meta.manualLocked = nextLocked;
                storyline.meta.manualLockedAt = nextLocked ? Date.now() : 0;
                _NAR.storylines[i] = storyline;
                renderNarrative();
                toast(nextLocked ? "🔒 내러티브 수동 보호 설정됨" : "🔓 내러티브 수동 보호 해제됨");
            } else if (target.classList.contains('act-del-nar')) {
                const i = parseInt(target.dataset.idx, 10);
                if (isNaN(i) || i < 0 || i >= (_NAR.storylines || []).length) return;
                if (!await Utils.confirmEx("이 스토리라인을 삭제하시겠습니까?")) return;
                _NAR.storylines.splice(i, 1);
                renderNarrative();
                toast("🗑 스토리라인 삭제됨");
            }
        });

        overlay.querySelector('#btn-transition').onclick = async () => {
            const confirmed = await Utils.confirmEx(
                "현재 기억을 보존한 채 새 채팅방을 자동 생성하시겠습니까?\n모든 LIBRA 데이터(기억, 엔티티, 세계관 등)가 새 방으로 계승됩니다.\n(LLM 토큰이 일부 소모될 수 있습니다)"
            );
            if (!confirmed) return;

            LMAI_GUI.toast("🚀 세션 전환 중...");
            const success = await TransitionManager.executeTransition();
            
            if (success) {
                await Utils.alertEx(
                    "✅ 새 세션 생성 완료!\n\n모든 기억과 세계관 데이터가 새 채팅방으로 계승되었습니다.\n채팅 목록에서 새로 생성된 방을 확인하세요."
                );
                closeGuiOverlay();
            } else {
                await Utils.alertEx("❌ 세션 전환 중 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        };

        overlay.querySelector('#btn-cold-start').onclick = async () => {
            if (!confirm("현재 채팅방의 과거 내역을 분석하여 메모리를 재구축하시겠습니까?")) return;
            try {
                await ColdStartManager.startAutoSummarization();
                lore = MemoryEngine.getLorebook(char, chat) || lore;
                syncGuiSnapshotsFromRuntime();
                renderEnts();
                renderNarrative();
                renderWorld();
                filterMems();
            } catch (e) {
                toast(`❌ 초기 구조 분석 실패: ${e?.message || e}`);
            }
        };

        overlay.querySelector('#btn-cold-reanalyze').onclick = async () => {
            try {
                await runUnifiedHistoricalReanalysisFromGui('과거 대화 통합 재분석');
            } catch (e) {
                toast(`❌ 과거 대화 재분석 실패: ${e?.message || e}`);
            }
        };

        overlay.querySelector('#btn-add-narrative').onclick = () => {
            _NAR.storylines = Array.isArray(_NAR.storylines) ? _NAR.storylines : [];
            _NAR.storylines.push({
                id: (_NAR.storylines.reduce((max, s) => Math.max(max, Number(s?.id || 0)), 0) || 0) + 1,
                name: `New Storyline ${_NAR.storylines.length + 1}`,
                entities: [],
                turns: [],
                recentEvents: [],
                summaries: [],
                keyPoints: [],
                ongoingTensions: [],
                currentContext: ''
            });
            renderNarrative();
            toast("➕ 스토리라인 추가됨");
        };

        overlay.querySelector('#btn-save-narrative').onclick = async () => {
            const narrativeEntry = buildNarrativeLoreEntry();
            const nextLore = lore.filter(e => e.comment !== 'lmai_narrative').map(entry => safeClone(entry));
            nextLore.push(narrativeEntry);
            await saveLoreToChar(nextLore, () => {
                NarrativeTracker.loadState(nextLore);
                StoryAuthor.loadState(nextLore);
                Director.loadState(nextLore);
                toast("💾 내러티브 저장 완료");
            });
        };

        // 초기 화면 렌더링
        filterMems();
        renderEnts();
        renderNarrative();
        renderWorld();
        loadSettings();
        void refreshSourceModuleSelector({ quiet: true });

        await R.showContainer('fullscreen');
    };

    const toast = (m, d) => {
        try { void LibraToast.notify(m, { duration: d || 2000, key: `gui:${String(m || '')}` }); } catch {}
    };

    return { show, toast };
})();

// GUI 등록
(async () => {
    const R = RisuCompat.host('registerSetting') || RisuCompat.host('registerButton') || RisuCompat.api();
    if (R) {
        try {
            await R.registerSetting('LIBRA World Manager', LMAI_GUI.show, '📚', 'html', 'lmai-settings');
            await R.registerButton({
                name: 'LIBRA',
                icon: '📚',
                iconType: 'html',
                location: 'chat',
                id: LIBRA_LAUNCHER_BUTTON_ID
            }, LMAI_GUI.show);
            if (typeof R.onUnload === 'function') {
                await R.onUnload(async () => {
                    try { unbindUiInteractionGuards(); } catch {}
                    try { await LibraToast.cleanup(); } catch {}
                });
            }
            recordRuntimeDebug('log', '[LIBRA] GUI registered.');
        } catch (e) {
            recordRuntimeDebug('warn', '[LIBRA] GUI registration failed:', e?.message || e);
        }
    }
})();


// Runtime internals are not exported; use the visible recent-turn debug export from the GUI.
if (typeof globalThis !== 'undefined') {
    try { delete globalThis.LIBRA; } catch {}
    try { delete globalThis.LIBRA_DEV; } catch {}
}

})();
