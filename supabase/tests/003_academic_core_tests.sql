-- Tests for migration 003. Run locally on a fresh database after: stub, migrations 001, 002, 003.
\set ON_ERROR_STOP 0
\pset tuples_only on
-- users: admin A, teacher T1 (assigned), teacher T2 (assessor), student S, other student O
insert into auth.users (id,email) values
 ('10000000-0000-0000-0000-00000000000a','admin@x'),('10000000-0000-0000-0000-0000000000a1','t1@x'),
 ('10000000-0000-0000-0000-0000000000a2','t2@x'),('10000000-0000-0000-0000-0000000000b1','s@x'),('10000000-0000-0000-0000-0000000000b2','o@x');
update profiles set role='admin' where id='10000000-0000-0000-0000-00000000000a';
update profiles set role='teacher' where id in ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a2');
insert into programmes (id,code,title,cefr_level,published) values ('20000000-0000-0000-0000-000000000001','GE-B1','General English B1','B1',true);
insert into modules (id,programme_id,position,title) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'Past experiences');
insert into skills (id,code,can_do,area,cefr_level) values ('40000000-0000-0000-0000-000000000001','GE-B1.SPK.01','Can describe past experiences in detail','speaking','B1'),('40000000-0000-0000-0000-000000000002','GE-C1.WRI.01','Can write a formal report','writing','C1');
insert into module_skills values ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
insert into enrolments (id,student_id,programme_id) values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-000000000001'),('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-0000000000b2','20000000-0000-0000-0000-000000000001');
insert into teacher_assignments (enrolment_id,teacher_id) values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000a1');
select 'A1 assigning a student as teacher refused:';
insert into teacher_assignments (enrolment_id,teacher_id) values ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-0000000000b1');

begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
insert into skill_evidence (enrolment_id,skill_id,stage,note) values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','secure','Fluent anecdote');
select 'A2 teacher recorded evidence for own student';
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'A3 teacher evidence for NOT-their student refused:';
insert into skill_evidence (enrolment_id,skill_id,stage) values ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','secure'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'A4 skill outside programme refused:';
insert into skill_evidence (enrolment_id,skill_id,stage) values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','secure'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'A5 teacher sees enrolments: ' || count(*) from enrolments;
select 'A6 teacher cannot edit evidence:'; update skill_evidence set stage='introduced'; rollback;

-- admin creates checkpoint
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-00000000000a';
select 'A7 own teacher as assessor refused:';
insert into checkpoints (enrolment_id,assessor_id) values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000a1'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-00000000000a';
insert into checkpoints (id,enrolment_id,module_id,assessor_id) values ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000a2');
select 'A8 independent checkpoint created'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
insert into checkpoint_skill_results values ('60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',true,'Confirmed in interview');
update checkpoints set status='completed', outcome='confirmed', summary='Good' where id='60000000-0000-0000-0000-000000000001';
select 'A9 assessor recorded result'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'A10 assessor re-pointing checkpoint refused:';
update checkpoints set enrolment_id='50000000-0000-0000-0000-000000000002'; rollback;
-- student views
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'A11 student progress: ' || skill_code || ' teacher=' || teacher_stage || ' checkpoint=' || checkpoint_confirmed from student_skill_progress;
select 'A12 student sees enrolments: ' || count(*) from enrolments;
select 'A13 student cannot add evidence:'; insert into skill_evidence (enrolment_id,skill_id,stage) values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','secure'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'A14 other student sees S progress rows: ' || count(*) from student_skill_progress where student_id='10000000-0000-0000-0000-0000000000b1'; rollback;
begin; set local role anon; select 'A15 anon reads programmes:'; select count(*) from programmes; rollback;

-- People helpers
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-00000000000a';
select 'P1 admin lists people: ' || count(*) from admin_list_people(); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'P2 teacher list people (expect error):'; select count(*) from admin_list_people(); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'P3 teacher sees profiles (self + own student = 2): ' || count(*) from profiles; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'P4 student sees profiles (self + teacher = 2): ' || count(*) from profiles; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'P5 unassigned student sees only self (1): ' || count(*) from profiles; rollback;
