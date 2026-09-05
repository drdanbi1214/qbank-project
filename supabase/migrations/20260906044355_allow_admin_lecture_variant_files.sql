-- lecture_document_variants의 RLS는 관리자가 권한 키 없이도 행을 볼 수 있게
-- 하지만, R2 서명 인가 함수는 has_permission만 검사해 실제 PDF 열기는 막았다.
-- 원본과 대체본 모두 테이블 RLS와 동일하게 활성 관리자 우회를 허용한다.

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
         and (
           public.is_admin()
           or public.has_content_access(d.required_permission)
         )
    )
    or exists (
      select 1
        from public.lecture_document_variants v
       where v.file_path = 'lecture-documents/' || p_object_name
         and v.is_published
         and (
           public.is_admin()
           or public.has_permission(v.required_permission)
         )
    );
$$;

revoke execute on function public.can_read_lecture_document(text)
  from public, anon, authenticated;
