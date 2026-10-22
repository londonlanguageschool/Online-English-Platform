-- =====================================================================
-- MILEO — Migration 007: checkpoints you can book, assess and celebrate
--
-- HOW TO RUN (once, after 006):
--   Supabase → SQL Editor → + → Create a new snippet → paste → Run.
--   All-or-nothing. Running it twice stops at "already exists" and
--   changes nothing.
--
-- WHAT IT DOES
--   1. Checkpoints get a length (minutes), an optional video-call link,
--      and "seen by the student" (so the reward opens once).
--   2. Skills get an optional one-line CHECKPOINT TASK for the assessor
--      ("Tell me about your first day in the kitchen").
--   3. The assessor sees only what they need, through
--      my_checkpoints_to_assess(): the student's FIRST name, the module
--      and its skills + tasks. Never the teacher's notes, so the check
--      stays independent.
--   4. record_checkpoint() saves the result in one go:
--        • every skill marked Can do it / Not yet
--        • the outcome is worked out (all → confirmed, none → not
--          confirmed, else partly)
--        • a "Not yet" skill that was Secure goes back to Practising
--        • a short message for the student
--      Only the booked assessor (or an admin) can do this, once.
--   5. Assessors can no longer edit checkpoints directly: the only way
--      to record a result is record_checkpoint().
--   6. mark_checkpoint_seen(): the student's reward opens once.
--   7. Kitchen English skills get their checkpoint tasks (if that course
--      has been added).
-- =====================================================================

begin;

-- 1. Checkpoint details ------------------------------------------------
alter table public.checkpoints
  add column duration_minutes int not null default 20 check (duration_minutes between 10 and 90),
  add column meeting_url text check (meeting_url is null or (meeting_url ~ '^https://' and char_length(meeting_url) <= 500)),
  add column seen_by_student_at timestamptz;

-- 2. A one-line task per skill, for the assessor -------------------------
alter table public.skills
  add column checkpoint_task text check (checkpoint_task is null or char_length(checkpoint_task) between 3 and 300);

-- 5. Results only through record_checkpoint() --------------------------
drop policy "checkpoints assessor update" on public.checkpoints;
drop policy "checkpoint results write" on public.checkpoint_skill_results;
create policy "checkpoint results admin" on public.checkpoint_skill_results for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 3. What an assessor sees ---------------------------------------------
create function public.my_checkpoints_to_assess()
returns table (
  checkpoint_id uuid,
  scheduled_at timestamptz,
  duration_minutes int,
  meeting_url text,
  student_first_name text,
  programme_title text,
  cefr_level text,
  module_position int,
  module_title text,
  skills jsonb
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.scheduled_at, c.duration_minutes, c.meeting_url,
         coalesce(nullif(split_part(btrim(coalesce(sp.full_name, '')), ' ', 1), ''), 'Student'),
         p.title, p.cefr_level, m.position, m.title,
         coalesce((
           select jsonb_agg(jsonb_build_object('skill_id', s.id, 'can_do', s.can_do, 'area', s.area, 'task', s.checkpoint_task)
                            order by s.code)
           from public.skills s
           where s.id in (
             select ms.skill_id from public.module_skills ms
             join public.modules mm on mm.id = ms.module_id
             where (c.module_id is not null and ms.module_id = c.module_id)
                or (c.module_id is null and mm.programme_id = e.programme_id))
         ), '[]'::jsonb)
  from public.checkpoints c
  join public.enrolments e on e.id = c.enrolment_id
  join public.profiles sp on sp.id = e.student_id
  join public.programmes p on p.id = e.programme_id
  left join public.modules m on m.id = c.module_id
  where c.assessor_id = auth.uid() and c.status = 'scheduled'
  order by c.scheduled_at nulls last
$$;
revoke all on function public.my_checkpoints_to_assess() from public, anon;
grant execute on function public.my_checkpoints_to_assess() to authenticated;

-- 4. Record the result -------------------------------------------------
create function public.record_checkpoint(p_checkpoint uuid, p_results jsonb, p_summary text)
returns public.checkpoint_outcome
language plpgsql security definer set search_path = '' as $$
declare
  cp record;
  prog uuid;
  item jsonb;
  sid uuid;
  ok boolean;
  n_total int := 0;
  n_yes int := 0;
  result public.checkpoint_outcome;
begin
  select * into cp from public.checkpoints where id = p_checkpoint for update;
  if cp is null then
    raise exception 'Checkpoint not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or cp.assessor_id = auth.uid()) then
    raise exception 'Only the booked assessor can record this checkpoint' using errcode = '42501';
  end if;
  if cp.status <> 'scheduled' then
    raise exception 'This checkpoint has already been recorded or cancelled' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_results) = 0 or jsonb_array_length(p_results) > 40 then
    raise exception 'Mark between 1 and 40 skills' using errcode = '23514';
  end if;
  if char_length(coalesce(p_summary, '')) > 300 then
    raise exception 'The message is too long (300 characters at most)' using errcode = '23514';
  end if;

  select programme_id into prog from public.enrolments where id = cp.enrolment_id;

  for item in select * from jsonb_array_elements(p_results) loop
    sid := (item ->> 'skill_id')::uuid;
    ok := (item ->> 'confirmed')::boolean;
    if sid is null or ok is null then
      raise exception 'Each skill needs Can do it or Not yet' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.module_skills ms join public.modules m on m.id = ms.module_id
      where ms.skill_id = sid
        and ((cp.module_id is not null and ms.module_id = cp.module_id)
          or (cp.module_id is null and m.programme_id = prog))) then
      raise exception 'That skill is not part of this checkpoint' using errcode = '23514';
    end if;

    insert into public.checkpoint_skill_results (checkpoint_id, skill_id, confirmed)
    values (p_checkpoint, sid, ok);
    n_total := n_total + 1;
    if ok then n_yes := n_yes + 1; end if;

    -- "Not yet" on a skill the teacher had marked Secure: back to Practising.
    if not ok and (
      select se.stage from public.skill_evidence se
      where se.enrolment_id = cp.enrolment_id and se.skill_id = sid
      order by se.recorded_at desc, se.id desc limit 1) = 'secure' then
      insert into public.skill_evidence (enrolment_id, skill_id, stage, note)
      values (cp.enrolment_id, sid, 'practising', 'Checkpoint: not yet. Back to practising.');
    end if;
  end loop;

  result := case when n_yes = n_total then 'confirmed'
                 when n_yes = 0 then 'not_confirmed'
                 else 'partly_confirmed' end;

  update public.checkpoints
     set status = 'completed', outcome = result,
         summary = nullif(btrim(coalesce(p_summary, '')), ''),
         completed_at = now()
   where id = p_checkpoint;

  return result;
end $$;
revoke all on function public.record_checkpoint(uuid, jsonb, text) from public, anon;
grant execute on function public.record_checkpoint(uuid, jsonb, text) to authenticated;

-- 6. The student's reward opens once -----------------------------------
create function public.mark_checkpoint_seen(p_checkpoint uuid)
returns void language sql security definer set search_path = '' as $$
  update public.checkpoints c set seen_by_student_at = now()
  where c.id = p_checkpoint and c.status = 'completed' and c.seen_by_student_at is null
    and exists (select 1 from public.enrolments e where e.id = c.enrolment_id and e.student_id = auth.uid())
$$;
revoke all on function public.mark_checkpoint_seen(uuid) from public, anon;
grant execute on function public.mark_checkpoint_seen(uuid) to authenticated;

-- 7. Kitchen English checkpoint tasks (skipped if that course isn't added)
update public.skills s set checkpoint_task = t.task
from (values
  ('KE-A2.L01', 'Introduce yourself and tell me who does what in your kitchen.'),
  ('KE-A2.L02', 'Look around your kitchen: name 6 things and say where they are.'),
  ('KE-A2.L03', 'A delivery has arrived. Check it with me: is there any butter? Are there any eggs?'),
  ('KE-A2.L04', 'I''m the chef: follow my 4 commands, then give me 3.'),
  ('KE-A2.L05', 'Tell me how to make your signature dish, step by step.'),
  ('KE-A2.L06', 'How long and at what temperature? Answer 4 quick questions.'),
  ('KE-A2.L07', 'Tell me 3 things a new commis must and mustn''t do.'),
  ('KE-A2.L08', 'I''m a customer with an allergy. Answer my questions about the menu.'),
  ('KE-A2.L09', 'Service! Respond to my 4 calls from the pass.'),
  ('KE-A2.L10', 'Tell me about a shift that went wrong and how you asked for help.')
) as t(code, task)
where s.code = t.code and s.checkpoint_task is null;

commit;
