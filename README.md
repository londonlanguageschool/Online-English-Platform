# Online-English-Platform (Mileo)

A global online English learning platform with structured courses, verified teachers, independent checkpoints and measurable student progress.

Live site: https://londonlanguageschool.github.io/Online-English-Platform/

## Stack

- **Hosting:** GitHub Pages. The site is plain HTML, CSS and JS with no build step.
- **Accounts and database:** Supabase. The shared connection lives in `assets/supabase-client.js`, and the database rules are in `supabase/` (see `supabase/README.md`).
- **Enquiry form:** Google Apps Script → Google Sheet (`assets/site.js`).

## Pages

| Page | Status |
|---|---|
| `index.html` | Live. Homepage and enquiry form (Apps Script). |
| `teachers.html` | Live. The teacher application saves to Supabase once `supabase/` setup is run. |
| `login.html` | Live. Supabase sign-in and sign-up; sends each role to its own area. |
| `student-dashboard.html` | Login protection is live; the content is **demo data**. |
| `teacher-dashboard.html` | **Prototype**, fictional data, no login yet. |
| `lesson-record.html` | **Prototype**; submitting doesn't save anything. |
| `admin/` | Admin-only login. **Applications** uses live data; the other tabs are **demo data**. |

## Security notes

- The Supabase *publishable* key in `assets/supabase-client.js` is meant to be public. Never commit the *secret* or `service_role` key.
- Roles come from the `profiles` table, not `user_metadata`, because users can edit `user_metadata`.
- Hiding pages is not security. The database rules (RLS) are what protect data.
