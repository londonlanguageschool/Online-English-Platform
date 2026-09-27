-- =====================================================================
-- MILEO — Migration 001: user roles + teacher applications
--
-- HOW TO RUN (once):
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--   It is safe to run on the existing project: it only ADDS tables,
--   functions and rules. It does not change or delete existing users.
--
-- WHAT IT DOES
--   1. profiles  — one row per login. The role (student / teacher / admin)
--                  lives HERE, set by the database. Users cannot change it.
--                  (Previously the role was in user_metadata, which any user
--                  can edit from their own browser.)
--   2. teacher_applications — the "Apply to teach" form saves here.
--                  The public can submit; only admins can read or review.
--   3. application_status_history — automatic audit trail of every
--                  status change (who, when, from → to).
--
-- Status path:  applied → screening → interview → verified
--               (rejected / withdrawn possible from any open stage)
--   A teacher can only become "verified" from the "interview" stage,
--   so the quality-control steps cannot be skipped.
-- =====================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ROLES & PROFILES
-- ---------------------------------------------------------------------

do $$ begin
  create type public.app_role as enum ('student', 'teacher', 'admin');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  role        public.app_role not null default 'student',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Every new sign-up gets a profile with role 'student'.
-- Any "role" the browser sends in sign-up metadata is deliberately IGNORED.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create profiles for accounts that already exist (all start as student).
insert into public.profiles (id, full_name)
select u.id, left(coalesce(u.raw_user_meta_data ->> 'full_name', ''), 120)
from auth.users u
on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Role helpers used by the security rules below.
create or replace function public.my_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.my_role() = 'admin', false) $$;

-- Table permissions: logged-in users may read, and may only edit their name.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own name" on public.profiles;
create policy "profiles: update own name" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admins change roles ONLY through this function (checked server-side).
create or replace function public.admin_set_role(target_user uuid, new_role public.app_role)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change roles' using errcode = '42501';
  end if;
  if target_user = auth.uid() and new_role <> 'admin' then
    raise exception 'You cannot remove your own admin role' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target_user;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_role(uuid, public.app_role) from public, anon;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;

-- ---------------------------------------------------------------------
-- 2. TEACHER APPLICATIONS
-- ---------------------------------------------------------------------

do $$ begin
  create type public.application_status as enum
    ('applied', 'screening', 'interview', 'verified', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.teacher_applications (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),

  -- Submitted by the applicant
  first_name         text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name          text not null check (char_length(btrim(last_name))  between 1 and 80),
  email              text not null check (
                       char_length(email) <= 254
                       and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  country            text not null check (char_length(btrim(country)) between 1 and 80),
  timezone           text check (timezone is null or char_length(timezone) <= 64),
  experience         text check (experience is null or experience in
                       ('Less than 1 year', '1–2 years', '3–5 years', '6–10 years', '10+ years')),
  qualifications     text check (qualifications is null or char_length(qualifications) <= 2000),
  specialisms        text check (specialisms    is null or char_length(specialisms)    <= 2000),
  availability       text check (availability   is null or char_length(availability)   <= 2000),
  motivation         text check (motivation     is null or char_length(motivation)     <= 4000),
  privacy_consent    boolean not null check (privacy_consent),

  -- Managed by admins only
  status             public.application_status not null default 'applied',
  status_changed_at  timestamptz not null default now(),
  reviewed_by        uuid references auth.users (id) on delete set null,
  screening_notes    text check (screening_notes   is null or char_length(screening_notes)   <= 10000),
  interview_at       timestamptz,
  interview_notes    text check (interview_notes   is null or char_length(interview_notes)   <= 10000),
  observation_notes  text check (observation_notes is null or char_length(observation_notes) <= 10000)
);

create index if not exists teacher_applications_status_idx
  on public.teacher_applications (status, created_at desc);
create index if not exists teacher_applications_email_idx
  on public.teacher_applications (lower(email), created_at desc);

create table if not exists public.application_status_history (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.teacher_applications (id) on delete cascade,
  from_status     public.application_status,
  to_status       public.application_status not null,
  changed_by      uuid references auth.users (id) on delete set null,
  changed_at      timestamptz not null default now()
);

create index if not exists application_status_history_app_idx
  on public.application_status_history (application_id, changed_at);

alter table public.teacher_applications      enable row level security;
alter table public.application_status_history enable row level security;

-- New applications: normalise, force the starting state, block floods.
create or replace function public.teacher_application_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  recent_same_email int;
  recent_total      int;
begin
  new.first_name := btrim(new.first_name);
  new.last_name  := btrim(new.last_name);
  new.email      := lower(btrim(new.email));
  new.country    := btrim(new.country);
  new.timezone   := nullif(btrim(new.timezone), '');

  if new.timezone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Please choose a valid time zone.' using errcode = '22023';
  end if;

  -- Whatever the browser sent, an application always starts here.
  new.status            := 'applied';
  new.status_changed_at := now();
  new.created_at        := now();
  new.reviewed_by       := null;
  new.screening_notes   := null;
  new.interview_at      := null;
  new.interview_notes   := null;
  new.observation_notes := null;

  select count(*) into recent_same_email
  from public.teacher_applications
  where lower(email) = new.email and created_at > now() - interval '24 hours';

  select count(*) into recent_total
  from public.teacher_applications
  where created_at > now() - interval '10 minutes';

  if recent_same_email >= 2 or recent_total >= 30 then
    raise exception 'We have received several applications just now. Please try again later.'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists teacher_application_before_insert on public.teacher_applications;
create trigger teacher_application_before_insert
  before insert on public.teacher_applications
  for each row execute function public.teacher_application_before_insert();

-- Status changes: enforce the quality-control path and record history.
create or replace function public.teacher_application_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'applied'   and new.status in ('screening', 'rejected', 'withdrawn'))
      or (old.status = 'screening' and new.status in ('interview', 'rejected', 'withdrawn'))
      or (old.status = 'interview' and new.status in ('verified',  'rejected', 'withdrawn'))
      or (old.status = 'verified'  and new.status in ('rejected'))            -- revoke verification
      or (old.status in ('rejected', 'withdrawn') and new.status = 'screening') -- reopen
    ) then
      raise exception 'Cannot move an application from % to %', old.status, new.status
        using errcode = '22023';
    end if;
    new.status_changed_at := now();
    new.reviewed_by       := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_application_before_update on public.teacher_applications;
create trigger teacher_application_before_update
  before update on public.teacher_applications
  for each row execute function public.teacher_application_before_update();

create or replace function public.teacher_application_log_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_status_history (application_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.application_status_history (application_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists teacher_application_log_status on public.teacher_applications;
create trigger teacher_application_log_status
  after insert or update on public.teacher_applications
  for each row execute function public.teacher_application_log_status();

-- Table permissions.
revoke all on public.teacher_applications      from anon, authenticated;
revoke all on public.application_status_history from anon, authenticated;

-- Anyone (logged in or not) may submit the applicant fields — nothing else.
grant insert (first_name, last_name, email, country, timezone, experience,
              qualifications, specialisms, availability, motivation, privacy_consent)
  on public.teacher_applications to anon, authenticated;

-- Review fields that admins may edit (the rules below restrict this to admins).
grant select, delete on public.teacher_applications to authenticated;
grant update (status, screening_notes, interview_at, interview_notes, observation_notes)
  on public.teacher_applications to authenticated;
grant select on public.application_status_history to authenticated;

drop policy if exists "applications: anyone can submit" on public.teacher_applications;
create policy "applications: anyone can submit" on public.teacher_applications
  for insert to anon, authenticated
  with check (true);

drop policy if exists "applications: admins read" on public.teacher_applications;
create policy "applications: admins read" on public.teacher_applications
  for select to authenticated
  using (public.is_admin());

drop policy if exists "applications: admins review" on public.teacher_applications;
create policy "applications: admins review" on public.teacher_applications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- For data-protection erasure requests.
drop policy if exists "applications: admins delete" on public.teacher_applications;
create policy "applications: admins delete" on public.teacher_applications
  for delete to authenticated
  using (public.is_admin());

drop policy if exists "history: admins read" on public.application_status_history;
create policy "history: admins read" on public.application_status_history
  for select to authenticated
  using (public.is_admin());

commit;

-- =====================================================================
-- AFTER RUNNING: make yourself an admin (one time only).
-- Replace the email with the one you log in to Mileo with, then run:
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
--
-- (The SQL Editor runs with full rights, so this works there — but no
--  website visitor can do the same thing.)
-- =====================================================================
