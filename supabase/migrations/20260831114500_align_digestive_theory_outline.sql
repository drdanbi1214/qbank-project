-- 내과 > 소화기 알렌을 위장관/간담췌 두 단계로 나누고 지정된 01~21 목차로 고정한다.
-- 기존 본문 문서 ID와 content는 유지해 풀이 링크·검색·개인 표시가 끊기지 않게 한다.

begin;

do $$
declare
  v_subject_id uuid;
  v_section_id uuid;
  v_gi_id uuid;
  v_hpb_id uuid;
  v_wrapper_id uuid;
  v_singleton record;
  v_empty_content jsonb := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
begin
  select id into v_subject_id
    from public.subjects
   where code = '01';

  select id into v_section_id
    from public.theory_documents
   where subject_id = v_subject_id
     and parent_id is null
     and source_key = 'section:소화기';

  if v_subject_id is null or v_section_id is null then
    raise exception '내과 > 소화기 알렌 목차를 찾지 못했습니다.';
  end if;

  -- 이미 존재하는 두 중간 묶음의 ID를 유지한다. 이전 가져오기에서 만들어졌지만
  -- 01~21 목차가 그 아래로 이동되지 않아 빈 카드로 남아 있던 항목들이다.
  insert into public.theory_documents (
    subject_id, parent_id, title, content, sort_order,
    required_permission, has_content, is_published, source_key
  ) values (
    v_subject_id, v_section_id, '위장관', v_empty_content, 100,
    null, false, true, 'section:소화기/group:위장관'
  )
  on conflict (subject_id, source_key) do update
    set parent_id = excluded.parent_id,
        title = excluded.title,
        sort_order = excluded.sort_order,
        required_permission = null,
        has_content = false,
        is_published = true
  returning id into v_gi_id;

  insert into public.theory_documents (
    subject_id, parent_id, title, content, sort_order,
    required_permission, has_content, is_published, source_key
  ) values (
    v_subject_id, v_section_id, '간담췌', v_empty_content, 200,
    null, false, true, 'section:소화기/group:간담췌'
  )
  on conflict (subject_id, source_key) do update
    set parent_id = excluded.parent_id,
        title = excluded.title,
        sort_order = excluded.sort_order,
        required_permission = null,
        has_content = false,
        is_published = true
  returning id into v_hpb_id;

  -- 이미 묶음으로 되어 있는 대단원은 ID를 그대로 두고 두 자리 번호·지정 표기로
  -- 정리한 뒤 위장관 또는 간담췌 아래로 옮긴다.
  with desired(id, parent_id, title, sort_order) as (
    values
      ('76812629-8a42-4bf3-94b8-88c112f3200a'::uuid, v_gi_id,  '01 위장관-총론',                         100),
      ('a0273460-8fbe-4dfd-9731-c0e11d00ae34'::uuid, v_gi_id,  '03 위장관-식도질환',                     300),
      ('69065a4a-2bd7-4430-808d-b0ccc7b5c556'::uuid, v_gi_id,  '04 위장관-소화성 궤양',                  400),
      ('9bf97575-1aaf-4445-9903-249f772860c2'::uuid, v_gi_id,  '07 위장관-염증성 장질환',                700),
      ('71dc7338-53f0-446f-81a3-2a20e9b613bf'::uuid, v_hpb_id, '13 간담췌-총론',                        1300),
      ('0a2cafbc-247c-4e16-b12f-7cb32ce8e4ae'::uuid, v_hpb_id, '14 간담췌-급성 간염',                   1400),
      ('5f225255-dd22-4727-b862-38814db49f98'::uuid, v_hpb_id, '15 간담췌-만성 간염',                   1500),
      ('aada74b3-32f0-4f52-aca1-a6392ec3b224'::uuid, v_hpb_id, '16 간담췌-알코올성/비알코올성 간질환', 1600),
      ('b30a26df-6aa1-4ec5-b62e-d8a30a503d11'::uuid, v_hpb_id, '17 간담췌-간경변 및 합병증',            1700),
      ('b6c15af1-a89c-4b86-b4ae-003017841ae3'::uuid, v_hpb_id, '19 간담췌-간농양 및 기타 간질환',       1900),
      ('01125164-2e8c-42b5-b50a-6491a1d464f0'::uuid, v_hpb_id, '20 간담췌-담도질환',                    2000),
      ('b173c878-1f1d-4529-a586-7a92e08cc163'::uuid, v_hpb_id, '21 간담췌-이자질환',                    2100)
  )
  update public.theory_documents document
     set parent_id = desired.parent_id,
         title = desired.title,
         sort_order = desired.sort_order,
         has_content = false,
         is_published = true
    from desired
   where document.id = desired.id
     and document.subject_id = v_subject_id;

  -- 본문이 대단원 자체에 들어 있던 항목은 빈 묶음을 새로 만들고 기존 본문을
  -- 그 아래로 옮긴다. 본문 ID는 바뀌지 않으므로 기존 참조는 그대로 유효하다.
  for v_singleton in
    select *
      from (values
        (2,  '02 위장관-위장관 출혈',       '위장관 출혈',         '897f817a-09fa-4720-a85e-0d1966f0eef7'::uuid, 'gi'),
        (5,  '05 위장관-위암',              '위암',                'deb49952-933f-4df5-9471-b026fe6ab719'::uuid, 'gi'),
        (6,  '06 위장관-흡수장애',          '흡수장애',            '3a0d5be7-84c9-4de7-99de-20a6dae3db6f'::uuid, 'gi'),
        (8,  '08 위장관-과민대장증후군',    '과민성 대장 증후군',  '17eb2d83-6bb1-4536-98cc-87b005e17a58'::uuid, 'gi'),
        (9,  '09 위장관-곁주머니 질환',     '게실 질환',           'acf58c91-cd35-461d-8a24-65a1e79e3169'::uuid, 'gi'),
        (10, '10 위장관-혈관성 장질환',     '혈관성 장질환',       '91e381f2-0ac8-44d4-8ab4-6269299fff75'::uuid, 'gi'),
        (11, '11 위장관-급성 장폐색',       '급성 장폐색',         '0a41305d-cceb-4464-8ee7-50320895c6cb'::uuid, 'gi'),
        (12, '12 위장관-하부위장관 종양',   '대장암',              'e34e4861-f8ba-4806-8317-6a1872c096c0'::uuid, 'gi'),
        (18, '18 간담췌-간 종양',           '간세포암',            '859f627b-9184-40c6-ae1a-ff79e8037f9c'::uuid, 'hpb')
      ) as singleton(position, group_title, item_title, document_id, area)
  loop
    if not exists (
      select 1 from public.theory_documents
       where id = v_singleton.document_id
         and subject_id = v_subject_id
    ) then
      raise exception '소화기 본문 문서를 찾지 못했습니다: %', v_singleton.item_title;
    end if;

    insert into public.theory_documents (
      subject_id, parent_id, title, content, sort_order,
      required_permission, has_content, is_published, source_key
    ) values (
      v_subject_id,
      case when v_singleton.area = 'gi' then v_gi_id else v_hpb_id end,
      v_singleton.group_title,
      v_empty_content,
      v_singleton.position * 100,
      null,
      false,
      true,
      format('section:소화기/outline:%s', lpad(v_singleton.position::text, 2, '0'))
    )
    on conflict (subject_id, source_key) do update
      set parent_id = excluded.parent_id,
          title = excluded.title,
          sort_order = excluded.sort_order,
          required_permission = null,
          has_content = false,
          is_published = true
    returning id into v_wrapper_id;

    update public.theory_documents
       set parent_id = v_wrapper_id,
           title = v_singleton.item_title,
           sort_order = 1,
           has_content = true,
           is_published = true
     where id = v_singleton.document_id;
  end loop;

  -- 기존 소단원 ID 위에서 요청 표기와 형제 순서를 정확히 맞춘다.
  with desired(id, title, sort_order) as (
    values
      ('75f03ae7-3d13-46f3-9ba5-9cca0d53bb3c'::uuid, '복통',                          1),
      ('843ab9e8-1999-4b35-97a8-e2954892865f'::uuid, '설사',                          2),
      ('017a8c35-0dbb-4d80-8cae-54aefdd3c58a'::uuid, '변비',                          3),
      ('544a25bd-8d0c-40cd-8ea1-0d41b31696c3'::uuid, '소화불량',                      4),
      ('2688c49f-8f71-4336-8758-92abb6d546da'::uuid, '삼킴곤란',                      5),
      ('71c68aa2-3066-42fb-8dfe-44b15e419ad3'::uuid, '소화기 내시경',                 6),
      ('b946b982-b233-44d7-9085-04460cd0c525'::uuid, '위식도역류질환',                 1),
      ('502eaa49-1945-4ada-816e-60783ddc7658'::uuid, '말로리-바이스 증후군',           2),
      ('931e8ab8-ff03-499a-8daa-856127f219e4'::uuid, '식도이완불능증',                 3),
      ('64abd26d-b2d1-4064-8cb4-315ef005389a'::uuid, '식도암',                         4),
      ('f38e2a0e-bb7c-4323-93b6-9b33d6ed2136'::uuid, '기타 식도질환',                 5),
      ('57b90b44-88c0-4078-90ba-f6d29ee55b34'::uuid, '심화 1. 식도암의 병기와 치료', 6),
      ('08b29c78-5e69-4267-9b29-ffee40d8ac13'::uuid, '소화성 궤양',                    1),
      ('fad54074-1d75-4a2a-996c-26d83f5ec4cc'::uuid, '소화성 궤양 합병증',             2),
      ('a1cd00e7-e867-4c83-a3fa-dd75ad8200e0'::uuid, '염증성 장질환',                  1),
      ('b8b4c9e2-6693-47b8-8b1e-d1df67da60d9'::uuid, '기타 염증성 장질환',             2),
      ('9e4b5d30-1e53-47a7-b4e5-6cb72bb455de'::uuid, '간질환 환자에 대한 접근',        1),
      ('65e8a92d-c72a-4993-81ad-c69d56bb7791'::uuid, '황달과 고빌리루빈혈증',          2),
      ('45fa67e8-5ef1-4c1e-9d94-d283a65fd6c2'::uuid, '복수',                           3),
      ('f876f5c3-5c48-4dbc-bc34-3d93fc64e18d'::uuid, '급성 바이러스 간염',             1),
      ('c99a5a18-5038-4944-9730-5d75dcd6f05c'::uuid, '독성 및 약인성 간염',            2),
      ('8c7af493-7d36-4d52-bed1-92f50db824de'::uuid, '급성 간부전',                    3),
      ('3fae43ce-b195-4957-aff9-1010850115a5'::uuid, '만성 B형 간염',                  1),
      ('c93aaa29-2271-48ee-a485-f70c3646500f'::uuid, '만성 C형 간염',                  2),
      ('25f0e583-8ebb-4926-8aee-8a800e35ca06'::uuid, '자가면역성 간염',                 3),
      ('ec1e4ac2-c610-4aa4-9973-28fc559412c6'::uuid, '알코올성 간질환',                 1),
      ('e8aaed41-0d75-41e5-a1df-cb27e522b4aa'::uuid, '대사이상지방간질환',              2),
      ('7baf8915-5d64-4f76-a176-a54d8558c5ca'::uuid, '간경변',                         1),
      ('fc12f7a7-1b6f-4071-9e7e-9540ff7a6a64'::uuid, '문맥고혈압 및 관련 합병증',       2),
      ('c2dfc0fe-4c12-443e-8d7f-ad6f20d66399'::uuid, '정맥류 출혈',                    3),
      ('c13e6689-18b0-416b-aec7-5c8fc2e773b0'::uuid, '간경변성 복수',                  4),
      ('097a3cdf-f04e-4d3e-a507-78609e5bdc4d'::uuid, '자발성 세균성 복막염',           5),
      ('60beb3a3-3ec9-48ad-a64b-23f545d5fe53'::uuid, '간성 뇌증',                      6),
      ('bd309c8d-52cb-40f0-8dbf-f05b83bedc80'::uuid, '담즙성 간경변',                  7),
      ('7c61c975-0ace-42e1-9bb6-4f26f95a9e56'::uuid, '간농양',                         1),
      ('ff7a4fc8-1d11-45fb-90cd-626772798176'::uuid, '윌슨병',                         2),
      ('4c7c64d2-9e09-43cd-ae15-9401794cd8f0'::uuid, '담석증',                         1),
      ('e2f6f7b5-2457-4a57-961f-6e0647d99aa1'::uuid, '담낭염',                         2),
      ('9fa3386a-6311-4da1-bcd4-14c9b92d3f19'::uuid, '총담관담석증과 담관염',            3),
      ('c36a2e1f-297d-47a6-89dc-9c48c82b3173'::uuid, '담낭암',                         4),
      ('1823c22a-fe61-4071-b401-0ee343a8561d'::uuid, '담관암',                         5),
      ('964234c6-754c-4bfe-a4b8-9ebeed49b95d'::uuid, '급성 췌장염',                    1),
      ('54101c85-8803-4e7a-a0eb-d0fbf54961ed'::uuid, '급성 췌장염의 합병증',           2),
      ('3159b5c2-81e1-401e-ba1f-bc2955b5c8db'::uuid, '만성 췌장염',                    3),
      ('ba70f92f-8b3c-4092-92af-9e0c22a078e3'::uuid, '췌장암',                         4)
  )
  update public.theory_documents document
     set title = desired.title,
         sort_order = desired.sort_order,
         has_content = true,
         is_published = true
    from desired
   where document.id = desired.id
     and document.subject_id = v_subject_id;

  -- 소화기 바로 아래에는 중간 분류 두 개만 남아야 한다. 예상하지 못한 문서가
  -- 있으면 조용히 숨기지 말고 전체 트랜잭션을 취소한다.
  if exists (
    select 1
      from public.theory_documents
     where parent_id = v_section_id
       and id not in (v_gi_id, v_hpb_id)
  ) then
    raise exception '소화기 바로 아래에 이동되지 않은 목차가 남아 있습니다.';
  end if;
end
$$;

commit;
