-- Page-aware lecture search.
--
-- lecture_documents.text_content intentionally remains in place as a rollback
-- and compatibility path.  The new table is a derived search index: no PDF or
-- existing lecture row is rewritten or deleted by this migration.

begin;

create table public.lecture_page_texts (
  lecture_id uuid not null references public.lecture_documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  text_content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lecture_id, page_number)
);

create index lecture_page_texts_content_trgm_idx
  on public.lecture_page_texts using gin (text_content gin_trgm_ops);

create trigger lecture_page_texts_set_updated_at
  before update on public.lecture_page_texts
  for each row execute function public.set_updated_at();

alter table public.lecture_page_texts enable row level security;

create policy lecture_page_texts_select on public.lecture_page_texts
  for select to authenticated
  using (
    exists (
      select 1
      from public.lecture_documents d
      where d.id = lecture_id
        and (
          public.is_admin()
          or (d.is_published and public.has_content_access(d.required_permission))
        )
    )
  );

-- Page text is generated only by the trusted import/backfill scripts.  The
-- browser can search it but cannot alter the derived index directly.
revoke all on table public.lecture_page_texts from public, anon, authenticated;
grant select on table public.lecture_page_texts to authenticated;

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
  needle text := btrim(coalesce(query_text, ''));
  match_at integer;
  snippet_start integer;
  snippet_length integer;
  result text;
begin
  if needle = '' then
    return null;
  end if;

  match_at := strpos(lower(cleaned), lower(needle));
  if match_at = 0 then
    return null;
  end if;

  snippet_start := greatest(1, match_at - greatest(30, least(coalesce(radius, 90), 180)));
  snippet_length := length(needle) + greatest(30, least(coalesce(radius, 90), 180)) * 2;
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

revoke all on function public.lecture_search_snippet(text, text, integer)
  from public, anon;
grant execute on function public.lecture_search_snippet(text, text, integer)
  to authenticated, service_role;

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
  left join lateral (
    select
      p.page_number,
      public.lecture_search_snippet(p.text_content, p_query) as snippet,
      count(*) over ()::integer as page_count
    from public.lecture_page_texts p
    where p.lecture_id = d.id
      and strpos(lower(p.text_content), lower(btrim(p_query))) > 0
    order by p.page_number
    limit 1
  ) matched on true
  where btrim(coalesce(p_query, '')) <> ''
    and (p_category_id is null or d.category_id = p_category_id)
    and (p_professor is null or d.professor = p_professor)
    and (p_year is null or d.lecture_year = p_year)
    and (
      strpos(lower(d.title), lower(btrim(p_query))) > 0
      or matched.page_number is not null
    )
  order by
    (strpos(lower(d.title), lower(btrim(p_query))) > 0) desc,
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

comment on table public.lecture_page_texts is
  '강의록 PDF에서 추출한 페이지별 검색 색인. PDF 원본과 lecture_documents가 기준 데이터다.';
comment on function public.search_lecture_documents(text, uuid, text, integer, integer) is
  '권한이 있는 강의록을 제목·본문에서 찾고 첫 일치 쪽과 주변 문맥을 돌려준다.';

commit;
