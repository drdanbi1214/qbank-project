-- AI 풀이와 선배해설에도 사용자별 텍스트 표시를 저장한다.
-- text_marks는 RLS로 auth.uid() 본인 행만 읽고 쓸 수 있으므로 표시가 계정 간 섞이지 않는다.

alter table public.text_marks
  drop constraint if exists text_marks_target_type_check;

alter table public.text_marks
  add constraint text_marks_target_type_check
  check (target_type in (
    'question',
    'explanation',
    'solution',
    'ai_solution',
    'senior_solution'
  ));
