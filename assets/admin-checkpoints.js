"use strict";
/*
  Mileo — admin: book an independent checkpoint (admin/checkpoints.html).
  Pick a student + module (the "ready" chips show modules whose skills are
  mostly Secure), pick an assessor (the student's own teacher can't be
  chosen: the database refuses it too), pick a time, Book.
  Needs migration 007.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, ring, avatar } = window.MileoCP;
  const S = { people: [], enrolments: [], programmes: [], modules: [], links: [], progress: [], assignments: [], checkpoints: [], photos: {}, options: [], choice: null, assessor: null };

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data || [];
  }
  const missing = (e) => e && (e.code === "42703" || e.code === "42P01" || e.code === "PGRST204" || e.code === "PGRST202" ||
    /does not exist|schema cache|Could not find/i.test(e.message || ""));
  const status = (t, cls) => { $("status").textContent = t; $("status").className = "m-status" + (cls ? " " + cls : ""); };
  const nameOf = (id) => ((S.people.find((p) => p.id === id) || {}).full_name || "").trim() || ((S.people.find((p) => p.id === id) || {}).email || "Someone").split("@")[0];
  const first = (id) => nameOf(id).split(/\s+/)[0];
  const fmt = (d) => new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  async function load() {
    const db = window.mileo;
    const [people, enrolments, programmes, modules, assignments, checkpoints] = await Promise.all([
      q(db.rpc("admin_list_people")),
      q(db.from("enrolments").select("id,student_id,programme_id,status").eq("status", "active")),
      q(db.from("programmes").select("id,title,code,cefr_level")),
      q(db.from("modules").select("id,programme_id,position,title").order("position")),
      q(db.from("teacher_assignments").select("enrolment_id,teacher_id").is("ends_on", null)),
      q(db.from("checkpoints").select("id,enrolment_id,module_id,assessor_id,scheduled_at,status,outcome,duration_minutes,meeting_url").order("scheduled_at", { ascending: true }))
    ]);
    Object.assign(S, { people, enrolments, programmes, modules, assignments, checkpoints });
    const modIds = modules.map((m) => m.id);
    const enrolIds = enrolments.map((e) => e.id);
    S.links = modIds.length ? await q(db.from("module_skills").select("module_id,skill_id").in("module_id", modIds)) : [];
    S.progress = enrolIds.length ? await q(db.from("student_skill_progress").select("enrolment_id,skill_id,teacher_stage,checkpoint_confirmed").in("enrolment_id", enrolIds)) : [];
    const staff = people.filter((p) => p.role === "teacher" || p.role === "admin").map((p) => p.id);
    if (staff.length) {
      const tp = await window.mileo.from("teacher_profiles").select("teacher_id,photo_url").in("teacher_id", staff);
      (tp.data || []).forEach((t) => { S.photos[t.teacher_id] = t.photo_url; });
    }
    buildOptions();
    render();
  }

  // Every active enrolment × module, with how many of its skills are Secure.
  function buildOptions() {
    const open = (eid, mid) => S.checkpoints.some((c) => c.enrolment_id === eid && c.module_id === mid && c.status === "scheduled");
    S.options = [];
    S.enrolments.forEach((e) => {
      const prog = S.programmes.find((p) => p.id === e.programme_id) || {};
      S.modules.filter((m) => m.programme_id === e.programme_id).forEach((m) => {
        const skills = S.links.filter((l) => l.module_id === m.id).map((l) => l.skill_id);
        if (!skills.length) return;
        const prog2 = S.progress.filter((p) => p.enrolment_id === e.id && skills.includes(p.skill_id));
        const secure = prog2.filter((p) => p.teacher_stage === "secure" || p.checkpoint_confirmed === true).length;
        const confirmed = prog2.filter((p) => p.checkpoint_confirmed === true).length;
        if (confirmed === skills.length) return; // already confirmed: nothing to check
        const teacher = (S.assignments.find((a) => a.enrolment_id === e.id) || {}).teacher_id || null;
        S.options.push({
          key: e.id + "|" + m.id, enrolment: e.id, module: m.id, student: e.student_id, teacher,
          label: nameOf(e.student_id) + " · " + (prog.code || prog.title || "") + " M" + m.position,
          sub: (prog.title || "") + " · Module " + m.position, secure, total: skills.length, booked: open(e.id, m.id)
        });
      });
    });
    S.options.sort((a, b) => (b.secure / b.total) - (a.secure / a.total));
  }

  function render() {
    // Ready chips
    const ready = S.options.filter((o) => !o.booked && o.secure / o.total >= 0.8).slice(0, 8);
    const rl = $("readyList");
    rl.textContent = "";
    ready.forEach((o) => {
      const b = el("button", "ready-chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(S.choice === o.key));
      b.appendChild(avatar(nameOf(o.student), null, "mini-av", 0));
      b.appendChild(el("span", null, first(o.student) + " · M" + o.label.split(" M").pop()));
      b.appendChild(el("span", "score" + (o.secure < o.total ? " part" : ""), o.secure + "/" + o.total));
      b.addEventListener("click", () => { choose(o.key); });
      rl.appendChild(b);
    });

    // Select with every option
    const pick = $("pick");
    pick.textContent = "";
    const blank = el("option", null, S.options.length ? "Choose…" : "No active students yet");
    blank.value = "";
    pick.appendChild(blank);
    S.options.forEach((o) => {
      const opt = el("option", null, o.label + " · " + o.secure + "/" + o.total + (o.booked ? " (booked)" : ""));
      opt.value = o.key;
      opt.disabled = o.booked;
      pick.appendChild(opt);
    });
    pick.value = S.choice || "";
    renderChoice();
    renderBooked();
  }

  function choose(key) {
    S.choice = key || null;
    const o = S.options.find((x) => x.key === key);
    if (o && S.assessor === o.teacher) S.assessor = null;
    $("pick").value = key || "";
    document.querySelectorAll(".ready-chip").forEach((b) => b.setAttribute("aria-pressed", "false"));
    renderChoice();
    render();
  }

  function renderChoice() {
    const o = S.options.find((x) => x.key === S.choice);
    const box = $("studentRing");
    box.textContent = "";
    if (o) {
      const r = ring(o.secure, o.total, 120, o.secure + " of " + o.total + " skills secure");
      box.appendChild(r);
      $("studentName").textContent = nameOf(o.student);
    } else {
      box.appendChild(avatar("?", null, "big-av", 0));
      $("studentName").textContent = "Choose a student";
    }

    // Assessors: teachers and admins, never the student's own teacher.
    const staff = S.people.filter((p) => p.role === "teacher" || p.role === "admin");
    const wrap = $("assessors");
    wrap.textContent = "";
    if (!staff.length) wrap.appendChild(el("p", "m-hint", "No teachers yet"));
    staff.forEach((p, i) => {
      const own = !!o && o.teacher === p.id;
      const b = el("button", "av-btn");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(S.assessor === p.id));
      b.setAttribute("aria-label", nameOf(p.id) + (own ? ", the student's own teacher, can't assess" : ""));
      b.disabled = own;
      b.appendChild(avatar(nameOf(p.id), S.photos[p.id], "av", i + 1));
      b.appendChild(el("small", null, own ? first(p.id) + " (own)" : first(p.id)));
      b.addEventListener("click", () => { S.assessor = p.id; renderChoice(); });
      wrap.appendChild(b);
    });
    $("assessorName").textContent = S.assessor ? nameOf(S.assessor) : "Pick an assessor";
  }

  function renderBooked() {
    const box = $("booked");
    box.textContent = "";
    const list = S.checkpoints.filter((c) => c.status === "scheduled");
    if (!list.length) { box.appendChild(el("p", "m-hint", "Nothing booked yet.")); return; }
    list.forEach((c) => {
      const e = S.enrolments.find((x) => x.id === c.enrolment_id);
      const m = S.modules.find((x) => x.id === c.module_id);
      const row = el("div", "booked-row");
      row.appendChild(avatar(e ? nameOf(e.student_id) : "?", null, "mini-av", 0));
      const g = el("span", "grow", (e ? first(e.student_id) : "Student") + (m ? " · M" + m.position : "") + " · with " + first(c.assessor_id));
      row.appendChild(g);
      row.appendChild(el("span", "m-hint", c.scheduled_at ? fmt(c.scheduled_at) : "No time yet"));
      const cancel = el("button", "m-btn quiet", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", async () => {
        if (!window.confirm("Cancel this checkpoint?")) return;
        cancel.disabled = true;
        const { error } = await window.mileo.from("checkpoints").update({ status: "cancelled" }).eq("id", c.id);
        if (error) { console.error(error); cancel.disabled = false; status("Couldn't cancel it. (" + (error.code || "error") + ")", "bad"); return; }
        status("Cancelled.", "ok");
        load();
      });
      row.appendChild(cancel);
      box.appendChild(row);
    });
  }

  $("pick").addEventListener("change", (e) => choose(e.target.value));

  $("bookForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const o = S.options.find((x) => x.key === S.choice);
    if (!o) { status("Choose a student first.", "bad"); return; }
    if (!S.assessor) { status("Pick an assessor.", "bad"); return; }
    if (!$("when").reportValidity() || !$("link").reportValidity()) return;
    const when = new Date($("when").value);
    if (isNaN(when) || when < new Date(Date.now() - 3600e3)) { status("Choose a time in the future.", "bad"); return; }
    const btn = $("bookBtn");
    btn.disabled = true;
    status("");
    const { error } = await window.mileo.from("checkpoints").insert({
      enrolment_id: o.enrolment, module_id: o.module, assessor_id: S.assessor,
      scheduled_at: when.toISOString(), duration_minutes: Number($("length").value),
      meeting_url: $("link").value.trim() || null
    });
    btn.disabled = false;
    if (error) {
      console.error(error);
      status(/someone other than/i.test(error.message || "") ? "That's the student's own teacher. Pick someone else."
        : missing(error) ? "Checkpoints need one setup step first (migration 007)."
        : "Couldn't book it. (" + (error.code || "error") + ")", "bad");
      return;
    }
    status("✓ Booked. " + first(S.assessor) + " will see it under Checkpoints to do.", "ok");
    S.choice = null; S.assessor = null;
    $("when").value = ""; $("link").value = "";
    load();
  });

  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      load().catch((e) => {
        console.error(e);
        $("setupNote").hidden = false;
        $("setupNote").textContent = missing(e) ? "Checkpoints need one setup step first (migration 007)." : "Couldn't load. Please refresh the page.";
      });
    }
  }, 50);
})();
