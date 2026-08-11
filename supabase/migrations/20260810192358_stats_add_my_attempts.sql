-- =============================================================================
-- 화면에 표시하는 누적 풀이 횟수를 내 계정 기준으로 변경
--
-- 전체 집계(정답률, 평균 풀이 시간, 보기별 선택 분포)는 마이페이지와
-- 관리자 통계에서 계속 사용하므로 응답에는 그대로 유지한다.
-- =============================================================================

create or replace function public.get_question_stats(p_question_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (
    select user_id, selected_answer, is_correct, time_spent_sec
      from public.attempts
     where question_id = p_question_id
  ),
  base as (
    select count(*)::int as total,
           count(*) filter (where is_correct)::int as correct,
           count(*) filter (where is_correct is not null)::int as graded,
           count(*) filter (where user_id = auth.uid())::int as mine,
           avg(time_spent_sec) as avg_time
      from a
  ),
  dist as (
    select s.val, count(*)::int as cnt
      from a, unnest(a.selected_answer) as s(val)
     group by s.val
  )
  select jsonb_build_object(
    'total_attempts', base.total,
    'my_attempts', base.mine,
    'correct_count', base.correct,
    'correct_rate', case when base.graded > 0
                         then round(base.correct::numeric * 100 / base.graded, 1)
                    end,
    'avg_time_spent_sec', case when base.avg_time is not null then round(base.avg_time)::int end,
    'choice_distribution', coalesce((select jsonb_object_agg(val::text, cnt) from dist), '{}'::jsonb)
  )
  from base;
$$;
