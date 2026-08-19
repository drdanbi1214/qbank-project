-- 배정을 스터디별로 나눈다.
--
-- 지금까지는 UNIQUE(question_id) 라 한 문항에 배정이 전체를 통틀어 하나뿐이었다.
-- 합본3 스터디가 이미 440문항을 배정해 둔 터라, 레옵스가 같은 문항을 자기
-- 스터디 몫으로 배정하려 하면 그대로 막혔다.
--
-- NULLS NOT DISTINCT 를 쓰는 이유: required_permission 이 null 인 배정은
-- "특정 스터디에 매이지 않은 배정" 이라 여러 개 있으면 안 된다. 기본 동작
-- (NULLS DISTINCT) 이면 null 끼리는 안 부딪혀서 전역 배정이 문항당 여러 개
-- 생길 수 있다.

alter table public.assignments drop constraint assignments_question_id_key;

alter table public.assignments
  add constraint assignments_question_scope_key
  unique nulls not distinct (question_id, required_permission);
