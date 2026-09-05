-- 개인 PDF 필기의 다른 기기/탭 변경을 즉시 받을 수 있게 Realtime에 공개한다.
-- RLS가 활성화되어 있어 로그인 사용자는 자신의 행만 구독할 수 있다.

begin;

-- 배포 전 화면이 아직 열려 있어 예전 upsert를 보내더라도 revision이 반드시
-- 증가해야 새 화면이 변경을 놓치지 않는다. 새 RPC는 직접 +1 하므로 그대로 둔다.
create or replace function public.bump_lecture_pdf_annotation_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.revision <= old.revision then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists lecture_pdf_annotations_bump_revision
  on public.lecture_pdf_annotations;
create trigger lecture_pdf_annotations_bump_revision
  before update on public.lecture_pdf_annotations
  for each row execute function public.bump_lecture_pdf_annotation_revision();

revoke all on function public.bump_lecture_pdf_annotation_revision()
  from public, anon, authenticated;
grant execute on function public.bump_lecture_pdf_annotation_revision()
  to service_role;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'lecture_pdf_annotations'
  ) then
    alter publication supabase_realtime
      add table public.lecture_pdf_annotations;
  end if;
end;
$$;

commit;
