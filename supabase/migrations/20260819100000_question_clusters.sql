-- =============================================================================
-- 야마 클러스터 묶기
--
-- 같은 문제가 여러 학번 시험에 반복 출제된다. 이를 하나로 묶어 풀이를 공유하고,
-- 출제 이력 배너를 띄우고, 이어풀기에서 중복을 걸러내기 위한 쓰기 경로다.
--
-- 스키마는 이미 있다 (question_groups / questions.group_id / questions.variant_type /
-- solutions.group_id). 여기서 만드는 것은 권한이 걸린 쓰기 함수뿐이다.
--
-- 왜 RLS 정책이 아니라 RPC 인가:
--   questions 의 UPDATE 정책은 can_write() 즉 "정지되지 않은 모든 로그인 사용자" 다.
--   묶기를 스터디원으로 제한하려고 이 정책을 조이면 문제 편집, 라벨링, 배정 풀이
--   같은 기존 흐름이 전부 같이 막힌다. 그래서 정책은 건드리지 않고 묶기 경로만
--   좁은 함수로 내보낸다.
-- =============================================================================

-- 묶기 권한. 레전드옵세스터디원 전원과 관리자.
create or replace function public.can_cluster()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_admin() or public.has_permission('study_legendob');
$$;

comment on function public.can_cluster() is
  '야마 클러스터를 묶고 풀 수 있는 사람인지. 레전드옵세스터디원 + 관리자.';


-- -----------------------------------------------------------------------------
-- 붙이기
--
-- p_anchor_id 는 기준이 되는 대표 문제, p_target_id 는 거기 붙일 다른 학번 문제다.
-- p_variant 는 'identical'(완전 동일) 또는 'modified'(거의 비슷).
-- 이 값은 questions_variant_type_check 가 이미 허용하는 어휘를 그대로 쓴다.
-- -----------------------------------------------------------------------------
create or replace function public.cluster_attach(
  p_anchor_id uuid,
  p_target_id uuid,
  p_variant   text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_group_id       uuid;
  v_anchor_group   uuid;
  v_target_group   uuid;
  v_anchor_exam    uuid;
  v_target_exam    uuid;
begin
  if not public.can_cluster() then
    raise exception '야마를 묶을 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_variant not in ('identical', 'modified') then
    raise exception '변주 종류는 identical 또는 modified 여야 합니다.' using errcode = '22023';
  end if;

  if p_anchor_id = p_target_id then
    raise exception '같은 문제를 자기 자신에게 붙일 수 없습니다.' using errcode = '22023';
  end if;

  select group_id, exam_id into v_anchor_group, v_anchor_exam
    from public.questions where id = p_anchor_id;
  if not found then
    raise exception '기준 문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select group_id, exam_id into v_target_group, v_target_exam
    from public.questions where id = p_target_id;
  if not found then
    raise exception '붙일 문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  -- SECURITY DEFINER 는 RLS 를 우회하므로 열람 권한을 여기서 직접 확인한다.
  -- 그러지 않으면 볼 수 없는 시험의 문제를 붙여 배너로 내용을 흘릴 수 있다.
  if not public.is_admin() then
    if not public.can_view_exam(v_anchor_exam) or not public.can_view_exam(v_target_exam) then
      raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
    end if;
  end if;

  -- 대상이 이미 어떤 클러스터에든 속해 있으면 막는다.
  --
  -- 다른 그룹이면: 두 그룹을 합치는 셈이라 서로 다른 공유 해설이 한 묶음에 섞여
  --   어느 쪽이 맞는지 판단할 수 없게 된다.
  -- 같은 그룹이면: 기준과 대상을 뒤집어 부른 것이다. 그대로 두면 대표 문제가
  --   조용히 바뀌고 원래 대표의 variant_type 이 original 에서 뒤집힌다.
  --
  -- 어느 쪽이든 먼저 풀고 다시 붙이게 한다.
  if v_target_group is not null then
    raise exception '이미 다른 야마에 묶여 있는 문제입니다. 먼저 묶기를 풀어 주세요.'
      using errcode = '23505';
  end if;

  if v_anchor_group is not null then
    v_group_id := v_anchor_group;
    update public.question_groups
       set canonical_question_id = p_anchor_id,
           updated_at = now()
     where id = v_group_id;
  else
    insert into public.question_groups (canonical_question_id, created_by)
    values (p_anchor_id, auth.uid())
    returning id into v_group_id;
  end if;

  update public.questions
     set group_id = v_group_id,
         variant_type = 'original',
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_anchor_id;

  update public.questions
     set group_id = v_group_id,
         variant_type = p_variant,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_target_id;

  return v_group_id;
end;
$$;

comment on function public.cluster_attach(uuid, uuid, text) is
  '문제를 기준 문제의 야마 클러스터에 붙인다. identical 은 배너로만, modified 는 문제 전체로 표시된다.';


-- -----------------------------------------------------------------------------
-- 풀기
--
-- 그룹 row 는 절대 지우지 않는다. solutions.group_id 가 ON DELETE CASCADE 라
-- 그룹을 지우면 그 클러스터에 달린 공유 해설이 전부 같이 사라진다.
-- 마지막 한 명이 남더라도 그대로 둔다. 혼자 남은 그룹은 배너에 아무것도 더하지
-- 않으므로 무해하고, 공유 해설은 그 문제를 통해 계속 닿을 수 있다.
-- -----------------------------------------------------------------------------
create or replace function public.cluster_detach(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.can_cluster() then
    raise exception '야마 묶기를 풀 권한이 없습니다.' using errcode = '42501';
  end if;

  update public.questions
     set group_id = null,
         variant_type = 'original',
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_question_id;

  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.cluster_detach(uuid) is
  '문제를 야마 클러스터에서 뺀다. 그룹 자체는 남긴다 (공유 해설 보존).';


revoke all on function public.cluster_attach(uuid, uuid, text) from public;
revoke all on function public.cluster_detach(uuid) from public;
revoke all on function public.can_cluster() from public;

grant execute on function public.cluster_attach(uuid, uuid, text) to authenticated;
grant execute on function public.cluster_detach(uuid) to authenticated;
grant execute on function public.can_cluster() to authenticated;
