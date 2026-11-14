// Registers the service worker (offline use + installability). Web app only.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  // When a new version takes over an already-open page, reload once so the page never
  // runs a mix of old and new scripts.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  // pwa.js and sw.js both live at the app root.
  navigator.serviceWorker.register(new URL("sw.js", document.currentScript.src).href, { updateViaCache: "none" }).catch(() => {});
}
