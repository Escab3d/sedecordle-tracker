// Tiny dependency-free SVG charts with hover tooltips. Colours come from CSS variables
// defined in dashboard.css (--series-1, --status-critical, --seq-*), so dark mode is automatic.
(function (g) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // One shared tooltip element.
  let tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.hidden = true;
      document.body.append(tip);
    }
    return tip;
  }
  function showTip(evt, lines) {
    const t = tooltip();
    t.replaceChildren(...lines.map((l, i) => {
      const d = document.createElement("div");
      d.textContent = l;
      if (i === 0) d.className = "chart-tip-title";
      return d;
    }));
    t.hidden = false;
    const pad = 12, r = t.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 4) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 4) y = evt.clientY - r.height - pad;
    t.style.left = Math.max(4, x) + "px";
    t.style.top = Math.max(4, y) + "px";
  }
  const hideTip = () => { if (tip) tip.hidden = true; };

  // Bar with 4px rounded data-end, square at the baseline.
  function barPath(x, yTop, w, yBase) {
    const h = yBase - yTop;
    if (h <= 0) return "";
    const r = Math.min(4, w / 2, h);
    return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
  }

  // Round tick step (1/2/5 × 10^k) giving at most 5 intervals; returns {step, max, n}.
  function niceTicks(v, minStep) {
    if (!(v > 0)) v = 1;
    let p = Math.pow(10, Math.floor(Math.log10(v / 5)));
    for (;;) {
      for (const m of [1, 2, 5]) {
        const step = Math.max(m * p, minStep || 0);
        const n = Math.ceil(v / step - 1e-9);
        if (n <= 5) return { step, max: n * step, n: Math.max(1, n) };
      }
      p *= 10;
    }
  }

  // Responsive wrapper: re-renders on container resize.
  function mount(container, draw) {
    if (container.__chartObserver) container.__chartObserver.disconnect(); // drop the previous chart's observer
    let lastW = 0;
    const render = () => {
      const w = Math.max(260, Math.round(container.clientWidth));
      if (w === lastW) return;
      lastW = w;
      container.replaceChildren();
      draw(w);
    };
    render();
    if (g.ResizeObserver) {
      container.__chartObserver = new ResizeObserver(render);
      container.__chartObserver.observe(container);
    }
  }

  // bars: [{label, value, valueText?, tip:[...lines], tone?: "critical"}]
  function bars(container, { data, height = 200, yFormat = (v) => String(v), showValues = false, ariaLabel = "", minStep = 1 }) {
    mount(container, (W) => {
      const m = { t: showValues ? 18 : 8, r: 8, b: 24, l: 40 };
      const H = height, iw = W - m.l - m.r, ih = H - m.t - m.b;
      const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value || 0)), minStep);
      const max = ticks.max;
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": ariaLabel });
      const y = (v) => m.t + ih - (v / max) * ih;
      for (let i = 0; i <= ticks.n; i++) {
        const v = ticks.step * i, yy = Math.round(y(v)) + 0.5;
        svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: "grid" }));
        const t = svgEl("text", { x: m.l - 6, y: yy + 4, class: "axis", "text-anchor": "end" });
        t.textContent = yFormat(v);
        svg.append(t);
      }
      const band = iw / data.length, bw = Math.min(24, band * 0.6);
      data.forEach((d, i) => {
        const cx = m.l + band * i + band / 2;
        if (d.value > 0) {
          svg.append(svgEl("path", { d: barPath(cx - bw / 2, y(d.value), bw, y(0)), class: "bar" + (d.tone ? " " + d.tone : "") }));
        }
        if (showValues && d.value != null) {
          const vt = svgEl("text", { x: cx, y: y(d.value || 0) - 5, class: "value", "text-anchor": "middle" });
          vt.textContent = d.valueText ?? yFormat(d.value);
          svg.append(vt);
        }
        const lt = svgEl("text", { x: cx, y: H - 6, class: "axis", "text-anchor": "middle" });
        lt.textContent = d.label;
        svg.append(lt);
        const hit = svgEl("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, class: "hit" });
        hit.addEventListener("mousemove", (e) => showTip(e, d.tip));
        hit.addEventListener("mouseleave", hideTip);
        svg.append(hit);
      });
      svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(0) + 0.5, y2: y(0) + 0.5, class: "baseline" }));
      container.append(svg);
    });
  }

  // Guesses per game over time. points: [{y (16..21) or null for loss, tip:[...]}]
  function trend(container, { points, height = 220, onClick }) {
    mount(container, (W) => {
      const m = { t: 10, r: 12, b: 22, l: 34 };
      const H = height, iw = W - m.l - m.r, ih = H - m.t - m.b;
      const rows = [16, 17, 18, 19, 20, 21, "X"];
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Guesses per game over time" });
      const y = (v) => m.t + ih - ((rows.indexOf(v === null ? "X" : v)) / (rows.length - 1)) * ih;
      rows.forEach((r) => {
        const yy = Math.round(y(r === "X" ? null : r)) + 0.5;
        svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: "grid" }));
        const t = svgEl("text", { x: m.l - 8, y: yy + 4, class: "axis", "text-anchor": "end" });
        t.textContent = String(r);
        svg.append(t);
      });
      const n = points.length;
      const x = (i) => (n === 1 ? m.l + iw / 2 : m.l + (i / (n - 1)) * iw);
      // Line through wins only (losses break it).
      let d = "", pen = false;
      points.forEach((p, i) => {
        if (p.y === null) { pen = false; return; }
        d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(p.y).toFixed(1);
        pen = true;
      });
      svg.append(svgEl("path", { d, class: "line" }));
      // Rolling average of guesses on wins (last 10 games), as a quieter guide.
      const rolling = [];
      points.forEach((p, i) => {
        const win = points.slice(Math.max(0, i - 9), i + 1).filter((q) => q.y !== null).map((q) => q.y);
        rolling.push(win.length ? win.reduce((a, b) => a + b, 0) / win.length : null);
      });
      if (n >= 5) {
        let rd = "";
        rolling.forEach((v, i) => { if (v != null) rd += (rd ? "L" : "M") + x(i).toFixed(1) + "," + (m.t + ih - ((v - 16) / 6) * ih).toFixed(1); });
        svg.append(svgEl("path", { d: rd, class: "line rolling" }));
      }
      points.forEach((p, i) => {
        svg.append(svgEl("circle", { cx: x(i), cy: y(p.y), r: n > 60 ? 3 : 4.5, class: p.y === null ? "dot critical" : "dot" }));
      });
      const cross = svgEl("line", { y1: m.t, y2: m.t + ih, class: "crosshair", visibility: "hidden" });
      svg.append(cross);
      const hit = svgEl("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "hit" + (onClick ? " clickable" : "") });
      const indexAt = (e) => {
        const box = svg.getBoundingClientRect();
        const px = ((e.clientX - box.left) / box.width) * W;
        return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      };
      if (onClick) hit.addEventListener("click", (e) => onClick(indexAt(e)));
      hit.addEventListener("mousemove", (e) => {
        const i = indexAt(e);
        cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
        cross.setAttribute("visibility", "visible");
        const extra = rolling[i] != null && n >= 5 ? [`10-game average: ${rolling[i].toFixed(2)}`] : [];
        showTip(e, points[i].tip.concat(extra));
      });
      hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
      svg.append(hit);
      container.append(svg);
    });
  }

  // 4×4 grid of boards; cells: [{value (0..1 intensity), text, tip:[...]}]
  function grid(container, { cells }) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "board-grid";
    cells.forEach((c, i) => {
      const cell = document.createElement("div");
      const step = c.value == null ? 0 : 1 + Math.min(5, Math.floor(c.value * 6));
      cell.className = "board-cell seq-" + step;
      const n = document.createElement("span");
      n.className = "board-n";
      n.textContent = String(i + 1);
      const v = document.createElement("span");
      v.className = "board-v";
      v.textContent = c.text;
      cell.append(n, v);
      cell.addEventListener("mousemove", (e) => showTip(e, c.tip));
      cell.addEventListener("mouseleave", hideTip);
      wrap.append(cell);
    });
    container.append(wrap);
  }

  g.SedecCharts = { bars, trend, grid };
})(globalThis);
