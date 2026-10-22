"use strict";
/*
  Mileo — assessor: run an independent checkpoint (checkpoint-assess.html).
  Lists the checkpoints booked with you. For each skill tap ✓ (can do it)
  or ↻ (not yet), add one line for the student, Send. The database
  (record_checkpoint, migration 007) checks it's really yours, saves it
  once, works out the result and sends "not yet" skills back to Practising.
  You only see the student's first name and the skills: never their
  teacher's notes, so the check stays independent.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, icon, areaIcon, ring, avatar, short, AREA_BG } = window.MileoCP;
  let items = [];
  let current = null;
  let marks = {};
  let ringEl = null;

  const missing = (e) => e && (e.code === "42883" || e.code === "PGRST202" || /does not exist|schema cache|Could not find/i.test(e.message || ""));
  const fmt = (d) => d ? new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Time to be confirmed";
  const safeUrl = (u) => typeof u === "string" && /^https:\/\//i.test(u) ? u : null;
  const show = (v) => ["listView", "assessView", "doneView"].forEach((id) => { $(id).hidden = id !== v; });
  const status = (t, cls) => { $("status").textContent = t; $("status").className = "m-status" + (cls ? " " + cls : ""); };

  async function loadList() {
    show("listView");
    const { data, error } = await window.mileo.rpc("my_checkpoints_to_assess");
    const box = $("list");
    box.textContent = "";
    if (error) {
      console.error(error);
      $("setupNote").hidden = false;
      $("setupNote").textContent = missing(error) ? "Checkpoints need one setup step first (migration 007)." : "Couldn't load your checkpoints. Please refresh.";
      return;
    }
    items = data || [];
    if (!items.length) {
      const empty = el("div", "m-card empty-card");
      empty.style.textAlign = "center";
      empty.appendChild(el("h3", null, "Nothing to check right now"));
      empty.appendChild(el("p", "m-hint", "When the Mileo team books a checkpoint with you, it appears here."));
      box.appendChild(empty);
      return;
    }
    items.forEach((c, i) => {
      const card = el("article", "cp-card");
      card.appendChild(avatar(c.student_first_name, null, "big-av", i));
      const g = el("div", "grow");
      g.appendChild(el("strong", null, c.student_first_name + (c.module_position ? " · Module " + c.module_position : "")));
      g.appendChild(el("div", "m-hint", fmt(c.scheduled_at) + " · " + c.duration_minutes + " min · " + (c.skills || []).length + " skills"));
      card.appendChild(g);
      const url = safeUrl(c.meeting_url);
      if (url) {
        const a = el("a", "m-btn quiet", "Join call");
        a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
        card.appendChild(a);
      }
      const start = el("button", "m-btn small", "Start →");
      start.type = "button";
      start.addEventListener("click", () => open(c, i));
      card.appendChild(start);
      box.appendChild(card);
    });
  }

  function open(c, i) {
    current = c;
    marks = {};
    show("assessView");
    status("");
    $("msg").value = "";
    $("aAvatar").textContent = "";
    $("aAvatar").appendChild(avatar(c.student_first_name, null, "big-av", i));
    $("aTitle").textContent = "Can " + c.student_first_name + "…";
    const url = safeUrl(c.meeting_url);
    $("aCall").hidden = !url;
    if (url) $("aCall").href = url;
    renderSkills();
    $("aRing").textContent = "";
    ringEl = ring(0, (c.skills || []).length, 104);
    $("aRing").appendChild(ringEl);
    window.scrollTo(0, 0);
  }

  function renderSkills() {
    const box = $("skills");
    box.textContent = "";
    (current.skills || []).forEach((s) => {
      const v = marks[s.skill_id];
      const card = el("article", "cp-skill" + (v === true ? " yes" : v === false ? " no" : ""));
      const ic = el("span", "icon");
      ic.style.background = AREA_BG[s.area] || "#FFD3E2";
      ic.appendChild(areaIcon(s.area, 46));
      card.appendChild(ic);
      const what = short(s.can_do);
      card.appendChild(el("h3", null, what.charAt(0).toLowerCase() + what.slice(1) + "?"));
      if (s.task) card.appendChild(el("p", "task", s.task));
      const yn = el("div", "yn");
      const y = el("button", "y");
      y.type = "button";
      y.setAttribute("aria-pressed", String(v === true));
      y.setAttribute("aria-label", "Yes: " + what);
      y.appendChild(icon("M5 12l5 5 9-10", 32, "currentColor", 3.2));
      y.addEventListener("click", () => mark(s.skill_id, true));
      const n = el("button", "n");
      n.type = "button";
      n.setAttribute("aria-pressed", String(v === false));
      n.setAttribute("aria-label", "Not yet: " + what);
      n.appendChild(icon("M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5", 30, "currentColor", 3));
      n.addEventListener("click", () => mark(s.skill_id, false));
      yn.append(y, n);
      card.appendChild(yn);
      box.appendChild(card);
    });
  }

  function mark(id, value) {
    marks[id] = value;
    status("");
    renderSkills();
    const total = (current.skills || []).length;
    ringEl.update(Object.values(marks).filter((x) => x === true).length, total);
  }

  $("sendBtn").addEventListener("click", async () => {
    const skills = current.skills || [];
    const left = skills.filter((s) => marks[s.skill_id] === undefined).length;
    if (left) { status("Tap ✓ or ↻ for every skill first (" + left + " left).", "bad"); return; }
    const btn = $("sendBtn");
    btn.disabled = true;
    status("");
    const { data, error } = await window.mileo.rpc("record_checkpoint", {
      p_checkpoint: current.checkpoint_id,
      p_results: skills.map((s) => ({ skill_id: s.skill_id, confirmed: marks[s.skill_id] })),
      p_summary: $("msg").value.trim() || null
    });
    btn.disabled = false;
    if (error) {
      console.error(error);
      status(/already been recorded/i.test(error.message || "") ? "This checkpoint was already sent." : "Couldn't send it. (" + (error.code || "error") + ")", "bad");
      return;
    }
    const yes = skills.filter((s) => marks[s.skill_id]).length;
    $("doneText").textContent = yes + " of " + skills.length + " confirmed. " + current.student_first_name + " will see a celebration next time they log in." + (data === "not_confirmed" ? " Their teacher will keep practising these." : "");
    show("doneView");
  });

  $("backBtn").addEventListener("click", loadList);
  $("againBtn").addEventListener("click", loadList);

  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      loadList().catch((e) => { console.error(e); $("setupNote").hidden = false; $("setupNote").textContent = "Couldn't load. Please refresh."; });
    }
  }, 50);
})();
