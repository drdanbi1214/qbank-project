-- 기존 사용자에게 부여된 권한은 유지하면서 관리자 화면의 표시 이름만 바꾼다.
-- 내부 키는 RLS와 등록 데이터가 계속 같은 권한을 가리키도록 변경하지 않는다.

begin;

update public.access_permissions
set
  name = '요약정리노트 권한',
  description = '강의록 옆의 2026학년도 학생 요약정리본과 요약정리본 검색 결과를 봅니다.'
where key = 'mediprep_lecture_notes_view';

commit;
