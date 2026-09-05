-- 같은 사용자가 여러 기기/탭에서 한 PDF 쪽을 동시에 고쳐도 마지막 요청이
-- 앞선 필기를 조용히 덮어쓰지 않게 페이지별 수정 번호로 낙관적 잠금을 건다.

begin;

alter table public.lecture_pdf_annotations
  add column revision bigint not null default 1
  check (revision > 0);

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
      user_id, lecture_id, page_number, marks, revision
    )
    values (auth.uid(), p_lecture_id, p_page_number, p_marks, 1)
    on conflict (user_id, lecture_id, page_number) do nothing
    returning * into saved;
  else
    update public.lecture_pdf_annotations
       set marks = p_marks,
           revision = revision + 1
     where user_id = auth.uid()
       and lecture_id = p_lecture_id
       and page_number = p_page_number
       and revision = p_expected_revision
    returning * into saved;
  end if;

  if saved.user_id is not null then
    return query
      select 'saved'::text, saved.marks, saved.revision, saved.updated_at;
    return;
  end if;

  -- 행 삭제도 하나의 외부 변경으로 취급한다. 새 클라이언트는 빈 필기도 행으로
  -- 남기지만 배포 전 버전이 빈 페이지 행을 지웠을 수 있어 없는 행도 반환한다.
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
     and current_row.page_number = p_page_number;
end;
$$;

comment on function public.save_lecture_pdf_annotations(uuid, integer, jsonb, bigint) is
  '읽은 revision과 서버 revision이 같을 때만 개인 PDF 필기를 저장한다.';

revoke all on function public.save_lecture_pdf_annotations(uuid, integer, jsonb, bigint)
  from public, anon;
grant execute on function public.save_lecture_pdf_annotations(uuid, integer, jsonb, bigint)
  to authenticated, service_role;

commit;
