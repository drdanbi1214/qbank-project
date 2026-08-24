-- 통합 검색에서 알렌(theory_documents)의 제목과 본문을 검색한다.
-- security invoker로 실행해 문서의 기존 RLS/required_permission을 그대로 적용한다.

begin;

alter table public.theory_documents
  add column if not exists search_text text
  generated always as (public.richtext_plain(content)) stored;

create index if not exists theory_documents_search_text_trgm_idx
  on public.theory_documents using gin (search_text gin_trgm_ops);

create or replace function public.search_theory_documents(
  p_query text,
  p_subject_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  subject_id uuid,
  unit_id uuid,
  title text,
  snippet text,
  score real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ranked.id,
    ranked.subject_id,
    ranked.unit_id,
    ranked.title,
    public.search_result_snippet(ranked.combined_text, p_query, 130),
    ranked.rank
  from (
    select
      d.id,
      d.subject_id,
      d.unit_id,
      d.title,
      concat_ws(' ', d.title, d.search_text) as combined_text,
      public.search_text_rank(concat_ws(' ', d.title, d.search_text), p_query) as rank,
      d.sort_order
    from public.theory_documents d
    where d.is_published
      and d.has_content
      and (p_subject_id is null or d.subject_id = p_subject_id)
  ) ranked
  where ranked.rank > 0
  order by ranked.rank desc, ranked.sort_order, ranked.title, ranked.id
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_theory_documents(text, uuid, integer)
  from public, anon;
grant execute on function public.search_theory_documents(text, uuid, integer)
  to authenticated, service_role;

comment on function public.search_theory_documents(text, uuid, integer) is
  '권한이 있는 알렌 문서를 제목·본문에서 낱말 AND로 검색하고 관련도순 문맥을 돌려준다.';

commit;
