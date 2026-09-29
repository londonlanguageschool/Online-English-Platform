"use strict";
/*
  Mileo — Programmes & enrolments (admin, live data).

  Needs migration 003 (supabase/migrations/003_academic_core.sql).
  Until it has been run, the tab shows a "needs setup" note instead.
  Every rule (who can do what, teacher must have the teacher role, one
  current teacher per enrolment…) is enforced by the database too.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  const AREAS = ["speaking", "listening", "reading", "writing", "grammar", "vocabulary", "pronunciation"];

  const state = {
    programmes: [], modules: [], skills: [], moduleSkills: [],
    people: [], enrolments: [], assignments: [], openProgramme: null
  };

  function notify(message) {
    const t = $("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2400);
  }

  function friendly(error) {
    const code = error && error.code;
    const msg = (error && error.message) || "unknown error";
    if (code === "23505") return "That code is already used. Please choose another.";
    if (code === "23514") return msg.includes("teacher role") ? msg : "Please check the form: something is missing or too long. (" + msg + ")";
    if (code === "42501") return "Only admins can do that.";
    return msg;
  }

  function isMissingSetup(error) {
    return error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" ||
      /does not exist|schema cache|Could not find/i.test(error.message || ""));
  }

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data || [];
  }

  // ---------------------------------------------------------------- load
  async function load() {
    const db = window.mileo;
    try {
      const [programmes, modules, skills, moduleSkills, people, enrolments, assignments] = await Promise.all([
        q(db.from("programmes").select("*").order("code")),
        q(db.from("modules").select("*").order("position")),
        q(db.from("skills").select("*").order("code")),
        q(db.from("module_skills").select("*")),
        q(db.rpc("admin_list_people")),
        q(db.from("enrolments").select("*").order("created_at", { ascending: false })),
        q(db.from("teacher_assignments").select("*").is("ends_on", null))
      ]);
      Object.assign(state, { programmes, modules, skills, moduleSkills, people, enrolments, assignments });
      $("progSetup").hidden = true;
      $("progBody").hidden = false;
      render();
    } catch (error) {
      console.error(error);
      $("progBody").hidden = isMissingSetup(error);
      $("progSetup").hidden = false;
      $("progSetup").textContent = isMissingSetup(error)
        ? "Needs setup: run supabase/migrations/003_academic_core.sql in the Supabase SQL Editor, then click Reload."
        : "Could not load programmes: " + friendly(error);
    }
  }

  // -------------------------------------------------------------- lookups
  const person = (id) => state.people.find((p) => p.id === id);
  const personLabel = (id) => {
    const p = person(id);
    if (!p) return "Unknown";
    return (p.full_name ? p.full_name + " · " : "") + p.email;
  };
  const programme = (id) => state.programmes.find((p) => p.id === id);
  const modulesOf = (pid) => state.modules.filter((m) => m.programme_id === pid);
  const skillsOf = (mid) => state.moduleSkills
    .filter((ms) => ms.module_id === mid)
    .map((ms) => state.skills.find((s) => s.id === ms.skill_id))
    .filter(Boolean);
  const currentTeacher = (eid) => {
    const a = state.assignments.find((x) => x.enrolment_id === eid);
    return a ? a.teacher_id : null;
  };

  function options(list, placeholder, selected) {
    return `<option value="">${esc(placeholder)}</option>` + list.map((o) =>
      `<option value="${esc(o.value)}"${o.value === selected ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  }

  // --------------------------------------------------------------- render
  function render() {
    const students = state.people.filter((p) => p.role === "student");
    const teachers = state.people.filter((p) => p.role === "teacher");

    $("programmesBody").innerHTML = state.programmes.map((p) => {
      const mods = modulesOf(p.id);
      const skillCount = mods.reduce((n, m) => n + skillsOf(m.id).length, 0);
      return `<tr>
        <td><strong>${esc(p.title)}</strong><br><span class="muted">${esc(p.code)}</span></td>
        <td>${esc(p.cefr_level || "—")}</td>
        <td>${mods.length} · ${skillCount}</td>
        <td>${p.published ? '<span class="badge green">Published</span>' : '<span class="badge yellow">Draft</span>'}</td>
        <td><button class="button secondary small" type="button" data-open="${esc(p.id)}">Open</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" class="empty">No programmes yet. Create your first one below.</td></tr>`;

    $("enrolStudent").innerHTML = options(students.map((s) => ({ value: s.id, label: personLabel(s.id) })),
      students.length ? "Choose a student…" : "No student accounts yet");
    $("enrolProgramme").innerHTML = options(state.programmes.map((p) => ({ value: p.id, label: p.title + " (" + p.code + ")" })),
      state.programmes.length ? "Choose a programme…" : "Create a programme first");
    $("enrolTeacher").innerHTML = options(teachers.map((t) => ({ value: t.id, label: personLabel(t.id) })),
      teachers.length ? "No teacher yet" : "No verified teachers yet");

    $("enrolmentsBody").innerHTML = state.enrolments.map((e) => {
      const p = programme(e.programme_id);
      const teacherId = currentTeacher(e.id);
      return `<tr>
        <td>${esc(personLabel(e.student_id))}${e.target_note ? `<br><span class="muted">Goal: ${esc(e.target_note)}</span>` : ""}</td>
        <td>${esc(p ? p.title : "—")}</td>
        <td>${esc(e.started_on)}</td>
        <td>${esc(e.status)}</td>
        <td><div class="assign">
          <select aria-label="Teacher for this enrolment" data-teacher-for="${esc(e.id)}">${options(
            teachers.map((t) => ({ value: t.id, label: person(t.id).full_name || person(t.id).email })), "— none —", teacherId)}</select>
          <button class="button secondary small" type="button" data-assign="${esc(e.id)}">Save</button>
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" class="empty">No enrolments yet.</td></tr>`;

    if (state.openProgramme) renderDetail(state.openProgramme);
  }

  function renderDetail(pid) {
    const p = programme(pid);
    const panel = $("programmeDetail");
    if (!p) { panel.hidden = true; state.openProgramme = null; return; }
    state.openProgramme = pid;
    const mods = modulesOf(pid);
    panel.innerHTML = `
      <div class="panel-head">
        <div><p class="eyebrow">Programme · ${esc(p.code)}</p><h3>${esc(p.title)}</h3>
        <span class="muted">${esc(p.description || "")}</span></div>
        <div style="display:flex;gap:8px">
          <button class="button secondary small" type="button" data-publish="${esc(p.id)}">${p.published ? "Unpublish" : "Publish"}</button>
          <button class="text-btn" type="button" data-close-prog>Close ✕</button>
        </div>
      </div>
      <p class="muted" style="margin:0">Students only see a programme once it is published. Build the modules and skills first.</p>
      ${mods.map((m) => `
        <div class="module">
          <h4>${m.position}. ${esc(m.title)}</h4>
          <ol class="skill-list">${skillsOf(m.id).map((s) =>
            `<li>${esc(s.can_do)} <code>${esc(s.code)} · ${esc(s.area)}</code></li>`).join("") || '<li class="muted">No skills yet.</li>'}</ol>
          <form class="inline-form" data-add-skill="${esc(m.id)}">
            <input class="grow" name="can_do" required minlength="5" maxlength="300" placeholder="Can do… e.g. Can ask about daily routines" aria-label="Can-do statement">
            <select name="area" aria-label="Skill area">${AREAS.map((a) => `<option>${a}</option>`).join("")}</select>
            <button class="button secondary small" type="submit">Add skill</button>
          </form>
        </div>`).join("") || '<p class="muted">No modules yet.</p>'}
      <form class="inline-form" id="addModuleForm">
        <input class="grow" name="title" required minlength="2" maxlength="120" placeholder="New module title, e.g. Daily life" aria-label="Module title">
        <button class="button small" type="submit">Add module</button>
      </form>`;
    panel.hidden = false;
  }

  // -------------------------------------------------------------- actions
  function nextSkillCode(p, area) {
    const prefix = (p.code + "." + area.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    let n = 1;
    const used = new Set(state.skills.map((s) => s.code));
    while (used.has(prefix + "." + String(n).padStart(2, "0"))) n++;
    return prefix + "." + String(n).padStart(2, "0");
  }

  async function run(action, success) {
    try {
      await action();
      notify(success);
      await load();
    } catch (error) {
      console.error(error);
      notify("Could not save: " + friendly(error));
    }
  }

  function bind() {
    const db = () => window.mileo;

    $("reloadProgrammes").addEventListener("click", load);

    $("newProgrammeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const row = {
        // "Test a1" → "TEST-A1": spaces become hyphens, anything else is dropped.
        code: f.code.value.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 24),
        title: f.title.value.trim(),
        cefr_level: f.cefr_level.value || null,
        description: f.description.value.trim() || null
      };
      run(async () => {
        const { error } = await db().from("programmes").insert(row);
        if (error) throw error;
        f.reset();
      }, "Programme created. Open it to add modules and skills.");
    });

    $("enrolForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const teacher = f.teacher_id.value;
      run(async () => {
        const { data, error } = await db().from("enrolments").insert({
          student_id: f.student_id.value,
          programme_id: f.programme_id.value,
          target_note: f.target_note.value.trim() || null
        }).select("id").single();
        if (error) throw error;
        if (teacher) {
          const res = await db().from("teacher_assignments").insert({ enrolment_id: data.id, teacher_id: teacher });
          if (res.error) throw res.error;
        }
        f.reset();
      }, "Student enrolled.");
    });

    document.addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      if (open) { renderDetail(open.dataset.open); $("programmeDetail").scrollIntoView({ behavior: "smooth" }); }

      if (e.target.closest("[data-close-prog]")) { $("programmeDetail").hidden = true; state.openProgramme = null; }

      const pub = e.target.closest("[data-publish]");
      if (pub) {
        const p = programme(pub.dataset.publish);
        run(async () => {
          const { error } = await db().from("programmes").update({ published: !p.published }).eq("id", p.id);
          if (error) throw error;
        }, p.published ? "Programme unpublished." : "Programme published.");
      }

      const assign = e.target.closest("[data-assign]");
      if (assign) {
        const eid = assign.dataset.assign;
        const chosen = document.querySelector(`[data-teacher-for="${eid}"]`).value || null;
        const current = state.assignments.find((a) => a.enrolment_id === eid);
        if ((current ? current.teacher_id : null) === chosen) { notify("No change."); return; }
        run(async () => {
          if (current) {
            const today = new Date().toISOString().slice(0, 10);
            const { error } = await db().from("teacher_assignments").update({ ends_on: today }).eq("id", current.id);
            if (error) throw error;
          }
          if (chosen) {
            const { error } = await db().from("teacher_assignments").insert({ enrolment_id: eid, teacher_id: chosen });
            if (error) throw error;
          }
        }, chosen ? "Teacher assigned." : "Teacher removed.");
      }
    });

    document.addEventListener("submit", (e) => {
      if (e.target.id === "addModuleForm") {
        e.preventDefault();
        const pid = state.openProgramme;
        const position = modulesOf(pid).reduce((n, m) => Math.max(n, m.position), 0) + 1;
        const title = e.target.title.value.trim();
        run(async () => {
          const { error } = await db().from("modules").insert({ programme_id: pid, position, title });
          if (error) throw error;
        }, "Module added.");
      }

      if (e.target.matches("[data-add-skill]")) {
        e.preventDefault();
        const f = e.target;
        const mid = f.dataset.addSkill;
        const p = programme(state.openProgramme);
        const area = f.area.value;
        run(async () => {
          const { data, error } = await db().from("skills").insert({
            code: nextSkillCode(p, area), can_do: f.can_do.value.trim(), area, cefr_level: p.cefr_level
          }).select("id").single();
          if (error) throw error;
          const res = await db().from("module_skills").insert({ module_id: mid, skill_id: data.id });
          if (res.error) throw res.error;
        }, "Skill added.");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const allowed = await window.MileoAdminReady;
    if (!allowed) return;
    bind();
    load();
  });
})();
