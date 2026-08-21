-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. A number of
-- SECURITY DEFINER helpers were therefore callable with only the publishable
-- key, including the daily challenge/leaderboard RPCs. Remove that inherited
-- surface and explicitly expose only the intended client APIs.

begin;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end;
$$;

-- Authentication/account bootstrap. Nickname availability is intentionally
-- available before sign-up; all other functions require a signed-in role.
grant execute on function public.is_display_name_available(text) to anon, authenticated;

-- Authorization helpers used by RLS/storage policies and the signed-in UI.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_write() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_content_access(text) to authenticated;
grant execute on function public.can_view_exam(uuid) to authenticated;
grant execute on function public.can_view_question(uuid) to authenticated;
grant execute on function public.can_view_solution(uuid) to authenticated;
grant execute on function public.can_view_solution_target(uuid, uuid) to authenticated;
grant execute on function public.can_edit_topic(text) to authenticated;
grant execute on function public.can_cluster() to authenticated;
grant execute on function public.can_read_solution_image(text) to authenticated;
grant execute on function public.can_read_lecture_file(text) to authenticated;

-- Signed-in application RPCs.
grant execute on function public.cluster_attach(uuid, uuid, text) to authenticated;
grant execute on function public.cluster_detach(uuid) to authenticated;
grant execute on function public.cluster_ensure_group(uuid) to authenticated;
grant execute on function public.cluster_set_note(uuid, text) to authenticated;
grant execute on function public.count_my_open_assignments() to authenticated;
grant execute on function public.find_similar_questions(uuid, real, integer) to authenticated;
grant execute on function public.get_daily_question_set(date) to authenticated;
grant execute on function public.get_daily_challenge_stats(uuid) to authenticated;
grant execute on function public.get_daily_challenge_leaderboard(integer) to authenticated;
grant execute on function public.get_my_assignments() to authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_my_question_states(uuid[]) to authenticated;
grant execute on function public.get_my_summary() to authenticated;
grant execute on function public.get_progress_by_exam() to authenticated;
grant execute on function public.get_progress_by_unit() to authenticated;
grant execute on function public.get_question_for_edit(uuid) to authenticated;
grant execute on function public.get_question_lecture_sources(uuid) to authenticated;
grant execute on function public.get_question_stats(uuid) to authenticated;
grant execute on function public.get_wrong_notes(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.increment_discussion_view(uuid) to authenticated;
grant execute on function public.increment_question_view(uuid) to authenticated;
grant execute on function public.list_profile_cards() to authenticated;
grant execute on function public.reset_progress(uuid, uuid, uuid) to authenticated;
grant execute on function public.reveal_answer(uuid) to authenticated;
grant execute on function public.reveal_answers(uuid[]) to authenticated;
grant execute on function public.search_questions(text, boolean, uuid, text, integer) to authenticated;
grant execute on function public.submit_attempt(uuid, integer[], integer, text) to authenticated;

-- Administrative RPCs still perform their own is_admin() check.
grant execute on function public.admin_get_deletion_audit(uuid) to authenticated;
grant execute on function public.admin_list_assignment_members() to authenticated;
grant execute on function public.admin_list_deletion_audit(integer) to authenticated;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;
grant execute on function public.admin_set_permission(uuid, text, boolean) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_suspended(uuid, boolean) to authenticated;
grant execute on function public.get_admin_stats() to authenticated;
grant execute on function public.get_assignment_progress() to authenticated;
grant execute on function public.revert_question_revision(uuid) to authenticated;

-- A file referenced only by an inaccessible solution/announcement is not
-- readable merely because the caller has some other solution permission.
create or replace function public.can_read_solution_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
        from public.solutions s
       where s.content::text like '%solution-images/' || p_object_name || '%'
         and public.can_view_solution(s.id)
    )
    or exists (
      select 1
        from public.discussions d
       where d.content::text like '%solution-images/' || p_object_name || '%'
         and public.can_view_question(d.question_id)
    )
    or exists (
      select 1
        from public.discussion_replies r
        join public.discussions d on d.id = r.discussion_id
       where r.content::text like '%solution-images/' || p_object_name || '%'
         and public.can_view_question(d.question_id)
    )
    or exists (
      select 1
        from public.announcements a
       where a.content::text like '%solution-images/' || p_object_name || '%'
         and public.has_content_access(a.required_permission)
    );
$$;

create or replace function public.can_read_lecture_file(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
        from public.solutions s
       where s."references"::text like '%solution-lecture-files/' || p_object_name || '%'
         and public.can_view_solution(s.id)
    );
$$;

-- CREATE OR REPLACE preserves privileges, but keep the intended grants obvious.
revoke execute on function public.can_read_solution_image(text) from public, anon;
revoke execute on function public.can_read_lecture_file(text) from public, anon;
grant execute on function public.can_read_solution_image(text) to authenticated;
grant execute on function public.can_read_lecture_file(text) to authenticated;

commit;
