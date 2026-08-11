-- =============================================================================
-- RLS 정책
--
--  - 모든 테이블 RLS 활성화. anon(비로그인)에는 어떤 정책도 부여하지 않으므로
--    로그인하지 않으면 어떤 데이터도 조회할 수 없다.
--  - is_suspended = true 인 사용자는 can_write() 가 false 이므로 모든 쓰기가 막힌다.
--  - 관리자 판별은 SECURITY DEFINER 함수 is_admin() 으로 처리해 RLS 재귀를 피한다.
-- =============================================================================

alter table public.profiles             enable row level security;
alter table public.subjects             enable row level security;
alter table public.units                enable row level security;
alter table public.exams                enable row level security;
alter table public.question_sets        enable row level security;
alter table public.question_groups      enable row level security;
alter table public.questions            enable row level security;
alter table public.solutions            enable row level security;
alter table public.solution_upvotes     enable row level security;
alter table public.personal_notes       enable row level security;
alter table public.drafts               enable row level security;
alter table public.inline_comments      enable row level security;
alter table public.discussions          enable row level security;
alter table public.discussion_replies   enable row level security;
alter table public.discussion_upvotes   enable row level security;
alter table public.reply_upvotes        enable row level security;
alter table public.discussion_bookmarks enable row level security;
alter table public.answer_votes         enable row level security;
alter table public.attempts             enable row level security;
alter table public.bookmarks            enable row level security;
alter table public.study_sessions       enable row level security;
alter table public.assignments          enable row level security;
alter table public.revisions            enable row level security;
alter table public.notifications        enable row level security;
alter table public.announcements        enable row level security;
alter table public.reports              enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- 본인 프로필의 표시 정보만 수정 가능. role / is_suspended 는 관리자 RPC 로만 변경한다.
-- -----------------------------------------------------------------------------
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, cohort, avatar_url, theme) on public.profiles to authenticated;

create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 관리자 전용 계정 관리 RPC
create or replace function public.admin_set_suspended(p_user_id uuid, p_suspended boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;
  update public.profiles set is_suspended = p_suspended where id = p_user_id;
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception '알 수 없는 권한입니다.' using errcode = 'check_violation';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception '본인의 관리자 권한은 회수할 수 없습니다.' using errcode = 'check_violation';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 분류 체계 / 시험 / 세트 / 그룹 / 문제 — 위키형. 로그인 사용자가 직접 편집한다.
-- -----------------------------------------------------------------------------
create policy "subjects_select" on public.subjects
  for select to authenticated using (true);
create policy "subjects_insert" on public.subjects
  for insert to authenticated with check (public.can_write());
create policy "subjects_update" on public.subjects
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "subjects_delete" on public.subjects
  for delete to authenticated using (public.is_admin());

create policy "units_select" on public.units
  for select to authenticated using (true);
create policy "units_insert" on public.units
  for insert to authenticated with check (public.can_write());
create policy "units_update" on public.units
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "units_delete" on public.units
  for delete to authenticated using (public.is_admin());

create policy "exams_select" on public.exams
  for select to authenticated using (true);
create policy "exams_insert" on public.exams
  for insert to authenticated with check (public.can_write());
create policy "exams_update" on public.exams
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "exams_delete" on public.exams
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create policy "question_sets_select" on public.question_sets
  for select to authenticated using (true);
create policy "question_sets_insert" on public.question_sets
  for insert to authenticated with check (public.can_write());
create policy "question_sets_update" on public.question_sets
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "question_sets_delete" on public.question_sets
  for delete to authenticated using (public.is_admin());

create policy "question_groups_select" on public.question_groups
  for select to authenticated using (true);
create policy "question_groups_insert" on public.question_groups
  for insert to authenticated with check (public.can_write());
create policy "question_groups_update" on public.question_groups
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "question_groups_delete" on public.question_groups
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create policy "questions_select" on public.questions
  for select to authenticated using (true);
create policy "questions_insert" on public.questions
  for insert to authenticated with check (public.can_write());
create policy "questions_update" on public.questions
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "questions_delete" on public.questions
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

-- -----------------------------------------------------------------------------
-- 풀이 및 추천
-- -----------------------------------------------------------------------------
create policy "solutions_select" on public.solutions
  for select to authenticated using (true);
create policy "solutions_insert" on public.solutions
  for insert to authenticated with check (public.can_write() and author_id = auth.uid());
create policy "solutions_update" on public.solutions
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "solutions_delete" on public.solutions
  for delete to authenticated using (public.is_admin() or author_id = auth.uid());

create policy "solution_upvotes_select" on public.solution_upvotes
  for select to authenticated using (true);
create policy "solution_upvotes_insert" on public.solution_upvotes
  for insert to authenticated with check (public.can_write() and user_id = auth.uid());
create policy "solution_upvotes_delete" on public.solution_upvotes
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 개인 데이터 — 본인 행만
-- -----------------------------------------------------------------------------
create policy "personal_notes_all_own" on public.personal_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

create policy "drafts_all_own" on public.drafts
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

create policy "attempts_all_own" on public.attempts
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

create policy "bookmarks_all_own" on public.bookmarks
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

create policy "study_sessions_all_own" on public.study_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

create policy "discussion_bookmarks_all_own" on public.discussion_bookmarks
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

-- 알림: 본인 행 조회 및 읽음 처리. 생성은 트리거(SECURITY DEFINER)로만.
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 인라인 코멘트
-- 해결 처리는 코멘트 작성자, 풀이 작성자, 관리자가 할 수 있다.
-- -----------------------------------------------------------------------------
create policy "inline_comments_select" on public.inline_comments
  for select to authenticated using (true);
create policy "inline_comments_insert" on public.inline_comments
  for insert to authenticated with check (public.can_write() and author_id = auth.uid());
create policy "inline_comments_update" on public.inline_comments
  for update to authenticated
  using (
    public.can_write() and (
      author_id = auth.uid()
      or public.is_admin()
      or exists (select 1 from public.solutions s where s.id = solution_id and s.author_id = auth.uid())
    )
  )
  with check (public.can_write());
create policy "inline_comments_delete" on public.inline_comments
  for delete to authenticated using (public.is_admin() or author_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 게시판
-- -----------------------------------------------------------------------------
create policy "discussions_select" on public.discussions
  for select to authenticated using (true);
create policy "discussions_insert" on public.discussions
  for insert to authenticated with check (public.can_write() and author_id = auth.uid());
create policy "discussions_update" on public.discussions
  for update to authenticated
  using (public.can_write() and (author_id = auth.uid() or public.is_admin()))
  with check (public.can_write());
create policy "discussions_delete" on public.discussions
  for delete to authenticated using (public.is_admin() or author_id = auth.uid());

-- 답변 채택은 원글 작성자가 수행하므로 update 대상에 포함한다.
create policy "discussion_replies_select" on public.discussion_replies
  for select to authenticated using (true);
create policy "discussion_replies_insert" on public.discussion_replies
  for insert to authenticated with check (public.can_write() and author_id = auth.uid());
create policy "discussion_replies_update" on public.discussion_replies
  for update to authenticated
  using (
    public.can_write() and (
      author_id = auth.uid()
      or public.is_admin()
      or exists (select 1 from public.discussions d where d.id = discussion_id and d.author_id = auth.uid())
    )
  )
  with check (public.can_write());
create policy "discussion_replies_delete" on public.discussion_replies
  for delete to authenticated using (public.is_admin() or author_id = auth.uid());

create policy "discussion_upvotes_select" on public.discussion_upvotes
  for select to authenticated using (true);
-- 본인 글은 추천할 수 없다.
create policy "discussion_upvotes_insert" on public.discussion_upvotes
  for insert to authenticated
  with check (
    public.can_write() and user_id = auth.uid()
    and not exists (
      select 1 from public.discussions d where d.id = discussion_id and d.author_id = auth.uid()
    )
  );
create policy "discussion_upvotes_delete" on public.discussion_upvotes
  for delete to authenticated using (user_id = auth.uid());

create policy "reply_upvotes_select" on public.reply_upvotes
  for select to authenticated using (true);
create policy "reply_upvotes_insert" on public.reply_upvotes
  for insert to authenticated
  with check (
    public.can_write() and user_id = auth.uid()
    and not exists (
      select 1 from public.discussion_replies r where r.id = reply_id and r.author_id = auth.uid()
    )
  );
create policy "reply_upvotes_delete" on public.reply_upvotes
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 정답 투표 — 집계 표시를 위해 조회는 전체 공개, 쓰기는 본인 행만
-- -----------------------------------------------------------------------------
create policy "answer_votes_select" on public.answer_votes
  for select to authenticated using (true);
create policy "answer_votes_insert" on public.answer_votes
  for insert to authenticated with check (public.can_write() and user_id = auth.uid());
create policy "answer_votes_update" on public.answer_votes
  for update to authenticated using (user_id = auth.uid()) with check (public.can_write() and user_id = auth.uid());
create policy "answer_votes_delete" on public.answer_votes
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 배정 — 조회는 전체, 쓰기는 관리자만
-- -----------------------------------------------------------------------------
create policy "assignments_select" on public.assignments
  for select to authenticated using (true);
create policy "assignments_insert" on public.assignments
  for insert to authenticated with check (public.is_admin());
create policy "assignments_update" on public.assignments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "assignments_delete" on public.assignments
  for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 편집 이력 — 조회는 전체, INSERT 는 트리거(SECURITY DEFINER)로만
-- -----------------------------------------------------------------------------
create policy "revisions_select" on public.revisions
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 공지사항 — 조회는 전체, 쓰기는 관리자만
-- -----------------------------------------------------------------------------
create policy "announcements_select" on public.announcements
  for select to authenticated using (true);
create policy "announcements_insert" on public.announcements
  for insert to authenticated with check (public.is_admin() and author_id = auth.uid());
create policy "announcements_update" on public.announcements
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "announcements_delete" on public.announcements
  for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 신고 — 신고자 본인과 관리자만 조회. 처리는 관리자만.
-- -----------------------------------------------------------------------------
create policy "reports_select" on public.reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "reports_insert" on public.reports
  for insert to authenticated with check (public.can_write() and reporter_id = auth.uid());
create policy "reports_update" on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "reports_delete" on public.reports
  for delete to authenticated using (public.is_admin());
