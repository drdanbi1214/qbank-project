-- Restore bordered case text that the DOCX importer detached from the 2021
-- psychiatry final exam, and remove that text from the choices where it landed.
do $$
declare
  target_exam_id uuid;
  target_count integer;
begin
  select e.id
    into target_exam_id
  from public.exams e
  join public.subjects s on s.id = e.subject_id
  where s.name = '정신건강의학과'
    and e.cohort = '21학번'
    and e.exam_name = '학년말고사';

  if target_exam_id is null then
    raise exception '2021 psychiatry final exam was not found';
  end if;

  select count(*) into target_count
  from public.questions
  where exam_id = target_exam_id;

  if target_count <> 56 then
    raise exception 'Expected 56 questions, found %', target_count;
  end if;

  update public.questions q
  set stem_blocks = v.blocks
  from (values
    (2, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '남성이 난동을 피우다가 경찰에게 양손 강박 된 채 응급실에 내원하였다. 환자가 다음과 같은 상태였을 때, 올바른 처치는?'),
      jsonb_build_object('type', 'text', 'content', '환자는 두 손이 강박된 채로, 불안하고 예민한 듯한 상태로 면담실 안을 배회하고 있다.')
    )),
    (9, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '(21Y) 다음과 같은 증상이 있을 때 적절한 치료 방법은?'),
      jsonb_build_object('type', 'text', 'content', '- 낯선 사람을 만날 때 예외없이 얼굴이 붉어지고 불편한 증상이 나타난다\n- 가족이랑 있을 때는 괜찮다.\n- 너무 힘들어서 학교도 그만두었다.')
    )),
    (13, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '(21Y) 복용 시 다음 증상을 일으킬 수 있는 약물은?'),
      jsonb_build_object('type', 'text', 'content', '복용한 뒤 갑자기 공포감이 느껴지고 숨이 안 쉬어지고 죽을 것 같은 느낌이 들었다. 이 같은 증상은 10 분 후에 자연스럽게 괜찮아졌다.')
    )),
    (14, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '다음 중 해당 환자의 상태에 대한 위험인자로 올바른 것은?'),
      jsonb_build_object('type', 'text', 'content', '40 세 여자 수면제 여러 알 먹고 응급실 옴, 직장 내 성추행으로 법정 공방중인 상태이며, 엄마가 정신신체장애로 4 년간 병원을 다니며 치료 중이다.')
    )),
    (16, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '말기암 환자 다음과 같은 사고는 어느 단계에 해당하는가?'),
      jsonb_build_object('type', 'text', 'content', '내 병이 어떤 상태이든, 아들 결혼식 때 까지는 내가 살아 있어야겠다.')
    )),
    (18, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '(19Y) 우울증 발생에 관여하는 생리학적 물질 중 다음과 같은 조건들과 관련된 호르몬은?'),
      jsonb_build_object('type', 'text', 'content', 'HPA-axis 기능 항진, DST (Dexamethasone Suppression test)에서 Dexamethasone 에 의한 억제 소실발생, 뇌하수체 및 부신피질 비대')
    )),
    (20, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '환자에게 이름이 뭐에요? 라고 질문하였을 때 환자의 대답이다. 이에 해당하는 정신 병리는?'),
      jsonb_build_object('type', 'text', 'content', '환자 A: 사람들이 제이름을 물어봐서 대답하면 제이름이 정말 특이하다고 하더군요. 하지만 저는 제이름이 이상하다고 생각하지 않아요. 아버지가 지어주신 이름이거든요. 어머니도 아버지와 함께 고민해주셨을 겁니다. 전 그래서 제 이름이 마음에 들어요. 제이름은 ㅇㅇㅇ 입니다.')
    )),
    (25, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '다음과 관련된 사고내용의 유형은?'),
      jsonb_build_object('type', 'text', 'content', '25 세 남자가 TV 방송에서 아나운서가 하는 말이 자신과 연관되어 있다고 하며 자신을 은연중에 암시하고 있다고 한다.')
    )),
    (39, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', 'MMPI-2 검사에 대한 설명이다. 해당 환자에서 가장 높게 나올 것으로 보이는 척도로 알맞은 것은?'),
      jsonb_build_object('type', 'text', 'content', '25 세 여성, 직장생활에 어려움을 겪는 것을 주소로 내원하여 심리검사 시행하였다. 직장에 있는 모든 여자 사원들이 나를 시기, 질투하고 남자 사원들이 나만 쫓아다니는 것 같다. 검사 중 임상적으로 불안감이나 우울감은 관찰되지 않았으며, 검사 중간 중간 쉬는 시간을 요청하고 지쳐 하는 모습 보였다. 검사가 종료된 후 검사자의 손을 붙잡고 꼭 해결해달라고 눈물 글썽이는 모습 관찰되었다.')
    )),
    (48, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '이 환자의 진단은?'),
      jsonb_build_object('type', 'text', 'content', '30 개월 환아. 언어 발달 느림으로 내원. 눈 잘 마주치려고 하지 않고, 필요할 때 아니면 부모를 딱히 찾지 않는 모습을 보임. 까치발하고 손 펄럭거리기 등의 행동을 보이고, 기차를 계속 일렬로 정렬하려고 함')
    )),
    (49, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '다음 증례의 치료로 올바른 것은?'),
      jsonb_build_object('type', 'text', 'content', '7 세 남아. 학교 수업 시간에 창 밖을 보거나 집중 못하고 낙서를 함. 친구들을 좋아하지만 짓궃은 장난을 많이 쳐 잘 어울리지 못함.')
    )),
    (51, jsonb_build_array(
      jsonb_build_object('type', 'text', 'content', '(21Y) 이 환자의 진단은?'),
      jsonb_build_object('type', 'text', 'content', '6 세 남아. 2 년 전에 눈 깜빡거리는 증상과 입술을 씰룩거리는 증상을 호소했다. 1 년 전에는 헛기침을 하면서 소리를 냈다. 이비인후과와 안과를 방문했는데 모두 이상이 없다고 했다. 일시적으로 증상을 억제할 수는 있었고 wax and wane 의 형태로 나타났다.')
    ))
  ) as v(question_number, blocks)
  where q.exam_id = target_exam_id
    and q.question_number = v.question_number;

  update public.questions
  set choices = jsonb_set(choices, '{4,text}', to_jsonb('물건을 훔치기 위해 사전조사와 계획을 세웠다.'::text))
  where exam_id = target_exam_id and question_number = 7;

  update public.questions
  set choices = jsonb_set(choices, '{2,text}', to_jsonb('반사회적 성격장애'::text))
  where exam_id = target_exam_id and question_number = 15;

  update public.questions
  set choices = jsonb_set(choices, '{1,text}', to_jsonb('우울 - 갑상샘 기능 항진'::text))
  where exam_id = target_exam_id and question_number = 23;

  update public.questions
  set choices = jsonb_set(choices, '{0,text}', to_jsonb('유분증'::text))
  where exam_id = target_exam_id and question_number = 47;

  update public.questions
  set choices = jsonb_set(choices, '{0,text}', to_jsonb('청소년의 경우, 환자와의 신뢰관계 형성 위해 청소년 먼저, 부모 나중에 면담한다.'::text))
  where exam_id = target_exam_id and question_number = 54;

  if (select count(*) from public.questions where exam_id = target_exam_id and jsonb_array_length(stem_blocks) > 1) < 13 then
    raise exception 'Case block restoration did not update all expected questions';
  end if;
end
$$;
