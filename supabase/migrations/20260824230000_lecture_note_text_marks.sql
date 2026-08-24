-- 강의록 옆 요약정리본에도 사용자별 형광펜과 글자 강조를 저장한다.
-- text_marks의 기존 RLS가 auth.uid() 본인 행만 허용하므로 계정 간 표시는 섞이지 않는다.

begin;

alter table public.text_marks
  drop constraint if exists text_marks_target_type_check;

alter table public.text_marks
  add constraint text_marks_target_type_check
  check (target_type in (
    'question',
    'explanation',
    'solution',
    'ai_solution',
    'senior_solution',
    'theory',
    'lecture_note'
  ));

commit;
