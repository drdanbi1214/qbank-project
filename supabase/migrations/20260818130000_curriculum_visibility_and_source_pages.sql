-- 계통 시험은 학번 권한과 별개로 열람 범위를 관리한다.
alter table public.access_permissions
  drop constraint if exists access_permissions_kind_check;
alter table public.access_permissions
  add constraint access_permissions_kind_check
  check (kind in ('feature', 'study', 'cohort', 'curriculum'));

insert into public.access_permissions (key, name, description, kind, sort_order)
values (
  'curriculum_system_y_view',
  '계통 Y',
  '2026 2학년 1학기 계통 Y 시험과 문제를 봅니다.',
  'curriculum',
  60
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      kind = excluded.kind,
      sort_order = excluded.sort_order;

-- 회차를 순차 전사하는 동안에는 시험 자체도 숨긴다. 기존 시험은 공개 상태를
-- 유지하고, 신규 시험은 draft로 시작한다.
alter table public.exams
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'published')),
  add column if not exists source_page_start int check (source_page_start is null or source_page_start > 0),
  add column if not exists source_page_end int check (source_page_end is null or source_page_end > 0);

update public.exams set status = 'published' where status = 'draft';

alter table public.exams
  alter column status set default 'draft';

alter table public.exams
  drop constraint if exists exams_source_page_range_check;
alter table public.exams
  add constraint exams_source_page_range_check
  check (source_page_end is null or source_page_start is null or source_page_end >= source_page_start);

-- 일반 사용자는 공개된 시험만 보며, 관리자는 전사 중인 시험도 검수할 수 있다.
create or replace function public.can_view_exam(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select e.status = 'published' and public.has_content_access(e.required_permission)
    from public.exams e
   where e.id = p_exam_id;
$$;

create or replace function public.can_view_question(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_question_id is null
      or exists (
           select 1
             from public.questions q
             join public.exams e on e.id = q.exam_id
            where q.id = p_question_id
              and q.status = 'published'
              and e.status = 'published'
              and public.has_content_access(e.required_permission)
         );
$$;

drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams
  for select to authenticated
  using (public.is_admin() or (status = 'published' and public.has_content_access(required_permission)));

drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
  for select to authenticated
  using (public.is_admin() or public.can_view_exam(exam_id));
