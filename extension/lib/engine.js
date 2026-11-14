// Post-game grading engine. Runs in a Web Worker (pages/engine-worker.js) or on the main thread (tests).
// Needs lib/words.js and lib/sedecordle.js.
//
// Model. Every board needs exactly one guess equal to its answer, so
//   total guesses = 16 + (guesses that solved no board).
// Playing well = wasting as few guesses as possible. For a candidate guess g in a position:
//   value(g) = E[boards solved by g] + H(g) / max(Hmax, 1 bit)
// where H(g) is the expected information (bits, summed over unsolved boards) and Hmax is the most
// information any guess could get there. A pure probe is worth at most 1; playing a board's only
// remaining answer ("free solve") is worth 1 + its information, so free solves always rank first.
//   skill = value(yours) / value(best), and any free solve counts as 1 (it costs no extra guess)
//   luck  = actual outcome − expected outcome (same units)
// The bot plays the same answers by always choosing the highest-value guess.
(function (g) {
  "use strict";
  const VERSION = 1;
  const SOLVED = 242; // GGGGG in base 3 (G=2, Y=1, B=0, first letter = lowest digit)

  let W = null, table = null, opening = null;
  const cnt = new Int8Array(26);
  const counts = new Uint16Array(243);
  const touched = new Uint8Array(243);

  function init() {
    if (W) return W;
    const answers = g.SEDEC_WORDS.answers, guesses = answers.concat(g.SEDEC_WORDS.allowed);
    const A = answers.length, G = guesses.length;
    const codes = new Uint8Array(G * 5);
    guesses.forEach((w, i) => { for (let c = 0; c < 5; c++) codes[i * 5 + c] = w.charCodeAt(c) - 97; });
    const gIndex = new Map(guesses.map((w, i) => [w, i]));
    const clog = new Float64Array(A + 1);
    for (let c = 2; c <= A; c++) clog[c] = c * Math.log2(c);
    const full = new Int32Array(A);
    for (let i = 0; i < A; i++) full[i] = i;
    W = { answers, guesses, A, G, codes, gIndex, clog, full };
    return W;
  }

  // Pattern of guess gi against answer ai (answers are the first A guess indices).
  function patternIdx(gi, ai) {
    const c = W.codes, go = gi * 5, ao = ai * 5;
    let p = 0, mul = 1, greens = 0;
    for (let i = 0; i < 5; i++) {
      if (c[go + i] === c[ao + i]) greens |= 1 << i; else cnt[c[ao + i]]++;
    }
    for (let i = 0; i < 5; i++, mul *= 3) {
      if (greens & (1 << i)) p += 2 * mul;
      else if (cnt[c[go + i]] > 0) { p += mul; cnt[c[go + i]]--; }
    }
    for (let i = 0; i < 5; i++) cnt[c[ao + i]] = 0;
    return p;
  }

  function encode(fb) { // "GYB.." -> code
    let p = 0, mul = 1;
    for (let i = 0; i < 5; i++, mul *= 3) p += (fb[i] === "G" ? 2 : fb[i] === "Y" ? 1 : 0) * mul;
    return p;
  }

  function buildTable(onProgress) {
    init();
    if (table) return table;
    const { A, G } = W;
    const t = new Uint8Array(G * A);
    for (let gi = 0; gi < G; gi++) {
      const off = gi * A;
      for (let ai = 0; ai < A; ai++) t[off + ai] = patternIdx(gi, ai);
      if (onProgress && gi % 1000 === 0) onProgress({ phase: "table", done: gi, total: G });
    }
    table = t;
    return table;
  }

  // Pattern row for any word: a view into the table, or computed on the fly for unknown words.
  function rowFor(word) {
    const gi = W.gIndex.get(word);
    if (gi !== undefined) return table.subarray(gi * W.A, (gi + 1) * W.A);
    const row = new Uint8Array(W.A);
    for (let ai = 0; ai < W.A; ai++) row[ai] = encode(g.Sedec.score(word, W.answers[ai]));
    return row;
  }

  // Unsolved boards grouped by identical candidate arrays (all boards share one array at the start).
  function groupsOf(boards) {
    const m = new Map();
    for (const b of boards) {
      if (b.solved) continue;
      const e = m.get(b.cand);
      if (e) e.mult++; else m.set(b.cand, { cand: b.cand, mult: 1 });
    }
    return [...m.values()];
  }

  // Expected information (bits) and expected boards solved for one guess row.
  function evaluate(row, off, groups) {
    let H = 0, ps = 0;
    const clog = W.clog;
    for (let k = 0; k < groups.length; k++) {
      const { cand, mult } = groups[k];
      const n = cand.length;
      if (n === 1) { if (row[off + cand[0]] === SOLVED) ps += mult; continue; }
      let nt = 0;
      for (let j = 0; j < n; j++) {
        const p = row[off + cand[j]];
        if (counts[p]++ === 0) touched[nt++] = p;
      }
      // The SOLVED bucket holds at most one word (the guess itself, if it is still possible).
      if (counts[SOLVED]) ps += mult / n;
      let s = 0;
      for (let j = 0; j < nt; j++) { const p = touched[j]; s += clog[counts[p]]; counts[p] = 0; }
      H += mult * (Math.log2(n) - s / n);
    }
    return [H, ps];
  }

  // Score every valid guess in a position.
  function search(groups) {
    const { G, A } = W;
    const H = new Float64Array(G), PS = new Float64Array(G);
    let Hmax = 0;
    for (let gi = 0; gi < G; gi++) {
      const r = evaluate(table, gi * A, groups);
      H[gi] = r[0]; PS[gi] = r[1];
      if (r[0] > Hmax) Hmax = r[0];
    }
    // Information is measured against the best probe, but never against less than 1 bit, so the
    // tiny leftovers of the endgame can't inflate small differences into big skill/luck swings.
    const R = Math.max(Hmax, 1);
    const value = (gi) => PS[gi] + H[gi] / R;
    // Top 3 by value; ties prefer more expected solves (a free solve beats an equal probe),
    // then list order (answers first).
    const cmp = (a, b) => (Math.abs(b.v - a.v) > 1e-12 ? b.v - a.v : PS[b.gi] - PS[a.gi] || a.gi - b.gi);
    const top = [];
    for (let gi = 0; gi < G; gi++) {
      const c = { gi, v: value(gi) };
      if (top.length < 3 || cmp(c, top[top.length - 1]) < 0) {
        top.push(c);
        top.sort(cmp);
        if (top.length > 3) top.pop();
      }
    }
    return { H, PS, Hmax, R, value, top };
  }

  function newBoards(answerIdx) {
    return answerIdx.map((ai) => ({ ai, cand: W.full, solved: false }));
  }

  function apply(boards, row) {
    let solvedNow = 0, bits = 0;
    for (const b of boards) {
      if (b.solved) continue;
      const n0 = b.cand.length;
      const p = row[b.ai];
      if (p === SOLVED) { b.solved = true; solvedNow++; bits += Math.log2(n0); b.cand = Int32Array.of(b.ai); continue; }
      const next = [];
      for (let j = 0; j < n0; j++) if (row[b.cand[j]] === p) next.push(b.cand[j]);
      b.cand = Int32Array.from(next);
      bits += Math.log2(n0) - Math.log2(b.cand.length);
    }
    return { solvedNow, bits };
  }

  function searchAt(groups, stepIndex) {
    if (stepIndex === 0) return opening || (opening = search(groups));
    return search(groups);
  }

  const MAX_BOT = 30;
  function simulateBot(answerIdx) {
    const boards = newBoards(answerIdx), words = [];
    for (let i = 0; i < MAX_BOT && boards.some((b) => !b.solved); i++) {
      const s = searchAt(groupsOf(boards), i);
      const gi = s.top[0].gi;
      words.push(W.guesses[gi]);
      apply(boards, table.subarray(gi * W.A, (gi + 1) * W.A));
    }
    const solvedAll = boards.every((b) => b.solved);
    return { words, guesses: words.length, won: solvedAll && words.length <= g.Sedec.MAX_GUESSES };
  }

  function analyseGame(rec, { onProgress } = {}) {
    init();
    buildTable(onProgress);
    const answers = g.Sedec.answersForSeed(rec.seed);
    const ansIndex = new Map(W.answers.map((w, i) => [w, i]));
    const answerIdx = answers.map((w) => ansIndex.get(w));
    const boards = newBoards(answerIdx);
    const steps = [];
    const n = rec.guesses.length;

    for (let i = 0; i < n; i++) {
      if (boards.every((b) => b.solved)) break;
      const groups = groupsOf(boards);
      const unsolved = boards.filter((b) => !b.solved);
      const singles = unsolved.filter((b) => b.cand.length === 1);
      const totalBefore = unsolved.reduce((s, b) => s + b.cand.length, 0);
      const s = searchAt(groups, i);

      const word = rec.guesses[i].word;
      const gi = W.gIndex.get(word);
      const row = rowFor(word);
      const [H, ps] = gi !== undefined ? [s.H[gi], s.PS[gi]] : evaluate(row, 0, groups);
      const value = ps + H / s.R;
      const best = s.top[0];
      const playedSingle = singles.some((b) => W.answers[b.cand[0]] === word);

      const out = apply(boards, row);
      const actual = out.solvedNow + out.bits / s.R;
      steps.push({
        word,
        value, H, ps,
        best: s.top.map((t) => ({ word: W.guesses[t.gi], value: t.v, H: s.H[t.gi], ps: s.PS[t.gi] })),
        bestValue: best.v,
        Hmax: s.Hmax,
        // Any free solve costs zero extra guesses; the one-step model can't reliably rank their order.
        skill: playedSingle ? 1 : best.v > 0 ? Math.min(1, value / best.v) : 1,
        luck: actual - value,
        solvedNow: out.solvedNow,
        bitsGained: out.bits,
        singlesBefore: singles.length,
        unsolvedBefore: unsolved.length,
        totalBefore,
        freeSolve: playedSingle,
        missedFree: singles.length > 0 && out.solvedNow === 0,
        wasted: out.solvedNow === 0,
      });
      if (onProgress) onProgress({ phase: "game", done: i + 1, total: n });
    }

    if (onProgress) onProgress({ phase: "bot", done: 0, total: 1 });
    const bot = simulateBot(answerIdx);
    const skills = steps.map((x) => x.skill);
    return {
      version: VERSION,
      id: rec.id,
      gameUpdatedAt: rec.updatedAt,
      analysedAt: Date.now(),
      steps,
      summary: {
        guesses: n,
        boardsSolved: boards.filter((b) => b.solved).length,
        wasted: steps.filter((x) => x.wasted).length,
        missedFree: steps.filter((x) => x.missedFree).length,
        freeSolves: steps.filter((x) => x.freeSolve).length,
        avgSkill: skills.length ? skills.reduce((a, b) => a + b, 0) / skills.length : null,
        luck: steps.reduce((a, x) => a + x.luck, 0),
        bot,
      },
    };
  }

  g.SedecEngine = { VERSION, init, buildTable, patternIdx, encode, analyseGame, simulateBot,
    _internal: { groupsOf, search, newBoards, apply, evaluate, get W() { return W; }, get table() { return table; } } };
})(globalThis);
