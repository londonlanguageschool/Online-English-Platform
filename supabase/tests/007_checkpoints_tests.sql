-- Tests for migration 007. Run locally after: stubs, migrations 001-006, tests/003, tests/005, tests/006, then migration 007.
-- State: enrolment 5..01 (student b1) now taught by a2; a1 taught before. Skill 4..01 is in module 3..01.
\set ON_ERROR_STOP 0
\pset tuples_only on
update profiles set full_name='Giulia Rossi' where id='10000000-0000-0000-0000-0000000000b1';
update skills set checkpoint_task='Tell me about a trip' where id='40000000-0000-0000-0000-000000000001';
-- make the skill Secure again so "not yet" can send it back
insert into skill_evidence (enrolment_id,skill_id,stage,recorded_by) values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','secure','10000000-0000-0000-0000-0000000000a2');
select 'C0 skill is Secure before checkpoint: ' || teacher_stage from student_skill_progress where enrolment_id='50000000-0000-0000-0000-000000000001';
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-00000000000a';
select 'C1 current teacher a2 as assessor refused:';
insert into checkpoints (enrolment_id,module_id,assessor_id) values ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000a2'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-00000000000a';
insert into checkpoints (id,enrolment_id,module_id,assessor_id,scheduled_at,duration_minutes,meeting_url)
values ('60000000-0000-0000-0000-000000000007','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000a1', now() + interval '1 day', 20, 'https://meet.example.com/abc');
select 'C2 admin books with previous teacher a1'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'C3 assessor sees: ' || student_first_name || ' / ' || module_title || ' / skills ' || jsonb_array_length(skills) || ' / task ' || (skills->0->>'task') from my_checkpoints_to_assess(); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'C4 other teacher sees (expect 0): ' || count(*) from my_checkpoints_to_assess(); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'C5 assessor edits checkpoint directly (expect 0 rows):'; update checkpoints set status='completed', outcome='confirmed' where id='60000000-0000-0000-0000-000000000007'; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'C6 non-assessor records (expect error):';
select record_checkpoint('60000000-0000-0000-0000-000000000007','[{"skill_id":"40000000-0000-0000-0000-000000000001","confirmed":true}]','x'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'C7 skill outside checkpoint (expect error):';
select record_checkpoint('60000000-0000-0000-0000-000000000007','[{"skill_id":"40000000-0000-0000-0000-000000000002","confirmed":true}]','x'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'C8 assessor records Not yet: ' || record_checkpoint('60000000-0000-0000-0000-000000000007','[{"skill_id":"40000000-0000-0000-0000-000000000001","confirmed":false}]','Nearly there!'); commit;
select 'C9 skill back to practising: ' || teacher_stage || ' / confirmed=' || checkpoint_confirmed from student_skill_progress where enrolment_id='50000000-0000-0000-0000-000000000001';
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'C10 record twice (expect error):';
select record_checkpoint('60000000-0000-0000-0000-000000000007','[{"skill_id":"40000000-0000-0000-0000-000000000001","confirmed":true}]','x'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select mark_checkpoint_seen('60000000-0000-0000-0000-000000000007'); commit;
select 'C11 other student can''t mark seen: ' || (seen_by_student_at is null) from checkpoints where id='60000000-0000-0000-0000-000000000007';
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'C12 student reads result: ' || outcome || ' / ' || summary || ' / results ' || (select count(*) from checkpoint_skill_results where checkpoint_id='60000000-0000-0000-0000-000000000007') from checkpoints where id='60000000-0000-0000-0000-000000000007';
select mark_checkpoint_seen('60000000-0000-0000-0000-000000000007'); commit;
select 'C13 student marked seen: ' || (seen_by_student_at is not null) from checkpoints where id='60000000-0000-0000-0000-000000000007';
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'C14 student writes a result (expect error):';
insert into checkpoint_skill_results values ('60000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001',true,null); rollback;
begin; set local role anon;
select 'C15 anon calls assess list (expect error):'; select * from my_checkpoints_to_assess(); rollback;
