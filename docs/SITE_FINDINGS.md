# Phase 1 — sedecordle.com findings & data schema

Inspected 2026-11-11 (site title "sedecordle - v2.0"). All game logic is one ~150 KB inline `<script>` in `index.html`, plus `mersenne2.js` (seeded RNG) and `stats.js` (daily stats).

## TL;DR

- **The whole game is deterministic from `(seed, guesses)`.** The 16 answers come from a Mersenne Twister seeded by the daily number or by a free-play timestamp. Verified in the browser: re-deriving the answers from the seed matched the game's own `answer` array for both modes.
- **The game state is in `localStorage`**, so capture option 1 from the plan works. No DOM scraping or keystroke logging is needed.
- **The word lists are plain strings in the page.** They have been extracted to `data/answers.txt` (2313) and `data/allowed.txt` (10657). The two lists don't overlap, and a valid guess is any word in either list.
- **Gotcha 1:** free-play state is **deleted** when you start a new free game, so the extension must snapshot it on every write.
- **Gotcha 2:** the site keeps no per-guess timestamps. The extension has to add them live.

## localStorage keys (origin `https://sedecordle.com`, shared with `/old/`)

| Key | Content | Written when |
|---|---|---|
| `last_daily` | daily seed, e.g. `"2452"` | opening Daily; if it changed, `daily_guesses` is reset to `""` |
| `daily_guesses` | comma-joined guesses, e.g. `"crane,sloth,..."` | after every accepted guess (`update_local_storage`) |
| `last_free` | free-play seed = `Date.now()` at game creation, e.g. `"1794411148385"` | starting a new free game |
| `free_guesses` | comma-joined guesses | after every accepted guess |
| `sedecordle-main-stats` | `{history:[{id, guesses, time:null, solved, grid}]}` | daily game end (`SedecStats.recordDaily`) — daily only, no guess words |
| `sedecordle_ui`, `sedecordle_theme_v2`, `sedecordle_layout`, `sedecordle_feedback_dismissed` | UI prefs | — |

The **New free game** button calls `removeItem("free_guesses")` and `removeItem("last_free")`. That is the moment a finished or abandoned free game would be lost.

## How answers are generated

```js
// daily: seed = 720 + floor((now - Date('02/13/2022') [+1h if DST]) / 1 day); "Daily #N" = seed - 720
// free:  seed = Number(localStorage.last_free)   (ms timestamp; MT does seed>>>0 internally)
rnd = new MersenneTwister(seed);           // standard banksean MT19937, init_genrand
for (8×) rnd.genrand_int31();              // discard
do { answer = 16 × answers[rnd.genrand_int31() % answers.length] }
while (new Set(answer).size != 16);        // reroll if duplicates
```

- The order of `answers` matters (it is index-based), so `data/answers.txt` keeps the site's order.
- The daily number depends on the **local** timezone and DST, so store the seed, not just the calendar date.
- Board order is `answer[0..15]`, laid out 2 per row in the share grid.

## Game rules relevant to analysis

- 16 boards, `TOTAL_LINES = 21` guesses, 5 letters.
- A guess must be in `allowed ∪ answers`. Repeated guesses are rejected by the new UI, but the restore path allows them (games saved by the old site), so the parser must tolerate repeats.
- `answer_correct[box]` is the 0-based line on which a board was solved, or -1. Win = all ≥ 0. Loss = 21 lines used.
- Colour feedback is standard Wordle (`identify_guess`, line ~1344). Next phase: confirm how it handles duplicate letters before reusing it in the engine.
- Restoring on reload replays guesses through `pk()` **without** writing `localStorage`, so a `setItem` hook fires only for real new guesses. That is good for timestamps.

## Capture strategy (recommended)

MV3 content script with `"world": "MAIN"`, `run_at: document_start` on `https://sedecordle.com/*`:

1. Wrap `Storage.prototype.setItem` / `removeItem`. On writes to `daily_guesses` or `free_guesses`, diff against the previous list. Each newly added word is a guess, stamped with `Date.now()`.
2. On `removeItem("free_guesses")`, finalize the in-progress free game first. A game that was neither won nor lost is marked `abandoned`.
3. Post events to an isolated-world content script (`window.postMessage`), which relays them to the service worker. The service worker stores them in IndexedDB.
4. On page load, read the current `last_*` / `*_guesses` so a game started before the extension was installed (or played on `/old/`) is still picked up, without timestamps.

Derived data (answers, colours, solve lines, result) is **recomputed** from `seed + guesses`, not scraped. As a sanity check, the main-world script can compare against the page globals `answer` / `answer_correct` at game end and set `verified: true`.

Optional: import the existing `sedecordle-main-stats` history as `legacy` records. It holds results only, no guess words.

## Proposed schema (v1)

Stored record = the minimal facts. Everything else is derived by a shared `lib/sedecordle.js` (MT + answer generation + scoring), which is used by both the extension and the analysis PWA.

```jsonc
// IndexedDB store "games", keyPath "id"
{
  "schema": 1,
  "id": "daily-2452",               // "daily-<seed>" | "free-<seed>"  (stable, so dedup on import/sync is trivial)
  "mode": "daily",                  // "daily" | "free"
  "seed": 2452,                     // daily: seed (Daily # = seed-720); free: ms timestamp
  "dailyNumber": 1732,              // daily only
  "site": { "version": "v2.0", "path": "/" },  // "/" or "/old/"
  "startedAt": 1794411085000,       // first observed event (ms epoch); null if unknown
  "finishedAt": 1794412300000,      // null while in progress
  "status": "won",                  // "in_progress" | "won" | "lost" | "abandoned"
  "guesses": [
    { "word": "crane", "t": 1794411092000 },   // t = null if captured from storage without live timing
    { "word": "sloth", "t": 1794411110000 }
  ],
  "verified": true,                 // derived answers matched the page's own `answer` array
  "source": "live",                 // "live" | "backfill" | "import" | "legacy"
  "updatedAt": 1794412300000        // for sync conflict resolution (last-writer-wins per id)
}
```

Derived at read time (not stored, cached if needed):

```jsonc
{
  "answers": ["....", ...16],              // from seed
  "solvedAt": [3, 7, -1, ...16],            // 0-based guess index per board, -1 unsolved
  "feedback": [[ "GYBBB", ... ], ...],      // per guess × per board, until that board is solved
  "guessesUsed": 19, "boardsSolved": 16,
  "thinkMs": [7000, 18000, ...]              // diffs of t
}
```

The live-only data is just `word` + `t`. Everything else can be regenerated, so if the site changes its colouring or the engine changes, old games are re-analysed correctly.

### Exports

- **JSON**: `{ "format": "sedecordle-tracker", "schema": 1, "exportedAt": ..., "games": [ ...records ] }`. Full fidelity; import merges by `id`, newer `updatedAt` wins.
- **CSV (one row per game)**: `id, mode, daily_number, seed, status, guesses_used, boards_solved, started_at, finished_at, duration_s, guesses` (space-joined words), `solved_at` (16 numbers separated by `;`).
- **CSV (one row per guess)**, optional: `game_id, index, word, t, think_ms, boards_solved_by_this`.

## Phase 2 resolutions

- `identify_guess` is standard two-pass Wordle colouring. `Sedec.score` matches it on 200k random pairs (`tests/test.html`).
- Abandoned games are kept but hidden by default in the game log, with a checkbox to show them.
- `/old/` uses the same keys, word lists and answer generation, so the manifest matches all of `sedecordle.com/*`.
- Storage is `chrome.storage.local` (one key per game), not IndexedDB. That is simpler and enough at this size; revisit if the analysis app needs indexes.
- There is no background script. The isolated content script writes to storage directly, which also simplifies the Firefox port.
