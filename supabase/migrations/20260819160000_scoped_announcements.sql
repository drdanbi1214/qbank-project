-- =============================================================================
-- 스터디별 공지사항
--
-- 지금까지 공지사항은 전체공개 하나뿐이었다(SELECT 정책이 true). 레옵스처럼
-- 스터디 안에서만 도는 공지를 올릴 수 있게 범위를 붙인다.
--
--   required_permission is null : 지금까지처럼 전체공개. 작성은 관리자만.
--   required_permission 이 있으면: 그 권한을 가진 사람만 읽고 쓴다.
--
-- 기존 행은 전부 null 이 되므로 동작이 그대로다.
-- =============================================================================

alter table public.announcements
  add column if not exists required_permission text
    references public.access_permissions(key);

comment on column public.announcements.required_permission is
  '이 공지를 볼 수 있는 권한. null 이면 전체공개이며 작성은 관리자만 가능하다.';

create index if not exists announcements_permission_idx
  on public.announcements (required_permission);


-- 읽기: 전체공개거나, 그 권한을 가졌거나, 관리자.
-- has_content_access 는 null 을 전체공개로 처리한다.
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (public.is_admin() or public.has_content_access(required_permission));


-- 쓰기: 전체공개 공지는 지금처럼 관리자만. 스터디 공지는 그 스터디원이 관리한다.
-- 자기 스터디 공지를 쓰려고 관리자를 부를 일은 없어야 한다.
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.is_admin()
      or (required_permission is not null and public.has_permission(required_permission))
    )
  );

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (
    public.is_admin()
    or (required_permission is not null and public.has_permission(required_permission))
  )
  with check (
    public.is_admin()
    or (required_permission is not null and public.has_permission(required_permission))
  );

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (
    public.is_admin()
    or (required_permission is not null and public.has_permission(required_permission))
  );
