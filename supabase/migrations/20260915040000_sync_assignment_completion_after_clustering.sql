-- 동일/유사 문제를 묶으며 풀이의 연결 대상이 문제에서 공유 그룹으로 바뀌어도
-- 풀이 배정 상태가 실제 "내 풀이 있음" 판정과 항상 같도록 맞춘다.

begin;

create or replace function public.sync_assignment_completion_for_question(
  p_question_id uuid,
  p_author_id uuid default null,
  p_required_permission text default null,
  p_reopen_without_solution boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with assignment_state as (
    select a.id,
           exists (
             select 1
               from public.solutions solution
              where solution.author_id = a.assignee_id
                and solution.required_permission is not distinct from a.required_permission
                and (
                  solution.question_id = a.question_id
                  or (
                    question.group_id is not null
                    and solution.group_id = question.group_id
                  )
                )
           ) as has_solution
     from public.assignments a
      join public.questions question on question.id = a.question_id
     where a.question_id = p_question_id
       and (p_author_id is null or a.assignee_id = p_author_id)
       and (
         p_author_id is null
         or a.required_permission is not distinct from p_required_permission
       )
  )
  update public.assignments assignment
     set status = case when state.has_solution then 'done' else 'pending' end,
         completed_at = case
           when state.has_solution then coalesce(assignment.completed_at, now())
           else null
         end
    from assignment_state state
   where assignment.id = state.id
     and (
       (state.has_solution and assignment.status <> 'done')
       or (
         p_reopen_without_solution
         and not state.has_solution
         and assignment.status = 'done'
       )
     );
end;
$$;

create or replace function public.sync_assignments_on_solution_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_question_id uuid;
begin
  if tg_op <> 'INSERT' then
    if old.question_id is not null then
      perform public.sync_assignment_completion_for_question(
        old.question_id, old.author_id, old.required_permission, true
      );
    end if;
    if old.group_id is not null then
      for affected_question_id in
        select question.id
          from public.questions question
         where question.group_id = old.group_id
      loop
        perform public.sync_assignment_completion_for_question(
          affected_question_id, old.author_id, old.required_permission, true
        );
      end loop;
    end if;
  end if;

  if tg_op <> 'DELETE' then
    if new.question_id is not null then
      perform public.sync_assignment_completion_for_question(
        new.question_id, new.author_id, new.required_permission, false
      );
    end if;
    if new.group_id is not null then
      for affected_question_id in
        select question.id
          from public.questions question
         where question.group_id = new.group_id
      loop
        perform public.sync_assignment_completion_for_question(
          affected_question_id, new.author_id, new.required_permission, false
        );
      end loop;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.sync_assignments_on_question_group_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 그룹에 이미 공유 풀이가 있는 상태에서 새 동일 문제를 붙이는 경로다.
  -- 풀이가 없는 배정을 임의로 미작성으로 되돌리지는 않고 완료 누락만 채운다.
  perform public.sync_assignment_completion_for_question(new.id);
  return null;
end;
$$;

drop trigger if exists solutions_complete_assignment on public.solutions;
drop trigger if exists solutions_reopen_assignment on public.solutions;
drop trigger if exists solutions_sync_assignments_insert on public.solutions;
drop trigger if exists solutions_sync_assignments_update on public.solutions;
drop trigger if exists solutions_sync_assignments_delete on public.solutions;
drop trigger if exists questions_sync_assignments_group on public.questions;

create trigger solutions_sync_assignments_insert
  after insert on public.solutions
  for each row execute function public.sync_assignments_on_solution_change();

create trigger solutions_sync_assignments_update
  after update of question_id, group_id, author_id, required_permission on public.solutions
  for each row execute function public.sync_assignments_on_solution_change();

create trigger solutions_sync_assignments_delete
  after delete on public.solutions
  for each row execute function public.sync_assignments_on_solution_change();

create trigger questions_sync_assignments_group
  after update of group_id on public.questions
  for each row
  when (old.group_id is distinct from new.group_id)
  execute function public.sync_assignments_on_question_group_change();

-- 이미 동일 문제로 묶였지만 insert 전용 트리거 때문에 놓친 배정도 즉시 보정한다.
do $$
declare
  assigned_question_id uuid;
begin
  for assigned_question_id in
    select distinct assignment.question_id
      from public.assignments assignment
  loop
    perform public.sync_assignment_completion_for_question(assigned_question_id);
  end loop;
end;
$$;

revoke all on function public.sync_assignment_completion_for_question(uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.sync_assignments_on_solution_change()
  from public, anon, authenticated;
revoke all on function public.sync_assignments_on_question_group_change()
  from public, anon, authenticated;

commit;
