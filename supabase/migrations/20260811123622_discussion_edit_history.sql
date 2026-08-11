-- 게시글 수정 이력: "수정됨" 표시와 이전 버전 보기를 위해
-- content_edited_at 은 updateDiscussion() 이 명시적으로 채우는 컬럼이다.
-- updated_at 은 조회수/댓글수 증가 등으로도 계속 바뀌므로 "수정됨" 판단에 못 쓴다.
alter table public.discussions add column content_edited_at timestamptz;

create table public.discussion_revisions (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  title text not null,
  category text not null,
  content jsonb not null,
  confusion_point text,
  edited_at timestamptz not null default now()
);

create index discussion_revisions_discussion_idx
  on public.discussion_revisions (discussion_id, edited_at desc);

alter table public.discussion_revisions enable row level security;

-- 게시글을 볼 수 있으면 이전 버전도 볼 수 있다 (discussions_select 와 동일하게 공개)
create policy "discussion_revisions_select" on public.discussion_revisions
  for select to authenticated using (true);

-- 수정 권한이 있는 사람(작성자 또는 관리자)만 수정 직전 스냅샷을 남길 수 있다
create policy "discussion_revisions_insert" on public.discussion_revisions
  for insert to authenticated with check (
    exists (
      select 1 from public.discussions d
      where d.id = discussion_id
        and (d.author_id = auth.uid() or public.is_admin())
    )
  );

-- 게시글 삭제는 이제 관리자만 할 수 있다 (기존: 작성자 또는 관리자)
drop policy "discussions_delete" on public.discussions;
create policy "discussions_delete" on public.discussions
  for delete to authenticated using (public.is_admin());
