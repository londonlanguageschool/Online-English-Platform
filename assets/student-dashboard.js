"use strict";
/*
  Mileo — student dashboard (real data).
  Shows the signed-in student's programme, module by module, with each
  skill's stage taken from the teacher's lesson evidence and any
  independent checkpoint result. Progress is never a typed-in percentage:
  it is counted from evidence ("4 of 9 skills secure").

  Also shows: next targets, their current teacher, lessons (what was
  covered + homework + skills worked on) and checkpoints.

  Every query is limited by the database rules (RLS): a student only ever
  receives their own enrolments, records and their own teacher's profile.
  The teacher-to-teacher handover note is deliberately not shown here.
  Needs migrations 003 + 005.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const AREAS = ["speaking", "listening", "reading", "writing", "grammar", "vocabulary", "pronunciation"];
  const STAGE_LABEL = { introduced: "Just introduced", practising: "Practising", secure: "Secure" };
  const STAGE_RANK = { introduced: 1, practising: 2, secure: 3 };
  const CP_OUTCOME = { confirmed: "Progress confirmed", partly_confirmed: "Partly confirmed", not_confirmed: "Keep practising" };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
  const isoDay = (date) => date.toISOString().slice(0, 10);

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return Array.isArray(data) ? data : (data ? [data] : []);
  }
  async function soft(promise) {
    const { data, error } = await promise;
    if (error) console.warn("Mileo:", error.message || error);
    return error ? { error, data: [] } : { data: Array.isArray(data) ? data : (data ? [data] : []) };
  }
  const missing = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" ||
    /does not exist|schema cache|Could not find/i.test(e.message || ""));

  function note(text) {
    $("setupNote").hidden = false;
    $("setupNote").textContent = text;
  }

  /* A skill's status for the student: checkpoint result wins over teacher stage. */
  function statusOf(p) {
    if (p && p.checkpoint_confirmed === true) return { cls: "s-confirmed", label: "✓ Confirmed", rank: 4 };
    if (p && p.teacher_stage) return { cls: "s-" + p.teacher_stage, label: STAGE_LABEL[p.teacher_stage], rank: STAGE_RANK[p.teacher_stage] };
    return { cls: "", label: "Not started yet", rank: 0 };
  }

  let me = null;
  let firstName = "";
  let enrolments = [];
  let programmes = [];

  async function start() {
    const db = window.mileo;
    const { data: u } = await db.auth.getUser();
    me = u.user;
    const first = ((me.user_metadata && me.user_metadata.full_name) || me.email.split("@")[0]).split(/\s+/)[0];
    firstName = first;
    const hour = new Date().getHours();
    $("greeting").textContent = (hour < 12 ? "Good morning, " : hour < 18 ? "Good afternoon, " : "Good evening, ") + first + ".";

    // Learning profile → nudge if empty.
    const sp = await soft(db.from("student_profiles").select("goals,difficulties").eq("student_id", me.id).maybeSingle());
    if (!sp.error && (!sp.data[0] || !sp.data[0].goals)) $("profileNudge").hidden = false;

    try {
      enrolments = await q(db.from("enrolments").select("*").eq("student_id", me.id)
        .in("status", ["active", "paused", "completed"]).order("started_on", { ascending: false }));
    } catch (e) {
      console.error(e);
      note(missing(e) ? "Your dashboard isn't switched on yet. The Mileo team is finishing a one-time setup."
        : "We couldn't load your programme. Please refresh the page.");
      return;
    }

    if (!enrolments.length) { $("empty").hidden = false; return; }

    // Active first, then paused, then completed.
    const order = { active: 0, paused: 1, completed: 2 };
    enrolments.sort((a, b) => order[a.status] - order[b.status]);

    programmes = (await soft(db.from("programmes").select("id,title,code,cefr_level,description")
      .in("id", [...new Set(enrolments.map((e) => e.programme_id))]))).data;

    if (enrolments.length > 1) {
      const sw = $("progSwitch");
      sw.hidden = false;
      enrolments.forEach((e, i) => {
        const p = programmes.find((x) => x.id === e.programme_id);
        const b = el("button", null, (p ? p.title : "Programme") + (e.status !== "active" ? " (" + e.status + ")" : ""));
        b.type = "button";
        b.setAttribute("aria-pressed", String(i === 0));
        b.addEventListener("click", () => {
          sw.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          show(e).catch(fail);
        });
        sw.appendChild(b);
      });
    }
    $("dash").hidden = false;
    await show(enrolments[0]);
  }

  async function show(enr) {
    const db = window.mileo;
    const prog = programmes.find((p) => p.id === enr.programme_id);
    $("heroLine").textContent = prog
      ? "You're on " + prog.title + (prog.cefr_level ? " (" + prog.cefr_level + ")" : "") +
        (enr.status === "paused" ? ". This programme is paused." : enr.status === "completed" ? ". Programme completed. Well done!" : ".")
      : "Your programme, your progress and your lessons, all in one place.";
    $("progTitle").textContent = prog ? prog.title : "My programme";

    const [modulesRes, progressRes, assignRes, lessonsRes, cpRes] = await Promise.all([
      soft(db.from("modules").select("id,position,title,summary").eq("programme_id", enr.programme_id).order("position")),
      soft(db.from("student_skill_progress").select("*").eq("enrolment_id", enr.id)),
      soft(db.from("teacher_assignments").select("teacher_id,starts_on").eq("enrolment_id", enr.id).is("ends_on", null)),
      soft(db.from("lesson_records").select("id,taught_on,duration_minutes,summary,homework,created_at")
        .eq("enrolment_id", enr.id).order("taught_on", { ascending: false }).order("created_at", { ascending: false }).limit(20)),
      soft(db.from("checkpoints").select("*")
        .eq("enrolment_id", enr.id).order("scheduled_at", { ascending: false, nullsFirst: false }))
    ]);
    if (lessonsRes.error && missing(lessonsRes.error)) {
      note("Lesson records aren't switched on yet. The Mileo team needs to finish one setup step.");
    }

    const modules = modulesRes.data;
    const progress = progressRes.data;
    const modIds = modules.map((m) => m.id);
    const links = modIds.length ? (await soft(db.from("module_skills").select("module_id,skill_id").in("module_id", modIds))).data : [];
    const pOf = (skillId) => progress.find((p) => p.skill_id === skillId);

    // ---- Stats (counted from evidence)
    const total = progress.length;
    const secure = progress.filter((p) => p.teacher_stage === "secure" || p.checkpoint_confirmed === true).length;
    const confirmed = progress.filter((p) => p.checkpoint_confirmed === true).length;
    $("statSecure").textContent = total ? secure + " of " + total : "0";
    $("statSecureLabel").textContent = "skills secure";
    $("statConfirmed").textContent = String(confirmed);
    const monthStart = isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    $("statLessons").textContent = String(lessonsRes.data.filter((l) => l.taught_on >= monthStart).length);

    // ---- Modules and skills
    const box = $("modules");
    box.textContent = "";
    if (!modules.length) box.appendChild(el("p", "m-hint", "Your programme's modules will appear here soon."));
    modules.forEach((m) => {
      const skills = links.filter((l) => l.module_id === m.id).map((l) => pOf(l.skill_id) || { skill_id: l.skill_id })
        .filter((s) => s.can_do)
        .sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area) || String(a.skill_code).localeCompare(String(b.skill_code)));
      const sec = el("section", "module");
      const head = el("div", "module-head");
      head.appendChild(el("h3", null, "Module " + m.position + " · " + m.title));
      const done = skills.filter((s) => statusOf(s).rank >= 3).length;
      head.appendChild(el("span", "m-hint", skills.length ? done + " of " + skills.length + " secure" : ""));
      sec.appendChild(head);
      if (m.summary) sec.appendChild(el("p", "m-hint", m.summary));

      if (skills.length) {
        const bar = el("div", "seg-bar");
        bar.setAttribute("aria-hidden", "true");
        skills.forEach((s) => {
          const st = statusOf(s);
          bar.appendChild(el("span", st.rank >= 3 ? "s-secure" : st.cls));
        });
        sec.appendChild(bar);
        const ul = el("ul", "skill-list");
        skills.forEach((s) => {
          const st = statusOf(s);
          const li = el("li");
          const t = el("span");
          t.appendChild(el("span", "can-do", s.can_do));
          t.appendChild(el("span", "area", s.area));
          li.appendChild(t);
          li.appendChild(el("span", "stage " + st.cls, st.label));
          ul.appendChild(li);
        });
        sec.appendChild(ul);
      }
      box.appendChild(sec);
    });

    // ---- Next targets: skills in progress first, then the next unstarted ones in module order
    const inModuleOrder = [];
    modules.forEach((m) => links.filter((l) => l.module_id === m.id).forEach((l) => {
      const p = pOf(l.skill_id);
      if (p && !inModuleOrder.includes(p)) inModuleOrder.push(p);
    }));
    const working = inModuleOrder.filter((p) => p.teacher_stage === "practising" || p.teacher_stage === "introduced")
      .filter((p) => p.checkpoint_confirmed !== true)
      .sort((a, b) => STAGE_RANK[b.teacher_stage] - STAGE_RANK[a.teacher_stage]);
    const next = inModuleOrder.filter((p) => !p.teacher_stage && p.checkpoint_confirmed !== true);
    const targets = working.concat(next).slice(0, 3);
    const tl = $("targets");
    tl.textContent = "";
    if (!targets.length) {
      tl.appendChild(el("li", null, total ? "Every skill in this programme is secure. Brilliant work!" : "Your first targets will appear after your first lesson."));
    }
    targets.forEach((p) => {
      const li = el("li", null, p.can_do);
      li.appendChild(el("span", "m-hint", " · " + (p.teacher_stage ? STAGE_LABEL[p.teacher_stage] : "coming up")));
      tl.appendChild(li);
    });

    // ---- Teacher
    const tbox = $("teacher");
    tbox.textContent = "";
    const ta = assignRes.data[0];
    if (!ta) {
      const c = el("div", "m-card");
      c.appendChild(el("p", "m-hint", "We're matching you with a verified Mileo teacher who suits your goals and times."));
      tbox.appendChild(c);
    } else {
      const [person, tprof] = await Promise.all([
        soft(db.from("profiles").select("id,full_name").eq("id", ta.teacher_id).maybeSingle()),
        soft(db.from("teacher_profiles").select("*").eq("teacher_id", ta.teacher_id).maybeSingle())
      ]);
      const t = Object.assign({}, tprof.data[0] || {}, { full_name: (person.data[0] || {}).full_name || "Your teacher" });
      const card = window.MileoTeacherCard.render(t);
      const since = el("div", "t-actions");
      since.appendChild(el("span", "verified-pill", "✓ Mileo Verified Teacher"));
      card.appendChild(since);
      tbox.appendChild(card);
    }

    // ---- Lessons (+ skills worked on in each)
    const lbox = $("lessons");
    lbox.textContent = "";
    const lessons = lessonsRes.data;
    if (!lessons.length) {
      lbox.appendChild(el("p", "m-hint", "After each lesson, your teacher's summary and homework will appear here."));
    } else {
      const ev = (await soft(db.from("skill_evidence").select("lesson_record_id,skill_id,stage")
        .in("lesson_record_id", lessons.map((l) => l.id)))).data;
      lessons.forEach((l) => {
        const item = el("article", "lesson-item");
        item.appendChild(el("strong", null, fmtDate(l.taught_on) + " · " + l.duration_minutes + " min"));
        item.appendChild(el("p", null, l.summary || "Lesson recorded."));
        const worked = ev.filter((x) => x.lesson_record_id === l.id);
        if (worked.length) {
          const tags = el("div", "t-tags");
          worked.forEach((w) => {
            const p = pOf(w.skill_id);
            if (p) tags.appendChild(el("span", "stage s-" + w.stage, p.can_do.length > 60 ? p.can_do.slice(0, 58) + "…" : p.can_do));
          });
          item.appendChild(tags);
        }
        if (l.homework) item.appendChild(el("p", "homework", "Homework: " + l.homework));
        lbox.appendChild(item);
      });
    }

    // ---- Checkpoints
    const cbox = $("checkpoints");
    cbox.textContent = "";
    const cps = cpRes.data.filter((c) => c.status !== "cancelled");
    if (!cps.length) {
      cbox.appendChild(el("p", "m-hint", "Your first checkpoint will be arranged when you finish a module."));
    }
    cps.forEach((c) => {
      const m = modules.find((x) => x.id === c.module_id);
      const row = el("div", "cp-item");
      row.appendChild(el("span", null, (m ? "Module " + m.position + ": " + m.title : "Progress checkpoint")));
      const cpCls = { confirmed: "s-confirmed", partly_confirmed: "s-practising", not_confirmed: "s-introduced" };
      row.appendChild(el("span", "stage " + (c.status === "completed" ? (cpCls[c.outcome] || "") : ""),
        c.status === "completed" ? (CP_OUTCOME[c.outcome] || "Completed") + " · " + fmtDate(c.completed_at)
          : "Booked" + (c.scheduled_at ? " · " + fmtDate(c.scheduled_at) : "")));
      cbox.appendChild(row);
      if (c.status === "scheduled" && /^https:\/\//i.test(c.meeting_url || "")) {
        const a = el("a", "m-btn small", "Join call");
        a.href = c.meeting_url; a.target = "_blank"; a.rel = "noopener noreferrer";
        cbox.appendChild(a);
      }
      if (c.status === "completed" && c.summary) cbox.appendChild(el("p", "m-hint", c.summary));
    });

    // ---- A new checkpoint result? Open the reward (once).
    const fresh = cps.find((c) => c.status === "completed" && "seen_by_student_at" in c && !c.seen_by_student_at);
    if (fresh) showReward(fresh, modules, links, progress, prog).catch((e) => console.error(e));
  }

  /* The checkpoint reward: tap to open → chime, confetti, what you can do now, next goal. */
  async function showReward(cp, modules, links, progress, prog) {
    const UI = window.MileoCP;
    if (!UI) return;
    const db = window.mileo;
    const res = await soft(db.from("checkpoint_skill_results").select("skill_id,confirmed").eq("checkpoint_id", cp.id));
    const results = res.data;
    const can = (id) => { const p = progress.find((x) => x.skill_id === id); return p ? p.can_do : ""; };
    const yes = results.filter((r) => r.confirmed);
    const notYet = results.filter((r) => !r.confirmed);
    const mod = modules.find((m) => m.id === cp.module_id);
    const nextMod = mod ? modules.find((m) => m.position === mod.position + 1) : null;
    let goal = notYet.length ? UI.short(can(notYet[0].skill_id)) : "";
    if (!goal && nextMod) {
      const ids = links.filter((l) => l.module_id === nextMod.id).map((l) => l.skill_id);
      const p = progress.find((x) => ids.includes(x.skill_id) && x.teacher_stage !== "secure" && x.checkpoint_confirmed !== true);
      goal = p ? UI.short(p.can_do) : "Module " + nextMod.position + ": " + nextMod.title;
    }

    const { el: e } = UI;
    const overlay = e("div", "reward");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Your checkpoint result");
    const box = e("div", "reward-box");
    overlay.appendChild(box);

    // Closed: wiggling signpost + Open
    const sign = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sign.setAttribute("width", "180"); sign.setAttribute("height", "180"); sign.setAttribute("viewBox", "0 0 190 190");
    sign.setAttribute("aria-hidden", "true"); sign.setAttribute("class", "wiggle");
    [["circle", { cx: 95, cy: 95, r: 88, fill: "#FFEFB0" }], ["rect", { x: 88, y: 30, width: 14, height: 130, rx: 7, fill: "#1B1D4B" }],
     ["circle", { cx: 95, cy: 30, r: 11, fill: "#1B1D4B" }], ["path", { d: "M52 52 H128 L142 64 L128 76 H52 Z", fill: "#F7A8CB" }],
     ["path", { d: "M138 88 H62 L48 100 L62 112 H138 Z", fill: "#7CCBF5" }], ["path", { d: "M52 124 H128 L142 136 L128 148 H52 Z", fill: "#6FD69B" }]]
      .forEach(([t, a]) => { const n = document.createElementNS("http://www.w3.org/2000/svg", t); Object.entries(a).forEach(([k, v]) => n.setAttribute(k, v)); sign.appendChild(n); });
    box.appendChild(sign);
    const h = e("h2", null, "Your result is ready");
    box.appendChild(h);
    box.appendChild(e("em", "it", "Il tuo risultato è pronto"));
    const openBtn = e("button", "m-btn big", "Open");
    openBtn.type = "button";
    box.appendChild(openBtn);
    document.body.appendChild(overlay);
    openBtn.focus();

    const close = async () => {
      overlay.remove();
      await db.rpc("mark_checkpoint_seen", { p_checkpoint: cp.id });
    };

    openBtn.addEventListener("click", () => {
      UI.chime();
      if (yes.length) UI.confetti();
      box.textContent = "";
      const badge = e("div", "pop");
      badge.appendChild(UI.ring(yes.length, results.length || 1, 140, yes.length + " of " + results.length + " skills confirmed"));
      box.appendChild(badge);
      const head = e("div", "rise");
      head.style.animationDelay = ".3s";
      head.appendChild(e("p", "kicker", yes.length ? "Congratulations, " + firstName + "!" : "Nearly there, " + firstName + "!"));
      head.appendChild(e("h2", null, cp.outcome === "confirmed" && mod
        ? "You've reached Module " + mod.position + (prog && prog.cefr_level ? " of " + prog.cefr_level : "")
        : yes.length ? yes.length + " skill" + (yes.length > 1 ? "s" : "") + " confirmed!" : "Your next step is clear"));
      box.appendChild(head);
      if (yes.length) {
        const wrap = e("div", "rise");
        wrap.style.cssText = "width:100%;animation-delay:.55s";
        wrap.appendChild(e("p", null, "Now you can…")).style.cssText = "margin:0 0 8px;font-weight:900;text-align:left";
        const tiles = e("div", "can-tiles");
        yes.slice(0, 2).forEach((r, i) => {
          const t = e("div", "can-tile", UI.short(can(r.skill_id)));
          t.style.background = i ? "#FFEFB0" : "#CDE7FF";
          tiles.appendChild(t);
        });
        wrap.appendChild(tiles);
        box.appendChild(wrap);
      }
      if (goal) {
        const g = e("div", "next-goal rise");
        g.style.animationDelay = ".8s";
        g.appendChild(e("small", null, "NEXT GOAL"));
        g.appendChild(e("strong", null, goal));
        box.appendChild(g);
      }
      if (cp.summary) {
        const m = e("p", "m-hint rise", "“" + cp.summary + "”");
        m.style.cssText = "margin:0;animation-delay:.9s";
        box.appendChild(m);
      }
      const go = e("button", "m-btn big rise", "Keep going");
      go.type = "button";
      go.style.cssText = "width:100%;animation-delay:1.05s";
      go.addEventListener("click", close);
      box.appendChild(go);
      go.focus();
    });
  }

  function fail(e) {
    console.error(e);
    note("Something went wrong loading your dashboard. Please refresh the page.");
  }

  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      start().catch(fail);
    }
  }, 50);
})();
