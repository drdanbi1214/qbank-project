-- 사이트 본문 글꼴을 계정마다 고를 수 있게 한다. 기존 계정도 새 기본값인
-- 함초롬체로 채우고, 설정에서 함초롬바탕이나 IBM Plex Sans KR로 바꿀 수 있다.

begin;

alter table public.profiles
  add column if not exists font_family text not null default 'hamchorom';

alter table public.profiles
  drop constraint if exists profiles_font_family_check;

alter table public.profiles
  add constraint profiles_font_family_check
  check (font_family in ('hamchorom', 'hamchorom-batang', 'ibm-plex-sans'));

grant update (font_family) on public.profiles to authenticated;

comment on column public.profiles.font_family is
  '사이트 본문 글꼴. hamchorom은 함초롬체, hamchorom-batang은 함초롬바탕, ibm-plex-sans는 기존 글꼴.';

commit;
