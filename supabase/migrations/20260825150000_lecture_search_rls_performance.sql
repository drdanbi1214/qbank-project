-- 강의록 본문 검색은 일반 회원에게 lecture_page_texts RLS가 행마다 적용되면서
-- 같은 권한 함수를 수천 번 다시 호출했다. 새 강의록이 늘어난 뒤에는 8초 제한을
-- 넘겨 결과가 있어도 화면에서 빈 결과처럼 보였다.
--
-- 호출자의 계정 상태와 권한 목록을 한 번만 읽고, 허용된 강의록 id를 먼저 만든
-- 다음 SECURITY DEFINER 함수 안에서 검색 인덱스를 사용한다. 반환 대상은 기존 RLS
-- 조건과 동일하게 명시적으로 제한한다.

begin;

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
security definer
set search_path = public, pg_temp
as $$
  with caller_access as materialized (
    select
      coalesce(auth.role() = 'service_role', false) as is_service_role,
      coalesce(p.role = 'admin' and not p.is_suspended, false) as is_admin,
      coalesce(not p.is_suspended, false) as is_active,
      coalesce(
        array_agg(distinct pp.permission_key)
          filter (where pp.permission_key is not null),
        '{}'::text[]
      ) as permissions
    from (select auth.uid() as user_id) caller
    left join public.profiles p on p.id = caller.user_id
    left join public.profile_permissions pp on pp.profile_id = caller.user_id
    group by p.role, p.is_suspended
  ),
  allowed_documents as materialized (
    select d.*
    from public.lecture_documents d
    cross join caller_access access
    where (
        access.is_service_role
        or access.is_admin
        or (
          access.is_active
          and d.is_published
          and (
            d.required_permission is null
            or d.required_permission = any(access.permissions)
          )
        )
      )
      and (p_category_id is null or d.category_id = p_category_id)
      and (p_professor is null or d.professor = p_professor)
      and (p_year is null or d.lecture_year = p_year)
  ),
  query_info as materialized (
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
  from allowed_documents d
  cross join query_parts q
  cross join caller_access access
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
          and (
            access.is_service_role
            or access.is_admin
            or (
              access.is_active
              and n.required_permission = any(access.permissions)
            )
          )
      ) ranked
      where ranked.rank > 0
    ) candidate
    order by candidate.rank desc, candidate.sort_order, candidate.note_id
    limit 1
  ) note_matched on true
  where cardinality(q.terms) > 0
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
  '호출자의 강의록·정리본 권한을 한 번만 계산한 뒤 인덱스로 본문을 검색한다.';

commit;
