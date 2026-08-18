-- =============================================================================
-- 혼자짜리 클러스터 만들기
--
-- 테마에서 야마에 해설을 달 때, 아직 아무것도 묶지 않았으면 그룹이 없다. 그러면
-- 해설이 questions.id 에 붙는데, 나중에 다른 학번 판본을 묶어도 그 해설은
-- 따라가지 않는다. 첫 문제에만 남는다.
--
-- 야마 꽂기 → 해설 쓰기 → 나중에 판본 묶기 는 자연스러운 순서다. 순서를 어떻게
-- 밟았느냐에 따라 결과가 갈리면 안 되므로, 해설을 쓸 때 그룹이 없으면 혼자짜리
-- 그룹을 먼저 만들어 항상 그룹에 붙게 한다.
--
-- 혼자 남은 그룹은 무해하다 — 배너에 아무것도 더하지 않는다. cluster_detach 가
-- 그룹을 지우지 않고 남기는 것도 같은 이유다.
-- =============================================================================

create or replace function public.cluster_ensure_group(p_question_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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

  -- SECURITY DEFINER 는 RLS 를 우회하므로 열람 권한을 여기서 직접 본다.
  if not public.is_admin() and not public.can_view_exam(v_exam_id) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  insert into public.question_groups (canonical_question_id, created_by)
  values (p_question_id, auth.uid())
  returning id into v_group_id;

  update public.questions
     set group_id = v_group_id,
         variant_type = 'original',
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_question_id;

  return v_group_id;
end;
$$;

comment on function public.cluster_ensure_group(uuid) is
  '이 문제의 야마 클러스터를 보장한다. 없으면 혼자짜리 그룹을 만들어 돌려준다. 해설을 항상 그룹에 붙이기 위한 것.';

revoke all on function public.cluster_ensure_group(uuid) from public;
grant execute on function public.cluster_ensure_group(uuid) to authenticated;
