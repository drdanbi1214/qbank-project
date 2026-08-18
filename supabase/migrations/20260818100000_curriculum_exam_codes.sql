-- 학년말고사 외 시험 묶음(예: 2026 2학년 1학기 계통Y)을 기존 학번 기출과
-- 구분한다. 기존 행은 NULL로 남기므로 현재 화면/데이터는 그대로 유지된다.
alter table public.exams
  add column if not exists curriculum text,
  add column if not exists exam_code text;

-- 같은 학번·과목 안에서도 여러 차수의 문제 번호가 다시 1번부터 시작한다.
-- exam_code가 있을 때만 차수 식별자의 중복을 막는다.
create unique index if not exists exams_cohort_subject_exam_code_unique
  on public.exams (cohort, subject_id, exam_code)
  where exam_code is not null;

comment on column public.exams.curriculum is
  '학번 위에 표시할 시험 묶음. 예: 2026 2학년 1학기 계통Y. NULL이면 기존 학년말고사 체계를 따른다.';
comment on column public.exams.exam_code is
  '같은 과목 안의 차수를 구별하는 짧은 식별자. 예: Y1, Y2, Y3. NULL이면 기존 학년말고사 코드 규칙을 따른다.';

-- 기존 학년말고사 코드는 외부 CSV/AI 풀이에서 이미 사용 중이므로 정확히
-- 7자리 규칙을 보존한다. 신규 차수 시험은 exam_code를 넣어 충돌 없는 코드를
-- 만든다. 예: 26-10-Y1-001 (26학번, 심혈관계, 계통Y 1차, 1번)
create or replace function public.question_code(q public.questions)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when e.exam_code is null then
      substring(e.cohort from '\d+') || s.code || lpad(q.question_number::text, 3, '0')
    else
      substring(e.cohort from '\d+') || '-' || s.code || '-' || e.exam_code || '-' || lpad(q.question_number::text, 3, '0')
  end
    from public.exams e
    join public.subjects s on s.id = e.subject_id
   where e.id = q.exam_id
     and s.code is not null;
$$;
