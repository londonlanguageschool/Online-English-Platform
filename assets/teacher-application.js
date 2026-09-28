"use strict";
/*
  Mileo — "Apply to teach" form (teachers.html).

  Saves to the Supabase table public.teacher_applications.
  The browser checks are for convenience only; the database enforces the
  real rules (required fields, lengths, email format, consent, time zone,
  starting status, flood limits). See supabase/migrations/001_*.sql.
*/
(function () {
  const form = document.getElementById("teacherApplicationForm");
  if (!form) return;

  const statusEl = document.getElementById("applicationStatus");
  const button = form.querySelector('button[type="submit"]');
  const buttonLabel = button ? button.textContent.trim() : "Submit teacher application";
  const timezoneInput = document.getElementById("timezone");
  const timezoneList = document.getElementById("timezoneList");

  /* Time zone: suggest the visitor's own, and offer the full list. */
  try {
    if (timezoneInput && !timezoneInput.value) {
      timezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    }
    if (timezoneList && typeof Intl.supportedValuesOf === "function") {
      const fragment = document.createDocumentFragment();
      Intl.supportedValuesOf("timeZone").forEach(function (zone) {
        const option = document.createElement("option");
        option.value = zone;
        fragment.appendChild(option);
      });
      timezoneList.appendChild(fragment);
    }
  } catch (ignore) { /* optional enhancement only */ }

  function showStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = "form-status" + (type ? " " + type : "");
  }

  function value(name) {
    const field = form.elements[name];
    return field ? String(field.value || "").trim() : "";
  }

  function optional(name) {
    return value(name) || null;
  }

  function friendlyError(error) {
    const code = error && error.code;
    const message = (error && error.message) || "";

    if (code === "54000") return message; // flood limit (message written for people)
    if (code === "22023" && /time zone/i.test(message)) {
      return "Please choose a time zone from the list, e.g. Europe/Rome.";
    }
    if (code === "23514") {
      if (/email/.test(message)) return "Please check your email address.";
      if (/consent/.test(message)) return "Please tick the privacy box to continue.";
      return "Please check the form — one of the answers is too long or missing.";
    }
    const ref = (code || (error && error.name) || "no-connection").toString().slice(0, 20);
    return "Sorry — we couldn't submit your application just now. Please try again later. (Ref: " + ref + ")";
  }

  function showSuccess(firstName) {
    const box = document.createElement("div");
    box.className = "application-success";
    box.setAttribute("tabindex", "-1");

    const heading = document.createElement("h3");
    heading.textContent = "Thank you" + (firstName ? ", " + firstName : "") + " — application received.";

    const text = document.createElement("p");
    text.textContent =
      "Our team reviews every application personally. If your profile matches " +
      "what we're looking for, we'll email you about the next step: screening, " +
      "then an interview and teaching observation.";

    box.appendChild(heading);
    box.appendChild(text);
    form.replaceWith(box);
    box.focus();
  }

  /*
    Turns the weekly grid into readable text for the admin screen, e.g.
      Hours per week: 10–20 hours
      Mon: Morning, Evening
      Sat: Afternoon
      Times are in: Europe/Rome
      Notes: Not available in August
  */
  const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function buildAvailability() {
    const byDay = {};
    form.querySelectorAll('input[name="availSlot"]:checked').forEach(function (box) {
      const parts = box.value.split("|");
      (byDay[parts[0]] = byDay[parts[0]] || []).push(parts[1]);
    });

    const lines = [];
    if (value("hoursPerWeek")) lines.push("Hours per week: " + value("hoursPerWeek"));
    DAY_ORDER.forEach(function (day) {
      if (byDay[day]) lines.push(day + ": " + byDay[day].join(", "));
    });
    if (value("timezone")) lines.push("Times are in: " + value("timezone"));
    if (value("availabilityNotes")) lines.push("Notes: " + value("availabilityNotes"));

    return lines.length ? lines.join("\n").slice(0, 2000) : null;
  }

  form.addEventListener("change", function (event) {
    if (event.target && event.target.name === "availSlot") {
      const group = document.getElementById("availabilityGroup");
      if (group) group.classList.remove("invalid");
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showStatus("");

    if (!form.reportValidity()) return;

    // Bots fill the hidden field; pretend success and send nothing.
    if (value("website")) {
      showSuccess("");
      return;
    }

    const availabilityGroup = document.getElementById("availabilityGroup");
    if (availabilityGroup && !form.querySelector('input[name="availSlot"]:checked')) {
      availabilityGroup.classList.add("invalid");
      showStatus("Please tick at least one time you're usually available.", "bad");
      availabilityGroup.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!window.mileo) {
      showStatus(friendlyError(null), "bad");
      return;
    }

    const application = {
      first_name: value("firstName"),
      last_name: value("lastName"),
      email: value("email"),
      country: value("country"),
      timezone: optional("timezone"),
      experience: optional("experience"),
      qualifications: optional("qualifications"),
      specialisms: optional("specialisms"),
      availability: buildAvailability(),
      motivation: optional("motivation"),
      privacy_consent: form.elements.privacyConsent.checked
    };

    button.disabled = true;
    button.textContent = "Sending…";

    try {
      // No .select() afterwards: applicants may submit but never read applications.
      const { error } = await window.mileo.from("teacher_applications").insert(application);
      if (error) throw error;
      showSuccess(application.first_name);
    } catch (error) {
      console.error("Mileo application error:", error);
      showStatus(friendlyError(error), "bad");
      button.disabled = false;
      button.textContent = buttonLabel;
    }
  });
})();
