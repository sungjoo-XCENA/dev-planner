(function () {
  "use strict";

  var STYLE_ID = "match-record-widget-polish-style";
  var ROLE_PATTERN = /(코치|감독|단장)$/;

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".mrw-score-row{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)!important;gap:28px!important}",
      ".mrw-side{min-height:86px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:6px!important;padding:14px 42px!important;text-align:center!important}",
      ".mrw-team-name{max-width:100%!important;font-size:13px!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}",
      ".mrw-score-num{font-size:48px!important;line-height:.95!important;text-align:center!important}",
      ".mrw-score-hint,.mrw-qscore{display:none!important}",
      ".mrw-score-minus{right:8px!important;top:8px!important;z-index:2!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(15,23,42,.36)!important;width:30px!important;height:30px!important;font-size:18px!important;line-height:1!important;box-shadow:0 4px 12px rgba(15,23,42,.18)!important}",
      ".mrw-stat-row{grid-template-columns:minmax(78px,1fr) auto auto!important;gap:6px!important;padding:7px!important}",
      ".mrw-counter{grid-template-columns:24px 24px 16px 24px!important;gap:2px!important;min-width:98px!important;box-sizing:border-box!important}",
      ".mrw-counter-label{white-space:nowrap!important;line-height:1!important;text-align:center!important}",
      ".mrw-counter button{width:24px!important;height:24px!important;line-height:1!important}",
      ".mrw-counter-value{line-height:1!important}",
      "@media(max-width:760px){.mrw-score-row{gap:12px!important}.mrw-side{min-height:76px!important;padding:12px 36px!important}.mrw-team-name{font-size:12px!important}.mrw-score-minus{right:6px!important;top:6px!important;width:28px!important;height:28px!important;font-size:17px!important}.mrw-counter{grid-template-columns:22px 23px 16px 23px!important;min-width:92px!important}.mrw-counter button{width:23px!important;height:23px!important}}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function stripAttachedRoles() {
    document.querySelectorAll("#match-record-widget-panel .mrw-name").forEach(function (node) {
      var text = (node.textContent || "").trim();
      var match = text.match(ROLE_PATTERN);
      if (!match) return;
      node.textContent = text.replace(ROLE_PATTERN, "").trim();
      var nameWrap = node.parentElement;
      if (!nameWrap || nameWrap.querySelector(".mrw-role")) return;
      var badge = document.createElement("span");
      badge.className = "mrw-role " + roleClass(match[1]);
      badge.textContent = match[1];
      nameWrap.appendChild(badge);
    });
  }

  function removeInactiveEditButtons() {
    document
      .querySelectorAll("#match-record-widget-panel [data-mrw-edit-score-team], #match-record-widget-panel [data-mrw-edit-stat-quarter]")
      .forEach(function (button) {
        button.remove();
      });
  }

  function roleClass(role) {
    if (role === "감독") return "mrw-role-manager";
    if (role === "단장") return "mrw-role-director";
    return "mrw-role-coach";
  }

  function applyPolish() {
    installStyle();
    stripAttachedRoles();
    removeInactiveEditButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyPolish);
  } else {
    applyPolish();
  }

  new MutationObserver(applyPolish).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
