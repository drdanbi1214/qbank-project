-- 풀이와 배정의 공개범위를 함께 맞추고, 풀이 삭제 뒤 더 이상 같은 범위의
-- 풀이가 남지 않으면 해당 배정을 다시 미작성 상태로 되돌린다.

begin;

create or replace function public.complete_assignment_on_solution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assignments a
     set status = 'done',
         completed_at = now()
   where a.assignee_id = new.author_id
     and a.status <> 'done'
     and a.required_permission is not distinct from new.required_permission
     and a.question_id in (
       select q.id
         from public.questions q
        where (new.question_id is not null and q.id = new.question_id)
           or (new.group_id is not null and q.group_id = new.group_id)
     );
  return null;
end;
$$;

create or replace function public.reopen_assignment_on_solution_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assignments a
     set status = 'pending',
         completed_at = null
   where a.assignee_id = old.author_id
     and a.status = 'done'
     and a.required_permission is not distinct from old.required_permission
     and (
       (old.question_id is not null and a.question_id = old.question_id)
       or (
         old.group_id is not null
         and exists (
           select 1
             from public.questions target_question
            where target_question.id = a.question_id
              and target_question.group_id = old.group_id
         )
       )
     )
     and not exists (
       select 1
         from public.solutions remaining_solution
         join public.questions assigned_question
           on assigned_question.id = a.question_id
        where remaining_solution.author_id = old.author_id
          and remaining_solution.required_permission is not distinct from a.required_permission
          and (
            remaining_solution.question_id = a.question_id
            or (
              assigned_question.group_id is not null
              and remaining_solution.group_id = assigned_question.group_id
            )
          )
     );
  return null;
end;
$$;

drop trigger if exists solutions_reopen_assignment on public.solutions;
create trigger solutions_reopen_assignment
  after delete on public.solutions
  for each row execute function public.reopen_assignment_on_solution_delete();

revoke all on function public.complete_assignment_on_solution() from public, anon, authenticated;
revoke all on function public.reopen_assignment_on_solution_delete() from public, anon, authenticated;

commit;
