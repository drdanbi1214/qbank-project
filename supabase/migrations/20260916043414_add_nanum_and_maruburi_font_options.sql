-- font/ 폴더에 새로 받은 마루부리·나눔 계열 글꼴을 테마 설정에서
-- 고를 수 있게 허용 목록을 넓힌다.

begin;

alter table public.profiles
  drop constraint if exists profiles_font_family_check;

alter table public.profiles
  add constraint profiles_font_family_check
  check (font_family in (
    'hamchorom',
    'hamchorom-batang',
    'ibm-plex-sans',
    'maruburi',
    'nanum-gothic',
    'nanum-myeongjo',
    'nanum-barun-gothic',
    'nanum-barun-pen',
    'nanum-brush',
    'nanum-pen',
    'nanum-square',
    'nanum-square-round',
    'nanum-human',
    'nanum-square-neo'
  ));

comment on column public.profiles.font_family is
  '사이트 본문 글꼴. hamchorom(함초롬체)·hamchorom-batang(함초롬바탕)·ibm-plex-sans(기존 글꼴)에 더해 '
  'maruburi(마루부리)와 나눔 계열(nanum-gothic/myeongjo/barun-gothic/barun-pen/brush/pen/square/'
  'square-round/human/square-neo)을 고를 수 있다.';

commit;
