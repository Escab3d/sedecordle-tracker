// Isolated-world content script: receives events from hook.js and records them.
// Loaded after lib/words.js, lib/sedecordle.js, lib/store.js, lib/recorder.js.
(function () {
  "use strict";
  const TAG = "__sedecordleTracker";
  const recorder = SedecRecorder.makeRecorder(SedecStore.makeStore());

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || !e.data[TAG]) return;
    const msg = e.data[TAG];
    if (msg.type === "hook-ready") {
      window.postMessage({ [TAG]: { type: "bridge-ready" } }, location.origin);
    } else if (msg.type === "event" && msg.ev && typeof msg.ev === "object") {
      const { kind, mode, seed, words, t, path, pageAnswers } = msg.ev;
      recorder.handle({ kind, mode, seed, words, t, path, pageAnswers });
    }
  });
  window.postMessage({ [TAG]: { type: "bridge-ready" } }, location.origin);
})();
