-- 문제 묶기 작업은 드물고 한 번에 여러 행과 풀이를 함께 옮긴다. 겹친 요청이
-- 서로의 중간 상태를 읽지 않도록 쓰기 RPC끼리 직렬화하고, SECURITY DEFINER가
-- RLS를 우회하는 만큼 모든 변경 경로에서 시험 열람 권한을 직접 확인한다.

begin;

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

  -- 묶기/풀기는 여러 문제와 풀이를 함께 바꾼다. 매우 드문 편집 작업이므로
  -- 하나의 트랜잭션 잠금으로 직렬화해 이중 클릭과 동시 편집의 경합을 없앤다.
  perform pg_advisory_xact_lock(7402192401);

  select group_id, exam_id, same_as
    into v_anchor_group, v_anchor_exam, v_anchor_same
    from public.questions where id = p_anchor_id
    for update;
  if not found then raise exception '기준 문제를 찾을 수 없습니다.' using errcode = 'P0002'; end if;

  select group_id, exam_id
    into v_target_group, v_target_exam
    from public.questions where id = p_target_id
    for update;
  if not found then raise exception '붙일 문제를 찾을 수 없습니다.' using errcode = 'P0002'; end if;

  if not public.is_admin()
     and (not public.can_view_exam(v_anchor_exam) or not public.can_view_exam(v_target_exam)) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  if v_anchor_group is not null and v_target_group = v_anchor_group then
    raise exception '이미 같은 야마에 묶여 있는 문제입니다.' using errcode = '23505';
  end if;

  if v_target_group is not null then
    select count(*) into v_target_member_count
      from public.questions where group_id = v_target_group;
    if v_target_member_count > 1 then
      raise exception '이미 여러 문제가 묶인 다른 야마입니다. 그 야마에서 먼저 풀어 주세요.'
        using errcode = '23505';
    end if;
  end if;

  -- 기준이 동일 판본이면 그것이 가리키는 실제 카드를 기준으로 삼는다.
  v_card_id := coalesce(v_anchor_same, p_anchor_id);
  if v_anchor_same is not null and not exists (
    select 1 from public.questions card
     where card.id = v_card_id
       and card.group_id = v_anchor_group
       and card.same_as is null
  ) then
    raise exception '기준 문제의 동일 판본 연결이 올바르지 않습니다. 관리자에게 알려 주세요.'
      using errcode = '23514';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  if v_anchor_group is not null then
    v_group_id := v_anchor_group;
  else
    insert into public.question_groups (canonical_question_id, created_by)
    values (v_card_id, auth.uid()) returning id into v_group_id;
    update public.questions
       set group_id = v_group_id, variant_type = 'original', same_as = null,
           updated_by = auth.uid(), updated_at = now()
     where id = v_card_id;
  end if;

  -- 대표 문제가 빠졌던 옛 그룹이면 현재 기준 카드로 메타데이터를 복구한다.
  update public.question_groups g
     set canonical_question_id = v_card_id, updated_at = now()
   where g.id = v_group_id
     and not exists (
       select 1 from public.questions canonical
        where canonical.id = g.canonical_question_id
          and canonical.group_id = g.id
     );

  -- 대표 문제에 이미 달린 풀이는 이제 묶인 판본 전체에서 보이는 공유 풀이가 된다.
  update public.solutions
     set group_id = v_group_id, question_id = null, updated_at = now()
   where question_id = v_card_id and group_id is null;

  -- 묶기를 풀어 생긴 단독 그룹은 풀이까지 새 그룹에 흡수한다.
  if v_target_group is not null and v_target_group <> v_group_id then
    update public.solutions
       set group_id = v_group_id, updated_at = now()
     where group_id = v_target_group;
  end if;

  update public.questions
     set group_id = v_group_id, variant_type = p_variant,
         same_as = case when p_variant = 'identical' then v_card_id else null end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_target_id;

  perform set_config('app.cluster_write', 'off', true);
  return v_group_id;
end;
$$;

create or replace function public.cluster_detach(p_question_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid;
  v_exam_id uuid;
  v_detached_all boolean;
  v_new_canonical uuid;
begin
  if not public.can_cluster() then
    raise exception '야마 묶기를 풀 권한이 없습니다.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(7402192401);

  select group_id, exam_id into v_group_id, v_exam_id
    from public.questions where id = p_question_id
    for update;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_group_id is null then
    raise exception '이 문제는 야마에 묶여 있지 않습니다.' using errcode = '22023';
  end if;
  if not public.is_admin() and not public.can_view_exam(v_exam_id) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  -- 카드와 그 동일 판본을 모두 빼서 그룹이 비는 경우, 그룹 개인 노트를 카드로
  -- 되돌린다. 같은 사용자의 옛 문제별 노트가 함께 있으면 덮지 않고 중단한다.
  select not exists (
    select 1 from public.questions member
     where member.group_id = v_group_id
       and member.id <> p_question_id
       and member.same_as is distinct from p_question_id
  ) into v_detached_all;

  if v_detached_all and exists (
    select 1
      from public.personal_notes grouped
      join public.personal_notes direct
        on direct.user_id = grouped.user_id
       and direct.question_id = p_question_id
     where grouped.group_id = v_group_id
  ) then
    raise exception '이 문제에는 기존 개인 노트와 그룹 개인 노트가 모두 있어 자동으로 묶기를 풀 수 없습니다.'
      using errcode = '23505';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  -- 카드를 빼면 그 카드와 완전히 같은 판본들도 함께 풀어 준다.
  update public.questions
     set group_id = null, variant_type = 'original', same_as = null,
         updated_by = auth.uid(), updated_at = now()
   where group_id = v_group_id and same_as = p_question_id;

  update public.questions
     set group_id = null, variant_type = 'original', same_as = null,
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id and group_id = v_group_id;

  if not found then
    raise exception '문제가 이미 다른 야마로 이동했습니다. 화면을 새로고침해 주세요.'
      using errcode = '40001';
  end if;

  if v_detached_all then
    -- 빈 그룹에 콘텐츠를 고아로 남기지 않고 기준 문제에 되돌린다.
    update public.solutions
       set group_id = null, question_id = p_question_id, updated_at = now()
     where group_id = v_group_id;
    update public.personal_notes
       set group_id = null, question_id = p_question_id, updated_at = now()
     where group_id = v_group_id;
  else
    -- canonical_question_id가 빠진 문제를 계속 가리키지 않게 남은 카드로 교체한다.
    select member.id into v_new_canonical
      from public.questions member
     where member.group_id = v_group_id and member.same_as is null
     order by (member.variant_type = 'original') desc, member.created_at, member.id
     limit 1;

    update public.question_groups g
       set canonical_question_id = v_new_canonical, updated_at = now()
     where g.id = v_group_id
       and not exists (
         select 1 from public.questions canonical
          where canonical.id = g.canonical_question_id
            and canonical.group_id = g.id
       );
  end if;

  perform set_config('app.cluster_write', 'off', true);
end;
$$;

create or replace function public.cluster_set_note(p_question_id uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare
  v_exam_id uuid;
  v_group_id uuid;
  v_variant_type text;
  v_same_as uuid;
begin
  if not public.can_cluster() then
    raise exception '야마 메모를 고칠 권한이 없습니다.' using errcode = '42501';
  end if;

  select exam_id, group_id, variant_type, same_as
    into v_exam_id, v_group_id, v_variant_type, v_same_as
    from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if not public.is_admin() and not public.can_view_exam(v_exam_id) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;
  if v_group_id is null or v_variant_type <> 'modified' or v_same_as is not null then
    raise exception '차이 메모는 야마의 유사 문제에만 쓸 수 있습니다.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception '차이 메모는 500자 이내로 입력해 주세요.' using errcode = '22023';
  end if;

  perform set_config('app.cluster_write', 'on', true);
  update public.questions
     set variant_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id;
  perform set_config('app.cluster_write', 'off', true);
end;
$$;

revoke all on function public.cluster_attach(uuid, uuid, text) from public, anon;
revoke all on function public.cluster_detach(uuid) from public, anon;
revoke all on function public.cluster_set_note(uuid, text) from public, anon;
grant execute on function public.cluster_attach(uuid, uuid, text) to authenticated;
grant execute on function public.cluster_detach(uuid) to authenticated;
grant execute on function public.cluster_set_note(uuid, text) to authenticated;

commit;
