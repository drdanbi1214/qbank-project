-- 여러 낱말 검색이 정확 문장으로 이어지지 않으면 모든 PDF 페이지를 다시 훑던
-- 병목을 없앤다. 한글 두 글자와 영문 부분검색도 인덱스를 탈 수 있는 PGroonga로
-- 각 낱말의 후보를 찾은 뒤 같은 페이지끼리 교집합하여 최종 관련도를 계산한다.

begin;

-- 기존 4만 6천여 페이지의 다국어 검색 인덱스를 처음 만들 때만 기본 2분보다
-- 오래 걸릴 수 있다. 실제 검색 요청의 statement_timeout은 변경하지 않는다.
set local statement_timeout = '10min';
set local maintenance_work_mem = '128MB';

create extension if not exists pgroonga with schema extensions;

create index if not exists lecture_page_texts_compact_pgroonga_idx
  on public.lecture_page_texts
  using pgroonga (public.compact_search_text(text_content))
  with (tokenizer='TokenBigramSplitSymbolAlphaDigit');

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
  match_page_count integer,
  note_match_id uuid,
  note_match_title text,
  note_match_snippet text,
  note_match_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with query_info as materialized (
    select
      public.search_query_terms(p_query) as terms,
      public.compact_search_text(p_query) as compact_phrase
  ),
  query_parts as materialized (
    select
      q.terms,
      q.compact_phrase,
      coalesce((
        select string_agg(term, '' order by term_order)
        from unnest(q.terms) with ordinality as split(term, term_order)
        where char_length(term) = 1
      ), '') as short_phrase
    from query_info q
  ),
  -- 입력 전체가 공백·구두점만 다르게 이어지는 후보를 먼저 찾는다.
  -- PGroonga의 bigram tokenizer가 한글 두 글자와 영문 부분검색도 처리한다.
  compact_page_candidates as materialized (
    select
      p.lecture_id,
      p.page_number,
      p.text_content,
      public.search_text_rank(p.text_content, p_query) as rank
    from public.lecture_page_texts p
    cross join query_parts q
    where q.compact_phrase <> ''
      and public.compact_search_text(p.text_content)
        like '%' || q.compact_phrase || '%'
  ),
  -- 여러 낱말은 각 낱말을 인덱스로 찾은 뒤 같은 페이지에 모두 있는 후보만
  -- 남긴다. `u v j` 같은 한 글자 묶음은 `uvj` 하나의 약어로 취급한다.
  word_needles as materialized (
    select distinct needle
    from (
      select public.compact_search_text(term) as needle
      from query_parts q
      cross join lateral unnest(q.terms) as split(term)
      where cardinality(q.terms) > 1
        and char_length(term) > 1

      union all

      select q.short_phrase
      from query_parts q
      where cardinality(q.terms) > 1
        and char_length(q.short_phrase) > 1
    ) candidates
    where needle <> ''
  ),
  word_candidate_hits as materialized (
    select
      page_hit.lecture_id,
      page_hit.page_number,
      needle.needle
    from word_needles needle
    cross join lateral (
      select p.lecture_id, p.page_number
      from public.lecture_page_texts p
      where public.compact_search_text(p.text_content)
          like '%' || needle.needle || '%'
    ) page_hit
  ),
  word_page_ids as materialized (
    select hit.lecture_id, hit.page_number
    from word_candidate_hits hit
    group by hit.lecture_id, hit.page_number
    having count(distinct hit.needle) = (select count(*) from word_needles)
  ),
  word_page_candidates as materialized (
    select
      p.lecture_id,
      p.page_number,
      p.text_content,
      ranked.rank
    from word_page_ids candidate
    join public.lecture_page_texts p
      on p.lecture_id = candidate.lecture_id
     and p.page_number = candidate.page_number
    cross join query_parts q
    cross join lateral (
      select public.search_text_rank(p.text_content, p_query) as rank
    ) ranked
    where public.compact_search_text(p.text_content)
            not like '%' || q.compact_phrase || '%'
      and ranked.rank > 0
  ),
  page_candidates as materialized (
    select * from compact_page_candidates
    union all
    select * from word_page_candidates
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
    coalesce(matched.page_count, 0)::integer,
    note_matched.note_id,
    note_matched.title,
    note_matched.snippet,
    coalesce(note_matched.note_count, 0)::integer
  from public.lecture_documents d
  cross join query_parts q
  cross join lateral (
    select public.search_text_rank(
      concat_ws(' ', d.title, d.professor, d.curriculum),
      p_query
    ) as rank
  ) metadata
  left join lateral (
    select
      candidate.page_number,
      public.search_result_snippet(candidate.text_content, p_query, 90) as snippet,
      count(*) over ()::integer as page_count,
      candidate.rank
    from page_candidates candidate
    where candidate.lecture_id = d.id
    order by candidate.rank desc, candidate.page_number
    limit 1
  ) matched on true
  left join lateral (
    select
      candidate.note_id,
      candidate.title,
      candidate.snippet,
      candidate.note_count,
      candidate.rank
    from (
      select
        ranked.note_id,
        ranked.title,
        public.search_result_snippet(ranked.content_text, p_query, 120) as snippet,
        count(*) over ()::integer as note_count,
        ranked.rank,
        ranked.sort_order
      from (
        select
          n.id as note_id,
          n.title,
          n.content_text,
          n.sort_order,
          public.search_text_rank(
            concat_ws(' ', n.title, n.content_text),
            p_query
          ) as rank
        from public.lecture_student_notes n
        where n.lecture_id = d.id
          and n.is_published
      ) ranked
      where ranked.rank > 0
    ) candidate
    order by candidate.rank desc, candidate.sort_order, candidate.note_id
    limit 1
  ) note_matched on true
  where cardinality(q.terms) > 0
    and (p_category_id is null or d.category_id = p_category_id)
    and (p_professor is null or d.professor = p_professor)
    and (p_year is null or d.lecture_year = p_year)
    and (
      metadata.rank > 0
      or matched.page_number is not null
      or note_matched.note_id is not null
    )
  order by
    greatest(
      case when metadata.rank > 0 then metadata.rank + 0.25 else 0 end,
      coalesce(matched.rank, 0),
      case when note_matched.rank > 0 then note_matched.rank + 0.10 else 0 end
    ) desc,
    metadata.rank desc,
    d.lecture_year desc nulls last,
    d.professor nulls last,
    d.sort_order,
    d.title
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.search_lecture_documents(text, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.search_lecture_documents(text, uuid, text, integer, integer)
  to authenticated, service_role;

comment on function public.search_lecture_documents(text, uuid, text, integer, integer) is
  '권한에 맞춰 강의록·정리본을 검색하며, 다중 낱말은 인덱스 후보 교집합으로 좁혀 관련도를 계산한다.';

commit;
