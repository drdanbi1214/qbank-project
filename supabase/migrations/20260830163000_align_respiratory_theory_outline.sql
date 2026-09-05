-- 내과 > 호흡기 알렌 목차를 지정된 18개 단원 표기에 맞춘다.
-- 기존 본문 문서의 ID와 content를 유지해 게시물·풀이의 알렌 연결이 끊기지 않게 한다.

begin;

do $$
declare
  v_subject_id uuid;
  v_section_id uuid;
  v_wrapper_id uuid;
  v_singleton record;
  v_ventilation_group_id uuid := 'c590d414-f54b-4a93-a1c3-f11346d7fa78';
  v_empty_content jsonb := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
begin
  select id into v_subject_id
    from public.subjects
   where code = '01';

  select id into v_section_id
    from public.theory_documents
   where subject_id = v_subject_id
     and parent_id is null
     and source_key = 'section:호흡기';

  if v_subject_id is null or v_section_id is null then
    raise exception '내과 > 호흡기 알렌 목차를 찾지 못했습니다.';
  end if;

  -- 기존 대단원은 ID를 그대로 두고 두 자리 번호·요청 표기로만 정리한다.
  with desired(id, title, sort_order) as (
    values
      ('8942bfbf-54e1-4f87-8202-eea88dd321b7'::uuid, '01 호흡기 총론',          100),
      ('ea37ad65-6033-4301-8b12-7ed973c83416'::uuid, '02 폐기능 장애',          200),
      ('0900aa0f-0db8-461b-9be0-de6db81ca1cd'::uuid, '03 폐질환 검사법',        300),
      ('2458ad55-0d1d-4292-81e2-6f1682744b5d'::uuid, '04 폐렴',                 400),
      ('5f7b31e4-5ddc-4847-abb9-a7f3a8398490'::uuid, '06 폐결핵',               600),
      ('9823d56b-d8bf-4992-b2f9-56e545cbeb5f'::uuid, '07 천식',                 700),
      ('06b6cbe4-f418-4fa7-8f39-757cd2b9148c'::uuid, '08 만성폐쇄성폐질환',     800),
      ('12ee717f-d592-4ed9-940f-74c472443964'::uuid, '10 간질성 폐질환',        1000),
      ('271a03c9-e231-4412-8450-7c57d7ccef21'::uuid, '11 호산구성 폐질환',      1100),
      ('81a535fc-2aa1-4891-9ce6-cff848ae8856'::uuid, '13 폐암',                1300),
      ('34655bd9-f2e5-4108-aec2-0f423d2cf251'::uuid, '15 흉막과 종격동 질환',  1500),
      ('c590d414-f54b-4a93-a1c3-f11346d7fa78'::uuid, '16 환기 장애',           1600),
      ('240cc89b-0629-4f54-8e75-ceabedb307fa'::uuid, '17 급성호흡곤란증후군',  1700),
      ('68ebbe9f-ba4b-44b3-94c5-15104bd17be3'::uuid, '18 기타 폐질환',          1800)
  )
  update public.theory_documents document
     set parent_id = v_section_id,
         title = desired.title,
         sort_order = desired.sort_order,
         has_content = false
    from desired
   where document.id = desired.id
     and document.subject_id = v_subject_id;

  -- 본문이 대단원 자체였던 네 문서는 새 목차 묶음 아래로 옮긴다.
  -- 본문 문서 ID는 유지되므로 기존 알렌 카드와 풀이 참고 링크도 그대로 유효하다.
  for v_singleton in
    select *
      from (values
        (5,  '05 폐농양',       '폐농양',       '7b989f41-8700-4eae-a798-9e48dd8b4165'::uuid),
        (9,  '09 기관지확장증', '기관지확장증', '8e98eb9b-8db5-4b8f-9468-78526d3e4e21'::uuid),
        (12, '12 직업성 폐질환','직업성 폐질환','874b9932-9dc5-4456-ad06-92a113468e1a'::uuid),
        (14, '14 폐색전증',     '폐색전증',     '180caffb-0dbf-467d-baae-282f99a5b500'::uuid)
      ) as singleton(position, group_title, item_title, document_id)
  loop
    if not exists (
      select 1 from public.theory_documents
       where id = v_singleton.document_id
         and subject_id = v_subject_id
    ) then
      raise exception '호흡기 본문 문서를 찾지 못했습니다: %', v_singleton.item_title;
    end if;

    insert into public.theory_documents (
      subject_id,
      parent_id,
      title,
      content,
      sort_order,
      required_permission,
      has_content,
      is_published,
      source_key
    ) values (
      v_subject_id,
      v_section_id,
      v_singleton.group_title,
      v_empty_content,
      v_singleton.position * 100,
      null,
      false,
      true,
      format('section:호흡기/outline:%s', lpad(v_singleton.position::text, 2, '0'))
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
           has_content = true
     where id = v_singleton.document_id;
  end loop;

  -- 요청 표기와 다른 소단원 이름 및 순서를 기존 ID 위에서 수정한다.
  with desired(id, title, sort_order) as (
    values
      ('98dc03f8-a0f6-46bc-a382-c002d1ad9255'::uuid, '호흡기계 개요 및 흉부 진찰',          1),
      ('d042444c-dfa1-4d20-b243-a99a0be666c0'::uuid, '객혈',                                2),
      ('f046c038-19a3-4977-bc65-5adf35df7cba'::uuid, '기침 총론',                           3),
      ('a5807366-c790-46b7-8b35-3bb451a2410b'::uuid, '만성기침 각론',                       4),
      ('d1a8deda-ab9e-483f-8a5d-f7fdebbf98a5'::uuid, '폐기능검사',                          1),
      ('a26bdb9f-7eeb-43a1-910f-f0f5b3e22dad'::uuid, '유량-용량 곡선',                     2),
      ('2ff9f99d-a1bf-4ee6-a082-8c4e95e0c200'::uuid, '저산소혈증',                          3),
      ('88085a4e-a161-4059-9306-7323673ef51d'::uuid, '흉부 X선 검사 및 무기폐',            1),
      ('ea73f101-7164-4235-90af-c528f7ac4d1d'::uuid, '기관지내시경',                        2),
      ('df17a994-ab80-45e9-a3d4-376931a3c6bd'::uuid, '폐렴',                                1),
      ('a0b66e23-cff0-4df1-8c67-16dfc7cc3691'::uuid, '특수한 원인균에 의한 폐렴',          2),
      ('cbcd1184-e505-44ab-a215-6e4c99e3bfff'::uuid, '폐결핵',                              1),
      ('dd41853d-9f97-4a2e-81a0-d74eaf7df0d5'::uuid, '폐외 결핵',                          2),
      ('86e7daa6-8405-4e48-9178-1d6f4f7131cc'::uuid, '잠복결핵',                            3),
      ('7f7a27f1-9ba2-492b-89a5-5696182f139f'::uuid, '천식',                                1),
      ('142626cd-27bf-4330-8817-4c0941d308f4'::uuid, '천식의 기타 아형',                   2),
      ('2a53d056-87fc-43df-bc86-6f90794984df'::uuid, '만성폐쇄성폐질환',                    1),
      ('10c56388-2500-4739-b31c-9617a3531d3b'::uuid, 'COPD의 급성악화',                    2),
      ('c5d0058b-9f61-4d9d-b69c-8df7791bda90'::uuid, '간질성 폐질환',                       1),
      ('627ada81-f6de-4648-a5d0-3a16e8d53c6d'::uuid, '과민폐렴',                            2),
      ('8d336c25-0945-4276-a6a9-6717b1fe20ae'::uuid, '유육종증',                            3),
      ('9acc94e5-dacf-4992-9a22-0c6e92e8882e'::uuid, '기타 간질성 폐질환',                  4),
      ('5ec4674b-26ba-414b-ad4a-20dc2a1b15e6'::uuid, '일차성 호산구성 폐질환',              1),
      ('5905ef72-301f-4e0e-b5fb-d5eae9eda770'::uuid, '알레르기 기관지폐 아스페르길루스증', 2),
      ('74b277a8-bbc3-4efd-a3e4-bdbeb7f3d64c'::uuid, '폐흡충증',                            3),
      ('6a5eeff8-e758-4eb9-9e6d-d90e867f62f5'::uuid, '폐암',                                1),
      ('b103f95e-0912-4eba-a0ca-b802d28d22bf'::uuid, '심화 1. 폐암의 병기와 치료',          2),
      ('4009cbfb-4b54-4017-a3e0-53d664a13df0'::uuid, '심화 2. 기타 종양성 폐질환',          3),
      ('74060275-6498-4d36-b7ae-5b1b154f0360'::uuid, '흉막 삼출',                            1),
      ('04d1383a-a636-4e41-accb-205daceef61b'::uuid, '기흉',                                2),
      ('e1891ba5-f742-46a2-915e-e8846bf284e5'::uuid, '종격동 질환',                         3),
      ('d4011b16-e8be-4c5d-a013-31ba322350f8'::uuid, '환기저하',                             2),
      ('d0f80648-72ec-4067-94f0-1369beb1acd4'::uuid, '급성 호흡곤란 증후군',                1),
      ('2ee5c5d6-448b-4452-88b7-905ec3073eb2'::uuid, '호흡 보조 요법',                      2),
      ('097916a9-8870-43c5-9a3a-1abd3c6922d5'::uuid, '심화 1. 기계환기',                    3),
      ('fbf9a31b-9604-4cd0-b278-b4d6e772e7d3'::uuid, '세기관지염',                           1),
      ('236cb1cb-d41f-4305-8dbf-b5eb2c99df4f'::uuid, '기타 혈관성 폐질환',                  2),
      ('82bc6b54-bac1-40d0-b9c7-27d904a91473'::uuid, '대기도 질환',                         3)
  )
  update public.theory_documents document
     set title = desired.title,
         sort_order = desired.sort_order,
         has_content = true
    from desired
   where document.id = desired.id
     and document.subject_id = v_subject_id;

  -- 원본 가져오기에서 종격동 질환이 두 번 등록된 항목이다. 두 문서는 현재 참조와
  -- 개인 표시가 없음을 확인했으며, 더 깨끗한 원본(e189...) 하나만 유지한다.
  delete from public.theory_documents
   where id = 'a0498250-324b-4469-92b5-e63599ece969'
     and subject_id = v_subject_id;

  -- 과호흡 증후군은 현재 원본 문서가 없어 빈 본문으로 새로 만든다.
  insert into public.theory_documents (
    subject_id,
    parent_id,
    title,
    content,
    sort_order,
    required_permission,
    has_content,
    is_published,
    source_key
  ) values (
    v_subject_id,
    v_ventilation_group_id,
    '과호흡 증후군',
    v_empty_content,
    1,
    null,
    true,
    true,
    'section:호흡기/outline:16/item:01'
  )
  on conflict (subject_id, source_key) do update
    set parent_id = excluded.parent_id,
        title = excluded.title,
        sort_order = excluded.sort_order,
        required_permission = null,
        has_content = true,
        is_published = true;
end
$$;

commit;
