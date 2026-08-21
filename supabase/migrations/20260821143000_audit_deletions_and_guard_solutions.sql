-- Preserve enough evidence to explain and recover future destructive content
-- changes, and prevent clients from moving or self-verifying solution rows.

begin;

-- ---------------------------------------------------------------------------
-- Solution target and immutable-field guards
-- ---------------------------------------------------------------------------

create or replace function public.can_view_solution_target(
  p_question_id uuid,
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (p_question_id is not null and public.can_view_question(p_question_id))
    or (
      p_group_id is not null
      and exists (
        select 1
          from public.questions q
         where q.group_id = p_group_id
           and public.can_view_question(q.id)
      )
    );
$$;

revoke all on function public.can_view_solution_target(uuid, uuid) from public, anon;
grant execute on function public.can_view_solution_target(uuid, uuid)
  to authenticated, service_role;

alter table public.solutions
  drop constraint if exists solutions_target_check;
alter table public.solutions
  add constraint solutions_target_check
  check ((question_id is null) <> (group_id is null));

create or replace function public.guard_solution_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Imports, migrations and trusted server operations have no end-user uid.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from auth.uid() then
      raise exception '풀이 작성자는 현재 사용자여야 합니다.' using errcode = '42501';
    end if;
    if new.is_verified or new.upvote_count <> 0 then
      raise exception '검증 상태와 추천 수는 직접 지정할 수 없습니다.' using errcode = '42501';
    end if;
  else
    if new.id is distinct from old.id
       or new.author_id is distinct from old.author_id
       or new.question_id is distinct from old.question_id
       or new.group_id is distinct from old.group_id
       or new.created_at is distinct from old.created_at then
      raise exception '풀이의 작성자와 연결 대상은 변경할 수 없습니다.' using errcode = '42501';
    end if;

    if new.is_verified is distinct from old.is_verified then
      raise exception '풀이 검증 상태는 관리자만 바꿀 수 있습니다.' using errcode = '42501';
    end if;

    -- The upvote counter is maintained by the nested solution_upvotes trigger.
    -- A direct client UPDATE enters at depth 1 and must not set the counter.
    if new.upvote_count is distinct from old.upvote_count and pg_trigger_depth() <= 1 then
      raise exception '추천 수는 직접 바꿀 수 없습니다.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_solution_fields() from public, anon, authenticated;

drop trigger if exists solutions_guard_fields on public.solutions;
create trigger solutions_guard_fields
  before insert or update on public.solutions
  for each row execute function public.guard_solution_fields();

drop policy if exists solutions_insert on public.solutions;
create policy solutions_insert on public.solutions
  for insert to authenticated
  with check (
    public.can_write()
    and author_id = auth.uid()
    and public.has_content_access(required_permission)
    and (public.is_admin() or public.can_view_solution_target(question_id, group_id))
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
    and (public.is_admin() or public.can_view_solution_target(question_id, group_id))
  );

-- ---------------------------------------------------------------------------
-- Immutable deletion audit
-- ---------------------------------------------------------------------------

create table public.content_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  deleted_at timestamptz not null default clock_timestamp(),
  transaction_id bigint not null,
  table_name text not null,
  row_id uuid not null,
  actor_id uuid,
  client_role text,
  request_id text,
  session_user_name text not null,
  application_name text,
  trigger_depth integer not null,
  row_data jsonb not null
);

create index content_deletion_audit_time_idx
  on public.content_deletion_audit (deleted_at desc);
create index content_deletion_audit_transaction_idx
  on public.content_deletion_audit (transaction_id, deleted_at);
create index content_deletion_audit_target_idx
  on public.content_deletion_audit (table_name, row_id);

alter table public.content_deletion_audit enable row level security;
revoke all privileges on table public.content_deletion_audit from public, anon, authenticated;

create or replace function public.audit_deleted_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
begin
  insert into public.content_deletion_audit (
    transaction_id,
    table_name,
    row_id,
    actor_id,
    client_role,
    request_id,
    session_user_name,
    application_name,
    trigger_depth,
    row_data
  ) values (
    txid_current(),
    tg_table_name,
    old.id,
    auth.uid(),
    coalesce(claims ->> 'role', current_setting('role', true)),
    coalesce(headers ->> 'x-request-id', headers ->> 'cf-ray'),
    session_user,
    current_setting('application_name', true),
    pg_trigger_depth(),
    to_jsonb(old)
  );
  return old;
end;
$$;

revoke all on function public.audit_deleted_content() from public, anon, authenticated;

-- A cascade produces one audit row per deleted parent/child in the same
-- transaction_id. That makes the originating route visible after the fact.
create trigger exams_audit_delete
  before delete on public.exams
  for each row execute function public.audit_deleted_content();
create trigger questions_audit_delete
  before delete on public.questions
  for each row execute function public.audit_deleted_content();
create trigger question_groups_audit_delete
  before delete on public.question_groups
  for each row execute function public.audit_deleted_content();
create trigger solutions_audit_delete
  before delete on public.solutions
  for each row execute function public.audit_deleted_content();
create trigger ai_solutions_audit_delete
  before delete on public.ai_solutions
  for each row execute function public.audit_deleted_content();
create trigger senior_solutions_audit_delete
  before delete on public.senior_solutions
  for each row execute function public.audit_deleted_content();
create trigger topics_audit_delete
  before delete on public.topics
  for each row execute function public.audit_deleted_content();
create trigger theory_documents_audit_delete
  before delete on public.theory_documents
  for each row execute function public.audit_deleted_content();
create trigger profiles_audit_delete
  before delete on public.profiles
  for each row execute function public.audit_deleted_content();

create or replace function public.admin_list_deletion_audit(p_limit integer default 100)
returns table (
  id uuid,
  deleted_at timestamptz,
  transaction_id bigint,
  table_name text,
  row_id uuid,
  actor_id uuid,
  actor_display_name text,
  client_role text,
  request_id text,
  trigger_depth integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  return query
    select a.id,
           a.deleted_at,
           a.transaction_id,
           a.table_name,
           a.row_id,
           a.actor_id,
           p.display_name,
           a.client_role,
           a.request_id,
           a.trigger_depth
      from public.content_deletion_audit a
      left join public.profiles p on p.id = a.actor_id
     order by a.deleted_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.admin_get_deletion_audit(p_audit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  select to_jsonb(a) into result
    from public.content_deletion_audit a
   where a.id = p_audit_id;
  return result;
end;
$$;

revoke all on function public.admin_list_deletion_audit(integer) from public, anon;
revoke all on function public.admin_get_deletion_audit(uuid) from public, anon;
grant execute on function public.admin_list_deletion_audit(integer) to authenticated;
grant execute on function public.admin_get_deletion_audit(uuid) to authenticated;

commit;
