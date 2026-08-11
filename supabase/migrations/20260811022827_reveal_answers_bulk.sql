-- =============================================================================
-- 여러 문제의 정답을 한 번에 공개한다 (문제집 인쇄용).
--
-- reveal_answer 를 문항 수만큼 부르면 요청이 수십 번 나가므로 묶어서 받는다.
-- 보안 수준은 reveal_answer 와 같다. 로그인한 사용자가 이미 문항별로 호출할 수
-- 있는 정보이고, 인쇄물에는 정답과 해설이 함께 들어가야 쓸모가 있다.
-- =============================================================================
create or replace function public.reveal_answers(p_question_ids uuid[])
returns table (
  question_id          uuid,
  editor_answer        int[],
  yama_answer          int[],
  answer_status        text,
  answer_note          text,
  official_explanation jsonb,
  model_answer         text,
  grading_points       jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    q.id,
    q.editor_answer,
    q.yama_answer,
    q.answer_status,
    q.answer_note,
    q.official_explanation,
    q.model_answer,
    q.grading_points
  from public.questions q
  where auth.uid() is not null
    and q.id = any(coalesce(p_question_ids, '{}'::uuid[]))
$$;

revoke execute on function public.reveal_answers(uuid[]) from public, anon;
grant execute on function public.reveal_answers(uuid[]) to authenticated;
