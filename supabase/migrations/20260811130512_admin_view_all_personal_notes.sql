-- 관리자가 문항별로 다른 사람들의 개인 메모를 함께 볼 수 있도록 허용한다.
-- 기존 personal_notes_all_own 은 본인 행에 대한 ALL(조회/쓰기/삭제)을 이미
-- 보장하므로, 관리자용 SELECT 정책만 별도로 추가한다.
create policy "personal_notes_admin_select" on public.personal_notes
  for select to authenticated using (public.is_admin());
