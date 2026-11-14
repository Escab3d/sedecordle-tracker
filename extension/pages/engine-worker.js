// Web Worker: runs the grading engine off the page's main thread.
importScripts("../lib/words.js", "../lib/sedecordle.js", "../lib/engine.js");

self.onmessage = (e) => {
  const { type, job, rec } = e.data || {};
  if (type !== "analyse") return;
  try {
    const result = SedecEngine.analyseGame(rec, {
      onProgress: (p) => self.postMessage({ type: "progress", job, ...p }),
    });
    self.postMessage({ type: "result", job, result });
  } catch (err) {
    self.postMessage({ type: "error", job, message: String(err && err.message || err) });
  }
};
