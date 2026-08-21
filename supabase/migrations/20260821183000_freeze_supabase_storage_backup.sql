-- Freeze the migrated Supabase Storage copy as a read-only recovery snapshot.
--
-- Production uploads now go only to the private Cloudflare R2 gateway.  Keep
-- SELECT policies for the temporary read fallback, but remove every client
-- write policy.  Restrictive deny policies keep the snapshot immutable even
-- if a permissive write policy is accidentally added later.  The service_role
-- keeps BYPASSRLS access for an explicit, trusted recovery operation.

begin;

drop policy if exists qbank_storage_insert on storage.objects;
drop policy if exists qbank_storage_update on storage.objects;
drop policy if exists qbank_storage_delete on storage.objects;

drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

drop policy if exists theory_images_insert on storage.objects;
drop policy if exists theory_images_update on storage.objects;
drop policy if exists theory_images_delete on storage.objects;

drop policy if exists ai_solution_images_insert on storage.objects;
drop policy if exists ai_solution_images_update on storage.objects;
drop policy if exists ai_solution_images_delete on storage.objects;

drop policy if exists senior_solution_images_insert on storage.objects;
drop policy if exists senior_solution_images_update on storage.objects;
drop policy if exists senior_solution_images_delete on storage.objects;

drop policy if exists solution_lecture_files_write on storage.objects;
drop policy if exists solution_lecture_files_delete on storage.objects;

drop policy if exists topic_images_insert on storage.objects;
drop policy if exists topic_images_update on storage.objects;
drop policy if exists topic_images_delete on storage.objects;

drop policy if exists storage_backup_deny_insert on storage.objects;
create policy storage_backup_deny_insert on storage.objects
  as restrictive for insert to anon, authenticated
  with check (false);

drop policy if exists storage_backup_deny_update on storage.objects;
create policy storage_backup_deny_update on storage.objects
  as restrictive for update to anon, authenticated
  using (false) with check (false);

drop policy if exists storage_backup_deny_delete on storage.objects;
create policy storage_backup_deny_delete on storage.objects
  as restrictive for delete to anon, authenticated
  using (false);

commit;
