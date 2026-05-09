(function () {
  "use strict";

  var PREFIX = "dev-planner:";
  var DEFAULT_MATCH_QUARTERS = 3;
  var POSITIONS = ["GK", "CF", "LW", "RW", "MF", "LB", "RB", "CB"];
  var FIELD_POSITIONS = ["CF", "LW", "RW", "MF", "LB", "RB", "CB"];
  var GUEST_ADD_TEXT = "\uc6a9\ubcd1 \ucd94\uac00";
  var LOAD_TEXT = "\ubd88\ub7ec\uc624\uae30";
  var NAME_PLACEHOLDER = "\uc774\ub984";
  var GUEST_LABEL = "\uc6a9\ubcd1";
  var PEOPLE_SUFFIX = "\uba85";

  function readStored(key, fallback) {
    try {
      var raw = window.localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (_) {
      // Ignore localStorage write failures.
    }
  }

  function unique(items) {
    var seen = {};
    return items.filter(function (item) {
      if (!item || seen[item]) return false;
      seen[item] = true;
      return true;
    });
  }

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function selectedPositionButtons(section) {
    return Array.prototype.filter.call(section.querySelectorAll("button"), function (button) {
      return POSITIONS.indexOf(cleanText(button.textContent)) >= 0 && button.className.indexOf("bg-slate-900") >= 0;
    });
  }

  function readGuestForm(button) {
    var section = button && button.closest("section");
    if (!section) return null;

    var nameInput = Array.prototype.find.call(section.querySelectorAll("input"), function (input) {
      return input.getAttribute("placeholder") === NAME_PLACEHOLDER;
    });
    var name = nameInput ? nameInput.value.trim() : "";
    if (!name) return null;

    var selected = selectedPositionButtons(section);
    var primary = cleanText(selected[0] && selected[0].textContent);
    if (FIELD_POSITIONS.indexOf(primary) < 0) primary = "CF";
    var secondary = selected
      .slice(1)
      .map(function (item) { return cleanText(item.textContent); })
      .filter(function (item) { return FIELD_POSITIONS.indexOf(item) >= 0 && item !== primary; })
      .slice(0, 1);
    var scores = Array.prototype.map.call(section.querySelectorAll("select"), function (select) {
      var value = Number(select.value);
      return Number.isFinite(value) ? value : 5;
    });
    var memoInput = Array.prototype.find.call(section.querySelectorAll("input"), function (input) {
      return input !== nameInput && input.type !== "hidden";
    });

    return {
      name: name,
      primaryPosition: primary,
      secondaryPositions: secondary,
      attackScore: scores[0] || 5,
      midScore: scores[1] || 5,
      defenseScore: scores[2] || 5,
      activityScore: scores[3] || 5,
      memo: memoInput && memoInput.value.trim() ? memoInput.value.trim() : undefined,
    };
  }

  function makeTempGuest(form) {
    return {
      id: "temp_" + Date.now() + "_" + form.name,
      source: "TEMP_GUEST",
      memberType: "GUEST",
      active: true,
      name: form.name,
      primaryPosition: form.primaryPosition,
      secondaryPositions: form.secondaryPositions,
      attackScore: form.attackScore,
      midScore: form.midScore,
      defenseScore: form.defenseScore,
      activityScore: form.activityScore,
      canGk: true,
      memo: form.memo,
    };
  }

  function readGuestCount() {
    var text = document.body ? document.body.innerText : "";
    var pattern = new RegExp(GUEST_LABEL + "\\s+(\\d+)" + PEOPLE_SUFFIX);
    var match = text.match(pattern);
    return match ? Number(match[1]) : 0;
  }

  function captureRosterState() {
    return {
      tempGuests: readStored("tempGuests", []),
      fieldIds: readStored("fieldIds", []),
      waitingIds: readStored("waitingIds", []),
      matchQuarterLimits: readStored("matchQuarterLimits", {}),
      guestCount: readGuestCount(),
    };
  }

  function saveGuestFallback(form, before) {
    var after = captureRosterState();
    var tempGuest = makeTempGuest(form);
    var newlyAddedIds = after.fieldIds.filter(function (id) { return before.fieldIds.indexOf(id) < 0; });
    var nextLimits = Object.assign({}, after.matchQuarterLimits);
    newlyAddedIds.forEach(function (id) { delete nextLimits[id]; });
    nextLimits[tempGuest.id] = DEFAULT_MATCH_QUARTERS;

    writeStored("tempGuests", before.tempGuests.concat([tempGuest]));
    writeStored("fieldIds", unique(after.fieldIds.filter(function (id) {
      return newlyAddedIds.indexOf(id) < 0;
    }).concat(before.fieldIds, [tempGuest.id])));
    writeStored("waitingIds", after.waitingIds.filter(function (id) { return newlyAddedIds.indexOf(id) < 0; }));
    writeStored("matchQuarterLimits", nextLimits);
    window.location.reload();
  }

  function handleGuestAddClick(button) {
    var form = readGuestForm(button);
    if (!form) return;
    var before = captureRosterState();
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      var afterGuests = readStored("tempGuests", []);
      if (afterGuests.length > before.tempGuests.length || readGuestCount() > before.guestCount) {
        window.clearInterval(timer);
        return;
      }
      if (attempts >= 10) {
        window.clearInterval(timer);
        saveGuestFallback(form, before);
      }
    }, 100);
  }

  function restoreMigratedTempGuests(before) {
    var after = captureRosterState();
    var afterIds = new Set(after.tempGuests.map(function (guest) { return guest.id; }));
    var missing = before.tempGuests.filter(function (guest) { return !afterIds.has(guest.id); });
    if (missing.length === 0) return;

    var missingIds = new Set(missing.map(function (guest) { return guest.id; }));
    var nextLimits = Object.assign({}, after.matchQuarterLimits);
    missing.forEach(function (guest) {
      nextLimits[guest.id] = before.matchQuarterLimits[guest.id] || DEFAULT_MATCH_QUARTERS;
    });

    writeStored("tempGuests", after.tempGuests.concat(missing));
    writeStored("fieldIds", unique(after.fieldIds.filter(function (id) {
      return before.fieldIds.indexOf(id) >= 0;
    }).concat(before.fieldIds.filter(function (id) {
      return missingIds.has(id);
    }))));
    writeStored("waitingIds", unique(after.waitingIds.filter(function (id) {
      return before.waitingIds.indexOf(id) >= 0;
    }).concat(before.waitingIds.filter(function (id) {
      return missingIds.has(id);
    }))));
    writeStored("matchQuarterLimits", nextLimits);
    window.location.reload();
  }

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("button") : null;
    if (!button) return;
    var label = cleanText(button.textContent);
    if (label === GUEST_ADD_TEXT) {
      handleGuestAddClick(button);
      return;
    }
    if (label === LOAD_TEXT) {
      var before = captureRosterState();
      if (before.tempGuests.length === 0) return;
      window.setTimeout(function () { restoreMigratedTempGuests(before); }, 1200);
    }
  }, true);
})();
