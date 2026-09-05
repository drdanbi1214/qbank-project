-- 강의록 PDF 위에 남긴 개인 필기를 페이지별 JSON으로 저장한다.
-- PDF 원본에는 손대지 않으며, 같은 강의록이라도 사용자마다 완전히 분리된다.

begin;

create table public.lecture_pdf_annotations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lecture_id uuid not null references public.lecture_documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  marks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(marks) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, lecture_id, page_number)
);

comment on table public.lecture_pdf_annotations is
  '사용자별 강의록 PDF 페이지 필기. marks 좌표는 페이지 크기에 대한 비율로 저장한다.';

create index lecture_pdf_annotations_lecture_user_idx
  on public.lecture_pdf_annotations (lecture_id, user_id, page_number);

create trigger lecture_pdf_annotations_set_updated_at
  before update on public.lecture_pdf_annotations
  for each row execute function public.set_updated_at();

alter table public.lecture_pdf_annotations enable row level security;

revoke all on table public.lecture_pdf_annotations from public, anon, authenticated;
grant select, insert, update, delete on table public.lecture_pdf_annotations to authenticated;
grant all on table public.lecture_pdf_annotations to service_role;

create policy lecture_pdf_annotations_select_own
  on public.lecture_pdf_annotations
  for select to authenticated
  using (user_id = auth.uid());

create policy lecture_pdf_annotations_insert_own
  on public.lecture_pdf_annotations
  for insert to authenticated
  with check (public.can_write() and user_id = auth.uid());

create policy lecture_pdf_annotations_update_own
  on public.lecture_pdf_annotations
  for update to authenticated
  using (user_id = auth.uid())
  with check (public.can_write() and user_id = auth.uid());

create policy lecture_pdf_annotations_delete_own
  on public.lecture_pdf_annotations
  for delete to authenticated
  using (public.can_write() and user_id = auth.uid());

commit;
