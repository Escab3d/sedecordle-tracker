// Aggregate statistics over stored game records. Pure functions; needs lib/sedecordle.js.
(function (g) {
  "use strict";
  const S = g.Sedec;

  const isFinished = (r) => r.status === "won" || r.status === "lost";
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  function median(xs) {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const when = (r) => r.startedAt ?? (r.guesses[0] && r.guesses[0].t) ?? r.updatedAt ?? 0;

  // mode: "" | "daily" | "free"; sinceMs: only games started at/after this time.
  function filter(games, { mode = "", sinceMs = null } = {}) {
    return games.filter((r) => (!mode || r.mode === mode) && (sinceMs == null || when(r) >= sinceMs));
  }

  // Daily streaks, the way the site counts them: consecutive daily numbers won.
  // The current streak counts only if the last win was today or yesterday.
  function streaks(games, todaySeed) {
    const won = new Set(games.filter((r) => r.mode === "daily" && r.status === "won").map((r) => r.seed));
    const seeds = [...won].sort((a, b) => a - b);
    let best = 0, run = 0, prev = null;
    for (const s of seeds) {
      run = prev !== null && s === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = s;
    }
    let current = 0;
    let s = won.has(todaySeed) ? todaySeed : todaySeed - 1;
    while (won.has(s)) { current++; s--; }
    return { current, best };
  }

  function summary(games) {
    const fin = games.filter(isFinished);
    const wins = fin.filter((r) => r.status === "won");
    const durations = fin.filter((r) => Number.isFinite(r.startedAt) && Number.isFinite(r.finishedAt))
      .map((r) => r.finishedAt - r.startedAt).filter((d) => d > 0);
    return {
      played: fin.length,
      wins: wins.length,
      losses: fin.length - wins.length,
      winRate: fin.length ? wins.length / fin.length : null,
      avgGuesses: avg(wins.map((r) => r.guesses.length)),
      bestGuesses: wins.length ? Math.min(...wins.map((r) => r.guesses.length)) : null,
      medianDurationMs: median(durations),
      avgBoardsOnLoss: avg(fin.filter((r) => r.status === "lost").map((r) => S.derive(r).boardsSolved)),
    };
  }

  // Wins by guesses used (16..21) plus losses ("X").
  function distribution(games) {
    const out = [];
    for (let n = S.BOARDS; n <= S.MAX_GUESSES; n++) out.push({ key: String(n), count: 0 });
    out.push({ key: "X", count: 0 });
    for (const r of games.filter(isFinished)) {
      if (r.status === "lost") out[out.length - 1].count++;
      else {
        const b = out.find((o) => o.key === String(r.guesses.length));
        if (b) b.count++;
      }
    }
    return out;
  }

  // Per opening word: results plus how much the opener revealed on average per board.
  function openers(games) {
    const map = new Map();
    for (const r of games.filter(isFinished)) {
      if (!r.guesses.length) continue;
      const w = r.guesses[0].word;
      const d = S.derive(r);
      let greens = 0, yellows = 0;
      for (const fb of d.feedback[0]) for (const c of fb) { if (c === "G") greens++; else if (c === "Y") yellows++; }
      const e = map.get(w) || { word: w, games: 0, wins: 0, guessesOnWins: [], greens: 0, yellows: 0 };
      e.games++;
      if (r.status === "won") { e.wins++; e.guessesOnWins.push(r.guesses.length); }
      e.greens += greens / S.BOARDS;
      e.yellows += yellows / S.BOARDS;
      map.set(w, e);
    }
    return [...map.values()].map((e) => ({
      word: e.word, games: e.games, wins: e.wins,
      winRate: e.wins / e.games,
      avgGuesses: avg(e.guessesOnWins),
      greensPerBoard: e.greens / e.games,
      yellowsPerBoard: e.yellows / e.games,
    })).sort((a, b) => b.games - a.games || (a.avgGuesses ?? 99) - (b.avgGuesses ?? 99));
  }

  // Per board position (0..15): average guess number it was solved on, how often it was
  // the last one solved (won games), and how often it was left unsolved (lost games).
  function boards(games) {
    const fin = games.filter(isFinished);
    const pos = Array.from({ length: S.BOARDS }, (_, i) => ({ board: i, solveGuesses: [], last: 0, unsolved: 0 }));
    let wonCount = 0, lostCount = 0;
    for (const r of fin) {
      const { solvedAt } = S.derive(r);
      solvedAt.forEach((x, i) => { if (x >= 0) pos[i].solveGuesses.push(x + 1); else pos[i].unsolved++; });
      if (r.status === "won") {
        wonCount++;
        pos[solvedAt.indexOf(Math.max(...solvedAt))].last++;
      } else lostCount++;
    }
    return {
      wonCount, lostCount,
      positions: pos.map((p) => ({
        board: p.board, avgSolveGuess: avg(p.solveGuesses),
        lastCount: p.last, lastShare: wonCount ? p.last / wonCount : null,
        unsolvedCount: p.unsolved,
      })),
    };
  }

  // Median thinking time by guess number (1..21), from live-timed guesses only.
  // Guess 1 is measured from when the game was opened/created, so it includes setup time.
  function thinking(games) {
    const by = Array.from({ length: S.MAX_GUESSES }, () => []);
    for (const r of games) {
      if (r.status === "abandoned") continue;
      S.derive(r).thinkMs.forEach((ms, i) => { if (ms != null && ms > 0 && ms < 30 * 60000) by[i].push(ms); });
    }
    return by.map((xs, i) => ({ guess: i + 1, medianMs: median(xs), samples: xs.length }));
  }

  // One point per finished game, oldest first.
  function trend(games) {
    return games.filter(isFinished).sort((a, b) => when(a) - when(b)).map((r) => {
      const d = S.derive(r);
      return { id: r.id, mode: r.mode, dailyNumber: r.dailyNumber, at: when(r), status: r.status,
        guesses: r.guesses.length, boardsSolved: d.boardsSolved };
    });
  }

  g.SedecStats = { isFinished, filter, streaks, summary, distribution, openers, boards, thinking, trend, median, avg, when };
})(globalThis);
