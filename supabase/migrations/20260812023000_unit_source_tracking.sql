-- 단원 배정이 AI 1차 분류인지 사람이 확정한 것인지 구분한다.
-- assignUnit() 을 통해 들어오는 배정(라벨링 큐, 배정 편집 화면의 단원 선택 UI)은
-- 전부 사람이 화면에서 직접 확정한 것이므로 human_confirmed 로 남긴다.
-- AI 가 문항 내용을 읽고 1차로 채워 넣는 경로는 별도 스크립트로 ai_suggested 를 남긴다.
alter table public.questions
  add column unit_source text check (unit_source in ('ai_suggested', 'human_confirmed'));

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
    unit_source
from questions;
