// Sedecordle game model, shared by the capture extension and (later) the analysis app.
// Pure functions only; needs globalThis.SEDEC_WORDS (lib/words.js) for answer generation.
// Everything here mirrors sedecordle.com's own logic (see docs/SITE_FINDINGS.md).
(function (g) {
  "use strict";

  const BOARDS = 16;
  const MAX_GUESSES = 21;
  const DAILY_OFFSET = 720; // "Daily #N" = seed - 720
  const SCHEMA = 1;

  // ---- MT19937, identical output to the site's mersenne2.js (init_genrand + genrand_int31) ----
  function MersenneTwister(seed) {
    const mt = new Uint32Array(624);
    let mti = 624;
    mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i++) {
      const s = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(s, 1812433253) + i) >>> 0;
    }
    function int32() {
      if (mti >= 624) {
        let kk = 0, y;
        for (; kk < 624 - 397; kk++) {
          y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
          mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        for (; kk < 623; kk++) {
          y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
          mt[kk] = mt[kk - 227] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
        mt[623] = mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        mti = 0;
      }
      let y = mt[mti++];
      y ^= y >>> 11;
      y ^= (y << 7) & 0x9d2c5680;
      y ^= (y << 15) & 0xefc60000;
      y ^= y >>> 18;
      return y >>> 0;
    }
    return { int31: () => int32() >>> 1 };
  }

  // ---- answers ----
  const answerCache = new Map();
  function answersForSeed(seed, list) {
    list = list || g.SEDEC_WORDS.answers;
    if (!list) throw new Error("SEDEC_WORDS not loaded");
    if (answerCache.has(seed)) return answerCache.get(seed).slice();
    const rnd = MersenneTwister(seed);
    for (let i = 0; i < 8; i++) rnd.int31();
    let a;
    do {
      a = [];
      for (let i = 0; i < BOARDS; i++) a.push(list[rnd.int31() % list.length]);
    } while (new Set(a).size !== BOARDS);
    if (answerCache.size > 500) answerCache.clear();
    answerCache.set(seed, a);
    return a.slice();
  }

  // ---- daily numbering (local time, with the site's DST quirk) ----
  function dailySeedFor(date) {
    date = date || new Date();
    const start = new Date("02/13/2022");
    const jan = new Date(0, 1), jul = new Date(6, 1);
    const dst = date.getTimezoneOffset() != Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    const offset = dst ? 3600 * 1000 : 0;
    return (DAILY_OFFSET + (date.getTime() - start.getTime() + offset) / 86400000) >> 0;
  }
  const dailyNumber = (seed) => seed - DAILY_OFFSET;

  // ---- feedback: standard Wordle two-pass, same as the site's identify_guess ----
  // Returns a 5-char string of G (green), Y (yellow), B (grey).
  function score(guess, answer) {
    const ans = answer.split("");
    const out = ["B", "B", "B", "B", "B"];
    for (let i = 0; i < 5; i++) {
      if (guess[i] === ans[i]) { out[i] = "G"; ans[i] = " "; }
    }
    for (let i = 0; i < 5; i++) {
      if (out[i] === "G") continue;
      const j = ans.indexOf(guess[i]);
      if (j !== -1) { out[i] = "Y"; ans[j] = " "; }
    }
    return out.join("");
  }

  const isWord = (w) => typeof w === "string" && /^[a-z]{5}$/.test(w);
  function isValidGuess(w) {
    const W = g.SEDEC_WORDS;
    return isWord(w) && (!W || W.answers.includes(w) || W.allowed.includes(w));
  }

  // ---- records ----
  const gameId = (mode, seed) => `${mode}-${seed}`;

  function newRecord(mode, seed, extra) {
    const now = Date.now();
    return Object.assign({
      schema: SCHEMA,
      id: gameId(mode, seed),
      mode,
      seed,
      dailyNumber: mode === "daily" ? dailyNumber(seed) : null,
      site: { path: "/" },
      startedAt: mode === "free" ? seed : null, // free seed is the creation timestamp
      finishedAt: null,
      status: "in_progress",
      guesses: [],
      verified: null,
      source: "live",
      updatedAt: now,
    }, extra || {});
  }

  // Everything that can be recomputed from seed + guesses.
  function derive(rec) {
    const answers = answersForSeed(rec.seed);
    const solvedAt = new Array(BOARDS).fill(-1);
    const feedback = [];
    rec.guesses.forEach((gs, i) => {
      feedback.push(answers.map((a, b) => (solvedAt[b] >= 0 ? null : score(gs.word, a))));
      answers.forEach((a, b) => { if (solvedAt[b] < 0 && a === gs.word) solvedAt[b] = i; });
    });
    const boardsSolved = solvedAt.filter((x) => x >= 0).length;
    const n = rec.guesses.length;
    const outcome = boardsSolved === BOARDS ? "won" : n >= MAX_GUESSES ? "lost" : "in_progress";
    const thinkMs = rec.guesses.map((gs, i) => {
      const prev = i === 0 ? rec.startedAt : rec.guesses[i - 1].t;
      return gs.t != null && prev != null ? gs.t - prev : null;
    });
    return { answers, solvedAt, feedback, boardsSolved, guessesUsed: n, outcome, thinkMs };
  }

  // Basic shape check for imported records. Returns a cleaned record or null.
  function sanitizeRecord(r) {
    if (!r || typeof r !== "object") return null;
    if (r.mode !== "daily" && r.mode !== "free") return null;
    const seed = Number(r.seed);
    if (!Number.isFinite(seed) || seed < 0) return null;
    if (!Array.isArray(r.guesses)) return null;
    const guesses = [];
    for (const gs of r.guesses) {
      const word = typeof gs === "string" ? gs : gs && gs.word;
      if (!isWord(word)) return null;
      const t = gs && typeof gs === "object" && Number.isFinite(gs.t) ? gs.t : null;
      guesses.push({ word, t });
    }
    const statuses = ["in_progress", "won", "lost", "abandoned"];
    const base = newRecord(r.mode, seed);
    const out = Object.assign(base, {
      site: r.site && typeof r.site.path === "string" ? { path: r.site.path } : base.site,
      startedAt: Number.isFinite(r.startedAt) ? r.startedAt : base.startedAt,
      finishedAt: Number.isFinite(r.finishedAt) ? r.finishedAt : null,
      status: statuses.includes(r.status) ? r.status : "in_progress",
      guesses,
      verified: typeof r.verified === "boolean" ? r.verified : null,
      source: typeof r.source === "string" ? r.source : "import",
      updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
    });
    if (guesses.length > MAX_GUESSES) return null;
    // Status must agree with the guesses for finished games.
    const d = derive(out);
    if (d.outcome !== "in_progress") out.status = d.outcome;
    else if (out.status === "won" || out.status === "lost") out.status = "in_progress";
    return out;
  }

  g.Sedec = {
    BOARDS, MAX_GUESSES, DAILY_OFFSET, SCHEMA,
    MersenneTwister, answersForSeed, dailySeedFor, dailyNumber,
    score, isWord, isValidGuess, gameId, newRecord, derive, sanitizeRecord,
  };
})(globalThis);
