-- =============================================================================
-- 문제로부터 테마 찾기
--
-- 테마 본문에 야마를 꽂으면 topic_questions 에 그 문제 id 가 들어간다. 그런데
-- 학생이 푸는 것은 그 문제가 아니라 같은 클러스터의 다른 판본일 수 있다.
-- 21학번 대표 문제에 이론을 붙여 놨는데 26학번 변주를 풀고 있는 식이다.
--
-- 그래서 문제 하나가 아니라 그 문제가 속한 클러스터 전체로 넓혀서 찾는다.
-- 이걸 하지 않으면 변주를 풀 때 이론이 뜨지 않는다.
--
-- SECURITY INVOKER(기본값)로 둔다. topics 와 topic_questions 의 RLS 가 그대로
-- 걸려야 권한 없는 사람에게 테마가 새지 않는다. SECURITY DEFINER 로 만들면
-- 정책을 통째로 우회한다.
-- =============================================================================

create or replace function public.topics_for_question(p_question_id uuid)
returns table (id uuid, title text, subject_id uuid, content jsonb)
language sql
stable
set search_path to 'public'
as $$
  with target as (
    select q.id, q.group_id from public.questions q where q.id = p_question_id
  ),
  family as (
    -- 자기 자신은 항상 포함하고, 클러스터에 묶여 있으면 형제도 함께 본다.
    select t.id from target t
    union
    select q.id
      from public.questions q
      join target t on t.group_id is not null and q.group_id = t.group_id
  )
  select distinct t.id, t.title, t.subject_id, t.content
    from public.topic_questions tq
    join public.topics t on t.id = tq.topic_id
   where tq.question_id in (select id from family);
$$;

comment on function public.topics_for_question(uuid) is
  '이 문제가 실린 테마들. 같은 야마 클러스터에 묶인 판본에 붙은 테마까지 함께 찾는다.';

revoke all on function public.topics_for_question(uuid) from public;
grant execute on function public.topics_for_question(uuid) to authenticated;
