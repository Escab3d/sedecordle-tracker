(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // The web app's root (this page lives in <root>/pages/).
  const APP = new URL("../", location.href).href;
  const isWeb = location.protocol === "https:" || location.protocol === "http:";
  let variant = "loader", inlineCode = null;

  const loader = "javascript:(function(){var s=document.createElement('script');" +
    `s.src='${APP}capture.js?'+Date.now();document.body.appendChild(s);})();`;

  async function inline() {
    if (inlineCode) return inlineCode;
    const src = await (await fetch(APP + "capture.js", { cache: "no-store" })).text();
    // The page address is passed in, since there's no script URL to read it from.
    inlineCode = "javascript:" + encodeURIComponent(`window.__sedecTrackerAppBase=${JSON.stringify(APP)};` + src);
    return inlineCode;
  }

  async function show() {
    const notes = {
      loader: "Short; loads the latest capture script from this app each time (needs a connection).",
      inline: "Contains the whole script, so it keeps working even if loading scripts on sedecordle.com is ever blocked. Recreate it after app updates.",
    };
    $("variant-note").textContent = notes[variant];
    let code;
    try { code = variant === "loader" ? loader : await inline(); }
    catch (e) { code = ""; $("variant-note").textContent = "Couldn't load the capture script: " + e.message; }
    $("bm-code").value = code;
    $("bm-link").href = code || "#";
  }

  $("variant").addEventListener("click", (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v) return;
    variant = v;
    for (const b of $("variant").children) b.classList.toggle("on", b.dataset.v === v);
    show();
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ta = $(btn.dataset.copy);
      const label = btn.textContent;
      try { await navigator.clipboard.writeText(ta.value); }
      catch (e) { ta.select(); document.execCommand && document.execCommand("copy"); }
      btn.textContent = "Copied ✓";
      setTimeout(() => { btn.textContent = label; }, 1500);
    });
  });
  $("bm-link").addEventListener("click", (e) => {
    e.preventDefault();
    alert("Drag this link to your bookmarks bar, then click it while on sedecordle.com.");
  });

  if (!isWeb) {
    $("bm-code").value = "Open this page from the hosted web app to get a bookmark that points to it.";
  } else {
    show();
  }

  const p = $("persist");
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((ok) => {
      p.className = ok ? "ok" : "muted";
      p.textContent = ok ? "Storage is persistent: the browser won't clear your games to free up space."
        : "Storage isn't marked persistent yet. Installing the app (Add to Home screen) usually fixes this; keep an export as a backup.";
    });
  } else p.textContent = "";
})();
