-- =============================================================================
-- 클러스터 쓰기 플래그를 호출 범위 안으로 좁힘
--
-- set_config(..., is_local => true) 는 문장이 아니라 트랜잭션이 끝날 때까지
-- 남는다. 그래서 한 트랜잭션 안에서 클러스터 RPC 를 한 번 부르면 그 뒤에 오는
-- 직접 UPDATE 까지 가드를 통과했다.
--
-- PostgREST 는 요청마다 트랜잭션이 달라 실사용에서 새지는 않지만, 보호가 호출
-- 범위 안에서만 유효하도록 각 RPC 가 일을 마치면 플래그를 내린다.
-- =============================================================================

create or replace function public.cluster_attach(
  p_anchor_id uuid, p_target_id uuid, p_variant text
)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid; v_anchor_group uuid; v_target_group uuid;
  v_anchor_exam uuid; v_target_exam uuid;
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

  perform set_config('app.cluster_write', 'off', true);
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

  perform set_config('app.cluster_write', 'off', true);

  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.cluster_ensure_group(p_question_id uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid; v_exam_id uuid;
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

  perform set_config('app.cluster_write', 'off', true);
  return v_group_id;
end;
$$;

create or replace function public.cluster_set_note(p_question_id uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.can_cluster() then
    raise exception '야마 메모를 고칠 권한이 없습니다.' using errcode = '42501';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  update public.questions
     set variant_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id;

  perform set_config('app.cluster_write', 'off', true);

  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;
