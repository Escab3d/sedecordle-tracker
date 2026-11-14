// Turns events from the page hook into stored game records.
// Events (all carry t = ms timestamp, path = page path):
//   {kind:"open",     mode, seed}          site wrote last_daily / last_free
//   {kind:"guesses",  mode, seed, words, pageAnswers?}   site saved the guess list (one new guess)
//   {kind:"snapshot", mode, seed, words}   state found on page load (no live timing)
//   {kind:"reset",    mode:"free", seed}   site deleted the free game ("New game")
(function (g) {
  "use strict";
  const S = g.Sedec;

  function makeRecorder(store) {
    const openedAt = new Map(); // id -> t, for daily start times seen in this page
    let chain = Promise.resolve();

    function handle(ev) {
      const p = chain.then(() => process(ev));
      chain = p.catch((e) => console.warn("[sedecordle-tracker]", e));
      return p;
    }

    function valid(ev) {
      return ev && (ev.mode === "daily" || ev.mode === "free") &&
        Number.isFinite(ev.seed) && ev.seed >= 0 && Number.isFinite(ev.t) &&
        (!ev.words || (Array.isArray(ev.words) && ev.words.every(S.isWord)));
    }

    async function process(ev) {
      if (!valid(ev)) return;
      switch (ev.kind) {
        case "open":
          openedAt.set(S.gameId(ev.mode, ev.seed), ev.t);
          await closeOthers(ev.mode, ev.seed);
          break;
        case "guesses":
          await closeOthers(ev.mode, ev.seed);
          await upsert(ev, true);
          break;
        case "snapshot":
          await upsert(ev, false);
          break;
        case "reset": {
          const rec = await store.get(S.gameId(ev.mode, ev.seed));
          if (rec && rec.status === "in_progress") {
            rec.status = "abandoned";
            rec.updatedAt = Date.now();
            await store.put(rec);
          }
          break;
        }
      }
    }

    // A new daily (higher seed) or a different free game means older unfinished ones were left.
    async function closeOthers(mode, seed) {
      const id = S.gameId(mode, seed);
      const stale = (await store.getAll()).filter((r) =>
        r.mode === mode && r.status === "in_progress" && r.id !== id &&
        (mode === "free" || r.seed < seed));
      for (const r of stale) { r.status = "abandoned"; r.updatedAt = Date.now(); }
      await store.putMany(stale);
    }

    async function upsert(ev, live) {
      const words = ev.words || [];
      if (!words.length) return; // "" is written when a new daily starts; nothing to record
      const id = S.gameId(ev.mode, ev.seed);
      let rec = await store.get(id);
      if (!rec) {
        rec = S.newRecord(ev.mode, ev.seed, {
          source: live ? "live" : "backfill",
          site: { path: ev.path || "/" },
        });
        if (ev.mode === "daily") rec.startedAt = openedAt.get(id) ?? null;
      }

      const old = rec.guesses;
      let k = 0;
      while (k < old.length && k < words.length && old[k].word === words[k]) k++;
      if (k === words.length) return; // nothing new (reload, or an older/shorter list)

      rec.guesses = words.map((w, i) =>
        i < k ? old[i] : { word: w, t: live && i === words.length - 1 ? ev.t : null });

      const d = S.derive(rec);
      if (d.outcome !== "in_progress") {
        rec.status = d.outcome;
        if (rec.finishedAt == null && live) rec.finishedAt = ev.t;
      } else {
        rec.status = "in_progress";
      }
      if (Array.isArray(ev.pageAnswers) && ev.pageAnswers.length === S.BOARDS) {
        rec.verified = ev.pageAnswers.every((a, i) => a === d.answers[i]);
        if (!rec.verified) rec.pageAnswers = ev.pageAnswers.slice();
      }
      rec.updatedAt = Date.now();
      await store.put(rec);
    }

    return { handle, idle: () => chain };
  }

  g.SedecRecorder = { makeRecorder };
})(globalThis);
