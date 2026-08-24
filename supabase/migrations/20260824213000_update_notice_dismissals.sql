-- 새 기능 안내에서 "다시 보지 않기"를 고른 기록을 계정별로 저장한다.
-- notice_key를 업데이트마다 바꾸므로 이전 안내를 숨긴 사용자에게도 새 안내는 뜬다.

begin;

create table if not exists public.update_notice_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notice_key text not null check (char_length(notice_key) between 1 and 100),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, notice_key)
);

alter table public.update_notice_dismissals enable row level security;

revoke all on table public.update_notice_dismissals from public, anon, authenticated;
grant select, insert on table public.update_notice_dismissals to authenticated;

drop policy if exists "update_notice_dismissals_select_own"
  on public.update_notice_dismissals;
create policy "update_notice_dismissals_select_own"
  on public.update_notice_dismissals
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "update_notice_dismissals_insert_own"
  on public.update_notice_dismissals;
create policy "update_notice_dismissals_insert_own"
  on public.update_notice_dismissals
  for insert to authenticated
  with check (public.can_write() and user_id = auth.uid());

comment on table public.update_notice_dismissals is
  '사용자가 다시 보지 않기로 한 버전별 업데이트 안내 기록';

commit;
