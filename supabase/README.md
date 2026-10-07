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

## Migration 002: verified teachers get teacher accounts

Run `migrations/002_verified_teachers_get_accounts.sql` in the SQL Editor once, after 001.

- When an application moves to **verified**, the Mileo account with the same email (it must be *confirmed*) becomes a **teacher** account.
- If there's no account yet, it becomes a teacher account automatically when the teacher signs up and confirms that email.
- If you move an application from verified to **rejected**, the account goes back to student.
- Admin accounts are never changed, and nobody can make themselves a teacher.

It was tested locally on 28 Sep 2026 with `tests/002_verified_teachers_tests.sql`, and all 11 checks passed.

## Migration 003: courses, enrolments and progress (run live 29 Sep 2026)

`migrations/003_academic_core.sql` sets up:
- **Programmes** (e.g. "General English A1"), made of ordered **modules**. Each module lists the **skills** it teaches, written as can-do statements.
- **Enrolments**, which put a student on a programme, and **teacher assignments**, which give an enrolment one current teacher.
- **Skill evidence**: after lessons, teachers record *introduced → practising → secure* for each skill. Progress is calculated from this evidence, never typed in as a percentage.
- **Checkpoints**: assessed by someone other than the student's own teacher, to confirm the skills independently.
- **Who sees what:**
  - Students see only their own data and their teacher's name.
  - Teachers see only their current students.
  - Admins see everything, including a people list with emails via `admin_list_people()`.

- **Languages:** English first, and other languages can be added later. Every programme belongs to a language.
- **Teacher profiles** (public to signed-in users): headline, bio, languages taught, specialisms, languages spoken, and photo/video links. Only verified teachers can have one.
- **Student learning profiles** (private): goals, difficulties, history, level, interests and preferred times. Only the student, their main teacher and admins can read them. Under-18s must have a guardian email.
- **Private matching preferences:** students can mark a teacher as *favourite* or *prefer not*, and teachers can *decline* a student. Each side only ever sees its own choices.
- **`recommend_teachers()`**, "You may also like":
  - leaves out the student's main teacher and anyone either side has ruled out
  - shows favourites first
  - then puts teachers with fewer students first, so new teachers get a chance
  - lets ties rotate

It was tested locally on 29 Sep 2026 with `tests/003_academic_core_tests.sql`, and all 38 checks passed.

## Migration 004: teacher profile photos (run live 7 Oct 2026)

Run `migrations/004_teacher_photos.sql` in the SQL Editor once, after 003.

- Creates a public **teacher-photos** storage folder. Files can be at most 2 MB, and only JPEG, PNG or WebP.
- Each teacher can only upload, replace or delete files in their own folder. Students and visitors can't upload anything.
- The website checks each photo before uploading: JPG, PNG or WebP, at least 300×300 pixels and at most 10 MB. It then crops the photo to a square, shrinks it to 512 px and re-saves it, which also strips hidden location data.

It was tested locally on 29 Sep 2026 with `tests/00b_local_storage_stub.sql` and `tests/004_teacher_photos_tests.sql`, and all 6 checks passed.

## Migration 005: lesson records and keep-alive

Run `migrations/005_lesson_records_and_keepalive.sql` in the SQL Editor once, after 004.

- **Lesson records** store the date, length, what was covered, a handover note (up to 500 characters), homework and the next step. Skills worked on are saved as skill evidence linked to that lesson, through `record_lesson()`, which saves everything or nothing.
  - Only the **current** teacher (or an admin) can add a record, dated within the last 60 days.
  - The student, their current teacher and admins can read records. A new teacher sees the full history; a previous teacher no longer does.
  - Records can't be edited afterwards; admins can correct them.
- Teachers and students can see the programme they're enrolled in, even when it isn't published yet.
- **`keepalive()`** is a tiny public function. `.github/workflows/supabase-keepalive.yml` calls it every 3 days so the free plan doesn't pause the project.

It was tested locally on 7 Oct 2026 with `tests/005_lesson_records_tests.sql` (run after the 003 tests), and all 16 checks passed.
