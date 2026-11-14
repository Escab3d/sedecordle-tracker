# Sedecordle Tracker

Records your [sedecordle.com](https://sedecordle.com/) games (daily and free play) in the browser, so you can export and analyse them later. See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the roadmap and [docs/SITE_FINDINGS.md](docs/SITE_FINDINGS.md) for how the site works.

**Status:** Phases 2–5 are built: the logger with JSON/CSV export and import, the popup, the stats dashboard, the replay viewer and the grading engine. Phase 6, part 1, is built too: a web app and bookmarklet for phones (Android Chrome has no extensions). It still needs hosting and a test on a real phone.

## Web app + bookmarklet (phones)

The same dashboard, game log, replay and grading pages also run as an installable web app (PWA). Games are stored in the browser's IndexedDB on that device.

- **Capturing on the phone:** a bookmarklet (`web/capture.js`). On sedecordle.com it:
  - reads the seed and guesses the site has saved;
  - shows a small panel;
  - on **Save to tracker**, opens the web app's `pages/add.html` with the games in the URL fragment (`#d=…`, never sent to a server). The page saves them and removes the data from the address bar.
- **Timing:** running the bookmarklet before your first guess turns on per-guess timing for that tab. Times are kept in the site's localStorage under `sedecordle-tracker-times`, so they survive until you save, but timing itself stops if the page reloads.
- **Repeat saves:** saving the same game again merges guess by guess (`lib/ingest.js`), so timings from earlier saves are never lost.
- **Two bookmark versions:** **Standard** loads the latest `capture.js` from the app each time. **Self-contained** embeds the whole script, in case loading scripts on sedecordle.com is ever blocked.
- **Moving games between devices:** for now, use **Export JSON** and **Import JSON** in the game log (the import format is the same in the extension and the web app).

Build and host:

```bash
python tools/build_webapp.py
```

This writes `webapp/`, made from `extension/lib`, `extension/pages` (with the web-app tags added) and `web/`. Host that folder over HTTPS (for example on GitHub Pages), open `pages/setup.html` on the phone, and follow the steps there.

## Pages

- **Popup** (toolbar icon): today's daily result, current and best daily streak, win rate, average guesses, and links to the other pages.
- **Dashboard**: summary tiles, a guess-count distribution, a guesses-per-game trend with a 10-game average, opening-word performance, a 4×4 board grid (which board was solved last, average guess each board was solved on, boards left unsolved), and median thinking time per guess. Filter by mode (daily/free) and period. Hover any chart for details.
- **Game log**: every game, with export and import.
- **Replay**: step through a finished game guess by guess (buttons, slider, ← → Home End, or click a guess). Each of the 16 boards shows its coloured rows and how many answer-list words were still possible. When there are 12 or fewer, it lists them. A ● next to a guess means some board was already down to one possibility and that guess solved nothing. Open it from a game in the game log, or by clicking a dot on the dashboard's trend chart. Games still in progress can't be replayed, so the tracker never helps during play.

## How games are graded

Every board needs exactly one guess equal to its answer, so **total guesses = 16 + wasted guesses** (guesses that solved no board). Playing well means wasting as few guesses as possible.

For each guess, the engine scores all 12,970 valid words in that position:

- **Value** = expected boards solved + (expected information ÷ the most information any guess could get there, never less than 1 bit). A pure information guess is worth at most 1. Playing a board's only remaining answer (a **free solve**) is worth 1 plus whatever it reveals, so free solves always rank first.
- **Skill** = your guess's value ÷ the best guess's value. Any free solve counts as 100%, since it costs no extra guess.
- **Luck** = actual result − expected result, in the same units. Positive means things went better than that guess usually would.
- **Missed free solve** = a wasted guess made while some board was already down to one possible answer.
- **Bot** = plays the same 16 answers, always choosing the highest-value guess. Over random games it averages about 18.2 guesses and won all 25 test games. Its opener is RAISE.

This is a one-step-lookahead heuristic, not a proof of optimal play. Exact optimal play for 16 boards is out of reach. The bot gives a concrete benchmark: "you used 19, the bot needed 18".

The engine runs in a background worker. The first analysis in a session builds a 30 MB pattern table (about 2 s); after that, a game takes about 1 s. Results are cached in the extension's storage (`analysis:<id>`). They are recalculated if the game or the engine version changes, aren't included in exports, and are deleted along with their game.

- **Replay page:** the game summary (your guesses vs the bot, wasted guesses, missed free solves, average skill, luck, the bot's full game), plus skill, luck and the top 3 alternatives for every guess.
- **Dashboard → Play quality:** analyses all finished games in one go, then shows the averages and skill by guess number.

## Install (Chrome, desktop)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the extension and play on sedecordle.com. Click the icon and choose **Open game log** to see your games.

Chrome shows one harmless warning, *Unrecognized manifest key 'browser_specific_settings'*. That key is for Firefox.

After editing any file, click the reload icon on the extension's card and reload the sedecordle tab.

### Firefox (desktop or Android, 128+)

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `extension/manifest.json`. Firefox may ask you to allow the extension on sedecordle.com: open the extension's menu and grant **Always allow on sedecordle.com**. Porting to phones properly is Phase 6.

## What gets recorded

- Every accepted guess, with the time it was made. The site doesn't store times, so they only exist for guesses played while the extension is installed.
- The game seed. The 16 answers, colours and the board each guess solved are all recalculated from the seed and guesses.
- Games already in progress when you install are picked up from the site's storage, without times (`source: backfill`).
- An unfinished game becomes `abandoned` when you start a new free game, or when a newer daily opens.
- At each guess, the answers the site shows are compared with the answers the extension calculates. A ⚠ in the game log means they didn't match, which would suggest the site changed its logic.

Answers are hidden in the game log until a game is finished.

## Export and import

- **Export JSON** saves everything, and is the file to keep as a backup or move between devices.
- **Export CSV (games)** saves one row per game. **Export CSV (guesses)** saves one row per guess, with thinking time and boards solved.
- **Import JSON** merges an export into the existing games. For each game, the copy with the later `updatedAt` is kept, so importing the same file twice is safe.

## Layout

```
extension/
  manifest.json
  content/hook.js       page-world script: watches the site's localStorage writes
  content/bridge.js     isolated content script: passes events to the recorder
  lib/sedecordle.js     game model: RNG, answers from a seed, colours, derived stats
  lib/words.js          GENERATED word lists (python tools/build_words.py)
  lib/recorder.js       turns events into stored game records
  lib/store.js          chrome.storage.local wrapper ("game:<id>" keys)
  lib/export.js         JSON/CSV export, import + merge
  lib/stats.js          aggregate stats (streaks, distribution, openers, boards, timing)
  lib/analysis.js       post-game analysis: possible answers per board after each guess
  lib/engine.js         grading engine + bot (pattern table, value search)
  pages/engine-worker.js  runs the engine in a Web Worker
  pages/engine-client.js  page side: worker, job queue, analysis cache
  lib/ingest.js         merges bookmarklet captures into the store (keeps timings)
  pages/add.*           web app: receives a captured game
  pages/setup.*         web app: bookmarklet setup instructions
  pages/env.js          marks pages as extension or web app (shows the right links)
web/                    web-app-only files: capture.js (bookmarklet), manifest, service worker, index
webapp/                 GENERATED by tools/build_webapp.py: the deployable web app
  pages/replay.*        replay viewer
  pages/dashboard.*     stats dashboard
  pages/charts.js       small dependency-free SVG charts with hover tooltips
  pages/games.*         game log page
  pages/common.css      shared styles and colour tokens (light and dark)
  popup/                toolbar popup
data/                   answers.txt / allowed.txt extracted from the site (order matters)
tests/test.html         browser test suite
tests/engine-test.html  engine tests (slower: builds the table, plays 25 bot games)
tests/preview.html      any extension page with sample data, outside the extension
tests/sample-data.js    the sample games used by preview.html
tools/build_words.py    regenerates lib/words.js from data/
```

## Tests

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/tests/test.html. It checks:

- answer generation against values captured from the live site;
- colouring against a direct copy of the site's own colouring code, on 200,000 random word pairs;
- the hook, bridge and recorder, driven the same way the site writes its storage;
- export and import;
- the stats calculations;
- the possibility counts used by the replay, checked against an independent brute-force count;
- bookmarklet capture decoding and merging.

http://127.0.0.1:8765/tests/engine-test.html checks the engine: pattern codes, information against brute force, the best opener being SOARE/ROATE/RAISE, the grading rules, speed, and the bot's strength over 25 random games. It takes about 15 s.

To look at the pages without loading the extension, open http://127.0.0.1:8765/tests/preview.html?page=pages/dashboard.html. Other pages work the same way (`pages/games.html`, `popup/popup.html`), and adding `&empty=1` starts with no games.
