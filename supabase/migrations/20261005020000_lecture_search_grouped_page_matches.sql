-- 강의록 본문 검색의 페이지 후보를 문서마다 반복 스캔하지 않도록 집계한다.
-- 반환 형식·권한 조건을 유지한다. 영문·숫자 한 글자는 제목 등 메타데이터만 찾는다.

begin;

-- 긴 학생 정리본 전체를 여러 번 정규식으로 정리하기 전에 원문에서 정확한
-- 검색어를 찾는다. 공백·구두점이 다른 경우에는 분리된 글자 위치를 찾는다.
create or replace function public.lecture_search_result_snippet(
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
  source_text text := coalesce(input_text, '');
  needle text := lower(btrim(coalesce(query_text, '')));
  compact_needle text := public.compact_search_text(query_text);
  match_at integer;
  safe_radius integer := greatest(40, least(coalesce(radius, 120), 240));
  snippet_start integer;
  snippet_length integer := safe_radius * 2 + 80;
  result text;
begin
  if needle = '' then
    return null;
  end if;

  match_at := strpos(lower(source_text), needle);
  if match_at = 0 and compact_needle <> '' then
    match_at := regexp_instr(
      source_text,
      regexp_replace(compact_needle, '(.)', '\1[^[:alnum:]가-힣]*', 'g'),
      1, 1, 0, 'i'
    );
  end if;
  if match_at = 0 then
    select min(nullif(strpos(lower(source_text), term), 0))
      into match_at
    from unnest(public.search_query_terms(query_text)) as split(term);
  end if;
  if match_at is null or match_at = 0 then
    return null;
  end if;

  snippet_start := greatest(1, match_at - safe_radius);
  result := regexp_replace(
    substring(source_text from snippet_start for snippet_length),
    '[[:space:]]+', ' ', 'g'
  );
  if snippet_start > 1 then
    result := '…' || result;
  end if;
  if snippet_start + snippet_length <= length(source_text) then
    result := result || '…';
  end if;
  return result;
end;
$$;

revoke all on function public.lecture_search_result_snippet(text, text, integer)
  from public, anon;
grant execute on function public.lecture_search_result_snippet(text, text, integer)
  to authenticated, service_role;

comment on function public.lecture_search_result_snippet(text, text, integer) is
  '긴 강의록 필기본에서 일치 위치 주변의 짧은 문맥을 만든다.';

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
      case
        when cardinality(q.terms) = 1 then
          case when strpos(lower(p.text_content), q.terms[1]) > 0
            then 4.0::real else 3.5::real end
        else public.search_text_rank(p.text_content, p_query)
      end as rank
    from public.lecture_page_texts p
    cross join query_parts q
    where q.compact_phrase <> ''
      -- 영문·숫자 한 글자는 거의 모든 PDF 페이지와 필기본에 등장하므로
      -- 제목·교수·과정 메타데이터에서만 검색한다.
      and not (
        char_length(q.compact_phrase) = 1
        and q.compact_phrase ~ '^[a-z0-9]$'
      )
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
  ),
  -- 페이지 후보를 강의록별로 한 번만 정렬·집계한다. 이전 구현은 모든 후보를
  -- 730여 강의록마다 다시 훑고, 각 후보의 긴 본문으로 snippet을 계산했다.
  ranked_page_candidates as materialized (
    select
      candidate.lecture_id,
      candidate.page_number,
      candidate.rank,
      count(*) over (partition by candidate.lecture_id)::integer as page_count,
      row_number() over (
        partition by candidate.lecture_id
        order by candidate.rank desc, candidate.page_number
      ) as page_order
    from page_candidates candidate
  ),
  best_page_candidates as materialized (
    select lecture_id, page_number, rank, page_count
    from ranked_page_candidates
    where page_order = 1
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
    best_page.page_number,
    public.lecture_search_result_snippet(best_page_text.text_content, p_query, 90),
    coalesce(best_page.page_count, 0)::integer,
    note_matched.note_id,
    note_matched.title,
    public.lecture_search_result_snippet(note_matched.content_text, p_query, 120),
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
  left join best_page_candidates best_page on best_page.lecture_id = d.id
  left join public.lecture_page_texts best_page_text
    on best_page_text.lecture_id = best_page.lecture_id
   and best_page_text.page_number = best_page.page_number
  left join lateral (
    select
      candidate.note_id,
      candidate.title,
      candidate.content_text,
      candidate.note_count,
      candidate.rank
    from (
      select
        ranked.note_id,
        ranked.title,
        ranked.content_text,
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
          and not (
            char_length(q.compact_phrase) = 1
            and q.compact_phrase ~ '^[a-z0-9]$'
          )
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
      or best_page.page_number is not null
      or note_matched.note_id is not null
    )
  order by
    greatest(
      case when metadata.rank > 0 then metadata.rank + 0.25 else 0 end,
      coalesce(best_page.rank, 0),
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
  '권한을 한 번 계산하고 페이지 후보를 강의록별로 한 번만 집계해 본문을 검색한다.';

commit;
