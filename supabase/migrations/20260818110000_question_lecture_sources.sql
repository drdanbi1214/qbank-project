-- 출제 강의는 학습 단원과 다른 출처 정보다. 강의 제목/교수명을 한 번만 저장하고
-- 문항에 연결한다. 강의록 파일은 theory_document_id에 나중에 연결할 수 있다.
create table public.lecture_sources (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects(id) on delete cascade,
  curriculum          text,
  title               text not null check (btrim(title) <> ''),
  professor           text,
  theory_document_id  uuid references public.theory_documents(id) on delete set null,
  source_key          text,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index lecture_sources_subject_curriculum_key_unique
  on public.lecture_sources (subject_id, curriculum, source_key)
  where source_key is not null;

create index lecture_sources_subject_order_idx
  on public.lecture_sources (subject_id, curriculum, sort_order, title);

create trigger lecture_sources_set_updated_at
  before update on public.lecture_sources
  for each row execute function public.set_updated_at();

create table public.question_lecture_sources (
  question_id       uuid not null references public.questions(id) on delete cascade,
  lecture_source_id uuid not null references public.lecture_sources(id) on delete restrict,
  sort_order        int not null default 0,
  primary key (question_id, lecture_source_id)
);

create index question_lecture_sources_question_order_idx
  on public.question_lecture_sources (question_id, sort_order);

-- 정답 공개 뒤에만 화면에서 호출한다. 함수도 문항과 동일한 접근 권한을 검사한다.
create or replace function public.get_question_lecture_sources(p_question_id uuid)
returns table (
  id uuid,
  title text,
  professor text,
  theory_document_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.title, l.professor, l.theory_document_id
    from public.question_lecture_sources ql
    join public.lecture_sources l on l.id = ql.lecture_source_id
   where ql.question_id = p_question_id
     and (public.is_admin() or public.can_view_question(p_question_id))
   order by ql.sort_order, l.sort_order, l.title;
$$;

revoke all on function public.get_question_lecture_sources(uuid) from public, anon;
grant execute on function public.get_question_lecture_sources(uuid) to authenticated, service_role;

comment on table public.lecture_sources is
  '복기 원문에 적힌 출제 강의 제목·교수명. theory_document_id는 실제 강의록을 업로드한 뒤 연결한다.';
