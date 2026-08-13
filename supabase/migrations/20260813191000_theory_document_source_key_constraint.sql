drop index if exists public.theory_documents_subject_source_key_key;

alter table public.theory_documents
  add constraint theory_documents_subject_source_key_key unique (subject_id, source_key);
