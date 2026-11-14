(function () {
  "use strict";
  const S = Sedec, T = SedecStats, C = SedecCharts;
  const store = SedecStore.makeStore(window.__sedecTestArea);
  const $ = (id) => document.getElementById(id);
  let all = [];
  let boardMetric = "last";

  const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
  const num = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
  function dur(ms) {
    if (ms == null) return "—";
    const s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  }
  const dateStr = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const gameLabel = (p) => (p.mode === "daily" ? `Daily #${p.dailyNumber}` : "Free play");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function tile(k, v, s) {
    const t = el("div", "tile");
    t.append(el("div", "k", k), el("div", "v", v));
    if (s) t.append(el("div", "s", s));
    return t;
  }

  async function load() {
    try { all = await store.getAll(); } catch (e) { all = []; }
    render();
  }

  function render() {
    const mode = $("f-mode").value;
    const days = Number($("f-period").value) || null;
    const games = T.filter(all, { mode, sinceMs: days ? Date.now() - days * 86400000 : null });
    const finished = games.filter(T.isFinished);
    const timed = games.filter((r) => r.status !== "abandoned").reduce((n, r) => n + r.guesses.filter((g) => g.t != null).length, 0);
    $("f-note").textContent = `${finished.length} finished game${finished.length === 1 ? "" : "s"}`;
    $("empty").hidden = finished.length > 0;
    $("content").hidden = finished.length === 0;
    if (!finished.length) return;

    // Tiles
    const sum = T.summary(games);
    const st = T.streaks(all, S.dailySeedFor(new Date()));
    $("tiles").replaceChildren(
      tile("Played", String(sum.played), `${sum.wins} won · ${sum.losses} lost`),
      tile("Win rate", pct(sum.winRate)),
      tile("Avg guesses", num(sum.avgGuesses), "on wins"),
      tile("Best game", sum.bestGuesses == null ? "—" : `${sum.bestGuesses}/21`),
      tile("Daily streak", String(st.current), `best ${st.best}`),
      tile("Median game time", dur(sum.medianDurationMs)),
      ...(sum.losses ? [tile("Boards on losses", num(sum.avgBoardsOnLoss, 1), "average solved / 16")] : []));

    // Distribution
    const dist = T.distribution(games);
    const total = dist.reduce((n, d) => n + d.count, 0);
    C.bars($("c-dist"), {
      ariaLabel: "Guess distribution",
      showValues: true,
      yFormat: (v) => String(v),
      data: dist.map((d) => ({
        label: d.key, value: d.count, tone: d.key === "X" ? "critical" : "",
        tip: [d.key === "X" ? "Lost" : `Won in ${d.key}`, `${d.count} game${d.count === 1 ? "" : "s"} (${pct(total ? d.count / total : 0)})`],
      })),
    });

    // Trend
    const tr = T.trend(games);
    C.trend($("c-trend"), {
      onClick: (i) => { location.href = "replay.html?id=" + encodeURIComponent(tr[i].id); },
      points: tr.map((p) => ({
        y: p.status === "won" ? p.guesses : null,
        tip: [gameLabel(p), dateStr(p.at), p.status === "won" ? `Won in ${p.guesses}` : `Lost: ${p.boardsSolved}/16 boards`, "Click to replay"],
      })),
    });

    // Openers
    const tb = $("t-openers").tBodies[0];
    tb.replaceChildren();
    for (const o of T.openers(games).slice(0, 25)) {
      const tr2 = document.createElement("tr");
      tr2.append(el("td", "", o.word.toUpperCase()), el("td", "num", String(o.games)), el("td", "num", pct(o.winRate)),
        el("td", "num", num(o.avgGuesses)), el("td", "num", num(o.greensPerBoard)), el("td", "num", num(o.yellowsPerBoard)));
      tb.append(tr2);
    }

    renderBoards(games);
    renderQuality(finished);

    // Thinking time
    const th = T.thinking(games);
    const lastWithData = th.reduce((m, d, i) => (d.medianMs != null ? i : m), -1);
    const thData = th.slice(0, Math.max(lastWithData + 1, 1));
    if (timed === 0) {
      $("c-think").replaceChildren(el("p", "muted", "No timed guesses yet: timing is recorded for guesses played with the extension installed."));
    } else {
      C.bars($("c-think"), {
        ariaLabel: "Median thinking time per guess",
        minStep: 1000,
        yFormat: (v) => Math.round(v / 1000) + "s",
        data: thData.map((d) => ({
          label: String(d.guess), value: d.medianMs || 0,
          tip: [`Guess ${d.guess}`, d.medianMs == null ? "no data" : `median ${dur(d.medianMs)}`, `${d.samples} timed guess${d.samples === 1 ? "" : "es"}`],
        })),
      });
    }
  }

  function renderBoards(games) {
    const b = T.boards(games);
    let cells, note;
    if (boardMetric === "last") {
      const max = Math.max(...b.positions.map((p) => p.lastCount), 1);
      note = `Which board was the last one solved, across ${b.wonCount} won game${b.wonCount === 1 ? "" : "s"}.`;
      cells = b.positions.map((p) => ({
        value: b.wonCount ? p.lastCount / max : null, text: b.wonCount ? pct(p.lastShare) : "—",
        tip: [`Board ${p.board + 1}`, `solved last in ${p.lastCount} game${p.lastCount === 1 ? "" : "s"}`],
      }));
    } else if (boardMetric === "avg") {
      const vals = b.positions.map((p) => p.avgSolveGuess).filter((v) => v != null);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      note = "Average guess number each board was solved on (darker = later).";
      cells = b.positions.map((p) => ({
        value: p.avgSolveGuess == null ? null : hi > lo ? (p.avgSolveGuess - lo) / (hi - lo) : 0.5,
        text: num(p.avgSolveGuess, 1),
        tip: [`Board ${p.board + 1}`, `average solve guess ${num(p.avgSolveGuess, 2)}`],
      }));
    } else {
      const max = Math.max(...b.positions.map((p) => p.unsolvedCount), 1);
      note = b.lostCount ? `Boards left unsolved across ${b.lostCount} lost game${b.lostCount === 1 ? "" : "s"}.` : "No lost games in this selection.";
      cells = b.positions.map((p) => ({
        value: b.lostCount ? p.unsolvedCount / max : null, text: b.lostCount ? String(p.unsolvedCount) : "—",
        tip: [`Board ${p.board + 1}`, `unsolved in ${p.unsolvedCount} lost game${p.unsolvedCount === 1 ? "" : "s"}`],
      }));
    }
    $("board-note").textContent = note;
    C.grid($("c-boards"), { cells });
  }

  // ---- play quality (engine grading) ----
  let running = false, qToken = 0;
  async function renderQuality(finished) {
    const token = ++qToken;
    const cached = await SedecEngineClient.cachedFor(store, finished);
    if (token !== qToken) return; // filters changed meanwhile
    const missing = finished.filter((r) => !cached.has(r.id));
    $("q-coverage").textContent = `${cached.size} of ${finished.length} finished games analysed.`;
    const btn = $("q-run");
    btn.hidden = running || missing.length === 0;
    btn.textContent = `Analyse ${missing.length} game${missing.length === 1 ? "" : "s"}`;
    btn.onclick = () => analyseMissing(missing);

    const list = [...cached.values()];
    const tiles = $("q-tiles");
    tiles.replaceChildren();
    $("q-chart-title").hidden = list.length === 0;
    if (!list.length) { $("c-skill").replaceChildren(); return; }

    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const sums = list.map((a) => a.summary);
    const bothWon = list.filter((a) => {
      const r = finished.find((x) => x.id === a.id);
      return r && r.status === "won" && a.summary.bot.won;
    });
    const gap = mean(bothWon.map((a) => a.summary.guesses - a.summary.bot.guesses));
    const botWinsYouLost = list.filter((a) => a.summary.bot.won && finished.find((x) => x.id === a.id)?.status === "lost").length;
    tiles.append(
      tile("Average skill", pct(mean(sums.map((s) => s.avgSkill)))),
      tile("Wasted guesses", num(mean(sums.map((s) => s.wasted)), 1), "per game (wins need 16 + this)"),
      tile("Missed free solves", num(mean(sums.map((s) => s.missedFree)), 2), "per game"),
      tile("Guesses vs bot", gap == null ? "—" : (gap >= 0 ? "+" : "") + gap.toFixed(2),
        `per game, when you both won (${bothWon.length})` + (botWinsYouLost ? ` · bot won ${botWinsYouLost} you lost` : "")),
      tile("Bot average", num(mean(sums.map((s) => s.bot.guesses)), 2), "guesses on your answers"),
      tile("Luck", (() => { const l = mean(sums.map((s) => s.luck)); return l == null ? "—" : (l >= 0 ? "+" : "") + l.toFixed(2); })(), "per game; 0 = average"));

    // Average skill by guess number.
    const bySkill = Array.from({ length: S.MAX_GUESSES }, () => []);
    for (const a of list) a.steps.forEach((st, i) => bySkill[i].push(st.skill));
    const last = bySkill.reduce((m, xs, i) => (xs.length ? i : m), 0);
    C.bars($("c-skill"), {
      ariaLabel: "Average skill by guess number",
      height: 170,
      yFormat: (v) => Math.round(v * 100) + "%",
      minStep: 0.2,
      data: bySkill.slice(0, last + 1).map((xs, i) => ({
        label: String(i + 1), value: xs.length ? mean(xs) : 0,
        tip: [`Guess ${i + 1}`, xs.length ? `average skill ${pct(mean(xs))}` : "no data", `${xs.length} game${xs.length === 1 ? "" : "s"}`],
      })),
    });
  }

  async function analyseMissing(missing) {
    if (running) return;
    running = true;
    $("q-run").hidden = true;
    const bar = $("q-progress");
    bar.hidden = false;
    let done = 0;
    try {
      for (const r of missing) {
        await SedecEngineClient.analyse(store, r, {
          onProgress: (p) => {
            const within = p.phase === "table" ? 0 : p.phase === "game" ? 0.8 * p.done / p.total : 0.9;
            bar.value = (done + within) / missing.length;
            $("q-coverage").textContent = p.phase === "table" ? "Preparing the engine (one-time, a few seconds)…"
              : `Analysing game ${done + 1} of ${missing.length}…`;
          },
        });
        done++;
      }
    } catch (e) {
      $("q-coverage").textContent = "Analysis failed: " + e.message;
    } finally {
      running = false;
      bar.hidden = true;
      render();
    }
  }

  $("board-metric").addEventListener("click", (e) => {
    const m = e.target.dataset && e.target.dataset.m;
    if (!m) return;
    boardMetric = m;
    for (const btn of $("board-metric").children) btn.classList.toggle("on", btn.dataset.m === m);
    render();
  });
  $("f-mode").onchange = render;
  $("f-period").onchange = render;

  const api = (globalThis.browser && globalThis.browser.storage) ? globalThis.browser : globalThis.chrome;
  if (!window.__sedecTestArea && api && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.keys(changes).some((k) => k.startsWith(SedecStore.PREFIX))) load();
    });
  }
  load();
})();
