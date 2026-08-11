-- =============================================================================
-- 학습 기록, 배정, 편집 이력, 알림, 공지사항, 신고
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.13 학습 기록
-- attempts / bookmarks 는 그룹이 아니라 개별 question_id 기준으로 유지한다.
-- -----------------------------------------------------------------------------

create table public.attempts (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references public.questions(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  selected_answer int[] not null default '{}'::int[],
  is_correct      boolean,
  self_grade      text check (self_grade is null or self_grade in ('correct', 'partial', 'wrong')),
  time_spent_sec  int,
  attempt_number  int not null default 1,
  is_active       boolean not null default true,        -- 진행 초기화 시 false. 물리삭제 금지
  created_at      timestamptz not null default now()
);

create index attempts_user_question_idx on public.attempts (user_id, question_id, created_at desc);
create index attempts_active_idx on public.attempts (user_id, question_id) where is_active;
create index attempts_question_idx on public.attempts (question_id) where is_active;

create table public.bookmarks (
  question_id uuid not null references public.questions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (question_id, user_id)
);

create index bookmarks_user_idx on public.bookmarks (user_id, created_at desc);

create table public.study_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  mode           text not null check (mode in ('sequential', 'block_test', 'wrong_only', 'bookmark')),
  scope          jsonb not null default '{}'::jsonb,    -- { subject_id, unit_ids, exam_ids, cohorts }
  question_ids   uuid[] not null default '{}'::uuid[],
  current_index  int not null default 0,
  time_limit_sec int,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index study_sessions_user_idx on public.study_sessions (user_id, started_at desc);
create index study_sessions_resume_idx on public.study_sessions (user_id, started_at desc)
  where status = 'in_progress';

create trigger study_sessions_set_updated_at
  before update on public.study_sessions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.14 배정 (담당자 분배)
-- -----------------------------------------------------------------------------

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  assignee_id  uuid not null references public.profiles(id) on delete cascade,
  assigned_by  uuid references public.profiles(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  due_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (question_id, assignee_id)
);

create index assignments_assignee_idx on public.assignments (assignee_id, status);
create index assignments_question_idx on public.assignments (question_id);
create index assignments_due_idx on public.assignments (due_date) where status <> 'done';

create trigger assignments_set_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.15 편집 이력
-- -----------------------------------------------------------------------------

create table public.revisions (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text not null check (entity_type in ('question', 'solution')),
  entity_id      uuid not null,
  editor_id      uuid references public.profiles(id) on delete set null,
  diff           jsonb not null default '{}'::jsonb,    -- { field: { before, after } }
  change_summary text,
  created_at     timestamptz not null default now()
);

create index revisions_entity_idx on public.revisions (entity_type, entity_id, created_at desc);
create index revisions_feed_idx on public.revisions (created_at desc);
create index revisions_editor_idx on public.revisions (editor_id);

-- -----------------------------------------------------------------------------
-- 2.16 알림
-- -----------------------------------------------------------------------------

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in (
                'solution_comment', 'inline_comment', 'comment_reply', 'mention',
                'solution_upvote', 'assignment', 'comment_resolved',
                'discussion_reply', 'answer_accepted', 'announcement')),
  actor_id    uuid references public.profiles(id) on delete set null,
  target_type text,
  target_id   uuid,
  message     text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where is_read = false;

-- -----------------------------------------------------------------------------
-- 2.17 공지사항 / 신고
-- -----------------------------------------------------------------------------

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid references public.profiles(id) on delete set null,
  title      text not null,
  content    jsonb not null,
  is_pinned  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_list_idx on public.announcements (is_pinned desc, created_at desc);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_type text not null check (target_type in ('question', 'solution', 'comment', 'discussion')),
  target_id   uuid not null,
  reason      text,
  status      text not null default 'pending' check (status in ('pending', 'in_progress', 'resolved')),
  handled_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index reports_status_idx on public.reports (status, created_at desc);

create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();
