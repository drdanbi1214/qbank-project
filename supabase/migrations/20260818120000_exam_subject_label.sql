-- 시험 출처의 계통명과 실제 학습 과목을 분리한다.
-- 예: 계통Y 심혈관계 시험은 시험별 보기에서는 '심혈관계'로 보이지만,
-- 문항·단원·이론은 기존 '내과 > 심장내과'에 계속 귀속된다.
alter table public.exams
  add column if not exists exam_subject_label text;

comment on column public.exams.exam_subject_label is
  '시험별 보기 전용 과목명. NULL이면 실제 학습 과목(subject_id)의 이름을 사용한다.';
