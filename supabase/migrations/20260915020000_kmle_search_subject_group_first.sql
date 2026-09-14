begin;

-- 0.15 가점 방식은 다른 과목의 점수가 충분히 높으면 현재 과목보다 앞에 올 수
-- 있었다. 레옵스에서 본문에 넣을 문제를 고를 때는 같은 과목 후보를 모두 먼저
-- 보고, 그 다음에야 다른 과목 후보를 보고 싶다는 요청이라 아예 두 구간으로
-- 나눠 정렬한다.
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
      e.subject_id,
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
  order by
    case
      when p_subject_id is not null and r.subject_id = p_subject_id then 0
      else 1
    end,
    r.final_score desc,
    r.exam_id,
    r.question_number,
    r.id
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_kmle_questions(text, uuid, integer)
  from public, anon;
grant execute on function public.search_kmle_questions(text, uuid, integer)
  to authenticated, service_role;

comment on function public.search_kmle_questions(text, uuid, integer) is
  '전체 KMLE 문제를 유사도순으로 검색하되 현재 과목 후보를 모두 먼저, 그 다음 다른 과목을 유사도순으로 보여준다.';

commit;
