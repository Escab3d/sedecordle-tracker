(function () {
  "use strict";
  const S = Sedec, X = SedecExport;
  const store = SedecStore.makeStore(window.__sedecTestArea); // test harness may inject an area
  const $ = (id) => document.getElementById(id);
  let games = [];
  const open = new Set();

  const fmtDate = (t) => (Number.isFinite(t) ? new Date(t).toLocaleString(undefined,
    { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  function fmtDur(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
  }
  const label = (r) => (r.mode === "daily" ? `Daily #${r.dailyNumber}` : "Free play");
  const statusText = { won: "Won", lost: "Lost", in_progress: "In progress", abandoned: "Abandoned" };

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === "class") e.className = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  }

  function notice(text, isError) {
    const n = $("notice");
    n.textContent = text;
    n.className = isError ? "error" : "";
    n.hidden = !text;
  }

  async function load() {
    try {
      games = await store.getAll();
    } catch (e) {
      notice("Couldn't read storage: " + e.message, true);
      games = [];
    }
    render();
  }

  function render() {
    const mode = $("f-mode").value, showAb = $("f-abandoned").checked;
    const list = X.sortGames(games).reverse()
      .filter((r) => (!mode || r.mode === mode) && (showAb || r.status !== "abandoned"));

    const finished = games.filter((r) => r.status === "won" || r.status === "lost");
    const wins = finished.filter((r) => r.status === "won");
    const avg = wins.length ? (wins.reduce((s, r) => s + r.guesses.length, 0) / wins.length).toFixed(2) : "—";
    $("summary").textContent = `${games.length} games recorded · ${finished.length} finished · ` +
      `${wins.length} won · average ${avg} guesses per win`;

    const tbody = $("games").tBodies[0];
    tbody.replaceChildren();
    $("empty").hidden = list.length > 0;
    $("games").hidden = list.length === 0;

    for (const r of list) {
      const d = S.derive(r);
      const dur = Number.isFinite(r.startedAt) && Number.isFinite(r.finishedAt) ? r.finishedAt - r.startedAt : NaN;
      const row = el("tr", { class: "game", onclick: () => { open.has(r.id) ? open.delete(r.id) : open.add(r.id); render(); } },
        el("td", null, label(r), r.verified === false ? " ⚠" : ""),
        el("td", null, fmtDate(r.startedAt ?? r.guesses[0]?.t ?? r.updatedAt)),
        el("td", null, el("span", { class: "tag " + r.status }, statusText[r.status] || r.status)),
        el("td", { class: "num" }, `${d.guessesUsed}/${S.MAX_GUESSES}`),
        el("td", { class: "num" }, `${d.boardsSolved}/16`),
        el("td", { class: "num" }, fmtDur(dur)),
        el("td", null, el("button", { class: "del", title: "Delete this game", onclick: (e) => { e.stopPropagation(); del(r); } }, "✕")));
      tbody.append(row);
      if (open.has(r.id)) tbody.append(detailRow(r, d));
    }
  }

  function detailRow(r, d) {
    const gs = el("div", { class: "guesses" });
    r.guesses.forEach((g, i) => {
      const solved = d.solvedAt.filter((x) => x === i).length;
      const think = d.thinkMs[i];
      gs.append(el("span", { class: "guess", title: think != null ? `thinking time ${fmtDur(think)}` : "no timing" },
        el("span", { class: "n" }, String(i + 1)), g.word.toUpperCase(),
        solved ? el("span", { class: "s" }, "✓".repeat(solved)) : null));
    });
    const showAnswers = r.status !== "in_progress";
    const ans = el("div", { class: "answers" });
    if (showAnswers) {
      ans.append("Answers: ");
      d.answers.forEach((a, b) => {
        ans.append(el("span", { class: d.solvedAt[b] < 0 ? "unsolved" : "" },
          a.toUpperCase() + (d.solvedAt[b] >= 0 ? ` (${d.solvedAt[b] + 1})` : " (–)")), b < 15 ? " · " : "");
      });
    } else {
      ans.append("Answers are hidden until the game is finished.");
    }
    const meta = el("div", { class: "muted", style: "margin-top:6px" },
      `id ${r.id} · source ${r.source}` + (r.verified === true ? " · verified against the site" :
        r.verified === false ? " · ⚠ answers did NOT match the site; the site's logic may have changed" : ""));
    const replay = r.status !== "in_progress" && r.guesses.length
      ? el("div", { style: "margin-top:8px" }, el("a", { href: "replay.html?id=" + encodeURIComponent(r.id), class: "button" }, "Replay this game ▸"))
      : null;
    return el("tr", { class: "detail" }, el("td", { colspan: 7 }, gs, ans, meta, replay));
  }

  async function del(r) {
    if (!confirm(`Delete ${label(r)} (${fmtDate(r.startedAt)})? This can't be undone unless you have an export.`)) return;
    await store.remove(r.id);
    await load();
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  $("export-json").onclick = () => download(`sedecordle-games-${stamp()}.json`, X.toJSON(games), "application/json");
  $("export-csv").onclick = () => download(`sedecordle-games-${stamp()}.csv`, X.gamesCSV(games), "text/csv");
  $("export-guesses").onclick = () => download(`sedecordle-guesses-${stamp()}.csv`, X.guessesCSV(games), "text/csv");

  $("import-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { games: incoming, rejected } = X.parseImport(await file.text());
      const plan = X.mergePlan(await store.getAll(), incoming);
      await store.putMany(plan.write);
      notice(`Imported ${file.name}: ${plan.added} new, ${plan.updated} updated, ${plan.skipped} already up to date` +
        (rejected ? `, ${rejected} invalid records skipped` : "") + ".");
      await load();
    } catch (err) {
      notice("Import failed: " + err.message, true);
    }
  };

  $("delete-all").onclick = async () => {
    if (!games.length) return;
    if (!confirm(`Delete all ${games.length} recorded games? Export first if you want a backup. This can't be undone.`)) return;
    await store.clear();
    notice("All games deleted.");
    await load();
  };

  $("f-mode").onchange = render;
  $("f-abandoned").onchange = render;

  // Live refresh while games are being played in another tab.
  const api = (globalThis.browser && globalThis.browser.storage) ? globalThis.browser : globalThis.chrome;
  if (!window.__sedecTestArea && api && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.keys(changes).some((k) => k.startsWith(SedecStore.PREFIX))) load();
    });
  }

  load();
})();
