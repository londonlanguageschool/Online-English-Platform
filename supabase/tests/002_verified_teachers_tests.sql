-- Tests for migration 002. Run locally after: stub, 001, 002 (fresh database).
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users (id,email,email_confirmed_at) values
 ('70000000-0000-0000-0000-00000000000a','boss@x.com',now()),
 ('70000000-0000-0000-0000-0000000000c1','early@x.com',now()),
 ('70000000-0000-0000-0000-0000000000c2','unconfirmed@x.com',null);
update profiles set role='admin' where id='70000000-0000-0000-0000-00000000000a';
set role anon;
insert into teacher_applications (first_name,last_name,email,country,privacy_consent) values
 ('Early','Bird','Early@X.com','IT',true),('Late','Comer','late@x.com','IT',true),('Un','Confirmed','unconfirmed@x.com','IT',true),('Boss','Self','boss@x.com','IT',true);
reset role;

begin; set local role authenticated; set local request.jwt.claim.sub='70000000-0000-0000-0000-00000000000a';
update teacher_applications set status='screening';
update teacher_applications set status='interview';
update teacher_applications set status='verified';
commit;

select 'V1 confirmed account becomes teacher: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c1';
select 'V2 application linked: ' || (user_id is not null) from teacher_applications where email='early@x.com';
select 'V3 unconfirmed stays student: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c2';
select 'V4 admin untouched: ' || role from profiles where id='70000000-0000-0000-0000-00000000000a';

-- Late signs up later, then confirms
insert into auth.users (id,email) values ('70000000-0000-0000-0000-0000000000c3','LATE@x.com');
select 'V5 before confirming: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c3';
update auth.users set email_confirmed_at=now() where id='70000000-0000-0000-0000-0000000000c3';
select 'V6 after confirming: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c3';
update auth.users set email_confirmed_at=now() where id='70000000-0000-0000-0000-0000000000c2';
select 'V7 unconfirmed now confirms: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c2';
-- Created already confirmed (admin "Add user" with auto-confirm)
delete from teacher_applications where email='late@x.com';
insert into auth.users (id,email,email_confirmed_at) values ('70000000-0000-0000-0000-0000000000c4','nobody@x.com',now());
select 'V8 random confirmed user stays student: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c4';

-- Revoke
begin; set local role authenticated; set local request.jwt.claim.sub='70000000-0000-0000-0000-00000000000a';
update teacher_applications set status='rejected' where email='early@x.com';
commit;
select 'V9 revoked -> student: ' || role from profiles where id='70000000-0000-0000-0000-0000000000c1';

-- A teacher cannot promote themself or link an account
begin; set local role authenticated; set local request.jwt.claim.sub='70000000-0000-0000-0000-0000000000c2';
select 'V10 teacher sets own role (expect error):'; update profiles set role='admin' where id=auth.uid(); rollback;
begin; set local role authenticated; set local request.jwt.claim.sub='70000000-0000-0000-0000-00000000000a';
select 'V11 admin cannot write user_id directly (expect error):'; update teacher_applications set user_id='70000000-0000-0000-0000-00000000000a'; rollback;
