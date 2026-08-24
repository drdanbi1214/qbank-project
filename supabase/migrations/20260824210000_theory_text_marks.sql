-- 알렌(theory_documents) 본문에도 사용자별 형광펜과 글자 강조를 저장한다.
-- 기존 text_marks RLS가 auth.uid() 본인 행만 허용하므로 다른 사용자의 표시는
-- 보이거나 수정되지 않는다.

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
    'theory'
  ));

commit;
