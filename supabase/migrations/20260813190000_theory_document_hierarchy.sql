-- 이론 목차는 대분류(본문 없음)와 실제 본문 문서를 함께 표현한다.
alter table public.theory_documents
  add column if not exists parent_id uuid references public.theory_documents(id) on delete cascade,
  add column if not exists has_content boolean not null default true,
  add column if not exists source_key text;

create index if not exists theory_documents_parent_order_idx
  on public.theory_documents (parent_id, sort_order, title);

create unique index if not exists theory_documents_subject_source_key_key
  on public.theory_documents (subject_id, source_key)
  where source_key is not null;
