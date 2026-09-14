-- 종양 이론 목차를 Allen의 현재 대제목 구조와 맞춘다.
-- 기존 세 문서는 ID를 유지해 외부 링크와 참조가 끊기지 않게 하고, 사용자가
-- 새 내용을 직접 작성할 수 있도록 본문을 비운다.

begin;

do $$
declare
  oncology_root public.theory_documents%rowtype;
  diagnosis_id uuid;
  treatment_id uuid;
  complications_id uuid;
  diagnosis_treatment_group_id constant uuid := '4b4600f0-6c54-4ab4-a833-c183772174e1';
  empty_content constant jsonb := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
begin
  select *
    into strict oncology_root
    from public.theory_documents
   where title = '종양'
     and parent_id is null;

  select id into strict diagnosis_id
    from public.theory_documents
   where subject_id = oncology_root.subject_id
     and title = '종양의 진단';

  select id into strict treatment_id
    from public.theory_documents
   where subject_id = oncology_root.subject_id
     and title = '종양의 치료';

  select id into strict complications_id
    from public.theory_documents
   where subject_id = oncology_root.subject_id
     and title in ('종양의 합병증', '2 종양의 합병증');

  insert into public.theory_documents (
    id, subject_id, parent_id, unit_id, title, content, sort_order,
    required_permission, is_published, created_by, has_content, source_key
  ) values (
    diagnosis_treatment_group_id,
    oncology_root.subject_id,
    oncology_root.id,
    null,
    '1 종양의 진단/치료',
    empty_content,
    100,
    oncology_root.required_permission,
    true,
    oncology_root.created_by,
    false,
    'kmle:onco:group:diagnosis-treatment'
  )
  on conflict (id) do update set
    parent_id = excluded.parent_id,
    unit_id = null,
    title = excluded.title,
    sort_order = excluded.sort_order,
    required_permission = excluded.required_permission,
    is_published = true,
    has_content = false,
    source_key = excluded.source_key;

  update public.theory_documents
     set parent_id = diagnosis_treatment_group_id,
         title = '종양의 진단',
         content = case when parent_id = oncology_root.id then empty_content else content end,
         sort_order = 100,
         has_content = true,
         is_published = true
   where id = diagnosis_id;

  update public.theory_documents
     set parent_id = diagnosis_treatment_group_id,
         title = '종양의 치료',
         content = case when parent_id = oncology_root.id then empty_content else content end,
         sort_order = 200,
         has_content = true,
         is_published = true
   where id = treatment_id;

  update public.theory_documents
     set parent_id = oncology_root.id,
         unit_id = null,
         title = '2 종양의 합병증',
         content = case when has_content then empty_content else content end,
         sort_order = 200,
         has_content = false,
         is_published = true,
         source_key = 'kmle:onco:group:complications'
   where id = complications_id;

  insert into public.theory_documents (
    id, subject_id, parent_id, unit_id, title, content, sort_order,
    required_permission, is_published, created_by, has_content, source_key
  ) values
    ('6e7ac283-3c54-48f8-824f-10258b0eac01', oncology_root.subject_id, complications_id, null,
     '신생물딸림증후군', empty_content, 100, oncology_root.required_permission, true, oncology_root.created_by, true,
     'kmle:onco:complication:paraneoplastic'),
    ('6e7ac283-3c54-48f8-824f-10258b0eac02', oncology_root.subject_id, complications_id, null,
     '위대정맥증후군', empty_content, 200, oncology_root.required_permission, true, oncology_root.created_by, true,
     'kmle:onco:complication:svc'),
    ('6e7ac283-3c54-48f8-824f-10258b0eac03', oncology_root.subject_id, complications_id, null,
     '종양의 척수 압박', empty_content, 300, oncology_root.required_permission, true, oncology_root.created_by, true,
     'kmle:onco:complication:spinal-cord-compression'),
    ('6e7ac283-3c54-48f8-824f-10258b0eac04', oncology_root.subject_id, complications_id, null,
     '종양용해증후군', empty_content, 400, oncology_root.required_permission, true, oncology_root.created_by, true,
     'kmle:onco:complication:tumor-lysis')
  on conflict (id) do update set
    parent_id = excluded.parent_id,
    unit_id = null,
    title = excluded.title,
    sort_order = excluded.sort_order,
    required_permission = excluded.required_permission,
    is_published = true,
    has_content = true,
    source_key = excluded.source_key;
end
$$;

commit;
