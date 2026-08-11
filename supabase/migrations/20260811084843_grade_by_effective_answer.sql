-- =============================================================================
-- 채점 기준 변경
--
-- 원래는 editor_answer 로만 채점했다. 그런데 복기 자료를 넣으면 처음에는
-- 야마답만 있고 편집자답은 비어 있어서, 모든 문항이 채점 불가로 남는다.
--
-- 바뀐 규칙: 편집자답이 있으면 그것으로, 없으면 야마답으로 채점한다.
-- 편집자가 검토하면서 다른 답을 넣으면 그 순간부터 편집자답이 이긴다.
-- =============================================================================
create or replace function public.effective_answer(q public.questions)
returns int[]
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(array_length(q.editor_answer, 1), 0) > 0 then q.editor_answer
    else coalesce(q.yama_answer, '{}'::int[])
  end;
$$;

create or replace function public.submit_attempt(
  p_question_id    uuid,
  p_selected       int[] default '{}'::int[],
  p_time_spent_sec int default null,
  p_self_grade     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q         public.questions;
  uid       uuid := auth.uid();
  answer    int[];
  correct   boolean;
  next_no   int;
  new_id    uuid;
begin
  if not public.can_write() then
    raise exception '쓰기 권한이 없습니다.' using errcode = '42501';
  end if;

  select * into q from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;

  -- 편집자답이 있으면 그 기준, 없으면 야마답 기준으로 채점한다.
  answer := public.effective_answer(q);

  if q.question_type = 'essay' then
    correct := case p_self_grade when 'correct' then true when 'wrong' then false end;
  elsif coalesce(array_length(answer, 1), 0) = 0 then
    correct := null;
  else
    correct := (
      select coalesce(array_agg(x order by x), '{}'::int[]) from unnest(answer) as x
    ) = (
      select coalesce(array_agg(y order by y), '{}'::int[])
        from (select distinct unnest(coalesce(p_selected, '{}'::int[])) as y) s
    );
  end if;

  select coalesce(max(attempt_number), 0) + 1 into next_no
    from public.attempts
   where question_id = p_question_id and user_id = uid;

  insert into public.attempts (
    question_id, user_id, selected_answer, is_correct, self_grade, time_spent_sec, attempt_number
  )
  values (
    p_question_id, uid, coalesce(p_selected, '{}'::int[]), correct, p_self_grade,
    p_time_spent_sec, next_no
  )
  returning id into new_id;

  return jsonb_build_object(
    'attempt_id', new_id,
    'attempt_number', next_no,
    'is_correct', correct,
    'answer', public.reveal_answer(p_question_id),
    'stats', public.get_question_stats(p_question_id)
  );
end;
$$;

revoke execute on function public.effective_answer(public.questions) from public, anon;
grant execute on function public.effective_answer(public.questions) to authenticated;
