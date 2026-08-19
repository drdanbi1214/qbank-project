-- =============================================================================
-- 클러스터 컬럼을 RPC 밖에서 못 바꾸게 막기
--
-- 야마 묶기는 레전드옵세스터디원과 관리자만 할 수 있어야 한다. 지금은 그 검사가
-- cluster_attach / cluster_detach / cluster_ensure_group 안에만 있고, questions
-- 의 UPDATE 정책은 can_write() 즉 "정지되지 않은 모든 로그인 사용자" 다. 즉 RPC
-- 는 유일한 화면 경로일 뿐이고, 직접 questions 를 UPDATE 하면 누구나 group_id 와
-- variant_type 을 바꿀 수 있다.
--
-- 정책을 컬럼 단위로 쪼갤 수 없으므로 트리거로 막는다. 허가된 RPC 는 트랜잭션
-- 지역 플래그를 세우고 들어오므로 통과하고, 그 밖의 경로는 거부된다.
--
-- 값이 그대로인 UPDATE 는 막지 않는다. 관리자 문항 편집 화면이 group_id 를
-- 읽은 그대로 다시 보내기 때문이다.
-- =============================================================================

create or replace function public.guard_cluster_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.group_id is not distinct from old.group_id
     and new.variant_type is not distinct from old.variant_type then
    return new;
  end if;

  -- 허가된 RPC 안에서 온 변경.
  if coalesce(current_setting('app.cluster_write', true), '') = 'on' then
    return new;
  end if;

  -- auth.uid() 가 없는 경로는 서버 측(service_role, 마이그레이션, 콘솔)이다.
  -- 로그인한 사용자는 항상 JWT 의 sub 가 있으므로 이 분기로 빠지지 않는다.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  raise exception '야마 묶기는 전용 기능으로만 바꿀 수 있습니다.' using errcode = '42501';
end;
$$;

comment on function public.guard_cluster_columns() is
  'questions.group_id / variant_type 을 클러스터 RPC 밖에서 바꾸지 못하게 막는다.';

drop trigger if exists questions_guard_cluster on public.questions;
create trigger questions_guard_cluster
before update on public.questions
for each row
execute function public.guard_cluster_columns();


-- -----------------------------------------------------------------------------
-- 허가된 RPC 들에 플래그를 세운다. is_local = true 라 트랜잭션이 끝나면 사라진다.
-- -----------------------------------------------------------------------------
create or replace function public.cluster_attach(
  p_anchor_id uuid,
  p_target_id uuid,
  p_variant   text
)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id     uuid;
  v_anchor_group uuid;
  v_target_group uuid;
  v_anchor_exam  uuid;
  v_target_exam  uuid;
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

  if not public.is_admin() then
    if not public.can_view_exam(v_anchor_exam) or not public.can_view_exam(v_target_exam) then
      raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
    end if;
  end if;

  if v_target_group is not null then
    raise exception '이미 다른 야마에 묶여 있는 문제입니다. 먼저 묶기를 풀어 주세요.'
      using errcode = '23505';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  if v_anchor_group is not null then
    v_group_id := v_anchor_group;
    update public.question_groups
       set canonical_question_id = p_anchor_id, updated_at = now()
     where id = v_group_id;
  else
    insert into public.question_groups (canonical_question_id, created_by)
    values (p_anchor_id, auth.uid())
    returning id into v_group_id;
  end if;

  update public.questions
     set group_id = v_group_id, variant_type = 'original',
         updated_by = auth.uid(), updated_at = now()
   where id = p_anchor_id;

  update public.questions
     set group_id = v_group_id, variant_type = p_variant,
         updated_by = auth.uid(), updated_at = now()
   where id = p_target_id;

  return v_group_id;
end;
$$;

create or replace function public.cluster_detach(p_question_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.can_cluster() then
    raise exception '야마 묶기를 풀 권한이 없습니다.' using errcode = '42501';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  update public.questions
     set group_id = null, variant_type = 'original',
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id;

  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.cluster_ensure_group(p_question_id uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid;
  v_exam_id  uuid;
begin
  if not public.can_cluster() then
    raise exception '야마를 묶을 권한이 없습니다.' using errcode = '42501';
  end if;

  select group_id, exam_id into v_group_id, v_exam_id
    from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if v_group_id is not null then
    return v_group_id;
  end if;

  if not public.is_admin() and not public.can_view_exam(v_exam_id) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  insert into public.question_groups (canonical_question_id, created_by)
  values (p_question_id, auth.uid())
  returning id into v_group_id;

  update public.questions
     set group_id = v_group_id, variant_type = 'original',
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id;

  return v_group_id;
end;
$$;
