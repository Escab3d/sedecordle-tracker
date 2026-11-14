# Sedecordle Tracker & Analyser — Project Plan

Context handoff from a planning conversation.

## Goal

A browser extension that records my Sedecordle games (sedecordle.com: 16 Wordle boards at once, 21 guesses), stores them, lets me export them, and lets me analyse them afterwards, including my play vs. optimal play.

## Decisions made

- Browser: Chrome (Manifest V3). Would like it to work on phone too.
- Modes: track both the daily game and free play.
- "Optimal" means: fewest total guesses (not just "never lose").
- Analysis happens after the game only, never during play. This avoids the tool becoming a cheat aid and keeps heavy computation out of the play loop.

## Phone constraint

Standard Chrome for Android does not support extensions (as of 2026). Options for capturing games on a phone:

- Firefox for Android (MV3 extensions, small porting changes)
- Chromium forks with Chrome Web Store support: Quetta, Helium, Vivaldi Android
- iOS: Safari extensions need a Mac and Xcode. This would be a separate mini-project.

Decided: the phone is **Android**, so the iOS/Safari path is not needed.

## Proposed architecture: split capture from analysis

1. **Capture extension (thin):** records games, stores them locally, exports them, and optionally uploads to a backend. Targets desktop Chrome and Firefox or Quetta on the phone.
2. **Analysis web app (PWA):** the dashboard, replay viewer and optimal-play engine. Runs on any device, including plain mobile Chrome.
3. **Sync between devices** (pick one):
   - Manual JSON export/import. Simplest, and should be built first regardless.
   - Google Drive hidden app folder. Free and private, but the sign-in flow is fiddly outside desktop Chrome.
   - Small free backend (Supabase or Firebase). The most robust option. Current preference for cross-device use.
   - Not suitable: `chrome.storage.sync`. Too small (about 100 KB) and syncs only Chrome to Chrome.

## Data capture options (verify on the live site first)

1. Preferred: read the game state the site saves in `localStorage`, if it saves one.
2. Fallback: a `MutationObserver` on the board DOM to read letters and colours. Breaks if the layout changes.
3. Last resort: listen to keystrokes. Gives the guesses but not the colours.

Data to record per game: date, mode (daily or free), the guess list with a timestamp per guess, the 16 answers, which guess solved each board, and the win/loss result.

Storage: IndexedDB or `chrome.storage.local`, with the `unlimitedStorage` permission. Exports: JSON (full fidelity), CSV, and import.

## Interface ideas

- Popup: today's result, streak, average number of guesses.
- Dashboard: win rate, histogram of guesses used, starting-word performance, which boards tend to be finished last, and thinking time per guess.
- Replay viewer: step through a game guess by guess and show the remaining candidates for each board.

## Optimal-play engine (the hard part)

Exact optimal play is intractable for 16 boards. Instead, build a WordleBot-style per-guess grade: given the information available at that point, how good was my guess compared with the best heuristic guess?

- Main objective: expected total guesses remaining across all unsolved boards.
- Supporting heuristics: entropy (information gained) and expected number of remaining candidates.
- "Free solve" detection: flag guesses made while some board had exactly one candidate left.
- Output: a skill score and a luck score per guess, plus a game summary such as "3 wasted guesses, 2 missed free solves".
- Word lists: Sedecordle's answer list and allowed-guess list are probably embedded in the site's JavaScript. Extract them, and fall back to standard Wordle lists if that fails.
- Performance: run the engine in a Web Worker, precompute the opening move, and only analyse completed games.

## Phases

1. Inspect sedecordle.com: find where game state and word lists live, then propose a data schema. ✅ Done (see `docs/SITE_FINDINGS.md`).
2. Build the MVP: a logger with JSON/CSV export and import. ✅ Done; confirmed working in Chrome.
3. Add the popup and a basic stats dashboard. ✅ Done.
4. Add the replay viewer with candidate counts per board. ✅ Done (`lib/analysis.js` `candidateTrace` is the starting point for Phase 5).
5. Build the optimal-play engine and per-guess grading. ✅ Done (one-step value heuristic + bot benchmark; see README "How games are graded"). Possible upgrade: two-step lookahead for the first 2–3 guesses.
6. Add cross-device sync with a backend, and port the capture extension to a mobile browser.
   - Decided (2026-11-11): Android Chrome via **bookmarklet + web app (PWA)** instead of switching browsers.
   - 6a ✅ Web app build (`tools/build_webapp.py` → `webapp/`), bookmarklet capture (`web/capture.js`), save and setup pages. Tested locally and against the live site.
   - 6b ⏳ Host `webapp/` over HTTPS (GitHub Pages proposed), then test the bookmarklet on the real phone.
   - 6c ⏳ Sync between phone and desktop (Supabase or similar), replacing manual JSON export/import.
