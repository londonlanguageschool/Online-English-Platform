-- LOCAL TEST STUB ONLY: imitates the parts of Supabase the migration relies on.
-- Never run this on the real Supabase project.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase-style default grants (the migration must revoke these)
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000001','existing@x.com','{"full_name":"Existing","role":"admin"}');
