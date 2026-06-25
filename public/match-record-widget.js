(function () {
  "use strict";

  var PANEL_ID = "match-record-widget-panel";
  var STYLE_ID = "match-record-widget-style";
  var TEAM_LABELS = { A: "DevUtd 형광", B: "DevUtd 주황" };
  var DEFAULT_VENUE = "성남 종합운동장 보조구장";
  var KNOWN_STAFF_ROLES = { "박지환": "단장", "유지웅": "감독", "정창영": "코치", "하성주": "코치", "박경덕": "코치", "윤원빈": "코치" };
  var state = {
    status: "",
    conflict: null,
    loadedRecord: null,
    loadedPlayers: null,
    loadedForm: null,
    editingRecordOnly: false,
    currentLineupOverride: false,
    editingMatchId: "",
    selectedScope: "",
    matchKind: "SELF",
    teamLabels: { A: TEAM_LABELS.A, B: TEAM_LABELS.B },
    teamScores: Object.create(null),
    summaryStats: Object.create(null),
    events: [],
    roles: Object.create(null),
    standaloneKey: "",
    recordLoadSeq: 0,
    recordLoading: false,
    editModalOpen: false,
    editDate: todayInputValue(),
    calendarMonth: todayInputValue().slice(0, 7),
    recordIndex: { loaded: false, loading: false, error: "", teamError: "", items: [], teamItems: [] },
    selectedTeamRecord: null,
    selectedTeamRecordLoading: false,
    selectedTeamRecordError: "",
    options: { loaded: false, stadiums: [], teams: [], error: "" },
  };

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".mrw-card{margin-top:16px;max-width:100%;box-sizing:border-box;overflow:hidden;border:1px solid #dbe3ef;border-radius:22px;background:#fff;padding:18px;box-shadow:0 12px 32px rgba(15,23,42,.08);font-family:inherit;color:#0f172a}",
      ".mrw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}",
      ".mrw-title{margin:0;color:#0f172a;font-size:20px;font-weight:950;letter-spacing:0}",
      ".mrw-help{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.55}",
      ".mrw-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}",
      ".mrw-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".mrw-field label{color:#64748b;font-size:11px;font-weight:900}",
      ".mrw-field input,.mrw-field select,.mrw-field textarea{display:block;width:100%;max-width:100%;min-width:0;min-inline-size:0;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:9px 10px;color:#0f172a;font-size:13px;font-weight:800}",
      ".mrw-field input[readonly]{background:#f8fafc;color:#475569}",
      ".mrw-field textarea{min-height:38px;resize:vertical}",
      ".mrw-wide{grid-column:span 2}",
      ".mrw-fixed{display:flex;align-items:center;min-height:38px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:0 10px;color:#334155;font-size:13px;font-weight:900;box-sizing:border-box}",
      ".mrw-segment{display:flex;gap:6px;border-radius:14px;background:#e2e8f0;padding:4px}",
      ".mrw-segment button{flex:1;border:0;border-radius:11px;background:transparent;padding:8px 10px;color:#475569;font-size:12px;font-weight:950;cursor:pointer}",
      ".mrw-segment button[aria-pressed=true]{background:#fff;color:#0f172a;box-shadow:0 1px 4px rgba(15,23,42,.12)}",
      ".mrw-duration{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}",
      ".mrw-duration button{border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:9px 8px;color:#334155;font-size:12px;font-weight:950;cursor:pointer}",
      ".mrw-duration button[aria-pressed=true]{border-color:#0f172a;background:#0f172a;color:#fff}",
      ".mrw-add-team{display:grid;grid-template-columns:1fr auto;gap:6px}",
      ".mrw-add-team button{border:0;border-radius:12px;background:#e2e8f0;color:#0f172a;padding:0 12px;font-size:12px;font-weight:950;cursor:pointer}",
      ".mrw-summary{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#e2e8f0}",
      ".mrw-summary-item{min-width:0;background:#fff;padding:9px 10px}",
      ".mrw-summary-label{margin-bottom:3px;color:#64748b;font-size:10px;font-weight:900}",
      ".mrw-summary-value{color:#0f172a;font-size:12px;font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mrw-mode{margin-top:14px;border:1px solid #dbe3ef;border-radius:18px;background:#f8fafc;padding:12px}",
      ".mrw-mode-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}",
      ".mrw-mode-title{font-size:14px;font-weight:950;color:#0f172a}",
      ".mrw-mode-help{margin-top:7px;color:#64748b;font-size:12px;font-weight:750;line-height:1.5}",
      ".mrw-scope{display:flex;align-items:center;gap:6px;color:#64748b;font-size:11px;font-weight:900}",
      ".mrw-scope select{border:1px solid #cbd5e1;border-radius:11px;background:#fff;padding:7px 9px;color:#0f172a;font-size:12px;font-weight:900}",
      ".mrw-layout{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(280px,.82fr);gap:14px;margin-top:14px;align-items:start}",
      ".mrw-main{min-width:0}",
      ".mrw-scoreboard{max-width:100%;box-sizing:border-box;overflow:hidden;border-radius:18px;background:#0f172a;padding:14px;color:#fff}",
      ".mrw-score-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:14px}",
      ".mrw-side-wrap{position:relative;min-width:0}",
      ".mrw-side{width:100%;max-width:100%;box-sizing:border-box;min-height:86px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:14px 42px;color:#fff;font-family:inherit;text-align:center;cursor:pointer;appearance:none;-webkit-appearance:none;box-shadow:0 8px 18px rgba(15,23,42,.12);transition:transform .12s ease,box-shadow .12s ease}",
      ".mrw-side:hover{transform:translateY(-1px);box-shadow:0 12px 24px rgba(15,23,42,.18)}",
      ".mrw-side:focus-visible{outline:3px solid rgba(255,255,255,.8);outline-offset:2px}",
      ".mrw-side-a{background:linear-gradient(135deg,#84cc16,#10b981)}",
      ".mrw-side-b{background:linear-gradient(135deg,#fb923c,#ea580c)}",
      ".mrw-team-name{max-width:100%;font-size:13px;font-weight:950;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mrw-score-num{font-size:48px;font-weight:950;line-height:.95;text-align:center}",
      ".mrw-score-minus{position:absolute;right:8px;top:8px;z-index:2;display:flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:rgba(15,23,42,.36);color:#fff;width:30px;height:30px;font-size:18px;font-weight:950;line-height:1;cursor:pointer;box-shadow:0 4px 12px rgba(15,23,42,.18)}",
      ".mrw-stats{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:10px}",
      ".mrw-stat-team{border:1px solid #e2e8f0;border-radius:18px;background:#fff;overflow:hidden}",
      ".mrw-stat-team-title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;background:#f8fafc;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:950;color:#0f172a}",
      ".mrw-stat-total{color:#64748b;font-size:12px;font-weight:900}",
      ".mrw-stat-list{display:grid;gap:7px;padding:10px}",
      ".mrw-stat-row{display:grid;grid-template-columns:minmax(70px,1fr) auto auto;align-items:center;gap:6px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:7px}",
      ".mrw-stat-name{min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#0f172a;font-size:13px;font-weight:950}",
      ".mrw-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mrw-player-remove{border:0;border-radius:999px;background:#fee2e2;color:#991b1b;padding:3px 7px;font-size:10px;font-weight:950;line-height:1;cursor:pointer}",
      ".mrw-add-player{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;border-top:1px solid #eef2f7;padding:10px;background:#f8fafc}",
      ".mrw-add-player input{min-width:0;border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:8px 10px;color:#0f172a;font-size:12px;font-weight:850}",
      ".mrw-add-player button{border:0;border-radius:12px;background:#e2e8f0;color:#0f172a;padding:0 10px;font-size:12px;font-weight:950;cursor:pointer}",
      ".mrw-edit-load-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-top:12px}",
      ".mrw-role{display:inline-flex;align-items:center;border-radius:999px;padding:2px 6px;font-size:10px;font-weight:950;line-height:1.1}",
      ".mrw-role-coach{background:#dff9fb;color:#0e7490}",
      ".mrw-role-manager{background:#ede9fe;color:#6d28d9}",
      ".mrw-role-director{background:#fef3c7;color:#92400e}",
      ".mrw-counter{display:grid;grid-template-columns:24px 24px 16px 24px;align-items:center;gap:2px;border-radius:999px;background:#f1f5f9;padding:4px;min-width:98px;box-sizing:border-box}",
      ".mrw-counter-label{color:#64748b;font-size:10px;font-weight:950;text-align:center;white-space:nowrap;line-height:1}",
      ".mrw-counter button{border:0;border-radius:999px;background:#fff;color:#0f172a;width:24px;height:24px;font-size:13px;font-weight:950;line-height:1;cursor:pointer;box-shadow:0 1px 3px rgba(15,23,42,.08)}",
      ".mrw-counter-value{text-align:center;color:#0f172a;font-size:13px;font-weight:950;line-height:1}",
      ".mrw-log{border:1px solid #e2e8f0;border-radius:18px;background:#fff;overflow:hidden}",
      ".mrw-log-head{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#f8fafc;padding:12px;border-bottom:1px solid #e2e8f0}",
      ".mrw-log-title{font-size:14px;font-weight:950}",
      ".mrw-log-score{font-size:12px;font-weight:950;color:#475569}",
      ".mrw-events{display:grid;gap:8px;padding:12px;max-height:560px;overflow:auto}",
      ".mrw-event{display:grid;gap:6px;border:1px solid #e2e8f0;border-radius:14px;padding:10px;background:#fff}",
      ".mrw-event-main{display:flex;align-items:center;justify-content:space-between;gap:8px}",
      ".mrw-event-text{font-size:13px;font-weight:950;color:#0f172a}",
      ".mrw-event-sub{font-size:12px;font-weight:800;color:#64748b}",
      ".mrw-event-actions{display:flex;gap:6px;flex-wrap:wrap}",
      ".mrw-small-btn{border:0;border-radius:999px;background:#e2e8f0;color:#334155;padding:6px 9px;font-size:11px;font-weight:950;cursor:pointer}",
      ".mrw-small-danger{background:#fee2e2;color:#991b1b}",
      ".mrw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}",
      ".mrw-button{border:0;border-radius:13px;padding:11px 14px;font-size:13px;font-weight:950;cursor:pointer}",
      ".mrw-primary{background:#0f172a;color:#fff}",
      ".mrw-secondary{background:#e2e8f0;color:#0f172a}",
      ".mrw-danger{background:#fee2e2;color:#991b1b}",
      ".mrw-status{margin-top:10px;border-radius:14px;background:#f8fafc;padding:10px;color:#334155;font-size:12px;font-weight:800;line-height:1.5;white-space:pre-wrap}",
      ".mrw-modal-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);padding:16px}",
      ".mrw-modal{width:min(440px,100%);max-height:min(78vh,640px);overflow:auto;border-radius:22px;background:#fff;box-shadow:0 24px 72px rgba(15,23,42,.3)}",
      ".mrw-modal-head{border-bottom:1px solid #e2e8f0;padding:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
      ".mrw-modal-title{margin:0;font-size:18px;font-weight:950}",
      ".mrw-modal-sub{margin:4px 0 0;color:#64748b;font-size:12px;font-weight:800}",
      ".mrw-modal-body{display:grid;gap:12px;padding:14px}",
      ".mrw-record-overview{display:grid;gap:12px}",
      ".mrw-record-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;padding:10px;color:#334155;font-size:12px;font-weight:900}",
      ".mrw-record-summary-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}",
      ".mrw-small-primary{background:#0f172a;color:#fff}",
      ".mrw-calendar{border:1px solid #e2e8f0;border-radius:16px;background:#fff;padding:10px}",
      ".mrw-calendar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}",
      ".mrw-calendar-title{font-size:13px;font-weight:950;color:#0f172a}",
      ".mrw-calendar-count{font-size:11px;font-weight:900;color:#64748b}",
      ".mrw-calendar-nav{display:flex;align-items:center;gap:6px}",
      ".mrw-calendar-nav button{border:0;border-radius:999px;background:#e2e8f0;color:#334155;width:28px;height:28px;font-size:16px;font-weight:950;line-height:1;cursor:pointer}",
      ".mrw-calendar-nav button:hover{background:#cbd5e1;color:#0f172a}",
      ".mrw-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}",
      ".mrw-calendar-dow{padding:4px 0;color:#94a3b8;font-size:10px;font-weight:950;text-align:center}",
      ".mrw-calendar-day{position:relative;min-height:34px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#334155;font-size:11px;font-weight:950;cursor:pointer}",
      ".mrw-calendar-day:hover{border-color:#94a3b8;background:#f8fafc}",
      ".mrw-calendar-day[disabled]{cursor:default;opacity:.35;background:#f8fafc}",
      ".mrw-calendar-day.mrw-has-record{border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8}",
      ".mrw-calendar-day.mrw-has-record:after{content:\"\";position:absolute;left:50%;bottom:5px;width:5px;height:5px;border-radius:999px;background:#2563eb;transform:translateX(-50%)}",
      ".mrw-calendar-day.mrw-has-team-record{border-color:#bbf7d0;background:#f0fdf4;color:#166534}",
      ".mrw-calendar-day.mrw-has-team-record:before{content:\"\";position:absolute;left:calc(50% - 5px);bottom:5px;width:5px;height:5px;border-radius:999px;background:#16a34a;transform:translateX(-50%)}",
      ".mrw-calendar-day.mrw-has-record.mrw-has-team-record{background:linear-gradient(135deg,#eff6ff 0 50%,#f0fdf4 50% 100%)}",
      ".mrw-calendar-day.mrw-selected{border-color:#0f172a;background:#0f172a;color:#fff}",
      ".mrw-calendar-day.mrw-selected:after,.mrw-calendar-day.mrw-selected:before{background:#fff}",
      ".mrw-record-list{display:grid;gap:7px}",
      ".mrw-record-list-title{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#0f172a;font-size:13px;font-weight:950}",
      ".mrw-record-chip{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:9px 10px;text-align:left;color:#0f172a}",
      ".mrw-record-chip:hover{border-color:#94a3b8;background:#f8fafc}",
      ".mrw-team-record-chip{border-color:#bbf7d0;background:#f0fdf4}",
      ".mrw-record-chip-selected{border-color:#0f172a;background:#ecfccb}",
      ".mrw-record-chip-action{min-width:0;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;cursor:pointer}",
      ".mrw-record-chip-action:focus-visible{outline:3px solid rgba(15,23,42,.35);outline-offset:3px;border-radius:10px}",
      ".mrw-record-chip-main{min-width:0}",
      ".mrw-record-date{font-size:13px;font-weight:950}",
      ".mrw-record-sub{margin-top:2px;color:#64748b;font-size:11px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mrw-record-score{border-radius:999px;background:#e2e8f0;color:#0f172a;padding:5px 8px;font-size:11px;font-weight:950;white-space:nowrap}",
      ".mrw-record-delete{white-space:nowrap}",
      ".mrw-team-detail{display:grid;gap:10px;border:1px solid #dbe3ef;border-radius:16px;background:#f8fafc;padding:12px}",
      ".mrw-team-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap}",
      ".mrw-team-detail-title{font-size:13px;font-weight:950;color:#0f172a}",
      ".mrw-team-detail-sub{margin-top:2px;color:#64748b;font-size:11px;font-weight:850}",
      ".mrw-team-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
      ".mrw-team-box{overflow:hidden;border:1px solid #dbe3ef;border-radius:14px;background:#fff}",
      ".mrw-team-box-a{border-color:#84cc16;background:#f7fee7}",
      ".mrw-team-box-b{border-color:#fb923c;background:#fff7ed}",
      ".mrw-team-box-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 10px;font-size:12px;font-weight:950;color:#fff}",
      ".mrw-team-box-a .mrw-team-box-head{background:linear-gradient(135deg,#84cc16,#10b981)}",
      ".mrw-team-box-b .mrw-team-box-head{background:linear-gradient(135deg,#fb923c,#ea580c)}",
      ".mrw-team-box-body{display:grid;gap:7px;padding:9px}",
      ".mrw-team-group{display:grid;gap:4px}",
      ".mrw-team-group-label{font-size:10px;font-weight:950;color:#64748b}",
      ".mrw-team-player-list{display:flex;flex-wrap:wrap;gap:4px}",
      ".mrw-team-player{border:1px solid rgba(15,23,42,.08);border-radius:999px;background:#fff;padding:3px 6px;color:#334155;font-size:10px;font-weight:900}",
      ".mrw-match-info{display:grid;gap:8px;border:1px solid #e2e8f0;border-radius:18px;background:#fff;padding:12px}",
      ".mrw-match-info-title{font-size:13px;font-weight:950;color:#0f172a}",
      ".mrw-modal-foot{display:flex;gap:8px;justify-content:flex-end;background:#fff;border-top:1px solid #e2e8f0;padding:12px 14px}",
      ".mrw-icon-close{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:999px;background:#e2e8f0;color:#334155;font-size:20px;font-weight:950;line-height:1;cursor:pointer}",
      ".mrw-empty{color:#94a3b8;font-size:12px;font-weight:800}",
      "@media(max-width:760px){.mrw-card{padding:14px;border-radius:18px}.mrw-title{font-size:18px}.mrw-meta{grid-template-columns:1fr}.mrw-wide{grid-column:1/-1}.mrw-summary{grid-template-columns:1fr}.mrw-summary-item:last-child{grid-column:auto}.mrw-field{max-width:100%;overflow:hidden}.mrw-field input,.mrw-field select,.mrw-field textarea,.mrw-fixed{min-height:42px;width:100%;max-width:100%;min-width:0;min-inline-size:0}.mrw-field input[type=date],.mrw-field input[type=time]{appearance:none;-webkit-appearance:none;text-align:left}.mrw-mode-head{align-items:stretch}.mrw-scope{width:100%}.mrw-scope select{flex:1}.mrw-layout{grid-template-columns:1fr}.mrw-scoreboard{padding:10px}.mrw-score-num{font-size:40px}.mrw-score-row{grid-template-columns:1fr;gap:10px}.mrw-side{min-height:76px;padding:12px 38px}.mrw-team-name{font-size:12px}.mrw-score-minus{right:6px;top:6px;width:28px;height:28px;font-size:17px}.mrw-stats{grid-template-columns:1fr}.mrw-stat-list{gap:5px}.mrw-stat-row{grid-template-columns:minmax(68px,1fr) auto auto;gap:4px;padding:6px}.mrw-stat-name{font-size:12px;line-height:1.2}.mrw-name{white-space:normal}.mrw-role{padding:1px 5px;font-size:9px}.mrw-player-remove{padding:3px 6px;font-size:9px}.mrw-counter{grid-template-columns:18px 20px 14px 20px;gap:1px;padding:3px;min-width:76px}.mrw-counter-label{font-size:9px;line-height:1}.mrw-counter button{width:20px;height:20px;font-size:12px}.mrw-counter-value{font-size:12px}.mrw-add-team,.mrw-add-player,.mrw-edit-load-row{grid-template-columns:1fr}.mrw-add-team button,.mrw-add-player button,.mrw-edit-load-row button{min-height:38px}.mrw-events{max-height:none}.mrw-actions .mrw-button{flex:1 1 100%}.mrw-record-summary{align-items:stretch;flex-direction:column}.mrw-record-summary-actions{justify-content:stretch}.mrw-record-summary-actions .mrw-small-btn{flex:1 1 auto;min-height:36px}.mrw-record-chip{grid-template-columns:minmax(0,1fr) auto;align-items:stretch}.mrw-record-chip-action{grid-column:1/-1}.mrw-record-sub{white-space:normal}.mrw-record-delete{grid-column:1/-1;width:100%;min-height:38px}.mrw-team-grid{grid-template-columns:1fr}.mrw-modal-backdrop{align-items:flex-end;padding:0}.mrw-modal{width:100%;border-radius:22px 22px 0 0;max-height:84vh}}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function compactDate(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 8);
  }

  function dateInputFromFirebase(value) {
    var digits = compactDate(value);
    if (digits.length !== 8) return "";
    return digits.slice(0, 4) + "-" + digits.slice(4, 6) + "-" + digits.slice(6, 8);
  }

  function todayInputValue() {
    var date = new Date();
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function weekdayLabel(dateValue) {
    var date = new Date(String(dateValue || "") + "T00:00:00");
    if (Number.isNaN(date.getTime())) return "";
    return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  }

  function normalizeDuration(value) {
    return String(Number(value) === 3 ? 3 : 2);
  }

  function addHours(timeValue, hours) {
    var parts = String(timeValue || "20:00").split(":");
    var hour = Number(parts[0]);
    var minute = Number(parts[1] || 0);
    if (!Number.isFinite(hour)) hour = 20;
    if (!Number.isFinite(minute)) minute = 0;
    var total = hour * 60 + minute + Number(hours || 2) * 60;
    return String(Math.floor(total / 60) % 24).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function formatMatchTime(dateValue, startTime, durationHours) {
    var start = startTime || "20:00";
    var day = weekdayLabel(dateValue);
    return start + " ~ " + addHours(start, durationHours) + (day ? " (" + day + ")" : "");
  }

  function startTimeFromMatchTime(value) {
    var match = String(value || "").match(/(\d{1,2}):(\d{2})/);
    if (!match) return "20:00";
    return match[1].padStart(2, "0") + ":" + match[2];
  }

  function durationFromMatchTime(value) {
    var matches = String(value || "").match(/(\d{1,2}):(\d{2})/g);
    if (!matches || matches.length < 2) return "2";
    var start = matches[0].split(":").map(Number);
    var end = matches[1].split(":").map(Number);
    var startMinutes = start[0] * 60 + start[1];
    var endMinutes = end[0] * 60 + end[1];
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return normalizeDuration(Math.round((endMinutes - startMinutes) / 60));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanName(value) {
    return String(value || "")
      .replace(/\b\dQ(?:-GK\d)?\b/g, " ")
      .replace(/\bGK\d\b/g, " ")
      .replace(/(코치|감독|단장)/g, " ")
      .replace(/[·+]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function roleFromText(value) {
    var text = String(value || "");
    if (text.indexOf("단장") >= 0) return "단장";
    if (text.indexOf("감독") >= 0) return "감독";
    if (text.indexOf("코치") >= 0) return "코치";
    return "";
  }

  function playerName(value) {
    var name = cleanName(value);
    rememberRole(name, roleFromText(value));
    rememberKnownRole(name);
    return name;
  }

  function rememberRole(name, role) {
    role = normalizeRole(role);
    if (name && role) state.roles[name] = role;
  }

  function rememberKnownRole(name) {
    if (name && !state.roles[name] && KNOWN_STAFF_ROLES[name]) state.roles[name] = KNOWN_STAFF_ROLES[name];
  }

  function normalizeRole(role) {
    return role === "단장" || role === "감독" || role === "코치" ? role : "";
  }

  function applyStaffRoles(roles) {
    var source = roles && typeof roles === "object" ? roles : {};
    Object.keys(source).forEach(function (rawName) {
      rememberRole(cleanName(rawName), source[rawName] || roleFromText(rawName));
    });
  }

  function staffRolesPayload() {
    var out = {};
    Object.keys(state.roles || {}).forEach(function (name) {
      var role = normalizeRole(state.roles[name]);
      if (name && role) out[name] = role;
    });
    return out;
  }

  function directChipNames(container) {
    if (!container) return [];
    return uniqueNames(Array.prototype.map.call(container.children || [], function (child) {
      var text = child.textContent || "";
      var name = cleanName(text);
      rememberRole(name, roleFromText(text));
      return name;
    }));
  }

  function uniqueNames(values) {
    var seen = Object.create(null);
    var out = [];
    values.forEach(function (value) {
      var name = playerName(value);
      if (!name || name === "없음" || seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
    return out;
  }

  function isVisible(element) {
    return Boolean(element && element.getClientRects && element.getClientRects().length > 0);
  }

  function isInsidePanel(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(node.id === PANEL_ID || (node.closest && node.closest("#" + PANEL_ID)));
  }

  function isPanelControlFocused() {
    var panel = document.getElementById(PANEL_ID);
    var active = document.activeElement;
    if (!panel || !active || !panel.contains(active)) return false;
    return /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName || "");
  }

  function shouldObserveMutation(mutation) {
    if (isInsidePanel(mutation.target)) return false;
    var nodes = Array.prototype.slice.call(mutation.addedNodes || []).concat(Array.prototype.slice.call(mutation.removedNodes || []));
    return nodes.some(function (node) { return node.nodeType !== 1 || !isInsidePanel(node); });
  }

  function hideNativeRecordPanel() {
    Array.prototype.forEach.call(document.querySelectorAll("h3"), function (title) {
      if ((title.textContent || "").trim() !== "경기 기록 저장") return;
      if (title.closest("#" + PANEL_ID)) return;
      var card = title.closest(".border-indigo-200");
      if (card) card.style.display = "none";
    });
  }

  function recordRoot() {
    return document.querySelector("[data-mrw-active='true']");
  }

  function panelMount() {
    var root = recordRoot();
    return (root && root.querySelector("[data-mrw-panel-mount]")) || root;
  }

  function parseQuarterCards() {
    var section = recordRoot();
    if (!section) return [];
    if (hasStandaloneRecordAnchor()) {
      var standaloneRecords = parseStandaloneRecords(section);
      if (standaloneRecords.length > 0) return standaloneRecords;
    }
    var records = [];
    var seen = Object.create(null);
    Array.prototype.forEach.call(section.querySelectorAll("p"), function (titleNode) {
      if (titleNode.closest("[aria-hidden]")) return;
      var text = (titleNode.textContent || "").replace(/\s+/g, " ").trim();
      var match = text.match(/^(형광팀|주황팀)\s*([1-4])Q$/);
      if (!match) return;
      var root = titleNode.parentElement && titleNode.parentElement.parentElement;
      if (!root || !isVisible(root)) return;
      var team = match[1] === "형광팀" ? "A" : "B";
      var quarter = Number(match[2]);
      var key = team + "-" + quarter;
      if (seen[key]) return;
      seen[key] = true;

      var field = root.children && root.children[1];
      var bench = root.children && root.children[2];
      var rowParent = null;
      Array.prototype.some.call((field && field.children) || [], function (child) {
        if (String(child.className || "").indexOf("flex-col") >= 0) {
          rowParent = child;
          return true;
        }
        return false;
      });
      var rows = Array.prototype.slice.call((rowParent && rowParent.children) || []);
      var gkNames = directChipNames(rows[3]);
      records.push({
        quarter: quarter,
        team: team,
        attack: directChipNames(rows[0]),
        mid: directChipNames(rows[1]),
        defense: directChipNames(rows[2]),
        gk: gkNames[0] || "없음",
        bench: directChipNames(bench && bench.children && bench.children[1]),
        warnings: [],
      });
    });
    records.sort(function (a, b) {
      return a.quarter === b.quarter ? a.team.localeCompare(b.team) : a.quarter - b.quarter;
    });
    return records.length > 0 ? records : parseStandaloneRecords(section);
  }

  function hasStandaloneRecordAnchor() {
    var section = recordRoot();
    return Boolean(section && section.getAttribute("data-mrw-standalone") === "true");
  }

  function standaloneData() {
    var section = recordRoot();
    var node = section && section.querySelector("[data-mrw-records]");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}") || {};
    } catch {
      return {};
    }
  }

  function editOnlyMode() {
    return standaloneData().editOnly === true;
  }

  function allowRecordEdit() {
    return standaloneData().allowEdit !== false && !editOnlyMode();
  }

  function canRefreshCurrentLineup() {
    return standaloneData().canRefreshLineup === true && !editOnlyMode() && !state.editingRecordOnly && !state.recordLoading;
  }

  function canEditPlayers() {
    return state.editingRecordOnly || standaloneData().allowPlayerEdit === true;
  }

  function syncStandaloneContext() {
    if (!hasStandaloneRecordAnchor()) {
      if (state.standaloneKey) {
        resetRecordEntryState();
        state.standaloneKey = "";
        removeExistingPanel();
        return true;
      }
      return false;
    }
    var data = standaloneData();
    var nextKey = data.key || "";
    if (nextKey && state.standaloneKey !== nextKey) {
      resetRecordEntryState();
      state.standaloneKey = nextKey;
      removeExistingPanel();
      return true;
    }
    return false;
  }

  function removeExistingPanel() {
    var existing = document.getElementById(PANEL_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function parseStandaloneRecords(section) {
    var data = standaloneData();
    applyStaffRoles(data.staffRoles);
    if (!Array.isArray(data.records)) return [];
    return data.records.map(function (record) {
      var team = record && record.team === "B" ? "B" : "A";
      return {
        quarter: selectedQuarterValue(record && record.quarter) || 1,
        team: team,
        attack: normalizeStandaloneNames(record && record.attack),
        mid: normalizeStandaloneNames(record && record.mid),
        defense: normalizeStandaloneNames(record && record.defense),
        gk: playerName(record && record.gk) || "없음",
        bench: normalizeStandaloneNames(record && record.bench),
        warnings: [],
      };
    }).filter(function (record) {
      return record.attack.length || record.mid.length || record.defense.length || record.bench.length || record.gk !== "없음";
    });
  }

  function normalizeStandaloneNames(value) {
    return uniqueNames(Array.isArray(value) ? value : []);
  }

  function emptyRecord(team) {
    return { team: team, attack: [], mid: [], defense: [], gk: "", bench: [], warnings: [] };
  }

  function teamPlayers(records, team, quarter) {
    return uniqueNames(records
      .filter(function (record) { return record.team === team && (!quarter || !record.quarter || record.quarter === quarter); })
      .reduce(function (acc, record) {
        return acc.concat(record.attack, record.mid, record.defense, record.gk, record.bench);
      }, []));
  }

  function recordPlayers(records) {
    return uniqueNames(records.reduce(function (acc, record) {
      return acc.concat(record.attack || [], record.mid || [], record.defense || [], record.gk || [], record.bench || []);
    }, []));
  }

  function normalizeLoadedPlayers(players) {
    var source = players && typeof players === "object" ? players : {};
    var loaded = {
      A: normalizeLoadedTeam(source.A),
      B: normalizeLoadedTeam(source.B),
    };
    return loaded.A.length || loaded.B.length ? loaded : null;
  }

  function normalizeLoadedTeam(players) {
    return uniqueNames((Array.isArray(players) ? players : []).map(function (value) {
      return loadedPlayerName(value);
    }));
  }

  function loadedPlayerName(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      var rawName = value.Name || value.name || value.PlayerName || value.playerName || "";
      rememberRole(cleanName(rawName), value.staffRole || value.StaffRole || value.role || value.Role || roleFromText(rawName));
      return rawName;
    }
    return "";
  }

  function registeredPlayerOptions() {
    var data = standaloneData();
    return uniqueNames(Array.isArray(data.playerOptions) ? data.playerOptions : []);
  }

  function registeredPlayerLookup() {
    var lookup = Object.create(null);
    registeredPlayerOptions().forEach(function (name) {
      lookup[playerName(name)] = name;
    });
    return lookup;
  }

  function registeredPlayerName(rawName) {
    var name = playerName(rawName);
    if (!name) return "";
    return registeredPlayerLookup()[name] || "";
  }

  function registeredPlayerError(name) {
    return name + " 선수는 선수 명단에 없습니다. 이름을 확인하세요.";
  }

  function playerSearchOptions(records, team) {
    var currentTeamPlayers = teamPlayers(records, team);
    var currentLookup = Object.create(null);
    currentTeamPlayers.forEach(function (name) { currentLookup[name] = true; });
    return registeredPlayerOptions().filter(function (name) { return !currentLookup[name]; }).sort(function (a, b) {
      return a.localeCompare(b, "ko");
    });
  }

  function displayRecords(fallbackRecords) {
    if (state.currentLineupOverride) return fallbackRecords;
    if (state.editingRecordOnly) {
      var loaded = state.loadedPlayers || emptyLoadedPlayers();
      return ["A", "B"].map(function (team) {
        return {
          team: team,
          attack: loaded[team] || [],
          mid: [],
          defense: [],
          gk: "",
          bench: [],
          warnings: [],
        };
      });
    }
    if (!state.loadedPlayers) return fallbackRecords;
    return ["A", "B"].map(function (team) {
      return {
        team: team,
        attack: state.loadedPlayers[team] || [],
        mid: [],
        defense: [],
        gk: "",
        bench: [],
        warnings: [],
      };
    });
  }

  function payloadRecords(fallbackRecords) {
    if (state.currentLineupOverride) return fallbackRecords;
    if (state.editingRecordOnly) {
      var loaded = state.loadedPlayers || emptyLoadedPlayers();
      return ["A", "B"].map(function (team) {
        return {
          quarter: 1,
          team: team,
          attack: loaded[team] || [],
          mid: [],
          defense: [],
          gk: "없음",
          bench: [],
          warnings: [],
        };
      });
    }
    if (!state.loadedPlayers) return fallbackRecords;
    return ["A", "B"].map(function (team) {
      return {
        quarter: 1,
        team: team,
        attack: state.loadedPlayers[team] || [],
        mid: [],
        defense: [],
        gk: "?놁쓬",
        bench: [],
        warnings: [],
      };
    });
  }

  function scoreKey(team, quarter) {
    return team + "|" + (quarter || "");
  }

  function statKey(team, player, quarter) {
    return team + "|" + (quarter || "") + "|" + player;
  }

  function selectedQuarter() {
    var quarter = Number(state.selectedScope);
    return quarter === 1 || quarter === 2 || quarter === 3 || quarter === 4 ? quarter : undefined;
  }

  function scopeLabel(quarter) {
    return quarter ? quarter + "Q" : "경기 전체";
  }

  function setTeamScore(team, delta, quarter) {
    var key = scoreKey(team, quarter);
    var current = state.teamScores[key] || { team: team, goals: 0, quarter: quarter };
    current.goals = Math.max(0, Math.min(20, current.goals + delta));
    if (current.goals > 0) state.teamScores[key] = current;
    else delete state.teamScores[key];
    state.conflict = null;
    state.status = "";
    renderPanel();
  }

  function removeTeamScore(team, quarter) {
    delete state.teamScores[scoreKey(team, quarter)];
    state.status = "";
    renderPanel();
  }

  function setSummaryStat(team, player, field, delta, quarter) {
    player = playerName(player);
    if (!player) return;
    var key = statKey(team, player, quarter);
    var current = state.summaryStats[key] || { team: team, player: player, goals: 0, assists: 0, quarter: quarter };
    current[field] = Math.max(0, Math.min(20, (Number(current[field]) || 0) + delta));
    if (current.goals > 0 || current.assists > 0) state.summaryStats[key] = current;
    else delete state.summaryStats[key];
    state.conflict = null;
    state.status = "";
    renderPanel();
  }

  function removeSummaryStat(team, player, quarter) {
    player = playerName(player);
    delete state.summaryStats[statKey(team, player, quarter)];
    state.status = "";
    renderPanel();
  }

  function teamScoresArray() {
    return Object.keys(state.teamScores).map(function (key) { return state.teamScores[key]; });
  }

  function summaryStatsArray() {
    return Object.keys(state.summaryStats).map(function (key) { return state.summaryStats[key]; });
  }

  function invalidRecordPlayerNames(records, stats, events) {
    var lookup = registeredPlayerLookup();
    var invalid = [];
    function add(rawName) {
      var name = playerName(rawName);
      if (!name || name === "없음" || name === "?놁쓬" || name === "??곸벉") return;
      if (!lookup[name] && invalid.indexOf(name) < 0) invalid.push(name);
    }
    (Array.isArray(records) ? records : []).forEach(function (record) {
      (record.attack || []).forEach(add);
      (record.mid || []).forEach(add);
      (record.defense || []).forEach(add);
      add(record.gk);
      (record.bench || []).forEach(add);
    });
    (Array.isArray(stats) ? stats : []).forEach(function (stat) {
      add(stat && stat.player);
    });
    (Array.isArray(events) ? events : []).forEach(function (event) {
      add(event && event.scorer);
      add(event && event.assist);
    });
    return invalid;
  }

  function assertRegisteredRecordPlayers(records, stats, events) {
    var invalid = invalidRecordPlayerNames(records, stats, events);
    if (invalid.length > 0) {
      throw new Error("선수 명단에 없는 이름이 있습니다: " + invalid.join(", ") + "\n선수 검색에서 등록된 이름을 선택해주세요.");
    }
  }

  function hasEnteredRecordItems() {
    return teamScoresArray().length > 0 || summaryStatsArray().length > 0 || state.events.length > 0;
  }

  function teamScoreSummary() {
    return teamScoresArray().reduce(function (acc, score) {
      acc[score.team] += Number(score.goals) || 0;
      return acc;
    }, { A: 0, B: 0 });
  }

  function statTotals(team, quarter) {
    return summaryStatsArray()
      .filter(function (stat) { return stat.team === team && (quarter === undefined || stat.quarter === quarter); })
      .reduce(function (acc, stat) {
        acc.goals += Number(stat.goals) || 0;
        acc.assists += Number(stat.assists) || 0;
        return acc;
      }, { goals: 0, assists: 0 });
  }

  function setSummaryStatsFromArray(stats) {
    state.summaryStats = Object.create(null);
    (Array.isArray(stats) ? stats : []).forEach(function (stat) {
      if (!stat || !stat.player || (stat.team !== "A" && stat.team !== "B")) return;
      var player = playerName(stat.player);
      var quarter = selectedQuarterValue(stat.quarter);
      var goals = clampCount(stat.goals);
      var assists = clampCount(stat.assists);
      if (!player || (goals <= 0 && assists <= 0)) return;
      state.summaryStats[statKey(stat.team, player, quarter)] = {
        team: stat.team,
        player: player,
        goals: goals,
        assists: assists,
        quarter: quarter,
      };
    });
  }

  function setTeamScoresFromArray(scores, override) {
    state.teamScores = Object.create(null);
    (Array.isArray(scores) ? scores : []).forEach(function (score) {
      if (!score || (score.team !== "A" && score.team !== "B")) return;
      var goals = clampCount(score.goals);
      if (goals <= 0) return;
      var quarter = selectedQuarterValue(score.quarter);
      state.teamScores[scoreKey(score.team, quarter)] = { team: score.team, goals: goals, quarter: quarter };
    });
    if (teamScoresArray().length === 0 && override) {
      ["A", "B"].forEach(function (team) {
        var goals = clampCount(override[team]);
        if (goals > 0) state.teamScores[scoreKey(team)] = { team: team, goals: goals };
      });
    }
  }

  function emptyLoadedPlayers() {
    return { A: [], B: [] };
  }

  function loadedPlayersFromRecords(records) {
    return {
      A: teamPlayers(records, "A"),
      B: teamPlayers(records, "B"),
    };
  }

  function ensureLoadedPlayers() {
    if (!state.loadedPlayers) state.loadedPlayers = emptyLoadedPlayers();
    if (!Array.isArray(state.loadedPlayers.A)) state.loadedPlayers.A = [];
    if (!Array.isArray(state.loadedPlayers.B)) state.loadedPlayers.B = [];
    return state.loadedPlayers;
  }

  function ensureLoadedPlayersFromCurrent() {
    if (!state.loadedPlayers) state.loadedPlayers = loadedPlayersFromRecords(parseQuarterCards());
    return ensureLoadedPlayers();
  }

  function addLoadedPlayer(team, rawName) {
    var typedName = playerName(rawName);
    var name = registeredPlayerName(rawName);
    if (!typedName || (team !== "A" && team !== "B")) return;
    if (!name) {
      state.status = registeredPlayerError(typedName);
      renderPanel();
      return;
    }
    var loaded = ensureLoadedPlayersFromCurrent();
    loaded[team] = uniqueNames((loaded[team] || []).concat(name));
    state.currentLineupOverride = false;
    state.status = name + " 선수를 " + teamLabel(team) + "에 추가했습니다.";
    renderPanel();
  }

  function removeLoadedPlayer(team, rawName) {
    var name = playerName(rawName);
    if (!name || (team !== "A" && team !== "B")) return;
    var loaded = ensureLoadedPlayersFromCurrent();
    loaded[team] = (loaded[team] || []).filter(function (player) { return playerName(player) !== name; });
    Object.keys(state.summaryStats).forEach(function (key) {
      var stat = state.summaryStats[key];
      if (stat && stat.team === team && playerName(stat.player) === name) delete state.summaryStats[key];
    });
    state.events = state.events.filter(function (event) {
      return !(event && event.team === team && (playerName(event.scorer) === name || playerName(event.assist) === name));
    });
    state.currentLineupOverride = false;
    state.status = name + " 선수를 제외했습니다.";
    renderPanel();
  }

  function resetRecordEntryState() {
    state.events = [];
    state.summaryStats = Object.create(null);
    state.teamScores = Object.create(null);
    state.conflict = null;
    state.loadedRecord = null;
    state.loadedPlayers = null;
    state.loadedForm = null;
    state.editingRecordOnly = false;
    state.currentLineupOverride = false;
    state.recordLoading = false;
    state.editingMatchId = "";
    state.selectedScope = "";
    state.calendarMonth = (state.editDate || todayInputValue()).slice(0, 7);
    state.selectedTeamRecord = null;
    state.selectedTeamRecordLoading = false;
    state.selectedTeamRecordError = "";
  }

  function emptyFormForMatch(matchId) {
    var date = dateInputFromFirebase(matchId) || state.editDate || todayInputValue();
    return {
      date: date,
      matchId: matchId || compactDate(date),
      startTime: "20:00",
      duration: "2",
      matchKind: state.matchKind === "MATCH" ? "MATCH" : "SELF",
      venueName: preferredVenue(),
      awayTeamName: state.matchKind === "MATCH" ? firstAwayTeam() : "",
      memo: "",
    };
  }

  function resetToEmptyMatch(matchId, status, editingRecordOnly) {
    resetRecordEntryState();
    state.editingRecordOnly = Boolean(editingRecordOnly);
    if (state.editingRecordOnly) state.loadedPlayers = emptyLoadedPlayers();
    state.loadedForm = emptyFormForMatch(matchId);
    state.matchKind = state.loadedForm.matchKind;
    state.editModalOpen = false;
    state.status = status;
    removeExistingPanel();
    renderPanel();
  }

  function selectedQuarterValue(value) {
    var quarter = Number(value);
    return quarter === 1 || quarter === 2 || quarter === 3 || quarter === 4 ? quarter : undefined;
  }

  function clampCount(value) {
    var count = Math.floor(Number(value));
    if (!Number.isFinite(count) || count < 0) return 0;
    return Math.min(count, 20);
  }

  function preferredVenue() {
    var names = state.options.stadiums.map(function (stadium) { return stadium.name; }).filter(Boolean);
    return names.indexOf(DEFAULT_VENUE) >= 0 ? DEFAULT_VENUE : (names[0] || DEFAULT_VENUE);
  }

  async function loadOptions() {
    if (state.options.loaded) return;
    try {
      var response = await fetch("/api/match-record-options", { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.detail || data.error || "경기 옵션을 불러오지 못했습니다.");
      state.options = {
        loaded: true,
        stadiums: Array.isArray(data.stadiums) ? data.stadiums : [],
        teams: Array.isArray(data.teams) ? data.teams : [],
        error: "",
      };
    } catch (error) {
      state.options = { loaded: true, stadiums: [], teams: [], error: error && error.message ? error.message : String(error) };
    }
    renderPanel();
  }

  async function loadRecordIndex(force) {
    if (state.recordIndex.loading) return;
    if (state.recordIndex.loaded && !force) return;
    state.recordIndex = {
      loaded: false,
      loading: true,
      error: "",
      teamError: "",
      items: state.recordIndex.items || [],
      teamItems: state.recordIndex.teamItems || [],
    };
    renderPanel();
    var matchItems = [];
    var teamItems = [];
    var matchError = "";
    var teamError = "";
    try {
      var response = await fetch("/api/match-record?list=1&limit=240", { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.detail || data.error || "기록 목록을 불러오지 못했습니다.");
      matchItems = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      matchError = error && error.message ? error.message : String(error);
    }
    try {
      var teamResponse = await fetch("/api/team-records", { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
      var teamData = await teamResponse.json().catch(function () { return {}; });
      if (!teamResponse.ok) throw new Error(teamData.detail || teamData.error || "팀 확정 기록을 불러오지 못했습니다.");
      teamItems = Array.isArray(teamData.records) ? teamData.records : [];
    } catch (error) {
      teamError = error && error.message ? error.message : String(error);
    }
    state.recordIndex = {
      loaded: true,
      loading: false,
      error: matchError,
      teamError: teamError,
      items: matchItems,
      teamItems: teamItems,
    };
    renderPanel();
  }

  async function addAwayTeamFromPanel() {
    var panel = document.getElementById(PANEL_ID);
    var input = panel && panel.querySelector("[data-mrw=newAwayTeam]");
    var name = input ? input.value.trim() : "";
    if (!name) {
      state.status = "추가할 상대팀 이름을 입력해주세요.";
      renderPanel();
      return;
    }
    try {
      state.status = "상대팀을 추가하는 중...";
      renderPanel();
      var response = await fetch("/api/match-record-options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "team", name: name }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.detail || data.error || "상대팀 추가에 실패했습니다.");
      if (!state.options.teams.some(function (team) { return team.name === name; })) {
        state.options.teams.push({ name: name });
        state.options.teams.sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
      }
      state.status = "상대팀을 추가했습니다.";
      renderPanel();
      var next = document.getElementById(PANEL_ID);
      var select = next && next.querySelector("[data-mrw=awayTeam]");
      if (select) {
        select.value = name;
        state.loadedForm = Object.assign({}, state.loadedForm || formState(next), { matchKind: "MATCH", awayTeamName: name });
        setTeamLabels(state.loadedForm);
      }
    } catch (error) {
      state.status = error && error.message ? error.message : String(error);
      renderPanel();
    }
  }

  function formState(existing) {
    var loaded = state.loadedForm || {};
    var standalone = standaloneData();
    var dateValue = valueOf(existing, "date", todayInputValue());
    var duration = normalizeDuration(valueOf(existing, "duration", loaded.duration || "2"));
    var defaultKind = standalone.matchKind === "MATCH" ? "MATCH" : state.matchKind;
    var kind = valueOf(existing, "matchKind", loaded.matchKind || defaultKind) === "MATCH" ? "MATCH" : "SELF";
    state.matchKind = kind;
    return {
      date: valueOf(existing, "date", loaded.date || dateValue),
      matchId: valueOf(existing, "matchId", loaded.matchId || compactDate(dateValue)),
      startTime: valueOf(existing, "startTime", loaded.startTime || "20:00"),
      duration: duration,
      matchKind: valueOf(existing, "matchKind", loaded.matchKind || kind) === "MATCH" ? "MATCH" : "SELF",
      venueName: valueOf(existing, "venueName", loaded.venueName || standalone.venueName || preferredVenue()),
      awayTeamName: valueOf(existing, "awayTeam", loaded.awayTeamName || standalone.awayTeamName || ""),
      memo: valueOf(existing, "memo", loaded.memo || ""),
    };
  }

  function valueOf(panel, key, fallback) {
    if (panel && typeof panel.querySelector !== "function" && typeof panel === "object") {
      var rawValue = panel[key];
      return typeof rawValue === "string" ? rawValue : fallback;
    }
    var element = panel && panel.querySelector("[data-mrw=" + key + "]");
    if (!element) return fallback;
    return typeof element.value === "string" ? element.value : (element.textContent || fallback);
  }

  function setTeamLabels(form) {
    state.teamLabels = form.matchKind === "MATCH"
      ? { A: form.awayTeamName || firstAwayTeam(), B: "DevUtd" }
      : { A: TEAM_LABELS.A, B: TEAM_LABELS.B };
  }

  function teamLabel(team) {
    return (state.teamLabels && state.teamLabels[team]) || TEAM_LABELS[team];
  }

  function scoreboardTeamLabel(team) {
    return teamLabel(team);
  }

  function renderPanelHead(editOnly) {
    var action = allowRecordEdit()
      ? "<button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"open-edit-modal\">기록 수정</button>"
      : "";
    var title = editOnly ? "기록 수정" : "경기 기록";
    var help = editOnly
      ? "날짜로 저장된 기록을 불러와 스코어, 구성원, 개인 골/도움을 수정합니다."
      : "팀 점수는 점수판을 눌러 올리고, 개인 골/도움은 선수별로 필요한 만큼만 입력합니다.";
    return "<div class=\"mrw-head\"><div><h3 class=\"mrw-title\">" + title + "</h3><p class=\"mrw-help\">" + help + "</p></div>" + action + "</div>";
  }

  function renderEditOnlyLoader(form) {
    var title = state.editingRecordOnly ? "다른 날짜 선택" : "날짜 선택";
    var help = state.editingRecordOnly
      ? "달력에서 다른 날짜를 누르면 그 날짜의 저장 기록이나 기록 미입력 팀분배를 불러옵니다."
      : "달력에 표시된 날짜를 눌러 저장된 기록을 수정하거나, 기록 미입력 팀분배를 불러옵니다.";
    return [
      "<div class=\"mrw-mode mrw-edit-load\"><div class=\"mrw-mode-head\"><div><div class=\"mrw-mode-title\">" + title + "</div><div class=\"mrw-mode-help\">" + help + "</div></div></div>",
      renderRecordOverview(form),
      "</div>",
    ].join("");
  }

  function renderPanel() {
    syncStandaloneContext();
    var lineupRecords = parseQuarterCards();
    var records = displayRecords(lineupRecords);
    if (records.length === 0 && hasStandaloneRecordAnchor()) records = [emptyRecord("A"), emptyRecord("B")];
    if (records.length === 0) return;

    installStyle();
    hideNativeRecordPanel();
    var existing = document.getElementById(PANEL_ID);
    var form = formState(existing);
    setTeamLabels(form);
    var editOnly = editOnlyMode();
    var quarter = selectedQuarter();
    var score = teamScoreSummary();
    var refreshAction = canRefreshCurrentLineup()
      ? "<button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"refresh-lineup\">라인업 갱신</button>"
      : "";
    var deleteAction = state.editingMatchId || selectedTeamRecordDate()
      ? "<button type=\"button\" class=\"mrw-button mrw-danger\" data-mrw-action=\"delete-record\">삭제</button>"
      : "";

    var panel = existing || document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "mrw-card";
    if (editOnly && !state.editingRecordOnly && !state.recordLoading) {
      panel.innerHTML = [
        renderPanelHead(true),
        "<input type=\"hidden\" data-mrw=\"date\" value=\"" + escapeHtml(form.date) + "\" />",
        "<input type=\"hidden\" data-mrw=\"matchId\" value=\"" + escapeHtml(form.matchId || compactDate(form.date)) + "\" />",
        "<input type=\"hidden\" data-mrw=\"duration\" value=\"" + escapeHtml(form.duration) + "\" />",
        "<input type=\"hidden\" data-mrw=\"matchKind\" value=\"" + escapeHtml(form.matchKind) + "\" />",
        renderEditOnlyLoader(form),
        state.status ? "<div class=\"mrw-status\">" + escapeHtml(state.status) + "</div>" : "",
      ].join("");
      if (!existing) {
        var editMount = panelMount();
        if (editMount) editMount.appendChild(panel);
      }
      bindPanel(panel);
      loadRecordIndex(false);
      return;
    }
    panel.innerHTML = [
      renderPanelHead(editOnly),
      "<input type=\"hidden\" data-mrw=\"matchId\" value=\"" + escapeHtml(form.matchId || compactDate(form.date)) + "\" />",
      "<input type=\"hidden\" data-mrw=\"duration\" value=\"" + escapeHtml(form.duration) + "\" />",
      "<input type=\"hidden\" data-mrw=\"matchKind\" value=\"" + escapeHtml(form.matchKind) + "\" />",
      editOnly ? renderEditOnlyLoader(form) : "",
      renderMatchInfo(form),
      "<div class=\"mrw-mode\"><div class=\"mrw-mode-head\"><div><div class=\"mrw-mode-title\">기록 입력</div><div class=\"mrw-mode-help\">경기 전체로 입력해도 되고, 기억나는 경우만 1Q~4Q를 골라 쿼터 기록으로 남기면 됩니다.</div></div><label class=\"mrw-scope\">기록 기준 " + renderScopeSelect(quarter) + "</label></div></div>",
      "<div class=\"mrw-layout\"><div class=\"mrw-main\">",
      renderScoreboard(score, quarter),
      renderStatTeams(records, quarter),
      "</div>",
      renderRecentLog(score),
      "</div>",
      "<div class=\"mrw-actions\"><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"preview\">기록 확인</button><button type=\"button\" class=\"mrw-button mrw-primary\" data-mrw-action=\"save\">기록 저장</button>" + refreshAction + deleteAction + "</div>",
      state.status ? "<div class=\"mrw-status\">" + escapeHtml(state.status) + "</div>" : "",
      state.editModalOpen ? renderEditModal(form) : "",
    ].join("");

    if (!existing) {
      var mount = panelMount();
      if (mount) mount.appendChild(panel);
    }
    bindPanel(panel);
    if (state.editModalOpen) loadRecordIndex(false);
  }

  function renderMatchInfo(form) {
    return "<div class=\"mrw-match-info\"><div class=\"mrw-match-info-title\">경기 정보</div>" + renderMeta(form) + "</div>";
  }

  function renderMeta(form) {
    var home = form.matchKind === "SELF" ? "DevUtd 주황" : "DevUtd";
    var away = form.matchKind === "SELF" ? "DevUtd 형광" : (form.awayTeamName || firstAwayTeam());
    var dateField = editOnlyMode()
      ? fixedInputField("선택 날짜", "date", form.date)
      : fieldInput("경기일", "date", "date", form.date, state.editingRecordOnly);
    return [
      "<div class=\"mrw-meta\">",
      dateField,
      renderMatchKindControl(form.matchKind),
      fieldInput("시작 시간", "startTime", "time", form.startTime || "20:00"),
      "<div class=\"mrw-field\"><label>경기 시간</label><div class=\"mrw-duration\"><button type=\"button\" data-mrw-duration=\"2\" aria-pressed=\"" + (form.duration === "2") + "\">2시간</button><button type=\"button\" data-mrw-duration=\"3\" aria-pressed=\"" + (form.duration === "3") + "\">3시간</button></div></div>",
      renderVenueSelect(form.venueName),
      "<div class=\"mrw-field\"><label>홈팀</label><div class=\"mrw-fixed\" data-mrw=\"homeTeamName\">" + escapeHtml(home) + "</div></div>",
      renderAwayControl(form.matchKind, away),
      renderMetaSummary(form, home, away),
      "</div>",
    ].join("");
  }

  function renderMatchKindControl(matchKind) {
    return "<div class=\"mrw-field\"><label>경기 구분</label><div class=\"mrw-segment\"><button type=\"button\" data-mrw-kind=\"SELF\" aria-pressed=\"" + (matchKind === "SELF") + "\">자체전</button><button type=\"button\" data-mrw-kind=\"MATCH\" aria-pressed=\"" + (matchKind === "MATCH") + "\">A매치</button></div></div>";
  }

  function fieldInput(label, key, type, value, readonly) {
    return "<div class=\"mrw-field\"><label>" + label + "</label><input data-mrw=\"" + key + "\" type=\"" + type + "\" value=\"" + escapeHtml(value) + "\"" + (readonly ? " readonly" : "") + " /></div>";
  }

  function fixedInputField(label, key, value) {
    return "<div class=\"mrw-field\"><label>" + label + "</label><input data-mrw=\"" + key + "\" type=\"hidden\" value=\"" + escapeHtml(value) + "\" /><div class=\"mrw-fixed\">" + escapeHtml(value) + "</div></div>";
  }

  function renderVenueSelect(selected) {
    var names = uniqueNames([selected || preferredVenue()].concat(state.options.stadiums.map(function (stadium) { return stadium.name; })));
    return "<div class=\"mrw-field\"><label>구장</label><select data-mrw=\"venueName\">" + names.map(function (name) {
      return "<option value=\"" + escapeHtml(name) + "\"" + (name === selected ? " selected" : "") + ">" + escapeHtml(name) + "</option>";
    }).join("") + "</select></div>";
  }

  function firstAwayTeam() {
    var team = state.options.teams.find(function (item) { return item.name && item.name !== "DevUtd"; });
    return team ? team.name : "상대팀";
  }

  function renderAwayControl(matchKind, selected) {
    if (matchKind === "SELF") {
      return "<div class=\"mrw-field\"><label>원정팀</label><div class=\"mrw-fixed\" data-mrw=\"awayTeam\">" + escapeHtml(selected) + "</div></div>";
    }
    var names = uniqueNames([selected || firstAwayTeam()].concat(state.options.teams.map(function (team) { return team.name; }))).filter(function (name) { return name !== "DevUtd"; });
    return [
      "<div class=\"mrw-field\"><label>상대팀</label><select data-mrw=\"awayTeam\">",
      names.map(function (name) { return "<option value=\"" + escapeHtml(name) + "\"" + (name === selected ? " selected" : "") + ">" + escapeHtml(name) + "</option>"; }).join(""),
      "</select></div>",
      "<div class=\"mrw-field\"><label>상대팀 추가</label><div class=\"mrw-add-team\"><input data-mrw=\"newAwayTeam\" type=\"text\" placeholder=\"팀 이름\" /><button type=\"button\" data-mrw-action=\"add-team\">추가</button></div></div>",
    ].join("");
  }

  function renderMetaSummary(form, home, away) {
    var time = formatMatchTime(form.date, form.startTime, form.duration);
    return "<div class=\"mrw-summary\">" + [
      summaryItem("기록 키", compactDate(form.date)),
      summaryItem("시간", time),
      summaryItem("구장", form.venueName || preferredVenue()),
      summaryItem("대진", away + " vs " + home),
    ].join("") + "</div>";
  }

  function summaryItem(label, value) {
    return "<div class=\"mrw-summary-item\"><div class=\"mrw-summary-label\">" + label + "</div><div class=\"mrw-summary-value\">" + escapeHtml(value) + "</div></div>";
  }

  function renderScopeSelect(quarter) {
    var options = [{ value: "", label: "경기 전체" }, { value: "1", label: "1Q" }, { value: "2", label: "2Q" }, { value: "3", label: "3Q" }, { value: "4", label: "4Q" }];
    return "<select data-mrw=\"scope\">" + options.map(function (option) {
      return "<option value=\"" + option.value + "\"" + (String(quarter || "") === option.value ? " selected" : "") + ">" + option.label + "</option>";
    }).join("") + "</select>";
  }

  function renderScoreboard(score, quarter) {
    return [
      "<div class=\"mrw-scoreboard\"><div class=\"mrw-score-row\">",
      scoreButton("A", score.A, quarter),
      scoreButton("B", score.B, quarter),
      "</div></div>",
    ].join("");
  }

  function scoreButton(team, goals, quarter) {
    return "<div class=\"mrw-side-wrap\"><button type=\"button\" class=\"mrw-side mrw-side-" + team.toLowerCase() + "\" data-mrw-score-team=\"" + team + "\" data-mrw-score-adjust=\"1\"><span class=\"mrw-team-name\">" + scoreboardTeamLabel(team) + "</span><span class=\"mrw-score-num\">" + goals + "</span></button><button type=\"button\" class=\"mrw-score-minus\" data-mrw-score-team=\"" + team + "\" data-mrw-score-adjust=\"-1\" aria-label=\"" + scoreboardTeamLabel(team) + " 1점 빼기\">-</button></div>";
  }

  function renderStatTeams(records, quarter) {
    return "<div class=\"mrw-stats\">" + renderStatTeam(records, "A", quarter) + renderStatTeam(records, "B", quarter) + "</div>";
  }

  function renderStatTeam(records, team, quarter) {
    var players = teamPlayers(records, team, quarter).sort(function (a, b) {
      return a.localeCompare(b, "ko");
    });
    var totals = statTotals(team, quarter);
    return [
      "<div class=\"mrw-stat-team\"><div class=\"mrw-stat-team-title\"><span>" + teamLabel(team) + "</span><span class=\"mrw-stat-total\">골 " + totals.goals + " · 도움 " + totals.assists + "</span></div>",
      "<div class=\"mrw-stat-list\">",
      players.length ? players.map(function (player) { return renderPlayerStat(team, player, quarter); }).join("") : "<div class=\"mrw-empty\">선수 정보 없음</div>",
      "</div>",
      renderAddPlayer(team, playerSearchOptions(records, team)),
      "</div>",
    ].join("");
  }

  function renderPlayerStat(team, player, quarter) {
    player = playerName(player);
    var stat = state.summaryStats[statKey(team, player, quarter)] || { goals: 0, assists: 0 };
    var remove = canEditPlayers()
      ? "<button type=\"button\" class=\"mrw-player-remove\" data-mrw-remove-player-team=\"" + team + "\" data-mrw-remove-player=\"" + escapeHtml(player) + "\">제외</button>"
      : "";
    return [
      "<div class=\"mrw-stat-row\"><div class=\"mrw-stat-name\"><span class=\"mrw-name\">" + escapeHtml(player) + "</span>" + renderRole(player) + remove + "</div>",
      renderCounter(team, player, "goals", "골", stat.goals, quarter),
      renderCounter(team, player, "assists", "도움", stat.assists, quarter),
      "</div>",
    ].join("");
  }

  function renderAddPlayer(team, options) {
    if (!canEditPlayers() || state.recordLoading) return "";
    var listId = "mrw-player-options-" + team;
    var datalist = (options || []).length > 0
      ? "<datalist id=\"" + listId + "\">" + options.map(function (name) { return "<option value=\"" + escapeHtml(name) + "\"></option>"; }).join("") + "</datalist>"
      : "";
    return "<div class=\"mrw-add-player\"><input data-mrw-add-player-name=\"" + team + "\" type=\"text\" list=\"" + listId + "\" autocomplete=\"off\" placeholder=\"" + teamLabel(team) + " 등록 선수 검색/추가\" /><button type=\"button\" data-mrw-add-player-team=\"" + team + "\">추가</button>" + datalist + "</div>";
  }

  function renderRole(player) {
    var role = state.roles[player] || KNOWN_STAFF_ROLES[player];
    if (!role) return "";
    var cls = role === "감독" ? "mrw-role-manager" : role === "단장" ? "mrw-role-director" : "mrw-role-coach";
    return "<span class=\"mrw-role " + cls + "\">" + role + "</span>";
  }

  function renderCounter(team, player, field, label, value, quarter) {
    return "<div class=\"mrw-counter\"><span class=\"mrw-counter-label\">" + label + "</span><button type=\"button\" data-mrw-summary-team=\"" + team + "\" data-mrw-summary-player=\"" + escapeHtml(player) + "\" data-mrw-summary-field=\"" + field + "\" data-mrw-summary-adjust=\"-1\">-</button><span class=\"mrw-counter-value\">" + (value || 0) + "</span><button type=\"button\" data-mrw-summary-team=\"" + team + "\" data-mrw-summary-player=\"" + escapeHtml(player) + "\" data-mrw-summary-field=\"" + field + "\" data-mrw-summary-adjust=\"1\">+</button></div>";
  }

  function renderRecentLog(score) {
    var items = [];
    teamScoresArray().forEach(function (entry) {
      items.push({ type: "score", team: entry.team, quarter: entry.quarter, title: scoreboardTeamLabel(entry.team) + " 스코어", sub: scopeLabel(entry.quarter) + " · 골 " + entry.goals });
    });
    summaryStatsArray().forEach(function (entry) {
      var parts = [];
      if (entry.goals > 0) parts.push("골 " + entry.goals);
      if (entry.assists > 0) parts.push("도움 " + entry.assists);
      var player = playerName(entry.player);
      items.push({ type: "stat", team: entry.team, player: player, quarter: entry.quarter, title: teamLabel(entry.team) + " · " + player, sub: scopeLabel(entry.quarter) + " · " + parts.join(" · ") });
    });
    state.events.forEach(function (event, index) {
      items.push({ type: "event", index: index, title: teamLabel(event.team) + " · " + event.scorer, sub: scopeLabel(event.quarter) + " · 골 1" + (event.assist ? " · 도움 " + event.assist : "") });
    });

    return [
      "<div class=\"mrw-log\"><div class=\"mrw-log-head\"><div class=\"mrw-log-title\">최근 기록</div><div class=\"mrw-log-score\">" + teamLabel("A") + " " + score.A + " : " + score.B + " " + teamLabel("B") + "</div></div>",
      "<div class=\"mrw-events\">",
      items.length ? items.map(renderLogItem).join("") : "<div class=\"mrw-empty\">아직 입력한 기록이 없습니다.</div>",
      "</div></div>",
    ].join("");
  }

  function renderLogItem(item) {
    var edit = "";
    var remove = "";
    if (item.type === "score") {
      remove = "<button type=\"button\" class=\"mrw-small-btn mrw-small-danger\" data-mrw-remove-score-team=\"" + item.team + "\" data-mrw-remove-score-quarter=\"" + (item.quarter || "") + "\">삭제</button>";
    } else if (item.type === "stat") {
      remove = "<button type=\"button\" class=\"mrw-small-btn mrw-small-danger\" data-mrw-remove-stat-team=\"" + item.team + "\" data-mrw-remove-stat-player=\"" + escapeHtml(item.player) + "\" data-mrw-remove-stat-quarter=\"" + (item.quarter || "") + "\">삭제</button>";
    } else {
      remove = "<button type=\"button\" class=\"mrw-small-btn mrw-small-danger\" data-mrw-remove-event=\"" + item.index + "\">삭제</button>";
    }
    return "<div class=\"mrw-event\"><div class=\"mrw-event-main\"><div><div class=\"mrw-event-text\">" + escapeHtml(item.title) + "</div><div class=\"mrw-event-sub\">" + escapeHtml(item.sub) + "</div></div></div><div class=\"mrw-event-actions\">" + edit + remove + "</div></div>";
  }

  function recordItems() {
    var items = Array.isArray(state.recordIndex.items) ? state.recordIndex.items : [];
    return items.slice().sort(function (a, b) {
      return compactDate(b.matchDate || b.matchId).localeCompare(compactDate(a.matchDate || a.matchId));
    });
  }

  function recordDateInput(item) {
    return dateInputFromFirebase((item && (item.matchDate || item.matchId)) || "");
  }

  function recordDateLabel(value) {
    var date = dateInputFromFirebase(value) || String(value || "");
    if (!date || date.length < 10) return String(value || "");
    return date.slice(0, 4) + "." + Number(date.slice(5, 7)) + "." + Number(date.slice(8, 10)) + ".";
  }

  function monthInputValue(value) {
    var date = String(value || "");
    return /^\d{4}-\d{2}$/.test(date) ? date : todayInputValue().slice(0, 7);
  }

  function addCalendarMonths(monthKey, delta) {
    monthKey = monthInputValue(monthKey);
    var parts = monthKey.split("-").map(Number);
    var date = new Date(parts[0], parts[1] - 1 + Number(delta || 0), 1);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function setCalendarMonth(delta) {
    state.calendarMonth = addCalendarMonths(state.calendarMonth || (state.editDate || todayInputValue()).slice(0, 7), delta);
    renderPanel();
  }

  function recordTeamTitle(item) {
    var away = (item && item.awayTeamName) || teamLabel("A");
    var home = (item && item.homeTeamName) || teamLabel("B");
    return away + " vs " + home;
  }

  function recordScoreText(item) {
    var away = Number(item && item.awayGoal);
    var home = Number(item && item.homeGoal);
    return (Number.isFinite(away) ? away : 0) + " : " + (Number.isFinite(home) ? home : 0);
  }

  function recordKindText(item) {
    return item && item.matchKind === "MATCH" ? "A매치" : "자체전";
  }

  function teamRecordItems() {
    var items = Array.isArray(state.recordIndex.teamItems) ? state.recordIndex.teamItems : [];
    return items.slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  }

  function teamRecordDateInput(item) {
    var date = String((item && item.date) || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  }

  function selectedTeamRecordDate() {
    return teamRecordDateInput(state.selectedTeamRecord);
  }

  function recordDateLookup() {
    var lookup = Object.create(null);
    recordItems().forEach(function (item) {
      var date = recordDateInput(item);
      if (date) lookup[date] = true;
    });
    return lookup;
  }

  function missingRecordItems() {
    var hasMatchRecord = recordDateLookup();
    return teamRecordItems().filter(function (item) {
      var date = teamRecordDateInput(item);
      return date && !hasMatchRecord[date];
    });
  }

  function teamRecordSize(groups) {
    groups = groups || {};
    return ["attack", "mid", "defense"].reduce(function (total, key) {
      return total + (Array.isArray(groups[key]) ? groups[key].length : 0);
    }, 0);
  }

  function teamRecordPlayers(groups) {
    groups = groups || {};
    return uniqueNames(["attack", "mid", "defense"].reduce(function (acc, key) {
      return acc.concat((Array.isArray(groups[key]) ? groups[key] : []).map(function (player) {
        if (player && typeof player === "object") {
          rememberRole(player.name, player.staffRole || roleFromText(player.name));
          return player.name;
        }
        return player;
      }));
    }, []));
  }

  function loadedPlayersFromTeamRecord(record) {
    var teams = (record && record.teams) || {};
    return {
      A: teamRecordPlayers(teams.A),
      B: teamRecordPlayers(teams.B),
    };
  }

  function teamRecordGroupLabel(key) {
    if (key === "attack") return "공격";
    if (key === "mid") return "미드";
    return "수비";
  }

  function renderTeamRecordGroup(groups, key) {
    var players = Array.isArray(groups && groups[key]) ? groups[key] : [];
    return [
      "<div class=\"mrw-team-group\"><div class=\"mrw-team-group-label\">" + teamRecordGroupLabel(key) + " " + players.length + "명</div>",
      "<div class=\"mrw-team-player-list\">",
      players.length ? players.map(function (player) {
        var name = player && typeof player === "object" ? player.name : player;
        return "<span class=\"mrw-team-player\">" + escapeHtml(name || "") + "</span>";
      }).join("") : "<span class=\"mrw-team-player\">없음</span>",
      "</div></div>",
    ].join("");
  }

  function renderTeamRecordTeam(record, team) {
    var groups = record && record.teams ? record.teams[team] : null;
    var total = teamRecordSize(groups);
    return [
      "<div class=\"mrw-team-box mrw-team-box-" + team.toLowerCase() + "\"><div class=\"mrw-team-box-head\"><span>" + teamLabel(team) + "</span><span>" + total + "명</span></div><div class=\"mrw-team-box-body\">",
      renderTeamRecordGroup(groups, "attack"),
      renderTeamRecordGroup(groups, "mid"),
      renderTeamRecordGroup(groups, "defense"),
      "</div></div>",
    ].join("");
  }

  function renderSelectedTeamRecord() {
    if (state.selectedTeamRecordLoading) {
      return "<div class=\"mrw-team-detail\"><div class=\"mrw-empty\">팀 확정 기록을 불러오는 중입니다.</div></div>";
    }
    if (state.selectedTeamRecordError) {
      return "<div class=\"mrw-team-detail\"><div class=\"mrw-empty\">" + escapeHtml(state.selectedTeamRecordError) + "</div></div>";
    }
    var record = state.selectedTeamRecord;
    if (!record) return "";
    var aCount = teamRecordSize(record.teams && record.teams.A);
    var bCount = teamRecordSize(record.teams && record.teams.B);
    return [
      "<div class=\"mrw-team-detail\">",
      "<div class=\"mrw-team-detail-head\"><div><div class=\"mrw-team-detail-title\">" + escapeHtml(record.date) + " 팀 분배</div>",
      "<div class=\"mrw-team-detail-sub\">형광 " + aCount + "명 · 주황 " + bCount + "명</div></div></div>",
      "<div class=\"mrw-team-grid\">" + renderTeamRecordTeam(record, "A") + renderTeamRecordTeam(record, "B") + "</div>",
      "</div>",
    ].join("");
  }

  function renderRecordCalendar(form) {
    var selected = state.editDate || form.date || todayInputValue();
    var monthKey = monthInputValue(state.calendarMonth || selected.slice(0, 7));
    var monthDate = new Date(monthKey + "-01T00:00:00");
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    var monthLabel = year + "." + String(month + 1).padStart(2, "0");
    var first = new Date(year, month, 1);
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var byDate = {};
    recordItems().forEach(function (item) {
      var date = recordDateInput(item);
      if (date) byDate[date] = item;
    });
    var teamByDate = {};
    teamRecordItems().forEach(function (item) {
      var date = teamRecordDateInput(item);
      if (date) teamByDate[date] = item;
    });
    var cells = ["일", "월", "화", "수", "목", "금", "토"].map(function (label) {
      return "<div class=\"mrw-calendar-dow\">" + label + "</div>";
    });
    for (var blank = 0; blank < first.getDay(); blank += 1) {
      cells.push("<button type=\"button\" class=\"mrw-calendar-day\" disabled></button>");
    }
    for (var day = 1; day <= daysInMonth; day += 1) {
      var dateValue = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var item = byDate[dateValue];
      var teamItem = teamByDate[dateValue];
      var cls = "mrw-calendar-day" + (item ? " mrw-has-record" : "") + (teamItem ? " mrw-has-team-record" : "") + (dateValue === selected ? " mrw-selected" : "");
      var title = item
        ? recordTeamTitle(item) + " " + recordScoreText(item)
        : teamItem
          ? "팀 확정 기록"
          : "기록 없음";
      var attrs = " data-mrw-calendar-date=\"" + dateValue + "\"";
      if (item) attrs += " data-mrw-record-id=\"" + escapeHtml(item.matchId) + "\"";
      if (teamItem) attrs += " data-mrw-team-record-date=\"" + escapeHtml(dateValue) + "\"";
      cells.push("<button type=\"button\" class=\"" + cls + "\"" + attrs + " title=\"" + escapeHtml(title) + "\">" + day + "</button>");
    }
    return [
      "<div class=\"mrw-calendar\">",
      "<div class=\"mrw-calendar-head\"><div><div class=\"mrw-calendar-title\">기록 달력</div><div class=\"mrw-calendar-count\">" + monthLabel + "</div></div><div class=\"mrw-calendar-nav\"><button type=\"button\" data-mrw-calendar-month=\"-1\" aria-label=\"이전 달\">‹</button><button type=\"button\" data-mrw-calendar-month=\"1\" aria-label=\"다음 달\">›</button></div></div>",
      "<div class=\"mrw-calendar-grid\">" + cells.join("") + "</div>",
      "</div>",
    ].join("");
  }

  function renderMissingRecordList() {
    if (state.recordIndex.loading) return "<div class=\"mrw-record-list\"><div class=\"mrw-empty\">저장된 기록을 불러오는 중입니다.</div></div>";
    if (state.recordIndex.teamError) return "<div class=\"mrw-record-list\"><div class=\"mrw-empty\">" + escapeHtml(state.recordIndex.teamError) + "</div></div>";
    var missing = missingRecordItems().slice(0, 12);
    if (!missing.length) return "<div class=\"mrw-record-list\"><div class=\"mrw-empty\">기록 미입력 날짜가 없습니다.</div></div>";
    return [
      "<div class=\"mrw-record-list\"><div class=\"mrw-record-list-title\"><span>기록 미입력</span><span>" + missingRecordItems().length + "건</span></div>",
      missing.map(function (item) {
        var date = teamRecordDateInput(item);
        var aCount = Number(item.teamAPlayers) || 0;
        var bCount = Number(item.teamBPlayers) || 0;
        var selected = selectedTeamRecordDate() === date;
        return [
          "<div class=\"mrw-record-chip mrw-team-record-chip" + (selected ? " mrw-record-chip-selected" : "") + "\">",
          "<button type=\"button\" class=\"mrw-record-chip-action\" data-mrw-load-team-record-date=\"" + escapeHtml(date) + "\" aria-expanded=\"" + (selected ? "true" : "false") + "\">",
          "<span class=\"mrw-record-chip-main\"><span class=\"mrw-record-date\">" + escapeHtml(recordDateLabel(date)) + "</span>",
          "<span class=\"mrw-record-sub\">팀 확정 완료 · 경기 기록 미입력 · 형광 " + aCount + "명 · 주황 " + bCount + "명</span></span></button>",
          "<span class=\"mrw-record-score\">" + aCount + " : " + bCount + "</span>",
          "<button type=\"button\" class=\"mrw-small-btn mrw-small-danger mrw-record-delete\" data-mrw-delete-team-record-date=\"" + escapeHtml(date) + "\">삭제</button>",
          "</div>",
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function renderRecordOverview(form) {
    var items = recordItems();
    var teamItems = teamRecordItems();
    var missing = missingRecordItems();
    var manualInputAction = !state.editingRecordOnly && !state.recordLoading
      ? "<button type=\"button\" class=\"mrw-small-btn mrw-small-primary\" data-mrw-action=\"start-manual-record\">기록 입력</button>"
      : "";
    var summary = state.recordIndex.loading
      ? "저장된 기록을 확인하는 중"
      : state.recordIndex.error
        ? "기록 목록을 불러오지 못했습니다"
        : "경기 기록 " + items.length + "건 · 팀확정 " + teamItems.length + "건 · 기록 미입력 " + missing.length + "건";
    return [
      "<div class=\"mrw-record-overview\">",
      "<div class=\"mrw-record-summary\"><span>" + summary + "</span><div class=\"mrw-record-summary-actions\">" + manualInputAction + "<button type=\"button\" class=\"mrw-small-btn\" data-mrw-action=\"refresh-record-index\">새로고침</button></div></div>",
      renderRecordCalendar(form),
      renderMissingRecordList(),
      renderSelectedTeamRecord(),
      "</div>",
    ].join("");
  }

  function renderEditModal(form) {
    return [
      "<div class=\"mrw-modal-backdrop\" data-mrw-action=\"close-edit-modal\"><div class=\"mrw-modal\">",
      "<div class=\"mrw-modal-head\"><div><h4 class=\"mrw-modal-title\">기존 기록 수정</h4><p class=\"mrw-modal-sub\">달력에서 날짜를 선택해 기록을 불러옵니다.</p></div><button type=\"button\" class=\"mrw-icon-close\" data-mrw-action=\"close-edit-modal\" aria-label=\"닫기\">×</button></div>",
      "<div class=\"mrw-modal-body\">" + renderRecordOverview(form) + "</div>",
      "<div class=\"mrw-modal-foot\"><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"close-edit-modal\">닫기</button></div>",
      "</div></div>",
    ].join("");
  }

  function bindPanel(panel) {
    var dateInput = panel.querySelector("[data-mrw=date]");
    var idInput = panel.querySelector("[data-mrw=matchId]");
    if (dateInput && idInput) {
      dateInput.addEventListener("change", function () {
        idInput.value = compactDate(dateInput.value);
        var currentForm = formState(panel);
        currentForm.date = dateInput.value;
        currentForm.matchId = idInput.value;
        resetRecordEntryState();
        state.loadedForm = currentForm;
        state.matchKind = currentForm.matchKind;
        setTeamLabels(currentForm);
        renderPanel();
      });
    }
    ["startTime", "venueName", "awayTeam", "memo"].forEach(function (key) {
      var element = panel.querySelector("[data-mrw=" + key + "]");
      if (element) element.addEventListener("change", function () {
        var currentForm = formState(panel);
        state.loadedForm = currentForm;
        setTeamLabels(currentForm);
        state.status = "";
        renderPanel();
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-duration]"), function (button) {
      button.addEventListener("click", function () {
        var durationInput = panel.querySelector("[data-mrw=duration]");
        if (durationInput) durationInput.value = button.getAttribute("data-mrw-duration") || "2";
        state.loadedForm = formState(panel);
        renderPanel();
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-kind]"), function (button) {
      button.addEventListener("click", function () {
        var nextKind = button.getAttribute("data-mrw-kind") === "MATCH" ? "MATCH" : "SELF";
        var currentForm = formState(panel);
        currentForm.matchKind = nextKind;
        currentForm.awayTeamName = nextKind === "MATCH" ? (currentForm.awayTeamName || firstAwayTeam()) : "";
        var matchKindInput = panel.querySelector("[data-mrw=matchKind]");
        if (matchKindInput) matchKindInput.value = nextKind;
        state.matchKind = nextKind;
        state.loadedForm = currentForm;
        state.teamScores = Object.create(null);
        state.summaryStats = Object.create(null);
        state.events = [];
        state.conflict = null;
        state.status = "";
        setTeamLabels(currentForm);
        renderPanel();
      });
    });
    var scope = panel.querySelector("[data-mrw=scope]");
    if (scope) scope.addEventListener("change", function () {
      state.selectedScope = scope.value || "";
      state.status = "";
      renderPanel();
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-score-adjust]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        setTeamScore(button.getAttribute("data-mrw-score-team") === "B" ? "B" : "A", Number(button.getAttribute("data-mrw-score-adjust")) || 0, selectedQuarter());
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-summary-adjust]"), function (button) {
      button.addEventListener("click", function () {
        setSummaryStat(
          button.getAttribute("data-mrw-summary-team") === "B" ? "B" : "A",
          button.getAttribute("data-mrw-summary-player") || "",
          button.getAttribute("data-mrw-summary-field") === "assists" ? "assists" : "goals",
          Number(button.getAttribute("data-mrw-summary-adjust")) || 0,
          selectedQuarter(),
        );
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-add-player-team]"), function (button) {
      button.addEventListener("click", function () {
        var team = button.getAttribute("data-mrw-add-player-team") === "B" ? "B" : "A";
        var input = panel.querySelector("[data-mrw-add-player-name=\"" + team + "\"]");
        addLoadedPlayer(team, input && input.value);
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-add-player-name]"), function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        var team = input.getAttribute("data-mrw-add-player-name") === "B" ? "B" : "A";
        addLoadedPlayer(team, input.value);
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-remove-player]"), function (button) {
      button.addEventListener("click", function () {
        removeLoadedPlayer(
          button.getAttribute("data-mrw-remove-player-team") === "B" ? "B" : "A",
          button.getAttribute("data-mrw-remove-player") || "",
        );
      });
    });
    var addTeam = panel.querySelector("[data-mrw-action=add-team]");
    if (addTeam) addTeam.addEventListener("click", addAwayTeamFromPanel);
    var newAwayTeam = panel.querySelector("[data-mrw=newAwayTeam]");
    if (newAwayTeam) newAwayTeam.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addAwayTeamFromPanel();
      }
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-remove-score-team]"), function (button) {
      button.addEventListener("click", function () {
        removeTeamScore(button.getAttribute("data-mrw-remove-score-team") === "B" ? "B" : "A", selectedQuarterValue(button.getAttribute("data-mrw-remove-score-quarter")));
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-remove-stat-player]"), function (button) {
      button.addEventListener("click", function () {
        removeSummaryStat(
          button.getAttribute("data-mrw-remove-stat-team") === "B" ? "B" : "A",
          button.getAttribute("data-mrw-remove-stat-player") || "",
          selectedQuarterValue(button.getAttribute("data-mrw-remove-stat-quarter")),
        );
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-remove-event]"), function (button) {
      button.addEventListener("click", function () {
        state.events.splice(Number(button.getAttribute("data-mrw-remove-event")), 1);
        state.status = "";
        renderPanel();
      });
    });
    var openEdit = panel.querySelector("[data-mrw-action=open-edit-modal]");
    if (openEdit) openEdit.addEventListener("click", openEditModal);
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-action=close-edit-modal]"), function (button) {
      button.addEventListener("click", closeEditModal);
    });
    var modal = panel.querySelector(".mrw-modal");
    if (modal) modal.addEventListener("click", function (event) { event.stopPropagation(); });
    var editDate = panel.querySelector("[data-mrw=editDate]");
    if (editDate) editDate.addEventListener("change", function () { state.editDate = editDate.value || todayInputValue(); renderPanel(); });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-calendar-month]"), function (button) {
      button.addEventListener("click", function () {
        setCalendarMonth(Number(button.getAttribute("data-mrw-calendar-month")) || 0);
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-calendar-date]"), function (button) {
      button.addEventListener("click", function () {
        state.editDate = button.getAttribute("data-mrw-calendar-date") || state.editDate || todayInputValue();
        state.calendarMonth = state.editDate.slice(0, 7);
        var recordId = button.getAttribute("data-mrw-record-id");
        var teamDate = button.getAttribute("data-mrw-team-record-date");
        if (recordId) {
          loadRecord(recordId);
          return;
        }
        if (teamDate) {
          toggleTeamRecordForEdit(teamDate);
          return;
        }
        clearRecordSelection(state.editDate, "");
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-load-record-id]"), function (button) {
      button.addEventListener("click", function () {
        state.editDate = button.getAttribute("data-mrw-load-record-date") || state.editDate || todayInputValue();
        loadRecord(button.getAttribute("data-mrw-load-record-id"));
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-load-team-record-date]"), function (button) {
      button.addEventListener("click", function () {
        toggleTeamRecordForEdit(button.getAttribute("data-mrw-load-team-record-date") || state.editDate || todayInputValue());
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-delete-team-record-date]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        deleteDateRecords(button.getAttribute("data-mrw-delete-team-record-date") || selectedTeamRecordDate() || state.editDate || todayInputValue());
      });
    });
    var refreshRecordIndex = panel.querySelector("[data-mrw-action=refresh-record-index]");
    if (refreshRecordIndex) refreshRecordIndex.addEventListener("click", function () { loadRecordIndex(true); });
    var startManualRecord = panel.querySelector("[data-mrw-action=start-manual-record]");
    if (startManualRecord) startManualRecord.addEventListener("click", startManualRecordInput);
    var loadEditDate = panel.querySelector("[data-mrw-action=load-edit-date]");
    if (loadEditDate) loadEditDate.addEventListener("click", loadEditRecordByDate);
    var refreshLineup = panel.querySelector("[data-mrw-action=refresh-lineup]");
    if (refreshLineup) refreshLineup.addEventListener("click", refreshCurrentLineup);
    var preview = panel.querySelector("[data-mrw-action=preview]");
    if (preview) preview.addEventListener("click", function () { saveRecord(true, false); });
    var save = panel.querySelector("[data-mrw-action=save]");
    if (save) save.addEventListener("click", function () { saveRecord(false, Boolean(state.editingMatchId)); });
    var deleteButton = panel.querySelector("[data-mrw-action=delete-record]");
    if (deleteButton) deleteButton.addEventListener("click", deleteRecord);
  }

  function openEditModal() {
    var panel = document.getElementById(PANEL_ID);
    var dateInput = panel && panel.querySelector("[data-mrw=date]");
    state.editDate = (dateInput && dateInput.value) || state.editDate || todayInputValue();
    state.editModalOpen = true;
    state.status = "";
    renderPanel();
    loadRecordIndex(false);
  }

  function closeEditModal() {
    state.editModalOpen = false;
    renderPanel();
  }

  function loadEditRecordByDate() {
    var panel = document.getElementById(PANEL_ID);
    var input = panel && panel.querySelector("[data-mrw=editDate]");
    var matchId = compactDate((input && input.value) || state.editDate);
    state.editDate = (input && input.value) || state.editDate || todayInputValue();
    if (!matchId) {
      state.status = "수정할 경기 날짜를 선택해주세요.";
      state.editModalOpen = false;
      renderPanel();
      return;
    }
    loadRecord(matchId);
  }

  function startManualRecordInput() {
    var date = state.editDate || todayInputValue();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayInputValue();
    state.editDate = date;
    state.calendarMonth = date.slice(0, 7);
    state.matchKind = "SELF";
    resetToEmptyMatch(compactDate(date), [
      "선택한 날짜로 빈 기록 입력을 시작합니다.",
      "날짜: " + date,
      "형광/주황 선수 추가 후 스코어와 골/도움을 입력하세요.",
    ].join("\n"), true);
  }

  function refreshCurrentLineup() {
    if (!canRefreshCurrentLineup()) {
      state.status = "현재 라인업으로 입력할 때만 라인업 갱신을 사용할 수 있습니다.";
      renderPanel();
      return;
    }
    var panel = document.getElementById(PANEL_ID);
    var currentForm = formState(panel);
    var records = parseQuarterCards();
    if (hasEnteredRecordItems()) {
      var ok = window.confirm("현재 라인업 기준으로 구성원을 다시 채울까요?\n입력 중인 팀 스코어와 개인기록은 초기화됩니다.");
      if (!ok) return;
    }
    state.recordLoadSeq += 1;
    resetRecordEntryState();
    state.loadedForm = currentForm;
    state.matchKind = currentForm.matchKind;
    state.editModalOpen = false;
    state.recordLoading = false;
    var refreshedPlayers = loadedPlayersFromRecords(records);
    state.status = (refreshedPlayers.A.length || refreshedPlayers.B.length)
      ? "현재 라인업 선수 기준으로 갱신했습니다."
      : "현재 라인업 선수를 찾지 못했습니다. 팀별 선수 추가로 구성원을 입력해주세요.";
    removeExistingPanel();
    renderPanel();
  }

  function payloadFromPanel(dryRun, overwriteExisting) {
    var panel = document.getElementById(PANEL_ID);
    var matchDate = panel.querySelector("[data-mrw=date]").value;
    var startTime = panel.querySelector("[data-mrw=startTime]").value || "20:00";
    var duration = Number(normalizeDuration(panel.querySelector("[data-mrw=duration]").value || 2));
    var matchKind = panel.querySelector("[data-mrw=matchKind]").value === "MATCH" ? "MATCH" : "SELF";
    var home = matchKind === "SELF" ? "DevUtd 주황" : "DevUtd";
    var awayControl = panel.querySelector("[data-mrw=awayTeam]");
    var away = matchKind === "SELF" ? "DevUtd 형광" : ((awayControl && (awayControl.value || awayControl.textContent)) || firstAwayTeam());
    var hasQuarterRecords = teamScoresArray().some(function (score) { return score.quarter; }) || summaryStatsArray().some(function (stat) { return stat.quarter; });
    var quarters = payloadRecords(parseQuarterCards());
    var events = state.events;
    var summaryStats = summaryStatsArray();
    assertRegisteredRecordPlayers(quarters, summaryStats, events);
    return {
      matchId: state.editingMatchId || panel.querySelector("[data-mrw=matchId]").value.trim() || compactDate(matchDate),
      matchDate: matchDate,
      matchTime: formatMatchTime(matchDate, startTime, duration),
      matchKind: matchKind,
      recordMode: hasQuarterRecords ? "QUARTER" : "SUMMARY",
      venueName: valueOf(panel, "venueName", preferredVenue()),
      homeTeamName: home,
      awayTeamName: away,
      memo: valueOf(panel, "memo", ""),
      quarters: quarters,
      events: events,
      summaryStats: summaryStats,
      teamScores: teamScoresArray(),
      scoreOverride: teamScoreSummary(),
      staffRoles: staffRolesPayload(),
      dryRun: dryRun,
      overwriteExisting: overwriteExisting,
    };
  }

  function teamLabelForPayload(team, payload) {
    return team === "B" ? (payload.homeTeamName || teamLabel("B")) : (payload.awayTeamName || teamLabel("A"));
  }

  function saveSummaryText(payload) {
    var lines = [];
    (payload.summaryStats || []).forEach(function (stat) {
      var player = playerName(stat.player);
      if (!player) return;
      var parts = [];
      if (stat.goals > 0) parts.push("골 " + stat.goals);
      if (stat.assists > 0) parts.push("도움 " + stat.assists);
      if (parts.length === 0) return;
      lines.push("- " + scopeLabel(stat.quarter) + " · " + teamLabelForPayload(stat.team, payload) + " · " + player + ": " + parts.join(" · "));
    });
    (payload.events || []).forEach(function (event) {
      if (!event || !event.scorer) return;
      var line = "- " + scopeLabel(event.quarter) + " · " + teamLabelForPayload(event.team, payload) + " · " + event.scorer + ": 골 1";
      if (event.assist) line += " · 도움 " + event.assist;
      lines.push(line);
    });
    return lines.length ? "개인기록:\n" + lines.join("\n") : "개인기록: 입력 없음";
  }

  async function fetchTeamRecord(date) {
    var response = await fetch("/api/team-records?date=" + encodeURIComponent(date), { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.detail || data.error || "팀 확정 기록을 불러오지 못했습니다.");
    return data.record || null;
  }

  function removeRecordIndexItem(matchId) {
    var targetId = String(matchId || "");
    var targetDate = compactDate(targetId);
    state.recordIndex.items = (Array.isArray(state.recordIndex.items) ? state.recordIndex.items : []).filter(function (item) {
      if (!item) return false;
      var itemId = String(item.matchId || "");
      var itemDate = compactDate(item.matchDate || item.matchId);
      return itemId !== targetId && itemDate !== targetDate;
    });
    state.recordIndex.loaded = false;
  }

  function removeTeamRecordIndexItem(date) {
    var targetDate = String(date || "");
    state.recordIndex.teamItems = (Array.isArray(state.recordIndex.teamItems) ? state.recordIndex.teamItems : []).filter(function (item) {
      return teamRecordDateInput(item) !== targetDate;
    });
    state.recordIndex.loaded = false;
  }

  function clearRecordSelection(date, status) {
    var nextDate = date || state.editDate || todayInputValue();
    resetRecordEntryState();
    state.editDate = nextDate;
    state.calendarMonth = nextDate.slice(0, 7);
    state.status = status || "";
    removeExistingPanel();
    renderPanel();
  }

  function resetToTeamRecordMatch(matchId, record, status) {
    resetRecordEntryState();
    state.editingRecordOnly = true;
    state.loadedPlayers = loadedPlayersFromTeamRecord(record);
    state.loadedForm = emptyFormForMatch(matchId);
    state.loadedForm.matchKind = "SELF";
    state.matchKind = "SELF";
    state.selectedTeamRecord = record;
    state.editModalOpen = false;
    state.status = status;
    removeExistingPanel();
    renderPanel();
  }

  async function loadTeamRecordForEdit(date) {
    if (!date) return;
    try {
      state.editDate = date;
      state.calendarMonth = date.slice(0, 7);
      state.selectedTeamRecordLoading = true;
      state.selectedTeamRecordError = "";
      renderPanel();
      var record = await fetchTeamRecord(date);
      state.selectedTeamRecordLoading = false;
      if (!record) {
        state.selectedTeamRecord = null;
        state.selectedTeamRecordError = "선택한 날짜의 팀 확정 기록이 없습니다.";
        renderPanel();
        return;
      }
      var matchId = compactDate(date);
      state.calendarMonth = date.slice(0, 7);
      resetToTeamRecordMatch(matchId, record, [
        "팀 확정 기록을 불러왔습니다.",
        "기록 키: " + matchId,
        "이 팀 구성으로 스코어와 개인 골/도움을 입력한 뒤 기록 저장을 누르세요.",
      ].join("\n"));
    } catch (error) {
      state.selectedTeamRecordLoading = false;
      state.selectedTeamRecordError = error && error.message ? error.message : String(error);
      renderPanel();
    }
  }

  function toggleTeamRecordForEdit(date) {
    if (!date) return;
    if (selectedTeamRecordDate() === date) {
      clearRecordSelection(date, "팀 확정 기록을 접었습니다.");
      return;
    }
    loadTeamRecordForEdit(date);
  }

  async function loadRecord(matchIdOverride) {
    try {
      var loadSeq = state.recordLoadSeq + 1;
      state.recordLoadSeq = loadSeq;
      var panel = document.getElementById(PANEL_ID);
      var matchId = matchIdOverride || panel.querySelector("[data-mrw=matchId]").value.trim() || compactDate(panel.querySelector("[data-mrw=date]").value);
      if (!matchId) {
        state.status = "불러올 기록 날짜를 선택해주세요.";
        renderPanel();
        return;
      }
      resetRecordEntryState();
      state.editingRecordOnly = true;
      state.recordLoading = true;
      state.editModalOpen = false;
      state.loadedForm = emptyFormForMatch(matchId);
      state.status = "기존 기록을 불러오는 중...";
      renderPanel();

      var response = await fetch("/api/match-record?matchId=" + encodeURIComponent(matchId), { method: "GET", headers: { accept: "application/json" } });
      var data = await response.json().catch(function () { return {}; });
      if (loadSeq !== state.recordLoadSeq) return;
      state.recordLoading = false;
      if (!response.ok) {
        if (response.status === 404 || data.error === "MATCH_NOT_FOUND") {
          var teamRecordDate = dateInputFromFirebase(matchId) || state.editDate;
          var teamRecord = teamRecordDate ? await fetchTeamRecord(teamRecordDate).catch(function () { return null; }) : null;
          if (teamRecord) {
            resetToTeamRecordMatch(matchId, teamRecord, [
              "해당 날짜의 경기 기록은 없고 팀 확정 기록을 불러왔습니다.",
              "기록 키: " + matchId,
              "이 팀 구성으로 스코어와 개인 골/도움을 입력한 뒤 기록 저장을 누르세요.",
            ].join("\n"));
            return;
          }
          resetToEmptyMatch(matchId, [
            "해당 날짜의 기존 기록이 없습니다.",
            "기록 키: " + matchId,
            "저장된 기록 기준으로 빈 상태를 보여줍니다.",
            "필요한 내용을 입력한 뒤 기록 저장을 눌러 새 기록으로 저장할 수 있습니다.",
          ].join("\n"), true);
          return;
        }
        throw new Error(data.detail || data.error || "경기 기록을 찾지 못했습니다.");
      }

      applyStaffRoles(data.staffRoles);
      state.events = Array.isArray(data.events) ? data.events : [];
      setSummaryStatsFromArray(data.summaryStats);
      setTeamScoresFromArray(data.teamScores, data.scoreOverride);
      state.loadedPlayers = normalizeLoadedPlayers(data.players) || emptyLoadedPlayers();
      state.conflict = null;
      state.loadedRecord = data;
      state.editingRecordOnly = true;
      state.editingMatchId = data.matchId || matchId;
      state.matchKind = data.matchKind === "MATCH" ? "MATCH" : "SELF";
      state.editModalOpen = false;
      state.selectedScope = "";

      var matchDate = dateInputFromFirebase(data.matchDate) || dateInputFromFirebase(data.matchId || matchId);
      if (matchDate) state.calendarMonth = matchDate.slice(0, 7);
      state.loadedForm = {
        date: matchDate || todayInputValue(),
        matchId: data.matchId || matchId,
        startTime: data.matchTime ? startTimeFromMatchTime(data.matchTime) : "20:00",
        duration: data.matchTime ? normalizeDuration(durationFromMatchTime(data.matchTime)) : "2",
        matchKind: state.matchKind,
        venueName: data.venueName || preferredVenue(),
        awayTeamName: data.awayTeamName || "",
        memo: typeof data.comment === "string" ? data.comment : "",
      };

      state.status = [
        "기존 기록을 불러왔습니다.",
        "기록 키: " + (data.matchId || matchId),
        "스코어: " + (data.awayTeamName || teamLabel("A")) + " " + (data.awayGoal || 0) + " : " + (data.homeGoal || 0) + " " + (data.homeTeamName || teamLabel("B")),
        "수정 후 기록 저장을 누르면 기존 기록에 반영됩니다.",
      ].join("\n");
      panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
      renderPanel();
    } catch (error) {
      state.status = error && error.message ? error.message : String(error);
      state.recordLoading = false;
      renderPanel();
    }
  }

  async function deleteMatchRecordById(matchId) {
    var response = await fetch("/api/match-record?matchId=" + encodeURIComponent(matchId), {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.detail || data.error || "경기 기록 삭제에 실패했습니다.");
    removeRecordIndexItem(data.matchId || matchId);
    return data;
  }

  async function deleteTeamRecordByDate(date) {
    var response = await fetch("/api/team-records?date=" + encodeURIComponent(date), {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.detail || data.error || "팀 확정 기록 삭제에 실패했습니다.");
    removeTeamRecordIndexItem(date);
    return data;
  }

  function deleteStatusLines(date, matchId, matchData, teamData) {
    var lines = [
      "해당 날짜 기록을 모두 삭제했습니다.",
      "날짜: " + date,
      "기록 키: " + matchId,
    ];
    if (matchData && matchData.deleted === false) lines.push("경기 기록: 삭제할 기록 없음");
    if (teamData && teamData.deleted === false) lines.push("팀 확정 기록: 삭제할 기록 없음");
    return lines.join("\n");
  }

  async function deleteDateRecords(date, matchId) {
    try {
      var targetDate = String(date || selectedTeamRecordDate() || state.editDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        state.status = "삭제할 날짜를 선택해주세요.";
        renderPanel();
        return;
      }
      var targetMatchId = matchId || compactDate(targetDate);

      var ok = window.confirm("해당 날짜의 저장 기록을 모두 삭제할까요?\n날짜: " + targetDate + "\n경기기록과 팀확정 기록이 모두 삭제됩니다.");
      if (!ok) return;

      state.status = "해당 날짜 기록을 모두 삭제하는 중...";
      renderPanel();

      var matchData = await deleteMatchRecordById(targetMatchId);
      var teamData = await deleteTeamRecordByDate(targetDate);

      clearRecordSelection(targetDate, deleteStatusLines(targetDate, targetMatchId, matchData, teamData));
      loadRecordIndex(true);
    } catch (error) {
      state.status = error && error.message ? error.message : String(error);
      renderPanel();
    }
  }

  async function deleteRecord() {
    try {
      if (!state.editingMatchId && selectedTeamRecordDate()) {
        await deleteDateRecords(selectedTeamRecordDate(), compactDate(selectedTeamRecordDate()));
        return;
      }

      var panel = document.getElementById(PANEL_ID);
      var dateInput = panel && panel.querySelector("[data-mrw=date]");
      var matchIdInput = panel && panel.querySelector("[data-mrw=matchId]");
      var matchId = state.editingMatchId || (matchIdInput && matchIdInput.value.trim()) || compactDate(dateInput && dateInput.value);
      var targetDate = (dateInput && dateInput.value) || dateInputFromFirebase(matchId) || state.editDate || todayInputValue();
      if (!matchId) {
        state.status = "삭제할 기록 날짜를 선택해주세요.";
        renderPanel();
        return;
      }

      await deleteDateRecords(targetDate, matchId);
    } catch (error) {
      state.status = error && error.message ? error.message : String(error);
      renderPanel();
    }
  }

  async function saveRecord(dryRun, overwriteExisting) {
    try {
      var payload = payloadFromPanel(dryRun, overwriteExisting);
      state.status = dryRun ? "저장 내용을 확인하는 중..." : "기록을 저장하는 중...";
      renderPanel();
      var response = await fetch("/api/match-record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      var data = await response.json().catch(function () { return {}; });
      if (response.status === 409 && data.error === "MATCH_EXISTS") {
        state.conflict = data;
        state.status = "이미 저장된 경기 기록이 있습니다.\n기록 수정에서 해당 날짜 기록을 불러온 뒤 저장해주세요.";
        renderPanel();
        return;
      }
      if (!response.ok) throw new Error(data.detail || data.error || "경기 기록 저장에 실패했습니다.");
      state.conflict = null;
      if (!dryRun) {
        state.editingMatchId = "";
        state.recordIndex.loaded = false;
      }
      var homeName = data.homeTeamName || payload.homeTeamName;
      var awayName = data.awayTeamName || payload.awayTeamName;
      var homeGoal = Number(data.homeGoal !== undefined ? data.homeGoal : payload.scoreOverride.B) || 0;
      var awayGoal = Number(data.awayGoal !== undefined ? data.awayGoal : payload.scoreOverride.A) || 0;
      state.status = [
        data.message,
        "기록 키: " + (data.matchId || payload.matchId),
        "스코어: " + awayName + " " + awayGoal + " : " + homeGoal + " " + homeName,
        saveSummaryText(payload),
      ].join("\n");
      renderPanel();
    } catch (error) {
      state.status = error && error.message ? error.message : String(error);
      renderPanel();
    }
  }

  function scheduleRender() {
    window.clearTimeout(scheduleRender.timer);
    scheduleRender.timer = window.setTimeout(function () {
      if (isPanelControlFocused()) return;
      renderPanel();
    }, 250);
  }

  function boot() {
    installStyle();
    loadOptions();
    scheduleRender();
    var observer = new MutationObserver(function (mutations) {
      if (recordRoot() && mutations.some(shouldObserveMutation)) scheduleRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
