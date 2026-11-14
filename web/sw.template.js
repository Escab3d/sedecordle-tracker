// Service worker for the Sedecordle Tracker web app. Generated from web/sw.template.js by tools/build_webapp.py.
const VERSION = "__VERSION__";
const FILES = __FILES__;
const CACHE = "sedec-tracker-" + VERSION;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sedec-tracker-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, cache as the offline fallback. (Cache-first would mix old cached scripts with
// newly added pages right after an update.) capture.js is left to the network entirely.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/capture.js")) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: "no-cache" });
      if (res.ok) {
        const c = await caches.open(CACHE);
        c.put(e.request, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
