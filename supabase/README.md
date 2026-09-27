# Mileo database (Supabase)

## One-time setup — about 2 minutes

1. Open the Supabase dashboard for the Mileo project → **SQL Editor** → **New query**.
2. Paste the whole of `migrations/001_roles_and_teacher_applications.sql` and click **Run**.
   It only adds new tables and rules; it does not change or delete existing accounts.
   Running it twice is harmless.
3. Make yourself an administrator. In a new query, put in your own login email and run:

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
   ```

4. Log in at `login.html`. As an admin you'll be taken to `admin/` → **Applications**.
5. Test it: submit an application at `teachers.html#apply` and check it appears in the admin area.

## What the rules guarantee

| Who | Can do |
|---|---|
| Anyone (not logged in) | Submit a teacher application. Cannot read any. |
| Student / teacher | Read their own profile, change their own name. Cannot change their role. Cannot see applications. |
| Admin | Read and review applications, add notes, move status, delete (for erasure requests), change roles via `admin_set_role()`. |

Other guarantees, enforced by the database rather than the website:

- New sign-ups are always `student`, whatever the browser sends.
- An application always starts as `applied`, and the applicant can't set its status or notes.
- Status path: `applied → screening → interview → verified`. You can't verify without an interview. `rejected` and `withdrawn` are possible from any open stage, and a rejected or withdrawn application can be reopened into screening.
- Every status change is logged in `application_status_history`, with who made it and when.
- Flood limits: 2 applications per email per 24 hours, and 30 in total per 10 minutes.
- Field lengths, email format, experience options, time zone and privacy consent are all validated.

## Testing locally (for developers)

On a throwaway local PostgreSQL 16 (never the real project), run these in order:

1. `tests/00_local_supabase_stub.sql`
2. `migrations/001_roles_and_teacher_applications.sql`
3. `tests/001_security_tests.sql`

These were all run on 27 Sep 2026 and every check passed:

- T1/T2: all users are `student`, even a sign-up claiming `admin`.
- An anonymous visitor can insert; reading, setting a status, a bad email, no consent, a bad time zone and a 3rd application in 24 hours are all refused.
- A student sees 0 applications, and trying to change their own role is refused.
- An admin moving an application straight from `applied` to `verified` is refused; the full path works and is logged.
- An admin can't edit an applicant's email and can't remove their own admin role.
