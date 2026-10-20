-- =====================================================================
-- MILEO — Migration 006: handover notes are for teachers only
--
-- HOW TO RUN (once, after 005):
--   Supabase → SQL Editor → + → Create a new snippet → paste → Run.
--   All-or-nothing. Running it twice stops at "already exists" and
--   changes nothing.
--
-- WHY
--   The handover note is a message from one teacher to the next
--   ("still drops the -ed in past simple"). Until now it lived in
--   lesson_records, which the student can read. Row rules can't hide one
--   column, so the notes move to their own table that only the
--   student's CURRENT teacher and admins can read.
--
-- WHAT IT DOES
--   1. New table lesson_handover_notes (one note per lesson).
--   2. Copies every existing note across, then removes the old column.
--   3. record_lesson() keeps exactly the same inputs, and now saves the
--      note in the new table. Still all-or-nothing.
--   Students keep seeing what was covered, homework and skills.
-- =====================================================================

begin;

create table public.lesson_handover_notes (
  lesson_record_id  uuid primary key references public.lesson_records (id) on delete cascade,
  enrolment_id      uuid not null references public.enrolments (id) on delete cascade,
  note              text not null check (char_length(note) between 1 and 500),
  written_by        uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);
create index lesson_handover_notes_enrolment_idx on public.lesson_handover_notes (enrolment_id);

-- Copy existing notes across (before the check below is switched on).
insert into public.lesson_handover_notes (lesson_record_id, enrolment_id, note, written_by, created_at)
select id, enrolment_id, btrim(handover_note), teacher_id, created_at
from public.lesson_records
where handover_note is not null and btrim(handover_note) <> '';

-- The note always matches its lesson's student, and its author.
create function public.check_handover_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lr record;
begin
  select enrolment_id, teacher_id into lr from public.lesson_records where id = new.lesson_record_id;
  if lr is null then
    raise exception 'That lesson does not exist' using errcode = '23503';
  end if;
  new.enrolment_id := lr.enrolment_id;
  if not public.is_admin() then
    if lr.teacher_id <> auth.uid() or not public.is_current_teacher_of(lr.enrolment_id) then
      raise exception 'You can only add notes to your own lessons' using errcode = '42501';
    end if;
    new.written_by := auth.uid();
  else
    new.written_by := coalesce(new.written_by, auth.uid(), lr.teacher_id);
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger check_handover_note before insert on public.lesson_handover_notes
  for each row execute function public.check_handover_note();

alter table public.lesson_handover_notes enable row level security;
revoke all on public.lesson_handover_notes from anon, authenticated;
grant select, insert, update, delete on public.lesson_handover_notes to authenticated;

create policy "handover notes: current teacher and admins read" on public.lesson_handover_notes
  for select to authenticated
  using (public.is_admin() or public.is_current_teacher_of(enrolment_id));
create policy "handover notes: current teacher adds" on public.lesson_handover_notes
  for insert to authenticated
  with check (public.is_admin() or public.is_current_teacher_of(enrolment_id));
create policy "handover notes: admin corrects" on public.lesson_handover_notes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "handover notes: admin deletes" on public.lesson_handover_notes
  for delete to authenticated using (public.is_admin());

-- Same inputs as before, so the website keeps working while it updates.
create or replace function public.record_lesson(
  p_enrolment uuid,
  p_taught_on date,
  p_duration int,
  p_summary text,
  p_handover text,
  p_homework text,
  p_next_step public.lesson_next_step,
  p_skills jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  rid uuid;
  item jsonb;
begin
  if jsonb_typeof(coalesce(p_skills, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_skills, '[]'::jsonb)) > 40 then
    raise exception 'Too many skills in one lesson (40 at most)' using errcode = '23514';
  end if;

  insert into public.lesson_records (enrolment_id, teacher_id, taught_on, duration_minutes, summary, homework, next_step)
  values (p_enrolment, auth.uid(), coalesce(p_taught_on, current_date), coalesce(p_duration, 50),
          nullif(btrim(p_summary), ''), nullif(btrim(p_homework), ''), coalesce(p_next_step, 'continue'))
  returning id into rid;

  if nullif(btrim(p_handover), '') is not null then
    insert into public.lesson_handover_notes (lesson_record_id, enrolment_id, note)
    values (rid, p_enrolment, btrim(p_handover));
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_skills, '[]'::jsonb)) loop
    insert into public.skill_evidence (enrolment_id, skill_id, stage, lesson_record_id)
    values (p_enrolment, (item ->> 'skill_id')::uuid, (item ->> 'stage')::public.skill_stage, rid);
  end loop;

  return rid;
end $$;
revoke all on function public.record_lesson(uuid, date, int, text, text, text, public.lesson_next_step, jsonb) from public, anon;
grant execute on function public.record_lesson(uuid, date, int, text, text, text, public.lesson_next_step, jsonb) to authenticated;

alter table public.lesson_records drop column handover_note;

commit;
