"use strict";
/*
  Mileo — shared Supabase connection.

  Load AFTER the Supabase library:
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="assets/supabase-client.js"></script>   (or ../assets/ from /admin)

  The publishable key below is DESIGNED to be public (like a front-door address).
  What protects the data is the Row Level Security in
  supabase/migrations/. Never put the "secret" / "service_role" key in any
  file in this repository.
*/
(function () {
  const SUPABASE_URL = "https://heaztfynqejioycqvjum.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wP-MBTyxyhBV07Eg6ce2CA_fqYzvWWu";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Mileo: Supabase library failed to load.");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  /*
    Returns the signed-in user's role from the database ("student",
    "teacher" or "admin"), or null if signed out.
    The role comes from the profiles table, which users cannot edit —
    NOT from user_metadata, which users can edit.
    If the profiles table is not set up yet, falls back to "student".
  */
  async function getRole() {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData || !userData.user) return null;

    const { data, error } = await client
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (error || !data) {
      if (error) console.warn("Mileo: could not read profile role:", error.message);
      return "student";
    }
    return data.role;
  }

  /* Where each role should land after signing in (paths from the site root). */
  function homeFor(role) {
    if (role === "admin") return "admin/index.html";
    if (role === "teacher") return "teacher-dashboard.html";
    return "student-dashboard.html";
  }

  window.mileo = client;
  window.MileoAuth = { getRole, homeFor };
})();
