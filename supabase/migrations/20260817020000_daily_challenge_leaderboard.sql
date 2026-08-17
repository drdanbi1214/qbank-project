-- 오늘의 문제 현황에서 다른 사람들의 연속 성공일도 볼 수 있게 순위를 계산한다.
-- 사용자별로 따로 계산하지 않고, 날짜별 문항 세트를 attempts 와 한 번에 조인해
-- 전체 사용자의 done-count 를 한 번에 구한 뒤 스트릭을 낸다.

create or replace function public.get_daily_challenge_leaderboard(p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  result jsonb;
begin
  with sets as (
    select date, cardinality(question_ids) as total, question_ids
    from public.daily_question_sets
    where date <= today
  ),
  expanded as (
    select s.date, qid
    from sets s, unnest(s.question_ids) as qid
  ),
  done_counts as (
    select e.date, a.user_id, count(distinct a.question_id) as done
    from expanded e
    join public.attempts a on a.question_id = e.qid
    group by e.date, a.user_id
  ),
  flagged as (
    select dc.user_id, dc.date, (dc.done >= s.total) as is_complete
    from done_counts dc
    join sets s on s.date = dc.date
  ),
  streak_groups as (
    select user_id, date,
           date - (row_number() over (partition by user_id order by date))::int as grp
    from flagged
    where is_complete
  ),
  runs as (
    select user_id, grp, max(date) as end_date, count(*)::int as len
    from streak_groups
    group by user_id, grp
  ),
  current_streaks as (
    select distinct on (user_id) user_id, len as current_streak
    from runs
    where end_date >= today - 1
    order by user_id, end_date desc
  ),
  longest_streaks as (
    select user_id, max(len) as longest_streak
    from runs
    group by user_id
  ),
  totals as (
    select user_id, count(*) as total_days
    from flagged
    where is_complete
    group by user_id
  ),
  ranked as (
    select
      p.id as user_id,
      p.display_name,
      p.avatar_url,
      coalesce(cs.current_streak, 0) as current_streak,
      coalesce(ls.longest_streak, 0) as longest_streak,
      coalesce(t.total_days, 0) as total_days
    from public.profiles p
    left join current_streaks cs on cs.user_id = p.id
    left join longest_streaks ls on ls.user_id = p.id
    left join totals t on t.user_id = p.id
    where p.is_suspended = false
      and (coalesce(cs.current_streak, 0) > 0 or coalesce(t.total_days, 0) > 0)
    order by coalesce(cs.current_streak, 0) desc, coalesce(t.total_days, 0) desc, p.display_name
    limit p_limit
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'user_id', user_id,
      'display_name', display_name,
      'avatar_url', avatar_url,
      'current_streak', current_streak,
      'longest_streak', longest_streak,
      'total_days', total_days
    )),
    '[]'::jsonb
  )
  into result
  from ranked;

  return result;
end;
$$;

grant execute on function public.get_daily_challenge_leaderboard(int) to authenticated;
