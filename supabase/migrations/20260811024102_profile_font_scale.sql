-- =============================================================================
-- 본문 글자 크기 배율
--
-- 테마와 같은 이유로 계정에 저장한다. 기기를 바꿔도 같은 크기로 보인다.
-- 0.85 ~ 1.4 사이만 허용해 레이아웃이 무너지지 않게 한다.
-- =============================================================================
alter table public.profiles
  add column if not exists font_scale real not null default 1.0;

alter table public.profiles
  drop constraint if exists profiles_font_scale_range;

alter table public.profiles
  add constraint profiles_font_scale_range
  check (font_scale >= 0.85 and font_scale <= 1.4);

-- 본인 프로필의 표시 설정에 포함시킨다.
grant update (font_scale) on public.profiles to authenticated;
