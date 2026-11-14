(async function () {
  "use strict";
  const S = Sedec, T = SedecStats;
  const api = (globalThis.browser && globalThis.browser.tabs) ? globalThis.browser : globalThis.chrome;
  const openPage = (p) => () => {
    if (api && api.tabs) { api.tabs.create({ url: api.runtime.getURL(p) }); window.close(); }
    else location.href = "../" + p; // outside the extension (preview)
  };
  document.getElementById("open-dash").onclick = openPage("pages/dashboard.html");
  document.getElementById("open-log").onclick = openPage("pages/games.html");

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let games = [];
  try { games = await SedecStore.makeStore(window.__sedecTestArea).getAll(); } catch (e) { /* show empty */ }
  const seed = S.dailySeedFor(new Date());
  const today = games.find((r) => r.id === S.gameId("daily", seed));

  // Today's daily
  let line;
  if (!today) line = "Not played yet.";
  else {
    const d = S.derive(today);
    line = today.status === "won" ? `Won in ${d.guessesUsed}/21`
      : today.status === "lost" ? `Lost: ${d.boardsSolved}/16 boards solved`
      : `In progress: ${d.guessesUsed} guesses, ${d.boardsSolved}/16 boards`;
  }
  document.getElementById("today").replaceChildren(el("strong", "", `Daily #${S.dailyNumber(seed)}`), el("div", "line", line));

  // Headline numbers (all finished games) + daily streak
  const sum = T.summary(games);
  const st = T.streaks(games, seed);
  const stat = (v, k) => { const s = el("div", "stat"); s.append(el("div", "v", v), el("div", "k", k)); return s; };
  document.getElementById("stats").replaceChildren(
    stat(String(st.current), `streak (best ${st.best})`),
    stat(sum.winRate == null ? "—" : Math.round(sum.winRate * 100) + "%", "win rate"),
    stat(sum.avgGuesses == null ? "—" : sum.avgGuesses.toFixed(1), "avg guesses"));

  const daily = games.filter((r) => r.mode === "daily").length;
  document.getElementById("counts").textContent =
    `${games.length} games recorded (${daily} daily, ${games.length - daily} free).`;

  // Sync status line (links to the Sync page); refresh if a background sync brings games.
  const syncLine = document.getElementById("sync-line");
  const s = await SedecSync.getSettings(SedecStore.makeStore(window.__sedecTestArea));
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = !s.token ? "Set up sync" : s.lastError ? "Sync problem: open settings" : "Sync settings";
  link.onclick = (e) => { e.preventDefault(); openPage("pages/sync.html")(); };
  syncLine.replaceChildren(!s.token ? "Not syncing. " : s.lastSync ? `Synced ${new Date(s.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ` : "", link);
  window.addEventListener("sedec-data-changed", () => location.reload());
})();
