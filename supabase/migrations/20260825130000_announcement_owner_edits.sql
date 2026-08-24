-- 스터디 공지도 작성자 본인 또는 관리자만 수정·삭제할 수 있게 한다.
-- 기존 정책은 같은 권한을 가진 구성원 누구나 다른 사람의 공지를 바꿀 수 있었다.

begin;

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (
    public.is_admin()
    or (
      author_id = auth.uid()
      and required_permission is not null
      and public.has_permission(required_permission)
    )
  )
  with check (
    public.is_admin()
    or (
      author_id = auth.uid()
      and required_permission is not null
      and public.has_permission(required_permission)
    )
  );

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (
    public.is_admin()
    or (
      author_id = auth.uid()
      and required_permission is not null
      and public.has_permission(required_permission)
    )
  );

commit;
