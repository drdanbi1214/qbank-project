-- 콘텐츠 가시성 1단계 — 기반 작업.
--
-- 설계 원칙: required_permission 이 null 이면 "전체공개" 다.
-- 문제(시험)와 풀이 양쪽에서 같은 규칙을 쓴다.
--
-- 이 마이그레이션만으로는 화면에 보이는 것이 달라지지 않는다.
-- exams.required_permission 은 전부 null 로 시작하고, solutions 의 컬럼
-- 기본값도 그대로 두기 때문에 기존 동작이 그대로 유지된다.
-- 실제로 문제가 숨겨지는 것은 3단계다.

-- ---------------------------------------------------------------------------
-- 1. 권한의 종류를 구분한다
--
-- feature: 기능 하나를 여는 권한 (AI 풀이 탭 등)
-- study  : 스터디 그룹. 이 권한으로 쓴 풀이는 같은 권한자만 읽는다.
-- cohort : 특정 학번 문제를 볼 수 있는 권한.
-- ---------------------------------------------------------------------------
alter table public.access_permissions
  add column if not exists kind text not null default 'feature';

alter table public.access_permissions
  drop constraint if exists access_permissions_kind_check;
alter table public.access_permissions
  add constraint access_permissions_kind_check
  check (kind in ('feature', 'study', 'cohort'));

update public.access_permissions set kind = 'study' where key = 'study_hapbon3';

-- ---------------------------------------------------------------------------
-- 2. 학번별 문제 열람 권한
--
-- 키만 만들어두고 아직 어느 시험에도 걸지 않는다(3단계에서 건다).
-- ---------------------------------------------------------------------------
insert into public.access_permissions (key, name, description, kind, sort_order)
values
  ('cohort_22_view', '22학번 문제', '22학번 시험의 문제를 봅니다.', 'cohort', 40),
  ('cohort_23_view', '23학번 문제', '23학번 시험의 문제를 봅니다.', 'cohort', 50)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. null = 전체공개 를 처리하는 헬퍼
--
-- has_permission(null) 은 false 라서 그대로 쓰면 전체공개 행이 오히려
-- 아무에게도 안 보인다. 공개범위를 검사하는 자리에서는 이 함수를 쓴다.
-- ---------------------------------------------------------------------------
create or replace function public.has_content_access(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_permission_key is null or public.has_permission(p_permission_key);
$$;

revoke all on function public.has_content_access(text) from public;
grant execute on function public.has_content_access(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 시험별 공개범위
--
-- null 이면 전체공개다. 3단계에서 22/23학번 시험에 값을 채운다.
-- ---------------------------------------------------------------------------
alter table public.exams
  add column if not exists required_permission text
  references public.access_permissions(key) on update cascade on delete restrict;

-- ---------------------------------------------------------------------------
-- 5. 풀이의 전체공개를 허용한다
--
-- 컬럼 기본값(study_hapbon3)은 일부러 그대로 둔다. createSolution 이 아직
-- required_permission 을 보내지 않기 때문에, 지금 기본값을 지우면 새로
-- 쓰는 풀이가 전부 전체공개가 되어버린다. 작성 화면이 값을 명시적으로
-- 보내게 되는 2단계에서 정리한다.
-- ---------------------------------------------------------------------------
alter table public.solutions alter column required_permission drop not null;

drop policy if exists solutions_select on public.solutions;
create policy solutions_select on public.solutions
  for select to authenticated
  using (public.has_content_access(required_permission));

drop policy if exists solutions_insert on public.solutions;
create policy solutions_insert on public.solutions
  for insert to authenticated
  with check (
    public.can_write()
    and author_id = auth.uid()
    and public.has_content_access(required_permission)
  );

drop policy if exists solutions_update on public.solutions;
create policy solutions_update on public.solutions
  for update to authenticated
  using (
    public.can_write()
    and (author_id = auth.uid() or public.is_admin())
    and (public.has_content_access(required_permission) or public.is_admin())
  )
  with check (
    public.can_write()
    and (author_id = auth.uid() or public.is_admin())
    and (public.has_content_access(required_permission) or public.is_admin())
  );

drop policy if exists solutions_delete on public.solutions;
create policy solutions_delete on public.solutions
  for delete to authenticated
  using (
    public.is_admin()
    or (author_id = auth.uid() and public.has_content_access(required_permission))
  );

-- ---------------------------------------------------------------------------
-- 6. 사용자별 기본 공개범위
--
-- 풀이를 쓸 때 마지막에 고른 공개범위를 여기에 기억해두고 다음 작성의
-- 기본값으로 쓴다. 기기를 옮겨도 유지되도록 프로필에 둔다.
--
-- 시작값은 합본3 권한이 있으면 합본3, 없으면 전체공개(null)다.
-- 지금 가입자 중 합본3 권한이 없는 사람은 한 명뿐이라 이름을 따로
-- 박아넣지 않고 권한 보유 여부로 규칙을 세운다.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists default_solution_permission text
  references public.access_permissions(key) on update cascade on delete set null;

update public.profiles p
set default_solution_permission = 'study_hapbon3'
where p.default_solution_permission is null
  and exists (
    select 1
      from public.profile_permissions pp
     where pp.profile_id = p.id
       and pp.permission_key = 'study_hapbon3'
  );

-- ---------------------------------------------------------------------------
-- 7. 자기 권한의 표시 이름을 읽을 수 있게 한다
--
-- 지금까지는 관리자만 권한 목록을 읽을 수 있었다. 2단계 작성 화면에서
-- "합본3 스터디" 같은 이름표가 필요하므로, 일반 사용자는 자기가 가진
-- 권한의 행만 읽게 열어준다. 관리자는 전체를 본다.
-- ---------------------------------------------------------------------------
drop policy if exists access_permissions_select on public.access_permissions;
create policy access_permissions_select on public.access_permissions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.profile_permissions pp
       where pp.profile_id = auth.uid()
         and pp.permission_key = access_permissions.key
    )
  );
