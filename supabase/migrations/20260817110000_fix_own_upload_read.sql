-- 방금 올린 이미지가 편집기에서 안 보이던 문제를 고친다.
--
-- 20260816130000 에서 solution-images 읽기 조건을 "그 이미지를 참조하는
-- 풀이를 볼 수 있는가" 로 바꿨다. 저장된 풀이에는 맞는 기준이지만, 아직
-- 저장하지 않은 글에는 참조하는 풀이가 없다. 그래서 풀이를 쓰는 도중에
-- 이미지를 붙여넣으면
--   1. 업로드는 성공하고 (insert 정책은 can_write() 만 본다)
--   2. 표시하려고 발급하는 서명 URL 이 select 정책에 막혀 null 이 되고
--   3. 편집기에는 빈 점선 상자만 남는다
-- 저장해도 본문에는 경로만 있고 화면에는 아무것도 안 뜬다.
--
-- 같은 이유로 개인 노트·토론·공지 이미지는 참조하는 풀이가 영영 없어서
-- 계속 안 보였다(모두 solution-images 버킷을 쓴다). 강의록 첨부도 같다.
--
-- 그래서 두 가지를 더한다.
--   - 자기가 올린 파일은 언제나 읽는다. 작성 중·임시저장·개인 노트가 여기 걸린다.
--   - 토론·공지 본문이 참조하는 이미지는 그 글을 볼 수 있는 사람이 읽는다.

create or replace function public.can_read_solution_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
        from public.solutions s
       where s.content::text like '%solution-images/' || p_object_name || '%'
         and public.has_content_access(s.required_permission)
    )
    or exists (
      select 1
        from public.discussions d
       where d.content::text like '%solution-images/' || p_object_name || '%'
         and public.can_view_question(d.question_id)
    )
    or exists (
      select 1
        from public.discussion_replies r
        join public.discussions d on d.id = r.discussion_id
       where r.content::text like '%solution-images/' || p_object_name || '%'
         and public.can_view_question(d.question_id)
    )
    or exists (
      select 1
        from public.announcements a
       where a.content::text like '%solution-images/' || p_object_name || '%'
    );
$$;

grant execute on function public.can_read_solution_image(text) to authenticated;

create or replace function public.can_read_lecture_file(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
        from public.solutions s
       where s."references"::text like '%solution-lecture-files/' || p_object_name || '%'
         and public.has_content_access(s.required_permission)
    );
$$;

grant execute on function public.can_read_lecture_file(text) to authenticated;

-- owner 는 업로드한 사람이다. 정책에서 직접 볼 수 있으므로 함수에 넘기지 않는다.
-- 로그인한 사람만 읽도록 to authenticated 도 되살린다(이전 정책에서 빠졌다).
drop policy if exists qbank_storage_read on storage.objects;
create policy qbank_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('question-images', 'exam-sources')
    or (
      bucket_id = 'solution-images'
      and (owner = auth.uid() or public.can_read_solution_image(name))
    )
  );

drop policy if exists solution_lecture_files_read on storage.objects;
create policy solution_lecture_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'solution-lecture-files'
    and (owner = auth.uid() or public.can_read_lecture_file(name))
  );
