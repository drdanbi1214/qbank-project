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
from discussions d
left join questions q on q.id = d.question_id
left join exams e on e.id = q.exam_id;
