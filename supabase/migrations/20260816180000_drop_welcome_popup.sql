-- 안내 팝업 기능 제거. 화면(WelcomePopup 컴포넌트)에 이어 DB 쪽도 정리한다.
drop function if exists public.dismiss_welcome_popup();

alter table public.profiles
  drop column if exists welcome_popup_dismissed;
