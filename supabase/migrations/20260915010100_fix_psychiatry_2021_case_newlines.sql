-- The first repair intentionally preserved the three Q9 case lines, but the
-- SQL string used literal backslash-n characters. Store real line breaks for
-- the question renderer.
do $$
declare
  target_exam_id uuid;
begin
  select e.id
    into target_exam_id
  from public.exams e
  join public.subjects s on s.id = e.subject_id
  where s.name = '정신건강의학과'
    and e.cohort = '21학번'
    and e.exam_name = '학년말고사';

  if target_exam_id is null then
    raise exception '2021 psychiatry final exam was not found';
  end if;

  update public.questions
  set stem_blocks = jsonb_set(
    stem_blocks,
    '{1,content}',
    to_jsonb(E'- 낯선 사람을 만날 때 예외없이 얼굴이 붉어지고 불편한 증상이 나타난다\n- 가족이랑 있을 때는 괜찮다.\n- 너무 힘들어서 학교도 그만두었다.'::text)
  )
  where exam_id = target_exam_id
    and question_number = 9;
end
$$;
