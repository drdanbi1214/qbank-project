-- 과목별 이론 문서. 한 과목에 여러 문서를 두고, 필요하면 단원에 연결한다.
create table public.theory_documents (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects(id) on delete cascade,
  unit_id             uuid references public.units(id) on delete set null,
  title               text not null check (btrim(title) <> ''),
  content             jsonb not null,
  sort_order          int not null default 0,
  required_permission text not null default 'study_hapbon3'
    references public.access_permissions(key) on update cascade on delete restrict,
  is_published        boolean not null default false,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index theory_documents_subject_order_idx
  on public.theory_documents (subject_id, sort_order, title);

create trigger theory_documents_set_updated_at
  before update on public.theory_documents
  for each row execute function public.set_updated_at();

alter table public.theory_documents enable row level security;

revoke all on table public.theory_documents from anon;
grant select, insert, update, delete on table public.theory_documents to authenticated;

create policy "theory_documents_select" on public.theory_documents
  for select to authenticated
  using (is_published and public.has_permission(required_permission));
create policy "theory_documents_insert" on public.theory_documents
  for insert to authenticated with check (public.is_admin());
create policy "theory_documents_update" on public.theory_documents
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "theory_documents_delete" on public.theory_documents
  for delete to authenticated using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('theory-images', 'theory-images', false, 10485760,
        array['image/webp', 'image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

create policy "theory_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'theory-images' and public.has_permission('study_hapbon3'));
create policy "theory_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'theory-images' and public.is_admin());
create policy "theory_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'theory-images' and public.is_admin())
  with check (bucket_id = 'theory-images' and public.is_admin());
create policy "theory_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'theory-images' and public.is_admin());
