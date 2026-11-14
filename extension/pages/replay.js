(function () {
  "use strict";
  const S = Sedec, T = SedecStats, A = SedecAnalysis;
  const store = SedecStore.makeStore(window.__sedecTestArea);
  const $ = (id) => document.getElementById(id);

  let games = [];
  let game = null, trace = null, step = 0, analysis = null;

  const statusText = { won: "Won", lost: "Lost", abandoned: "Abandoned", in_progress: "In progress" };
  const label = (r) => (r.mode === "daily" ? `Daily #${r.dailyNumber}` : "Free play");
  const dateStr = (t) => (Number.isFinite(t) ? new Date(t).toLocaleString(undefined,
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  function dur(ms) {
    if (ms == null) return "—";
    const s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  }
  const fmt = (n) => n.toLocaleString();
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function message(text) {
    $("message").textContent = text;
    $("message").hidden = !text;
    $("viewer").hidden = !!text;
  }

  async function init() {
    try { games = await store.getAll(); } catch (e) { games = []; }
    games.sort((a, b) => T.when(b) - T.when(a));
    const sel = $("game-select");
    sel.replaceChildren();
    for (const r of games) {
      const o = el("option", "", `${label(r)} · ${statusText[r.status]}${r.status === "in_progress" ? "" : ` ${r.guesses.length}/21`} · ${dateStr(T.when(r))}`);
      o.value = r.id;
      sel.append(o);
    }
    const wanted = new URLSearchParams(location.search).get("id");
    const first = games.find((r) => r.id === wanted) || games.find((r) => r.status !== "in_progress") || games[0];
    if (!first) { message("No games recorded yet."); return; }
    sel.value = first.id;
    open(first.id);
  }

  function open(id) {
    game = games.find((r) => r.id === id);
    const url = new URL(location.href);
    url.searchParams.set("id", id);
    history.replaceState(null, "", url);
    $("game-meta").textContent = "";
    if (!game) { message("Game not found."); return; }
    $("game-meta").textContent = `${statusText[game.status]} · ${game.guesses.length} guesses · ${dateStr(T.when(game))}`;
    // Analysis is post-game only: never show possibilities for a game that can still be played.
    if (game.status === "in_progress") {
      message("This game is still in progress. Replays are available once it's finished, so the tracker never helps during play.");
      return;
    }
    if (!game.guesses.length) { message("This game has no guesses."); return; }
    message("");
    trace = A.candidateTrace(game);
    analysis = null;
    $("slider").max = String(game.guesses.length);
    renderTable();
    go(Math.min(1, game.guesses.length));
    runAnalysis(game);
  }

  // ---- engine grading ----
  const pct = (x) => Math.round(x * 100) + "%";
  const signed = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2);
  const skillClass = (s) => (s >= 0.95 ? "good" : s >= 0.75 ? "ok" : "poor");

  function runAnalysis(rec) {
    const box = $("analysis");
    box.replaceChildren(el("span", "muted", "Analysing this game…"));
    const bar = el("progress");
    bar.max = 1; bar.value = 0;
    box.append(bar);
    SedecEngineClient.analyse(store, rec, {
      onProgress: (p) => {
        if (game !== rec) return;
        // The one-time pattern table dominates the first run; the game itself is quick.
        bar.value = p.phase === "table" ? 0.7 * p.done / p.total : p.phase === "game" ? 0.7 + 0.25 * p.done / p.total : 0.97;
      },
    }).then((res) => {
      if (game !== rec) return;
      analysis = res;
      renderAnalysis();
      renderTable();
      render();
    }).catch((err) => {
      if (game !== rec) return;
      box.replaceChildren(el("span", "muted", "Analysis failed: " + err.message));
    });
  }

  function renderAnalysis() {
    const s = analysis.summary, box = $("analysis");
    box.replaceChildren();
    const stats = el("div", "row-stats");
    const stat = (k, v, title) => {
      const e = el("div", "stat");
      e.append(el("div", "v", v), el("div", "k", k));
      if (title) e.title = title;
      stats.append(e);
    };
    const you = game.status === "won" ? `${s.guesses}` : game.status === "lost" ? `X (${s.boardsSolved}/16)` : `${s.guesses}…`;
    stat("your guesses", you);
    stat("bot on the same answers", s.bot.won ? String(s.bot.guesses) : `${s.bot.guesses} (lost)`,
      "The bot always plays the highest-value guess, and free solves first.");
    stat("wasted guesses", String(s.wasted), "Guesses that solved no board. A win always needs 16 solving guesses, so wins take 16 + wasted.");
    stat("missed free solves", String(s.missedFree), "Wasted guesses made while some board was already down to one possible answer.");
    stat("average skill", s.avgSkill == null ? "—" : pct(s.avgSkill));
    stat("luck", signed(s.luck), "Sum over guesses of (actual result − expected result), in the same units as value.");
    const bot = el("div", "bot");
    bot.append("Bot's game: ", el("span", "words", s.bot.words.map((w) => w.toUpperCase()).join(" ")));
    box.append(stats, bot);
  }

  function go(k) {
    step = Math.max(0, Math.min(game.guesses.length, k));
    $("slider").value = String(step);
    render();
  }

  function render() {
    const n = game.guesses.length, d = trace.derived;
    const lab = $("step-label");
    lab.replaceChildren();
    if (step === 0) lab.append("Before the first guess");
    else lab.append(`After guess ${step} of ${n}: `, el("span", "word", game.guesses[step - 1].word.toUpperCase()));

    // Summary for the current step.
    const ps = trace.perStep[step];
    const solvedNow = step ? d.solvedAt.filter((x) => x === step - 1).length : 0;
    const sum = $("step-summary");
    sum.replaceChildren();
    const item = (k, v) => { const s = el("span"); s.append(k + " ", el("b", "", v)); sum.append(s); };
    item("Boards left:", String(ps.unsolved));
    item("Possibilities left:", fmt(ps.totalLeft));
    if (step) item("Solved by this guess:", String(solvedNow));
    item("Boards down to 1 possibility:", String(ps.singles));
    if (step && d.thinkMs[step - 1] != null) item("Time on this guess:", dur(d.thinkMs[step - 1]));
    const a = analysis && step ? analysis.steps[step - 1] : null;
    if (a) {
      const sk = el("span");
      sk.append("Skill: ", el("span", "skill " + skillClass(a.skill), pct(a.skill)));
      sum.append(sk);
      const best = el("span");
      best.append("Best here: ");
      a.best.forEach((b, i) => { if (i) best.append(", "); best.append(el("span", "best", b.word.toUpperCase())); });
      sum.append(best);
      if (a.freeSolve) sum.append(el("span", "tag-flag free", "Free solve"));
      else if (a.missedFree) sum.append(el("span", "tag-flag missed", "Missed free solve"));
    }

    // Boards.
    const showAns = $("show-answers").checked, onlyCur = $("only-current").checked;
    const wrap = $("boards");
    wrap.replaceChildren();
    trace.boards.forEach((bd, b) => {
      const solved = bd.solvedAt >= 0 && bd.solvedAt < step;
      const just = solved && bd.solvedAt === step - 1;
      const left = bd.counts[step];
      const card = el("div", "board" + (just ? " just-solved" : solved ? " solved" : left === 1 ? " single" : ""));
      const head = el("div", "board-head");
      const name = el("span");
      name.append(`${b + 1} `);
      if (showAns) name.append(el("span", "ans", bd.answer.toUpperCase()));
      const count = solved ? el("span", "count done", `✓ guess ${bd.solvedAt + 1}`)
        : el("span", "count" + (left === 1 ? " one" : ""), `${fmt(left)} left`);
      head.append(name, count);
      card.append(head);

      const rows = el("div", "rows");
      const lastRow = solved ? bd.solvedAt : step - 1;
      for (let i = onlyCur ? Math.max(0, step - 1) : 0; i <= lastRow && i < step; i++) {
        const fb = d.feedback[i][b];
        if (fb === null) continue;
        const row = el("div", "row" + (i === step - 1 ? " current" : ""));
        const w = game.guesses[i].word;
        for (let c = 0; c < 5; c++) row.append(el("div", "tile " + fb[c], w[c]));
        rows.append(row);
      }
      card.append(rows);

      if (!solved && bd.lists[step]) {
        const c = el("div", "cands");
        bd.lists[step].forEach((w, i) => {
          if (i) c.append(" ");
          c.append(el("span", showAns && w === bd.answer ? "is-answer" : "", w));
        });
        card.append(c);
      }
      wrap.append(card);
    });

    // Table highlight.
    [...$("guess-table").tBodies[0].rows].forEach((tr, i) => {
      tr.classList.toggle("on", i === step - 1);
      tr.classList.toggle("future", i >= step);
    });
  }

  function renderTable() {
    const d = trace.derived;
    const tb = $("guess-table").tBodies[0];
    tb.replaceChildren();
    game.guesses.forEach((g, i) => {
      const tr = el("tr");
      const solved = d.solvedAt.filter((x) => x === i).length;
      const before = trace.perStep[i], after = trace.perStep[i + 1];
      const wordTd = el("td", "word", g.word.toUpperCase());
      if (before.singles > 0 && solved === 0) {
        const f = el("span", "flag", "●");
        f.title = `${before.singles} board${before.singles === 1 ? " was" : "s were"} down to one possibility before this guess`;
        wordTd.append(f);
      }
      const a = analysis && analysis.steps[i];
      const skillTd = el("td", "num");
      const luckTd = el("td", "num");
      if (a) {
        const sk = el("span", "skill " + skillClass(a.skill), pct(a.skill));
        sk.title = a.freeSolve ? "Free solve" : `Best: ${a.best.map((b) => b.word.toUpperCase()).join(", ")}`;
        skillTd.append(sk);
        luckTd.append(el("span", "luck " + (a.luck > 0.05 ? "pos" : a.luck < -0.05 ? "neg" : ""), signed(a.luck)));
      } else if (analysis === null) {
        skillTd.textContent = "…";
      }
      tr.append(el("td", "num", String(i + 1)), wordTd, el("td", "num", dur(d.thinkMs[i])),
        el("td", "num", solved ? "✓".repeat(solved) : ""),
        el("td", "num", `${fmt(before.totalLeft)} → ${fmt(after.totalLeft)}`), skillTd, luckTd);
      tr.addEventListener("click", () => go(i + 1));
      tb.append(tr);
    });
  }

  $("game-select").onchange = (e) => open(e.target.value);
  $("slider").oninput = (e) => go(Number(e.target.value));
  $("first").onclick = () => go(0);
  $("prev").onclick = () => go(step - 1);
  $("next").onclick = () => go(step + 1);
  $("last").onclick = () => go(game.guesses.length);
  $("show-answers").onchange = render;
  $("only-current").onchange = render;
  document.addEventListener("keydown", (e) => {
    // Skip when a control has focus (the slider handles its own arrow keys).
    if (!game || !trace || e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight") { go(step + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { go(step - 1); e.preventDefault(); }
    else if (e.key === "Home") { go(0); e.preventDefault(); }
    else if (e.key === "End") { go(game.guesses.length); e.preventDefault(); }
  });

  init();
})();
