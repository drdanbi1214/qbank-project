-- =============================================================================
-- 프로필 사진 버킷
--
-- 다른 버킷과 같은 이유로 비공개로 두고 서명 URL 로 표시한다.
-- 파일은 <user_id>/... 경로에만 올릴 수 있어 남의 사진을 덮어쓸 수 없다.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', false, 5242880,
  array['image/webp', 'image/png', 'image/jpeg', 'image/gif']
)
on conflict (id) do nothing;

-- 로그인한 사람은 모든 프로필 사진을 볼 수 있어야 한다 (풀이 작성자 표시).
create policy "avatars_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.can_write()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and public.can_write()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
