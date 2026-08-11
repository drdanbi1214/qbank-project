-- =============================================================================
-- 게시판 목록용 뷰
--
-- 목록에서 과목/학번으로 거르려면 discussions -> questions -> exams 조인이 필요하다.
-- 매번 클라이언트에서 문제 id 목록을 만들어 in() 으로 넘기면 글이 늘수록 무거워지므로
-- 뷰로 한 번에 내려받는다.
--
-- security_invoker 라 questions 의 컬럼 권한(정답 컬럼 회수)이 그대로 적용된다.
-- 즉 이 뷰로는 정답 관련 컬럼을 얻을 수 없다.
-- =============================================================================

create or replace view public.discussions_feed
with (security_invoker = on)
as
select
  d.id,
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
  q.unit_id        as question_unit_id,
  q.question_number,
  q.stem_text      as question_stem_text,
  q.exam_id        as question_exam_id,
  e.subject_id     as question_subject_id,
  e.cohort         as question_cohort
from public.discussions d
left join public.questions q on q.id = d.question_id
left join public.exams e on e.id = q.exam_id;

grant select on public.discussions_feed to authenticated;
