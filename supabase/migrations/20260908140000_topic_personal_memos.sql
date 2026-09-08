-- 레옵스 글의 선택 구간에 계정별 개인 메모를 남긴다.
-- SELECT 정책부터 auth.uid() 본인 행으로 제한하여 관리자도 다른 사람의 메모는
-- 일반 클라이언트에서 볼 수 없다.

begin;

create table if not exists public.topic_memos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  topic_id      uuid not null references public.topics(id) on delete cascade,
  anchor_from   int not null,
  anchor_to     int not null,
  selected_text text not null default '',
  plain_text    text not null default '',
  content       jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  color         text not null default 'yellow',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint topic_memos_range_check check (anchor_to > anchor_from),
  constraint topic_memos_plain_text_size_check check (length(plain_text) <= 10000),
  constraint topic_memos_content_size_check check (octet_length(content::text) <= 1000000),
  constraint topic_memos_color_check check (color in ('yellow', 'rose', 'green', 'blue', 'violet'))
);

create index if not exists topic_memos_lookup_idx
  on public.topic_memos (user_id, topic_id, anchor_from, created_at);

drop trigger if exists topic_memos_set_updated_at on public.topic_memos;
create trigger topic_memos_set_updated_at
  before update on public.topic_memos
  for each row execute function public.set_updated_at();

alter table public.topic_memos enable row level security;

revoke all on table public.topic_memos from anon;
grant select, insert, update, delete on table public.topic_memos to authenticated;

drop policy if exists topic_memos_select_own on public.topic_memos;
create policy topic_memos_select_own on public.topic_memos
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists topic_memos_insert_own on public.topic_memos;
create policy topic_memos_insert_own on public.topic_memos
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_write()
    and exists (
      select 1
      from public.topics t
      where t.id = topic_id
        and public.can_edit_topic(t.required_permission)
    )
  );

drop policy if exists topic_memos_update_own on public.topic_memos;
create policy topic_memos_update_own on public.topic_memos
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_write());

drop policy if exists topic_memos_delete_own on public.topic_memos;
create policy topic_memos_delete_own on public.topic_memos
  for delete to authenticated
  using (user_id = auth.uid() and public.can_write());

alter table public.text_marks
  drop constraint if exists text_marks_target_type_check;

alter table public.text_marks
  add constraint text_marks_target_type_check
  check (target_type in (
    'question',
    'explanation',
    'solution',
    'ai_solution',
    'senior_solution',
    'theory',
    'lecture_note',
    'topic'
  ));

commit;
