with groups as (
  select id, source_key from public.theory_documents
  where source_key in ('section:소화기/group:위장관', 'section:소화기/group:간담췌')
)
update public.theory_documents document
set parent_id = case
    when document.title like '% 위장관-%' then (select id from groups where source_key = 'section:소화기/group:위장관')
    when document.title like '% 간담췌-%' then (select id from groups where source_key = 'section:소화기/group:간담췌')
  end,
  sort_order = (substring(document.title from '^([0-9]+)')::int * 100)
where document.source_key like 'section:소화기/Private & Shared/소화기내과/%'
  and (document.title like '% 위장관-%' or document.title like '% 간담췌-%');
