-- 강의록은 임상 과목(내과·외과…)이 아니라 자기만의 분류로 나눈다. subjects 는
-- 문항 4,249건·시험 78개·단원 102개·알렌 526건이 물고 있어 건드릴 수 없고,
-- 강의록의 분류 축은 그것과 다르다. 그래서 별도 테이블을 두고
-- lecture_documents 에서 subject_id 를 뺀다.
--
-- 자유 입력 텍스트가 아니라 테이블인 이유: 강의록 탭이 "분류 목록 → 그 안의
-- 강의록" 두 단계라, 아직 문서가 하나도 없는 분류도 목록에 떠야 한다.

create table public.lecture_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lecture_categories_name_key unique (name),
  constraint lecture_categories_name_not_blank check (btrim(name) <> '')
);

comment on table public.lecture_categories is
  '강의록 분류. subjects 와 별개이며 강의록 화면에서만 쓴다.';

create trigger lecture_categories_set_updated_at
  before update on public.lecture_categories
  for each row execute function public.set_updated_at();

alter table public.lecture_categories enable row level security;

create policy lecture_categories_select on public.lecture_categories
  for select using (public.is_active_member());
create policy lecture_categories_insert on public.lecture_categories
  for insert with check (public.is_admin());
create policy lecture_categories_update on public.lecture_categories
  for update using (public.is_admin()) with check (public.is_admin());
create policy lecture_categories_delete on public.lecture_categories
  for delete using (public.is_admin());

-- 아직 강의록이 한 건도 없으므로 그냥 바꿔 끼운다.
alter table public.lecture_documents drop column subject_id;

alter table public.lecture_documents
  add column category_id uuid not null
    references public.lecture_categories(id) on delete restrict;

drop index if exists lecture_documents_subject_idx;
create index lecture_documents_category_idx
  on public.lecture_documents (category_id, lecture_year desc, sort_order);
