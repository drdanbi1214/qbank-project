-- 콘텐츠 가시성 2단계 — 공개범위 컬럼의 규칙을 스키마에 적어둔다.
--
-- 1단계 주석에는 "작성 화면이 값을 명시적으로 보내면 solutions 의 컬럼
-- 기본값을 지운다"고 적어두었으나, 실제로 2단계를 만들면서 기본값을
-- 남겨두기로 했다. 값을 빠뜨렸을 때 실수로 전체공개가 되는 것보다
-- 스터디 전용으로 남는 쪽이 안전하고, 그 권한이 없는 사람이 빠뜨리면
-- RLS 의 WITH CHECK 에 걸려 조용히 넘어가지 않고 오류가 나기 때문이다.

comment on column public.solutions.required_permission is
  '이 풀이를 읽는 데 필요한 권한. null 이면 전체공개. 작성 화면이 항상 명시해서 보내지만, 빠뜨렸을 때 실수로 전체공개가 되지 않도록 기본값(study_hapbon3)을 남겨둔다.';

comment on column public.exams.required_permission is
  '이 시험의 문제를 보는 데 필요한 권한. null 이면 전체공개.';

comment on column public.profiles.default_solution_permission is
  '풀이를 쓸 때 기본으로 고르는 공개범위. 마지막에 쓴 값을 기억해둔다. null 이면 전체공개.';

comment on column public.access_permissions.kind is
  'feature: 기능 권한, study: 스터디 그룹(이 권한으로 쓴 풀이는 같은 권한자만 읽는다), cohort: 학번별 문제 열람.';
