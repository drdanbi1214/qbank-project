-- =============================================================================
-- 테마 이미지 버킷
--
-- 기존 버킷은 둘 다 못 쓴다.
--   theory-images   : 업로드가 is_admin() 전용이고 읽기가 study_hapbon3 다.
--                     레전드옵세 스터디원이 올리지도 보지도 못한다.
--   solution-images : 읽기가 can_read_solution_image(name) 로 풀이에 묶여 있어
--                     테마 본문에 넣은 이미지는 올린 사람 외에는 안 보인다.
--
-- 그래서 테마 전용 버킷을 따로 둔다. 읽기·쓰기 모두 레전드옵세 스터디원과
-- 관리자에게 연다.
--
-- 나중에 다른 스터디도 테마를 쓰게 되면(topics.required_permission 이 다른 값이
-- 되면) 아래 정책의 권한 키를 함께 넓혀야 한다. 스토리지 정책은 객체가 어느
-- 테마에 속하는지 알 수 없어 테마별로 나눌 수가 없다.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('topic-images', 'topic-images', false)
on conflict (id) do nothing;

drop policy if exists topic_images_select on storage.objects;
create policy topic_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'topic-images'
    and (public.is_admin() or public.has_permission('study_legendob'))
  );

drop policy if exists topic_images_insert on storage.objects;
create policy topic_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'topic-images'
    and (public.is_admin() or public.has_permission('study_legendob'))
  );

drop policy if exists topic_images_update on storage.objects;
create policy topic_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'topic-images'
    and (public.is_admin() or owner = auth.uid())
  )
  with check (
    bucket_id = 'topic-images'
    and (public.is_admin() or owner = auth.uid())
  );

drop policy if exists topic_images_delete on storage.objects;
create policy topic_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'topic-images'
    and (public.is_admin() or owner = auth.uid())
  );
