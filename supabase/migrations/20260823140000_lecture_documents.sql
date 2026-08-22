-- 강의록 라이브러리.
--
-- 지금까지 강의록은 풀이를 쓸 때마다 파일로 첨부했다. 같은 강의록을 여러 명이
-- 올리면 사람 수만큼 사본이 쌓이고, 교수님이 자료를 고쳐도 이미 올라간 사본을
-- 갈아끼울 방법이 없으며, 파일이라 본문 검색도 안 된다.
--
-- 그래서 강의록을 문서 한 건으로 등록해 두고 풀이는 그것을 가리키기만 하게
-- 바꾼다. 알렌(theory_documents)이 이미 같은 방식으로 동작하지만, 강의록은
-- 교수명으로 찾는 축이 핵심이고 PDF 원본을 그대로 보여주므로 이론 트리에
-- 얹지 않고 별도 테이블로 둔다.
--
-- 본문은 변환하지 않는다. PDF를 그대로 두고 화면에서 연속 스크롤로 읽는다.
-- R2 게이트웨이가 Range 요청을 지원해서 큰 파일도 보는 쪽만 내려받는다.
-- 대신 올릴 때 텍스트를 뽑아 text_content 에 넣어 문서 간 검색을 살린다.

create table public.lecture_documents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  title text not null,
  professor text,
  -- 어느 시험 묶음의 강의인지. exams.curriculum 과 같은 문자열을 쓴다.
  curriculum text,
  -- 판본 연도. 같은 강의의 다른 해는 각각 한 건으로 둔다.
  lecture_year int,
  -- `<bucket>/<path>` 형식. 실제 URL 이 아니라 논리 경로만 저장한다.
  file_path text not null,
  -- 같은 파일이 두 번 올라가는 것을 막는다. 중복 업로드 시 기존 건을 가리킨다.
  content_hash text not null,
  byte_size bigint,
  page_count int,
  -- 검색용으로 뽑아 둔 본문. 스캔본은 글자가 이미지라 비어 있을 수 있다.
  text_content text,
  -- null 이면 활성 회원 전원이 본다. has_content_access 가 그렇게 해석한다.
  required_permission text references public.access_permissions(key) on delete set null,
  is_published boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lecture_documents_content_hash_key unique (content_hash),
  constraint lecture_documents_file_path_key unique (file_path),
  constraint lecture_documents_title_not_blank check (btrim(title) <> '')
);

comment on table public.lecture_documents is
  '강의록 원본 PDF 한 부와 그 메타데이터. 풀이는 파일을 첨부하지 않고 이 문서를 참조한다.';
comment on column public.lecture_documents.content_hash is
  '파일 내용의 SHA-256. 유니크라서 같은 파일을 두 번 등록할 수 없다.';
comment on column public.lecture_documents.text_content is
  '검색용으로 추출한 본문. 비어 있으면 스캔본이라 제목·교수로만 찾을 수 있다.';

create index lecture_documents_subject_idx on public.lecture_documents (subject_id, lecture_year desc, sort_order);
create index lecture_documents_professor_idx on public.lecture_documents (professor) where professor is not null;
create index lecture_documents_curriculum_idx on public.lecture_documents (curriculum) where curriculum is not null;

-- 한국어는 Postgres 기본 전문검색 설정이 없어 형태소로 못 나눈다. 부분 문자열로
-- 찾는 편이 실제 검색어("심부전", "판막")와 잘 맞아 트라이그램 색인을 쓴다.
create index lecture_documents_title_trgm_idx on public.lecture_documents using gin (title gin_trgm_ops);
create index lecture_documents_text_trgm_idx on public.lecture_documents using gin (text_content gin_trgm_ops);

create trigger lecture_documents_set_updated_at
  before update on public.lecture_documents
  for each row execute function public.set_updated_at();

alter table public.lecture_documents enable row level security;

-- 읽기: 발행된 문서를 활성 회원이 본다. required_permission 이 있으면 그 권한도 필요하다.
create policy lecture_documents_select on public.lecture_documents
  for select using (
    public.is_admin()
    or (is_published and public.has_content_access(required_permission))
  );

-- 등록·수정·삭제는 관리자만 한다. 중복인지 아닌지 판단할 사람을 한 명으로 좁혀
-- 라이브러리가 깨끗하게 유지되도록 한 결정이다.
create policy lecture_documents_insert on public.lecture_documents
  for insert with check (public.is_admin());
create policy lecture_documents_update on public.lecture_documents
  for update using (public.is_admin()) with check (public.is_admin());
create policy lecture_documents_delete on public.lecture_documents
  for delete using (public.is_admin());

-- R2 게이트웨이가 객체마다 물어보는 인가 함수에 강의록 버킷을 등록한다.
-- 읽기 권한은 파일 자체가 아니라 그 파일을 가리키는 문서 행을 따른다.
create or replace function public.can_read_lecture_document(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.lecture_documents d
     where d.file_path = 'lecture-documents/' || p_object_name
       and d.is_published
       and public.has_content_access(d.required_permission)
  );
$$;

revoke execute on function public.can_read_lecture_document(text) from public, anon, authenticated;

create or replace function public.authorize_storage_object(
  p_bucket text,
  p_object_name text,
  p_operation text default 'read'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owns_path boolean;
begin
  if v_user_id is null
     or p_bucket is null
     or p_object_name is null
     or p_object_name = ''
     or length(p_object_name) > 1024
     or left(p_object_name, 1) = '/'
     or p_object_name like '%//%'
     or p_object_name like E'%\\%'
     or p_object_name ~ '(^|/)\.{1,2}(/|$)'
     or p_object_name ~ '[[:cntrl:]]'
  then
    return false;
  end if;

  if p_bucket not in (
    'question-images',
    'solution-images',
    'exam-sources',
    'avatars',
    'theory-images',
    'ai-solution-images',
    'senior-solution-images',
    'solution-lecture-files',
    'topic-images',
    'lecture-documents'
  ) then
    return false;
  end if;

  v_owns_path := split_part(p_object_name, '/', 1) = v_user_id::text;

  if p_operation = 'read' then
    if not public.is_active_member() then
      return false;
    end if;

    return case p_bucket
      when 'question-images' then
        v_owns_path or public.can_read_question_image(p_object_name)
      when 'exam-sources' then
        public.is_admin() or public.can_read_exam_source(p_object_name)
      when 'avatars' then true
      when 'solution-images' then
        v_owns_path or public.can_read_solution_image(p_object_name)
      when 'solution-lecture-files' then
        v_owns_path or public.can_read_lecture_file(p_object_name)
      when 'lecture-documents' then
        public.can_read_lecture_document(p_object_name)
      when 'theory-images' then
        public.has_permission('study_hapbon3')
      when 'ai-solution-images' then
        public.has_permission('ai_solution_view')
      when 'senior-solution-images' then
        public.has_permission('senior_solution_view')
      when 'topic-images' then
        public.is_admin() or public.has_permission('study_legendob')
      else false
    end;
  end if;

  if p_operation = 'upload' then
    -- 강의록은 사용자 id 로 시작하는 경로를 쓰지 않으므로 이 검사에서 걸린다.
    -- 의도한 것이다. 대량 등록은 관리자가 로컬 스크립트로 내부 엔드포인트를
    -- 통해 올리고, 브라우저에서는 강의록 파일을 올릴 수 없다.
    if not v_owns_path or not public.can_write() then
      return false;
    end if;

    return case p_bucket
      when 'question-images' then true
      when 'solution-images' then true
      when 'exam-sources' then public.is_admin()
      when 'avatars' then true
      when 'solution-lecture-files' then true
      when 'theory-images' then public.is_admin()
      when 'ai-solution-images' then public.is_admin()
      when 'senior-solution-images' then public.is_admin()
      when 'topic-images' then
        public.is_admin() or public.has_permission('study_legendob')
      else false
    end;
  end if;

  return false;
end;
$$;

revoke execute on function public.authorize_storage_object(text, text, text)
  from public, anon, authenticated;
grant execute on function public.authorize_storage_object(text, text, text)
  to service_role;
