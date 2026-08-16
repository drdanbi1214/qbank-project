-- 강의록 첨부 열람 조건을 풀이의 공개범위에서 끌어온다.
--
-- solution-images 때와 같은 문제다. 읽기 정책에 'study_hapbon3' 이 직접
-- 박혀 있어 스터디 그룹이 늘면 틀린다. E조스터디만 가진 사람은 자기 그룹
-- 풀이에 붙은 강의록을 못 열고, 합본3 가진 사람은 남의 그룹 강의록을 연다.
--
-- 키를 박는 대신, 그 파일을 참조하는 풀이를 볼 수 있는지로 판단한다.
-- 강의록 경로는 solutions.references 의 url 에 들어간다.

create or replace function public.can_read_lecture_file(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.solutions s
     where s."references"::text like '%solution-lecture-files/' || p_object_name || '%'
       and public.has_content_access(s.required_permission)
  );
$$;

grant execute on function public.can_read_lecture_file(text) to authenticated;

drop policy if exists solution_lecture_files_read on storage.objects;
create policy solution_lecture_files_read on storage.objects
  for select
  using (
    bucket_id = 'solution-lecture-files'
    and public.can_read_lecture_file(name)
  );
