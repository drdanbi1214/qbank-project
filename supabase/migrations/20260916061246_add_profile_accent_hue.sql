-- 마이페이지에서 포인트 색(핑크·노랑 등)을 직접 고를 수 있게 한다.
-- 채도·명도는 기존 브랜드 컬러 램프(oklch L/C)를 그대로 쓰고 색상각(H)만
-- 0~359도 범위에서 바꾼다. 기본값 254는 지금 쓰는 파란색.

begin;

alter table public.profiles
  add column if not exists accent_hue integer not null default 254;

alter table public.profiles
  drop constraint if exists profiles_accent_hue_check;

alter table public.profiles
  add constraint profiles_accent_hue_check
  check (accent_hue >= 0 and accent_hue < 360);

grant update (accent_hue) on public.profiles to authenticated;

comment on column public.profiles.accent_hue is
  '포인트 색의 oklch 색상각(0~359). 나머지 밝기/채도는 고정된 브랜드 램프를 그대로 쓴다.';

commit;
