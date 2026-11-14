(function () {
  "use strict";
  const Y = SedecSync;
  const store = SedecStore.makeStore(window.__sedecTestArea);
  const $ = (id) => document.getElementById(id);
  const fetchFn = window.__sedecTestFetch; // tests only

  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleString();
  }

  async function render(msg) {
    const s = await Y.getSettings(store);
    const st = $("status"), det = $("details");
    const connected = !!s.token;
    $("connected-actions").hidden = !connected;
    $("setup-title").textContent = connected ? "Replace the token" : "Set up sync";
    st.className = "status" + (connected ? (s.lastError ? " err" : " ok") : "");
    st.replaceChildren(Object.assign(document.createElement("span"), { className: "dot" }),
      !connected ? "Not set up on this device." : s.lastError ? "Sync problem" : s.lastSync ? `Synced ${ago(s.lastSync)}` : "Connected, not synced yet");
    det.replaceChildren();
    if (connected && s.lastError) det.append(Object.assign(document.createElement("div"), { className: "err-text", textContent: s.lastError }));
    if (connected && s.lastResult) {
      const r = s.lastResult;
      det.append(Object.assign(document.createElement("div"), {
        textContent: `${r.games} game${r.games === 1 ? "" : "s"} in sync` +
          (r.pulled || r.removed ? ` · last sync brought ${r.pulled} new/updated, removed ${r.removed}` : ""),
      }));
    }
    if (connected && s.gistUrl) {
      const a = Object.assign(document.createElement("a"), { href: s.gistUrl, target: "_blank", rel: "noopener", textContent: "View the sync gist" });
      det.append(a);
    }
    if (msg) det.append(Object.assign(document.createElement("div"), { textContent: msg }));
  }

  async function run(label) {
    const btns = [$("save"), $("sync-now")];
    btns.forEach((b) => { b.disabled = true; });
    $("status").replaceChildren(Object.assign(document.createElement("span"), { className: "dot" }), label);
    let msg = "";
    try {
      const r = await Y.syncNow(store, { fetch: fetchFn });
      msg = `Done in ${(r.ms / 1000).toFixed(1)} s.`;
    } catch (e) { /* the error is saved in settings and shown by render() */ }
    btns.forEach((b) => { b.disabled = false; });
    render(msg);
  }

  $("save").onclick = async () => {
    const v = $("token").value.trim();
    if (!v) { $("token").focus(); return; }
    await Y.setToken(store, v);
    $("token").value = "";
    run("Connecting to GitHub…");
  };
  $("sync-now").onclick = () => run("Syncing…");
  $("disconnect").onclick = async () => {
    if (!confirm("Disconnect this device? Its games stay here; it just stops syncing, and the token is forgotten on this device.")) return;
    await Y.disconnect(store);
    render("Disconnected. Remember to revoke the token on GitHub if you no longer need it.");
  };

  render();
})();
