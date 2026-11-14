/* Sedecordle Tracker: bookmarklet capture script. Runs on sedecordle.com when you tap the bookmark.
   1. Turns on guess timing for this tab (until reload): times are kept in the site's localStorage
      under "sedecordle-tracker-times", so they survive until you save the game.
   2. Shows a small panel that sends the current daily / free game to the tracker web app.
   It only reads the site's saved game; it never changes it. */
(function () {
  "use strict";
  var SRC = document.currentScript && document.currentScript.src;
  var APP = window.__sedecTrackerAppBase || (SRC ? new URL(".", SRC).href : null);
  var TEST = window.__sedecTrackerTest === true;
  if (!TEST && !/(^|\.)sedecordle\.com$/.test(location.hostname)) {
    alert("Sedecordle Tracker: open sedecordle.com first, then use the bookmark there.");
    return;
  }
  var TIMES_KEY = "sedecordle-tracker-times";
  var ls;
  try { ls = window.localStorage; } catch (e) { alert("Sedecordle Tracker: this page's storage is blocked."); return; }
  var proto = Storage.prototype;
  var origGet = window.__sedecTrackerOrigGet || proto.getItem;
  var origSet = window.__sedecTrackerOrigSet || proto.setItem;
  window.__sedecTrackerOrigGet = origGet;
  window.__sedecTrackerOrigSet = origSet;

  function get(k) { try { return origGet.call(ls, k); } catch (e) { return null; } }
  function seedOf(mode) { var v = get(mode === "daily" ? "last_daily" : "last_free"); return v ? Number(v) : NaN; }
  function wordsOf(mode) { var v = get(mode + "_guesses"); return v ? v.split(",").filter(Boolean) : []; }
  function idOf(mode) { return mode + "-" + seedOf(mode); }
  function loadTimes() { try { return JSON.parse(get(TIMES_KEY)) || {}; } catch (e) { return {}; } }
  function saveTimes(t) {
    /* keep only the games the site still has */
    var keep = {}, ids = [idOf("daily"), idOf("free")];
    for (var k in t) if (ids.indexOf(k) !== -1) keep[k] = t[k];
    try { origSet.call(ls, TIMES_KEY, JSON.stringify(keep)); } catch (e) {}
  }
  function entry(t, id) { return t[id] || (t[id] = { start: null, t: {} }); }

  /* ---- 1. timing hook (once per tab; the extension's hook counts too) ---- */
  var hookNew = false;
  if (!window.__sedecTrackerHook) {
    window.__sedecTrackerHook = "bookmarklet";
    hookNew = true;
    proto.setItem = function (key, value) {
      var watch = this === ls && (key === "daily_guesses" || key === "free_guesses" || key === "last_daily" || key === "last_free");
      var prev = watch && key.slice(-8) === "_guesses" ? origGet.call(this, key) : null;
      var r = origSet.apply(this, arguments);
      if (watch) {
        try {
          var now = Date.now(), t = loadTimes();
          if (key === "last_daily" || key === "last_free") {
            var e0 = entry(t, (key === "last_daily" ? "daily-" : "free-") + Number(value));
            if (e0.start == null && wordsOf(key === "last_daily" ? "daily" : "free").length === 0) e0.start = now;
          } else {
            var mode = key === "daily_guesses" ? "daily" : "free";
            var before = prev ? prev.split(",").filter(Boolean).length : 0;
            var list = String(value).split(",").filter(Boolean);
            if (list.length === before + 1) entry(t, idOf(mode)).t[before] = now;
          }
          saveTimes(t);
        } catch (e) { /* never break the game */ }
      }
      return r;
    };
    /* A game that hasn't started yet starts now. */
    var t0 = loadTimes();
    ["daily", "free"].forEach(function (m) {
      if (isFinite(seedOf(m)) && wordsOf(m).length === 0) { var e = entry(t0, idOf(m)); if (e.start == null) e.start = Date.now(); }
    });
    saveTimes(t0);
  }

  /* ---- 2. snapshot ---- */
  function snapshot() {
    var t = loadTimes(), out = [];
    ["daily", "free"].forEach(function (mode) {
      var seed = seedOf(mode), w = wordsOf(mode);
      if (!w.length || !isFinite(seed)) return;
      var e = t[idOf(mode)] || { start: null, t: {} };
      out.push({
        mode: mode, seed: seed,
        guesses: w.map(function (word, i) { return { word: word, t: e.t[i] != null ? e.t[i] : null }; }),
        startedAt: mode === "daily" ? e.start : null, /* free: the seed is the creation time */
        updatedAt: Date.now(),
        site: { path: location.pathname }
      });
    });
    return out;
  }
  function encode(obj) {
    var b = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* ---- 3. panel ---- */
  var old = document.getElementById("sedec-tracker-panel");
  if (old) old.remove();
  var games = snapshot();
  var p = document.createElement("div");
  p.id = "sedec-tracker-panel";
  p.setAttribute("style", "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;max-width:460px;margin:0 auto;" +
    "background:#1f1f22;color:#ececee;border:1px solid #3a3a40;border-radius:10px;padding:12px 14px;" +
    "font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)");
  function line(text, style) { var d = document.createElement("div"); d.textContent = text; if (style) d.setAttribute("style", style); p.appendChild(d); return d; }
  function button(text, primary, fn) {
    var b = document.createElement("button");
    b.textContent = text;
    b.setAttribute("style", "font:inherit;margin:10px 8px 0 0;padding:7px 14px;border-radius:7px;cursor:pointer;" +
      (primary ? "background:#4fae6e;color:#0d1a12;border:1px solid #4fae6e;font-weight:600" : "background:transparent;color:#ececee;border:1px solid #55555c"));
    b.onclick = fn;
    p.appendChild(b);
    return b;
  }
  line("Sedecordle Tracker", "font-weight:700;margin-bottom:4px");
  line(hookNew ? "Timing is now on in this tab: each guess you make from now on gets a time. Reloading the page turns it off (tap the bookmark again)."
               : "Timing is on in this tab.", "color:#9a9aa0;font-size:13px");
  if (!APP) line("Can't find the tracker app address. Re-create the bookmark from the app's Setup page.", "color:#f2b8b5");
  if (!games.length) {
    line("No game with guesses yet. Play, then tap the bookmark again to save.", "margin-top:6px");
  } else {
    games.forEach(function (g) {
      var timed = g.guesses.filter(function (x) { return x.t != null; }).length;
      line((g.mode === "daily" ? "Daily #" + (g.seed - 720) : "Free play") + ": " + g.guesses.length + " guess" +
        (g.guesses.length === 1 ? "" : "es") + (timed ? " (" + timed + " timed)" : ""), "margin-top:6px");
    });
    if (APP) button("Save to tracker", true, function () {
      var url = APP + "pages/add.html#d=" + encode({ format: "sedecordle-capture", v: 1, capturedAt: Date.now(), games: snapshot() });
      if (TEST) { window.__sedecTrackerLastUrl = url; return; }
      var w = window.open(url, "_blank");
      if (!w) location.href = url;
      p.remove();
    });
  }
  button("Close", false, function () { p.remove(); });
  document.body.appendChild(p);
})();
