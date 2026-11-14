// Runs in the page's own JS world (MAIN) at document_start, before the site's scripts.
// Watches the site's localStorage writes and forwards game events to bridge.js.
// It only observes: it never changes what the site stores or does.
(function () {
  "use strict";
  if (window.__sedecTrackerHook) return;
  window.__sedecTrackerHook = true;

  const TAG = "__sedecordleTracker";
  const proto = Storage.prototype;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  const origGet = proto.getItem;

  let ready = false;
  const queue = [];

  function post(data) {
    window.postMessage({ [TAG]: data }, location.origin);
  }
  function send(ev) {
    ev.t = Date.now();
    ev.path = location.pathname;
    if (ready) post({ type: "event", ev });
    else queue.push(ev);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || !e.data[TAG]) return;
    if (e.data[TAG].type === "bridge-ready" && !ready) {
      ready = true;
      for (const ev of queue.splice(0)) post({ type: "event", ev });
    }
  });
  post({ type: "hook-ready" });

  function ls() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function get(key) {
    const s = ls();
    try { return s ? origGet.call(s, key) : null; } catch (e) { return null; }
  }
  const seedOf = (mode) => {
    const v = get(mode === "daily" ? "last_daily" : "last_free");
    return v === null || v === "" ? NaN : Number(v);
  };
  const splitWords = (v) => (v ? String(v).split(",").filter(Boolean) : []);
  function pageAnswers() {
    try {
      const a = window.answer;
      return Array.isArray(a) && a.length === 16 ? a.slice() : undefined;
    } catch (e) { return undefined; }
  }

  function onSet(key, value) {
    if (key === "last_daily" || key === "last_free") {
      send({ kind: "open", mode: key === "last_daily" ? "daily" : "free", seed: Number(value) });
    } else if (key === "daily_guesses" || key === "free_guesses") {
      const mode = key === "daily_guesses" ? "daily" : "free";
      send({ kind: "guesses", mode, seed: seedOf(mode), words: splitWords(value), pageAnswers: pageAnswers() });
    }
  }

  proto.setItem = function (key, value) {
    const r = origSet.apply(this, arguments);
    try { if (this === ls()) onSet(String(key), String(value)); } catch (e) { /* never break the site */ }
    return r;
  };

  proto.removeItem = function (key) {
    let resetSeed = NaN;
    try {
      if (this === ls() && String(key) === "free_guesses") resetSeed = seedOf("free");
    } catch (e) { /* ignore */ }
    const r = origRemove.apply(this, arguments);
    if (Number.isFinite(resetSeed)) send({ kind: "reset", mode: "free", seed: resetSeed });
    return r;
  };

  // Whatever is saved right now (e.g. games played before the extension was installed).
  for (const mode of ["daily", "free"]) {
    const words = splitWords(get(mode + "_guesses"));
    const seed = seedOf(mode);
    if (words.length && Number.isFinite(seed)) send({ kind: "snapshot", mode, seed, words });
  }
})();
