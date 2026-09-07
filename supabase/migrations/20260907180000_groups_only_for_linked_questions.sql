-- 문제 하나를 테마에 넣는 것만으로는 야마 그룹을 만들지 않는다.
-- 기존 단독 그룹은 문제별 해설로 되돌려, 실제 문제-문제 연결만 남긴다.

do $$
begin
  if exists (
    with singleton as (
      select distinct on (q.group_id) q.group_id
        from public.questions q
       where q.group_id is not null
         and 1 = (select count(*) from public.questions member where member.group_id = q.group_id)
    )
    select 1 from public.personal_notes n join singleton x on x.group_id = n.group_id
  ) then
    raise exception '단독 야마 그룹에 개인 노트가 있어 자동 정리를 중단했습니다.';
  end if;
end;
$$;

with singleton as (
  select distinct on (q.group_id) q.group_id, q.id as question_id
    from public.questions q
   where q.group_id is not null
     and 1 = (select count(*) from public.questions member where member.group_id = q.group_id)
)
update public.solutions s
   set group_id = null, question_id = x.question_id, updated_at = now()
  from singleton x
 where s.group_id = x.group_id;

select set_config('app.cluster_write', 'on', true);

with singleton as (
  select distinct on (q.group_id) q.group_id, q.id as question_id
    from public.questions q
   where q.group_id is not null
     and 1 = (select count(*) from public.questions member where member.group_id = q.group_id)
)
update public.questions q
   set group_id = null, variant_type = 'original', same_as = null, updated_at = now()
  from singleton x
 where q.id = x.question_id;

select set_config('app.cluster_write', 'off', true);

-- 실제로 두 문제를 연결하는 순간에만 그룹을 만들고, 대표 문제에 있던 해설은
-- 새 그룹의 공유 해설로 옮긴다.
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
  if not found then raise exception '기준 문제를 찾을 수 없습니다.' using errcode = 'P0002'; end if;

  select group_id, exam_id into v_target_group, v_target_exam
    from public.questions where id = p_target_id;
  if not found then raise exception '붙일 문제를 찾을 수 없습니다.' using errcode = 'P0002'; end if;

  if not public.is_admin()
     and (not public.can_view_exam(v_anchor_exam) or not public.can_view_exam(v_target_exam)) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  if v_target_group is not null then
    select count(*) into v_target_member_count from public.questions where group_id = v_target_group;
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
    values (v_card_id, auth.uid()) returning id into v_group_id;
    update public.questions
       set group_id = v_group_id, variant_type = 'original', same_as = null,
           updated_by = auth.uid(), updated_at = now()
     where id = v_card_id;
  end if;

  update public.solutions
     set group_id = v_group_id, question_id = null, updated_at = now()
   where question_id = v_card_id and group_id is null;

  if v_target_group is not null and v_target_group <> v_group_id then
    update public.solutions set group_id = v_group_id, updated_at = now()
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

comment on function public.cluster_attach(uuid, uuid, text) is
  '실제 문제끼리 연결할 때만 야마 그룹을 만든다. 단독 문제 해설은 공유 해설로 옮긴다.';

revoke all on function public.cluster_attach(uuid, uuid, text) from public;
grant execute on function public.cluster_attach(uuid, uuid, text) to authenticated;
