-- cluster_attach 는 문제 둘을 처음 묶을 때 대표 문제에 달린 개별 풀이를
-- 새 그룹의 공유 풀이로 옮긴다. 이 작업은 can_cluster() 검사를 마친
-- SECURITY DEFINER 함수 안에서 app.cluster_write 플래그를 켠 동안에만 일어난다.
--
-- guard_solution_fields 가 그 내부 이동까지 일반 사용자의 직접 수정으로 보아
-- 막고 있었으므로, id/작성자/작성 시각 보호는 그대로 두고 연결 대상 변경만
-- 신뢰된 클러스터 작업 동안 허용한다. 검증 상태와 추천 수 보호도 그대로다.

begin;

create or replace function public.guard_solution_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cluster_write boolean :=
    coalesce(current_setting('app.cluster_write', true), '') = 'on';
begin
  -- Imports, migrations and trusted server operations have no end-user uid.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from auth.uid() then
      raise exception '풀이 작성자는 현재 사용자여야 합니다.' using errcode = '42501';
    end if;
    if new.is_verified or new.upvote_count <> 0 then
      raise exception '검증 상태와 추천 수는 직접 지정할 수 없습니다.' using errcode = '42501';
    end if;
  else
    -- 식별 정보는 어떤 사용자 작업에서도 바꿀 수 없다.
    if new.id is distinct from old.id
       or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception '풀이의 작성자는 변경할 수 없습니다.' using errcode = '42501';
    end if;

    -- 문제 묶기 RPC만 개별 풀이를 그룹 풀이로 옮길 수 있다. 일반 풀이 수정은
    -- 기존처럼 question_id/group_id 를 바꾸지 못한다.
    if not v_cluster_write
       and (
         new.question_id is distinct from old.question_id
         or new.group_id is distinct from old.group_id
       ) then
      raise exception '풀이의 연결 대상은 변경할 수 없습니다.' using errcode = '42501';
    end if;

    if new.is_verified is distinct from old.is_verified then
      raise exception '풀이 검증 상태는 관리자만 바꿀 수 있습니다.' using errcode = '42501';
    end if;

    -- The upvote counter is maintained by the nested solution_upvotes trigger.
    -- A direct client UPDATE enters at depth 1 and must not set the counter.
    if new.upvote_count is distinct from old.upvote_count and pg_trigger_depth() <= 1 then
      raise exception '추천 수는 직접 바꿀 수 없습니다.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_solution_fields() from public, anon, authenticated;

commit;
