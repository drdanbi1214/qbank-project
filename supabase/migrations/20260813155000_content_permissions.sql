-- =============================================================================
-- 콘텐츠 접근 권한
--
-- role(admin/member)은 운영 권한에만 사용하고, 실제 콘텐츠 열람 여부는 아래의
-- 독립적인 권한 체크로 관리한다. 풀이 행에는 required_permission을 저장하므로
-- 나중에 다른 스터디가 추가되어도 같은 구조를 그대로 쓸 수 있다.
-- =============================================================================

create table public.access_permissions (
  key         text primary key check (key ~ '^[a-z0-9_]+$'),
  name        text not null,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.profile_permissions (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.access_permissions(key) on delete cascade,
  granted_at     timestamptz not null default now(),
  granted_by     uuid references public.profiles(id) on delete set null,
  primary key (profile_id, permission_key)
);

create index profile_permissions_permission_idx
  on public.profile_permissions (permission_key, profile_id);

insert into public.access_permissions (key, name, description, sort_order)
values
  ('study_hapbon3', '합본3 스터디', '풀이 배정에서 작성한 합본3 풀이를 봅니다.', 10),
  ('ai_solution_view', 'AI 풀이 탭', '문제 화면의 AI 풀이 탭과 내용을 봅니다.', 20);

-- 마이그레이션 시점의 가입자 전원에게 합본3 권한을 준다.
insert into public.profile_permissions (profile_id, permission_key)
select id, 'study_hapbon3' from public.profiles
on conflict do nothing;

-- 기존에는 관리자 전용 기능이었으므로 현재 관리자의 접근은 보존한다.
-- 이후 관리자 승격과 AI 풀이 접근은 서로 독립적이며 사용자 관리에서 따로 체크한다.
insert into public.profile_permissions (profile_id, permission_key)
select id, 'ai_solution_view' from public.profiles where role = 'admin'
on conflict do nothing;

alter table public.access_permissions enable row level security;
alter table public.profile_permissions enable row level security;

create policy "access_permissions_select" on public.access_permissions
  for select to authenticated using (public.is_admin());

create policy "profile_permissions_select" on public.profile_permissions
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- RLS 정책에서도 안전하게 쓸 수 있도록 SECURITY DEFINER로 자기 권한만 확인한다.
create or replace function public.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profile_permissions pp
     where pp.profile_id = auth.uid()
       and pp.permission_key = p_permission_key
  );
$$;

create or replace function public.admin_set_permission(
  p_user_id uuid,
  p_permission_key text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.access_permissions where key = p_permission_key
  ) then
    raise exception '알 수 없는 콘텐츠 권한입니다.' using errcode = 'check_violation';
  end if;

  if p_enabled then
    insert into public.profile_permissions (profile_id, permission_key, granted_by)
    values (p_user_id, p_permission_key, auth.uid())
    on conflict (profile_id, permission_key) do nothing;
  else
    delete from public.profile_permissions
     where profile_id = p_user_id
       and permission_key = p_permission_key;
  end if;
end;
$$;

revoke execute on function public.has_permission(text) from public, anon;
revoke execute on function public.admin_set_permission(uuid, text, boolean) from public, anon;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.admin_set_permission(uuid, text, boolean) to authenticated;

-- 관리자 사용자 목록에 체크된 콘텐츠 권한을 함께 내려준다.
drop function public.admin_list_members();
create function public.admin_list_members()
returns table (
  id              uuid,
  email           text,
  display_name    text,
  role            text,
  is_suspended    boolean,
  created_at      timestamptz,
  attempt_count   int,
  solution_count  int,
  last_active_at  timestamptz,
  permission_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.email,
    p.display_name,
    p.role,
    p.is_suspended,
    p.created_at,
    (select count(*)::int from public.attempts a where a.user_id = p.id),
    (select count(*)::int from public.solutions s where s.author_id = p.id),
    (select max(a.created_at) from public.attempts a where a.user_id = p.id),
    coalesce(
      (select array_agg(pp.permission_key order by ap.sort_order, pp.permission_key)
         from public.profile_permissions pp
         join public.access_permissions ap on ap.key = pp.permission_key
        where pp.profile_id = p.id),
      '{}'::text[]
    )
  from public.profiles p
  where public.is_admin()
  order by p.created_at
$$;

revoke execute on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;

-- 기존 및 이후의 일반 풀이는 기본적으로 합본3 스터디 콘텐츠다.
alter table public.solutions
  add column required_permission text not null default 'study_hapbon3'
  references public.access_permissions(key) on update cascade on delete restrict;

create index solutions_required_permission_idx
  on public.solutions (required_permission);

drop policy "solutions_select" on public.solutions;
drop policy "solutions_insert" on public.solutions;
drop policy "solutions_update" on public.solutions;
drop policy "solutions_delete" on public.solutions;

create policy "solutions_select" on public.solutions
  for select to authenticated
  using (public.has_permission(required_permission));
create policy "solutions_insert" on public.solutions
  for insert to authenticated
  with check (
    public.can_write()
    and author_id = auth.uid()
    and public.has_permission(required_permission)
  );
create policy "solutions_update" on public.solutions
  for update to authenticated
  using (
    public.can_write()
    and (author_id = auth.uid() or public.is_admin())
    and (public.has_permission(required_permission) or public.is_admin())
  )
  with check (
    public.can_write()
    and (author_id = auth.uid() or public.is_admin())
    and (public.has_permission(required_permission) or public.is_admin())
  );
create policy "solutions_delete" on public.solutions
  for delete to authenticated
  using (
    public.is_admin()
    or (author_id = auth.uid() and public.has_permission(required_permission))
  );

-- 풀이의 하위 데이터도 직접 조회해서 권한을 우회할 수 없게 한다.
drop policy "solution_upvotes_select" on public.solution_upvotes;
drop policy "solution_upvotes_insert" on public.solution_upvotes;
create policy "solution_upvotes_select" on public.solution_upvotes
  for select to authenticated
  using (exists (select 1 from public.solutions s where s.id = solution_id));
create policy "solution_upvotes_insert" on public.solution_upvotes
  for insert to authenticated
  with check (
    public.can_write()
    and user_id = auth.uid()
    and exists (select 1 from public.solutions s where s.id = solution_id)
  );

drop policy "inline_comments_select" on public.inline_comments;
drop policy "inline_comments_insert" on public.inline_comments;
create policy "inline_comments_select" on public.inline_comments
  for select to authenticated
  using (exists (select 1 from public.solutions s where s.id = solution_id));
create policy "inline_comments_insert" on public.inline_comments
  for insert to authenticated
  with check (
    public.can_write()
    and author_id = auth.uid()
    and exists (select 1 from public.solutions s where s.id = solution_id)
  );

-- 일반 풀이 이미지 역시 합본3 권한이 있어야 signed URL을 발급받을 수 있다.
drop policy "qbank_storage_read" on storage.objects;
create policy "qbank_storage_read" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('question-images', 'exam-sources')
    or (bucket_id = 'solution-images' and public.has_permission('study_hapbon3'))
  );

-- SECURITY DEFINER 검색 함수가 RLS를 우회하므로 풀이 검색 조건에서도 직접 확인한다.
create or replace function public.search_questions(
  p_query             text,
  p_include_solutions boolean default false,
  p_subject_id        uuid default null,
  p_cohort            text default null,
  p_limit             int default 50
)
returns table (
  question_id     uuid,
  exam_id         uuid,
  unit_id         uuid,
  question_number int,
  stem_text       text,
  score           real,
  matched_in      text,
  snippet         text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with needle as (
    select
      btrim(p_query) as raw,
      public.normalize_search_text(p_query) as norm
  ),
  question_hits as (
    select
      q.id,
      q.exam_id,
      q.unit_id,
      q.question_number,
      q.stem_text,
      greatest(
        case when q.stem_text ilike '%' || n.raw || '%' then 1.0 else 0 end,
        similarity(q.stem_norm, n.norm)
      )::real as score,
      '문제'::text as matched_in,
      q.stem_text as snippet
    from public.questions q
    join public.exams e on e.id = q.exam_id
    cross join needle n
    where q.status = 'published'
      and n.raw <> ''
      and (q.stem_text ilike '%' || n.raw || '%' or similarity(q.stem_norm, n.norm) > 0.15)
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  solution_hits as (
    select
      q.id,
      q.exam_id,
      q.unit_id,
      q.question_number,
      q.stem_text,
      0.9::real as score,
      '풀이'::text as matched_in,
      public.richtext_plain(s.content) as snippet
    from public.solutions s
    join public.questions q
      on (s.question_id is not null and q.id = s.question_id)
      or (s.group_id is not null and q.group_id = s.group_id)
    join public.exams e on e.id = q.exam_id
    cross join needle n
    where p_include_solutions
      and public.has_permission(s.required_permission)
      and n.raw <> ''
      and q.status = 'published'
      and public.richtext_plain(s.content) ilike '%' || n.raw || '%'
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (p_cohort is null or e.cohort = p_cohort)
  ),
  merged as (
    select * from question_hits
    union all
    select * from solution_hits
  )
  select distinct on (m.id)
    m.id, m.exam_id, m.unit_id, m.question_number, m.stem_text,
    m.score, m.matched_in, left(m.snippet, 300)
  from merged m
  order by m.id, m.score desc
  limit p_limit
$$;
