-- 내과 > 신장 알렌의 기존 합본 11개를 빈 목차로 교체한다.
-- 기존 문서 ID는 같은 번호의 새 대단원에 재사용해 풀이·초안에 넣은 알렌
-- 태그가 끊기지 않게 하고, 합본 본문만 비운 뒤 요청된 소단원을 새로 만든다.

begin;

do $$
declare
  v_subject_id uuid;
  v_section_id uuid;
  v_group record;
  v_child record;
  v_empty_content jsonb := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
begin
  select id
    into v_subject_id
    from public.subjects
   where code = '01';

  select id
    into v_section_id
    from public.theory_documents
   where subject_id = v_subject_id
     and parent_id is null
     and source_key = 'section:신장';

  if v_subject_id is null or v_section_id is null then
    raise exception '내과 > 신장 알렌 목차를 찾지 못했습니다.';
  end if;

  -- 적용 직전 다른 편집이 들어왔다면 예상하지 못한 글을 지우지 않고 중단한다.
  if (
    select count(*)
      from public.theory_documents
     where parent_id = v_section_id
  ) <> 11 or exists (
    select 1
      from public.theory_documents
     where parent_id = v_section_id
       and id not in (
         'd787c75d-4ff3-45f1-80cc-d7c62bb1bfa5'::uuid,
         '86bf8926-05a9-4ad2-a378-c746c784886f'::uuid,
         '48a7abe8-fe10-40ee-9f3f-d38c783e87c0'::uuid,
         '6cf5e59d-38f9-4d87-8c95-3c0e52aececa'::uuid,
         'a26a7d0d-25da-46e9-a2ff-4cb1f1e335bd'::uuid,
         '00eb249d-c480-4f41-9a21-595340bf8d12'::uuid,
         '87b15091-78b9-4f16-8abf-33ac630c4691'::uuid,
         '1bcca38f-0c6f-4f8d-8db1-2de24fa0ce68'::uuid,
         '969eb9d8-6313-422a-9289-e5a8c788c141'::uuid,
         'de9ce057-01dd-4d80-af3a-3e71a3e885d5'::uuid,
         '5d569c36-361a-4628-adc8-f6b1d69f45a9'::uuid
       )
  ) then
    raise exception '신장 바로 아래 목차가 확인 때와 달라져 교체를 중단했습니다.';
  end if;

  update public.theory_documents
     set title = '신장',
         content = v_empty_content,
         sort_order = 30000,
         required_permission = null,
         has_content = false,
         is_published = true
   where id = v_section_id;

  for v_group in
    select *
      from (values
        (1,  'd787c75d-4ff3-45f1-80cc-d7c62bb1bfa5'::uuid, '01 수분 및 전해질 대사 장애',       array['신장 생리', '나트륨 이상', '칼륨 이상', '저혈량과 부종']::text[]),
        (2,  '86bf8926-05a9-4ad2-a378-c746c784886f'::uuid, '02 산-염기 대사장애',               array['산-염기 장애 총론', '대사성 산증', '대사성 알칼리증']::text[]),
        (3,  '48a7abe8-fe10-40ee-9f3f-d38c783e87c0'::uuid, '03 세관기능장애',                   array['신세뇨관 산증', '선천 세관 기능 장애']::text[]),
        (4,  '6cf5e59d-38f9-4d87-8c95-3c0e52aececa'::uuid, '04 콩팥질환의 접근',                array['신장질환 진단검사', '단백뇨', '혈뇨']::text[]),
        (5,  'a26a7d0d-25da-46e9-a2ff-4cb1f1e335bd'::uuid, '05 급성콩팥기능상실',               array['급성 신손상', '급성 세뇨관 괴사']::text[]),
        (6,  '00eb249d-c480-4f41-9a21-595340bf8d12'::uuid, '06 만성콩팥기능상실/신대체요법',    array['만성 신부전의 원인 및 진단', '만성 신부전의 합병증', '만성 신부전의 치료']::text[]),
        (7,  '87b15091-78b9-4f16-8abf-33ac630c4691'::uuid, '07 콩팥토리 질환',                  array['급성 신염증후군', '신증후군', '기타 사구체 질환']::text[]),
        (8,  '1bcca38f-0c6f-4f8d-8db1-2de24fa0ce68'::uuid, '08 콩팥세관사이질/혈관 질환',       array['세관사이질 질환', '혈관성 신질환']::text[]),
        (9,  '969eb9d8-6313-422a-9289-e5a8c788c141'::uuid, '09 다낭성 신질환',                  array['다낭성 신질환']::text[]),
        (10, 'de9ce057-01dd-4d80-af3a-3e71a3e885d5'::uuid, '10 요로돌/요로폐색',                 array['요로결석', '요로폐색']::text[]),
        (11, '5d569c36-361a-4628-adc8-f6b1d69f45a9'::uuid, '11 요로감염',                       array['요로감염', '무증상 세균뇨', '급성 방광염', '급성 신우신염']::text[])
      ) as outline(position, document_id, title, children)
  loop
    -- 합본 게시물은 실제로 삭제해 삭제 감사 기록에 원문을 남기고, 같은 ID를
    -- 빈 대단원에 넘긴다. 이 ID를 가리키는 사용자의 알렌 태그와 에디터 초안은
    -- 새 대단원으로 자연스럽게 이어진다.
    delete from public.theory_documents
     where id = v_group.document_id
       and subject_id = v_subject_id;

    if not found then
      raise exception '기존 신장 문서를 찾지 못했습니다: %', v_group.title;
    end if;

    insert into public.theory_documents (
      id,
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
      v_group.document_id,
      v_subject_id,
      v_section_id,
      v_group.title,
      v_empty_content,
      v_group.position * 100,
      null,
      false,
      true,
      format('section:신장/outline:%s', lpad(v_group.position::text, 2, '0'))
    );

    for v_child in
      select child.title, child.position
        from unnest(v_group.children) with ordinality as child(title, position)
    loop
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
        v_group.document_id,
        v_child.title,
        v_empty_content,
        v_child.position,
        null,
        true,
        true,
        format(
          'section:신장/outline:%s/item:%s',
          lpad(v_group.position::text, 2, '0'),
          lpad(v_child.position::text, 2, '0')
        )
      );
    end loop;
  end loop;
end
$$;

-- 풀이 아래의 "관련 단원 · 알렌"에는 URL과 별도로 당시 제목도 저장된다.
-- ID는 유지되므로 URL은 그대로 두고, 표시되는 태그명만 새 대단원명으로 바꾼다.
with mapping(document_id, title) as (
  values
    ('d787c75d-4ff3-45f1-80cc-d7c62bb1bfa5'::uuid, '01 수분 및 전해질 대사 장애'),
    ('86bf8926-05a9-4ad2-a378-c746c784886f'::uuid, '02 산-염기 대사장애'),
    ('48a7abe8-fe10-40ee-9f3f-d38c783e87c0'::uuid, '03 세관기능장애'),
    ('6cf5e59d-38f9-4d87-8c95-3c0e52aececa'::uuid, '04 콩팥질환의 접근'),
    ('a26a7d0d-25da-46e9-a2ff-4cb1f1e335bd'::uuid, '05 급성콩팥기능상실'),
    ('00eb249d-c480-4f41-9a21-595340bf8d12'::uuid, '06 만성콩팥기능상실/신대체요법'),
    ('87b15091-78b9-4f16-8abf-33ac630c4691'::uuid, '07 콩팥토리 질환'),
    ('1bcca38f-0c6f-4f8d-8db1-2de24fa0ce68'::uuid, '08 콩팥세관사이질/혈관 질환'),
    ('969eb9d8-6313-422a-9289-e5a8c788c141'::uuid, '09 다낭성 신질환'),
    ('de9ce057-01dd-4d80-af3a-3e71a3e885d5'::uuid, '10 요로돌/요로폐색'),
    ('5d569c36-361a-4628-adc8-f6b1d69f45a9'::uuid, '11 요로감염')
), rewritten as (
  select
    solution.id,
    jsonb_agg(
      case
        when matched.title is not null
          then jsonb_set(reference.item, '{label}', to_jsonb('신장 > ' || matched.title), true)
        else reference.item
      end
      order by reference.position
    ) as references
  from public.solutions solution
  cross join lateral jsonb_array_elements(coalesce(solution."references", '[]'::jsonb))
    with ordinality as reference(item, position)
  left join mapping matched
    on right(coalesce(reference.item->>'url', ''), 36) = matched.document_id::text
  group by solution.id
  having bool_or(matched.title is not null)
)
update public.solutions solution
   set "references" = rewritten.references
  from rewritten
 where solution.id = rewritten.id;

with mapping(document_id, title) as (
  values
    ('d787c75d-4ff3-45f1-80cc-d7c62bb1bfa5'::uuid, '01 수분 및 전해질 대사 장애'),
    ('86bf8926-05a9-4ad2-a378-c746c784886f'::uuid, '02 산-염기 대사장애'),
    ('48a7abe8-fe10-40ee-9f3f-d38c783e87c0'::uuid, '03 세관기능장애'),
    ('6cf5e59d-38f9-4d87-8c95-3c0e52aececa'::uuid, '04 콩팥질환의 접근'),
    ('a26a7d0d-25da-46e9-a2ff-4cb1f1e335bd'::uuid, '05 급성콩팥기능상실'),
    ('00eb249d-c480-4f41-9a21-595340bf8d12'::uuid, '06 만성콩팥기능상실/신대체요법'),
    ('87b15091-78b9-4f16-8abf-33ac630c4691'::uuid, '07 콩팥토리 질환'),
    ('1bcca38f-0c6f-4f8d-8db1-2de24fa0ce68'::uuid, '08 콩팥세관사이질/혈관 질환'),
    ('969eb9d8-6313-422a-9289-e5a8c788c141'::uuid, '09 다낭성 신질환'),
    ('de9ce057-01dd-4d80-af3a-3e71a3e885d5'::uuid, '10 요로돌/요로폐색'),
    ('5d569c36-361a-4628-adc8-f6b1d69f45a9'::uuid, '11 요로감염')
), rewritten as (
  select
    pending.id,
    jsonb_agg(
      case
        when matched.title is not null
          then jsonb_set(reference.item, '{label}', to_jsonb('신장 > ' || matched.title), true)
        else reference.item
      end
      order by reference.position
    ) as references
  from public.solutions_pending pending
  cross join lateral jsonb_array_elements(coalesce(pending."references", '[]'::jsonb))
    with ordinality as reference(item, position)
  left join mapping matched
    on right(coalesce(reference.item->>'url', ''), 36) = matched.document_id::text
  group by pending.id
  having bool_or(matched.title is not null)
)
update public.solutions_pending pending
   set "references" = rewritten.references
  from rewritten
 where pending.id = rewritten.id;

commit;
