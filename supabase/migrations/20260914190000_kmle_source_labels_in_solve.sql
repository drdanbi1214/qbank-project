begin;

-- KMLE 풀이 화면에서 Allen 원시험의 시험명·교시·문제 번호를 표시할 수 있게
-- 정답을 숨기는 기존 questions_solve allow-list 끝에 출처 메타데이터만 붙인다.
create or replace view public.questions_solve
with (security_invoker = true)
as
  select q.id,
         q.exam_id,
         q.unit_id,
         q.question_number,
         q.question_type,
         q.set_id,
         q.stem_blocks,
         q.choices,
         q.answer_count,
         q.answer_status,
         q.professor,
         q.restorer_note,
         q.source_tags,
         q.variant_type,
         q.group_id,
         q.completeness,
         q.status,
         q.view_count,
         q.stem_text,
         q.created_by,
         q.updated_by,
         q.created_at,
         q.updated_at,
         q.unit_source,
         public.question_code_for(q.exam_id, q.question_number) as question_code,
         q.variant_note,
         q.same_as,
         ks.allen_exam,
         ks.allen_session,
         ks.allen_question_number,
         ks.allen_label
    from public.questions q
    left join public.kmle_sources ks on ks.question_id = q.id
   where public.is_admin() or public.can_view_exam(q.exam_id);

revoke all privileges on table public.questions_solve
  from public, anon, authenticated;
grant select on table public.questions_solve to authenticated;

-- 출처 표시는 별도 필드로 제공하므로 일반 문제 메모에 반복 문구를 넣지 않는다.
update public.questions
   set restorer_note = null
 where restorer_note = 'Allen에서 수집한 국시 KMLE 문제';

commit;
