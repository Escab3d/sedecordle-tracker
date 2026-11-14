// Game storage (one key per game: "game:<id>"). chrome.storage.local inside the extension
// (content scripts, extension pages, Chrome and Firefox); IndexedDB when the pages run as the web app.
(function (g) {
  "use strict";

  const PREFIX = "game:";
  const ANALYSIS = "analysis:"; // cached engine results, derived data (safe to delete)
  const DELETED = "deleted:";   // tombstones {id, deletedAt} so deletions sync
  const META = "meta:";         // settings (sync)

  // Extension storage when running inside the extension, otherwise IndexedDB (the web app).
  let webArea = null;
  function api() {
    const a = g.browser && g.browser.storage ? g.browser : g.chrome;
    if (a && a.storage && a.storage.local) return a.storage.local;
    if (g.indexedDB) return webArea || (webArea = idbArea());
    throw new Error("no storage available");
  }
  const isExtension = () => {
    const a = g.browser && g.browser.storage ? g.browser : g.chrome;
    return !!(a && a.storage && a.storage.local);
  };

  // chrome.storage.local-shaped wrapper over one IndexedDB object store.
  function idbArea(dbName = "sedecordle-tracker") {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const req = g.indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    }));
    const tx = async (mode, fn) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction("kv", mode), s = t.objectStore("kv");
        let out;
        Promise.resolve(fn(s, (v) => { out = v; })).catch(rej);
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    // Ask the browser not to evict our data (installed web apps usually get this).
    if (g.navigator && g.navigator.storage && g.navigator.storage.persist) g.navigator.storage.persist().catch(() => {});
    return {
      async get(k) {
        return tx("readonly", (s, done) => {
          if (k === null) {
            const out = {};
            const req = s.openCursor();
            req.onsuccess = () => {
              const c = req.result;
              if (c) { out[c.key] = c.value; c.continue(); } else done(out);
            };
          } else {
            const req = s.get(k);
            req.onsuccess = () => done(req.result === undefined ? {} : { [k]: req.result });
          }
        });
      },
      async set(obj) { return tx("readwrite", (s) => { for (const k in obj) s.put(obj[k], k); }); },
      async remove(keys) { return tx("readwrite", (s) => { for (const k of [].concat(keys)) s.delete(k); }); },
    };
  }

  function makeStore(area) {
    area = area || api();
    return {
      async get(id) {
        const k = PREFIX + id;
        const r = await area.get(k);
        return r[k] || null;
      },
      async getAll() {
        const all = await area.get(null);
        return Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => all[k]);
      },
      async put(rec) {
        await area.set({ [PREFIX + rec.id]: rec });
      },
      async putMany(recs) {
        if (!recs.length) return;
        const obj = {};
        for (const r of recs) obj[PREFIX + r.id] = r;
        await area.set(obj);
      },
      // Deleting leaves a tombstone so sync can delete the game on other devices too.
      async remove(id, { tombstone = true } = {}) {
        if (tombstone) await area.set({ [DELETED + id]: { id, deletedAt: Date.now() } });
        await area.remove([PREFIX + id, ANALYSIS + id]);
      },
      async clear({ tombstone = true } = {}) {
        const all = await area.get(null);
        const ids = Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
        if (tombstone && ids.length) {
          const now = Date.now(), obj = {};
          for (const id of ids) obj[DELETED + id] = { id, deletedAt: now };
          await area.set(obj);
        }
        await area.remove(Object.keys(all).filter((k) => k.startsWith(PREFIX) || k.startsWith(ANALYSIS)));
      },
      async getTombstones() {
        const all = await area.get(null), out = {};
        for (const k of Object.keys(all)) if (k.startsWith(DELETED)) out[all[k].id] = all[k].deletedAt;
        return out;
      },
      async putTombstones(map) {
        const obj = {};
        for (const id in map) obj[DELETED + id] = { id, deletedAt: map[id] };
        if (Object.keys(obj).length) await area.set(obj);
      },
      // Small settings values (e.g. sync settings), kept beside the games.
      async getMeta(key) {
        const k = META + key;
        const r = await area.get(k);
        return r[k] === undefined ? null : r[k];
      },
      async setMeta(key, value) {
        if (value === null) await area.remove(META + key);
        else await area.set({ [META + key]: value });
      },
      async getAnalysis(id) {
        const k = ANALYSIS + id;
        const r = await area.get(k);
        return r[k] || null;
      },
      async getAllAnalyses() {
        const all = await area.get(null);
        return Object.keys(all).filter((k) => k.startsWith(ANALYSIS)).map((k) => all[k]);
      },
      async putAnalysis(a) {
        await area.set({ [ANALYSIS + a.id]: a });
      },
    };
  }

  // In-memory stand-in with the same interface (tests).
  function memoryArea() {
    const data = {};
    const clone = (v) => JSON.parse(JSON.stringify(v));
    return {
      data,
      async get(k) {
        if (k === null) return clone(data);
        return k in data ? { [k]: clone(data[k]) } : {};
      },
      async set(obj) { for (const k in obj) data[k] = clone(obj[k]); },
      async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
    };
  }

  g.SedecStore = { PREFIX, ANALYSIS, DELETED, META, makeStore, memoryArea, idbArea, isExtension };
})(globalThis);
