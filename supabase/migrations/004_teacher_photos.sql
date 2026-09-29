-- =====================================================================
-- MILEO — Migration 004: teacher profile photos (Supabase Storage)
--
-- HOW TO RUN (once, after 003):
--   Supabase → SQL Editor → New query → paste this whole file → Run.
--   Safe to run twice.
--
-- WHAT IT DOES
--   • Creates a storage folder (bucket) "teacher-photos".
--     Photos are PUBLIC to view (they appear on public teacher profiles).
--   • Max 2 MB per file; only JPEG, PNG or WebP. The website already
--     shrinks photos to about 100–200 KB before uploading.
--   • Each teacher can only add, replace or delete files inside their own
--     folder (named after their account id). Admins can manage all.
--   • Students and visitors cannot upload anything.
-- =====================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-photos', 'teacher-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "teacher photos: see own folder" on storage.objects;
create policy "teacher photos: see own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'teacher-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "teacher photos: upload to own folder" on storage.objects;
create policy "teacher photos: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'teacher-photos'
              and (((storage.foldername(name))[1] = auth.uid()::text and public.my_role() = 'teacher')
                   or public.is_admin()));

drop policy if exists "teacher photos: replace own" on storage.objects;
create policy "teacher photos: replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'teacher-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))
  with check (bucket_id = 'teacher-photos'
              and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "teacher photos: delete own" on storage.objects;
create policy "teacher photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'teacher-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

commit;
