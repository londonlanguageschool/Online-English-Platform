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
  const STYLES = ["relaxed", "structured", "fun", "patient", "practical", "challenging", "friendly", "focused on speaking"];
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

  function refreshThumb() {
    const url = $("photo").value.trim();
    const ok = /^https:\/\//i.test(url);
    $("photoThumb").hidden = !ok;
    $("photoRemove").hidden = !ok;
    if (ok) $("photoThumb").src = url;
  }

  function preview() {
    refreshThumb();
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
    chips($("bhStyle"), "bhStyle", STYLES.map((s) => ({ value: s, label: s })), []);
    preview();
  }

  // ------------------------------------------------------------ photo upload
  const BUCKET = "teacher-photos";

  function photoStatus(text, type) {
    $("photoStatus").textContent = text;
    $("photoStatus").className = "m-status" + (type ? " " + type : "");
  }

  // Our own uploads live at <public url>/teacher-photos/<my id>/<file>.
  function ownStoragePath(url) {
    const marker = "/storage/v1/object/public/" + BUCKET + "/";
    const i = (url || "").indexOf(marker);
    if (i < 0) return null;
    const path = decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
    return path.startsWith(me.id + "/") ? path : null;
  }

  function imageSize(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  // Centre-crop to a square, shrink to 512px and re-encode as JPEG.
  // Re-encoding also drops hidden metadata such as GPS location.
  function toSquareJpeg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const size = Math.min(512, side);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  async function saveProfileQuietly() {
    const v = currentValues();
    if (!v.languages_taught.length) v.languages_taught = ["en"];
    const { error } = await window.mileo.from("teacher_profiles").upsert(v, { onConflict: "teacher_id" });
    if (error) throw error;
  }

  $("photoFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
      photoStatus("iPhone HEIC photos aren't supported. Please use a JPG or PNG. Tip: take a screenshot of the photo, or change your camera setting to \"Most Compatible\".", "bad");
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      photoStatus("That file type isn't supported. Please choose a JPG, PNG or WebP photo.", "bad");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      photoStatus("That photo is " + (file.size / 1048576).toFixed(1) + " MB. The maximum is 10 MB, so please choose a smaller one.", "bad");
      return;
    }
    const dims = await imageSize(file).catch(() => null);
    if (!dims) {
      photoStatus("Sorry, this photo can't be opened. Please try a different JPG or PNG.", "bad");
      return;
    }
    if (dims.w < 300 || dims.h < 300) {
      photoStatus("This photo is " + dims.w + " × " + dims.h + " pixels. It needs to be at least 300 × 300 pixels, so please choose a larger photo.", "bad");
      return;
    }

    photoStatus("Preparing your photo…");
    let blob;
    try {
      blob = await toSquareJpeg(file);
    } catch (e) {
      photoStatus("Sorry, this photo format can't be read here. Please choose a JPG or PNG.", "bad");
      return;
    }

    photoStatus("Uploading…");
    const storage = window.mileo.storage.from(BUCKET);
    const path = me.id + "/photo-" + Date.now() + ".jpg";
    const previous = ownStoragePath($("photo").value);
    const up = await storage.upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
    if (up.error) {
      console.error(up.error);
      photoStatus(/bucket|not found/i.test(up.error.message || "")
        ? "Photo uploads aren't switched on yet (the school needs to run setup 004)."
        : "Sorry, the upload didn't work. Please try again.", "bad");
      return;
    }

    $("photo").value = storage.getPublicUrl(path).data.publicUrl;
    preview();
    try {
      await saveProfileQuietly();
      photoStatus("✓ Photo saved.", "ok");
      if (previous && previous !== path) storage.remove([previous]).catch(() => {});
    } catch (error) {
      console.error(error);
      photoStatus("Photo uploaded. Please press Save profile to keep it.", "bad");
    }
  });

  $("photoRemove").addEventListener("click", async () => {
    const previous = ownStoragePath($("photo").value);
    $("photo").value = "";
    preview();
    try {
      await saveProfileQuietly();
      if (previous) await window.mileo.storage.from(BUCKET).remove([previous]);
      photoStatus("Photo removed.", "ok");
    } catch (error) {
      console.error(error);
      photoStatus("Please press Save profile to finish removing your photo.", "bad");
    }
  });

  // ------------------------------------------------------------ video link check
  const VIDEO_HOSTS = /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com)\//i;
  function checkVideo() {
    const url = $("video").value.trim();
    const el = $("videoStatus");
    if (!url) { el.textContent = ""; el.className = "m-status"; return true; }
    if (!/^https:\/\//i.test(url)) {
      el.textContent = "Video links must start with https://";
      el.className = "m-status bad";
      return false;
    }
    if (!VIDEO_HOSTS.test(url)) {
      el.textContent = "Tip: we recommend YouTube (Unlisted), Vimeo or Loom, so every student can play it easily.";
      el.className = "m-status";
      return true;
    }
    el.textContent = "✓ Looks good.";
    el.className = "m-status ok";
    return true;
  }
  $("video").addEventListener("change", checkVideo);

  // ------------------------------------------------------------ bio helper
  const NICE = {
    "General English": "general English", "Conversation": "conversation", "Business": "Business English",
    "Children": "children", "Teenagers": "teenagers", "Pronunciation": "pronunciation", "Grammar": "grammar",
    "Beginners": "beginners", "Advanced learners": "advanced learners", "Travel": "English for travel",
    "Interview practice": "interview practice", "Writing": "writing"
  };
  const listText = (items) => items.length <= 1 ? (items[0] || "")
    : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  const clean = (t) => t.trim().replace(/[.!\s]+$/, "");

  function draftBio() {
    const first = ((me && me.name) || "").trim().split(/\s+/)[0];
    const langNames = checkedValues("lang").map((c) =>
      (languages.find((l) => l.code === c) || {}).name || c);
    const years = parseInt($("bhYears").value, 10);
    const where = clean($("bhWhere").value);
    const quals = clean($("bhQuals").value);
    const love = clean($("bhLove").value);
    const personal = clean($("bhPersonal").value);
    const styles = checkedValues("bhStyle").slice(0, 3);
    const specs = checkedValues("spec").map((s) => NICE[s] || s);
    const spoken = $("spoken").value.split(",").map((x) => x.trim()).filter(Boolean);

    const p1 = [];
    p1.push("Hi, I'm " + (first || "your teacher") + "!");
    let line = (years > 0 ? "I've been teaching " + listText(langNames) + " for " + years + (years === 1 ? " year" : " years")
                          : "I teach " + listText(langNames));
    if (where) line += ", in " + where;
    p1.push(line + ".");
    if (quals) p1.push("I hold " + quals + ".");

    const p2 = [];
    if (specs.length) p2.push("I especially enjoy helping students with " + listText(specs) + ".");
    if (styles.length) p2.push("My lessons are " + listText(styles) + ", and each one builds towards clear goals you can see.");
    if (love) p2.push("What I love most about teaching is " + love.charAt(0).toLowerCase() + love.slice(1) + ".");

    const p3 = [];
    if (spoken.length > 1) p3.push("I speak " + listText(spoken) + ", so beginners can relax.");
    if (personal) p3.push("Outside lessons, you'll find me enjoying " + personal + ".");
    p3.push("I'd love to help you reach your goals, so let's get started!");

    return [p1, p2, p3].filter((p) => p.length).map((p) => p.join(" ")).join("\n\n");
  }

  // Pressing Enter inside the helper shouldn't save the whole profile.
  $("bioHelper").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); $("bhGo").click(); }
  });

  $("bhGo").addEventListener("click", () => {
    if (checkedValues("bhStyle").length > 3) {
      status("Please pick up to 3 words for how your lessons feel.", "bad");
      return;
    }
    if ($("bio").value.trim() && !window.confirm("Replace your current bio with a new draft?")) return;
    $("bio").value = draftBio().slice(0, 3000);
    preview();
    $("bioHelper").open = false;
    $("bio").focus();
    status("✓ Draft written. Read it through, make it sound like you, then press Save profile.", "ok");
  });

  $("profileForm").addEventListener("input", preview);
  $("profileForm").addEventListener("change", preview);

  $("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const v = currentValues();
    if (!v.languages_taught.length) { status("Please choose at least one language you teach.", "bad"); return; }
    if (v.specialisms.length > 12) { status("Please choose 12 specialisms or fewer.", "bad"); return; }
    if (!checkVideo()) { status("Please check your video link: it must start with https://", "bad"); return; }

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
