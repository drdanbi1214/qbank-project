-- =============================================================================
-- AI 풀이
--
-- AI 풀이 탭 권한이 있는 사용자만 볼 수 있는 별도 풀이 트랙. solutions 테이블에
-- discriminator 컬럼을 추가하는 대신 아예 분리된 테이블로 둬서, select 정책
-- 자체를 권한으로 막는다. 권한이 없는 사용자는 데이터 존재도 조회할 수 없다.
--
-- 등록/수정은 웹 화면이 아니라 service_role 키를 쓰는
-- scripts/import_ai_solutions.py 로만 한다. 그래도 나중에 관리자 화면에서
-- 직접 손보고 싶을 때를 대비해 insert/update/delete 정책도 admin 전용으로
-- 함께 열어둔다.
-- =============================================================================

create table if not exists public.ai_solutions (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  required_permission text not null default 'ai_solution_view'
    references public.access_permissions(key) on update cascade on delete restrict,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 운영 DB에는 관리자 전용 AI 풀이 테이블이 먼저 만들어졌을 수 있다.
-- 기존 행을 보존하면서 새 권한 컬럼만 추가한다.
alter table public.ai_solutions
  add column if not exists required_permission text not null default 'ai_solution_view'
  references public.access_permissions(key) on update cascade on delete restrict;

drop trigger if exists ai_solutions_set_updated_at on public.ai_solutions;
create trigger ai_solutions_set_updated_at
  before update on public.ai_solutions
  for each row execute function public.set_updated_at();

alter table public.ai_solutions enable row level security;

drop policy if exists "ai_solutions_select" on public.ai_solutions;
drop policy if exists "ai_solutions_insert" on public.ai_solutions;
drop policy if exists "ai_solutions_update" on public.ai_solutions;
drop policy if exists "ai_solutions_delete" on public.ai_solutions;

create policy "ai_solutions_select" on public.ai_solutions
  for select to authenticated using (public.has_permission(required_permission));
create policy "ai_solutions_insert" on public.ai_solutions
  for insert to authenticated with check (public.is_admin());
create policy "ai_solutions_update" on public.ai_solutions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "ai_solutions_delete" on public.ai_solutions
  for delete to authenticated using (public.is_admin());

-- 이미지도 비공개 버킷 + AI 풀이 권한 정책. 권한이 없으면 signed URL조차
-- 발급받지 못해, 경로를 알아내도 못 열어본다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-solution-images', 'ai-solution-images', false, 10485760,
        array['image/webp', 'image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "ai_solution_images_select" on storage.objects;
drop policy if exists "ai_solution_images_insert" on storage.objects;
drop policy if exists "ai_solution_images_update" on storage.objects;
drop policy if exists "ai_solution_images_delete" on storage.objects;

create policy "ai_solution_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'ai-solution-images' and public.has_permission('ai_solution_view'));

create policy "ai_solution_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ai-solution-images' and public.is_admin());

create policy "ai_solution_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'ai-solution-images' and public.is_admin())
  with check (bucket_id = 'ai-solution-images' and public.is_admin());

create policy "ai_solution_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ai-solution-images' and public.is_admin());
