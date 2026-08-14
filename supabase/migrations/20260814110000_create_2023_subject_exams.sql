-- 2023년(23학번) 학년말고사를 현재 등록된 모든 과목에 만든다.
-- 문제를 이 시험에 등록하면 question_code()가 23 + 과목코드 2자리 + 문항번호 3자리로 계산한다.
insert into public.exams (cohort, subject_id, exam_name)
select '23학번', subjects.id, '학년말고사'
from public.subjects
where subjects.code ~ '^\d{2}$'
on conflict (cohort, subject_id, exam_name) do nothing;
