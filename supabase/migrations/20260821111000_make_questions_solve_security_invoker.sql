-- questions_solve hides answer columns by exposing only a column allow-list.
-- Keep that contract while making the view obey the caller's questions RLS.

begin;

-- The former question_code(questions.*) expression required SELECT on every
-- question column, including hidden answers. Accept only the two values the
-- formatter actually needs so the view can remain a safe column allow-list.
create or replace function public.question_code_for(
  p_exam_id uuid,
  p_question_number int
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when e.exam_code is null then
      substring(e.cohort from '\d+') || s.code || lpad(p_question_number::text, 3, '0')
    else
      substring(e.cohort from '\d+') || '-' || s.code || '-' || e.exam_code || '-' ||
      lpad(p_question_number::text, 3, '0')
  end
    from public.exams e
    join public.subjects s on s.id = e.subject_id
   where e.id = p_exam_id
     and s.code is not null;
$$;

revoke all on function public.question_code_for(uuid, int)
  from public, anon;
grant execute on function public.question_code_for(uuid, int)
  to authenticated, service_role;

-- These non-answer fields were added after the original column allow-list.
grant select (unit_source, variant_note, same_as)
  on table public.questions to authenticated;

create or replace view public.questions_solve
with (security_invoker = true)
as
  select id,
         exam_id,
         unit_id,
         question_number,
         question_type,
         set_id,
         stem_blocks,
         choices,
         answer_count,
         answer_status,
         professor,
         restorer_note,
         source_tags,
         variant_type,
         group_id,
         completeness,
         status,
         view_count,
         stem_text,
         created_by,
         updated_by,
         created_at,
         updated_at,
         unit_source,
         public.question_code_for(exam_id, question_number) as question_code,
         variant_note,
         same_as
    from public.questions
   where public.is_admin() or public.can_view_exam(exam_id);

revoke all privileges on table public.questions_solve
  from public, anon, authenticated;
grant select on table public.questions_solve to authenticated;

commit;
