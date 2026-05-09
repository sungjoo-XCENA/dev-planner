(function () {
  "use strict";

  var PANEL_ID = "match-record-widget-panel";
  var STYLE_ID = "match-record-widget-style";
  var TEAM_LABELS = { A: "형광팀", B: "주황팀" };
  var state = { events: [], status: "", conflict: null };

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".mrw-card{margin-top:16px;border:1px solid #dbe3ef;border-radius:18px;background:#fff;padding:18px;box-shadow:0 1px 2px rgba(15,23,42,.06);font-family:inherit}",
      ".mrw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}",
      ".mrw-title{margin:0;color:#0f172a;font-size:18px;font-weight:900}",
      ".mrw-help{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.55}",
      ".mrw-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}",
      ".mrw-field{display:flex;flex-direction:column;gap:4px}",
      ".mrw-field label{color:#64748b;font-size:11px;font-weight:800}",
      ".mrw-field input,.mrw-field select,.mrw-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:11px;background:#fff;padding:9px 10px;color:#0f172a;font-size:13px;font-weight:700}",
      ".mrw-field textarea{min-height:40px;resize:vertical}",
      ".mrw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}",
      ".mrw-button{border:0;border-radius:12px;padding:10px 13px;font-size:13px;font-weight:900;cursor:pointer}",
      ".mrw-primary{background:#0f172a;color:#fff}",
      ".mrw-secondary{background:#e2e8f0;color:#0f172a}",
      ".mrw-danger{background:#fee2e2;color:#991b1b}",
      ".mrw-event-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}",
      ".mrw-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;padding:6px 9px;color:#334155;font-size:12px;font-weight:800}",
      ".mrw-chip button{border:0;background:transparent;color:#ef4444;font-weight:900;cursor:pointer}",
      ".mrw-score{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;color:#334155;font-size:12px;font-weight:900}",
      ".mrw-score span{border-radius:999px;background:#f1f5f9;padding:6px 9px}",
      ".mrw-status{margin-top:10px;border-radius:12px;background:#f8fafc;padding:10px;color:#334155;font-size:12px;font-weight:700;line-height:1.5;white-space:pre-wrap}",
      "@media(max-width:640px){.mrw-card{padding:14px}.mrw-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mrw-grid .mrw-wide{grid-column:1/-1}.mrw-button{width:100%}}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function compactDate(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 8);
  }

  function todayInputValue() {
    var date = new Date();
    var yyyy = date.getFullYear();
    var mm = String(date.getMonth() + 1).padStart(2, "0");
    var dd = String(date.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function cleanName(value) {
    return String(value || "")
      .replace(/\b\dQ(?:-GK\d)?\b/g, " ")
      .replace(/\bGK\d\b/g, " ")
      .replace(/\b(코치|감독|단장)\b/g, " ")
      .replace(/[·+]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function unique(values) {
    var seen = Object.create(null);
    var out = [];
    values.forEach(function (value) {
      var name = cleanName(value);
      if (!name || name === "없음" || seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
    return out;
  }

  function directChipNames(container) {
    if (!container) return [];
    return unique(Array.prototype.map.call(container.children || [], function (child) {
      return child.textContent || "";
    }));
  }

  function isVisible(element) {
    return Boolean(element && element.getClientRects && element.getClientRects().length > 0);
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
        var cls = String(child.className || "");
        if (cls.indexOf("flex-col") >= 0) {
          rowParent = child;
          return true;
        }
        return false;
      });
      var rows = Array.prototype.slice.call((rowParent && rowParent.children) || []);
      var attack = directChipNames(rows[0]);
      var mid = directChipNames(rows[1]);
      var defense = directChipNames(rows[2]);
      var gkNames = directChipNames(rows[3]);
      var benchNames = directChipNames(bench && bench.children && bench.children[1]);

      records.push({
        quarter: quarter,
        team: team,
        attack: attack,
        mid: mid,
        defense: defense,
        gk: gkNames[0] || "없음",
        bench: benchNames,
        warnings: [],
      });
    });
    records.sort(function (a, b) {
      return a.quarter === b.quarter ? a.team.localeCompare(b.team) : a.quarter - b.quarter;
    });
    return records;
  }

  function namesFor(records, quarter, team) {
    var selected = records.filter(function (record) {
      return record.quarter === quarter && record.team === team;
    });
    return unique(selected.reduce(function (acc, record) {
      return acc.concat(record.attack, record.mid, record.defense, record.gk, record.bench);
    }, []));
  }

  function optionHtml(names, selected, includeBlank) {
    var html = includeBlank ? "<option value=\"\">없음</option>" : "";
    names.forEach(function (name) {
      var escaped = escapeHtml(name);
      html += "<option value=\"" + escaped + "\"" + (name === selected ? " selected" : "") + ">" + escaped + "</option>";
    });
    return html;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scoreSummary() {
    var a = state.events.filter(function (event) { return event.team === "A"; }).length;
    var b = state.events.filter(function (event) { return event.team === "B"; }).length;
    return { A: a, B: b };
  }

  function renderPanel() {
    var records = parseQuarterCards();
    if (records.length === 0) return;

    installStyle();
    var existing = document.getElementById(PANEL_ID);
    var prevDate = existing && existing.querySelector("[data-mrw=date]") ? existing.querySelector("[data-mrw=date]").value : todayInputValue();
    var prevMatchId = existing && existing.querySelector("[data-mrw=matchId]") ? existing.querySelector("[data-mrw=matchId]").value : compactDate(prevDate);
    var prevTime = existing && existing.querySelector("[data-mrw=time]") ? existing.querySelector("[data-mrw=time]").value : "";
    var prevMemo = existing && existing.querySelector("[data-mrw=memo]") ? existing.querySelector("[data-mrw=memo]").value : "";
    var prevQuarter = Number(existing && existing.querySelector("[data-mrw=quarter]") ? existing.querySelector("[data-mrw=quarter]").value : 1) || 1;
    var prevTeam = existing && existing.querySelector("[data-mrw=team]") ? existing.querySelector("[data-mrw=team]").value : "A";
    var availableNames = namesFor(records, prevQuarter, prevTeam);
    var prevScorer = existing && existing.querySelector("[data-mrw=scorer]") ? existing.querySelector("[data-mrw=scorer]").value : availableNames[0] || "";
    var prevAssist = existing && existing.querySelector("[data-mrw=assist]") ? existing.querySelector("[data-mrw=assist]").value : "";
    if (availableNames.indexOf(prevScorer) < 0) prevScorer = availableNames[0] || "";
    if (availableNames.indexOf(prevAssist) < 0) prevAssist = "";

    var score = scoreSummary();
    var eventHtml = state.events.length === 0
      ? "<span class=\"mrw-chip\">득점 기록 없음</span>"
      : state.events.map(function (event, index) {
        return "<span class=\"mrw-chip\">" + event.quarter + "Q " + TEAM_LABELS[event.team] + " " + escapeHtml(event.scorer) + (event.assist ? " ← " + escapeHtml(event.assist) : "") + "<button type=\"button\" data-mrw-remove=\"" + index + "\">×</button></span>";
      }).join("");

    var panel = existing || document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "mrw-card";
    panel.innerHTML = [
      "<div class=\"mrw-head\"><div><h3 class=\"mrw-title\">경기 기록 저장</h3><p class=\"mrw-help\">라인업 확정 뒤 쿼터별 득점/도움을 입력하면 기존 MatchInfo는 유지하고 dev-planner 쿼터 기록을 함께 저장합니다.</p></div></div>",
      "<div class=\"mrw-grid\">",
      fieldHtml("경기일", "date", "date", prevDate),
      fieldHtml("MatchInfo 키", "matchId", "text", prevMatchId || compactDate(prevDate)),
      fieldHtml("시작 시간", "time", "time", prevTime),
      "<div class=\"mrw-field mrw-wide\"><label>메모</label><textarea data-mrw=\"memo\">" + escapeHtml(prevMemo) + "</textarea></div>",
      "<div class=\"mrw-field\"><label>쿼터</label><select data-mrw=\"quarter\">" + [1, 2, 3, 4].map(function (q) { return "<option value=\"" + q + "\"" + (q === prevQuarter ? " selected" : "") + ">" + q + "Q</option>"; }).join("") + "</select></div>",
      "<div class=\"mrw-field\"><label>팀</label><select data-mrw=\"team\"><option value=\"A\"" + (prevTeam === "A" ? " selected" : "") + ">형광팀</option><option value=\"B\"" + (prevTeam === "B" ? " selected" : "") + ">주황팀</option></select></div>",
      "<div class=\"mrw-field\"><label>득점</label><select data-mrw=\"scorer\">" + optionHtml(availableNames, prevScorer, false) + "</select></div>",
      "<div class=\"mrw-field\"><label>도움</label><select data-mrw=\"assist\">" + optionHtml(availableNames, prevAssist, true) + "</select></div>",
      "</div>",
      "<div class=\"mrw-actions\"><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"add\">득점 추가</button><button type=\"button\" class=\"mrw-button mrw-secondary\" data-mrw-action=\"preview\">저장 미리보기</button><button type=\"button\" class=\"mrw-button mrw-primary\" data-mrw-action=\"save\">Firebase에 저장</button>" + (state.conflict ? "<button type=\"button\" class=\"mrw-button mrw-danger\" data-mrw-action=\"overwrite\">기존 MatchInfo에 PATCH 저장</button>" : "") + "</div>",
      "<div class=\"mrw-score\"><span>형광 Away " + score.A + "</span><span>주황 Home " + score.B + "</span><span>라인업 " + records.length + "개</span></div>",
      "<div class=\"mrw-event-list\">" + eventHtml + "</div>",
      state.status ? "<div class=\"mrw-status\">" + escapeHtml(state.status) + "</div>" : "",
    ].join("");

    if (!existing) {
      var section = document.getElementById("lineup-result");
      section.appendChild(panel);
    }
    bindPanel(panel);
  }

  function fieldHtml(label, key, type, value) {
    return "<div class=\"mrw-field\"><label>" + label + "</label><input data-mrw=\"" + key + "\" type=\"" + type + "\" value=\"" + escapeHtml(value) + "\" /></div>";
  }

  function bindPanel(panel) {
    var dateInput = panel.querySelector("[data-mrw=date]");
    var idInput = panel.querySelector("[data-mrw=matchId]");
    dateInput.addEventListener("change", function () {
      if (!idInput.value.trim()) idInput.value = compactDate(dateInput.value);
    });
    ["quarter", "team"].forEach(function (key) {
      panel.querySelector("[data-mrw=" + key + "]").addEventListener("change", renderPanel);
    });
    panel.querySelector("[data-mrw-action=add]").addEventListener("click", function () {
      var quarter = Number(panel.querySelector("[data-mrw=quarter]").value);
      var team = panel.querySelector("[data-mrw=team]").value;
      var scorer = panel.querySelector("[data-mrw=scorer]").value;
      var assist = panel.querySelector("[data-mrw=assist]").value;
      if (!scorer) {
        state.status = "득점 선수를 선택해주세요.";
      } else {
        state.events.push({ id: "event-" + Date.now(), quarter: quarter, team: team, scorer: scorer, assist: assist || undefined });
        state.status = "";
        state.conflict = null;
      }
      renderPanel();
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-mrw-remove]"), function (button) {
      button.addEventListener("click", function () {
        state.events.splice(Number(button.getAttribute("data-mrw-remove")), 1);
        state.status = "";
        state.conflict = null;
        renderPanel();
      });
    });
    panel.querySelector("[data-mrw-action=preview]").addEventListener("click", function () { saveRecord(true, false); });
    panel.querySelector("[data-mrw-action=save]").addEventListener("click", function () { saveRecord(false, false); });
    var overwrite = panel.querySelector("[data-mrw-action=overwrite]");
    if (overwrite) overwrite.addEventListener("click", function () { saveRecord(false, true); });
  }

  function payloadFromPanel(dryRun, overwriteExisting) {
    var panel = document.getElementById(PANEL_ID);
    return {
      matchId: panel.querySelector("[data-mrw=matchId]").value.trim(),
      matchDate: panel.querySelector("[data-mrw=date]").value,
      matchTime: panel.querySelector("[data-mrw=time]").value,
      memo: panel.querySelector("[data-mrw=memo]").value,
      quarters: parseQuarterCards(),
      events: state.events,
      dryRun: dryRun,
      overwriteExisting: overwriteExisting,
    };
  }

  async function saveRecord(dryRun, overwriteExisting) {
    try {
      var payload = payloadFromPanel(dryRun, overwriteExisting);
      if (!payload.matchId) payload.matchId = compactDate(payload.matchDate);
      state.status = dryRun ? "저장 미리보기 중..." : "Firebase 저장 중...";
      renderPanel();
      var response = await fetch("/api/match-record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      var data = await response.json().catch(function () { return {}; });
      if (response.status === 409 && data.error === "MATCH_EXISTS") {
        state.conflict = data;
        state.status = "이미 같은 MatchInfo 키가 있습니다. 기존 경기: " + [data.existingSummary && data.existingSummary.matchDate, data.existingSummary && data.existingSummary.homeTeamName, data.existingSummary && data.existingSummary.awayTeamName].filter(Boolean).join(" / ");
        renderPanel();
        return;
      }
      if (!response.ok) throw new Error(data.detail || data.error || "경기 기록 저장에 실패했습니다.");
      state.conflict = null;
      state.status = data.message + "\n경로: " + data.path + "\n스코어: 주황 Home " + data.homeGoal + " / 형광 Away " + data.awayGoal;
      renderPanel();
    } catch (error) {
      state.status = error && error.message ? error.message : String(error);
      renderPanel();
    }
  }

  function scheduleRender() {
    window.clearTimeout(scheduleRender.timer);
    scheduleRender.timer = window.setTimeout(renderPanel, 250);
  }

  function boot() {
    installStyle();
    scheduleRender();
    var observer = new MutationObserver(function () {
      if (document.getElementById("lineup-result")) scheduleRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
