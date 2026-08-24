-- 강의록 검색을 입력 전체의 정확한 부분 문자열 비교에서 낱말 AND 검색으로 바꾼다.
-- PDF 텍스트는 원문의 공백이나 줄바꿈과 다르게 추출될 수 있으므로, 여러 낱말을
-- 입력했을 때 같은 쪽에 그 낱말이 모두 있으면 순서와 사이 공백에 관계없이 찾는다.

begin;

create or replace function public.lecture_search_snippet(
  input_text text,
  query_text text,
  radius integer default 90
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text := regexp_replace(coalesce(input_text, ''), '[[:space:]]+', ' ', 'g');
  terms text[];
  exact_at integer;
  match_at integer;
  snippet_start integer;
  snippet_length integer;
  result text;
begin
  select coalesce(array_agg(distinct term order by term), '{}'::text[])
    into terms
    from regexp_split_to_table(
      lower(btrim(coalesce(query_text, ''))),
      '[^[:alnum:]가-힣]+'
    ) as split(term)
   where term <> '';

  if cardinality(terms) = 0 then
    return null;
  end if;

  exact_at := strpos(lower(cleaned), lower(btrim(query_text)));
  if exact_at > 0 then
    match_at := exact_at;
  else
    select min(nullif(strpos(lower(cleaned), term), 0))
      into match_at
      from unnest(terms) as split(term);
  end if;
  -- 한 낱말 안에 PDF 추출 공백이 끼어 `ABC`가 `A B C`가 된 경우에는
  -- 온전한 term 위치가 없다. 첫 글자 위치라도 잡아 관련 문맥은 보여 준다.
  if match_at is null then
    select min(nullif(strpos(lower(cleaned), left(term, 1)), 0))
      into match_at
      from unnest(terms) as split(term);
  end if;
  if match_at is null then
    return null;
  end if;

  snippet_start := greatest(1, match_at - greatest(30, least(coalesce(radius, 90), 180)));
  snippet_length := greatest(30, least(coalesce(radius, 90), 180)) * 2 + 40;
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
  with query_terms as (
    select
      coalesce(array_agg(distinct term order by term), '{}'::text[]) as terms,
      lower(btrim(coalesce(p_query, ''))) as phrase,
      regexp_replace(lower(btrim(coalesce(p_query, ''))), '[[:space:]]+', '', 'g') as compact_phrase
    from regexp_split_to_table(
      lower(btrim(coalesce(p_query, ''))),
      '[^[:alnum:]가-힣]+'
    ) as split(term)
    where term <> ''
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
  cross join query_terms q
  cross join lateral (
    select case
      when strpos(lower(concat_ws(' ', d.title, d.professor, d.curriculum)), q.phrase) > 0 then 3
      when strpos(
        regexp_replace(
          lower(concat_ws(' ', d.title, d.professor, d.curriculum)),
          '[[:space:]]+',
          '',
          'g'
        ),
        q.compact_phrase
      ) > 0 then 2
      when not exists (
        select 1
        from unnest(q.terms) as split(term)
        where concat_ws(' ', d.title, d.professor, d.curriculum) not ilike '%' || term || '%'
      ) then 1
      else 0
    end as rank
  ) metadata
  left join lateral (
    select
      candidate.page_number,
      public.lecture_search_snippet(candidate.text_content, p_query) as snippet,
      candidate.page_count,
      candidate.rank
    from (
      select
        p.page_number,
        p.text_content,
        count(*) over ()::integer as page_count,
        case
          when strpos(lower(p.text_content), q.phrase) > 0 then 3
          when strpos(
            regexp_replace(lower(p.text_content), '[[:space:]]+', '', 'g'),
            q.compact_phrase
          ) > 0 then 2
          else 1
        end as rank
      from public.lecture_page_texts p
      where p.lecture_id = d.id
        and (
          strpos(
            regexp_replace(lower(p.text_content), '[[:space:]]+', '', 'g'),
            q.compact_phrase
          ) > 0
          or not exists (
            select 1
            from unnest(q.terms) as split(term)
            where p.text_content not ilike '%' || term || '%'
          )
        )
    ) candidate
    order by candidate.rank desc, candidate.page_number
    limit 1
  ) matched on true
  where cardinality(q.terms) > 0
    and q.compact_phrase <> ''
    and (p_category_id is null or d.category_id = p_category_id)
    and (p_professor is null or d.professor = p_professor)
    and (p_year is null or d.lecture_year = p_year)
    and (metadata.rank > 0 or matched.page_number is not null)
  order by
    greatest(metadata.rank, coalesce(matched.rank, 0)) desc,
    metadata.rank desc,
    (matched.page_number is not null) desc,
    d.lecture_year desc nulls last,
    d.professor nulls last,
    d.sort_order,
    d.title
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.lecture_search_snippet(text, text, integer)
  from public, anon;
grant execute on function public.lecture_search_snippet(text, text, integer)
  to authenticated, service_role;

revoke all on function public.search_lecture_documents(text, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.search_lecture_documents(text, uuid, text, integer, integer)
  to authenticated, service_role;

comment on function public.search_lecture_documents(text, uuid, text, integer, integer) is
  '권한이 있는 강의록을 제목·교수·본문에서 낱말 AND로 찾고 첫 일치 쪽과 주변 문맥을 돌려준다.';

commit;
