-- 소화기는 위장관과 간담췌 두 대분류로 다시 묶는다.
-- 기존 문서 ID를 유지하므로 풀이에서 이미 연결한 이론 링크도 변하지 않는다.
with section as (
  select id, subject_id from public.theory_documents
  where source_key = 'section:소화기'
), inserted as (
  insert into public.theory_documents (subject_id, parent_id, title, content, sort_order, has_content, is_published, source_key)
  select subject_id, id, '위장관', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, 100, false, true, 'section:소화기/group:위장관'
  from section
  union all
  select subject_id, id, '간담췌', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, 200, false, true, 'section:소화기/group:간담췌'
  from section
  on conflict (subject_id, source_key) do update set title = excluded.title, sort_order = excluded.sort_order
  returning id, source_key
), groups as (
  select id, source_key from inserted
  union all
  select id, source_key from public.theory_documents
  where source_key in ('section:소화기/group:위장관', 'section:소화기/group:간담췌')
)
update public.theory_documents document
set parent_id = case
    when document.title like '위장관-%' then (select id from groups where source_key = 'section:소화기/group:위장관' limit 1)
    when document.title like '간담췌-%' then (select id from groups where source_key = 'section:소화기/group:간담췌' limit 1)
  end,
  sort_order = (substring(document.title from '^([0-9]+)')::int * 100)
where document.parent_id = (select id from section)
  and (document.title like '위장관-%' or document.title like '간담췌-%');
