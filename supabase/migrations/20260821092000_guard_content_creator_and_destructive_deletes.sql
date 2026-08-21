-- Approved members may collaboratively edit content, but ownership is not an
-- editable field. Without this guard a member can claim an existing row and
-- satisfy an owner-delete policy.

begin;

create or replace function public.guard_content_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role/migrations have no end-user uid and remain available for
  -- controlled imports. Administrators may repair ownership deliberately.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is null then
      new.created_by := auth.uid();
    elsif new.created_by is distinct from auth.uid() then
      raise exception '작성자는 현재 사용자여야 합니다.' using errcode = '42501';
    end if;
  elsif new.created_by is distinct from old.created_by then
    raise exception '작성자는 변경할 수 없습니다.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_content_creator()
  from public, anon, authenticated;

drop trigger if exists exams_guard_creator on public.exams;
create trigger exams_guard_creator
  before insert or update on public.exams
  for each row execute function public.guard_content_creator();

drop trigger if exists questions_guard_creator on public.questions;
create trigger questions_guard_creator
  before insert or update on public.questions
  for each row execute function public.guard_content_creator();

drop trigger if exists question_groups_guard_creator on public.question_groups;
create trigger question_groups_guard_creator
  before insert or update on public.question_groups
  for each row execute function public.guard_content_creator();

drop trigger if exists topics_guard_creator on public.topics;
create trigger topics_guard_creator
  before insert or update on public.topics
  for each row execute function public.guard_content_creator();

-- Exams and questions are high-value roots with large cascading dependency
-- trees. Destructive deletion is an administrative operation, regardless of
-- who originally imported the row.
drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams
  for delete to authenticated
  using (public.is_admin());

drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions
  for delete to authenticated
  using (public.is_admin());

commit;
