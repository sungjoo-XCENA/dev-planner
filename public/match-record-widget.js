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
    editingMatchId: "",
    selectedScope: "",
    matchKind: "SELF",
    teamLabels: { A: TEAM_LABELS.A, B: TEAM_LABELS.B },
    teamScores: Object.create(null),
    summaryStats: Object.create(null),
    events: [],
    roles: Object.create(null),
    standaloneKey: "",
    editModalOpen: false,
    editDate: todayInputValue(),
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
      ".mrw-scoreboard{border-radius:18px;background:#0f172a;padding:14px;color:#fff}",
      ".mrw-score-row{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:28px}",
      ".mrw-side-wrap{position:relative;min-width:0}",
      ".mrw-side{width:100%;min-height:86px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:14px 42px;color:#fff;font-family:inherit;text-align:center;cursor:pointer;appearance:none;-webkit-appearance:none;box-shadow:0 8px 18px rgba(15,23,42,.12);transition:transform .12s ease,box-shadow .12s ease}",
      ".mrw-side:hover{transform:translateY(-1px);box-shadow:0 12px 24px rgba(15,23,42,.18)}",
      ".mrw-side:focus-visible{outline:3px solid rgba(255,255,255,.8);outline-offset:2px}",
      ".mrw-side-a{background:linear-gradient(135deg,#84cc16,#10b981)}",
      ".mrw-side-b{background:linear-gradient(135deg,#fb923c,#ea580c)}",
      ".mrw-team-name{max-width:100%;font-size:13px;font-weight:950;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mrw-score-num{font-size:48px;font-weight:950;line-height:.95;text-align:center}",
      ".mrw-score-sep{font-size:24px;font-weight:950;color:#cbd5e1}",
      ".mrw-score-minus{position:absolute;right:8px;top:8px;z-index:2;display:flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:rgba(15,23,42,.36);color:#fff;width:30px;height:30px;font-size:18px;font-weight:950;line-height:1;cursor:pointer;box-shadow:0 4px 12px rgba(15,23,42,.18)}",
      ".mrw-stats{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:10px}",
      ".mrw-stat-team{border:1px solid #e2e8f0;border-radius:18px;background:#fff;overflow:hidden}",
      ".mrw-stat-team-title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;background:#f8fafc;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:950;color:#0f172a}",
      ".mrw-stat-total{color:#64748b;font-size:12px;font-weight:900}",
      ".mrw-stat-list{display:grid;gap:7px;padding:10px}",
      ".mrw-stat-row{display:grid;grid-template-columns:minmax(70px,1fr) auto auto;align-items:center;gap:6px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:7px}",
      ".mrw-stat-name{min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#0f172a;font-size:13px;font-weight:950}",
      ".mrw-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
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
      ".mrw-status{margin-top:10px;border-radius:14px;background:#f8fafc;padding:10px;color:#334155;font-size:12px;font-weight:800;line-height:1.5;white-space:pre-wrap}",
      ".mrw-modal-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);padding:16px}",
      ".mrw-modal{width:min(440px,100%);max-height:min(78vh,640px);overflow:auto;border-radius:22px;background:#fff;box-shadow:0 24px 72px rgba(15,23,42,.3)}",
      ".mrw-modal-head{border-bottom:1px solid #e2e8f0;padding:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
      ".mrw-modal-title{margin:0;font-size:18px;font-weight:950}",
      ".mrw-modal-sub{margin:4px 0 0;color:#64748b;font-size:12px;font-weight:800}",
      ".mrw-modal-body{display:grid;gap:12px;padding:14px}",
      ".mrw-modal-foot{display:flex;gap:8px;justify-content:flex-end;background:#fff;border-top:1px solid #e2e8f0;padding:12px 14px}",
      ".mrw-icon-close{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:999px;background:#e2e8f0;color:#334155;font-size:20px;font-weight:950;line-height:1;cursor:pointer}",
      ".mrw-empty{color:#94a3b8;font-size:12px;font-weight:800}",
      "@media(max-width:760px){.mrw-card{padding:14px;border-radius:18px}.mrw-title{font-size:18px}.mrw-meta{grid-template-columns:1fr}.mrw-wide{grid-column:1/-1}.mrw-summary{grid-template-columns:1fr}.mrw-summary-item:last-child{grid-column:auto}.mrw-field{max-width:100%;overflow:hidden}.mrw-field input,.mrw-field select,.mrw-field textarea,.mrw-fixed{min-height:42px;width:100%;max-width:100%;min-width:0;min-inline-size:0}.mrw-field input[type=date],.mrw-field input[type=time]{appearance:none;-webkit-appearance:none;text-align:left}.mrw-mode-head{align-items:stretch}.mrw-scope{width:100%}.mrw-scope select{flex:1}.mrw-layout{grid-template-columns:1fr}.mrw-scoreboard{padding:10px}.mrw-score-num{font-size:40px}.mrw-score-row{grid-template-columns:1fr;gap:10px}.mrw-score-sep{display:none}.mrw-side{min-height:76px;padding:12px 38px}.mrw-team-name{font-size:12px}.mrw-score-minus{right:6px;top:6px;width:28px;height:28px;font-size:17px}.mrw-stats{grid-template-columns:1fr}.mrw-stat-list{gap:5px}.mrw-stat-row{grid-template-columns:minmax(68px,1fr) auto auto;gap:4px;padding:6px}.mrw-stat-name{font-size:12px;line-height:1.2}.mrw-name{white-space:normal}.mrw-role{padding:1px 5px;font-size:9px}.mrw-counter{grid-template-columns:18px 20px 14px 20px;gap:1px;padding:3px;min-width:76px}.mrw-counter-label{font-size:9px;line-height:1}.mrw-counter button{width:20px;height:20px;font-size:12px}.mrw-counter-value{font-size:12px}.mrw-add-team{grid-template-columns:1fr}.mrw-add-team button{min-height:38px}.mrw-events{max-height:none}.mrw-actions .mrw-button{flex:1 1 100%}.mrw-modal-backdrop{align-items:flex-end;padding:0}.mrw-modal{width:100%;border-radius:22px 22px 0 0;max-height:84vh}}",
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

  function parseQuarterCards() {
    var section = document.getElementById("lineup-result");
    if (!section) return [];
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
    var section = document.getElementById("lineup-result");
    return Boolean(section && section.getAttribute("data-mrw-standalone") === "true");
  }

  function standaloneData() {
    var section = document.getElementById("lineup-result");
    var node = section && section.querySelector("[data-mrw-records]");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}") || {};
    } catch {
      return {};
    }
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

  function displayRecords(fallbackRecords) {
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

  function resetRecordEntryState() {
    state.events = [];
    state.summaryStats = Object.create(null);
    state.teamScores = Object.create(null);
    state.conflict = null;
    state.loadedRecord = null;
    state.loadedPlayers = null;
    state.loadedForm = null;
    state.selectedScope = "";
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
      if (select) select.value = name;
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
    if (state.matchKind === "SELF") return team === "A" ? "형광팀" : "주황팀";
    return teamLabel(team);
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
    var quarter = selectedQuarter();
    var score = teamScoreSummary();

    var panel = existing || document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "mrw-card";
    panel.innerHTML = [
      "<div class=\"mrw-head\"><div><h3 class=\"mrw-title\">경기 기록</h3><p class=\"mrw-help\">팀 점수는 점수판을 눌러 올리고, 개인 골/도움은 선수별로 필요한 만큼만 입력합니다.</p></div><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"open-edit-modal\">기록 수정</button></div>",
      "<input type=\"hidden\" data-mrw=\"matchId\" value=\"" + escapeHtml(form.matchId || compactDate(form.date)) + "\" />",
      "<input type=\"hidden\" data-mrw=\"duration\" value=\"" + escapeHtml(form.duration) + "\" />",
      "<input type=\"hidden\" data-mrw=\"matchKind\" value=\"" + escapeHtml(form.matchKind) + "\" />",
      renderMeta(form),
      "<div class=\"mrw-mode\"><div class=\"mrw-mode-head\"><div><div class=\"mrw-mode-title\">기록 입력</div><div class=\"mrw-mode-help\">경기 전체로 입력해도 되고, 기억나는 경우만 1Q~4Q를 골라 쿼터 기록으로 남기면 됩니다.</div></div><label class=\"mrw-scope\">기록 기준 " + renderScopeSelect(quarter) + "</label></div></div>",
      "<div class=\"mrw-layout\"><div class=\"mrw-main\">",
      renderScoreboard(score, quarter),
      renderStatTeams(records, quarter),
      "</div>",
      renderRecentLog(score),
      "</div>",
      "<div class=\"mrw-actions\"><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"preview\">기록 확인</button><button type=\"button\" class=\"mrw-button mrw-primary\" data-mrw-action=\"save\">기록 저장</button></div>",
      state.status ? "<div class=\"mrw-status\">" + escapeHtml(state.status) + "</div>" : "",
      state.editModalOpen ? renderEditModal(form) : "",
    ].join("");

    if (!existing) {
      var mount = document.getElementById("lineup-result");
      if (mount) mount.appendChild(panel);
    }
    bindPanel(panel);
  }

  function renderMeta(form) {
    var home = form.matchKind === "SELF" ? "DevUtd 주황" : "DevUtd";
    var away = form.matchKind === "SELF" ? "DevUtd 형광" : (form.awayTeamName || firstAwayTeam());
    return [
      "<div class=\"mrw-meta\">",
      fieldInput("경기일", "date", "date", form.date),
      "<div class=\"mrw-field\"><label>경기 구분</label><div class=\"mrw-segment\"><button type=\"button\" data-mrw-kind=\"SELF\" aria-pressed=\"" + (form.matchKind === "SELF") + "\">자체전</button><button type=\"button\" data-mrw-kind=\"MATCH\" aria-pressed=\"" + (form.matchKind === "MATCH") + "\">A매치</button></div></div>",
      fieldInput("시작 시간", "startTime", "time", form.startTime || "20:00"),
      "<div class=\"mrw-field\"><label>경기 시간</label><div class=\"mrw-duration\"><button type=\"button\" data-mrw-duration=\"2\" aria-pressed=\"" + (form.duration === "2") + "\">2시간</button><button type=\"button\" data-mrw-duration=\"3\" aria-pressed=\"" + (form.duration === "3") + "\">3시간</button></div></div>",
      renderVenueSelect(form.venueName),
      "<div class=\"mrw-field\"><label>홈팀</label><div class=\"mrw-fixed\" data-mrw=\"homeTeamName\">" + escapeHtml(home) + "</div></div>",
      renderAwayControl(form.matchKind, away),
      renderMetaSummary(form, home, away),
      "</div>",
    ].join("");
  }

  function fieldInput(label, key, type, value) {
    return "<div class=\"mrw-field\"><label>" + label + "</label><input data-mrw=\"" + key + "\" type=\"" + type + "\" value=\"" + escapeHtml(value) + "\" /></div>";
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
      "<div class=\"mrw-score-sep\">:</div>",
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
    var players = teamPlayers(records, team, quarter);
    var totals = statTotals(team, quarter);
    return [
      "<div class=\"mrw-stat-team\"><div class=\"mrw-stat-team-title\"><span>" + teamLabel(team) + "</span><span class=\"mrw-stat-total\">골 " + totals.goals + " · 도움 " + totals.assists + "</span></div>",
      "<div class=\"mrw-stat-list\">",
      players.length ? players.map(function (player) { return renderPlayerStat(team, player, quarter); }).join("") : "<div class=\"mrw-empty\">선수 정보 없음</div>",
      "</div></div>",
    ].join("");
  }

  function renderPlayerStat(team, player, quarter) {
    player = playerName(player);
    var stat = state.summaryStats[statKey(team, player, quarter)] || { goals: 0, assists: 0 };
    return [
      "<div class=\"mrw-stat-row\"><div class=\"mrw-stat-name\"><span class=\"mrw-name\">" + escapeHtml(player) + "</span>" + renderRole(player) + "</div>",
      renderCounter(team, player, "goals", "골", stat.goals, quarter),
      renderCounter(team, player, "assists", "도움", stat.assists, quarter),
      "</div>",
    ].join("");
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

  function renderEditModal(form) {
    return [
      "<div class=\"mrw-modal-backdrop\" data-mrw-action=\"close-edit-modal\"><div class=\"mrw-modal\">",
      "<div class=\"mrw-modal-head\"><div><h4 class=\"mrw-modal-title\">기존 기록 수정</h4><p class=\"mrw-modal-sub\">수정할 경기 날짜를 선택해서 기록을 불러옵니다.</p></div><button type=\"button\" class=\"mrw-icon-close\" data-mrw-action=\"close-edit-modal\" aria-label=\"닫기\">×</button></div>",
      "<div class=\"mrw-modal-body\"><div class=\"mrw-field\"><label>경기일</label><input data-mrw=\"editDate\" type=\"date\" value=\"" + escapeHtml(state.editDate || form.date) + "\" /></div><div class=\"mrw-fixed\">기록 키: " + escapeHtml(compactDate(state.editDate || form.date)) + "</div></div>",
      "<div class=\"mrw-modal-foot\"><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"close-edit-modal\">닫기</button><button type=\"button\" class=\"mrw-button mrw-primary\" data-mrw-action=\"load-edit-date\">기록 불러오기</button></div>",
      "</div></div>",
    ].join("");
  }

  function bindPanel(panel) {
    var dateInput = panel.querySelector("[data-mrw=date]");
    var idInput = panel.querySelector("[data-mrw=matchId]");
    dateInput.addEventListener("change", function () {
      idInput.value = compactDate(dateInput.value);
      state.loadedRecord = null;
      state.loadedPlayers = null;
      state.loadedForm = null;
      state.editingMatchId = "";
      state.conflict = null;
      renderPanel();
    });
    ["startTime", "venueName", "awayTeam", "memo"].forEach(function (key) {
      var element = panel.querySelector("[data-mrw=" + key + "]");
      if (element) element.addEventListener("change", renderPanel);
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-duration]"), function (button) {
      button.addEventListener("click", function () {
        panel.querySelector("[data-mrw=duration]").value = button.getAttribute("data-mrw-duration") || "2";
        renderPanel();
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-kind]"), function (button) {
      button.addEventListener("click", function () {
        state.matchKind = button.getAttribute("data-mrw-kind") === "MATCH" ? "MATCH" : "SELF";
        state.loadedRecord = null;
        state.loadedPlayers = null;
        state.loadedForm = null;
        state.editingMatchId = "";
        panel.querySelector("[data-mrw=matchKind]").value = state.matchKind;
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
    var loadEditDate = panel.querySelector("[data-mrw-action=load-edit-date]");
    if (loadEditDate) loadEditDate.addEventListener("click", loadEditRecordByDate);
    panel.querySelector("[data-mrw-action=preview]").addEventListener("click", function () { saveRecord(true, false); });
    panel.querySelector("[data-mrw-action=save]").addEventListener("click", function () { saveRecord(false, Boolean(state.editingMatchId)); });
  }

  function openEditModal() {
    var panel = document.getElementById(PANEL_ID);
    var dateInput = panel && panel.querySelector("[data-mrw=date]");
    state.editDate = (dateInput && dateInput.value) || state.editDate || todayInputValue();
    state.editModalOpen = true;
    state.status = "";
    renderPanel();
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
      quarters: payloadRecords(parseQuarterCards()),
      events: state.events,
      summaryStats: summaryStatsArray(),
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

  async function loadRecord(matchIdOverride) {
    try {
      var panel = document.getElementById(PANEL_ID);
      var matchId = matchIdOverride || panel.querySelector("[data-mrw=matchId]").value.trim() || compactDate(panel.querySelector("[data-mrw=date]").value);
      if (!matchId) {
        state.status = "불러올 기록 날짜를 선택해주세요.";
        renderPanel();
        return;
      }
      resetRecordEntryState();
      state.status = "기존 기록을 불러오는 중...";
      renderPanel();

      var response = await fetch("/api/match-record?matchId=" + encodeURIComponent(matchId), { method: "GET", headers: { accept: "application/json" } });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.detail || data.error || "경기 기록을 찾지 못했습니다.");

      applyStaffRoles(data.staffRoles);
      state.events = Array.isArray(data.events) ? data.events : [];
      setSummaryStatsFromArray(data.summaryStats);
      setTeamScoresFromArray(data.teamScores, data.scoreOverride);
      state.loadedPlayers = normalizeLoadedPlayers(data.players) || emptyLoadedPlayers();
      state.conflict = null;
      state.loadedRecord = data;
      state.editingMatchId = data.matchId || matchId;
      state.matchKind = data.matchKind === "MATCH" ? "MATCH" : "SELF";
      state.editModalOpen = false;
      state.selectedScope = "";

      var matchDate = dateInputFromFirebase(data.matchDate);
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
      if (!dryRun) state.editingMatchId = "";
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
      if (document.getElementById("lineup-result") && mutations.some(shouldObserveMutation)) scheduleRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
