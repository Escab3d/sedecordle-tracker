// Receives games from the bookmarklet (data in the URL fragment) and saves them.
(function () {
  "use strict";
  const S = Sedec;
  const out = document.getElementById("out");
  const store = SedecStore.makeStore(window.__sedecTestArea);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const statusText = { won: "Won", lost: "Lost", in_progress: "In progress", abandoned: "Abandoned" };

  run();
  // A second save into an already-open page only changes the #fragment (no reload).
  window.addEventListener("hashchange", () => { if (location.hash) run(); });

  async function run() {
  const hash = location.hash;
  // Drop the data from the address bar so a reload or bookmark doesn't carry it around.
  if (hash) history.replaceState(null, "", location.pathname + location.search);

  if (!hash) {
    out.replaceChildren(el("p", "", "Nothing to save here. Open sedecordle.com and use the tracker bookmark; it brings you to this page with your game."),
      el("a", "button", "Bookmark setup"));
    out.lastChild.href = "setup.html";
    return;
  }

  try {
    const { games, rejected } = SedecIngest.decodePayload(hash);
    const results = await SedecIngest.ingest(store, games);
    // Push the new game to the other devices right away (no-op if sync isn't set up).
    if (window.SedecAutoSync) window.SedecAutoSync({ force: true });
    out.replaceChildren();
    out.className = "";
    if (!results.length) out.append(el("p", "", "The link had no games in it."));
    for (const r of results) {
      const rec = r.record, d = S.derive(rec);
      const card = el("div", "card");
      card.append(el("h2", "", rec.mode === "daily" ? `Daily #${rec.dailyNumber}` : "Free play"));
      const timed = rec.guesses.filter((g) => g.t != null).length;
      card.append(el("div", "", `${statusText[rec.status]} · ${d.guessesUsed} guesses · ${d.boardsSolved}/16 boards` +
        (timed ? ` · ${timed} timed` : "")));
      card.append(el("div", "muted", r.isNew ? "Saved as a new game." : r.changed ? "Updated the saved game." : "Already up to date."));
      const links = el("div", "links");
      if (rec.status !== "in_progress") {
        const a = el("a", "button primary", "Replay & analysis ▸");
        a.href = "replay.html?id=" + encodeURIComponent(rec.id);
        links.append(a);
      } else {
        links.append(el("span", "muted", "Replay and analysis unlock when the game is finished. Save it again then."));
      }
      card.append(links);
      out.append(card);
    }
    if (rejected) out.append(el("p", "error", `${rejected} game${rejected === 1 ? " was" : "s were"} damaged and skipped.`));
    const nav = el("div", "links");
    const dash = el("a", "button", "Dashboard"); dash.href = "dashboard.html";
    const back = el("a", "button", "Back to sedecordle"); back.href = "https://sedecordle.com/";
    nav.append(dash, back);
    out.append(nav);
  } catch (e) {
    out.replaceChildren(el("p", "error", "Couldn't save: " + e.message));
  }
  }
})();
