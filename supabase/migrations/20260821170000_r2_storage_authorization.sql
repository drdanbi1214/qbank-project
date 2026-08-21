-- Cloudflare R2 gateway authorization.
--
-- R2 does not know Supabase Storage RLS.  The Worker calls this function with
-- the signed-in user's JWT before issuing a short-lived object URL or accepting
-- an upload.  Keep the read branches aligned with the live storage.objects
-- policies.  Client uploads are intentionally stricter: every key must live
-- below the caller's UUID prefix.

begin;

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
    return case p_bucket
      when 'question-images' then true
      when 'exam-sources' then true
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

revoke execute on function public.authorize_storage_object(text, text, text)
  from public, anon;
grant execute on function public.authorize_storage_object(text, text, text)
  to authenticated;

-- A service-only manifest endpoint lets the resumable migration script list
-- storage.objects without exposing the storage schema through the Data API.
create or replace function public.admin_list_storage_objects(
  p_bucket text,
  p_after text default '',
  p_limit integer default 1000
)
returns table (
  object_name text,
  size_bytes bigint,
  mime_type text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, storage
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only' using errcode = '42501';
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
    raise exception 'unknown storage bucket' using errcode = '22023';
  end if;

  return query
  select
    o.name,
    coalesce((o.metadata ->> 'size')::bigint, 0),
    o.metadata ->> 'mimetype',
    o.updated_at
  from storage.objects o
  where o.bucket_id = p_bucket
    and o.name > coalesce(p_after, '')
  order by o.name
  limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end;
$$;

revoke execute on function public.admin_list_storage_objects(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_storage_objects(text, text, integer)
  to service_role;

commit;
