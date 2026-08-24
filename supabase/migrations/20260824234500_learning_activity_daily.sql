-- 마이페이지 학습 달력과 일별 이용 시간에 쓸 사용자별 활동 시간을 저장한다.
-- 기존 문제 풀이 시간은 attempts에서 한 번 백필하고, 이후에는 화면이 실제로
-- 활성화된 시간만 앱이 짧게 나누어 누적한다.

begin;

create table public.learning_activity_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  category text not null check (category in ('question', 'theory', 'other')),
  seconds integer not null default 0 check (seconds between 0 and 86400),
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_date, category)
);

comment on table public.learning_activity_daily is
  '사용자별 KST 일일 활성 이용 시간. question, theory(알렌·강의록), other로 구분한다.';

create index learning_activity_daily_date_idx
  on public.learning_activity_daily (activity_date desc, user_id);

alter table public.learning_activity_daily enable row level security;

create policy learning_activity_daily_select_own
  on public.learning_activity_daily
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.learning_activity_daily from public, anon;
grant select on table public.learning_activity_daily to authenticated;
grant all on table public.learning_activity_daily to service_role;

-- 배포 전 기록은 문제를 제출할 때 저장된 풀이 시간으로 채운다. 비정상적으로 긴
-- 단일 값은 1시간, 하루 합계는 24시간으로 제한한다.
insert into public.learning_activity_daily (
  user_id,
  activity_date,
  category,
  seconds
)
select
  a.user_id,
  (a.created_at at time zone 'Asia/Seoul')::date,
  'question',
  least(sum(least(a.time_spent_sec, 3600)), 86400)::integer
from public.attempts a
where a.time_spent_sec > 0
group by a.user_id, (a.created_at at time zone 'Asia/Seoul')::date
on conflict (user_id, activity_date, category) do nothing;

create function public.add_learning_activity(
  p_category text,
  p_seconds integer
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
begin
  if uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_category not in ('question', 'theory', 'other') then
    raise exception '지원하지 않는 활동 종류입니다.' using errcode = '22023';
  end if;
  -- 한 요청에 최대 5분만 허용해 조작이나 탭 복귀 시 과도한 누적을 막는다.
  if p_seconds is null or p_seconds < 1 or p_seconds > 300 then
    raise exception '활동 시간은 1~300초여야 합니다.' using errcode = '22023';
  end if;

  insert into public.learning_activity_daily (
    user_id,
    activity_date,
    category,
    seconds
  )
  values (uid, today_kst, p_category, p_seconds)
  on conflict (user_id, activity_date, category) do update
    set seconds = least(public.learning_activity_daily.seconds + excluded.seconds, 86400),
        updated_at = now();
end;
$$;

revoke all on function public.add_learning_activity(text, integer)
  from public, anon;
grant execute on function public.add_learning_activity(text, integer)
  to authenticated, service_role;

create function public.get_my_learning_activity(
  p_days integer default 112
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with settings as (
    select
      auth.uid() as uid,
      greatest(7, least(coalesce(p_days, 112), 366)) as days,
      (now() at time zone 'Asia/Seoul')::date as today
  ),
  dates as (
    select generate_series(
      s.today - (s.days - 1),
      s.today,
      interval '1 day'
    )::date as activity_date
    from settings s
    where s.uid is not null
  ),
  history as (
    select
      d.activity_date,
      coalesce(sum(a.seconds) filter (where a.category = 'question'), 0)::integer as question,
      coalesce(sum(a.seconds) filter (where a.category = 'theory'), 0)::integer as theory,
      coalesce(sum(a.seconds) filter (where a.category = 'other'), 0)::integer as other
    from dates d
    left join public.learning_activity_daily a
      on a.user_id = (select uid from settings)
     and a.activity_date = d.activity_date
    group by d.activity_date
    order by d.activity_date
  )
  select jsonb_build_object(
    'history', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', h.activity_date,
          'question', h.question,
          'theory', h.theory,
          'other', h.other
        )
        order by h.activity_date
      ),
      '[]'::jsonb
    )
  )
  from history h;
$$;

revoke all on function public.get_my_learning_activity(integer)
  from public, anon;
grant execute on function public.get_my_learning_activity(integer)
  to authenticated, service_role;

comment on function public.get_my_learning_activity(integer) is
  '로그인한 사용자의 최근 일별 문제·알렌/강의록·기타 활성 이용 시간을 반환한다.';

commit;
