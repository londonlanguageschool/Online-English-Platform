-- =====================================================================
-- MILEO — DRAFT migration 002: academic core (Phase 4 / 6 foundation)
--
-- STATUS: DRAFT FOR REVIEW. Do NOT run on the live project yet.
--         Tested locally on PostgreSQL 16 (see supabase/README.md).
--         Requires migration 001 to have been run first.
--
-- IDEA IN ONE PARAGRAPH
--   A Programme (e.g. "General English B1") contains ordered Modules;
--   each Module lists the Skills (can-do outcomes) it teaches.
--   A student is Enrolled in a programme and Assigned a teacher.
--   After lessons, the teacher records Skill Evidence
--   ("introduced" → "practising" → "secure") for that student.
--   Progress is DERIVED from that evidence — never typed in as a %.
--   An Academic Checkpoint is assessed by someone who is NOT the
--   student's current teacher, and confirms (or not) the skills
--   the teacher says are secure. That is the independence guarantee.
--
-- WHO SEES WHAT
--   Curriculum (programmes/modules/skills): any logged-in user reads
--     published items; only admins write.
--   Enrolments, evidence, checkpoints: the student sees their own; the
--     assigned teacher sees their students'; admins see everything.
--   Teachers can only record evidence for students assigned to them.
--   Only admins create checkpoints and choose the assessor; the database
--     refuses an assessor who is the student's assigned teacher.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- CURRICULUM
-- ---------------------------------------------------------------------

create table public.programmes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9-]{2,24}$'),   -- e.g. GE-B1
  title        text not null check (char_length(title) between 2 and 120),
  cefr_level   text check (cefr_level in ('Pre-A1','A1','A2','B1','B2','C1','C2')),
  description  text check (char_length(description) <= 4000),
  published    boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.modules (
  id            uuid primary key default gen_random_uuid(),
  programme_id  uuid not null references public.programmes (id) on delete cascade,
  position      int  not null check (position > 0),
  title         text not null check (char_length(title) between 2 and 120),
  summary       text check (char_length(summary) <= 4000),
  unique (programme_id, position)
);

create table public.skills (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9.-]{2,32}$'),   -- e.g. GE-B1.SPK.03
  can_do     text not null check (char_length(can_do) between 5 and 300), -- "Can describe past experiences…"
  area       text not null check (area in ('speaking','listening','reading','writing','grammar','vocabulary','pronunciation')),
  cefr_level text check (cefr_level in ('Pre-A1','A1','A2','B1','B2','C1','C2'))
);

create table public.module_skills (
  module_id  uuid not null references public.modules (id) on delete cascade,
  skill_id   uuid not null references public.skills (id)  on delete restrict,
  primary key (module_id, skill_id)
);

-- ---------------------------------------------------------------------
-- PEOPLE ↔ PROGRAMMES
-- ---------------------------------------------------------------------

create type public.enrolment_status as enum ('active','paused','completed','withdrawn');

create table public.enrolments (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  programme_id  uuid not null references public.programmes (id) on delete restrict,
  status        public.enrolment_status not null default 'active',
  started_on    date not null default current_date,
  target_note   text check (char_length(target_note) <= 1000),   -- the learner's goal
  created_at    timestamptz not null default now()
);
-- One active enrolment per student per programme.
create unique index enrolments_one_active
  on public.enrolments (student_id, programme_id) where status = 'active';

create table public.teacher_assignments (
  id            uuid primary key default gen_random_uuid(),
  enrolment_id  uuid not null references public.enrolments (id) on delete cascade,
  teacher_id    uuid not null references public.profiles (id) on delete restrict,
  starts_on     date not null default current_date,
  ends_on       date,
  check (ends_on is null or ends_on >= starts_on)
);
-- At most one current teacher per enrolment.
create unique index teacher_assignments_one_current
  on public.teacher_assignments (enrolment_id) where ends_on is null;

-- ---------------------------------------------------------------------
-- EVIDENCE & CHECKPOINTS
-- ---------------------------------------------------------------------

create type public.skill_stage as enum ('introduced','practising','secure');

create table public.skill_evidence (
  id            bigint generated always as identity primary key,
  enrolment_id  uuid not null references public.enrolments (id) on delete cascade,
  skill_id      uuid not null references public.skills (id) on delete restrict,
  stage         public.skill_stage not null,
  note          text check (char_length(note) <= 2000),
  recorded_by   uuid not null default auth.uid() references public.profiles (id),
  recorded_at   timestamptz not null default now()
);
create index skill_evidence_lookup on public.skill_evidence (enrolment_id, skill_id, recorded_at desc);

create type public.checkpoint_status as enum ('scheduled','completed','cancelled');
create type public.checkpoint_outcome as enum ('confirmed','partly_confirmed','not_confirmed');

create table public.checkpoints (
  id            uuid primary key default gen_random_uuid(),
  enrolment_id  uuid not null references public.enrolments (id) on delete cascade,
  module_id     uuid references public.modules (id) on delete set null,
  assessor_id   uuid not null references public.profiles (id),
  scheduled_at  timestamptz,
  status        public.checkpoint_status not null default 'scheduled',
  outcome       public.checkpoint_outcome,
  summary       text check (char_length(summary) <= 4000),
  completed_at  timestamptz,
  check ((status = 'completed') = (outcome is not null))
);

create table public.checkpoint_skill_results (
  checkpoint_id uuid not null references public.checkpoints (id) on delete cascade,
  skill_id      uuid not null references public.skills (id) on delete restrict,
  confirmed     boolean not null,
  note          text check (char_length(note) <= 1000),
  primary key (checkpoint_id, skill_id)
);

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS (security definer so rules can use them safely)
-- ---------------------------------------------------------------------

create function public.is_current_teacher_of(p_enrolment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teacher_assignments ta
    where ta.enrolment_id = p_enrolment
      and ta.teacher_id = auth.uid()
      and ta.ends_on is null)
$$;

create function public.is_student_of(p_enrolment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.enrolments e where e.id = p_enrolment and e.student_id = auth.uid())
$$;

create function public.can_view_enrolment(p_enrolment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.is_student_of(p_enrolment) or public.is_current_teacher_of(p_enrolment)
$$;

-- ---------------------------------------------------------------------
-- INTEGRITY RULES
-- ---------------------------------------------------------------------

-- Assigned teacher must actually have the teacher role.
create function public.check_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select role from public.profiles where id = new.teacher_id) <> 'teacher' then
    raise exception 'Only users with the teacher role can be assigned to students' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger check_assignment before insert or update on public.teacher_assignments
  for each row execute function public.check_assignment();

-- Evidence: only the current teacher (or an admin), and only for skills in the programme.
create function public.check_evidence() returns trigger
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
  return new;
end $$;
create trigger check_evidence before insert on public.skill_evidence
  for each row execute function public.check_evidence();

-- Independence: the assessor may not be the student's current teacher,
-- and must be an admin or teacher.
create function public.check_checkpoint() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- An assessor (non-admin) may only record the result, not re-point the checkpoint.
  if tg_op = 'UPDATE' and not public.is_admin()
     and (new.enrolment_id, new.assessor_id, new.module_id, new.scheduled_at)
         is distinct from (old.enrolment_id, old.assessor_id, old.module_id, old.scheduled_at) then
    raise exception 'Only admins can change who, what or when a checkpoint covers' using errcode = '42501';
  end if;
  if exists (select 1 from public.teacher_assignments ta
             where ta.enrolment_id = new.enrolment_id
               and ta.teacher_id = new.assessor_id
               and ta.ends_on is null) then
    raise exception 'A checkpoint must be assessed by someone other than the student''s own teacher'
      using errcode = '23514';
  end if;
  if (select role from public.profiles where id = new.assessor_id) not in ('teacher','admin') then
    raise exception 'Assessor must be a teacher or admin' using errcode = '23514';
  end if;
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;
create trigger check_checkpoint before insert or update on public.checkpoints
  for each row execute function public.check_checkpoint();

-- ---------------------------------------------------------------------
-- DERIVED PROGRESS (no typed-in percentages)
-- Latest stage per skill + whether an independent checkpoint confirmed it.
-- security_invoker = the view obeys the same rules as the tables.
-- ---------------------------------------------------------------------

create view public.student_skill_progress with (security_invoker = true) as
select
  e.id                         as enrolment_id,
  e.student_id,
  s.id                         as skill_id,
  s.code                       as skill_code,
  s.can_do,
  s.area,
  latest.stage                 as teacher_stage,
  latest.recorded_at           as last_evidence_at,
  conf.confirmed               as checkpoint_confirmed,
  conf.completed_at            as checkpoint_at
from public.enrolments e
join public.modules m        on m.programme_id = e.programme_id
join public.module_skills ms on ms.module_id = m.id
join public.skills s         on s.id = ms.skill_id
left join lateral (
  select se.stage, se.recorded_at from public.skill_evidence se
  where se.enrolment_id = e.id and se.skill_id = s.id
  order by se.recorded_at desc, se.id desc limit 1
) latest on true
left join lateral (
  select r.confirmed, c.completed_at from public.checkpoint_skill_results r
  join public.checkpoints c on c.id = r.checkpoint_id
  where c.enrolment_id = e.id and r.skill_id = s.id and c.status = 'completed'
  order by c.completed_at desc limit 1
) conf on true;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.programmes               enable row level security;
alter table public.modules                  enable row level security;
alter table public.skills                   enable row level security;
alter table public.module_skills            enable row level security;
alter table public.enrolments               enable row level security;
alter table public.teacher_assignments      enable row level security;
alter table public.skill_evidence           enable row level security;
alter table public.checkpoints              enable row level security;
alter table public.checkpoint_skill_results enable row level security;

revoke all on public.programmes, public.modules, public.skills, public.module_skills,
  public.enrolments, public.teacher_assignments, public.skill_evidence,
  public.checkpoints, public.checkpoint_skill_results, public.student_skill_progress
  from anon, authenticated;

grant select, insert, update, delete on public.programmes, public.modules, public.skills,
  public.module_skills, public.enrolments, public.teacher_assignments,
  public.checkpoints, public.checkpoint_skill_results to authenticated;
grant select, insert on public.skill_evidence to authenticated;   -- evidence is append-only
grant select on public.student_skill_progress to authenticated;

-- Curriculum: read published (admins read all); admins write.
create policy "programmes read"  on public.programmes for select to authenticated using (published or public.is_admin());
create policy "programmes admin" on public.programmes for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "modules read"     on public.modules for select to authenticated
  using (public.is_admin() or exists (select 1 from public.programmes p where p.id = programme_id and p.published));
create policy "modules admin"    on public.modules for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "skills read"      on public.skills for select to authenticated using (true);
create policy "skills admin"     on public.skills for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "module_skills read"  on public.module_skills for select to authenticated using (true);
create policy "module_skills admin" on public.module_skills for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Enrolments & assignments: view if involved; admins manage.
create policy "enrolments read"  on public.enrolments for select to authenticated using (public.can_view_enrolment(id));
create policy "enrolments admin" on public.enrolments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "assignments read" on public.teacher_assignments for select to authenticated
  using (public.is_admin() or teacher_id = auth.uid() or public.is_student_of(enrolment_id));
create policy "assignments admin" on public.teacher_assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Evidence: involved people read; current teacher or admin adds.
create policy "evidence read"  on public.skill_evidence for select to authenticated using (public.can_view_enrolment(enrolment_id));
create policy "evidence add"   on public.skill_evidence for insert to authenticated
  with check (public.is_admin() or public.is_current_teacher_of(enrolment_id));

-- Checkpoints: involved people + the assessor read; admins create;
-- the assessor records the result.
create policy "checkpoints read" on public.checkpoints for select to authenticated
  using (public.can_view_enrolment(enrolment_id) or assessor_id = auth.uid());
create policy "checkpoints admin" on public.checkpoints for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "checkpoints assessor update" on public.checkpoints for update to authenticated
  using (assessor_id = auth.uid()) with check (assessor_id = auth.uid());

create policy "checkpoint results read" on public.checkpoint_skill_results for select to authenticated
  using (exists (select 1 from public.checkpoints c where c.id = checkpoint_id
                 and (public.can_view_enrolment(c.enrolment_id) or c.assessor_id = auth.uid())));
create policy "checkpoint results write" on public.checkpoint_skill_results for all to authenticated
  using (exists (select 1 from public.checkpoints c where c.id = checkpoint_id
                 and (public.is_admin() or c.assessor_id = auth.uid())))
  with check (exists (select 1 from public.checkpoints c where c.id = checkpoint_id
                 and (public.is_admin() or c.assessor_id = auth.uid())));

commit;
