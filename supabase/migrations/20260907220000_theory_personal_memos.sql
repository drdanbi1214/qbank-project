-- 알렌 본문에서 선택한 구간에 사용자별 개인 메모를 남긴다.
-- 메모와 첨부 이미지 경로는 계정에 저장되며 RLS로 본인 행만 보인다.

begin;

create table public.theory_memos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  document_id   uuid not null references public.theory_documents(id) on delete cascade,
  anchor_from   int not null,
  anchor_to     int not null,
  selected_text text not null default '',
  body          text not null default '',
  image_paths   text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint theory_memos_range_check check (anchor_to > anchor_from),
  constraint theory_memos_body_size_check check (length(body) <= 10000),
  constraint theory_memos_image_count_check check (cardinality(image_paths) <= 12)
);

create index theory_memos_lookup_idx
  on public.theory_memos (user_id, document_id, anchor_from, created_at);

create trigger theory_memos_set_updated_at
  before update on public.theory_memos
  for each row execute function public.set_updated_at();

alter table public.theory_memos enable row level security;

revoke all on table public.theory_memos from anon;
grant select, insert, update, delete on table public.theory_memos to authenticated;

create policy theory_memos_select_own on public.theory_memos
  for select to authenticated
  using (user_id = auth.uid());

create policy theory_memos_insert_own on public.theory_memos
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_write()
    and exists (
      select 1 from public.theory_documents d
      where d.id = document_id
        and d.is_published
        and public.is_active_member()
    )
  );

create policy theory_memos_update_own on public.theory_memos
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_write());

create policy theory_memos_delete_own on public.theory_memos
  for delete to authenticated
  using (user_id = auth.uid() and public.can_write());

commit;
