// Deterministic, plausible-looking sample games for previewing extension pages outside the extension.
// Sets window.__sedecTestArea, which the pages use instead of chrome.storage.
(function () {
  const area = SedecStore.memoryArea();
  window.__sedecTestArea = area;
  const rnd = Sedec.MersenneTwister(7);
  const pick = (arr) => arr[rnd.int31() % arr.length];
  const openers = ["crane", "slate", "trace", "salet", "crane", "crane", "roate"];
  const fillers = ["toils", "dumpy", "gawky", "chomp", "build", "fjord", "whisk", "vying", "mulch", "sworn"];
  const today = Sedec.dailySeedFor(new Date());
  const DAY = 86400000;

  function add(mode, seed, start, opts) {
    const ans = Sedec.answersForSeed(seed);
    const order = ans.slice().sort(() => (rnd.int31() % 3) - 1);
    let words = [pick(openers)];
    const extra = 1 + (rnd.int31() % 6);
    for (let i = 0; i < extra; i++) {
      const w = pick(fillers);
      if (!words.includes(w) && !ans.includes(w)) words.push(w);
    }
    for (const a of order) if (!words.includes(a)) words.push(a);
    if (opts && opts.cut) words = words.slice(0, opts.cut);
    words = words.slice(0, 21);
    const r = Sedec.newRecord(mode, seed, { startedAt: start });
    let t = start;
    r.guesses = words.map((w, i) => ({ word: w, t: (t += (i === 0 ? 20000 : 8000) + (rnd.int31() % (i < 6 ? 60000 : 25000))) }));
    const d = Sedec.derive(r);
    r.status = opts && opts.status ? opts.status : d.outcome;
    r.finishedAt = r.status === "won" || r.status === "lost" ? t : null;
    r.verified = true;
    area.data[SedecStore.PREFIX + r.id] = r;
  }

  // ~45 dailies over the last 50 days (a few skipped), recent streak intact.
  for (let back = 50; back >= 0; back--) {
    if (back > 6 && rnd.int31() % 9 === 0) continue;
    const seed = today - back;
    const start = Date.now() - back * DAY - 3600000;
    add("daily", seed, start, back === 0 ? { cut: 9 } : null);
  }
  // Some free games, one abandoned.
  for (let i = 0; i < 14; i++) {
    const start = Date.now() - (40 - i * 3) * DAY + 5 * 3600000;
    add("free", start, start, i === 5 ? { cut: 4, status: "abandoned" } : null);
  }
})();
