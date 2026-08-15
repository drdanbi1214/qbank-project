-- 잠긴 학번에 새로 만든 시험이 전체공개로 새는 것을 막는다.
--
-- 3단계에서 22·23학번 시험에 공개범위를 걸었지만, 그것은 그 시점에
-- 존재하던 시험에만 적용된 일회성 UPDATE 였다. 그 뒤에 같은 학번으로
-- 시험을 새로 만들면 required_permission 이 null 이라 전체공개가 된다.
--
-- 실제로 22학번 신경과(47문제)가 그렇게 만들어져 권한 없는 사용자에게
-- 그대로 노출되고 있었다.

-- ---------------------------------------------------------------------------
-- 0. 공개범위 가드가 서비스 컨텍스트를 막지 않게 한다
--
-- 5단계의 가드는 로그인한 사용자를 막으려고 만든 것인데, auth.uid() 가
-- 없는 경우(서비스 롤, 마이그레이션, psql)까지 막아서 이 마이그레이션
-- 자신이 걸렸다. 사용자 요청이 아닐 때는 통과시킨다.
-- ---------------------------------------------------------------------------
create or replace function public.guard_exam_required_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.required_permission is distinct from old.required_permission
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception '시험 공개범위는 관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. 이미 샌 시험을 잠근다
-- ---------------------------------------------------------------------------
update public.exams e
   set required_permission = (
     select e2.required_permission
       from public.exams e2
      where e2.cohort = e.cohort
        and e2.required_permission is not null
      group by e2.required_permission
      order by count(*) desc
      limit 1
   )
 where e.required_permission is null
   and exists (
     select 1 from public.exams e3
      where e3.cohort = e.cohort
        and e3.required_permission is not null
   );

-- ---------------------------------------------------------------------------
-- 2. 앞으로 만드는 시험은 같은 학번의 공개범위를 물려받는다
--
-- 그 학번에 잠긴 시험이 하나라도 있으면 새 시험도 같은 값으로 시작한다.
-- 일부러 전체공개로 두려면 관리자가 공개 범위 관리 화면에서 풀면 된다.
-- 모르고 빠뜨렸을 때 열리는 것보다 잠기는 쪽이 안전하다.
-- ---------------------------------------------------------------------------
create or replace function public.default_exam_required_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inherited text;
begin
  if new.required_permission is null then
    select e.required_permission into inherited
      from public.exams e
     where e.cohort = new.cohort
       and e.required_permission is not null
     group by e.required_permission
     order by count(*) desc
     limit 1;

    if inherited is not null then
      new.required_permission := inherited;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists exams_default_required_permission on public.exams;
create trigger exams_default_required_permission
  before insert on public.exams
  for each row execute function public.default_exam_required_permission();
