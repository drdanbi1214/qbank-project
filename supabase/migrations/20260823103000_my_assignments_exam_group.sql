-- 풀이 배정 화면을 "시험군 -> 과목" 두 단계로 묶기 위해 시험군을 판별할 값을
-- 배정 목록에 실어 보낸다.
--
-- curriculum 이 있으면 그것이 시험군(예: 2026 본 2-1 계통 Y), 없으면 기존
-- 학년말고사 체계라 cohort + exam_name 이 시험군이다.
-- exam_subject_label 은 계통 Y 처럼 과목(내과) 하나에 계통이 여러 개인 시험에서
-- 소제목으로 쓴다. 시험별 보기(ExamsPage)와 같은 규칙이다.
-- exam_date 는 시험군을 최신순으로 정렬하는 데 쓴다.

drop function if exists public.get_my_assignments();

create function public.get_my_assignments()
returns table (
  assignment_id       uuid,
  question_id         uuid,
  status              text,
  due_date            date,
  completed_at        timestamptz,
  subject_id          uuid,
  subject_name        text,
  unit_id             uuid,
  unit_name           text,
  exam_id             uuid,
  cohort              text,
  exam_name           text,
  curriculum          text,
  exam_subject_label  text,
  exam_date           date,
  question_number     int,
  question_type       text,
  stem_preview        text,
  has_my_solution     boolean,
  required_permission text
)
language sql stable security definer set search_path = public
as $$
  select a.id,
         q.id,
         a.status,
         a.due_date,
         a.completed_at,
         e.subject_id,
         s.name,
         q.unit_id,
         u.name,
         e.id,
         e.cohort,
         e.exam_name,
         e.curriculum,
         e.exam_subject_label,
         e.exam_date,
         q.question_number,
         q.question_type,
         left(q.stem_text, 160),
         exists (
           select 1 from public.solutions sol
            where sol.author_id = auth.uid()
              and (sol.question_id = q.id
                   or (q.group_id is not null and sol.group_id = q.group_id))
         ),
         a.required_permission
    from public.assignments a
    join public.questions q on q.id = a.question_id
    join public.exams e on e.id = q.exam_id
    join public.subjects s on s.id = e.subject_id
    left join public.units u on u.id = q.unit_id
   where a.assignee_id = auth.uid()
   order by s.sort_order, s.name, e.cohort, q.question_number;
$$;

revoke execute on function public.get_my_assignments() from public, anon;
grant execute on function public.get_my_assignments() to authenticated;
