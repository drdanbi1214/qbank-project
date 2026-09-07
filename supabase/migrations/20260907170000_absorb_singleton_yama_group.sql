-- =============================================================================
-- 혼자짜리 야마 그룹은 다른 야마에 바로 붙일 수 있게 한다.
--
-- 테마 본문에 야마를 넣으면 공유 해설의 주소를 안정적으로 유지하려고, 문제 하나만
-- 있어도 그룹을 만든다. 이전 cluster_attach 는 group_id 가 있다는 이유만으로 이
-- 단독 그룹도 대상 후보에서 막아, 게시물에 한 번 넣은 문제를 다른 야마의 변주로
-- 추가할 수 없었다.
--
-- 실제로 여러 문제가 있는 그룹은 기존처럼 막는다. 단독 그룹은 그 그룹에 달린
-- 해설까지 기준 그룹으로 옮긴 뒤 흡수하므로, 이미 작성한 해설도 잃지 않는다.
-- =============================================================================

create or replace function public.cluster_attach(
  p_anchor_id uuid, p_target_id uuid, p_variant text
)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid;
  v_anchor_group uuid;
  v_target_group uuid;
  v_anchor_exam uuid;
  v_target_exam uuid;
  v_anchor_same uuid;
  v_card_id uuid;
  v_target_member_count integer;
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

  select group_id, exam_id, same_as
    into v_anchor_group, v_anchor_exam, v_anchor_same
    from public.questions where id = p_anchor_id;
  if not found then
    raise exception '기준 문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select group_id, exam_id
    into v_target_group, v_target_exam
    from public.questions where id = p_target_id;
  if not found then
    raise exception '붙일 문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if not public.is_admin()
     and (not public.can_view_exam(v_anchor_exam) or not public.can_view_exam(v_target_exam)) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  -- 게시물에 꽂으며 생긴 단독 그룹은 옮길 수 있다. 이미 실제 형제가 있으면
  -- 두 독립 묶음을 합치게 되므로 기존처럼 먼저 사용자가 풀도록 한다.
  if v_target_group is not null then
    select count(*) into v_target_member_count
      from public.questions where group_id = v_target_group;
    if v_target_member_count > 1 then
      raise exception '이미 여러 문제가 묶인 다른 야마입니다. 그 야마에서 먼저 풀어 주세요.'
        using errcode = '23505';
    end if;
  end if;

  v_card_id := coalesce(v_anchor_same, p_anchor_id);
  perform set_config('app.cluster_write', 'on', true);

  if v_anchor_group is not null then
    v_group_id := v_anchor_group;
  else
    insert into public.question_groups (canonical_question_id, created_by)
    values (v_card_id, auth.uid())
    returning id into v_group_id;

    update public.questions
       set group_id = v_group_id, variant_type = 'original', same_as = null,
           updated_by = auth.uid(), updated_at = now()
     where id = v_card_id;
  end if;

  -- 단독 그룹에 작성된 해설을 새 묶음으로 함께 옮긴다. 문제만 옮기면 기존
  -- 게시물에서 해설이 사라지는 데이터 손실처럼 보이기 때문이다.
  if v_target_group is not null and v_target_group <> v_group_id then
    update public.solutions
       set group_id = v_group_id, updated_at = now()
     where group_id = v_target_group;
  end if;

  update public.questions
     set group_id = v_group_id,
         variant_type = p_variant,
         same_as = case when p_variant = 'identical' then v_card_id else null end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_target_id;

  perform set_config('app.cluster_write', 'off', true);
  return v_group_id;
end;
$$;

comment on function public.cluster_attach(uuid, uuid, text) is
  '기준 문제의 야마에 변주를 붙인다. 테마 삽입으로 생긴 단독 그룹은 해설과 함께 흡수한다.';

revoke all on function public.cluster_attach(uuid, uuid, text) from public;
grant execute on function public.cluster_attach(uuid, uuid, text) to authenticated;
