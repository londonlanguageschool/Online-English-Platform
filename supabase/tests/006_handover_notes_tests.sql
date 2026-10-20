-- Tests for migration 006. Run locally after: stubs, migrations 001-005, tests/003, tests/005, then migration 006.
-- After tests/005: enrolment 5..01 (student b1) has moved from teacher a1 to a2; one lesson by a1 has a note.
\set ON_ERROR_STOP 0
\pset tuples_only on
select 'H1 existing note copied: ' || count(*) from lesson_handover_notes;
select 'H2 old column gone: ' || (not exists (select 1 from information_schema.columns where table_name='lesson_records' and column_name='handover_note'));
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'H3 current teacher saves lesson with note: ' || (record_lesson('50000000-0000-0000-0000-000000000001', current_date, 50, 'Review', 'Needs confidence with questions', null, 'reinforce', '[]') is not null); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'H4 current teacher reads notes (expect 2): ' || count(*) from lesson_handover_notes; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'H5 student reads notes (expect 0): ' || count(*) from lesson_handover_notes;
select 'H6 student still reads lessons (expect 2): ' || count(*) from lesson_records; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'H7 previous teacher reads notes (expect 0): ' || count(*) from lesson_handover_notes; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'H8 student writes a note (expect error):';
insert into lesson_handover_notes (lesson_record_id, enrolment_id, note) select id, enrolment_id, 'x' from lesson_records limit 1; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'H9 teacher edits a note (expect 0 rows):'; update lesson_handover_notes set note='changed'; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'H10 lesson without note saves no note: ' || (record_lesson('50000000-0000-0000-0000-000000000001', current_date, 50, 'Plain', '  ', null, 'continue', '[]') is not null)
  || ' / notes still 2: ' || (select count(*) from lesson_handover_notes); rollback;
