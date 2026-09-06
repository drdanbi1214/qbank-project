-- 원본 강의록뿐 아니라 각 대체본(후배 필기본)에도 서로 섞이지 않는 개인 필기를
-- 저장한다. 기존 행은 variant_id = null인 원본 필기로 그대로 유지한다.

begin;

alter table public.lecture_pdf_annotations
  add column variant_id uuid
    references public.lecture_document_variants(id) on delete cascade;

alter table public.lecture_pdf_annotations
  add column document_id uuid generated always as (
    coalesce(variant_id, lecture_id)
  ) stored;

alter table public.lecture_pdf_annotations
  drop constraint lecture_pdf_annotations_pkey;

alter table public.lecture_pdf_annotations
  add constraint lecture_pdf_annotations_pkey
  primary key (user_id, document_id, page_number);

drop index if exists public.lecture_pdf_annotations_lecture_user_idx;
create index lecture_pdf_annotations_lecture_user_idx
  on public.lecture_pdf_annotations (lecture_id, variant_id, user_id, page_number);

comment on column public.lecture_pdf_annotations.variant_id is
  'null이면 원본 강의록, 값이 있으면 해당 lecture_document_variants PDF 위의 개인 필기';
comment on column public.lecture_pdf_annotations.document_id is
  'Realtime 조회와 고유 키에 쓰는 실제 PDF 식별자(원본 lecture_id 또는 variant_id)';

-- 배포 전 화면이 잠시 기존 4인자 RPC를 호출해도 원본 필기는 계속 저장된다.
-- PK가 document_id를 쓰므로 충돌 대상을 열 이름으로 지정하지 않고 전체 고유
-- 제약에 맡긴다.
create or replace function public.save_lecture_pdf_annotations(
  p_lecture_id uuid,
  p_page_number integer,
  p_marks jsonb,
  p_expected_revision bigint default null
)
returns table (
  save_status text,
  server_marks jsonb,
  server_revision bigint,
  server_updated_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  saved public.lecture_pdf_annotations%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if not public.can_write() then
    raise exception '필기를 저장할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_page_number <= 0 then
    raise exception '쪽 번호가 올바르지 않습니다.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_marks) is distinct from 'array' then
    raise exception '필기 데이터는 배열이어야 합니다.' using errcode = '22023';
  end if;

  if p_expected_revision is null then
    insert into public.lecture_pdf_annotations (
      user_id, lecture_id, variant_id, page_number, marks, revision
    )
    values (auth.uid(), p_lecture_id, null, p_page_number, p_marks, 1)
    on conflict do nothing
    returning * into saved;
  else
    update public.lecture_pdf_annotations
       set marks = p_marks,
           revision = revision + 1
     where user_id = auth.uid()
       and lecture_id = p_lecture_id
       and variant_id is null
       and page_number = p_page_number
       and revision = p_expected_revision
    returning * into saved;
  end if;

  if saved.user_id is not null then
    return query
      select 'saved'::text, saved.marks, saved.revision, saved.updated_at;
    return;
  end if;

  return query
    select
      'conflict'::text,
      coalesce(current_row.marks, '[]'::jsonb),
      current_row.revision,
      current_row.updated_at
    from (values (1)) as singleton(placeholder)
    left join public.lecture_pdf_annotations current_row
      on current_row.user_id = auth.uid()
     and current_row.lecture_id = p_lecture_id
     and current_row.variant_id is null
     and current_row.page_number = p_page_number;
end;
$$;

-- 새 화면은 원본과 대체본을 명시해서 이 RPC를 호출한다. 대체본은 반드시 같은
-- 강의록에 속하고, 현재 계정에서 목록으로 읽을 수 있는 행이어야 한다.
create or replace function public.save_lecture_pdf_annotations_for_document(
  p_lecture_id uuid,
  p_variant_id uuid,
  p_page_number integer,
  p_marks jsonb,
  p_expected_revision bigint default null
)
returns table (
  save_status text,
  server_marks jsonb,
  server_revision bigint,
  server_updated_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  saved public.lecture_pdf_annotations%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if not public.can_write() then
    raise exception '필기를 저장할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_page_number <= 0 then
    raise exception '쪽 번호가 올바르지 않습니다.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_marks) is distinct from 'array' then
    raise exception '필기 데이터는 배열이어야 합니다.' using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (
    select 1
      from public.lecture_document_variants variant
     where variant.id = p_variant_id
       and variant.lecture_id = p_lecture_id
  ) then
    raise exception '이 강의록에서 사용할 수 없는 필기본입니다.' using errcode = '42501';
  end if;

  if p_expected_revision is null then
    insert into public.lecture_pdf_annotations (
      user_id, lecture_id, variant_id, page_number, marks, revision
    )
    values (auth.uid(), p_lecture_id, p_variant_id, p_page_number, p_marks, 1)
    on conflict do nothing
    returning * into saved;
  else
    update public.lecture_pdf_annotations
       set marks = p_marks,
           revision = revision + 1
     where user_id = auth.uid()
       and lecture_id = p_lecture_id
       and variant_id is not distinct from p_variant_id
       and page_number = p_page_number
       and revision = p_expected_revision
    returning * into saved;
  end if;

  if saved.user_id is not null then
    return query
      select 'saved'::text, saved.marks, saved.revision, saved.updated_at;
    return;
  end if;

  return query
    select
      'conflict'::text,
      coalesce(current_row.marks, '[]'::jsonb),
      current_row.revision,
      current_row.updated_at
    from (values (1)) as singleton(placeholder)
    left join public.lecture_pdf_annotations current_row
      on current_row.user_id = auth.uid()
     and current_row.lecture_id = p_lecture_id
     and current_row.variant_id is not distinct from p_variant_id
     and current_row.page_number = p_page_number;
end;
$$;

comment on function public.save_lecture_pdf_annotations_for_document(uuid, uuid, integer, jsonb, bigint) is
  '원본 또는 지정한 대체본 PDF의 개인 필기를 revision 충돌 없이 저장한다.';

revoke all on function public.save_lecture_pdf_annotations_for_document(uuid, uuid, integer, jsonb, bigint)
  from public, anon;
grant execute on function public.save_lecture_pdf_annotations_for_document(uuid, uuid, integer, jsonb, bigint)
  to authenticated, service_role;

-- PK가 바뀐 뒤에도 DELETE Realtime payload에서 대상 정보를 모두 받을 수 있게 한다.
alter table public.lecture_pdf_annotations replica identity full;

commit;
