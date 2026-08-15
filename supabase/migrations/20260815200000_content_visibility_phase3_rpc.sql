-- 콘텐츠 가시성 3단계 (이어서) — RLS 를 우회하는 RPC 들을 막는다.
--
-- questions 의 RLS 와 questions_solve 의 조건만으로는 부족하다. 아래
-- 함수들은 SECURITY DEFINER 라 RLS 를 통째로 지나치므로, 권한 없는
-- 사용자가 문제 id 만 알면 숨겨진 문제의 정답을 그대로 받아갈 수 있었다.
--
-- 없는 문제와 안 보이는 문제를 같은 오류로 처리한다. 오류 메시지로
-- 문제의 존재 여부가 드러나지 않게 하기 위해서다.

-- ---------------------------------------------------------------------------
-- 정답 공개
-- ---------------------------------------------------------------------------
create or replace function public.reveal_answer(p_question_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare q public.questions;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into q from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;
  if not (public.is_admin() or public.can_view_exam(q.exam_id)) then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'question_id', q.id,
    'editor_answer', to_jsonb(q.editor_answer),
    'yama_answer', to_jsonb(q.yama_answer),
    'answer_status', q.answer_status,
    'answer_note', q.answer_note,
    'official_explanation', q.official_explanation,
    'model_answer', q.model_answer,
    'grading_points', q.grading_points
  );
end;
$function$;

create or replace function public.reveal_answers(p_question_ids uuid[])
returns table(question_id uuid, editor_answer integer[], yama_answer integer[], answer_status text, answer_note text, official_explanation jsonb, model_answer text, grading_points jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    q.id,
    q.editor_answer,
    q.yama_answer,
    q.answer_status,
    q.answer_note,
    q.official_explanation,
    q.model_answer,
    q.grading_points
  from public.questions q
  where auth.uid() is not null
    and q.id = any(coalesce(p_question_ids, '{}'::uuid[]))
    and (public.is_admin() or public.can_view_exam(q.exam_id))
$function$;

-- ---------------------------------------------------------------------------
-- 채점
--
-- 안 보이는 문제로는 attempts 도 남기지 않는다. reveal_answer 를 안에서
-- 부르므로 막기는 하지만, 그 전에 걸러야 기록이 남지 않는다.
-- ---------------------------------------------------------------------------
create or replace function public.submit_attempt(p_question_id uuid, p_selected integer[] default '{}'::integer[], p_time_spent_sec integer default null::integer, p_self_grade text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if not (public.is_admin() or public.can_view_exam(q.exam_id)) then
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
$function$;

-- ---------------------------------------------------------------------------
-- 조회수
-- ---------------------------------------------------------------------------
create or replace function public.increment_question_view(p_question_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.questions
     set view_count = view_count + 1
   where id = p_question_id
     and (public.is_admin() or public.can_view_exam(exam_id));
$function$;

-- ---------------------------------------------------------------------------
-- 검색
--
-- 안 보이는 학번의 문제는 본문이 검색 결과로도 새어나가면 안 된다.
-- exams 를 이미 조인하고 있으므로 공개범위를 그 자리에서 본다.
--
-- 겸사겸사 풀이 검색의 회귀도 고친다. 2단계에서 전체공개 풀이의
-- required_permission 이 null 이 될 수 있게 됐는데, has_permission(null)
-- 은 false 라 전체공개 풀이가 검색에 전혀 잡히지 않았다.
-- ---------------------------------------------------------------------------
create or replace function public.search_questions(p_query text, p_include_solutions boolean default false, p_subject_id uuid default null::uuid, p_cohort text default null::text, p_limit integer default 50)
returns table(question_id uuid, exam_id uuid, unit_id uuid, question_number integer, stem_text text, score real, matched_in text, snippet text)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  with needle as (
    select
      btrim(p_query) as raw,
      public.normalize_search_text(p_query) as norm
  ),
  question_hits as (
    select
      q.id,
      q.exam_id,
      q.unit_id,
      q.question_number,
      q.stem_text,
      greatest(
        case when q.stem_text ilike '%' || n.raw || '%' then 1.0 else 0 end,
        similarity(q.stem_norm, n.norm)
      )::real as score,
      '문제'::text as matched_in,
      q.stem_text as snippet
    from public.questions q
    join public.exams e on e.id = q.exam_id
    cross join needle n
    where q.status = 'published'
      and n.raw <> ''
      and (public.is_admin() or public.has_content_access(e.required_permission))
      and (q.stem_text ilike '%' || n.raw || '%' or similarity(q.stem_norm, n.norm) > 0.15)
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  solution_hits as (
    select
      q.id,
      q.exam_id,
      q.unit_id,
      q.question_number,
      q.stem_text,
      0.9::real as score,
      '풀이'::text as matched_in,
      public.richtext_plain(s.content) as snippet
    from public.solutions s
    join public.questions q
      on (s.question_id is not null and q.id = s.question_id)
      or (s.group_id is not null and q.group_id = s.group_id)
    join public.exams e on e.id = q.exam_id
    cross join needle n
    where p_include_solutions
      and public.has_content_access(s.required_permission)
      and n.raw <> ''
      and q.status = 'published'
      and (public.is_admin() or public.has_content_access(e.required_permission))
      and public.richtext_plain(s.content) ilike '%' || n.raw || '%'
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  merged as (
    select * from question_hits
    union all
    select * from solution_hits
  )
  select distinct on (m.id)
    m.id, m.exam_id, m.unit_id, m.question_number, m.stem_text,
    m.score, m.matched_in, left(m.snippet, 300)
  from merged m
  order by m.id, m.score desc
  limit p_limit
$function$;
