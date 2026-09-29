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

-- ===== Profiles, private preferences, suggestions =====
-- Users from above: admin a, teacher a1 (main teacher of student b1), teacher a2, student b1, student b2 (new, no teacher)
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
insert into teacher_profiles (teacher_id, headline, languages_taught) values ('10000000-0000-0000-0000-0000000000a1','IELTS specialist','{en}'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
insert into teacher_profiles (teacher_id, headline, languages_taught) values ('10000000-0000-0000-0000-0000000000a2','Conversation coach','{en}'); commit;
select 'R1 teachers created own profiles: ' || count(*) from teacher_profiles;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'R2 teacher edits another teacher''s profile (expect 0 rows):'; update teacher_profiles set headline='hacked' where teacher_id='10000000-0000-0000-0000-0000000000a1'; rollback;
select 'R2b headline unchanged: ' || headline from teacher_profiles where teacher_id='10000000-0000-0000-0000-0000000000a1';
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'R3 student creates a teacher profile (expect error):'; insert into teacher_profiles (teacher_id) values ('10000000-0000-0000-0000-0000000000b1'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'R4 unknown language (expect error):'; update teacher_profiles set languages_taught='{xx}' where teacher_id=auth.uid(); rollback;

begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
select 'R5 b1 suggestions (main teacher a1 excluded): ' || string_agg(headline, ', ') from recommend_teachers('en'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'R6 new student b2, fewer-students teacher first: ' || string_agg(headline, ' > ') from recommend_teachers('en'); rollback;

begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
insert into match_preferences (student_id, teacher_id, set_by, kind) values (auth.uid(), '10000000-0000-0000-0000-0000000000a2', 'student', 'prefer_not'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'R7 after prefer_not a2: ' || coalesce(string_agg(headline, ', '),'none') from recommend_teachers('en'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
insert into match_preferences (student_id, teacher_id, set_by, kind) values ('10000000-0000-0000-0000-0000000000b2', auth.uid(), 'teacher', 'declined'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'R8 after a1 declined b2: ' || coalesce(string_agg(headline, ', '),'none') from recommend_teachers('en');
select 'R9 b2 sees only own preference rows: ' || count(*) || ' (' || string_agg(kind::text, ',') || ')' from match_preferences; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'R10 a2 (the one b2 prefers not) sees: ' || count(*) from match_preferences; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'R11 student forges a teacher decline (expect error):'; insert into match_preferences (student_id, teacher_id, set_by, kind) values (auth.uid(), '10000000-0000-0000-0000-0000000000a2', 'teacher', 'declined'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'R12 student marks another student as favourite (expect error):'; insert into match_preferences (student_id, teacher_id, set_by, kind) values (auth.uid(), '10000000-0000-0000-0000-0000000000b1', 'student', 'favourite'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-00000000000a';
select 'R13 admin sees all preference rows: ' || count(*) from match_preferences; rollback;

begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b1';
insert into student_profiles (student_id, goals, level_self) values (auth.uid(), 'Speak at work', 'A2'); commit;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a1';
select 'R14 main teacher reads b1 learning profile: ' || count(*) from student_profiles; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000a2';
select 'R15 other teacher reads it (expect 0): ' || count(*) from student_profiles; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-0000-0000-0000000000b2';
select 'R16 other student reads it (expect 0): ' || count(*) from student_profiles;
select 'R17 minor without guardian email (expect error):'; insert into student_profiles (student_id, is_minor) values (auth.uid(), true); rollback;
begin; set local role anon;
select 'R18 anon suggestions (expect error):'; select * from recommend_teachers('en'); rollback;
