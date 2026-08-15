-- 콘텐츠 가시성 4단계 — 집계와 게시판의 정합성.
--
-- 3단계에서 문제와 정답은 막았지만, RLS 를 지나치는 SECURITY DEFINER
-- 집계 함수들은 여전히 숨겨진 문제를 세고 있었다. 그래서 권한 없는
-- 사람에게 "440문제만 보이는데 전체는 1117문제"처럼 어긋나 보였다.
--
-- 게시판은 그보다 심해서, 숨겨진 문제에 달린 글의 제목과 본문이 그대로
-- 노출되고 있었다. discussions_feed 가 postgres 소유의 일반 뷰라 RLS 를
-- 우회했기 때문이다.

-- ---------------------------------------------------------------------------
-- 문제 단위 가시성 판정
--
-- 게시글처럼 문제를 참조만 하는 곳에서 쓴다. 문제에 매이지 않은
-- 글(question_id 가 null)은 항상 보인다.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_question(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_question_id is null
      or exists (
           select 1
             from public.questions q
             join public.exams e on e.id = q.exam_id
            where q.id = p_question_id
              and public.has_content_access(e.required_permission)
         );
$$;

revoke all on function public.can_view_question(uuid) from public;
grant execute on function public.can_view_question(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 진도율
-- ---------------------------------------------------------------------------
create or replace function public.get_progress_by_exam()
returns table(exam_id uuid, total_questions integer, solved_questions integer, correct_questions integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select q.exam_id,
         count(*)::int,
         count(a.question_id)::int,
         count(*) filter (where a.is_correct)::int
    from public.questions q
    join public.exams e on e.id = q.exam_id
    left join lateral (
      select at.question_id, at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.status = 'published'
     and (public.is_admin() or public.has_content_access(e.required_permission))
   group by q.exam_id;
$function$;

create or replace function public.get_progress_by_unit()
returns table(subject_id uuid, unit_id uuid, total_questions integer, solved_questions integer, correct_questions integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.subject_id,
         q.unit_id,
         count(*)::int,
         count(a.question_id)::int,
         count(*) filter (where a.is_correct)::int
    from public.questions q
    join public.exams e on e.id = q.exam_id
    left join lateral (
      select at.question_id, at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.status = 'published'
     and (public.is_admin() or public.has_content_access(e.required_permission))
   group by e.subject_id, q.unit_id;
$function$;

-- ---------------------------------------------------------------------------
-- 내 요약
--
-- 전체 문제 수뿐 아니라 푼 문제 수와 약점 단원도 같이 걸러야 한다.
-- 분모만 줄이면 "440문제 중 500문제 풀었음" 같은 값이 나올 수 있다.
-- (권한을 회수당한 사람에게는 예전 기록이 그대로 남아 있기 때문이다.)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  total_questions int;
  solved int;
  correct int;
  streak int := 0;
  probe date;
  weak jsonb;
  solution_count int;
  upvotes int;
begin
  if uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  select count(*) into total_questions
    from public.questions q
    join public.exams e on e.id = q.exam_id
   where q.status = 'published'
     and (public.is_admin() or public.has_content_access(e.required_permission));

  select
    count(distinct a.question_id),
    count(distinct a.question_id) filter (where a.is_correct is true)
  into solved, correct
  from public.attempts a
  join public.questions q on q.id = a.question_id
  join public.exams e on e.id = q.exam_id
  where a.user_id = uid
    and a.is_active
    and (public.is_admin() or public.has_content_access(e.required_permission));

  -- 연속 학습일: 오늘(없으면 어제)부터 하루씩 거슬러 올라가며 기록이 있는 날을 센다.
  select max(d) into probe
  from (
    select distinct (a.created_at at time zone 'Asia/Seoul')::date as d
    from public.attempts a
    where a.user_id = uid
  ) days
  where d >= (now() at time zone 'Asia/Seoul')::date - 1;

  while probe is not null loop
    streak := streak + 1;
    select d into probe
    from (
      select distinct (a.created_at at time zone 'Asia/Seoul')::date as d
      from public.attempts a
      where a.user_id = uid
    ) days
    where d = probe - 1;
  end loop;

  -- 약점 단원: 채점된 시도가 3회 이상인 단원 중 정답률이 낮은 순
  select coalesce(jsonb_agg(row_to_json(w)), '[]'::jsonb) into weak
  from (
    select
      u.id as unit_id,
      u.name as unit_name,
      s.name as subject_name,
      count(*)::int as attempts,
      round(100.0 * count(*) filter (where a.is_correct is true) / count(*))::int as accuracy
    from public.attempts a
    join public.questions q on q.id = a.question_id
    join public.exams e on e.id = q.exam_id
    join public.units u on u.id = q.unit_id
    join public.subjects s on s.id = u.subject_id
    where a.user_id = uid and a.is_active and a.is_correct is not null
      and (public.is_admin() or public.has_content_access(e.required_permission))
    group by u.id, u.name, s.name
    having count(*) >= 3
    order by accuracy asc, attempts desc
    limit 5
  ) w;

  select count(*)::int into solution_count from public.solutions where author_id = uid;
  select coalesce(sum(upvote_count), 0)::int into upvotes from public.solutions where author_id = uid;

  return jsonb_build_object(
    'total_questions', total_questions,
    'solved', coalesce(solved, 0),
    'correct', coalesce(correct, 0),
    'streak_days', streak,
    'weak_units', weak,
    'solution_count', solution_count,
    'upvotes_received', upvotes
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 내 문제별 상태 / 오답노트
-- ---------------------------------------------------------------------------
create or replace function public.get_my_question_states(p_question_ids uuid[])
returns table(question_id uuid, is_correct boolean, attempts integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select q.id,
         a.is_correct,
         (select count(*)::int from public.attempts c
           where c.question_id = q.id and c.user_id = auth.uid() and c.is_active)
    from public.questions q
    join public.exams e on e.id = q.exam_id
    left join lateral (
      select at.is_correct
        from public.attempts at
       where at.question_id = q.id
         and at.user_id = auth.uid()
         and at.is_active
       order by at.created_at desc
       limit 1
    ) a on true
   where q.id = any(p_question_ids)
     and (public.is_admin() or public.has_content_access(e.required_permission));
$function$;

create or replace function public.get_wrong_notes(p_subject_id uuid default null::uuid, p_unit_id uuid default null::uuid, p_exam_id uuid default null::uuid, p_cohort text default null::text)
returns table(question_id uuid, exam_id uuid, unit_id uuid, question_number integer, stem_text text, answer_status text, total_attempts integer, wrong_count integer, last_attempt_at timestamp with time zone, last_is_correct boolean, recent_all_wrong boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select
      a.question_id,
      a.is_correct,
      a.created_at,
      row_number() over (partition by a.question_id order by a.created_at desc) as rn
    from public.attempts a
    where a.user_id = auth.uid()
      and a.is_active
  ),
  agg as (
    select
      m.question_id,
      count(*)::int as total_attempts,
      count(*) filter (where m.is_correct is false)::int as wrong_count,
      max(m.created_at) as last_attempt_at,
      bool_or(m.rn = 1 and m.is_correct is true) as last_is_correct,
      count(*) filter (where m.rn <= 3)::int as recent_count,
      coalesce(bool_and(m.is_correct is false) filter (where m.rn <= 3), false) as recent_wrong
    from mine m
    group by m.question_id
  )
  select
    q.id,
    q.exam_id,
    q.unit_id,
    q.question_number,
    q.stem_text,
    q.answer_status,
    g.total_attempts,
    g.wrong_count,
    g.last_attempt_at,
    g.last_is_correct,
    (g.recent_count >= 3 and g.recent_wrong) as recent_all_wrong
  from agg g
  join public.questions q on q.id = g.question_id
  join public.exams e on e.id = q.exam_id
  where g.wrong_count > 0
    and q.status = 'published'
    and (public.is_admin() or public.has_content_access(e.required_permission))
    and (p_subject_id is null or e.subject_id = p_subject_id)
    and (p_unit_id is null or q.unit_id = p_unit_id)
    and (p_exam_id is null or q.exam_id = p_exam_id)
    and (p_cohort is null or e.cohort = p_cohort)
$function$;

-- ---------------------------------------------------------------------------
-- 게시판
--
-- 숨겨진 문제에 달린 글은 목록에서 아예 빠진다. 테이블과 뷰 양쪽을
-- 막는다. 클라이언트가 discussions_feed 로 목록을 읽고, 상세/수정은
-- discussions 를 직접 읽기 때문이다.
-- ---------------------------------------------------------------------------
drop policy if exists discussions_select on public.discussions;
create policy discussions_select on public.discussions
  for select to authenticated
  using (public.is_admin() or public.can_view_question(question_id));

create or replace view public.discussions_feed as
  select d.id,
         d.question_id,
         d.author_id,
         d.category,
         d.title,
         d.content,
         d.confusion_point,
         d.status,
         d.view_count,
         d.upvote_count,
         d.reply_count,
         d.created_at,
         d.updated_at,
         q.unit_id as question_unit_id,
         q.question_number,
         q.stem_text as question_stem_text,
         q.exam_id as question_exam_id,
         e.subject_id as question_subject_id,
         e.cohort as question_cohort,
         d.content_edited_at
    from public.discussions d
    left join public.questions q on q.id = d.question_id
    left join public.exams e on e.id = q.exam_id
   where public.is_admin() or public.can_view_question(d.question_id);
