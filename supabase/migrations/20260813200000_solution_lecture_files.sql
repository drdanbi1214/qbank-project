insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('solution-lecture-files', 'solution-lecture-files', false, 52428800,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'])
on conflict (id) do nothing;

create policy "solution_lecture_files_read" on storage.objects
  for select to authenticated using (bucket_id = 'solution-lecture-files' and public.has_permission('study_hapbon3'));
create policy "solution_lecture_files_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'solution-lecture-files' and public.can_write());
create policy "solution_lecture_files_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'solution-lecture-files' and (owner = auth.uid() or public.is_admin()));
