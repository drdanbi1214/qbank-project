-- 알렌을 합본3 스터디 권한에서 분리해 승인된 회원 모두가 읽게 한다.
-- 메뉴만 여는 것으로는 본문 RLS와 이미지 서명이 계속 막히므로 문서·백업
-- Storage·R2 게이트웨이의 읽기 조건을 한 번에 맞춘다. 쓰기는 계속 관리자만 한다.

begin;

alter table public.theory_documents
  alter column required_permission drop not null,
  alter column required_permission drop default;

update public.theory_documents
   set required_permission = null
 where required_permission = 'study_hapbon3';

drop policy if exists theory_documents_select on public.theory_documents;
create policy theory_documents_select on public.theory_documents
  for select to authenticated
  using (is_published and public.is_active_member());

-- R2 이전 전 Supabase Storage 사본을 읽는 복구 경로도 같은 범위로 연다.
drop policy if exists theory_images_select on storage.objects;
create policy theory_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'theory-images' and public.is_active_member());

-- R2 Worker가 사용자 JWT로 호출하는 현재 운영 파일 인가 함수.
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
      when 'theory-images' then true
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
  from public, anon;
grant execute on function public.authorize_storage_object(text, text, text)
  to authenticated;

comment on column public.theory_documents.required_permission is
  '알렌은 승인 회원 전체 공개이므로 현재 null을 사용한다. 기존 컬럼은 이전 자료 호환을 위해 유지한다.';

commit;
