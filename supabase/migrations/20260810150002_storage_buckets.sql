-- =============================================================================
-- Storage 버킷 및 정책
--
-- 폐쇄형 플랫폼이므로 모든 버킷을 비공개로 두고 로그인 사용자만 읽을 수 있게 한다.
-- 클라이언트는 createSignedUrl 로 이미지를 표시한다.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('question-images', 'question-images', false, 10485760,
   array['image/webp', 'image/png', 'image/jpeg', 'image/gif']),
  ('solution-images', 'solution-images', false, 10485760,
   array['image/webp', 'image/png', 'image/jpeg', 'image/gif']),
  ('exam-sources', 'exam-sources', false, 104857600,
   array['application/pdf'])
on conflict (id) do nothing;

create policy "qbank_storage_read" on storage.objects
  for select to authenticated
  using (bucket_id in ('question-images', 'solution-images', 'exam-sources'));

create policy "qbank_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('question-images', 'solution-images', 'exam-sources')
    and public.can_write()
  );

create policy "qbank_storage_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('question-images', 'solution-images', 'exam-sources')
    and public.can_write()
    and (owner = auth.uid() or public.is_admin())
  );

create policy "qbank_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('question-images', 'solution-images', 'exam-sources')
    and (owner = auth.uid() or public.is_admin())
  );
