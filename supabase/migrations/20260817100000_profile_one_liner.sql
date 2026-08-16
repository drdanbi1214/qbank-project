-- 프로필 목록 화면에서 보여줄 한마디(짧은 상태 메시지).
alter table public.profiles
  add column if not exists one_liner text;

alter table public.profiles
  add constraint profiles_one_liner_length check (one_liner is null or char_length(one_liner) <= 60);

grant update (one_liner) on public.profiles to authenticated;
