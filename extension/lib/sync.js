// Sync between devices through one secret GitHub gist.
// Needs lib/sedecordle.js and lib/store.js. Works in extension pages, the content script and the web app.
//
// Gist layout:
//   sedecordle-tracker.json   {format, schema, updatedAt}         (marker used to find the gist)
//   games-YYYY-MM.json        {games:[records]}  (month of the game itself: daily date or free-play creation)
//   deleted.json              {deleted:{id: deletedAt}}
// Merge rules (same on every device, so syncing in any order converges):
//   - guesses: the longer list wins if it extends the other; timings are kept from either side
//   - a tombstone deletes a game unless the game was updated after the deletion
(function (g) {
  "use strict";
  const S = g.Sedec;
  const API = "https://api.github.com";
  const MARKER = "sedecordle-tracker.json";
  const DESCRIPTION = "Sedecordle Tracker sync (game data)";
  const SETTINGS = "sync";
  const AUTO_MIN_INTERVAL = 2 * 60 * 1000;

  // ---------- merge ----------
  function mergeRecords(a, b) {
    if (!a) return b;
    if (!b) return a;
    const [newer, older] = (b.updatedAt || 0) > (a.updatedAt || 0) ? [b, a] : [a, b];
    const x = a.guesses, y = b.guesses;
    let k = 0;
    while (k < x.length && k < y.length && x[k].word === y[k].word) k++;
    let words;
    if (k === x.length) words = y;            // y extends (or equals) x
    else if (k === y.length) words = x;       // x extends y
    else words = newer.guesses;               // conflict: newer edit wins
    const other = words === x ? y : x;
    const guesses = words.map((gs, i) => ({
      word: gs.word,
      t: gs.t ?? (other[i] && other[i].word === gs.word ? other[i].t : null) ?? null,
    }));
    const out = Object.assign({}, older, newer, {
      guesses,
      startedAt: a.startedAt ?? b.startedAt ?? null,
      finishedAt: a.finishedAt ?? b.finishedAt ?? null,
      verified: a.verified ?? b.verified ?? null,
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    });
    const d = S.derive(out);
    if (d.outcome !== "in_progress") out.status = d.outcome;
    else out.status = (a.status === "abandoned" || b.status === "abandoned") ? "abandoned" : "in_progress";
    return out;
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Fixed field order, so the same game always serialises identically on every device
  // (otherwise each sync would rewrite the gist for nothing).
  const canonical = (r) => ({
    schema: r.schema, id: r.id, mode: r.mode, seed: r.seed, dailyNumber: r.dailyNumber ?? null,
    site: r.site || { path: "/" }, startedAt: r.startedAt ?? null, finishedAt: r.finishedAt ?? null,
    status: r.status, guesses: r.guesses.map((x) => ({ word: x.word, t: x.t ?? null })),
    verified: r.verified ?? null, source: r.source || "sync", updatedAt: r.updatedAt || 0,
  });
  const sameGame = (a, b) => same(canonical(a), canonical(b));

  // ---------- sharding ----------
  const DAY0 = Date.UTC(2022, 1, 13); // Daily #0
  function shardOf(rec) {
    let t = null;
    if (rec.mode === "daily") t = DAY0 + (rec.seed - S.DAILY_OFFSET) * 86400000;
    else if (rec.mode === "free" && rec.seed > 1e11) t = rec.seed;
    if (t == null || !Number.isFinite(t)) return "games-other.json";
    const d = new Date(t);
    return `games-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.json`;
  }
  const isShard = (name) => /^games-(\d{4}-\d{2}|other)\.json$/.test(name);

  // ---------- GitHub API ----------
  function client(token, fetchFn) {
    const f = fetchFn || g.fetch.bind(g);
    async function call(method, path, body) {
      const res = await f(API + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json()).message || ""; } catch (e) { /* ignore */ }
        const err = new Error(res.status === 401 ? "GitHub rejected the token (expired or wrong?)."
          : res.status === 403 || res.status === 404 && path.startsWith("/gists") && method !== "GET"
            ? "The token isn't allowed to use gists. Give it the “Gists: Read and write” permission."
            : `GitHub error ${res.status}${msg ? ": " + msg : ""}`);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }
    async function fileText(file) {
      if (!file.truncated && typeof file.content === "string") return file.content;
      const res = await f(file.raw_url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Couldn't download ${file.filename} (${res.status})`);
      return res.text();
    }
    return { call, fileText };
  }

  async function findGist(gh) {
    for (let page = 1; page <= 10; page++) {
      const list = await gh.call("GET", `/gists?per_page=100&page=${page}`);
      const hit = list.find((x) => x.files && x.files[MARKER]);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    return null;
  }

  async function createGist(gh) {
    const res = await gh.call("POST", "/gists", {
      description: DESCRIPTION,
      public: false,
      files: {
        [MARKER]: { content: JSON.stringify({ format: "sedecordle-tracker-sync", schema: S.SCHEMA, createdAt: Date.now() }, null, 1) },
        "deleted.json": { content: JSON.stringify({ deleted: {} }) },
      },
    });
    return res.id;
  }

  // ---------- one sync round ----------
  async function syncNow(store, { fetch: fetchFn } = {}) {
    const settings = (await store.getMeta(SETTINGS)) || {};
    if (!settings.token) throw new Error("Sync isn't set up on this device.");
    const gh = client(settings.token, fetchFn);
    const started = Date.now();
    try {
      let gistId = settings.gistId || null;
      let gist = null;
      if (gistId) {
        try { gist = await gh.call("GET", `/gists/${gistId}`); }
        catch (e) { if (e.status === 404) gistId = null; else throw e; }
      }
      if (!gistId) {
        gistId = (await findGist(gh)) || (await createGist(gh));
        gist = await gh.call("GET", `/gists/${gistId}`);
      }

      // Remote state.
      const remote = new Map(), remoteShardText = {};
      let remoteDeleted = {};
      for (const [name, file] of Object.entries(gist.files || {})) {
        if (isShard(name)) {
          const text = await gh.fileText(file);
          remoteShardText[name] = text;
          let data = null;
          try { data = JSON.parse(text); } catch (e) { continue; }
          for (const r of (data && data.games) || []) {
            const clean = S.sanitizeRecord(r);
            if (clean) remote.set(clean.id, mergeRecords(remote.get(clean.id), Object.assign(clean, { updatedAt: r.updatedAt || 0 })));
          }
        } else if (name === "deleted.json") {
          try { remoteDeleted = JSON.parse(await gh.fileText(file)).deleted || {}; } catch (e) { remoteDeleted = {}; }
        }
      }

      // Local state.
      const localList = await store.getAll();
      const local = new Map(localList.map((r) => [r.id, r]));
      const localDeleted = await store.getTombstones();

      // Merge.
      const deleted = Object.assign({}, remoteDeleted);
      for (const id in localDeleted) deleted[id] = Math.max(deleted[id] || 0, localDeleted[id]);
      const merged = new Map();
      for (const id of new Set([...local.keys(), ...remote.keys()])) {
        const m = mergeRecords(local.get(id), remote.get(id));
        if (deleted[id] != null && deleted[id] >= (m.updatedAt || 0)) continue; // deleted after its last change
        if (deleted[id] != null) delete deleted[id];                            // re-played after deletion
        merged.set(id, m);
      }

      // Apply locally.
      const toPut = [], toRemove = [];
      for (const [id, m] of merged) if (!local.has(id) || !sameGame(local.get(id), m)) toPut.push(m);
      for (const id of local.keys()) if (!merged.has(id)) toRemove.push(id);
      await store.putMany(toPut);
      for (const id of toRemove) await store.remove(id, { tombstone: false });
      await store.putTombstones(deleted);

      // Push changed shards.
      const shards = {};
      for (const m of merged.values()) (shards[shardOf(m)] = shards[shardOf(m)] || []).push(m);
      const files = {};
      for (const [name, list] of Object.entries(shards)) {
        list.sort((a, b) => a.id.localeCompare(b.id));
        const text = JSON.stringify({ games: list.map(canonical) });
        if (remoteShardText[name] !== text) files[name] = { content: text };
      }
      for (const name of Object.keys(remoteShardText)) if (!shards[name]) files[name] = null; // now empty
      if (!same(deleted, remoteDeleted)) files["deleted.json"] = { content: JSON.stringify({ deleted }) };
      if (Object.keys(files).length) {
        files[MARKER] = { content: JSON.stringify({ format: "sedecordle-tracker-sync", schema: S.SCHEMA, updatedAt: Date.now() }, null, 1) };
        await gh.call("PATCH", `/gists/${gistId}`, { files });
      }

      const result = {
        gistId, gistUrl: gist.html_url || `https://gist.github.com/${gistId}`,
        pulled: toPut.length, removed: toRemove.length,
        pushedFiles: Object.keys(files).filter((n) => n !== MARKER).length,
        games: merged.size, at: Date.now(), ms: Date.now() - started,
      };
      await store.setMeta(SETTINGS, Object.assign({}, settings, {
        gistId, gistUrl: result.gistUrl, lastSync: result.at, lastError: null, lastResult: result,
      }));
      return result;
    } catch (e) {
      await store.setMeta(SETTINGS, Object.assign({}, settings, { lastError: e.message, lastErrorAt: Date.now() }));
      throw e;
    }
  }

  // Sync only if set up and not done very recently. Never throws; returns the result or null.
  let running = null;
  async function autoSync(store, { force = false, fetch: fetchFn } = {}) {
    try {
      const s = await store.getMeta(SETTINGS);
      if (!s || !s.token || s.paused) return null;
      if (!force && s.lastSync && Date.now() - s.lastSync < AUTO_MIN_INTERVAL) return null;
      if (running) {
        if (!force) return running;
        await running.catch(() => {}); // a forced sync must include changes made after the running one started
      }
      running = syncNow(store, { fetch: fetchFn }).finally(() => { running = null; });
      return await running;
    } catch (e) {
      return null;
    }
  }

  async function getSettings(store) { return (await store.getMeta(SETTINGS)) || {}; }
  async function setToken(store, token) {
    const s = await getSettings(store);
    await store.setMeta(SETTINGS, Object.assign({}, s, { token: token.trim(), lastError: null }));
  }
  async function disconnect(store) { await store.setMeta(SETTINGS, null); }

  g.SedecSync = { mergeRecords, shardOf, canonical, syncNow, autoSync, getSettings, setToken, disconnect, MARKER };
})(globalThis);
