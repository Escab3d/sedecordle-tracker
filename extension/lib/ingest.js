// Merges games captured by the bookmarklet (or any snapshot) into the store.
// Unlike JSON import ("newer updatedAt wins"), this merges guess by guess so a later
// capture never throws away timings an earlier one had.
(function (g) {
  "use strict";
  const S = g.Sedec;

  // Combine two records of the same game.
  function mergeGame(existing, incoming) {
    if (!existing) return incoming;
    const a = existing.guesses, b = incoming.guesses;
    let k = 0;
    while (k < a.length && k < b.length && a[k].word === b[k].word) k++;
    let guesses;
    if (k === b.length && a.length >= b.length) guesses = a;           // nothing new
    else if (k === a.length) guesses = b.map((x, i) => ({ word: x.word, t: x.t ?? (a[i] && a[i].t) ?? null }));
    else guesses = b;                                                  // conflicting: trust the newer capture
    const out = Object.assign({}, existing, {
      guesses,
      startedAt: existing.startedAt ?? incoming.startedAt ?? null,
      finishedAt: existing.finishedAt ?? incoming.finishedAt ?? null,
      updatedAt: Date.now(),
    });
    const d = S.derive(out);
    if (d.outcome !== "in_progress") {
      out.status = d.outcome;
      if (out.finishedAt == null) {
        const last = guesses[guesses.length - 1];
        out.finishedAt = last && last.t != null ? last.t : null;
      }
    } else if (existing.status !== "abandoned" || guesses !== a) {
      out.status = "in_progress";
    }
    return out;
  }

  // records: already sanitized (Sedec.sanitizeRecord). Returns a summary per game.
  async function ingest(store, records) {
    const results = [];
    for (const inc of records) {
      const cur = await store.get(inc.id);
      const merged = mergeGame(cur, inc);
      const changed = !cur || JSON.stringify(cur.guesses) !== JSON.stringify(merged.guesses) || cur.status !== merged.status;
      if (changed) await store.put(merged);
      results.push({ id: merged.id, record: merged, isNew: !cur, changed });
    }
    // Same rule as the extension: a newer daily, or a different free game, means older
    // unfinished ones of that mode were left behind.
    const all = await store.getAll();
    const stale = [];
    for (const r of all) {
      if (r.status !== "in_progress") continue;
      const newer = records.some((inc) => inc.mode === r.mode && inc.id !== r.id &&
        (r.mode === "free" || inc.seed > r.seed)); // the site keeps only one free game at a time
      if (newer) { r.status = "abandoned"; r.updatedAt = Date.now(); stale.push(r); }
    }
    await store.putMany(stale);
    return results;
  }

  // Bookmarklet payload: base64url(JSON) in the URL fragment.
  function decodePayload(fragment) {
    let s = String(fragment || "").replace(/^#/, "");
    const m = s.match(/(?:^|&)d=([^&]+)/);
    if (!m) throw new Error("No game data in this link.");
    s = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    let json;
    try { json = decodeURIComponent(escape(atob(s))); } catch (e) { throw new Error("The game data in this link is damaged."); }
    const data = JSON.parse(json);
    if (!data || data.format !== "sedecordle-capture" || !Array.isArray(data.games)) throw new Error("This link isn't from the Sedecordle Tracker bookmarklet.");
    const games = [];
    let rejected = 0;
    for (const r of data.games) {
      const clean = S.sanitizeRecord(Object.assign({}, r, { source: "bookmarklet" }));
      if (clean) games.push(clean); else rejected++;
    }
    return { games, rejected, capturedAt: data.capturedAt };
  }

  g.SedecIngest = { mergeGame, ingest, decodePayload };
})(globalThis);
