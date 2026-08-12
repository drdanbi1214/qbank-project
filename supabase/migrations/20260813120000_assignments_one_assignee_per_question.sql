-- 한 문항은 한 명에게만 배정되도록 강제한다.
-- 기존 제약은 (question_id, assignee_id) 조합만 중복을 막아서, 같은 문항을
-- 서로 다른 담당자에게 여러 번 배정할 수 있었다.
alter table public.assignments drop constraint assignments_question_id_assignee_id_key;
alter table public.assignments add constraint assignments_question_id_key unique (question_id);
