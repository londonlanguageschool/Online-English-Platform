"use strict";
/*
  Mileo — admin access check.

  Hides the admin area until Supabase confirms the visitor is signed in AND
  has role "admin" in the profiles table.

  This is the doorman, not the safe: even if someone bypassed this script,
  the database rules (Row Level Security) still refuse to give non-admins
  any application or profile data. See supabase/migrations/.
*/
window.MileoAdminReady = (async function () {
  const body = document.body;
  const gate = document.getElementById("authGate");

  function deny(message, showSignOut) {
    gate.innerHTML = "";
    const box = document.createElement("div");
    box.className = "auth-gate-box";
    const h = document.createElement("h1");
    h.textContent = "Admin access only";
    const p = document.createElement("p");
    p.textContent = message;
    box.append(h, p);

    if (showSignOut) {
      const out = document.createElement("button");
      out.className = "button";
      out.type = "button";
      out.textContent = "Sign out";
      out.addEventListener("click", async function () {
        try { await window.mileo.auth.signOut(); } finally { location.replace("../login.html"); }
      });
      box.appendChild(out);
    }
    gate.appendChild(box);
    return false;
  }

  if (!window.mileo || !window.MileoAuth) {
    return deny("Could not connect to the sign-in service. Please refresh the page.", false);
  }

  try {
    const { data } = await window.mileo.auth.getUser();
    if (!data || !data.user) {
      location.replace("../login.html");
      return false;
    }

    const role = await window.MileoAuth.getRole();
    if (role !== "admin") {
      return deny(
        "You are signed in as " + data.user.email + ", but this account is not an administrator.",
        true
      );
    }

    const who = document.getElementById("adminWho");
    if (who) who.textContent = data.user.email;

    const signOut = document.getElementById("adminSignOut");
    if (signOut) {
      signOut.addEventListener("click", async function () {
        signOut.disabled = true;
        try { await window.mileo.auth.signOut(); } finally { location.replace("../login.html"); }
      });
    }

    gate.remove();
    body.classList.remove("auth-pending");
    return true;
  } catch (error) {
    console.error("Mileo admin check failed:", error);
    return deny("Could not check your access. Please refresh the page.", false);
  }
})();
