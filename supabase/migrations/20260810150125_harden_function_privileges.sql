-- =============================================================================
-- 함수 권한 정리 (Supabase security advisor 대응)
--  - 모든 함수의 search_path 고정
--  - 트리거 전용 / 내부 헬퍼 함수는 REST RPC 로 호출 불가하도록 EXECUTE 회수
--    (트리거 실행 자체는 EXECUTE 권한을 확인하지 않으므로 동작에는 영향 없음)
--  - 사용자용 RPC 는 비로그인(anon)에서 완전히 차단하고 로그인 사용자에게만 개방
-- =============================================================================

alter function public.set_updated_at() set search_path = public;
alter function public.stamp_question_editor() set search_path = public;
alter function public.stamp_solution_edited() set search_path = public;
alter function public.stem_plain_text(jsonb) set search_path = public;
alter function public.normalize_stem(jsonb) set search_path = public;
alter function public.circled_answer(int[]) set search_path = public;

revoke execute on function public.handle_new_user()                     from public, anon, authenticated;
revoke execute on function public.create_notification(uuid, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.sync_solution_upvote_count()          from public, anon, authenticated;
revoke execute on function public.sync_discussion_upvote_count()        from public, anon, authenticated;
revoke execute on function public.sync_reply_upvote_count()             from public, anon, authenticated;
revoke execute on function public.sync_discussion_reply_count()         from public, anon, authenticated;
revoke execute on function public.enforce_reply_depth()                 from public, anon, authenticated;
revoke execute on function public.soft_delete_reply_with_children()     from public, anon, authenticated;
revoke execute on function public.record_question_revision()            from public, anon, authenticated;
revoke execute on function public.record_solution_revision()            from public, anon, authenticated;
revoke execute on function public.complete_assignment_on_solution()     from public, anon, authenticated;
revoke execute on function public.notify_on_inline_comment()            from public, anon, authenticated;
revoke execute on function public.notify_on_inline_comment_resolved()   from public, anon, authenticated;
revoke execute on function public.notify_on_discussion_reply()          from public, anon, authenticated;
revoke execute on function public.notify_on_reply_accepted()            from public, anon, authenticated;
revoke execute on function public.notify_on_solution_upvote()           from public, anon, authenticated;
revoke execute on function public.notify_on_assignment()                from public, anon, authenticated;
revoke execute on function public.notify_on_announcement()              from public, anon, authenticated;

revoke execute on function public.is_admin()                              from public, anon;
revoke execute on function public.can_write()                             from public, anon;
revoke execute on function public.reveal_answer(uuid)                     from public, anon;
revoke execute on function public.get_question_for_edit(uuid)             from public, anon;
revoke execute on function public.get_question_stats(uuid)                from public, anon;
revoke execute on function public.submit_attempt(uuid, int[], int, text)  from public, anon;
revoke execute on function public.increment_question_view(uuid)           from public, anon;
revoke execute on function public.increment_discussion_view(uuid)         from public, anon;
revoke execute on function public.find_similar_questions(uuid, real, int) from public, anon;
revoke execute on function public.reset_progress(uuid, uuid, uuid)        from public, anon;
revoke execute on function public.admin_set_suspended(uuid, boolean)      from public, anon;
revoke execute on function public.admin_set_role(uuid, text)              from public, anon;

grant execute on function public.is_admin()                              to authenticated;
grant execute on function public.can_write()                             to authenticated;
grant execute on function public.reveal_answer(uuid)                     to authenticated;
grant execute on function public.get_question_for_edit(uuid)             to authenticated;
grant execute on function public.get_question_stats(uuid)                to authenticated;
grant execute on function public.submit_attempt(uuid, int[], int, text)  to authenticated;
grant execute on function public.increment_question_view(uuid)           to authenticated;
grant execute on function public.increment_discussion_view(uuid)         to authenticated;
grant execute on function public.find_similar_questions(uuid, real, int) to authenticated;
grant execute on function public.reset_progress(uuid, uuid, uuid)        to authenticated;
grant execute on function public.admin_set_suspended(uuid, boolean)      to authenticated;
grant execute on function public.admin_set_role(uuid, text)              to authenticated;
