-- 내과 > 류마티스 목차를 지정된 13개 단원으로 전면 교체한다.
-- 기존 류마티스 문서는 본문을 포함해 제거해도 된다는 요청에 따라 하위 트리를
-- 삭제한 뒤, 빈 본문을 가진 새 이론 문서로 다시 만든다.

begin;

do $$
declare
  v_subject_id uuid;
  v_section_id uuid;
  v_group_id uuid;
  v_group record;
  v_child record;
  v_empty_content jsonb := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
begin
  select id
    into v_subject_id
    from public.subjects
   where code = '01';

  if v_subject_id is null then
    raise exception '내과 과목(code=01)을 찾지 못했습니다.';
  end if;

  -- source_key가 같은 기존 섹션은 ID를 유지하고, 중복된 옛 섹션은 제거한다.
  select id
    into v_section_id
    from public.theory_documents
   where subject_id = v_subject_id
     and parent_id is null
     and source_key = 'section:류마티스'
   limit 1;

  delete from public.theory_documents
   where subject_id = v_subject_id
     and parent_id is null
     and id is distinct from v_section_id
     and (
       btrim(title) = '류마티스'
       or source_key like 'section:류마티스/%'
     );

  if v_section_id is null then
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
      null,
      '류마티스',
      v_empty_content,
      36000,
      null,
      false,
      true,
      'section:류마티스'
    )
    returning id into v_section_id;
  else
    -- parent_id의 cascade 규칙으로 기존 류마티스 하위 내용을 모두 제거한다.
    delete from public.theory_documents
     where parent_id = v_section_id;

    update public.theory_documents
       set title = '류마티스',
           content = v_empty_content,
           sort_order = 36000,
           required_permission = null,
           has_content = false,
           is_published = true
     where id = v_section_id;
  end if;

  for v_group in
    select *
      from (values
        (1,  '01 류마티스 질환의 개요', array['자가면역질환의 개요', '관절염의 개요']::text[]),
        (2,  '02 전신홍반루푸스',       array['전신홍반루푸스', '항인지질증후군']::text[]),
        (3,  '03 전신경화증',           array['전신경화증']::text[]),
        (4,  '04 쇼그렌 증후군',        array['쇼그렌병']::text[]),
        (5,  '05 혈관염',               array['혈관염']::text[]),
        (6,  '06 염증성 근육병증',      array['염증성 근육병증']::text[]),
        (7,  '07 베체트병',             array['베체트병']::text[]),
        (8,  '08 척추관절염',           array['강직성 척추염', '기타 척추관절염']::text[]),
        (9,  '09 류마티스관절염',       array['류마티스 관절염']::text[]),
        (10, '10 골관절염',             array['골관절염']::text[]),
        (11, '11 결정유발 관절염',      array['결정 유발 관절염']::text[]),
        (12, '12 감염 관절염',          array['감염 관절염']::text[]),
        (13, '13 기타 류마티스 질환',   array['기타 류마티스 질환']::text[])
      ) as outline(position, title, children)
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
      v_section_id,
      v_group.title,
      v_empty_content,
      v_group.position * 100,
      null,
      false,
      true,
      format('section:류마티스/outline:%s', lpad(v_group.position::text, 2, '0'))
    )
    returning id into v_group_id;

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
        v_group_id,
        v_child.title,
        v_empty_content,
        v_child.position,
        null,
        true,
        true,
        format(
          'section:류마티스/outline:%s/item:%s',
          lpad(v_group.position::text, 2, '0'),
          lpad(v_child.position::text, 2, '0')
        )
      );
    end loop;
  end loop;
end
$$;

commit;
