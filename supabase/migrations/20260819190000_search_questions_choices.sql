-- =============================================================================
-- 검색에 선지 포함
--
-- 지금까지 stem_text(지문)만 봤다. 그런데 찾는 단서가 선지에만 있는 경우가 많다.
-- "sacubitril" 이 지문에는 없고 선지에만 있는 식이다.
--
-- choices 는 jsonb 라 인덱스를 태울 수 없어 전부 훑는다. 문항이 4천 개 수준이고
-- 검색은 사람이 한 번씩 누르는 동작이라 감당할 만하다. 느려지면 그때 선지 텍스트
-- 컬럼을 따로 두고 인덱스를 건다.
--
-- 점수는 지문 정확일치(1.0)보다 낮고 풀이 일치(0.9)와 같은 0.9 로 둔다. 선지에
-- 걸린 것도 충분히 정확한 단서다.
-- =============================================================================

create or replace function public.search_questions(
  p_query text,
  p_include_solutions boolean default false,
  p_subject_id uuid default null,
  p_cohort text default null,
  p_limit integer default 50
)
returns table (
  question_id uuid,
  exam_id uuid,
  unit_id uuid,
  question_number integer,
  stem_text text,
  score real,
  matched_in text,
  snippet text
)
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
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
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
  choice_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      0.9::real as score,
      '선지'::text as matched_in,
      -- 어느 선지에 걸렸는지 보여줘야 고를 수 있다.
      (
        select string_agg(c.value ->> 'text', ' / ')
          from jsonb_array_elements(q.choices) as c
         where c.value ->> 'text' ilike '%' || n.raw || '%'
      ) as snippet
    from public.questions q
    join public.exams e on e.id = q.exam_id
    cross join needle n
    where q.status = 'published'
      and n.raw <> ''
      and jsonb_typeof(q.choices) = 'array'
      and (public.is_admin() or public.has_content_access(e.required_permission))
      and q.choices::text ilike '%' || n.raw || '%'
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  solution_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
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
    select * from choice_hits
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

comment on function public.search_questions(text, boolean, uuid, text, integer) is
  '문제 검색. 지문·선지에서 찾고, p_include_solutions 면 풀이 본문도 본다.';
