// Syncs in the background when a tracker page opens (if sync is set up and it hasn't
// run in the last couple of minutes). Pages listen for "sedec-data-changed" to refresh.
(function () {
  "use strict";
  if (!globalThis.SedecSync) return;
  const store = SedecStore.makeStore(window.__sedecTestArea);
  window.SedecAutoSync = async function (opts) {
    const r = await SedecSync.autoSync(store, Object.assign({ fetch: window.__sedecTestFetch }, opts || {}));
    if (r && (r.pulled || r.removed)) window.dispatchEvent(new CustomEvent("sedec-data-changed", { detail: r }));
    return r;
  };
  // Let the page render first. Pages marked data-autosync="manual" call SedecAutoSync themselves.
  if (document.body.dataset.autosync !== "manual") setTimeout(() => window.SedecAutoSync(), 300);
})();
