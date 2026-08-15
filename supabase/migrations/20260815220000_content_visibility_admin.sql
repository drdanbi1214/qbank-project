-- 콘텐츠 가시성 5단계 — 관리 기능과 그에 필요한 잠금.
--
-- 4단계까지는 공개범위를 DB 에서 직접 바꿔야 했다. 이제 관리자 화면에서
-- 다루기 위해 쓰기 경로를 연다. 다만 그 전에 아무나 못 바꾸게 막는다.

-- ---------------------------------------------------------------------------
-- 1. 시험 공개범위는 관리자만 바꾼다
--
-- exams_update 정책이 can_write() 라, 승인된 사용자면 누구나 시험 행을
-- 고칠 수 있었다. 안 보이는 시험은 SELECT 정책에 막혀 손대지 못하지만,
-- 볼 수 있는 시험은 고칠 수 있다. 그래서 22학번 열람 권한을 받은
-- 사람이 그 잠금을 통째로 풀거나(실제로 5개 전부 풀리는 것을 확인했다),
-- 일반 사용자가 26학번을 잠가버릴 수 있었다.
--
-- 시험의 다른 정보는 그대로 편집할 수 있게 두고, 공개범위 컬럼만 막는다.
-- ---------------------------------------------------------------------------
create or replace function public.guard_exam_required_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.required_permission is distinct from old.required_permission
     and not public.is_admin() then
    raise exception '시험 공개범위는 관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists exams_guard_required_permission on public.exams;
create trigger exams_guard_required_permission
  before update on public.exams
  for each row execute function public.guard_exam_required_permission();

-- ---------------------------------------------------------------------------
-- 2. 권한(스터디 그룹) 추가·수정
--
-- 지금까지 access_permissions 에는 읽기 정책만 있어서 서비스 키로만
-- 손댈 수 있었다. 스터디를 하나 만들 때마다 DB 에 직접 넣어야 했다.
--
-- 지우기는 열지 않는다. 이미 그 권한으로 쓴 풀이나 잠긴 시험이 있으면
-- 외래키에 막혀 실패하는데, 화면에서 그 실패를 설명하기가 애매하다.
-- 안 쓰는 권한은 남겨둬도 해가 없다.
-- ---------------------------------------------------------------------------
drop policy if exists access_permissions_insert on public.access_permissions;
create policy access_permissions_insert on public.access_permissions
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists access_permissions_update on public.access_permissions;
create policy access_permissions_update on public.access_permissions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
