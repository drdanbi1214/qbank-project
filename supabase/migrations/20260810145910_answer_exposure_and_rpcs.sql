-- =============================================================================
-- 정답 비노출 처리
--
-- 규칙: 미제출 상태에서 정답 정보가 DOM 이나 네트워크 응답에 노출되면 안 된다.
-- questions 테이블의 정답 관련 컬럼은 SELECT 권한 자체를 회수하고,
-- 제출/공개 시점에 호출하는 RPC 로만 내려준다.
-- 편집 화면은 get_question_for_edit() 로 전체 행을 받는다.
-- =============================================================================

revoke select on public.questions from anon, authenticated;

grant select (
  id, exam_id, unit_id, question_number, question_type, set_id,
  stem_blocks, choices, answer_count, answer_status,
  professor, restorer_note, source_tags, variant_type,
  group_id, completeness, status, view_count,
  stem_text, stem_norm,
  created_by, updated_by, created_at, updated_at
) on public.questions to authenticated;

-- 풀이 화면이 사용하는 안전한 읽기 뷰 (RLS 는 기반 테이블 정책을 그대로 따른다)
create view public.questions_solve
with (security_invoker = on)
as
select
  id, exam_id, unit_id, question_number, question_type, set_id,
  stem_blocks, choices, answer_count, answer_status,
  professor, restorer_note, source_tags, variant_type,
  group_id, completeness, status, view_count,
  stem_text,
  created_by, updated_by, created_at, updated_at
from public.questions;

grant select on public.questions_solve to authenticated;

-- 정답 공개 (정답 확인 버튼 / 스킵 시점에 호출)
create or replace function public.reveal_answer(p_question_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q public.questions;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  select * into q from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'question_id', q.id,
    'editor_answer', to_jsonb(q.editor_answer),
    'yama_answer', to_jsonb(q.yama_answer),
    'answer_status', q.answer_status,
    'answer_note', q.answer_note,
    'official_explanation', q.official_explanation,
    'model_answer', q.model_answer,
    'grading_points', q.grading_points
  );
end;
$$;

-- 편집 화면용 전체 행 (위키형이므로 정지되지 않은 로그인 사용자면 열람 가능)
create or replace function public.get_question_for_edit(p_question_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q public.questions;
begin
  if not public.can_write() then
    raise exception '편집 권한이 없습니다.' using errcode = '42501';
  end if;

  select * into q from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;

  return to_jsonb(q);
end;
$$;

-- 문제 통계 (정답률, 누적 풀이 횟수, 평균 풀이 시간, 보기별 선택 분포)
create or replace function public.get_question_stats(p_question_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select selected_answer, is_correct, time_spent_sec
      from public.attempts
     where question_id = p_question_id
  ),
  base as (
    select count(*)::int as total,
           count(*) filter (where is_correct)::int as correct,
           count(*) filter (where is_correct is not null)::int as graded,
           avg(time_spent_sec) as avg_time
      from a
  ),
  dist as (
    select s.val, count(*)::int as cnt
      from a, unnest(a.selected_answer) as s(val)
     group by s.val
  )
  select jsonb_build_object(
    'total_attempts', base.total,
    'correct_count', base.correct,
    'correct_rate', case when base.graded > 0
                         then round(base.correct::numeric * 100 / base.graded, 1)
                    end,
    'avg_time_spent_sec', case when base.avg_time is not null then round(base.avg_time)::int end,
    'choice_distribution', coalesce((select jsonb_object_agg(val::text, cnt) from dist), '{}'::jsonb)
  )
  from base;
$$;

-- 채점 및 기록. 정답은 이 시점에만 응답에 포함된다.
create or replace function public.submit_attempt(
  p_question_id    uuid,
  p_selected       int[] default '{}'::int[],
  p_time_spent_sec int default null,
  p_self_grade     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q         public.questions;
  uid       uuid := auth.uid();
  correct   boolean;
  next_no   int;
  new_id    uuid;
begin
  if not public.can_write() then
    raise exception '쓰기 권한이 없습니다.' using errcode = '42501';
  end if;

  select * into q from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;

  -- 채점 기준은 언제나 editor_answer. yama_answer 로는 채점하지 않는다.
  if q.question_type = 'essay' then
    correct := case p_self_grade when 'correct' then true when 'wrong' then false end;
  elsif coalesce(array_length(q.editor_answer, 1), 0) = 0 then
    correct := null;
  else
    correct := (
      select coalesce(array_agg(x order by x), '{}'::int[])
        from unnest(q.editor_answer) as x
    ) = (
      select coalesce(array_agg(y order by y), '{}'::int[])
        from (select distinct unnest(coalesce(p_selected, '{}'::int[])) as y) s
    );
  end if;

  select coalesce(max(attempt_number), 0) + 1 into next_no
    from public.attempts
   where question_id = p_question_id and user_id = uid;

  insert into public.attempts (
    question_id, user_id, selected_answer, is_correct, self_grade, time_spent_sec, attempt_number
  )
  values (
    p_question_id, uid, coalesce(p_selected, '{}'::int[]), correct, p_self_grade,
    p_time_spent_sec, next_no
  )
  returning id into new_id;

  return jsonb_build_object(
    'attempt_id', new_id,
    'attempt_number', next_no,
    'is_correct', correct,
    'answer', public.reveal_answer(p_question_id),
    'stats', public.get_question_stats(p_question_id)
  );
end;
$$;

-- 조회수 증가
create or replace function public.increment_question_view(p_question_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.questions set view_count = view_count + 1 where id = p_question_id;
$$;

create or replace function public.increment_discussion_view(p_discussion_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.discussions set view_count = view_count + 1 where id = p_discussion_id;
$$;

-- 중복 문제 후보 탐지. 정규화 stem 유사도 기준.
create or replace function public.find_similar_questions(
  p_question_id uuid,
  p_threshold   real default 0.85,
  p_limit       int default 20
)
returns table (
  question_id     uuid,
  similarity      real,
  exam_id         uuid,
  question_number int,
  cohort          text,
  subject_name    text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with target as (
    select stem_norm, group_id from public.questions where id = p_question_id
  )
  select q.id,
         extensions.similarity(q.stem_norm, t.stem_norm) as sim,
         q.exam_id,
         q.question_number,
         e.cohort,
         s.name
    from public.questions q
    join target t on true
    join public.exams e on e.id = q.exam_id
    join public.subjects s on s.id = e.subject_id
   where q.id <> p_question_id
     and length(t.stem_norm) > 0
     and extensions.similarity(q.stem_norm, t.stem_norm) >= p_threshold
     and (q.group_id is null or t.group_id is null or q.group_id <> t.group_id)
   order by sim desc
   limit p_limit;
$$;

-- 진행 초기화: 물리삭제가 아니라 is_active = false
create or replace function public.reset_progress(
  p_subject_id uuid default null,
  p_unit_id    uuid default null,
  p_exam_id    uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if not public.can_write() then
    raise exception '쓰기 권한이 없습니다.' using errcode = '42501';
  end if;

  update public.attempts a
     set is_active = false
   where a.user_id = auth.uid()
     and a.is_active
     and a.question_id in (
       select q.id
         from public.questions q
         join public.exams e on e.id = q.exam_id
         left join public.units u on u.id = q.unit_id
        where (p_unit_id is null or q.unit_id = p_unit_id)
          and (p_exam_id is null or q.exam_id = p_exam_id)
          and (p_subject_id is null or e.subject_id = p_subject_id or u.subject_id = p_subject_id)
     );

  get diagnostics affected = row_count;
  return affected;
end;
$$;
