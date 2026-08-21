-- Parent content visibility must also apply to child rows. Otherwise a member
-- can enumerate replies, votes, group notes and set metadata belonging to an
-- exam/question they cannot open. Vote tables expose only the caller's own row;
-- aggregate counts already live on the parent records.

begin;

drop policy if exists question_sets_select on public.question_sets;
create policy question_sets_select on public.question_sets
  for select to authenticated
  using (public.is_admin() or public.can_view_exam(exam_id));

drop policy if exists question_groups_select on public.question_groups;
create policy question_groups_select on public.question_groups
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.questions q
       where q.group_id = question_groups.id
         and public.can_view_question(q.id)
    )
  );

drop policy if exists discussion_replies_select on public.discussion_replies;
create policy discussion_replies_select on public.discussion_replies
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.discussions d
       where d.id = discussion_replies.discussion_id
         and public.can_view_question(d.question_id)
    )
  );

drop policy if exists discussion_replies_insert on public.discussion_replies;
create policy discussion_replies_insert on public.discussion_replies
  for insert to authenticated
  with check (
    public.can_write()
    and author_id = auth.uid()
    and exists (
      select 1
        from public.discussions d
       where d.id = discussion_replies.discussion_id
         and public.can_view_question(d.question_id)
    )
  );

drop policy if exists solution_upvotes_select on public.solution_upvotes;
create policy solution_upvotes_select on public.solution_upvotes
  for select to authenticated
  using (
    public.is_admin()
    or (
      user_id = auth.uid()
      and public.can_view_solution(solution_id)
    )
  );

drop policy if exists solution_upvotes_insert on public.solution_upvotes;
create policy solution_upvotes_insert on public.solution_upvotes
  for insert to authenticated
  with check (
    public.can_write()
    and user_id = auth.uid()
    and public.can_view_solution(solution_id)
    and not exists (
      select 1 from public.solutions s
       where s.id = solution_id and s.author_id = auth.uid()
    )
  );

drop policy if exists discussion_upvotes_select on public.discussion_upvotes;
create policy discussion_upvotes_select on public.discussion_upvotes
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists discussion_upvotes_insert on public.discussion_upvotes;
create policy discussion_upvotes_insert on public.discussion_upvotes
  for insert to authenticated
  with check (
    public.can_write()
    and user_id = auth.uid()
    and exists (
      select 1
        from public.discussions d
       where d.id = discussion_id
         and d.author_id <> auth.uid()
         and public.can_view_question(d.question_id)
    )
  );

drop policy if exists reply_upvotes_select on public.reply_upvotes;
create policy reply_upvotes_select on public.reply_upvotes
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists reply_upvotes_insert on public.reply_upvotes;
create policy reply_upvotes_insert on public.reply_upvotes
  for insert to authenticated
  with check (
    public.can_write()
    and user_id = auth.uid()
    and exists (
      select 1
        from public.discussion_replies r
        join public.discussions d on d.id = r.discussion_id
       where r.id = reply_id
         and r.author_id <> auth.uid()
         and public.can_view_question(d.question_id)
    )
  );

drop policy if exists answer_votes_select on public.answer_votes;
create policy answer_votes_select on public.answer_votes
  for select to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and public.can_view_question(question_id))
  );

drop policy if exists answer_votes_insert on public.answer_votes;
create policy answer_votes_insert on public.answer_votes
  for insert to authenticated
  with check (
    public.can_write()
    and user_id = auth.uid()
    and public.can_view_question(question_id)
  );

drop policy if exists answer_votes_update on public.answer_votes;
create policy answer_votes_update on public.answer_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    public.can_write()
    and user_id = auth.uid()
    and public.can_view_question(question_id)
  );

commit;
