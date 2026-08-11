-- =============================================================================
-- 협업 콘텐츠 — 풀이, 개인노트, 임시저장, 인라인 코멘트, 게시판, 정답 투표
--
-- 풀이/노트/게시판 연결 규칙: 그룹이 있으면 group_id, 없으면 question_id.
-- 두 컬럼 모두 NULL 인 행은 허용하지 않는다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.9 풀이 및 노트
-- -----------------------------------------------------------------------------

create table public.solutions (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.question_groups(id) on delete cascade,
  question_id  uuid references public.questions(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  content      jsonb not null,                          -- Tiptap JSON
  "references" jsonb check ("references" is null or jsonb_typeof("references") = 'array'),
  is_verified  boolean not null default false,
  upvote_count int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  edited_at    timestamptz,                             -- 최초 작성 후 수정된 경우에만 기록
  constraint solutions_target_check check (group_id is not null or question_id is not null)
);

create index solutions_group_idx on public.solutions (group_id) where group_id is not null;
create index solutions_question_idx on public.solutions (question_id) where question_id is not null;
create index solutions_author_idx on public.solutions (author_id);
create index solutions_rank_idx on public.solutions (upvote_count desc, created_at desc);

create trigger solutions_set_updated_at
  before update on public.solutions
  for each row execute function public.set_updated_at();

create table public.solution_upvotes (
  solution_id uuid not null references public.solutions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (solution_id, user_id)
);

create index solution_upvotes_user_idx on public.solution_upvotes (user_id);

create table public.personal_notes (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.question_groups(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint personal_notes_target_check check (group_id is not null or question_id is not null)
);

-- UNIQUE(user_id, COALESCE(group_id, question_id))
create unique index personal_notes_user_target_idx
  on public.personal_notes (user_id, coalesce(group_id, question_id));

create trigger personal_notes_set_updated_at
  before update on public.personal_notes
  for each row execute function public.set_updated_at();

-- 작성 중 임시저장 (풀이/노트/게시판 공용)
create table public.drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('solution', 'note', 'discussion')),
  target_key  text not null,                            -- question_id 또는 group_id
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, target_type, target_key)
);

create trigger drafts_set_updated_at
  before update on public.drafts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.10 인라인 코멘트 (드래그 지정 코멘트)
-- -----------------------------------------------------------------------------

create table public.inline_comments (
  id            uuid primary key default gen_random_uuid(),
  solution_id   uuid not null references public.solutions(id) on delete cascade,
  parent_id     uuid references public.inline_comments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  selected_text text,
  anchor_from   int,
  anchor_to     int,
  content       text not null,
  status        text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by   uuid references public.profiles(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index inline_comments_solution_idx on public.inline_comments (solution_id, created_at);
create index inline_comments_parent_idx on public.inline_comments (parent_id);

create trigger inline_comments_set_updated_at
  before update on public.inline_comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.11 게시판 (문의/논의)
-- -----------------------------------------------------------------------------

create table public.discussions (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid references public.questions(id) on delete set null,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  category        text not null default '일반'
    check (category in ('정답이의', '해설질문', '단원분류', '복기오류', '일반')),
  title           text not null,
  content         jsonb not null,
  confusion_point text,                                 -- 헷갈리는 이유
  status          text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by     uuid references public.profiles(id) on delete set null,
  view_count      int not null default 0,
  upvote_count    int not null default 0,
  reply_count     int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index discussions_question_idx on public.discussions (question_id, created_at desc);
create index discussions_category_idx on public.discussions (category, created_at desc);
create index discussions_author_idx on public.discussions (author_id);
create index discussions_recent_idx on public.discussions (created_at desc);

create trigger discussions_set_updated_at
  before update on public.discussions
  for each row execute function public.set_updated_at();

create table public.discussion_replies (
  id            uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  parent_id     uuid references public.discussion_replies(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  content       jsonb not null,
  is_accepted   boolean not null default false,
  upvote_count  int not null default 0,
  is_deleted    boolean not null default false,         -- 대댓글 달린 댓글은 물리삭제 대신 플래그
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index discussion_replies_discussion_idx on public.discussion_replies (discussion_id, created_at);
create index discussion_replies_parent_idx on public.discussion_replies (parent_id);
create index discussion_replies_author_idx on public.discussion_replies (author_id);

create trigger discussion_replies_set_updated_at
  before update on public.discussion_replies
  for each row execute function public.set_updated_at();

create table public.discussion_upvotes (
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (discussion_id, user_id)
);

create index discussion_upvotes_user_idx on public.discussion_upvotes (user_id);

create table public.reply_upvotes (
  reply_id   uuid not null references public.discussion_replies(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id)
);

create index reply_upvotes_user_idx on public.reply_upvotes (user_id);

create table public.discussion_bookmarks (
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (discussion_id, user_id)
);

create index discussion_bookmarks_user_idx on public.discussion_bookmarks (user_id);

-- -----------------------------------------------------------------------------
-- 2.12 정답 투표 (미확정 문제용)
-- -----------------------------------------------------------------------------

create table public.answer_votes (
  question_id  uuid not null references public.questions(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  voted_answer int[] not null,
  reason       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (question_id, user_id)
);

create trigger answer_votes_set_updated_at
  before update on public.answer_votes
  for each row execute function public.set_updated_at();
