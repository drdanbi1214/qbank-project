-- 안내 팝업은 한 번 숨기면 다시 false로 돌아갈 필요가 없는 단방향 설정이다.
-- 일반 profiles update가 RLS에서 0행 처리돼도 클라이언트가 성공으로 오인할 수
-- 있으므로, 로그인한 본인 행을 확실히 갱신하고 결과를 반환하는 RPC로 둔다.
create or replace function public.dismiss_welcome_popup()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  update public.profiles
     set welcome_popup_dismissed = true
   where id = auth.uid();

  if not found then
    raise exception '프로필을 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;

  return true;
end;
$$;

revoke execute on function public.dismiss_welcome_popup() from public, anon;
grant execute on function public.dismiss_welcome_popup() to authenticated;
