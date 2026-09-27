-- Security tests for migration 001. Run against a LOCAL database after the stub + migration.
-- See supabase/README.md. Expected results are listed in that file.
\set ON_ERROR_STOP 0
\pset tuples_only on
-- Setup users: new signup trying to be admin, a real admin
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000a','sneaky@x.com','{"full_name":"Sneaky","role":"admin"}'), ('00000000-0000-0000-0000-00000000000b','boss@x.com','{"full_name":"Boss"}');
select 'T1 existing user backfilled as student: ' || role from profiles where id='00000000-0000-0000-0000-000000000001';
select 'T2 signup with role=admin metadata got: ' || role from profiles where id='00000000-0000-0000-0000-00000000000a';
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000b';

-- ANON
begin; set local role anon; set local request.jwt.claim.sub = '';
insert into teacher_applications (first_name,last_name,email,country,timezone,experience,privacy_consent) values (' Ann ','Lee','Ann@Ex.com','Italy','Europe/Rome','3–5 years',true);
select 'T3 anon insert OK';
commit;
begin; set local role anon; insert into teacher_applications (first_name,last_name,email,country,privacy_consent,status) values ('a','b','c@d.com','x',true,'verified'); rollback;
begin; set local role anon; select 'T4 anon can read? rows=' || count(*) from teacher_applications; rollback;
begin; set local role anon; insert into teacher_applications (first_name,last_name,email,country,privacy_consent) values ('a','b','bad-email','x',true); rollback;
begin; set local role anon; insert into teacher_applications (first_name,last_name,email,country,privacy_consent) values ('a','b','ok@x.com','x',false); rollback;
begin; set local role anon; insert into teacher_applications (first_name,last_name,email,country,timezone,privacy_consent) values ('a','b','ok@x.com','x','Mars/Base',true); rollback;
begin; set local role anon; insert into teacher_applications (first_name,last_name,email,country,privacy_consent) values ('a','b','flood@x.com','x',true); insert into teacher_applications (first_name,last_name,email,country,privacy_consent) values ('a','b','flood@x.com','x',true); insert into teacher_applications (first_name,last_name,email,country,privacy_consent) values ('a','b','FLOOD@x.com','x',true); rollback;
select 'T5 stored: ' || first_name || '|' || email || '|' || status from teacher_applications;

-- STUDENT (sneaky)
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'T6 student sees apps: ' || count(*) from teacher_applications;
select 'T7 student sees profiles: ' || count(*) from profiles;
update profiles set role='admin' where id=auth.uid();
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select admin_set_role('00000000-0000-0000-0000-00000000000a','admin'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update teacher_applications set status='verified'; select 'T8 student update touched rows (should be 0) - see above'; 
update profiles set full_name='Renamed' where id=auth.uid(); select 'T9 own name now: '||full_name||' role '||role from profiles where id=auth.uid();
rollback;

-- ADMIN
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'T10 admin sees apps: ' || count(*) from teacher_applications;
update teacher_applications set status='verified';
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update teacher_applications set status='screening', screening_notes='CELTA checked';
update teacher_applications set status='interview', interview_at=now();
update teacher_applications set status='verified', observation_notes='Strong lesson';
select 'T11 path: ' || string_agg(coalesce(from_status::text,'-')||'>'||to_status, ', ' order by id) from application_status_history;
select 'T12 reviewed_by set: ' || (reviewed_by = auth.uid()) from teacher_applications;
update teacher_applications set email='changed@x.com';
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select admin_set_role('00000000-0000-0000-0000-00000000000b','student'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select admin_set_role('00000000-0000-0000-0000-00000000000a','teacher'); select 'T13 admin set role: '||role from profiles where id='00000000-0000-0000-0000-00000000000a'; rollback;
