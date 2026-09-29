"use strict";
/*
  Mileo — draws a teacher card (used by the teacher profile preview and
  the students' "You may also like" list). Built with DOM methods only,
  so nothing a teacher types can inject HTML.
*/
window.MileoTeacherCard = (function () {
  const LANGUAGE_NAMES = { en: "English", it: "Italian", es: "Spanish", fr: "French", de: "German", pt: "Portuguese" };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function safeHttps(url) {
    return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
  }

  /* t: { full_name, headline, bio, languages_taught, specialisms, languages_spoken, photo_url, video_url } */
  function render(t, options) {
    const opts = options || {};
    const card = el("article", "t-card" + (t.is_favourite ? " t-fav" : ""));
    const top = el("div", "t-card-top");

    const photo = safeHttps(t.photo_url);
    if (photo) {
      const img = el("img", "t-avatar");
      img.src = photo;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      top.appendChild(img);
    } else {
      top.appendChild(el("div", "t-avatar", ((t.full_name || "M").trim().charAt(0) || "M").toUpperCase()));
    }

    const who = el("div");
    who.appendChild(el("div", "t-name", t.full_name || "Your name"));
    who.appendChild(el("div", "t-headline", t.headline || (opts.preview ? "Your headline appears here" : "")));
    top.appendChild(who);
    card.appendChild(top);

    const body = el("div", "t-body");
    if (t.bio) body.appendChild(el("p", "t-bio", t.bio.length > 420 && !opts.full ? t.bio.slice(0, 420) + "…" : t.bio));

    const tags = el("div", "t-tags");
    (t.languages_taught || []).forEach((c) => tags.appendChild(el("span", "t-tag", "Teaches " + (LANGUAGE_NAMES[c] || c))));
    (t.specialisms || []).forEach((s) => tags.appendChild(el("span", "t-tag", s)));
    if (tags.childNodes.length) body.appendChild(tags);

    if ((t.languages_spoken || []).length) {
      body.appendChild(el("div", "m-hint", "Speaks: " + t.languages_spoken.join(", ")));
    }

    const video = safeHttps(t.video_url);
    if (video) {
      const a = el("a", "", "Watch intro video ↗");
      a.href = video;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.fontWeight = "800";
      body.appendChild(a);
    }
    card.appendChild(body);

    if (opts.actions) card.appendChild(opts.actions);
    return card;
  }

  return { render, LANGUAGE_NAMES };
})();
