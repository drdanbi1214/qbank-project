-- 문제 코드(학번2자리+과목코드2자리+문항번호3자리, 7자리) 추적용.
-- exams.cohort 는 questions 테이블에 없어 네이티브 generated column으로는
-- 못 만든다(생성 컬럼은 같은 행의 값만 쓸 수 있음). 대신 함수 + 뷰로 계산해서
-- 항상 최신 상태를 보장한다 (저장된 값이 아니라 조회 시점에 계산).
alter table public.subjects add column code text unique;

update subjects set code = '01' where name = '내과';
update subjects set code = '02' where name = '외과';
update subjects set code = '03' where name = '산부인과';
update subjects set code = '04' where name = '소아청소년과';
update subjects set code = '05' where name = '정신건강의학과';
update subjects set code = '06' where name = '신경과';
update subjects set code = '07' where name = '정형외과';
update subjects set code = '08' where name = '영상의학과';
update subjects set code = '09' where name = '진단검사의학과';

create or replace function public.question_code(q public.questions)
returns text
language sql
stable
set search_path = public
as $$
  select substring(e.cohort from '\d+') || s.code || lpad(q.question_number::text, 3, '0')
    from public.exams e
    join public.subjects s on s.id = e.subject_id
   where e.id = q.exam_id
     and s.code is not null;
$$;

revoke execute on function public.question_code(public.questions) from public, anon;
grant execute on function public.question_code(public.questions) to authenticated;

create or replace view public.questions_solve as
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
    public.question_code(questions.*) as question_code
from questions;
