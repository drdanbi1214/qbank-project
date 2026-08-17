-- 오늘의 문제: 26학번 학년말고사 전 과목에서 매일 같은 10문제를 뽑아
-- 모든 사용자가 동일하게 푼다. cron/edge function 없이, 그날 첫 요청이
-- 들어올 때 결정적으로 생성해 저장하고 그 뒤로는 재사용한다.

create table if not exists public.daily_question_sets (
  date date primary key,
  question_ids uuid[] not null,
  created_at timestamptz not null default now()
);

alter table public.daily_question_sets enable row level security;
-- 클라이언트가 직접 읽고 쓰지 못하게 막는다. 아래 두 함수(security definer)를
-- 통해서만 접근한다.

alter table public.study_sessions drop constraint study_sessions_mode_check;
alter table public.study_sessions add constraint study_sessions_mode_check
  check (mode = any (array['sequential', 'block_test', 'wrong_only', 'bookmark', 'daily']));

-- 진행 중이던 다른 세션을 밀어내는 startSession() 의 abandon 로직이 daily
-- 세션은 건드리지 않도록, daily 는 앱 코드 쪽에서 별도 insert 로 만든다
-- (이 마이그레이션에서는 스키마만 정리).

create or replace function public.get_daily_question_set(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_date date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
  picked uuid[];
begin
  select question_ids into picked
  from public.daily_question_sets
  where date = target_date;

  if picked is not null then
    return jsonb_build_object('date', target_date, 'question_ids', to_jsonb(picked));
  end if;

  -- 날짜를 시드로 결정적 셔플: 같은 날짜면 누가 요청하든 같은 10문제가 나온다.
  perform setseed(hashtext(target_date::text)::double precision / 2147483648.0);

  select array_agg(id) into picked
  from (
    select q.id
    from public.questions q
    join public.exams e on e.id = q.exam_id
    where e.cohort = '26학번'
      and e.exam_name = '학년말고사'
      and q.status = 'published'
      and q.question_type <> 'essay'
      and q.set_id is null
      and q.group_id is null
      and q.yama_answer is not null
      and jsonb_array_length(q.choices) > 0
    order by random()
    limit 10
  ) sub;

  -- 동시에 여러 요청이 들어와도 먼저 커밋된 쪽 값을 그대로 반환한다(레이스 방지).
  insert into public.daily_question_sets (date, question_ids)
  values (target_date, picked)
  on conflict (date) do update set question_ids = public.daily_question_sets.question_ids
  returning question_ids into picked;

  return jsonb_build_object('date', target_date, 'question_ids', to_jsonb(picked));
end;
$$;

grant execute on function public.get_daily_question_set(date) to authenticated;

create or replace function public.get_daily_challenge_stats(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  result jsonb;
begin
  if p_user_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with sets as (
    select date, question_ids, cardinality(question_ids) as total
    from public.daily_question_sets
    where date <= today
  ),
  daily as (
    select
      s.date,
      s.total,
      (
        select count(distinct a.question_id)
        from public.attempts a
        where a.user_id = p_user_id
          and a.question_id = any(s.question_ids)
      ) as done
    from sets s
  ),
  flagged as (
    select date, total, done, (done >= total) as is_complete
    from daily
  ),
  streak_groups as (
    select date, date - (row_number() over (order by date))::int as grp
    from flagged
    where is_complete
  ),
  runs as (
    select grp, max(date) as end_date, count(*)::int as len
    from streak_groups
    group by grp
  )
  select jsonb_build_object(
    'current_streak', coalesce((
      select len from runs where end_date >= today - 1 order by end_date desc limit 1
    ), 0),
    'longest_streak', coalesce((select max(len) from runs), 0),
    'total_days', (select count(*) from flagged where is_complete),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('date', date, 'total', total, 'done', done) order by date)
      from flagged
      where date >= today - 111
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_daily_challenge_stats(uuid) to authenticated;
