-- =============================================================================
-- 야마 그룹 삭제로 남의 글이 사라지지 않게 막기
--
-- question_groups 를 지우면 두 가지가 조용히 함께 사라졌다.
--   solutions.group_id      ON DELETE CASCADE  → 그 클러스터의 공유 해설 전부
--   personal_notes.group_id ON DELETE CASCADE  → 사람들이 쓴 개인 노트
--
-- 삭제 정책은 `is_admin() OR created_by = auth.uid()` 라 그룹을 만든 사람이면
-- 지울 수 있었다. 지금은 그룹을 지우는 화면이 없지만, 공유 해설이 쌓이기
-- 시작한 이상 정책만 열려 있는 것도 위험하다.
--
-- RESTRICT 로 바꾼다. 딸린 해설이나 노트가 있으면 그룹 삭제 자체가 실패한다.
-- 비어 있는 그룹은 그대로 지울 수 있어 정리에는 지장이 없다.
--
-- cluster_detach 가 그룹을 남기는 것도 같은 이유다 — 마지막 한 명이 빠져도
-- 그룹을 지우지 않아 공유 해설이 살아남는다.
-- =============================================================================

alter table public.solutions
  drop constraint if exists solutions_group_id_fkey;
alter table public.solutions
  add constraint solutions_group_id_fkey
  foreign key (group_id) references public.question_groups(id) on delete restrict;

alter table public.personal_notes
  drop constraint if exists personal_notes_group_id_fkey;
alter table public.personal_notes
  add constraint personal_notes_group_id_fkey
  foreign key (group_id) references public.question_groups(id) on delete restrict;

-- 그룹 삭제는 관리자만. 파괴적이고 드문 일이라 넓게 열어 둘 이유가 없다.
drop policy if exists question_groups_delete on public.question_groups;
create policy question_groups_delete on public.question_groups
  for delete to authenticated
  using (public.is_admin());

-- 참고: 그룹을 지우면 questions_group_id_fkey 가 questions.group_id 를 SET NULL 로
-- 건드리는데, 그 UPDATE 는 guard_cluster_columns 트리거를 지난다. 결과적으로
-- 관리자가 아니면 그룹 삭제 자체가 그 트리거에서 먼저 막힌다. 위 정책과 같은
-- 결론이라 문제는 없지만, 실패 메시지가 FK 가 아니라 가드에서 나온다.
