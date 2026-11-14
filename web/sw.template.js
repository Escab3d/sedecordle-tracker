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

// App files: cache first (they're versioned by the cache name), network as fallback.
// capture.js is always fetched fresh so the bookmarklet gets the latest version.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/capture.js")) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
