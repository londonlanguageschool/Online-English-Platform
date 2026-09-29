"use strict";
/*
  Mileo — "Show / Hide" button for every password box on the page.
  Include once, after the form:  <script src="assets/password-toggle.js"></script>
*/
(function () {
  const style = document.createElement("style");
  style.textContent =
    ".pw-wrap{position:relative;display:block}" +
    ".pw-wrap input{padding-right:78px !important;width:100%;box-sizing:border-box}" +
    ".pw-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);" +
    "min-height:36px;min-width:60px;padding:0 10px;border:0;border-radius:10px;" +
    "background:#eef0f8;color:#1b1d4b;font:inherit;font-size:.85rem;font-weight:800;cursor:pointer}" +
    ".pw-toggle:focus-visible{outline:3px solid #4b46e5;outline-offset:2px}";
  document.head.appendChild(style);

  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = "1";

    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.textContent = "Show";
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Show password");
    wrap.appendChild(btn);

    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
    });

    // Always hide again when the form is sent, so browsers save it as a password.
    if (input.form) {
      input.form.addEventListener("submit", () => {
        input.type = "password";
        btn.textContent = "Show";
        btn.setAttribute("aria-pressed", "false");
      });
    }
  });
})();
