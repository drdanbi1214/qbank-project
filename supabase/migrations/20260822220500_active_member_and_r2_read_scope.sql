-- Keep suspended/pending accounts outside privileged reads and make R2 object
-- authorization follow the content rows that reference each stored object.
-- This migration changes functions only; it does not update or delete table rows.

begin;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and not p.is_suspended
  );
$$;

create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member();
$$;

-- A suspended administrator must not retain the admin-only policy bypasses.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and not p.is_suspended
  );
$$;

create or replace function public.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member()
     and exists (
       select 1
         from public.profile_permissions pp
        where pp.profile_id = auth.uid()
          and pp.permission_key = p_permission_key
     );
$$;

create or replace function public.has_content_access(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member()
     and (p_permission_key is null or public.has_permission(p_permission_key));
$$;

-- Object names can contain LIKE metacharacters, so use strpos rather than a
-- wildcard expression when matching a logical storage path inside JSON.
create or replace function public.can_read_question_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.questions q
     where (
       strpos(q.stem_blocks::text, 'question-images/' || p_object_name) > 0
       or strpos(q.choices::text, 'question-images/' || p_object_name) > 0
       or strpos(coalesce(q.official_explanation::text, ''), 'question-images/' || p_object_name) > 0
     )
       and public.can_view_question(q.id)
  );
$$;

create or replace function public.can_read_exam_source(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.exams e
     where e.source_file_url = 'exam-sources/' || p_object_name
       and public.can_view_exam(e.id)
  );
$$;

create or replace function public.authorize_storage_object(
  p_bucket text,
  p_object_name text,
  p_operation text default 'read'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owns_path boolean;
begin
  if v_user_id is null
     or p_bucket is null
     or p_object_name is null
     or p_object_name = ''
     or length(p_object_name) > 1024
     or left(p_object_name, 1) = '/'
     or p_object_name like '%//%'
     or p_object_name like E'%\\%'
     or p_object_name ~ '(^|/)\.{1,2}(/|$)'
     or p_object_name ~ '[[:cntrl:]]'
  then
    return false;
  end if;

  if p_bucket not in (
    'question-images',
    'solution-images',
    'exam-sources',
    'avatars',
    'theory-images',
    'ai-solution-images',
    'senior-solution-images',
    'solution-lecture-files',
    'topic-images'
  ) then
    return false;
  end if;

  v_owns_path := split_part(p_object_name, '/', 1) = v_user_id::text;

  if p_operation = 'read' then
    if not public.is_active_member() then
      return false;
    end if;

    return case p_bucket
      when 'question-images' then
        v_owns_path or public.can_read_question_image(p_object_name)
      when 'exam-sources' then
        public.is_admin() or public.can_read_exam_source(p_object_name)
      when 'avatars' then true
      when 'solution-images' then
        v_owns_path or public.can_read_solution_image(p_object_name)
      when 'solution-lecture-files' then
        v_owns_path or public.can_read_lecture_file(p_object_name)
      when 'theory-images' then
        public.has_permission('study_hapbon3')
      when 'ai-solution-images' then
        public.has_permission('ai_solution_view')
      when 'senior-solution-images' then
        public.has_permission('senior_solution_view')
      when 'topic-images' then
        public.is_admin() or public.has_permission('study_legendob')
      else false
    end;
  end if;

  if p_operation = 'upload' then
    if not v_owns_path or not public.can_write() then
      return false;
    end if;

    return case p_bucket
      when 'question-images' then true
      when 'solution-images' then true
      when 'exam-sources' then public.is_admin()
      when 'avatars' then true
      when 'solution-lecture-files' then true
      when 'theory-images' then public.is_admin()
      when 'ai-solution-images' then public.is_admin()
      when 'senior-solution-images' then public.is_admin()
      when 'topic-images' then
        public.is_admin() or public.has_permission('study_legendob')
      else false
    end;
  end if;

  return false;
end;
$$;

revoke execute on function public.is_active_member() from public, anon;
grant execute on function public.is_active_member() to authenticated, service_role;

revoke execute on function public.can_read_question_image(text) from public, anon, authenticated;
revoke execute on function public.can_read_exam_source(text) from public, anon, authenticated;

revoke execute on function public.authorize_storage_object(text, text, text)
  from public, anon;
grant execute on function public.authorize_storage_object(text, text, text)
  to authenticated;

commit;
