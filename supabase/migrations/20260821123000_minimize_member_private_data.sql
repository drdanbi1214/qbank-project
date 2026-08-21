-- Limit member-visible personal/operational data to what the UI actually uses.
-- Full profile rows are returned only to their owner; administrative member and
-- assignment lists remain behind admin-checked SECURITY DEFINER RPCs.

begin;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
    from public.profiles p
   where p.id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

create or replace function public.list_profile_cards()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  one_liner text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url, p.one_liner
    from public.profiles p
   where auth.uid() is not null
     and not p.is_suspended
   order by p.display_name;
$$;

revoke all on function public.list_profile_cards() from public, anon;
grant execute on function public.list_profile_cards() to authenticated;

create or replace function public.admin_list_assignment_members()
returns table (
  id uuid,
  display_name text,
  cohort text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  return query
    select p.id, p.display_name, p.cohort
      from public.profiles p
     where not p.is_suspended
     order by p.display_name;
end;
$$;

revoke all on function public.admin_list_assignment_members() from public, anon;
grant execute on function public.admin_list_assignment_members() to authenticated;

-- A recreated function gets PUBLIC execute by default. Make the existing admin
-- member RPC explicit as well.
revoke execute on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;

-- Nobody needs table-wide profile privileges. Other users' author chips only
-- need these display columns; the owner gets the full row through get_my_profile.
revoke all privileges on table public.profiles from anon;
revoke select, insert, delete, truncate, references, trigger on table public.profiles
  from authenticated;
revoke update on table public.profiles from authenticated;
grant select (id, display_name, avatar_url, one_liner)
  on table public.profiles to authenticated;
grant update (
  display_name,
  cohort,
  avatar_url,
  theme,
  font_scale,
  default_solution_permission,
  one_liner,
  dedupe_identical
) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------

drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (public.is_admin() or assignee_id = auth.uid());

-- Progress and assignment-candidate lists are admin UI data. The former used
-- to be callable by any signed-in member even though the page is admin-only.
create or replace function public.get_assignment_progress()
returns table (
  assignee_id uuid,
  display_name text,
  total int,
  done int,
  overdue int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  return query
    select a.assignee_id,
           p.display_name,
           count(*)::int,
           count(*) filter (where a.status = 'done')::int,
           count(*) filter (
             where a.status <> 'done'
               and a.due_date is not null
               and a.due_date < current_date
           )::int
      from public.assignments a
      join public.profiles p on p.id = a.assignee_id
     group by a.assignee_id, p.display_name
     order by p.display_name;
end;
$$;

revoke all on function public.get_assignment_progress() from public, anon;
grant execute on function public.get_assignment_progress() to authenticated;

revoke all privileges on table public.assignments from anon;
revoke truncate, references, trigger on table public.assignments from authenticated;

-- ---------------------------------------------------------------------------
-- Solution and edit-history visibility
-- ---------------------------------------------------------------------------

create or replace function public.can_view_solution(p_solution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.solutions s
     where s.id = p_solution_id
       and (
         public.is_admin()
         or (
           public.has_content_access(s.required_permission)
           and (
             (s.question_id is not null and public.can_view_question(s.question_id))
             or (
               s.group_id is not null
               and exists (
                 select 1
                   from public.questions q
                  where q.group_id = s.group_id
                    and public.can_view_question(q.id)
               )
             )
           )
         )
       )
  );
$$;

revoke all on function public.can_view_solution(uuid) from public, anon;
grant execute on function public.can_view_solution(uuid) to authenticated, service_role;

drop policy if exists solutions_select on public.solutions;
create policy solutions_select on public.solutions
  for select to authenticated
  using (public.can_view_solution(id));

drop policy if exists revisions_select on public.revisions;
create policy revisions_select on public.revisions
  for select to authenticated
  using (
    public.is_admin()
    or (
      entity_type = 'solution'
      and public.can_view_solution(entity_id)
    )
  );

drop policy if exists discussion_revisions_select on public.discussion_revisions;
create policy discussion_revisions_select on public.discussion_revisions
  for select to authenticated
  using (
    exists (
      select 1
        from public.discussions d
       where d.id = discussion_id
         and (public.is_admin() or public.can_view_question(d.question_id))
    )
  );

-- These tables are append/read history, not general-purpose client tables.
revoke all privileges on table public.revisions from anon, authenticated;
grant select on table public.revisions to authenticated;

revoke all privileges on table public.discussion_revisions from anon, authenticated;
grant select, insert on table public.discussion_revisions to authenticated;

commit;
