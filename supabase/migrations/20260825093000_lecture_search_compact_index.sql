-- 강의록 한 단어 검색도 4만여 PDF 페이지 전체에 정규식을 실행해 일반 사용자
-- statement_timeout 안에 끝나지 않았다. 공백·구두점을 제거한 형태를 trigram
-- expression index로 만들고, 정확/추출 공백 일치 후보만 먼저 좁혀 관련도를 계산한다.

begin;

create or replace function public.compact_search_text(input_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(coalesce(input_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
$$;

create index if not exists lecture_page_texts_compact_trgm_idx
  on public.lecture_page_texts
  using gin (public.compact_search_text(text_content) gin_trgm_ops);

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
  -- 단일 단어와 정확 문장은 expression index로 먼저 좁힌다. `UVJ`가 PDF에서
  -- `U V J`로 추출된 경우도 compact 형태가 같아 같은 후보에 들어온다.
  compact_page_candidates as materialized (
    select
      p.lecture_id,
      p.page_number,
      p.text_content,
      public.search_text_rank(p.text_content, p_query) as rank
    from public.lecture_page_texts p
    cross join query_info q
    where q.compact_phrase <> ''
      and public.compact_search_text(p.text_content)
        like '%' || q.compact_phrase || '%'
  ),
  -- 정확히 이어지지 않은 여러 긴 낱말은 기존 순서 무관 AND 검색을 유지한다.
  -- 한 단어 검색에서는 이 분기를 아예 실행하지 않아 전수 검사를 피한다.
  word_page_candidates as materialized (
    select
      ranked.lecture_id,
      ranked.page_number,
      ranked.text_content,
      ranked.rank
    from (
      select
        p.lecture_id,
        p.page_number,
        p.text_content,
        public.search_text_rank(p.text_content, p_query) as rank
      from public.lecture_page_texts p
      cross join query_info q
      where cardinality(q.terms) > 1
        and public.compact_search_text(p.text_content)
          not like '%' || q.compact_phrase || '%'
    ) ranked
    where ranked.rank > 0
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

revoke all on function public.compact_search_text(text) from public, anon;
grant execute on function public.compact_search_text(text) to authenticated, service_role;

revoke all on function public.search_lecture_documents(text, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.search_lecture_documents(text, uuid, text, integer, integer)
  to authenticated, service_role;

comment on function public.search_lecture_documents(text, uuid, text, integer, integer) is
  '권한에 맞춰 강의록·정리본을 검색하며, 공백 제거 인덱스로 단어 및 PDF 추출 공백 일치를 먼저 좁힌다.';

commit;
