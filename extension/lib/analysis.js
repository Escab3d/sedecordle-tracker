// Post-game analysis helpers. Only ever run on games that are over (see replay page).
// Needs lib/words.js and lib/sedecordle.js.
(function (g) {
  "use strict";
  const S = g.Sedec;

  // For every board, which answer-list words were still possible after each guess.
  // Returns {
  //   steps: n + 1 (step k = after k guesses; step 0 = before any guess),
  //   boards: [ { answer, solvedAt, counts: [n+1], lists: [n+1] (word arrays when ≤ maxList, else null) } ×16 ],
  //   perStep: [ { totalLeft, unsolved, singles } ×(n+1) ]  (totals over boards not yet solved at that step)
  // }
  function candidateTrace(rec, { maxList = 12, pool } = {}) {
    pool = pool || g.SEDEC_WORDS.answers; // answers only ever come from the answer list
    const d = S.derive(rec);
    const n = rec.guesses.length;
    const boards = d.answers.map((answer, b) => {
      let cur = pool;
      const counts = [cur.length], lists = [cur.length <= maxList ? cur.slice() : null];
      for (let i = 0; i < n; i++) {
        const fb = d.feedback[i][b];
        if (fb !== null) {
          const word = rec.guesses[i].word;
          cur = cur.filter((w) => S.score(word, w) === fb);
        }
        // Solved boards stay at their final single candidate.
        counts.push(cur.length);
        lists.push(cur.length <= maxList ? cur.slice() : null);
      }
      return { answer, solvedAt: d.solvedAt[b], counts, lists };
    });
    const perStep = [];
    for (let k = 0; k <= n; k++) {
      let totalLeft = 0, unsolved = 0, singles = 0;
      boards.forEach((bd) => {
        const solved = bd.solvedAt >= 0 && bd.solvedAt < k;
        if (solved) return;
        unsolved++;
        totalLeft += bd.counts[k];
        if (bd.counts[k] === 1) singles++;
      });
      perStep.push({ totalLeft, unsolved, singles });
    }
    return { steps: n + 1, derived: d, boards, perStep };
  }

  g.SedecAnalysis = { candidateTrace };
})(globalThis);
