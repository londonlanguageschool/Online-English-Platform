"use strict";
/*
  Mileo — Teacher applications review (admin).

  Reads and updates public.teacher_applications in Supabase. Only admins can
  do this: the database enforces it, and it also enforces the status path
  applied → screening → interview → verified (no skipping steps).
*/
(function () {
  const STATUS = {
    applied:   { label: "Applied",               cls: "" },
    screening: { label: "Screening",             cls: "yellow" },
    interview: { label: "Interview & observation", cls: "yellow" },
    verified:  { label: "Verified",              cls: "green" },
    rejected:  { label: "Rejected",              cls: "coral" },
    withdrawn: { label: "Withdrawn",             cls: "" }
  };

  // Must match the rules in the database trigger.
  const NEXT = {
    applied:   ["screening", "rejected", "withdrawn"],
    screening: ["interview", "rejected", "withdrawn"],
    interview: ["verified", "rejected", "withdrawn"],
    verified:  ["rejected"],
    rejected:  ["screening"],
    withdrawn: ["screening"]
  };

  const ACTION_LABEL = {
    screening: "Move to screening",
    interview: "Move to interview & observation",
    verified:  "Approve — verified teacher",
    rejected:  "Reject",
    withdrawn: "Mark withdrawn"
  };

  let applications = [];
  let selectedId = null;
  let loaded = false;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  const badge = (status) => {
    const s = STATUS[status] || { label: status, cls: "" };
    return `<span class="badge ${s.cls}">${esc(s.label)}</span>`;
  };
  const date = (iso) => iso
    ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

  function notify(message) {
    const t = $("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  function setupMessage(error) {
    const missing = error && (error.code === "42P01" || error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message || ""));
    return missing
      ? "The applications database isn't set up yet. Run supabase/migrations/001_roles_and_teacher_applications.sql in the Supabase SQL Editor (see supabase/README.md)."
      : "Could not load applications: " + ((error && error.message) || "unknown error");
  }

  async function load() {
    const body = $("applicationsBody");
    body.innerHTML = `<tr><td colspan="6" class="empty">Loading applications…</td></tr>`;

    const { data, error } = await window.mileo
      .from("teacher_applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      applications = [];
      body.innerHTML = `<tr><td colspan="6" class="empty">${esc(setupMessage(error))}</td></tr>`;
      updateCount();
      return;
    }

    applications = data || [];
    loaded = true;
    render();
    if (selectedId) openDetail(selectedId);
  }

  function updateCount() {
    const open = applications.filter((a) => ["applied", "screening", "interview"].includes(a.status)).length;
    const el = $("applicationsCount");
    if (el) {
      el.textContent = open ? String(open) : "";
      el.hidden = !open;
    }
  }

  function render() {
    updateCount();
    const q = ($("applicationSearch").value || "").toLowerCase();
    const status = $("applicationStatusFilter").value;

    const rows = applications.filter((a) =>
      (!status || a.status === status) &&
      (!q || `${a.first_name} ${a.last_name} ${a.email} ${a.country} ${a.specialisms || ""}`.toLowerCase().includes(q)));

    $("applicationsBody").innerHTML = rows.map((a) => `
      <tr>
        <td><strong>${esc(a.first_name)} ${esc(a.last_name)}</strong><br><span class="muted">${esc(a.email)}</span></td>
        <td>${esc(a.country)}<br><span class="muted">${esc(a.timezone || "")}</span></td>
        <td>${esc(a.experience || "—")}</td>
        <td>${esc(date(a.created_at))}</td>
        <td>${badge(a.status)}</td>
        <td><button class="button secondary small" type="button" data-review="${esc(a.id)}">Review</button></td>
      </tr>`).join("") ||
      `<tr><td colspan="6" class="empty">${applications.length ? "No matching applications." : "No applications yet."}</td></tr>`;
  }

  async function loadHistory(id) {
    const { data, error } = await window.mileo
      .from("application_status_history")
      .select("from_status,to_status,changed_at")
      .eq("application_id", id)
      .order("changed_at", { ascending: true });
    if (error) return `<p class="muted">History unavailable.</p>`;
    return `<ol class="history">${(data || []).map((h) =>
      `<li><strong>${esc((STATUS[h.to_status] || {}).label || h.to_status)}</strong> <span class="muted">${esc(date(h.changed_at))}</span></li>`).join("")}</ol>`;
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function openDetail(id) {
    const a = applications.find((x) => x.id === id);
    const panel = $("applicationDetail");
    if (!a) { panel.hidden = true; selectedId = null; return; }
    selectedId = id;

    const field = (label, value) =>
      `<div class="detail-field"><span>${esc(label)}</span><p>${esc(value || "—")}</p></div>`;

    panel.innerHTML = `
      <div class="panel-head">
        <div><p class="eyebrow">Teacher application</p><h3>${esc(a.first_name)} ${esc(a.last_name)}</h3>
        <span class="muted">${esc(a.email)} · received ${esc(date(a.created_at))}</span></div>
        <button class="text-btn" type="button" id="closeDetail">Close ✕</button>
      </div>
      <div class="detail-status">${badge(a.status)}</div>
      <div class="detail-grid">
        ${field("Country", a.country)}
        ${field("Time zone", a.timezone)}
        ${field("Experience", a.experience)}
        ${field("Qualifications", a.qualifications)}
        ${field("Specialisms", a.specialisms)}
        ${field("Availability", a.availability)}
        <div class="detail-field full"><span>Motivation</span><p>${esc(a.motivation || "—")}</p></div>
      </div>

      <form id="reviewForm" class="review-form">
        <label for="screeningNotes">Screening notes</label>
        <textarea id="screeningNotes" maxlength="10000">${esc(a.screening_notes || "")}</textarea>

        <label for="interviewAt">Interview date &amp; time</label>
        <input id="interviewAt" type="datetime-local" value="${esc(toLocalInput(a.interview_at))}">

        <label for="interviewNotes">Interview notes</label>
        <textarea id="interviewNotes" maxlength="10000">${esc(a.interview_notes || "")}</textarea>

        <label for="observationNotes">Teaching observation notes</label>
        <textarea id="observationNotes" maxlength="10000">${esc(a.observation_notes || "")}</textarea>

        <button class="button secondary" type="submit">Save notes</button>
      </form>

      <div class="status-actions">
        <p class="eyebrow">Next step</p>
        ${(NEXT[a.status] || []).map((s) =>
          `<button class="button ${s === "rejected" || s === "withdrawn" ? "secondary" : ""}" type="button" data-move="${s}">${esc(ACTION_LABEL[s])}</button>`).join("")}
      </div>

      <div><p class="eyebrow">History</p><div id="historyList"><p class="muted">Loading…</p></div></div>`;

    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    $("historyList").innerHTML = await loadHistory(id);
  }

  async function saveNotes(event) {
    event.preventDefault();
    const interviewAt = $("interviewAt").value;
    const changes = {
      screening_notes: $("screeningNotes").value.trim() || null,
      interview_at: interviewAt ? new Date(interviewAt).toISOString() : null,
      interview_notes: $("interviewNotes").value.trim() || null,
      observation_notes: $("observationNotes").value.trim() || null
    };
    const { error } = await window.mileo.from("teacher_applications").update(changes).eq("id", selectedId);
    if (error) { console.error(error); notify("Could not save: " + error.message); return; }
    Object.assign(applications.find((a) => a.id === selectedId) || {}, changes);
    notify("Notes saved");
  }

  async function move(status) {
    const a = applications.find((x) => x.id === selectedId);
    if (!a) return;
    if ((status === "verified" || status === "rejected") &&
        !confirm(`${ACTION_LABEL[status]}: ${a.first_name} ${a.last_name}?`)) return;

    const { error } = await window.mileo.from("teacher_applications").update({ status }).eq("id", a.id);
    if (error) { console.error(error); notify("Could not update: " + error.message); return; }
    notify("Status updated to " + STATUS[status].label);
    await load();
  }

  function bind() {
    $("applicationSearch").addEventListener("input", render);
    $("applicationStatusFilter").addEventListener("change", render);
    $("applicationsBody").addEventListener("click", (e) => {
      const b = e.target.closest("[data-review]");
      if (b) openDetail(b.dataset.review);
    });
    $("applicationDetail").addEventListener("click", (e) => {
      if (e.target.id === "closeDetail") { $("applicationDetail").hidden = true; selectedId = null; }
      const m = e.target.closest("[data-move]");
      if (m) move(m.dataset.move);
    });
    $("applicationDetail").addEventListener("submit", (e) => {
      if (e.target.id === "reviewForm") saveNotes(e);
    });
    $("reloadApplications").addEventListener("click", load);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const allowed = await window.MileoAdminReady;
    if (!allowed) return;
    bind();
    load();
  });

  window.MileoApplications = { reload: () => loaded && load() };
})();
