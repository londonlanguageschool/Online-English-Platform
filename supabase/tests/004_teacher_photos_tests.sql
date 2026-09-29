-- Tests for migration 004. Run locally after: stubs (00, 00b), migrations 001-004.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users (id,email) values ('80000000-0000-0000-0000-0000000000a1','t@x'),('80000000-0000-0000-0000-0000000000b1','s@x');
update profiles set role='teacher' where id='80000000-0000-0000-0000-0000000000a1';
begin; set local role authenticated; set local request.jwt.claim.sub='80000000-0000-0000-0000-0000000000a1';
insert into storage.objects (bucket_id,name) values ('teacher-photos','80000000-0000-0000-0000-0000000000a1/photo-1.jpg');
select 'S1 teacher uploads to own folder: ok'; commit;
begin; set local role authenticated; set local request.jwt.claim.sub='80000000-0000-0000-0000-0000000000a1';
select 'S2 teacher uploads into someone else''s folder (expect error):';
insert into storage.objects (bucket_id,name) values ('teacher-photos','80000000-0000-0000-0000-0000000000b1/x.jpg'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='80000000-0000-0000-0000-0000000000b1';
select 'S3 student uploads to own folder (expect error):';
insert into storage.objects (bucket_id,name) values ('teacher-photos','80000000-0000-0000-0000-0000000000b1/x.jpg'); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='80000000-0000-0000-0000-0000000000b1';
select 'S4 student deletes teacher photo (expect 0 rows):'; delete from storage.objects where bucket_id='teacher-photos'; rollback;
select 'S5 photo still there: ' || count(*) from storage.objects;
begin; set local role authenticated; set local request.jwt.claim.sub='80000000-0000-0000-0000-0000000000a1';
delete from storage.objects where name like '80000000-0000-0000-0000-0000000000a1/%'; select 'S6 teacher deletes own: ' || count(*) || ' left' from storage.objects; rollback;
