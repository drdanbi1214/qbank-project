-- 야마 묶기 실패는 cluster_attach 호출이 롤백되므로, 클라이언트가 별도 RPC로
-- 남긴다. 운영자는 실패한 조합과 서버가 돌려준 이유를 관리자 화면에서 확인한다.

begin;

create table public.cluster_attach_failure_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  anchor_question_id uuid not null,
  target_question_id uuid not null,
  variant text not null check (variant in ('identical', 'modified')),
  error_message text not null check (char_length(error_message) between 1 and 2000),
  error_code text check (error_code is null or char_length(error_code) <= 64)
);

create index cluster_attach_failure_logs_created_at_idx
  on public.cluster_attach_failure_logs (created_at desc);

alter table public.cluster_attach_failure_logs enable row level security;
revoke all on table public.cluster_attach_failure_logs from public, anon, authenticated;

create or replace function public.record_cluster_attach_failure(
  p_anchor_id uuid,
  p_target_id uuid,
  p_variant text,
  p_error_message text,
  p_error_code text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_anchor_id = p_target_id then
    raise exception '기준 문제와 대상 문제는 달라야 합니다.' using errcode = '22023';
  end if;
  if p_variant not in ('identical', 'modified') then
    raise exception '변주 종류가 올바르지 않습니다.' using errcode = '22023';
  end if;

  -- 고장 난 브라우저 확장이나 반복 클릭이 운영 로그를 채우지 않게 제한한다.
  if (
    select count(*)
      from public.cluster_attach_failure_logs
     where actor_id = auth.uid()
       and created_at > now() - interval '1 hour'
  ) >= 30 then
    return null;
  end if;

  insert into public.cluster_attach_failure_logs (
    actor_id, anchor_question_id, target_question_id, variant, error_message, error_code
  ) values (
    auth.uid(), p_anchor_id, p_target_id, p_variant,
    coalesce(nullif(left(trim(p_error_message), 2000), ''), '알 수 없는 오류'),
    nullif(left(trim(coalesce(p_error_code, '')), 64), '')
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_list_cluster_attach_failures(p_limit integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  anchor_question_id uuid,
  anchor_question_code text,
  target_question_id uuid,
  target_question_code text,
  variant text,
  error_message text,
  error_code text
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  return query
    select
      l.id,
      l.created_at,
      l.actor_id,
      p.display_name,
      l.anchor_question_id,
      coalesce(a.question_code, l.anchor_question_id::text),
      l.target_question_id,
      coalesce(t.question_code, l.target_question_id::text),
      l.variant,
      l.error_message,
      l.error_code
    from public.cluster_attach_failure_logs l
    join public.profiles p on p.id = l.actor_id
    left join public.questions_solve a on a.id = l.anchor_question_id
    left join public.questions_solve t on t.id = l.target_question_id
    order by l.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.record_cluster_attach_failure(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.admin_list_cluster_attach_failures(integer) from public, anon;
grant execute on function public.record_cluster_attach_failure(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.admin_list_cluster_attach_failures(integer) to authenticated;

comment on table public.cluster_attach_failure_logs is
  '야마 문제-문제 연결 요청이 실패했을 때 별도 요청으로 남기는 운영 진단 로그';

commit;
