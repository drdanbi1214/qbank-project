-- 배정이 "어느 공개범위(스터디)를 위한 것인지" 기록한다.
-- 한 사람이 합본3 배정도, 클로버 배정도 동시에 받을 수 있어 배정 단위로
-- 구분해야 "풀이 배정" 화면에서 범위별 탭으로 나눠 볼 수 있다.
-- null 이면 특정 스터디에 매이지 않은 배정(기존 배정 전부 포함).
alter table public.assignments
  add column required_permission text references public.access_permissions(key) on delete set null;

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
