begin;

-- KMLE 검색은 짧은 키워드뿐 아니라 문제나 해설 전체를 붙여 넣는 흐름이
-- 중심이다. 기존 search_text_rank는 모든 낱말이 한 필드에 있어야 해서 긴
-- 문장을 조금만 다르게 붙여 넣어도 결과가 사라진다. 아래 점수는 정확 문구,
-- 문장부호를 제거한 문구, 낱말 포함률, trigram 유사도를 차례로 반영한다.
create or replace function public.kmle_similarity_rank(
  input_text text,
  query_text text
)
returns real
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  cleaned_input text := regexp_replace(lower(coalesce(input_text, '')), '[[:space:]]+', ' ', 'g');
  cleaned_query text := regexp_replace(lower(btrim(coalesce(query_text, ''))), '[[:space:]]+', ' ', 'g');
  compact_input text := regexp_replace(lower(coalesce(input_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  compact_query text := regexp_replace(lower(coalesce(query_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  terms text[] := public.search_query_terms(query_text);
  term_count integer := 0;
  matched_count integer := 0;
  coverage real := 0;
  fuzzy real := 0;
  length_fit real := 0;
begin
  if compact_query = '' or compact_input = '' then
    return 0;
  end if;

  length_fit := least(length(compact_input), length(compact_query))::real
    / greatest(length(compact_input), length(compact_query))::real;

  if strpos(cleaned_input, cleaned_query) > 0 then
    return (12.0 + length_fit)::real;
  end if;

  if strpos(compact_input, compact_query) > 0 then
    return (11.0 + length_fit)::real;
  end if;

  select count(*), count(*) filter (where strpos(cleaned_input, term) > 0)
    into term_count, matched_count
  from unnest(terms) as split(term)
  where term <> '';

  if term_count > 0 then
    coverage := matched_count::real / term_count::real;
  end if;

  -- word_similarity는 붙여 넣은 문장이 본문 일부일 때 강하고, similarity는
  -- 문장 전체가 비슷할 때 강하다. 두 경우 중 더 좋은 값을 사용한다.
  fuzzy := greatest(
    similarity(compact_input, compact_query),
    word_similarity(compact_query, compact_input)
  );

  -- 짧은 검색어는 실제 낱말 포함 또는 꽤 강한 오탈자 유사도가 있어야 한다.
  -- 긴 붙여넣기는 일부 문장이 빠질 수 있으므로 15% 이상의 낱말 겹침도 후보로 둔다.
  if length(compact_query) <= 12 then
    if matched_count = 0 and fuzzy < 0.28 then
      return 0;
    end if;
  elsif coverage < 0.15 and fuzzy < 0.18 then
    return 0;
  end if;

  return (coverage * 6.0 + fuzzy * 4.0 + length_fit * 0.5)::real;
end;
$$;

revoke all on function public.kmle_similarity_rank(text, text) from public, anon;
grant execute on function public.kmle_similarity_rank(text, text)
  to authenticated, service_role;

comment on function public.kmle_similarity_rank(text, text) is
  '문제·해설 붙여넣기 검색용 관련도. 정확 문구, 정규화 문구, 낱말 포함률, trigram 유사도를 합산한다.';

create index if not exists kmle_sources_chapter_trgm_idx
  on public.kmle_sources using gin (lower(allen_chapter) extensions.gin_trgm_ops);

create index if not exists kmle_sources_code_idx
  on public.kmle_sources (allen_code);

create or replace function public.search_kmle_questions(
  p_query text,
  p_subject_id uuid default null,
  p_limit integer default 50
)
returns table (
  question_id uuid,
  exam_id uuid,
  unit_id uuid,
  question_number integer,
  stem_text text,
  allen_chapter text,
  allen_code text,
  score real,
  matched_in text,
  snippet text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with eligible as (
    select
      q.id,
      q.exam_id,
      q.unit_id,
      q.question_number,
      q.stem_text,
      ks.allen_chapter,
      ks.allen_code,
      coalesce(choice_text.value, '') as choice_text,
      public.richtext_plain(q.official_explanation) as explanation_text
    from public.questions q
    join public.exams e on e.id = q.exam_id
    join public.kmle_sources ks on ks.question_id = q.id
    left join lateral (
      select string_agg(choice.value ->> 'text', ' ' order by choice.ordinality) as value
      from jsonb_array_elements(
        case when jsonb_typeof(q.choices) = 'array' then q.choices else '[]'::jsonb end
      ) with ordinality as choice(value, ordinality)
    ) choice_text on true
    where q.status = 'published'
      and e.status = 'published'
      and e.question_bank = 'kmle'
      and (public.is_admin() or public.has_content_access(e.required_permission))
      and (p_subject_id is null or e.subject_id = p_subject_id)
  ),
  ranked as (
    select
      q.*,
      scores.stem_score,
      scores.choice_score,
      scores.explanation_score,
      scores.chapter_score,
      scores.code_score,
      scores.combined_score,
      greatest(
        scores.stem_score + 0.40,
        scores.choice_score + 0.30,
        scores.explanation_score + 0.20,
        scores.chapter_score + 0.10,
        scores.code_score + 0.10,
        scores.combined_score
      )::real as final_score
    from eligible q
    cross join lateral (
      select
        public.kmle_similarity_rank(q.stem_text, p_query) as stem_score,
        public.kmle_similarity_rank(q.choice_text, p_query) as choice_score,
        public.kmle_similarity_rank(q.explanation_text, p_query) as explanation_score,
        public.kmle_similarity_rank(q.allen_chapter, p_query) as chapter_score,
        public.kmle_similarity_rank(q.allen_code, p_query) as code_score,
        public.kmle_similarity_rank(
          concat_ws(' ', q.allen_chapter, q.allen_code, q.stem_text, q.choice_text, q.explanation_text),
          p_query
        ) as combined_score
    ) scores
    where btrim(coalesce(p_query, '')) <> ''
  )
  select
    r.id,
    r.exam_id,
    r.unit_id,
    r.question_number,
    r.stem_text,
    r.allen_chapter,
    r.allen_code,
    r.final_score,
    case greatest(
      r.stem_score + 0.40,
      r.choice_score + 0.30,
      r.explanation_score + 0.20,
      r.chapter_score + 0.10,
      r.code_score + 0.10,
      r.combined_score
    )
      when r.stem_score + 0.40 then '문제'
      when r.choice_score + 0.30 then '선지'
      when r.explanation_score + 0.20 then '해설'
      when r.chapter_score + 0.10 then '대제목'
      when r.code_score + 0.10 then '출처'
      else '문제·해설'
    end as matched_in,
    case greatest(
      r.stem_score + 0.40,
      r.choice_score + 0.30,
      r.explanation_score + 0.20,
      r.chapter_score + 0.10,
      r.code_score + 0.10,
      r.combined_score
    )
      when r.stem_score + 0.40 then coalesce(public.search_result_snippet(r.stem_text, p_query), left(r.stem_text, 360))
      when r.choice_score + 0.30 then coalesce(public.search_result_snippet(r.choice_text, p_query), left(r.choice_text, 360))
      when r.explanation_score + 0.20 then coalesce(public.search_result_snippet(r.explanation_text, p_query), left(r.explanation_text, 360))
      when r.chapter_score + 0.10 then r.allen_chapter
      when r.code_score + 0.10 then r.allen_code
      else left(concat_ws(' ', r.stem_text, r.explanation_text), 360)
    end as snippet
  from ranked r
  where r.final_score > 0.40
  order by r.final_score desc, r.exam_id, r.question_number, r.id
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_kmle_questions(text, uuid, integer)
  from public, anon;
grant execute on function public.search_kmle_questions(text, uuid, integer)
  to authenticated, service_role;

comment on function public.search_kmle_questions(text, uuid, integer) is
  'KMLE 문제·선지·공식 해설·대제목·출처를 통합해 붙여넣은 내용과 가까운 문제 순서로 반환한다.';

commit;
