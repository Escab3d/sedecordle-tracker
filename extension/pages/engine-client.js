// Page-side access to the grading engine: cached results, one shared worker, jobs run one at a time.
// Only finished (or abandoned) games are ever analysed.
(function (g) {
  "use strict";
  const WORKER_URL = new URL("engine-worker.js", document.currentScript.src).href;
  let worker = null, nextJob = 1;
  const pending = new Map();
  let chain = Promise.resolve();

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL);
    worker.onmessage = (e) => {
      const m = e.data, p = pending.get(m.job);
      if (!p) return;
      if (m.type === "progress") p.onProgress && p.onProgress(m);
      else if (m.type === "result") { pending.delete(m.job); p.resolve(m.result); }
      else if (m.type === "error") { pending.delete(m.job); p.reject(new Error(m.message)); }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "engine worker failed"));
      pending.clear();
      worker = null;
    };
    return worker;
  }

  const analysable = (rec) => rec && rec.status !== "in_progress" && rec.guesses.length > 0;
  // Pages load lib/engine.js only for its VERSION (nothing heavy runs until analyseGame is called).
  const fresh = (a, rec) => !!a && a.version === g.SedecEngine.VERSION && a.gameUpdatedAt === rec.updatedAt;

  function runInWorker(rec, onProgress) {
    return new Promise((resolve, reject) => {
      const job = nextJob++;
      pending.set(job, { resolve, reject, onProgress });
      getWorker().postMessage({ type: "analyse", job, rec });
    });
  }

  // Returns the cached analysis if it is current, otherwise computes and caches it.
  function analyse(store, rec, { onProgress, force } = {}) {
    if (!analysable(rec)) return Promise.reject(new Error("Only finished games can be analysed."));
    const p = chain.then(async () => {
      if (!force) {
        const cached = await store.getAnalysis(rec.id);
        if (fresh(cached, rec)) return cached;
      }
      const result = await runInWorker(rec, onProgress);
      await store.putAnalysis(result);
      return result;
    });
    chain = p.catch(() => {});
    return p;
  }

  async function cachedFor(store, games) {
    const all = await store.getAllAnalyses();
    const byId = new Map(all.map((a) => [a.id, a]));
    const out = new Map();
    for (const r of games) { const a = byId.get(r.id); if (fresh(a, r)) out.set(r.id, a); }
    return out;
  }

  g.SedecEngineClient = { analyse, analysable, cachedFor, isFresh: fresh };
})(globalThis);
