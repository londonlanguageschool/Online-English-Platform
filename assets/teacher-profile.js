"use strict";
/*
  Mileo — teacher edits their own public profile (teacher-profile.html).
  Needs migration 003. The database checks lengths, https-only links,
  known languages, and that only verified teachers can have a profile.
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const SPECIALISMS = [
    "General English", "Conversation", "Business", "IELTS", "Cambridge exams",
    "Trinity exams", "Children", "Teenagers", "Pronunciation", "Grammar",
    "Beginners", "Advanced learners", "Travel", "Interview practice", "Writing"
  ];
  let me = null;
  let languages = [{ code: "en", name: "English" }];

  function status(text, type) {
    $("status").textContent = text;
    $("status").className = "m-status" + (type ? " " + type : "");
  }

  function chips(container, name, items, checked) {
    container.innerHTML = "";
    items.forEach((item) => {
      const label = document.createElement("label");
      label.className = "m-chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = name;
      input.value = item.value;
      input.checked = checked.includes(item.value);
      const span = document.createElement("span");
      span.textContent = item.label;
      label.append(input, span);
      container.appendChild(label);
    });
  }

  const checkedValues = (name) =>
    Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((i) => i.value);

  function currentValues() {
    return {
      teacher_id: me && me.id,
      headline: $("headline").value.trim() || null,
      bio: $("bio").value.trim() || null,
      languages_taught: checkedValues("lang"),
      specialisms: checkedValues("spec"),
      languages_spoken: $("spoken").value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10),
      photo_url: $("photo").value.trim() || null,
      video_url: $("video").value.trim() || null,
      visible: $("visible").checked
    };
  }

  function preview() {
    const v = currentValues();
    v.full_name = (me && me.name) || "";
    const box = $("preview");
    box.replaceWith(Object.assign(window.MileoTeacherCard.render(v, { preview: true }), { id: "preview" }));
    $("bioCount").textContent = $("bio").value.length;
  }

  function friendly(error) {
    const msg = (error && error.message) || "";
    if (/https/i.test(msg) || /photo_url|video_url/.test(msg)) return "Links must start with https://";
    if (/languages_taught/.test(msg)) return "Please choose at least one language you teach.";
    if (/specialisms/.test(msg)) return "Please choose 12 specialisms or fewer.";
    if (/verified teachers/i.test(msg)) return "Only verified teachers can publish a profile.";
    return "Sorry, we couldn't save your profile. (" + (error.code || "error") + ")";
  }

  async function load() {
    const db = window.mileo;
    const { data: userData } = await db.auth.getUser();
    const user = userData.user;
    me = { id: user.id, name: (user.user_metadata && user.user_metadata.full_name) || user.email.split("@")[0] };

    const langRes = await db.from("languages").select("code,name").eq("active", true).order("name");
    if (langRes.error) {
      $("setupNote").hidden = false;
      $("setupNote").textContent = "Profiles aren't switched on yet. The school needs to finish a one-time setup (migration 003). You can look around, but saving won't work until then.";
    } else if (langRes.data && langRes.data.length) {
      languages = langRes.data;
    }

    const { data } = await db.from("teacher_profiles").select("*").eq("teacher_id", me.id).maybeSingle();
    const p = data || {};
    $("headline").value = p.headline || "";
    $("bio").value = p.bio || "";
    $("spoken").value = (p.languages_spoken || []).join(", ");
    $("photo").value = p.photo_url || "";
    $("video").value = p.video_url || "";
    $("visible").checked = p.visible !== false;
    chips($("languagesTaught"), "lang", languages.map((l) => ({ value: l.code, label: l.name })), p.languages_taught || ["en"]);
    chips($("specialisms"), "spec", SPECIALISMS.map((s) => ({ value: s, label: s })), p.specialisms || []);
    preview();
  }

  $("profileForm").addEventListener("input", preview);
  $("profileForm").addEventListener("change", preview);

  $("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const v = currentValues();
    if (!v.languages_taught.length) { status("Please choose at least one language you teach.", "bad"); return; }
    if (v.specialisms.length > 12) { status("Please choose 12 specialisms or fewer.", "bad"); return; }

    const btn = $("saveBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    status("");
    try {
      const { error } = await window.mileo.from("teacher_profiles").upsert(v, { onConflict: "teacher_id" });
      if (error) throw error;
      status("✓ Saved. Students will see your updated profile.", "ok");
    } catch (error) {
      console.error(error);
      status(friendly(error), "bad");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save profile";
    }
  });

  // Wait until the access check has shown the page.
  const wait = setInterval(() => {
    if (!document.body.classList.contains("auth-pending")) {
      clearInterval(wait);
      load().catch((e) => { console.error(e); status("Couldn't load your profile. Please refresh.", "bad"); });
    }
  }, 50);
})();
