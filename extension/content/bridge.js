// Isolated-world content script: receives events from hook.js and records them.
// Loaded after lib/words.js, lib/sedecordle.js, lib/store.js, lib/recorder.js, lib/sync.js.
(function () {
  "use strict";
  const TAG = "__sedecordleTracker";
  const store = SedecStore.makeStore();
  const recorder = SedecRecorder.makeRecorder(store);

  // When a game has just finished, push it to the other devices (no-op if sync isn't set up).
  async function syncIfFinished(mode, seed) {
    const rec = await store.get(Sedec.gameId(mode, seed));
    if (rec && (rec.status === "won" || rec.status === "lost") && rec.finishedAt && Date.now() - rec.finishedAt < 15000) {
      SedecSync.autoSync(store, { force: true });
    }
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || !e.data[TAG]) return;
    const msg = e.data[TAG];
    if (msg.type === "hook-ready") {
      window.postMessage({ [TAG]: { type: "bridge-ready" } }, location.origin);
    } else if (msg.type === "event" && msg.ev && typeof msg.ev === "object") {
      const { kind, mode, seed, words, t, path, pageAnswers } = msg.ev;
      const done = recorder.handle({ kind, mode, seed, words, t, path, pageAnswers });
      if (kind === "guesses" && globalThis.SedecSync) done.then(() => syncIfFinished(mode, seed)).catch(() => {});
    }
  });
  window.postMessage({ [TAG]: { type: "bridge-ready" } }, location.origin);
})();
