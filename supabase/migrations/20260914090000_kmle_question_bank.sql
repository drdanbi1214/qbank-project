begin;

-- 기존 한양대 시험 문제와 새 국시 KMLE 문제를 한 테이블에서 안전하게
-- 구분한다. 풀이/오답/북마크 엔진은 공유하되 검색과 목록은 이 값으로 나뉜다.
alter table public.exams
  add column if not exists question_bank text not null default 'hanyang_2026';

alter table public.exams
  drop constraint if exists exams_question_bank_check;
alter table public.exams
  add constraint exams_question_bank_check
  check (question_bank in ('hanyang_2026', 'kmle'));

create index if not exists exams_question_bank_idx
  on public.exams (question_bank, subject_id, status);

comment on column public.exams.question_bank is
  '문제은행 구분. 기존 자료는 hanyang_2026, Allen에서 새로 수집한 국시는 kmle.';

-- Allen 수집 원본의 식별자와 부가 통계를 보존한다. 문제 본문이 우연히 같아도
-- 기존 한양대 문제와 합치지 않으며, 이 테이블 안의 allen_hash만 중복 방지에 쓴다.
create table if not exists public.kmle_sources (
  question_id uuid primary key references public.questions(id) on delete cascade,
  allen_hash text not null unique,
  allen_chapter text not null,
  allen_code text,
  choice_rates jsonb not null default '[]'::jsonb,
  source_url text,
  collected_at timestamptz,
  imported_at timestamptz not null default now()
);

comment on table public.kmle_sources is
  '국시 KMLE 문제의 Allen 수집 메타데이터. 한양대 문제와의 동일/유사 문제 연결에는 사용하지 않는다.';

-- 문제는 소제목 문서가 아니라 "1 순환기 총론" 같은 내용 없는 대제목에 달린다.
create table if not exists public.theory_questions (
  theory_document_id uuid not null references public.theory_documents(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  sort_order integer not null default 0,
  link_source text not null default 'import'
    check (link_source in ('import', 'manual')),
  created_at timestamptz not null default now(),
  primary key (theory_document_id, question_id)
);

create index if not exists theory_questions_question_idx
  on public.theory_questions (question_id);

alter table public.kmle_sources enable row level security;
alter table public.theory_questions enable row level security;

revoke all on public.kmle_sources, public.theory_questions from anon;
grant select on public.kmle_sources, public.theory_questions to authenticated;
grant all on public.kmle_sources, public.theory_questions to service_role;

drop policy if exists kmle_sources_select on public.kmle_sources;
create policy kmle_sources_select on public.kmle_sources
  for select to authenticated
  using (
    exists (
      select 1
      from public.questions q
      join public.exams e on e.id = q.exam_id
      where q.id = question_id
        and e.question_bank = 'kmle'
        and (public.is_admin() or public.has_content_access(e.required_permission))
    )
  );

drop policy if exists theory_questions_select on public.theory_questions;
create policy theory_questions_select on public.theory_questions
  for select to authenticated
  using (
    exists (
      select 1
      from public.questions q
      join public.exams e on e.id = q.exam_id
      where q.id = question_id
        and e.question_bank = 'kmle'
        and (public.is_admin() or public.has_content_access(e.required_permission))
    )
  );

-- 대제목 풀이 진입점. RLS와 같은 권한 검사를 함수 안에서도 적용한다.
create or replace function public.get_theory_question_ids(p_theory_document_id uuid)
returns table (question_id uuid, sort_order integer)
language sql
stable
security definer
set search_path = public
as $$
  select tq.question_id, tq.sort_order
  from public.theory_questions tq
  join public.questions q on q.id = tq.question_id
  join public.exams e on e.id = q.exam_id
  where tq.theory_document_id = p_theory_document_id
    and q.status = 'published'
    and e.question_bank = 'kmle'
    and (public.is_admin() or public.has_content_access(e.required_permission))
  order by tq.sort_order, q.question_number, q.id;
$$;

revoke all on function public.get_theory_question_ids(uuid) from public, anon;
grant execute on function public.get_theory_question_ids(uuid) to authenticated, service_role;

-- 기존 5인자 함수는 구버전 화면을 위해 남기고, 새 화면은 문제은행을 명시하는
-- 이 6인자 오버로드를 호출한다.
create or replace function public.search_questions(
  p_query text,
  p_question_bank text,
  p_include_solutions boolean default false,
  p_subject_id uuid default null,
  p_cohort text default null,
  p_limit integer default 50
)
returns table (
  question_id uuid,
  exam_id uuid,
  unit_id uuid,
  question_number integer,
  stem_text text,
  score real,
  matched_in text,
  snippet text
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  with needle as (
    select
      btrim(coalesce(p_query, '')) as raw,
      public.normalize_search_text(p_query) as norm,
      public.search_query_terms(p_query) as terms
  ),
  eligible_questions as (
    select
      q.id, q.exam_id, q.unit_id, q.group_id, q.question_number,
      q.stem_text, q.stem_norm, q.choices
    from public.questions q
    join public.exams e on e.id = q.exam_id
    where q.status = 'published'
      and e.question_bank = p_question_bank
      and (public.is_admin() or public.has_content_access(e.required_permission))
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  question_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      case
        when ranked.rank > 0 then (ranked.rank + 0.30)::real
        else (0.50 + coalesce(similarity(q.stem_norm, n.norm), 0))::real
      end as score,
      '문제'::text as matched_in,
      coalesce(public.search_result_snippet(q.stem_text, p_query), left(q.stem_text, 320)) as snippet
    from eligible_questions q
    cross join needle n
    cross join lateral (select public.search_text_rank(q.stem_text, p_query) as rank) ranked
    where n.raw <> ''
      and (
        ranked.rank > 0
        or (cardinality(n.terms) = 1 and n.norm <> '' and similarity(q.stem_norm, n.norm) > 0.15)
      )
  ),
  choice_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      (best.rank + 0.20)::real as score,
      '선지'::text as matched_in,
      public.search_result_snippet(best.text, p_query) as snippet
    from eligible_questions q
    cross join needle n
    cross join lateral (
      select candidate.text, candidate.rank
      from (
        select
          choice.value ->> 'text' as text,
          public.search_text_rank(choice.value ->> 'text', p_query) as rank
        from jsonb_array_elements(
          case when jsonb_typeof(q.choices) = 'array' then q.choices else '[]'::jsonb end
        ) as choice(value)
      ) candidate
      where candidate.rank > 0
      order by candidate.rank desc, length(candidate.text)
      limit 1
    ) best
    where n.raw <> ''
  ),
  solution_hits as (
    select
      q.id, q.exam_id, q.unit_id, q.question_number, q.stem_text,
      (ranked.rank + 0.10)::real as score,
      '풀이'::text as matched_in,
      public.search_result_snippet(ranked.plain_text, p_query) as snippet
    from public.solutions s
    join eligible_questions q
      on (s.question_id is not null and q.id = s.question_id)
      or (s.group_id is not null and q.group_id = s.group_id)
    cross join needle n
    cross join lateral (
      select plain.text as plain_text, public.search_text_rank(plain.text, p_query) as rank
      from (select public.richtext_plain(s.content) as text) plain
    ) ranked
    where p_include_solutions
      and n.raw <> ''
      and public.has_content_access(s.required_permission)
      and ranked.rank > 0
  ),
  merged as (
    select * from question_hits
    union all select * from choice_hits
    union all select * from solution_hits
  ),
  best_hits as (
    select distinct on (m.id)
      m.id, m.exam_id, m.unit_id, m.question_number, m.stem_text,
      m.score, m.matched_in, m.snippet
    from merged m
    order by m.id, m.score desc,
      case m.matched_in when '문제' then 1 when '선지' then 2 else 3 end
  )
  select
    b.id, b.exam_id, b.unit_id, b.question_number, b.stem_text,
    b.score, b.matched_in, b.snippet
  from best_hits b
  order by b.score desc, b.exam_id, b.question_number, b.id
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_questions(text, text, boolean, uuid, text, integer)
  from public, anon;
grant execute on function public.search_questions(text, text, boolean, uuid, text, integer)
  to authenticated, service_role;

comment on function public.search_questions(text, text, boolean, uuid, text, integer) is
  '문제은행을 분리해 문제·선지·풀이를 검색한다.';

-- 기존 학습하기의 단원/미분류 진도에는 KMLE를 넣지 않는다. KMLE는 이론
-- 대제목, 레옵스, 시험별 보기와 검색에서만 진입한다.
create or replace function public.get_progress_by_unit()
returns table(subject_id uuid, unit_id uuid, total_questions integer, solved_questions integer, correct_questions integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.subject_id,
         q.unit_id,
         count(*)::int,
         count(a.question_id)::int,
         count(*) filter (where a.is_correct)::int
    from public.questions q
    join public.exams e on e.id = q.exam_id
    left join lateral (
      select at.question_id, at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.status = 'published'
     and e.question_bank = 'hanyang_2026'
     and (public.is_admin() or public.has_content_access(e.required_permission))
   group by e.subject_id, q.unit_id;
$$;

commit;
