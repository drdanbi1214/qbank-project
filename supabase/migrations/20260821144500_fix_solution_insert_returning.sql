-- A SELECT policy that calls can_view_solution(id) cannot see a just-inserted
-- row from INSERT ... RETURNING inside the helper's SQL snapshot. Evaluate the
-- same rule from the candidate row itself so normal solution creation can
-- return its id atomically.

begin;

drop policy if exists solutions_select on public.solutions;
create policy solutions_select on public.solutions
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.has_content_access(required_permission)
      and public.can_view_solution_target(question_id, group_id)
    )
  );

commit;
