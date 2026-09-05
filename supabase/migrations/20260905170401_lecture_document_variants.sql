-- 강의록 후배 필기본(대체본).
--
-- 같은 강의록의 "필기가 되어 있는" 다른 PDF 를 레옵스처럼 특정 스터디원에게만
-- 보여 주기 위한 것이다. 원본 lecture_documents 행은 그대로 둔다 — 검색 색인,
-- 페이지 텍스트, 개인 필기, 학생 정리본은 전부 원본을 계속 가리킨다. 화면에서
-- "이 강의록을 다른 파일로 대신 그린다" 는 선택지만 하나 더 얹는다.
--
-- 별도 테이블인 이유:
--   * 대체본은 반드시 권한이 있어야 본다. 원본의 required_permission 처럼
--     null=활성 회원 전원으로 풀리면 안 된다.
--   * 한 강의록에 필기본이 여러 개(후배마다) 생길 수 있다.
--   * 원본 행의 유니크 제약(content_hash, file_path)·검색 트리거를 건드리지 않는다.
--
-- 파일은 원본과 같은 lecture-documents 버킷에 두되 경로 앞에 variants/ 를 붙여
-- 버킷에서 눈으로 구분되게 한다. 업로드는 관리자가 로컬 스크립트
-- (scripts/import_lecture_variants.py) 로만 한다. 웹 업로드 화면은 없다.

create table public.lecture_document_variants (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lecture_documents(id) on delete cascade,
  -- 대체본 종류. 화면은 이 값으로 토글 선택을 기억한다. 지금은 'annotated' 하나.
  kind text not null default 'annotated',
  -- 토글 버튼에 그대로 뜨는 이름. 예: '후배 필기본'
  label text not null,
  -- `<bucket>/<path>` 논리 경로. 실제 URL 이 아니다. 원본과 같은 규칙.
  file_path text not null,
  content_hash text not null,
  byte_size bigint,
  page_count int,
  -- 이 대체본을 볼 수 있는 권한. null 을 허용하지 않는다 — 대체본은 항상 제한된다.
  required_permission text not null references public.access_permissions(key) on delete restrict,
  is_published boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lecture_document_variants_content_hash_key unique (content_hash),
  constraint lecture_document_variants_file_path_key unique (file_path),
  constraint lecture_document_variants_label_not_blank check (btrim(label) <> ''),
  constraint lecture_document_variants_kind_not_blank check (btrim(kind) <> '')
);

comment on table public.lecture_document_variants is
  '강의록 원본과 짝을 이루는 대체 PDF(후배 필기본 등). 권한 있는 사람만 화면에서 선택해 본다.';
comment on column public.lecture_document_variants.kind is
  '대체본 종류. 화면은 이 값으로 마지막 토글 선택을 강의록마다가 아니라 종류 단위로 기억한다.';
comment on column public.lecture_document_variants.required_permission is
  '이 대체본을 볼 수 있는 권한 키. 후배 필기본은 study_legendob 를 쓴다.';

create index lecture_document_variants_lecture_idx
  on public.lecture_document_variants (lecture_id, sort_order, created_at);

create trigger lecture_document_variants_set_updated_at
  before update on public.lecture_document_variants
  for each row execute function public.set_updated_at();

alter table public.lecture_document_variants enable row level security;

-- 읽기: 발행된 대체본을 그 권한을 가진 사람이 본다. 관리자는 전부.
-- has_permission 은 활성 회원이면서 그 권한을 실제로 가진 경우만 참이다.
create policy lecture_document_variants_select on public.lecture_document_variants
  for select using (
    public.is_admin()
    or (is_published and public.has_permission(required_permission))
  );

-- 쓰기는 관리자만. 대량 등록은 로컬 스크립트가 관리자 키로 한다.
create policy lecture_document_variants_insert on public.lecture_document_variants
  for insert with check (public.is_admin());
create policy lecture_document_variants_update on public.lecture_document_variants
  for update using (public.is_admin()) with check (public.is_admin());
create policy lecture_document_variants_delete on public.lecture_document_variants
  for delete using (public.is_admin());

-- R2 게이트웨이가 객체마다 물어보는 인가 함수에 대체본 경로도 포함한다.
-- 원본과 같은 lecture-documents 버킷을 쓰므로 authorize_storage_object 의
-- 버킷 분기는 그대로 두고, 이 함수만 "원본 OR 대체본" 을 보게 넓힌다.
create or replace function public.can_read_lecture_document(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
        from public.lecture_documents d
       where d.file_path = 'lecture-documents/' || p_object_name
         and d.is_published
         and public.has_content_access(d.required_permission)
    )
    or exists (
      select 1
        from public.lecture_document_variants v
       where v.file_path = 'lecture-documents/' || p_object_name
         and v.is_published
         and public.has_permission(v.required_permission)
    );
$$;

revoke execute on function public.can_read_lecture_document(text) from public, anon, authenticated;
