// In-memory stand-in for the GitHub gist API, for tests and page previews.
// fakeGitHub({token}) -> {fetch, gists, calls}; only requests with "Bearer <token>" are accepted.
(function () {
  // ---- In-memory GitHub gist API ----
  function fakeGitHub({ token = "good", truncateOver = Infinity } = {}) {
    const gists = {}, calls = [];
    let n = 0;
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    const view = (gs) => ({
      id: gs.id, html_url: "https://gist.github.com/" + gs.id,
      files: Object.fromEntries(Object.entries(gs.files).map(([name, content]) => [name, {
        filename: name, raw_url: "https://raw.example/" + gs.id + "/" + name,
        truncated: content.length > truncateOver, content: content.length > truncateOver ? content.slice(0, truncateOver) : content,
      }])),
    });
    async function fetch(url, opts = {}) {
      const method = opts.method || "GET";
      calls.push(method + " " + url.replace("https://api.github.com", ""));
      if (url.startsWith("https://raw.example/")) {
        const [, id, name] = url.slice("https://raw.example".length).split("/");
        return { ok: true, status: 200, text: async () => gists[id].files[name] };
      }
      if (!opts.headers || opts.headers.Authorization !== "Bearer " + token) return json(401, { message: "Bad credentials" });
      const path = url.replace("https://api.github.com", "").split("?")[0];
      if (method === "GET" && path === "/gists") return json(200, Object.values(gists).map(view));
      if (method === "POST" && path === "/gists") {
        const id = "g" + (++n), body = JSON.parse(opts.body);
        gists[id] = { id, files: Object.fromEntries(Object.entries(body.files).map(([k, v]) => [k, v.content])) };
        return json(201, view(gists[id]));
      }
      const m = path.match(/^\/gists\/(\w+)$/);
      if (m && !gists[m[1]]) return json(404, { message: "Not Found" });
      if (m && method === "GET") return json(200, view(gists[m[1]]));
      if (m && method === "PATCH") {
        const body = JSON.parse(opts.body);
        for (const [k, v] of Object.entries(body.files)) { if (v === null) delete gists[m[1]].files[k]; else gists[m[1]].files[k] = v.content; }
        return json(200, view(gists[m[1]]));
      }
      return json(404, { message: "Not Found" });
    }
    return { fetch, gists, calls };
  }
  window.fakeGitHub = fakeGitHub;
})();
