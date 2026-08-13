-- 선배해설은 일반 풀이/AI 풀이와 별도로 저장하며, 전용 권한이 있는 사용자만 본다.
insert into public.access_permissions (key, name, description, sort_order)
values ('senior_solution_view', '선배해설', '문제 화면의 선배해설 탭과 내용을 봅니다.', 30)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- 새 권한 도입 시 관리자는 기본적으로 접근할 수 있게 한다.
insert into public.profile_permissions (profile_id, permission_key)
select id, 'senior_solution_view'
from public.profiles
where role = 'admin'
on conflict do nothing;

create table if not exists public.senior_solutions (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  required_permission text not null default 'senior_solution_view'
    references public.access_permissions(key) on update cascade on delete restrict,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists senior_solutions_set_updated_at on public.senior_solutions;
create trigger senior_solutions_set_updated_at
  before update on public.senior_solutions
  for each row execute function public.set_updated_at();

alter table public.senior_solutions enable row level security;

create policy "senior_solutions_select" on public.senior_solutions
  for select to authenticated using (public.has_permission(required_permission));
create policy "senior_solutions_insert" on public.senior_solutions
  for insert to authenticated with check (public.is_admin());
create policy "senior_solutions_update" on public.senior_solutions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "senior_solutions_delete" on public.senior_solutions
  for delete to authenticated using (public.is_admin());

-- 이미지 경로를 알아도 전용 권한 없이는 signed URL을 발급받을 수 없다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('senior-solution-images', 'senior-solution-images', false, 10485760,
        array['image/webp', 'image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

create policy "senior_solution_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'senior-solution-images' and public.has_permission('senior_solution_view'));
create policy "senior_solution_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'senior-solution-images' and public.is_admin());
create policy "senior_solution_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'senior-solution-images' and public.is_admin())
  with check (bucket_id = 'senior-solution-images' and public.is_admin());
create policy "senior_solution_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'senior-solution-images' and public.is_admin());
