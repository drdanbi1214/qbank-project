-- =============================================================================
-- 진행률 집계
-- 문제 1건당 "가장 최근의 활성 시도" 하나만 보고 풀이 여부와 정오를 판정한다.
-- 초기화(is_active = false)된 기록은 집계에서 빠지고 행 자체는 남는다.
-- =============================================================================

create or replace function public.get_progress_by_unit()
returns table (
  subject_id       uuid,
  unit_id          uuid,
  total_questions  int,
  solved_questions int,
  correct_questions int
)
language sql
stable
security definer
set search_path = public
as $$
  select e.subject_id,
         q.unit_id,
         count(*)::int,
         count(a.question_id)::int,
         count(*) filter (where a.is_correct)::int
    from public.questions q
    join public.exams e on e.id = q.exam_id
    left join lateral (
      select at.question_id, at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.status = 'published'
   group by e.subject_id, q.unit_id;
$$;

create or replace function public.get_progress_by_exam()
returns table (
  exam_id          uuid,
  total_questions  int,
  solved_questions int,
  correct_questions int
)
language sql
stable
security definer
set search_path = public
as $$
  select q.exam_id,
         count(*)::int,
         count(a.question_id)::int,
         count(*) filter (where a.is_correct)::int
    from public.questions q
    left join lateral (
      select at.question_id, at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.status = 'published'
   group by q.exam_id;
$$;

-- 문제 목록 화면에서 각 문제의 내 풀이 상태를 한 번에 받는다.
create or replace function public.get_my_question_states(p_question_ids uuid[])
returns table (
  question_id uuid,
  is_correct  boolean,
  attempts    int
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id,
         a.is_correct,
         (select count(*)::int from public.attempts c
           where c.question_id = q.id and c.user_id = auth.uid() and c.is_active)
    from public.questions q
    left join lateral (
      select at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.id = any(p_question_ids);
$$;

revoke execute on function public.get_progress_by_unit()          from public, anon;
revoke execute on function public.get_progress_by_exam()          from public, anon;
revoke execute on function public.get_my_question_states(uuid[])  from public, anon;

grant execute on function public.get_progress_by_unit()           to authenticated;
grant execute on function public.get_progress_by_exam()           to authenticated;
grant execute on function public.get_my_question_states(uuid[])   to authenticated;
