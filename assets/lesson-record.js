"use strict";
/*
  Mileo — record a lesson (lesson-record.html?e=<enrolment id>).
  Saves the lesson and the skill evidence together through the
  record_lesson() database function (migration 005), so it's all-or-nothing.
  The database also checks that this teacher is the student's current teacher.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const STAGES = [
    ["introduced", "Just introduced"],
    ["practising", "Practising"],
    ["secure", "Secure"]
  ];
  const STAGE_LABEL = Object.fromEntries(STAGES);
  const NEXT = {
    continue: "Continue the pathway", reinforce: "Reinforce last lesson's outcomes",
    review: "Significant review needed", different_priority: "A different priority"
  };
  let enrolmentId = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function status(text, type) {
    $("status").textContent = text;
    $("status").className = "m-status" + (type ? " " + type : "");
  }
  function stop(message) {
    $("setupNote").hidden = false;
    $("setupNote").textContent = message;
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  async function load() {
    const db = window.mileo;
    enrolmentId = new URLSearchParams(location.search).get("e");
    if (!enrolmentId) { stop("Choose a student from your dashboard first."); return; }

    const { data: enrolment, error } = await db.from("enrolments").select("*").eq("id", enrolmentId).maybeSingle();
    if (error || !enrolment) {
      stop("We couldn't find this student. They may have moved to another teacher. Please go back to your dashboard.");
      return;
    }

    const [person, prog, learner, modules, lastRes, progress] = await Promise.all([
      db.from("profiles").select("full_name").eq("id", enrolment.student_id).maybeSingle(),
      db.from("programmes").select("title,cefr_level").eq("id", enrolment.programme_id).maybeSingle(),
      db.from("student_profiles").select("goals").eq("student_id", enrolment.student_id).maybeSingle(),
      db.from("modules").select("id,position,title").eq("programme_id", enrolment.programme_id).order("position"),
      db.from("lesson_records").select("*").eq("enrolment_id", enrolmentId).order("taught_on", { ascending: false }).order("created_at", { ascending: false }).limit(1),
      db.from("student_skill_progress").select("skill_id,teacher_stage").eq("enrolment_id", enrolmentId)
    ]);

    if (lastRes.error) {
      stop("Lesson records aren't switched on yet. The Mileo team needs to finish one setup step (005).");
      return;
    }

    const name = ((person.data && person.data.full_name) || "Student").trim() || "Student";
    $("studentName").textContent = name;
    $("studentInitial").textContent = name.charAt(0).toUpperCase();
    $("studentProgramme").textContent = prog.data ? prog.data.title + (prog.data.cefr_level ? " · " + prog.data.cefr_level : "") : "";
    const goal = enrolment.target_note || (learner.data && learner.data.goals);
    if (goal) { $("studentGoal").hidden = false; $("studentGoal").textContent = "Goal: " + goal; }

    const last = (lastRes.data || [])[0];
    if (last) {
      const box = $("lastLesson");
      box.hidden = false;
      box.appendChild(el("strong", null, "Last lesson · " + fmtDate(last.taught_on)));
      if (last.summary) box.appendChild(el("p", null, last.summary));
      if (last.handover_note) box.appendChild(el("p", null, "Note: " + last.handover_note));
      box.appendChild(el("p", "m-hint", "Suggested next step: " + (NEXT[last.next_step] || last.next_step)));
    }

    // Skills grouped by module, showing each skill's current stage.
    const mods = modules.data || [];
    const modIds = mods.map((m) => m.id);
    let links = [], skills = [];
    if (modIds.length) {
      links = (await db.from("module_skills").select("module_id,skill_id").in("module_id", modIds)).data || [];
      const skillIds = [...new Set(links.map((l) => l.skill_id))];
      if (skillIds.length) skills = (await db.from("skills").select("id,can_do,area").in("id", skillIds)).data || [];
    }
    const stageOf = Object.fromEntries((progress.data || []).map((p) => [p.skill_id, p.teacher_stage]));
    renderSkills(mods, links, skills, stageOf);

    // Dates: today by default, last 60 days allowed.
    const today = new Date();
    const earliest = new Date(); earliest.setDate(today.getDate() - 60);
    $("taughtOn").value = iso(today);
    $("taughtOn").max = iso(today);
    $("taughtOn").min = iso(earliest);

    $("recordArea").hidden = false;
  }

  function renderSkills(mods, links, skills, stageOf) {
    const box = $("skills");
    box.textContent = "";
    if (!skills.length) {
      box.appendChild(el("p", "m-hint", "This programme has no skills yet. You can still save the lesson and notes."));
      return;
    }
    mods.forEach((m) => {
      const ids = links.filter((l) => l.module_id === m.id).map((l) => l.skill_id);
      const list = skills.filter((s) => ids.includes(s.id));
      if (!list.length) return;
      const group = el("fieldset", "skill-group");
      group.appendChild(el("legend", null, m.position + ". " + m.title));
      list.forEach((s) => {
        const row = el("div", "skill-row");
        const tick = el("label", "m-check");
        const cb = el("input");
        cb.type = "checkbox";
        cb.name = "skill";
        cb.value = s.id;
        tick.appendChild(cb);
        const txt = el("span");
        txt.appendChild(el("span", null, s.can_do));
        txt.appendChild(el("small", "m-hint skill-area", s.area + (stageOf[s.id] ? " · now: " + STAGE_LABEL[stageOf[s.id]] : " · not started")));
        tick.appendChild(txt);
        row.appendChild(tick);

        const stages = el("div", "stage-pick");
        stages.setAttribute("role", "radiogroup");
        stages.setAttribute("aria-label", "How confident is the student with: " + s.can_do);
        const current = stageOf[s.id] === "secure" ? "secure" : stageOf[s.id] === "practising" ? "practising" : "introduced";
        STAGES.forEach(([value, label]) => {
          const opt = el("label", "stage-opt");
          const r = el("input");
          r.type = "radio";
          r.name = "stage-" + s.id;
          r.value = value;
          r.checked = value === current;
          r.disabled = true;
          opt.append(r, el("span", null, label));
          stages.appendChild(opt);
        });
        row.appendChild(stages);
        cb.addEventListener("change", () => {
          stages.querySelectorAll("input").forEach((r) => { r.disabled = !cb.checked; });
          row.classList.toggle("on", cb.checked);
        });
        group.appendChild(row);
      });
      box.appendChild(group);
    });
  }

  function friendly(error) {
    const m = (error && error.message) || "";
    if (/own current students/i.test(m)) return "This student isn't assigned to you any more, so the lesson can't be saved.";
    if (/within the last 60 days/i.test(m)) return "The lesson date must be within the last 60 days.";
    if (/not part of this student/i.test(m)) return "One of the skills isn't part of this student's programme. Please refresh and try again.";
    return "Sorry, we couldn't save the lesson. (" + (error.code || "error") + ")";
  }

  $("handover").addEventListener("input", () => { $("handoverCount").textContent = $("handover").value.length; });

  $("lessonForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!$("lessonForm").reportValidity()) return;

    const picked = Array.from(document.querySelectorAll('input[name="skill"]:checked')).map((cb) => ({
      skill_id: cb.value,
      stage: (document.querySelector('input[name="stage-' + cb.value + '"]:checked') || {}).value || "introduced"
    }));
    if (!picked.length && !$("summary").value.trim() && !$("handover").value.trim()) {
      status("Please tick at least one skill or write what you worked on.", "bad");
      return;
    }

    const btn = $("saveBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    status("");
    const { error } = await window.mileo.rpc("record_lesson", {
      p_enrolment: enrolmentId,
      p_taught_on: $("taughtOn").value,
      p_duration: parseInt($("duration").value, 10),
      p_summary: $("summary").value,
      p_handover: $("handover").value,
      p_homework: $("homework").value,
      p_next_step: (document.querySelector('input[name="next"]:checked') || {}).value || "continue",
      p_skills: picked
    });
    btn.disabled = false;
    btn.textContent = "Save lesson record";
    if (error) { console.error(error); status(friendly(error), "bad"); return; }

    $("recordArea").hidden = true;
    $("done").hidden = false;
    $("doneText").textContent = picked.length
      ? "The student's progress has been updated for " + picked.length + (picked.length === 1 ? " skill." : " skills.")
      : "Your notes have been saved to the student's record.";
    $("done").focus();
  });

  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      load().catch((e) => { console.error(e); stop("Something went wrong. Please go back to your dashboard and try again."); });
    }
  }, 50);
})();
