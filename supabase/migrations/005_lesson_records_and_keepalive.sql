-- =====================================================================
-- MILEO — Migration 005: lesson records (+ keep-alive)
--
-- HOW TO RUN (once, after 004):
--   Supabase → SQL Editor → + → Create a new snippet → paste → Run.
--   All-or-nothing. Running it twice stops at "already exists" and
--   changes nothing.
--
-- WHAT IT DOES
--   1. LESSON RECORDS — after each lesson the teacher saves: date, length,
--      what was covered, a short handover note for the next teacher,
--      homework, and the recommended next step. Skills worked on are saved
--      as skill evidence linked to that lesson (introduced / practising /
--      secure), which is where student progress comes from.
--        • Only the student's CURRENT teacher (or an admin) can add one.
--        • The student, their current teacher and admins can read them.
--          A new teacher sees the full history, so nobody starts from zero.
--        • Records can't be edited afterwards (an honest history);
--          admins can correct mistakes.
--   2. Teachers can see the programme (and its modules) their students are
--      enrolled in, even before it is published.
--   3. KEEP-ALIVE — a tiny public "ping" so an automatic weekly check can
--      stop the free Supabase plan pausing the project when it's quiet.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. LESSON RECORDS
-- ---------------------------------------------------------------------
create type public.lesson_next_step as enum ('continue', 'reinforce', 'review', 'different_priority');

create table public.lesson_records (
  id                uuid primary key default gen_random_uuid(),
  enrolment_id      uuid not null references public.enrolments (id) on delete cascade,
  teacher_id        uuid not null references public.profiles (id),
  taught_on         date not null default current_date,
  duration_minutes  int  not null default 50 check (duration_minutes between 15 and 180),
  summary           text check (char_length(summary) <= 1000),
  handover_note     text check (char_length(handover_note) <= 500),
  homework          text check (char_length(homework) <= 1000),
  next_step         public.lesson_next_step not null default 'continue',
  created_at        timestamptz not null default now()
);
create index lesson_records_enrolment_idx on public.lesson_records (enrolment_id, taught_on desc);
create index lesson_records_teacher_idx on public.lesson_records (teacher_id, taught_on desc);

create function public.check_lesson_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    new.teacher_id := auth.uid();
    if not public.is_current_teacher_of(new.enrolment_id) then
      raise exception 'You can only record lessons for your own current students' using errcode = '42501';
    end if;
  elsif new.teacher_id is null then
    new.teacher_id := auth.uid();
  end if;
  if new.taught_on > current_date + 1 or new.taught_on < current_date - 60 then
    raise exception 'The lesson date must be within the last 60 days' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger check_lesson_record before insert on public.lesson_records
  for each row execute function public.check_lesson_record();

alter table public.lesson_records enable row level security;
revoke all on public.lesson_records from anon, authenticated;
grant select, insert, update, delete on public.lesson_records to authenticated;

create policy "lesson records: read" on public.lesson_records for select to authenticated
  using (public.can_view_enrolment(enrolment_id));
create policy "lesson records: current teacher adds" on public.lesson_records for insert to authenticated
  with check (public.is_admin() or public.is_current_teacher_of(enrolment_id));
create policy "lesson records: admin corrects" on public.lesson_records for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "lesson records: admin deletes" on public.lesson_records for delete to authenticated
  using (public.is_admin());

-- Skill evidence can point at the lesson it came from.
alter table public.skill_evidence
  add column lesson_record_id uuid references public.lesson_records (id) on delete set null;

-- Extend the evidence check: a linked lesson must belong to the same enrolment.
create or replace function public.check_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  new.recorded_at := now();
  if not exists (
    select 1 from public.enrolments e
    join public.modules m on m.programme_id = e.programme_id
    join public.module_skills ms on ms.module_id = m.id
    where e.id = new.enrolment_id and ms.skill_id = new.skill_id) then
    raise exception 'That skill is not part of this student''s programme' using errcode = '23514';
  end if;
  if new.lesson_record_id is not null and not exists (
    select 1 from public.lesson_records lr
    where lr.id = new.lesson_record_id and lr.enrolment_id = new.enrolment_id) then
    raise exception 'That lesson belongs to a different student' using errcode = '23514';
  end if;
  return new;
end $$;

-- Save a lesson and its skill evidence in one go (all-or-nothing).
-- Runs with the caller's own permissions, so every rule above still applies.
create function public.record_lesson(
  p_enrolment uuid,
  p_taught_on date,
  p_duration int,
  p_summary text,
  p_handover text,
  p_homework text,
  p_next_step public.lesson_next_step,
  p_skills jsonb   -- [{"skill_id": "...", "stage": "introduced|practising|secure"}, ...]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  rid uuid;
  item jsonb;
begin
  if jsonb_typeof(coalesce(p_skills, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_skills, '[]'::jsonb)) > 40 then
    raise exception 'Too many skills in one lesson (40 at most)' using errcode = '23514';
  end if;

  insert into public.lesson_records (enrolment_id, teacher_id, taught_on, duration_minutes, summary, handover_note, homework, next_step)
  values (p_enrolment, auth.uid(), coalesce(p_taught_on, current_date), coalesce(p_duration, 50),
          nullif(btrim(p_summary), ''), nullif(btrim(p_handover), ''), nullif(btrim(p_homework), ''),
          coalesce(p_next_step, 'continue'))
  returning id into rid;

  for item in select * from jsonb_array_elements(coalesce(p_skills, '[]'::jsonb)) loop
    insert into public.skill_evidence (enrolment_id, skill_id, stage, lesson_record_id)
    values (p_enrolment, (item ->> 'skill_id')::uuid, (item ->> 'stage')::public.skill_stage, rid);
  end loop;

  return rid;
end $$;
revoke all on function public.record_lesson(uuid, date, int, text, text, text, public.lesson_next_step, jsonb) from public, anon;
grant execute on function public.record_lesson(uuid, date, int, text, text, text, public.lesson_next_step, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Teachers and students can see the programme they're enrolled in
-- ---------------------------------------------------------------------
create function public.can_view_programme(p_programme uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.enrolments e
    where e.programme_id = p_programme and public.can_view_enrolment(e.id))
$$;

create policy "programmes: read my enrolled programme" on public.programmes for select to authenticated
  using (public.can_view_programme(id));
create policy "modules: read my enrolled programme" on public.modules for select to authenticated
  using (public.can_view_programme(programme_id));

-- ---------------------------------------------------------------------
-- 3. KEEP-ALIVE (used by the weekly GitHub check)
-- ---------------------------------------------------------------------
create function public.keepalive()
returns timestamptz language sql stable set search_path = '' as $$ select now() $$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

commit;
