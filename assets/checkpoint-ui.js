"use strict";
/*
  Mileo — small shared pieces for the checkpoint screens:
  progress ring, avatars, skill icons, the chime and the confetti.
  Everything is built with DOM methods, so nothing typed by a user can
  inject HTML.
*/
window.MileoCP = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const PASTELS = ["#FFD3E2", "#CDE7FF", "#FFEFB0", "#D7F5E3"];
  const AREA_BG = { speaking: "#FFD3E2", listening: "#CDE7FF", grammar: "#FFEFB0", vocabulary: "#D7F5E3", reading: "#CDE7FF", writing: "#FFEFB0", pronunciation: "#FFD3E2" };
  const ICONS = {
    speaking: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8.5 11h.01M12 11h.01M15.5 11h.01",
    listening: "M6 9a6 6 0 1 1 12 0c0 3-2 4-3 5.5S14 18 12 20a3 3 0 0 1-4-1M10 9a2 2 0 1 1 4 0c0 1.5-2 2-2 3.5",
    grammar: "M4 7h10M4 12h16M4 17h7M17 4l3 3-3 3",
    vocabulary: "M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM4 19V5M9 8h5",
    reading: "M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z",
    writing: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    pronunciation: "M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4"
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  }
  function icon(path, size, color, width) {
    const s = svg("svg", { width: size || 24, height: size || 24, viewBox: "0 0 24 24", fill: "none", stroke: color || "currentColor", "stroke-width": width || 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    s.appendChild(svg("path", { d: path }));
    return s;
  }
  const areaIcon = (area, size) => icon(ICONS[area] || ICONS.speaking, size || 44, "#1B1D4B", 2);

  /* A ring that fills to done/total, with a label in the middle. */
  function ring(done, total, size, label) {
    const box = el("span", "ring");
    box.style.width = box.style.height = size + "px";
    const r = size / 2 - size * 0.1, c = 2 * Math.PI * r, w = Math.max(8, size * 0.12);
    const s = svg("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size, role: "img", "aria-label": label || (done + " of " + total) });
    s.appendChild(svg("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "#FFFFFF", "stroke-width": w }));
    const fill = svg("circle", { class: "ring-fill", cx: size / 2, cy: size / 2, r, fill: "none", stroke: "#0F9D58", "stroke-width": w, "stroke-linecap": "round", transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")" });
    fill.setAttribute("stroke-dasharray", (total ? c * done / total : 0).toFixed(1) + " " + c.toFixed(1));
    s.appendChild(fill);
    box.appendChild(s);
    const mid = el("span", "ring-mid", done + "/" + total);
    mid.style.fontSize = Math.round(size * 0.26) + "px";
    mid.setAttribute("aria-hidden", "true");
    box.appendChild(mid);
    box.update = (d, t) => {
      fill.setAttribute("stroke-dasharray", (t ? c * d / t : 0).toFixed(1) + " " + c.toFixed(1));
      mid.textContent = d + "/" + t;
      s.setAttribute("aria-label", d + " of " + t);
    };
    return box;
  }

  /* Round avatar: photo if there is a safe https one, else the initial. */
  function avatar(name, photo, cls, i) {
    const a = el("span", cls || "av");
    a.style.background = PASTELS[(i || 0) % PASTELS.length];
    if (typeof photo === "string" && /^https:\/\//i.test(photo)) {
      const img = el("img");
      img.src = photo; img.alt = ""; img.referrerPolicy = "no-referrer"; img.loading = "lazy";
      a.appendChild(img);
    } else {
      a.textContent = ((name || "M").trim().charAt(0) || "M").toUpperCase();
    }
    return a;
  }

  /* A short, happy four-note chime (only after a tap: browsers block sound before). */
  function chime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.11;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.75);
      });
      setTimeout(() => { try { ctx.close(); } catch (e) { /* ignore */ } }, 1600);
    } catch (e) { /* sound is a bonus */ }
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#F7A8CB", "#7CCBF5", "#6FD69B", "#FFD25E", "#2DD4BF", "#FFD3E2"];
    const box = el("div", "confetti");
    box.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 40; i++) {
      const p = el("i");
      const w = 8 + (i % 3) * 3;
      p.style.left = ((i * 37) % 100) + "%";
      p.style.width = w + "px";
      p.style.height = (i % 2 ? w : w * 1.8) + "px";
      p.style.borderRadius = i % 4 === 0 ? "50%" : "3px";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (((i * 53) % 90) / 100) + "s";
      p.style.animationDuration = (1.8 + ((i * 29) % 12) / 10) + "s";
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4500);
  }

  /* "Can describe a past holiday" → "Describe a past holiday" */
  const short = (canDo) => {
    const t = String(canDo || "").replace(/^can\s+/i, "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  return { el, icon, areaIcon, ring, avatar, chime, confetti, short, AREA_BG, PASTELS };
})();
