-- =============================================================================
-- 데모 시드 데이터
--
-- 실제 기출 데이터가 들어오기 전(Phase 5)까지 화면을 확인하기 위한 샘플이다.
-- 모든 stem 블록 타입과 문제 유형(A형/R형/서술형), 정답 상태, 중복 그룹을 덮는다.
-- 고정 UUID 를 쓰므로 seed_demo_rollback.sql 로 깨끗하게 지울 수 있다.
--
-- 적용:   psql 또는 Supabase SQL Editor 에 그대로 붙여넣기
-- 되돌리기: supabase/seed_demo_rollback.sql
-- =============================================================================

-- 과목 ---------------------------------------------------------------------
insert into public.subjects (id, name, icon_key, sort_order) values
  ('a0000000-0000-4000-8000-000000000001', '정신건강의학과', 'brain',  1),
  ('a0000000-0000-4000-8000-000000000002', '외과',           'scalpel', 2),
  ('a0000000-0000-4000-8000-000000000003', '내과',           'heart',   3)
on conflict (id) do nothing;

-- 단원 ---------------------------------------------------------------------
insert into public.units (id, subject_id, name, sort_order) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '조현병',   1),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', '기분장애', 2),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', '불안장애', 3),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', '간담췌',   1),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', '대장항문', 2),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003', '순환기',   1)
on conflict (id) do nothing;

-- 시험 ---------------------------------------------------------------------
insert into public.exams (
  id, cohort, subject_id, exam_name, exam_date, duration_min, format,
  total_questions, restored_questions, overview
) values
  ('c0000000-0000-4000-8000-000000000001', '20학번', 'a0000000-0000-4000-8000-000000000001',
   '학년말고사', '2023-10-30', 60, 'CBT', 50, 50,
   '교수님들께서 전반적으로 강의록 위주로 출제하셨습니다. 조현병과 기분장애 파트 비중이 높았고, 약물 부작용을 묻는 문항이 반복해서 나왔습니다.'),
  ('c0000000-0000-4000-8000-000000000002', '20학번', 'a0000000-0000-4000-8000-000000000002',
   '학년말고사', '2023-11-14', 90, 'PBT', 60, 55,
   '간담췌 파트에서 수술 적응증을 묻는 문항이 많았습니다.'),
  ('c0000000-0000-4000-8000-000000000003', '19학번', 'a0000000-0000-4000-8000-000000000001',
   '학년말고사', '2022-10-28', 60, 'CBT', 50, 48,
   '작년 기출과 겹치는 문항이 여러 개 있었습니다.')
on conflict (id) do nothing;

-- R형 세트 -----------------------------------------------------------------
insert into public.question_sets (id, exam_id, set_title, instruction, shared_choices, sort_order) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   '다음 보기에서 고르시오', '각 문항에 가장 적합한 약물을 하나씩 고르시오.',
   '[{"key":"A","text":"haloperidol"},
     {"key":"B","text":"clozapine"},
     {"key":"C","text":"lithium"},
     {"key":"D","text":"fluoxetine"},
     {"key":"E","text":"lorazepam"},
     {"key":"F","text":"valproate"}]'::jsonb, 1)
on conflict (id) do nothing;

-- 문제 ---------------------------------------------------------------------
-- 1) 텍스트 + 랩박스, 야마답과 편집자답이 다른 경우 (경고 배너 확인용)
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, answer_note,
  professor, restorer_note, source_tags, variant_type, completeness, status
) values (
  'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001', 1, 'A',
  '[{"type":"text","content":"24세 남자가 6개월 전부터 누군가 자신을 감시한다는 생각에 사로잡혀 방에서 나오지 않는다고 가족에 의해 응급실로 왔다. 혼잣말이 늘었고 최근 2주간 거의 잠을 자지 않았다."},
    {"type":"labbox","items":[{"label":"WBC","value":"7,200"},{"label":"Hb","value":"14.7"},{"label":"AST/ALT","value":"22/18"},{"label":"TSH","value":"1.8"}]},
    {"type":"text","content":"가장 적절한 진단은?"}]'::jsonb,
  '[{"no":1,"text":"조현양상장애(schizophreniform disorder)","image_url":null},
    {"no":2,"text":"단기정신병적장애(brief psychotic disorder)","image_url":null},
    {"no":3,"text":"조현병(schizophrenia)","image_url":null},
    {"no":4,"text":"조현정동장애(schizoaffective disorder)","image_url":null},
    {"no":5,"text":"망상장애(delusional disorder)","image_url":null}]'::jsonb,
  1, '{3}', '{1}', 'disputed',
  '복기 당시에는 6개월 기준을 놓쳐 조현양상장애로 통용되었으나, 증상 지속기간이 6개월이므로 조현병이 맞습니다.',
  '김OO 교수님', '짤야마라 선지 순서가 다를 수 있음', '{}', 'original', 'complete', 'published'
) on conflict (id) do nothing;

-- 2) 텍스트 + 표, 정답 확정
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, completeness, status
) values (
  'e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001', 2, 'A',
  '[{"type":"text","content":"다음은 조현병의 유병률에 관한 표이다."},
    {"type":"table","headers":["인구군","유병률(%)"],
     "rows":[["일반인구","1.0"],["조현병 환자의 형제","8.0"],["부모 중 한 명이 환자","12.0"],["일란성 쌍생아","47.0"]]},
    {"type":"text","content":"이 표에서 알 수 있는 내용으로 가장 적절한 것은?"}]'::jsonb,
  '[{"no":1,"text":"조현병은 환경 요인만으로 설명된다","image_url":null},
    {"no":2,"text":"유전적 근접성이 높을수록 유병률이 증가한다","image_url":null},
    {"no":3,"text":"일란성 쌍생아에서 일치율이 100%이다","image_url":null},
    {"no":4,"text":"형제간 유병률은 일반인구와 같다","image_url":null}]'::jsonb,
  1, '{2}', '{2}', 'confirmed', 'complete', 'published'
) on conflict (id) do nothing;

-- 3) 복수정답 (체크박스 UI 확인용)
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, completeness, status
) values (
  'e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002', 3, 'A',
  '[{"type":"text","content":"주요우울장애 환자에서 자살 위험을 높이는 인자를 모두 고르시오."}]'::jsonb,
  '[{"no":1,"text":"과거 자살 시도력","image_url":null},
    {"no":2,"text":"안정적인 직업과 가족 지지","image_url":null},
    {"no":3,"text":"동반된 알코올 사용장애","image_url":null},
    {"no":4,"text":"규칙적인 외래 추적관찰","image_url":null},
    {"no":5,"text":"최근의 상실 경험","image_url":null}]'::jsonb,
  3, '{1,3,5}', '{1,3,5}', 'confirmed', 'complete', 'published'
) on conflict (id) do nothing;

-- 4) 보기가 일부만 복기된 문제 + 정답 미확정 (투표 UI 확인용)
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, restorer_note,
  completeness, status
) values (
  'e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000003', 4, 'A',
  '[{"type":"text","content":"32세 여자가 반복되는 심계항진과 죽을 것 같은 공포로 응급실을 여러 차례 방문하였다. 검사에서 이상이 없었다. 가장 적절한 초기 치료는?"}]'::jsonb,
  '[{"no":1,"text":"benzodiazepine 단기 투여 및 SSRI 시작","image_url":null},
    {"no":2,"text":"항정신병약물 투여","image_url":null},
    {"no":3,"text":"경과관찰","image_url":null}]'::jsonb,
  1, '{}', '{1}', 'unconfirmed', '보기 3개까지만 기억남',
  'partial_choices', 'published'
) on conflict (id) do nothing;

-- 5) 수식 블록 포함
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, completeness, status
) values (
  'e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000004', 1, 'A',
  '[{"type":"text","content":"68세 남자가 최근 수일 사이에 숨참이 심해져 응급실로 왔다. 동맥혈가스분석 결과는 다음과 같다."},
    {"type":"formula","latex":"pH = 7.28,\\quad PaCO_2 = 32\\ mmHg,\\quad HCO_3^- = 15\\ mEq/L"},
    {"type":"text","content":"산염기 상태로 가장 적절한 것은?"}]'::jsonb,
  '[{"no":1,"text":"보상된 호흡성 알칼리증","image_url":null},
    {"no":2,"text":"대사성 산증에 대한 호흡성 보상","image_url":null},
    {"no":3,"text":"호흡성 산증","image_url":null},
    {"no":4,"text":"혼합성 알칼리증","image_url":null}]'::jsonb,
  1, '{2}', '{2}', 'confirmed', 'complete', 'published'
) on conflict (id) do nothing;

-- 6) 서술형
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, answer_status, model_answer, grading_points,
  completeness, status
) values (
  'e0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000005', 2, 'essay',
  '[{"type":"text","content":"궤양성 대장염 환자에서 응급 전결장절제술의 적응증을 3가지 쓰시오."}]'::jsonb,
  '[]'::jsonb,
  1, '{}', 'confirmed',
  E'1. 독성거대결장(toxic megacolon)\n2. 천공\n3. 대량 출혈로 내과적 치료에 반응하지 않는 경우',
  '["독성거대결장 언급","천공 언급","조절되지 않는 대량 출혈 언급","전격성 대장염을 답한 경우도 인정"]'::jsonb,
  'complete', 'published'
) on conflict (id) do nothing;

-- 7) R형 세트 문항 2개
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, set_id, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, completeness, status
) values
  ('e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 5, 'R', 'd0000000-0000-4000-8000-000000000001',
   '[{"type":"text","content":"치료저항성 조현병에서 다른 약물에 반응하지 않을 때 우선 고려하는 약물은?"}]'::jsonb,
   '[{"no":1,"text":"A","image_url":null},{"no":2,"text":"B","image_url":null},
     {"no":3,"text":"C","image_url":null},{"no":4,"text":"D","image_url":null},
     {"no":5,"text":"E","image_url":null},{"no":6,"text":"F","image_url":null}]'::jsonb,
   1, '{2}', '{2}', 'confirmed', 'complete', 'published'),
  ('e0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', 6, 'R', 'd0000000-0000-4000-8000-000000000001',
   '[{"type":"text","content":"제1형 양극성장애의 급성 조증 삽화에서 기분안정제로 우선 사용하는 약물은?"}]'::jsonb,
   '[{"no":1,"text":"A","image_url":null},{"no":2,"text":"B","image_url":null},
     {"no":3,"text":"C","image_url":null},{"no":4,"text":"D","image_url":null},
     {"no":5,"text":"E","image_url":null},{"no":6,"text":"F","image_url":null}]'::jsonb,
   1, '{3}', '{3}', 'confirmed', 'complete', 'published')
on conflict (id) do nothing;

-- 8) 19학번 시험의 동일 문제 (중복 그룹 확인용)
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, yama_answer, answer_status, source_tags, variant_type,
  completeness, status
) values (
  'e0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000001', 7, 'A',
  '[{"type":"text","content":"24세 남자가 6개월 전부터 누군가 자신을 감시한다는 생각에 사로잡혀 방에서 나오지 않는다고 가족에 의해 응급실로 왔다. 혼잣말이 늘었고 최근 2주간 거의 잠을 자지 않았다."},
    {"type":"text","content":"가장 적절한 진단은?"}]'::jsonb,
  '[{"no":1,"text":"조현양상장애(schizophreniform disorder)","image_url":null},
    {"no":2,"text":"단기정신병적장애(brief psychotic disorder)","image_url":null},
    {"no":3,"text":"조현병(schizophrenia)","image_url":null},
    {"no":4,"text":"망상장애(delusional disorder)","image_url":null}]'::jsonb,
  1, '{3}', '{3}', 'confirmed', '{22Y}', 'identical', 'complete', 'published'
) on conflict (id) do nothing;

-- 9) 단원 미분류 문제 (라벨링 대기 큐 확인용)
insert into public.questions (
  id, exam_id, unit_id, question_number, question_type, stem_blocks, choices,
  answer_count, editor_answer, answer_status, completeness, status
) values (
  'e0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000003',
  null, 8, 'A',
  '[{"type":"text","content":"불안장애 환자에서 인지행동치료의 핵심 요소로 가장 적절한 것은?"}]'::jsonb,
  '[{"no":1,"text":"노출 및 반응방지","image_url":null},
    {"no":2,"text":"자유연상","image_url":null},
    {"no":3,"text":"최면","image_url":null},
    {"no":4,"text":"전기경련치료","image_url":null}]'::jsonb,
  1, '{1}', 'confirmed', 'complete', 'published'
) on conflict (id) do nothing;

-- 중복 그룹 연결 ------------------------------------------------------------
insert into public.question_groups (id, canonical_question_id, note) values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   '20학번 1번과 19학번 7번이 동일 문항')
on conflict (id) do nothing;

update public.questions
   set group_id = 'f0000000-0000-4000-8000-000000000001'
 where id in ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000009');
