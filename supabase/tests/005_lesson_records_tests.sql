-- Tests for migration 005. Run locally after: stubs, migrations 001-005, then tests/003 (it creates the people and programme used here).
\set ON_ERROR_STOP 0
\pset tuples_only on
-- a1 = current teacher of b1 (enrolment 5..01); a2 = other teacher; b2 = other student; s1 in programme, s2 not.
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'L1 teacher records lesson: ' || (record_lesson('50000000-0000-0000-0000-000000000001', current_date, 50, 'Past simple stories', 'Good fluency, check -ed endings', 'Write 5 sentences', 'continue',
  '[{"skill_id":"40000000-0000-0000-0000-000000000001","stage":"practising"}]') is not null); commit;
select 'L2 evidence linked to lesson: ' || count(*) from skill_evidence where lesson_record_id is not null;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'L3 other teacher records for b1 (expect error):';
select record_lesson('50000000-0000-0000-0000-000000000001', current_date, 50, 'x', null, null, 'continue', '[]'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'L4 skill outside programme rolls back whole lesson (expect error):';
select record_lesson('50000000-0000-0000-0000-000000000001', current_date, 50, 'x', null, null, 'continue', '[{"skill_id":"40000000-0000-0000-0000-000000000002","stage":"secure"}]'); rollback;
select 'L4b lessons still 1: ' || count(*) from lesson_records;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'L5 date 90 days ago (expect error):';
select record_lesson('50000000-0000-0000-0000-000000000001', current_date - 90, 50, 'x', null, null, 'continue', '[]'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'L6 teacher_id can''t be faked: ' || (teacher_id = '10000000-0000-0000-0000-0000000000a1') from lesson_records; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'L7 student reads own lesson notes: ' || count(*) from lesson_records; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'L8 other student sees (expect 0): ' || count(*) from lesson_records; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'L9 teacher edits a record (expect 0 rows):'; update lesson_records set summary='changed'; rollback;
select 'L9b unchanged: ' || summary from lesson_records;
-- hand b1 over to a2: new teacher sees full history, old teacher no longer does
update teacher_assignments set ends_on = current_date where enrolment_id='50000000-0000-0000-0000-000000000001' and ends_on is null;
insert into teacher_assignments (enrolment_id, teacher_id) values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000a2');
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'L10 new teacher sees previous lessons: ' || count(*) from lesson_records; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'L11 previous teacher no longer sees (expect 0): ' || count(*) from lesson_records; rollback;
-- unpublished programme visible to its teacher
update programmes set published=false;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'L12 teacher sees own student''s unpublished programme + modules: ' || (select count(*) from programmes) || '/' || (select count(*) from modules); rollback;
insert into auth.users (id,email) values ('10000000-0000-0000-0000-0000000000b9','unrelated@x');
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b9';
select 'L13 unrelated student sees it (expect 0/0): ' || (select count(*) from programmes) || '/' || (select count(*) from modules); rollback;
begin; set local role anon;
select 'L14 anon keep-alive works: ' || (keepalive() is not null);
select 'L15 anon still can''t read lessons (expect error):'; select count(*) from lesson_records; rollback;
