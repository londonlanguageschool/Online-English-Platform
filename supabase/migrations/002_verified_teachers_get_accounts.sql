-- =====================================================================
-- MILEO — Migration 002: verified teachers get teacher accounts
--
-- HOW TO RUN (once, after 001):
--   Supabase → SQL Editor → New query → paste this whole file → Run.
--   Safe to run twice. Adds one column, functions and triggers only.
--
-- WHAT IT DOES
--   • An application moved to "verified" links to the Mileo account with
--     the same email, if that account's email is CONFIRMED, and turns it
--     into a teacher account.
--   • No account yet? The moment the teacher signs up and confirms that
--     email, their account becomes a teacher account automatically.
--   • Verification revoked (verified → rejected)? The account goes back
--     to student, unless another verified application covers it.
--   • Admin accounts are never changed. Nobody can make themselves a
--     teacher: only an admin moving an application to "verified" can.
-- =====================================================================

begin;

alter table public.teacher_applications
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- Runs AFTER teacher_application_before_update (triggers fire in name order),
-- so the status path has already been validated.
create or replace function public.teacher_application_link_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  account uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'verified' then
    select u.id into account
    from auth.users u
    where lower(u.email) = lower(new.email)
      and u.email_confirmed_at is not null
    limit 1;

    if account is not null then
      new.user_id := account;
      update public.profiles set role = 'teacher'
      where id = account and role = 'student';
    end if;

  elsif old.status = 'verified' and new.user_id is not null then
    if not exists (
      select 1 from public.teacher_applications a
      where a.user_id = new.user_id and a.status = 'verified' and a.id <> new.id
    ) then
      update public.profiles set role = 'student'
      where id = new.user_id and role = 'teacher';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists teacher_application_link_account on public.teacher_applications;
create trigger teacher_application_link_account
  before update on public.teacher_applications
  for each row execute function public.teacher_application_link_account();

-- When someone confirms their email (or is created already confirmed),
-- check for a verified application with that email.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  app uuid;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

  select a.id into app
  from public.teacher_applications a
  where lower(a.email) = lower(new.email) and a.status = 'verified'
  order by a.status_changed_at desc
  limit 1;

  if app is not null then
    -- The profile may not exist yet if this runs before handle_new_user.
    insert into public.profiles (id, full_name)
    values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
    on conflict (id) do nothing;

    update public.profiles set role = 'teacher' where id = new.id and role = 'student';
    update public.teacher_applications set user_id = new.id where id = app;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- Catch up: applications already verified before this migration.
update public.teacher_applications a
set user_id = u.id
from auth.users u
where a.status = 'verified' and a.user_id is null
  and lower(u.email) = lower(a.email) and u.email_confirmed_at is not null;

update public.profiles p set role = 'teacher'
where p.role = 'student'
  and exists (select 1 from public.teacher_applications a where a.user_id = p.id and a.status = 'verified');

commit;
