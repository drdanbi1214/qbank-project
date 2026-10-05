-- A topic may be read by its study, but its article and derived indexes may
-- only be changed by the person who wrote it. This applies to admins too;
-- service-role maintenance remains available for audited recovery.
begin;

drop policy if exists topics_update on public.topics;
create policy topics_update on public.topics
  for update to authenticated
  using (created_by = auth.uid() and public.can_edit_topic(required_permission))
  with check (created_by = auth.uid() and public.can_edit_topic(required_permission));

drop policy if exists topics_delete on public.topics;
create policy topics_delete on public.topics
  for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists topic_units_write on public.topic_units;
create policy topic_units_write on public.topic_units
  for all to authenticated
  using (exists (
    select 1 from public.topics t
     where t.id = topic_units.topic_id
       and t.created_by = auth.uid()
       and public.can_edit_topic(t.required_permission)
  ))
  with check (exists (
    select 1 from public.topics t
     where t.id = topic_units.topic_id
       and t.created_by = auth.uid()
       and public.can_edit_topic(t.required_permission)
  ));

drop policy if exists topic_questions_write on public.topic_questions;
create policy topic_questions_write on public.topic_questions
  for all to authenticated
  using (exists (
    select 1 from public.topics t
     where t.id = topic_questions.topic_id
       and t.created_by = auth.uid()
       and public.can_edit_topic(t.required_permission)
  ))
  with check (exists (
    select 1 from public.topics t
     where t.id = topic_questions.topic_id
       and t.created_by = auth.uid()
       and public.can_edit_topic(t.required_permission)
  ));

commit;
