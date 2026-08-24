-- 2026학년도 학생 강의 정리본을 강의록 PDF 옆에서 함께 읽고 검색한다.
-- 정리본은 메디프렙 권한이 있는 사용자와 관리자에게만 보인다. 화면에서만
-- 감추지 않고 RLS와 검색 함수 양쪽에서 같은 정책을 적용해 본문과 검색 문맥이
-- 권한 없는 계정으로 내려가지 않게 한다.

begin;

insert into public.access_permissions (
  key,
  name,
  description,
  kind,
  sort_order
)
values (
  'mediprep_lecture_notes_view',
  '메디프렙 강의정리본',
  '강의록 옆의 2026학년도 학생 정리본과 정리본 검색 결과를 봅니다.',
  'feature',
  35
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  kind = excluded.kind,
  sort_order = excluded.sort_order;

-- 관리자는 배포 직후 기능을 검수할 수 있어야 한다. 일반 회원은 사용자 관리의
-- 콘텐츠 권한 체크박스에서 명시적으로 부여한다.
insert into public.profile_permissions (profile_id, permission_key, granted_by)
select p.id, 'mediprep_lecture_notes_view', p.id
from public.profiles p
where p.role = 'admin'
on conflict (profile_id, permission_key) do nothing;

create table public.lecture_student_notes (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null
    references public.lecture_documents(id) on delete cascade,
  source_key text not null,
  source_course text,
  lecture_date date,
  title text not null,
  content_md text not null,
  -- Markdown 기호를 걷어낸 검색용 본문. 검색 문맥에도 이 값을 사용한다.
  content_text text not null,
  source_hash text not null,
  required_permission text not null default 'mediprep_lecture_notes_view'
    references public.access_permissions(key) on update cascade on delete restrict,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lecture_student_notes_lecture_source_key unique (lecture_id, source_key),
  constraint lecture_student_notes_source_key_not_blank check (btrim(source_key) <> ''),
  constraint lecture_student_notes_title_not_blank check (btrim(title) <> ''),
  constraint lecture_student_notes_content_not_blank check (btrim(content_md) <> ''),
  constraint lecture_student_notes_hash_format check (source_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.lecture_student_notes is
  '강의록 PDF에 연결된 학생 정리본 Markdown. 한 합본 PDF에 여러 정리본이 연결될 수 있다.';
comment on column public.lecture_student_notes.content_text is
  'Markdown 표시 문자를 제거한 권한 보호 검색용 본문.';

create index lecture_student_notes_lecture_idx
  on public.lecture_student_notes (lecture_id, sort_order, lecture_date, id);
create index lecture_student_notes_content_trgm_idx
  on public.lecture_student_notes using gin (content_text gin_trgm_ops);

create trigger lecture_student_notes_set_updated_at
  before update on public.lecture_student_notes
  for each row execute function public.set_updated_at();

alter table public.lecture_student_notes enable row level security;

create policy lecture_student_notes_select on public.lecture_student_notes
  for select to authenticated
  using (
    public.is_admin()
    or (is_published and public.has_permission(required_permission))
  );
create policy lecture_student_notes_insert on public.lecture_student_notes
  for insert to authenticated with check (public.is_admin());
create policy lecture_student_notes_update on public.lecture_student_notes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy lecture_student_notes_delete on public.lecture_student_notes
  for delete to authenticated using (public.is_admin());

revoke all on table public.lecture_student_notes from public, anon;
grant select, insert, update, delete on table public.lecture_student_notes to authenticated;
grant all on table public.lecture_student_notes to service_role;

-- 반환 열을 늘리므로 CREATE OR REPLACE가 아니라 서명을 명시해 교체한다.
-- 기존 화면은 추가 열을 무시할 수 있어 DB가 먼저 배포되어도 호환된다.
drop function public.search_lecture_documents(text, uuid, text, integer, integer);

create function public.search_lecture_documents(
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
  '권한에 맞춰 강의록 제목·교수·PDF 본문·학생 정리본을 낱말 AND로 검색한다.';

commit;
