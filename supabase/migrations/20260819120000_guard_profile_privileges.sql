-- =============================================================================
-- 프로필 권한 컬럼 자체 변경 차단
--
-- profiles 의 UPDATE 정책은 profiles_update_own, 즉 `id = auth.uid()` 뿐이고
-- 컬럼 제한이 없었다. 막는 트리거도 없어서 일반 멤버가 자기 행의 role 을
-- 'admin' 으로 바꿀 수 있었다. 그러면 is_admin() 을 쓰는 모든 게이트가 한꺼번에
-- 무너진다 — 야마 묶기(can_cluster), 관리자 화면, 시험 열람 범위까지.
--
-- 정책을 컬럼 단위로 쪼갤 수는 없으므로 트리거로 막는다. 역할과 정지 상태는
-- 이미 admin_set_role / admin_set_suspended RPC 를 통하게 되어 있고, 그 함수들은
-- 관리자가 호출하므로 아래 검사를 그대로 통과한다.
-- =============================================================================

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- 권한과 무관한 컬럼(닉네임, 글자 크기, 테마, 접기 설정 등)은 그대로 통과시킨다.
  if new.role is not distinct from old.role
     and new.is_suspended is not distinct from old.is_suspended then
    return new;
  end if;

  -- auth.uid() 가 없는 경로는 서버 측(service_role, 마이그레이션, 콘솔)이다.
  -- 이쪽은 어차피 RLS 를 넘어서므로 여기서 막을 대상이 아니다. 로그인한
  -- 사용자는 항상 JWT 의 sub 가 있으므로 이 분기로 빠지지 않는다.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    raise exception '역할과 정지 상태는 관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_privileges() is
  'profiles.role / is_suspended 를 관리자 외에는 바꾸지 못하게 막는다. 자기 자신도 못 올린다.';

drop trigger if exists profiles_guard_privileges on public.profiles;

create trigger profiles_guard_privileges
before update on public.profiles
for each row
execute function public.guard_profile_privileges();
