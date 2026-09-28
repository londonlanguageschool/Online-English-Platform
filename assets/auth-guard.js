"use strict";
/*
  Mileo — page access check (the "doorman").

  Put on any page that only some roles may open:

    <body class="auth-pending" data-allow-roles="teacher,admin">
    ...
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="assets/supabase-client.js"></script>
    <script src="assets/auth-guard.js"></script>

  - Signed out            → sent to login.html
  - Signed in, wrong role → sent to their own area
  - Allowed               → page is shown; optional elements are filled:
      [data-auth-name]      the person's name
      [data-auth-initial]   their initial
      [data-auth-signout]   becomes a working Sign out button

  Hiding a page is not security on its own: real data must also be
  protected by the database rules (see supabase/migrations/).
*/
(function () {
  const body = document.body;
  const allowed = (body.getAttribute("data-allow-roles") || "")
    .split(",").map((r) => r.trim()).filter(Boolean);

  // Works from the site root and from sub-folders such as /admin/.
  const base = document.querySelector('script[src$="supabase-client.js"]')
    .getAttribute("src").replace(/assets\/supabase-client\.js$/, "");

  function go(path) {
    window.location.replace(base + path);
  }

  async function check() {
    if (!window.mileo || !window.MileoAuth) {
      go("login.html");
      return;
    }

    const { data } = await window.mileo.auth.getUser();
    const user = data && data.user;
    if (!user) {
      go("login.html");
      return;
    }

    const role = await window.MileoAuth.getRole();
    if (!allowed.includes(role)) {
      go(window.MileoAuth.homeFor(role));
      return;
    }

    const name = (user.user_metadata && user.user_metadata.full_name) ||
      (user.email || "").split("@")[0] || "Teacher";

    document.querySelectorAll("[data-auth-name]").forEach((el) => { el.textContent = name; });
    document.querySelectorAll("[data-auth-initial]").forEach((el) => {
      el.textContent = name.trim().charAt(0).toUpperCase() || "M";
    });
    document.querySelectorAll("[data-auth-signout]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try { await window.mileo.auth.signOut(); } finally { go("login.html"); }
      });
    });

    body.classList.remove("auth-pending");
  }

  check().catch((error) => {
    console.error("Mileo access check failed:", error);
    go("login.html");
  });
})();
