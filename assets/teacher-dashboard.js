"use strict";
/*
  Mileo — teacher dashboard (real data).
  Shows the signed-in teacher's current students, each student's goal,
  learning profile, skills progress and latest handover note, plus recent
  lesson records. Every query is limited by the database rules: a teacher
  only ever receives their own current students.
  Needs migrations 003 (+ 005 for lesson records and unpublished programmes).
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const NEXT = {
    continue: "Continue the pathway",
    reinforce: "Reinforce last lesson's outcomes",
    review: "Significant review needed",
    different_priority: "A different priority"
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
  const isoDay = (date) => date.toISOString().slice(0, 10);

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return Array.isArray(data) ? data : (data ? [data] : []);
  }
  async function soft(promise) {
    const { data, error } = await promise;
    return error ? { error, data: [] } : { data: Array.isArray(data) ? data : (data ? [data] : []) };
  }
  const missing = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" ||
    /does not exist|schema cache|Could not find/i.test(e.message || ""));

  async function load() {
    const db = window.mileo;
    const { data: u } = await db.auth.getUser();
    const me = u.user;
    const first = ((me.user_metadata && me.user_metadata.full_name) || me.email.split("@")[0]).split(/\s+/)[0];
    const hour = new Date().getHours();
    $("greeting").textContent = (hour < 12 ? "Good morning, " : hour < 18 ? "Good afternoon, " : "Good evening, ") + first + ".";

    // Own teacher profile → nudge if incomplete.
    const tp = await soft(db.from("teacher_profiles").select("headline,bio,photo_url").eq("teacher_id", me.id).maybeSingle());
    const prof = tp.data[0] || null;
    if (!tp.error && (!prof || !prof.bio || !prof.photo_url)) {
      $("profileNudge").hidden = false;
      $("profileNudgeText").textContent = !prof ? "Students choose teachers they can picture. Add a photo and a short bio."
        : !prof.photo_url ? "Add a friendly photo, so students can put a face to your name."
        : "Add a short bio, so students know what lessons with you feel like.";
    }

    let assignments;
    try {
      assignments = await q(db.from("teacher_assignments").select("enrolment_id").eq("teacher_id", me.id).is("ends_on", null));
    } catch (e) {
      $("students").textContent = "";
      $("setupNote").hidden = false;
      $("setupNote").textContent = missing(e)
        ? "Your dashboard isn't switched on yet. The Mileo team is finishing a one-time setup."
        : "We couldn't load your students. Please refresh the page.";
      return;
    }
    const enrolIds = assignments.map((a) => a.enrolment_id);
    $("statStudents").textContent = String(enrolIds.length);

    if (!enrolIds.length) {
      $("students").textContent = "";
      const empty = el("div", "m-card empty-card");
      empty.appendChild(el("h3", null, "No students yet"));
      empty.appendChild(el("p", null, "When the Mileo team enrols a student with you, they'll appear here with their goals and learning profile."));
      $("students").appendChild(empty);
      $("statWeek").textContent = "0";
      $("statMonth").textContent = "0";
      return;
    }

    const enrolments = await q(db.from("enrolments").select("*").in("id", enrolIds));
    const studentIds = [...new Set(enrolments.map((e) => e.student_id))];
    const progIds = [...new Set(enrolments.map((e) => e.programme_id))];
    const [people, programmes, learners, lessonsRes, progressRes] = await Promise.all([
      q(db.from("profiles").select("id,full_name").in("id", studentIds)),
      soft(db.from("programmes").select("id,title,code,cefr_level").in("id", progIds)),
      soft(db.from("student_profiles").select("*").in("student_id", studentIds)),
      soft(db.from("lesson_records").select("*").in("enrolment_id", enrolIds).order("taught_on", { ascending: false }).order("created_at", { ascending: false })),
      soft(db.from("student_skill_progress").select("enrolment_id,skill_id,teacher_stage,checkpoint_confirmed").in("enrolment_id", enrolIds))
    ]);

    if (lessonsRes.error && missing(lessonsRes.error)) {
      $("setupNote").hidden = false;
      $("setupNote").textContent = "Lesson records aren't switched on yet. The Mileo team needs to finish one setup step (005).";
    }
    const lessons = lessonsRes.data;

    // Stats
    const now = new Date();
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mine = lessons.filter((l) => l.teacher_id === me.id);
    $("statWeek").textContent = String(mine.filter((l) => l.taught_on >= isoDay(monday)).length);
    $("statMonth").textContent = String(mine.filter((l) => l.taught_on >= isoDay(monthStart)).length);

    const nameOf = (id) => ((people.find((p) => p.id === id) || {}).full_name || "Student").trim() || "Student";
    const progOf = (id) => programmes.data.find((p) => p.id === id);

    // Student cards
    const box = $("students");
    box.textContent = "";
    enrolments.forEach((e) => {
      const name = nameOf(e.student_id);
      const prog = progOf(e.programme_id);
      const lp = learners.data.find((x) => x.student_id === e.student_id) || {};
      const last = lessons.find((l) => l.enrolment_id === e.id);
      const skills = progressRes.data.filter((p) => p.enrolment_id === e.id);
      const secure = skills.filter((s) => s.teacher_stage === "secure").length;

      const card = el("article", "m-card student-card");
      const top = el("div", "student-top");
      top.appendChild(el("div", "t-avatar", name.charAt(0).toUpperCase()));
      const who = el("div");
      who.appendChild(el("h3", "student-name", name));
      who.appendChild(el("div", "m-hint", prog ? prog.title + (prog.cefr_level ? " · " + prog.cefr_level : "") : "Programme"));
      top.appendChild(who);
      card.appendChild(top);

      const goal = e.target_note || lp.goals;
      if (goal) card.appendChild(el("p", "student-goal", "Goal: " + goal));

      const meta = el("div", "student-meta");
      meta.appendChild(el("span", "t-tag", last ? "Last lesson: " + fmtDate(last.taught_on) : "No lessons yet"));
      if (skills.length) meta.appendChild(el("span", "t-tag", secure + " of " + skills.length + " skills secure"));
      if (lp.level_self) meta.appendChild(el("span", "t-tag", "Self-assessed: " + lp.level_self));
      card.appendChild(meta);

      if (last && (last.handover_note || last.next_step)) {
        const h = el("div", "handover");
        h.appendChild(el("strong", null, "Last handover note"));
        if (last.handover_note) h.appendChild(el("p", null, last.handover_note));
        h.appendChild(el("p", "m-hint", "Next step: " + (NEXT[last.next_step] || last.next_step)));
        card.appendChild(h);
      }

      const details = el("details", "guide");
      details.appendChild(el("summary", null, "About " + name.split(/\s+/)[0]));
      const body = el("div", "guide-body");
      const rows = [
        ["Goals", lp.goals], ["Finds difficult", lp.difficulties], ["Story so far", lp.history],
        ["Enjoys talking about", lp.interests], ["Preferred lesson times", lp.preferred_times]
      ].filter((r) => r[1]);
      if (!rows.length) body.appendChild(el("p", "m-hint", "This student hasn't filled in their learning profile yet."));
      rows.forEach(([label, value]) => {
        const p = el("p");
        p.appendChild(el("strong", null, label + ": "));
        p.appendChild(document.createTextNode(value));
        body.appendChild(p);
      });
      if (lp.is_minor) body.appendChild(el("p", "minor-flag", "Under 18: please follow Mileo's safeguarding guidance."));
      details.appendChild(body);
      card.appendChild(details);

      const actions = el("div", "student-actions");
      const rec = el("a", "m-btn small", "Record a lesson");
      rec.href = "lesson-record.html?e=" + encodeURIComponent(e.id);
      actions.appendChild(rec);
      card.appendChild(actions);

      box.appendChild(card);
    });

    // Recent lessons (any teacher of these students, newest first)
    const recent = $("recent");
    recent.textContent = "";
    if (!lessons.length) {
      recent.appendChild(el("p", "m-hint", "No lessons recorded yet. After your first lesson, press \"Record a lesson\"."));
    } else {
      const list = el("ul", "recent-ul");
      lessons.slice(0, 8).forEach((l) => {
        const e = enrolments.find((x) => x.id === l.enrolment_id);
        const li = el("li");
        li.appendChild(el("strong", null, fmtDate(l.taught_on) + " · " + (e ? nameOf(e.student_id) : "Student")));
        li.appendChild(el("span", null, (l.summary || "Lesson recorded") + (l.teacher_id !== me.id ? " (previous teacher)" : "")));
        list.appendChild(li);
      });
      recent.appendChild(list);
    }
  }

  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      load().catch((e) => {
        console.error(e);
        $("setupNote").hidden = false;
        $("setupNote").textContent = "Something went wrong loading your dashboard. Please refresh the page.";
      });
    }
  }, 50);
})();
