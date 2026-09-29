"use strict";
/*
  Mileo — student learning profile + "You may also like" teacher suggestions
  (student-profile.html). Needs migration 003.
  Favourite / "Not for me" are private: teachers never see them.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  let me = null;
  let languages = [{ code: "en", name: "English" }];
  let favourites = new Set();

  function status(text, type) {
    $("status").textContent = text;
    $("status").className = "m-status" + (type ? " " + type : "");
  }

  function setupMissing() {
    $("setupNote").hidden = false;
    $("setupNote").textContent = "Learning profiles aren't switched on yet. We're finishing a one-time setup, so please check back soon.";
  }

  function renderLanguageChips(selected) {
    const box = $("learningLanguages");
    box.innerHTML = "";
    languages.forEach((l) => {
      const label = document.createElement("label");
      label.className = "m-chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "learnLang";
      input.value = l.code;
      input.checked = selected.includes(l.code);
      const span = document.createElement("span");
      span.textContent = l.name;
      label.append(input, span);
      box.appendChild(label);
    });
  }

  function toggleGuardian() {
    $("guardianField").hidden = !$("minor").checked;
    $("guardian").required = $("minor").checked;
  }

  async function loadProfile() {
    const db = window.mileo;
    const langRes = await db.from("languages").select("code,name").eq("active", true).order("name");
    if (langRes.error) { setupMissing(); renderLanguageChips(["en"]); return false; }
    if (langRes.data && langRes.data.length) languages = langRes.data;

    const { data } = await db.from("student_profiles").select("*").eq("student_id", me.id).maybeSingle();
    const p = data || {};
    renderLanguageChips(p.learning_languages || ["en"]);
    $("level").value = p.level_self || "";
    $("goals").value = p.goals || "";
    $("difficulties").value = p.difficulties || "";
    $("history").value = p.history || "";
    $("interests").value = p.interests || "";
    $("times").value = p.preferred_times || "";
    $("minor").checked = !!p.is_minor;
    $("guardian").value = p.guardian_email || "";
    toggleGuardian();
    return true;
  }

  // ------------------------------------------------------------ suggestions
  async function setPreference(teacherId, kind) {
    const db = window.mileo;
    if (kind === null) {
      return db.from("match_preferences").delete()
        .eq("student_id", me.id).eq("teacher_id", teacherId).eq("set_by", "student");
    }
    return db.from("match_preferences").upsert(
      { student_id: me.id, teacher_id: teacherId, set_by: "student", kind },
      { onConflict: "student_id,teacher_id,set_by" }
    );
  }

  function actionsFor(t) {
    const wrap = document.createElement("div");
    wrap.className = "t-actions";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "m-btn quiet";
    const isFav = favourites.has(t.teacher_id);
    fav.textContent = isFav ? "♥ Favourite" : "♡ Save as favourite";
    fav.setAttribute("aria-pressed", String(isFav));
    fav.addEventListener("click", async () => {
      fav.disabled = true;
      const { error } = await setPreference(t.teacher_id, isFav ? null : "favourite");
      if (error) { console.error(error); fav.disabled = false; return; }
      loadSuggestions();
    });

    const no = document.createElement("button");
    no.type = "button";
    no.className = "m-btn quiet";
    no.textContent = "Not for me";
    no.addEventListener("click", async () => {
      no.disabled = true;
      const { error } = await setPreference(t.teacher_id, "prefer_not");
      if (error) { console.error(error); no.disabled = false; return; }
      loadSuggestions();
    });

    wrap.append(fav, no);
    return wrap;
  }

  async function loadSuggestions() {
    const box = $("suggestions");
    const lang = (Array.from(document.querySelectorAll('input[name="learnLang"]:checked'))[0] || {}).value || "en";
    const { data, error } = await window.mileo.rpc("recommend_teachers", { p_language: lang, p_limit: 6 });
    box.innerHTML = "";
    if (error) {
      const p = document.createElement("p");
      p.className = "m-hint";
      p.textContent = "Teacher suggestions will appear here soon.";
      box.appendChild(p);
      return;
    }
    favourites = new Set((data || []).filter((t) => t.is_favourite).map((t) => t.teacher_id));
    if (!data || !data.length) {
      const p = document.createElement("p");
      p.className = "m-hint";
      p.textContent = "No new suggestions right now. We're welcoming new teachers all the time.";
      box.appendChild(p);
      return;
    }
    data.forEach((t) => box.appendChild(window.MileoTeacherCard.render(t, { actions: actionsFor(t) })));
  }

  // ------------------------------------------------------------------ save
  $("minor").addEventListener("change", toggleGuardian);
  $("learnerForm").addEventListener("change", (e) => { if (e.target.name === "learnLang") loadSuggestions(); });

  $("learnerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const learning = Array.from(document.querySelectorAll('input[name="learnLang"]:checked')).map((i) => i.value);
    if (!learning.length) { status("Please choose the language you're learning.", "bad"); return; }
    if ($("minor").checked && !$("guardian").reportValidity()) return;

    const row = {
      student_id: me.id,
      learning_languages: learning,
      level_self: $("level").value || null,
      goals: $("goals").value.trim() || null,
      difficulties: $("difficulties").value.trim() || null,
      history: $("history").value.trim() || null,
      interests: $("interests").value.trim() || null,
      preferred_times: $("times").value.trim() || null,
      is_minor: $("minor").checked,
      guardian_email: $("minor").checked ? ($("guardian").value.trim() || null) : null
    };

    const btn = $("saveBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    status("");
    try {
      const { error } = await window.mileo.from("student_profiles").upsert(row, { onConflict: "student_id" });
      if (error) throw error;
      status("✓ Saved. Your teacher will see this before your lessons.", "ok");
    } catch (error) {
      console.error(error);
      status(/guardian|student_profiles_check/i.test(error.message || "")
        ? "Please add a parent or guardian's email."
        : "Sorry, we couldn't save your profile. (" + (error.code || "error") + ")", "bad");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save my profile";
    }
  });

  async function start() {
    const { data } = await window.mileo.auth.getUser();
    me = { id: data.user.id };
    await loadProfile();
    loadSuggestions();
  }

  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      start().catch((e) => { console.error(e); status("Couldn't load your profile. Please refresh.", "bad"); });
    }
  }, 50);
})();
