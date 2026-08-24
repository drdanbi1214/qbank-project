-- 문제·선지·풀이와 강의록 검색을 같은 낱말 AND 규칙으로 맞춘다.
-- 정확한 문장, 공백·구두점만 다른 문장, 가까운 낱말 AND 순으로 점수를 주며
-- 결과 문맥도 첫 실제 일치 위치를 중심으로 돌려준다.

begin;

create or replace function public.search_query_terms(query_text text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(term order by first_position), '{}'::text[])
  from (
    select term, min(term_order) as first_position
    from regexp_split_to_table(
      lower(btrim(coalesce(query_text, ''))),
      '[^[:alnum:]가-힣]+'
    ) with ordinality as split(term, term_order)
    where term <> ''
    group by term
  ) distinct_terms;
$$;

create or replace function public.search_text_rank(input_text text, query_text text)
returns real
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text := regexp_replace(lower(coalesce(input_text, '')), '[[:space:]]+', ' ', 'g');
  phrase text := regexp_replace(lower(btrim(coalesce(query_text, ''))), '[[:space:]]+', ' ', 'g');
  compact_text text := regexp_replace(lower(coalesce(input_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  compact_phrase text := regexp_replace(lower(coalesce(query_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  terms text[] := public.search_query_terms(query_text);
  term text;
  term_at integer;
  first_at integer := null;
  last_at integer := null;
begin
  if cardinality(terms) = 0 or compact_phrase = '' then
    return 0;
  end if;

  -- 사용자가 입력한 문장이 그대로 있으면 가장 관련성이 높다.
  if phrase <> '' and strpos(cleaned, phrase) > 0 then
    return 4.0;
  end if;

  -- PDF·리치텍스트 추출 중 공백이나 구두점만 끼어든 문장이다.
  if strpos(compact_text, compact_phrase) > 0 then
    return 3.5;
  end if;

  -- 나머지는 모든 낱말이 있어야 하며, 첫 출현끼리 가까울수록 앞에 둔다.
  foreach term in array terms loop
    term_at := strpos(cleaned, term);
    if term_at = 0 then
      return 0;
    end if;
    first_at := least(coalesce(first_at, term_at), term_at);
    last_at := greatest(coalesce(last_at, term_at), term_at);
  end loop;

  return (
    2.0 + 1.0 / (1.0 + greatest(0, coalesce(last_at, 0) - coalesce(first_at, 0)) / 40.0)
  )::real;
end;
$$;

create or replace function public.search_result_snippet(
  input_text text,
  query_text text,
  radius integer default 120
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text := regexp_replace(coalesce(input_text, ''), '[[:space:]]+', ' ', 'g');
  phrase text := regexp_replace(lower(btrim(coalesce(query_text, ''))), '[[:space:]]+', ' ', 'g');
  compact_text text := regexp_replace(lower(coalesce(input_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  compact_phrase text := regexp_replace(lower(coalesce(query_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  terms text[] := public.search_query_terms(query_text);
  compact_at integer;
  compact_cursor integer := 0;
  source_cursor integer;
  term_at integer;
  match_at integer;
  safe_radius integer := greatest(40, least(coalesce(radius, 120), 240));
  snippet_start integer;
  snippet_length integer;
  result text;
begin
  if cardinality(terms) = 0 or compact_phrase = '' then
    return null;
  end if;

  match_at := nullif(strpos(lower(cleaned), phrase), 0);

  -- 공백을 없앤 문자열에서 찾은 위치를 원문의 실제 위치로 다시 옮긴다.
  if match_at is null then
    compact_at := nullif(strpos(compact_text, compact_phrase), 0);
    if compact_at is not null then
      for source_cursor in 1..length(cleaned) loop
        if substring(lower(cleaned) from source_cursor for 1) ~ '[[:alnum:]가-힣]' then
          compact_cursor := compact_cursor + 1;
          if compact_cursor = compact_at then
            match_at := source_cursor;
            exit;
          end if;
        end if;
      end loop;
    end if;
  end if;

  if match_at is null then
    select min(nullif(strpos(lower(cleaned), term), 0))
      into term_at
      from unnest(terms) as split(term);
    match_at := term_at;
  end if;

  if match_at is null then
    return null;
  end if;

  snippet_start := greatest(1, match_at - safe_radius);
  snippet_length := safe_radius * 2 + 80;
  result := substring(cleaned from snippet_start for snippet_length);

  if snippet_start > 1 then
    result := '…' || result;
  end if;
  if snippet_start + snippet_length <= length(cleaned) then
    result := result || '…';
  end if;
  return result;
end;
$$;

-- 기존 호출 이름은 유지해 이미 배포된 화면과 저장 데이터가 그대로 동작하게 한다.
create or replace function public.lecture_search_snippet(
  input_text text,
  query_text text,
  radius integer default 90
)
returns text
language sql
immutable
set search_path = public
as $$
  select public.search_result_snippet(input_text, query_text, radius);
$$;

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
as $$
  with needle as (
    select
      btrim(coalesce(p_query, '')) as raw,
      public.normalize_search_text(p_query) as norm,
      public.search_query_terms(p_query) as terms
  ),
  eligible_questions as (
    select
      q.id, q.exam_id, q.unit_id, q.group_id, q.question_number,
      q.stem_text, q.stem_norm, q.choices
    from public.questions q
    join public.exams e on e.id = q.exam_id
    where q.status = 'published'
      and (public.is_admin() or public.has_content_access(e.required_permission))
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  question_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      case
        when ranked.rank > 0 then (ranked.rank + 0.30)::real
        else (0.50 + coalesce(similarity(q.stem_norm, n.norm), 0))::real
      end as score,
      '문제'::text as matched_in,
      coalesce(
        public.search_result_snippet(q.stem_text, p_query),
        left(q.stem_text, 320)
      ) as snippet
    from eligible_questions q
    cross join needle n
    cross join lateral (
      select public.search_text_rank(q.stem_text, p_query) as rank
    ) ranked
    where n.raw <> ''
      and (
        ranked.rank > 0
        or (
          cardinality(n.terms) = 1
          and n.norm <> ''
          and similarity(q.stem_norm, n.norm) > 0.15
        )
      )
  ),
  choice_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      (best.rank + 0.20)::real as score,
      '선지'::text as matched_in,
      public.search_result_snippet(best.text, p_query) as snippet
    from eligible_questions q
    cross join needle n
    cross join lateral (
      select candidate.text, candidate.rank
      from (
        select
          choice.value ->> 'text' as text,
          public.search_text_rank(choice.value ->> 'text', p_query) as rank
        from jsonb_array_elements(
          case when jsonb_typeof(q.choices) = 'array' then q.choices else '[]'::jsonb end
        ) as choice(value)
      ) candidate
      where candidate.rank > 0
      order by candidate.rank desc, length(candidate.text)
      limit 1
    ) best
    where n.raw <> ''
  ),
  solution_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      (ranked.rank + 0.10)::real as score,
      '풀이'::text as matched_in,
      public.search_result_snippet(ranked.plain_text, p_query) as snippet
    from public.solutions s
    join eligible_questions q
      on (s.question_id is not null and q.id = s.question_id)
      or (s.group_id is not null and q.group_id = s.group_id)
    cross join needle n
    cross join lateral (
      select
        plain.text as plain_text,
        public.search_text_rank(plain.text, p_query) as rank
      from (select public.richtext_plain(s.content) as text) plain
    ) ranked
    where p_include_solutions
      and n.raw <> ''
      and public.has_content_access(s.required_permission)
      and ranked.rank > 0
  ),
  merged as (
    select * from question_hits
    union all
    select * from choice_hits
    union all
    select * from solution_hits
  ),
  best_hits as (
    select distinct on (m.id)
      m.id, m.exam_id, m.unit_id, m.question_number, m.stem_text,
      m.score, m.matched_in, m.snippet
    from merged m
    order by m.id, m.score desc,
      case m.matched_in when '문제' then 1 when '선지' then 2 else 3 end
  )
  select
    b.id, b.exam_id, b.unit_id, b.question_number, b.stem_text,
    b.score, b.matched_in, b.snippet
  from best_hits b
  order by b.score desc, b.exam_id, b.question_number, b.id
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.search_lecture_documents(
  p_query text,
  p_category_id uuid default null,
  p_professor text default null,
  p_year integer default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  category_id uuid,
  title text,
  professor text,
  curriculum text,
  lecture_year integer,
  file_path text,
  byte_size bigint,
  page_count integer,
  is_published boolean,
  required_permission text,
  updated_at timestamptz,
  match_page integer,
  match_snippet text,
  match_page_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with query_info as (
    select public.search_query_terms(p_query) as terms
  )
  select
    d.id,
    d.category_id,
    d.title,
    d.professor,
    d.curriculum,
    d.lecture_year,
    d.file_path,
    d.byte_size,
    d.page_count,
    d.is_published,
    d.required_permission,
    d.updated_at,
    matched.page_number,
    matched.snippet,
    coalesce(matched.page_count, 0)::integer
  from public.lecture_documents d
  cross join query_info q
  cross join lateral (
    select public.search_text_rank(
      concat_ws(' ', d.title, d.professor, d.curriculum),
      p_query
    ) as rank
  ) metadata
  left join lateral (
    select
      candidate.page_number,
      candidate.snippet,
      candidate.page_count,
      candidate.rank
    from (
      select
        ranked.page_number,
        public.search_result_snippet(ranked.text_content, p_query, 90) as snippet,
        count(*) over ()::integer as page_count,
        ranked.rank
      from (
        select
          p.page_number,
          p.text_content,
          public.search_text_rank(p.text_content, p_query) as rank
        from public.lecture_page_texts p
        where p.lecture_id = d.id
      ) ranked
      where ranked.rank > 0
    ) candidate
    order by candidate.rank desc, candidate.page_number
    limit 1
  ) matched on true
  where cardinality(q.terms) > 0
    and (p_category_id is null or d.category_id = p_category_id)
    and (p_professor is null or d.professor = p_professor)
    and (p_year is null or d.lecture_year = p_year)
    and (metadata.rank > 0 or matched.page_number is not null)
  order by
    greatest(
      case when metadata.rank > 0 then metadata.rank + 0.25 else 0 end,
      coalesce(matched.rank, 0)
    ) desc,
    metadata.rank desc,
    d.lecture_year desc nulls last,
    d.professor nulls last,
    d.sort_order,
    d.title
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.search_query_terms(text) from public, anon;
grant execute on function public.search_query_terms(text) to authenticated, service_role;

revoke all on function public.search_text_rank(text, text) from public, anon;
grant execute on function public.search_text_rank(text, text) to authenticated, service_role;

revoke all on function public.search_result_snippet(text, text, integer) from public, anon;
grant execute on function public.search_result_snippet(text, text, integer)
  to authenticated, service_role;

revoke all on function public.lecture_search_snippet(text, text, integer) from public, anon;
grant execute on function public.lecture_search_snippet(text, text, integer)
  to authenticated, service_role;

revoke all on function public.search_questions(text, boolean, uuid, text, integer)
  from public, anon;
grant execute on function public.search_questions(text, boolean, uuid, text, integer)
  to authenticated, service_role;

revoke all on function public.search_lecture_documents(text, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.search_lecture_documents(text, uuid, text, integer, integer)
  to authenticated, service_role;

comment on function public.search_questions(text, boolean, uuid, text, integer) is
  '문제·선지·풀이를 낱말 AND로 찾고 정확 문장과 가까운 낱말 순으로 돌려준다.';
comment on function public.search_lecture_documents(text, uuid, text, integer, integer) is
  '강의록 제목·교수·본문을 낱말 AND로 찾고 정확 문장과 가까운 낱말 순으로 돌려준다.';

commit;
