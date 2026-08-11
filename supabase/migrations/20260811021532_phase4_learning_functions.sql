-- =============================================================================
-- Phase 4 학습 도구용 함수
--   - 오답노트 집계
--   - 검색 (pg_trgm 유사도 + 부분 일치)
--   - 마이페이지 요약 통계
-- 모두 본인 데이터만 다루므로 auth.uid() 를 직접 쓴다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tiptap JSON 에서 평문만 뽑아낸다 (풀이 검색용)
-- -----------------------------------------------------------------------------
create or replace function public.richtext_plain(doc jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(value #>> '{}', ' '), '')
  from jsonb_path_query(coalesce(doc, '{}'::jsonb), '$.**.text') as value
$$;

-- 검색어를 stem_norm 과 같은 방식으로 정규화한다.
-- normalize_stem 은 stem_blocks(jsonb) 를 받으므로 문자열용을 따로 둔다.
create or replace function public.normalize_search_text(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(coalesce(input, '')), '[^가-힣a-z]', '', 'g');
$$;

-- -----------------------------------------------------------------------------
-- 오답노트
--
-- 활성 시도(is_active) 중 오답이 한 번이라도 있는 문제를 모은다.
-- recent_all_wrong 은 "최근 3회 시도가 모두 오답" 인 경우로, 3회 미만이면 false 다.
-- -----------------------------------------------------------------------------
create or replace function public.get_wrong_notes(
  p_subject_id uuid default null,
  p_unit_id    uuid default null,
  p_exam_id    uuid default null,
  p_cohort     text default null
)
returns table (
  question_id      uuid,
  exam_id          uuid,
  unit_id          uuid,
  question_number  int,
  stem_text        text,
  answer_status    text,
  total_attempts   int,
  wrong_count      int,
  last_attempt_at  timestamptz,
  last_is_correct  boolean,
  recent_all_wrong boolean
)
language sql
stable
security definer
set search_path = public
as $$
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
    and (p_subject_id is null or e.subject_id = p_subject_id)
    and (p_unit_id is null or q.unit_id = p_unit_id)
    and (p_exam_id is null or q.exam_id = p_exam_id)
    and (p_cohort is null or e.cohort = p_cohort)
$$;

-- -----------------------------------------------------------------------------
-- 검색
--
-- 한국어 형태소 분석기가 없으므로 부분 일치(ILIKE)와 trgm 유사도를 함께 쓴다.
-- 짧은 검색어는 trgm 유사도가 잘 안 잡혀서 부분 일치가 주로 걸린다.
-- similarity() 는 extensions 스키마에 있으므로 search_path 에 함께 넣는다.
-- 정답 관련 컬럼은 어떤 경우에도 내보내지 않는다.
-- -----------------------------------------------------------------------------
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
  -- 같은 문제가 본문과 풀이 양쪽에서 걸리면 점수가 높은 쪽만 남긴다.
  select distinct on (m.id)
    m.id, m.exam_id, m.unit_id, m.question_number, m.stem_text,
    m.score, m.matched_in, left(m.snippet, 300)
  from merged m
  order by m.id, m.score desc
  limit p_limit
$$;

-- -----------------------------------------------------------------------------
-- 마이페이지 요약
--   전체 진행률, 연속 학습일, 약점 단원, 작성한 풀이와 받은 추천
-- -----------------------------------------------------------------------------
create or replace function public.get_my_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

  select count(*) into total_questions from public.questions where status = 'published';

  select
    count(distinct a.question_id),
    count(distinct a.question_id) filter (where a.is_correct is true)
  into solved, correct
  from public.attempts a
  where a.user_id = uid and a.is_active;

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
    join public.units u on u.id = q.unit_id
    join public.subjects s on s.id = u.subject_id
    where a.user_id = uid and a.is_active and a.is_correct is not null
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
$$;

revoke execute on function public.get_wrong_notes(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.search_questions(text, boolean, uuid, text, int) from public, anon;
revoke execute on function public.get_my_summary() from public, anon;
revoke execute on function public.richtext_plain(jsonb) from public, anon;
revoke execute on function public.normalize_search_text(text) from public, anon;

grant execute on function public.get_wrong_notes(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.search_questions(text, boolean, uuid, text, int) to authenticated;
grant execute on function public.get_my_summary() to authenticated;
grant execute on function public.richtext_plain(jsonb) to authenticated;
grant execute on function public.normalize_search_text(text) to authenticated;
