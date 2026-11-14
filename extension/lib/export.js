// JSON / CSV export and JSON import.
(function (g) {
  "use strict";
  const S = g.Sedec;
  const FORMAT = "sedecordle-tracker";

  const sortGames = (games) => games.slice().sort((a, b) =>
    (a.startedAt ?? a.updatedAt ?? 0) - (b.startedAt ?? b.updatedAt ?? 0) || a.id.localeCompare(b.id));

  function toJSON(games) {
    return JSON.stringify({ format: FORMAT, schema: S.SCHEMA, exportedAt: Date.now(), games: sortGames(games) }, null, 2);
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const csv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : "");

  function gamesCSV(games) {
    const rows = [["id", "mode", "daily_number", "seed", "status", "guesses_used", "boards_solved",
      "started_at", "finished_at", "duration_s", "guesses", "solved_at", "answers", "verified", "source"]];
    for (const r of sortGames(games)) {
      const d = S.derive(r);
      const dur = Number.isFinite(r.startedAt) && Number.isFinite(r.finishedAt)
        ? Math.round((r.finishedAt - r.startedAt) / 1000) : "";
      rows.push([r.id, r.mode, r.dailyNumber, r.seed, r.status, d.guessesUsed, d.boardsSolved,
        iso(r.startedAt), iso(r.finishedAt), dur,
        r.guesses.map((x) => x.word).join(" "),
        d.solvedAt.map((x) => (x < 0 ? -1 : x + 1)).join(";"), // 1-based guess number, -1 = unsolved
        d.answers.join(" "), r.verified, r.source]);
    }
    return csv(rows);
  }

  function guessesCSV(games) {
    const rows = [["game_id", "mode", "daily_number", "index", "word", "time", "think_ms",
      "boards_solved_by_this", "boards_left_after"]];
    for (const r of sortGames(games)) {
      const d = S.derive(r);
      r.guesses.forEach((gs, i) => {
        const solvedNow = d.solvedAt.filter((x) => x === i).length;
        const left = d.solvedAt.filter((x) => x < 0 || x > i).length;
        rows.push([r.id, r.mode, r.dailyNumber, i + 1, gs.word, iso(gs.t), d.thinkMs[i], solvedNow, left]);
      });
    }
    return csv(rows);
  }

  // Accepts our export format, or a bare array of records.
  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error("Not valid JSON."); }
    let list;
    if (Array.isArray(data)) list = data;
    else if (data && data.format === FORMAT && Array.isArray(data.games)) {
      if (data.schema > S.SCHEMA) throw new Error(`File uses schema ${data.schema}; this version understands up to ${S.SCHEMA}.`);
      list = data.games;
    } else throw new Error("This file isn't a Sedecordle Tracker export.");
    const games = [];
    let rejected = 0;
    for (const r of list) {
      const clean = S.sanitizeRecord(r);
      if (clean) games.push(clean); else rejected++;
    }
    return { games, rejected };
  }

  // Newer updatedAt wins per id. Returns the records that should be written.
  function mergePlan(existing, incoming) {
    const byId = new Map(existing.map((r) => [r.id, r]));
    const write = [];
    let added = 0, updated = 0, skipped = 0;
    for (const r of incoming) {
      const cur = byId.get(r.id);
      if (!cur) { write.push(r); added++; }
      else if ((r.updatedAt || 0) > (cur.updatedAt || 0)) { write.push(r); updated++; }
      else skipped++;
    }
    return { write, added, updated, skipped };
  }

  g.SedecExport = { FORMAT, toJSON, gamesCSV, guessesCSV, parseImport, mergePlan, sortGames };
})(globalThis);
