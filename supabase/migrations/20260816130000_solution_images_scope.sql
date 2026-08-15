-- 풀이 이미지 열람 조건을 풀이의 공개범위에서 끌어온다.
--
-- 지금 정책은 'study_hapbon3' 을 직접 박아 두고 있다. 스터디 그룹이
-- 하나뿐일 때는 맞았지만, 그룹이 늘면 세 방향으로 틀린다.
--   - 네잎클로버만 가진 사람은 자기 그룹 풀이의 이미지를 못 본다
--   - 합본3 가진 사람이 네잎클로버 풀이의 이미지를 볼 수 있다
--   - 전체공개 풀이의 이미지를 아무 그룹도 없는 사람이 못 본다
--
-- 그래서 키를 박는 대신, 그 이미지를 참조하는 풀이를 볼 수 있는지로
-- 판단한다. 풀이 본문은 이미 RLS 로 막혀 있으니 판단 기준이 하나가 된다.
--
-- 본문에서 경로를 찾는 건 풀이 수가 적어 부담이 없다. 나중에 풀이가
-- 많이 쌓이면 이미지 경로를 따로 컬럼에 뽑아 두는 편이 낫다.

create or replace function public.can_read_solution_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.solutions s
     where s.content::text like '%solution-images/' || p_object_name || '%'
       and public.has_content_access(s.required_permission)
  );
$$;

grant execute on function public.can_read_solution_image(text) to authenticated;

drop policy if exists qbank_storage_read on storage.objects;
create policy qbank_storage_read on storage.objects
  for select
  using (
    bucket_id in ('question-images', 'exam-sources')
    or (bucket_id = 'solution-images' and public.can_read_solution_image(name))
  );
