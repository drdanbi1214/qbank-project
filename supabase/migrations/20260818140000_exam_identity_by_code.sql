-- 계통Y처럼 같은 학번·과목 안에 여러 분야의 '1차'가 있을 수 있다.
-- 기존 제약은 (학번, 과목, 시험명)만으로 시험을 구분해 서로 다른 시험의
-- 등록을 막으므로, 코드가 있는 시험은 exam_code로 구분한다.
alter table public.exams
  drop constraint if exists exams_cohort_subject_id_exam_name_key;

-- exam_code가 없는 기존 학년말고사 행은 이전과 동일하게 시험명 조합을
-- 고유하게 유지한다. 코드가 있는 시험의 고유성은 20260818100000의
-- exams_cohort_subject_exam_code_unique 인덱스가 보장한다.
create unique index if not exists exams_legacy_cohort_subject_exam_name_unique
  on public.exams (cohort, subject_id, exam_name)
  where exam_code is null;
