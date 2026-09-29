"use strict";
/*
  Mileo — "Forgot password?" on login.html.

  Sends a Supabase password-recovery email. The link in that email opens
  reset-password.html, where the person chooses a new password.

  One-time Supabase setting (Authentication → URL Configuration →
  Redirect URLs) must allow reset-password.html, e.g.
    https://londonlanguageschool.github.io/Online-English-Platform/**
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const panels = ["signInPanel", "signUpPanel", "resetPanel"].map($);
  const tabs = document.querySelector(".tabs");
  const message = $("message");

  function show(text, type) {
    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
  }

  function openReset() {
    panels.forEach((p) => p && p.classList.add("hidden"));
    $("resetPanel").classList.remove("hidden");
    if (tabs) tabs.classList.add("hidden");
    show("");
    // Carry over the email if they already typed it.
    const typed = $("loginEmail").value.trim();
    if (typed) $("resetEmail").value = typed;
    $("resetEmail").focus();
  }

  function closeReset() {
    $("resetPanel").classList.add("hidden");
    if (tabs) tabs.classList.remove("hidden");
    $("signInTab").click();
  }

  $("forgotLink").addEventListener("click", openReset);
  $("backToSignIn").addEventListener("click", closeReset);
  ["signInTab", "signUpTab"].forEach((id) =>
    $(id).addEventListener("click", () => $("resetPanel").classList.add("hidden")));

  $("resetForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = $("resetButton");
    const email = $("resetEmail").value.trim();

    button.disabled = true;
    button.textContent = "Sending…";
    show("");

    try {
      const redirectTo = new URL("reset-password.html", window.location.href).href;
      const { error } = await window.mileo.auth.resetPasswordForEmail(email, { redirectTo });
      // Rate limits and real failures are worth reporting; "no such user"
      // is never revealed by Supabase, which protects people's privacy.
      if (error && /rate|seconds|too many/i.test(error.message || "")) throw error;
      if (error) console.warn("Mileo reset:", error.message);

      show(
        "✓ Email sent to " + email + ". Look for an email from \"Supabase Auth\" (Mileo's secure login " +
        "service) called \"Reset Your Password\" and click the link inside. " +
        "Can't see it after a few minutes? Please check your junk / spam folder. " +
        "(If there's no Mileo account with this email, no email will arrive.)",
        "success"
      );
    } catch (error) {
      console.error(error);
      show(error.message || "We couldn't send the reset email. Please try again in a minute.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Send reset link →";
    }
  });
})();
