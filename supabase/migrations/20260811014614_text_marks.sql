-- =============================================================================
-- 형광펜 및 글자 강조
--
-- 사용자가 문제 본문, 원본 해설, 풀이에서 드래그해 남긴 표시를 계정에 저장한다.
-- 기기를 바꿔 로그인해도 그대로 보여야 하므로 localStorage 가 아니라 DB 에 둔다.
--
-- 위치는 렌더링 순서를 따라 계산한 문자 오프셋이다. 풀이는 ProseMirror 위치,
-- 문제 본문은 stem_blocks 를 순서대로 훑어 매긴 값이며 둘 다 클라이언트에서
-- 같은 규칙으로 다시 계산한다. 원문이 수정되면 어긋날 수 있어 selected_text 를
-- 함께 남겨 어떤 부분이었는지 확인할 수 있게 한다.
-- =============================================================================

create table public.text_marks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  target_type   text not null check (target_type in ('question', 'explanation', 'solution')),
  target_id     uuid not null,
  anchor_from   int not null,
  anchor_to     int not null,
  style         text not null check (style in ('yellow', 'green', 'sky', 'pink', 'red', 'bold')),
  selected_text text,
  created_at    timestamptz not null default now(),
  constraint text_marks_range_check check (anchor_to > anchor_from)
);

create index text_marks_lookup_idx
  on public.text_marks (user_id, target_type, target_id);

alter table public.text_marks enable row level security;

-- 본인 표시만 읽고 쓴다. 다른 사람의 형광펜은 보이지 않는다.
create policy "text_marks_all_own" on public.text_marks
  for all to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());
