-- 기존 hamchorom 값은 올바른 기본 글꼴인 함초롬체를 뜻하도록 바로잡고,
-- 앞서 적용했던 함초롬바탕은 사용자가 다시 고를 수 있는 별도 옵션으로 남긴다.

begin;

alter table public.profiles
  drop constraint if exists profiles_font_family_check;

alter table public.profiles
  add constraint profiles_font_family_check
  check (font_family in ('hamchorom', 'hamchorom-batang', 'ibm-plex-sans'));

comment on column public.profiles.font_family is
  '사이트 본문 글꼴. hamchorom은 함초롬체, hamchorom-batang은 함초롬바탕, ibm-plex-sans는 기존 글꼴.';

commit;
