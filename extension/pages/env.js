// Marks the page as running inside the extension or as the web app, so CSS can show
// the right links (.web-only / .ext-only).
(function () {
  const ext = typeof SedecStore !== "undefined" ? SedecStore.isExtension()
    : !!((globalThis.browser && globalThis.browser.storage) || (globalThis.chrome && globalThis.chrome.storage));
  document.documentElement.classList.add(ext ? "is-ext" : "is-web");
})();
