-- =============================================================================
-- 닉네임 공백 금지를 DB 에서도 강제
-- 가입 화면에서만 막으면 프로필 수정 경로로 우회할 수 있다.
-- =============================================================================

alter table public.profiles
  drop constraint if exists profiles_display_name_length;

alter table public.profiles
  add constraint profiles_display_name_format
    check (
      char_length(btrim(display_name)) between 2 and 20
      and display_name !~ '\s'
    );

create or replace function public.is_display_name_available(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select char_length(btrim(p_name)) between 2 and 20
     and btrim(p_name) !~ '\s'
     and not exists (
       select 1 from public.profiles where lower(display_name) = lower(btrim(p_name))
     );
$$;
