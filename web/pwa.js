// Registers the service worker (offline use + installability). Web app only.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  // pwa.js and sw.js both live at the app root.
  navigator.serviceWorker.register(new URL("sw.js", document.currentScript.src).href).catch(() => {});
}
