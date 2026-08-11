-- =============================================================================
-- richtext_plain 중복 수정
--
-- jsonpath 의 `$.**.text` 는 lax 모드에서 배열을 자동으로 펼친다. 그래서 텍스트
-- 노드가 "객체로 한 번, 그 노드를 담은 배열을 통해 또 한 번" 잡혀 같은 문장이
-- 두 번씩 나왔다. 검색 미리보기에 "1. 한줄요약 1. 한줄요약" 처럼 보이던 원인이다.
--
-- content 배열만 따라 내려가며 각 노드를 정확히 한 번씩 방문하도록 바꾼다.
-- =============================================================================
create or replace function public.richtext_plain(doc jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  with recursive nodes as (
    select coalesce(doc, '{}'::jsonb) as node
    union all
    select child.value
    from nodes
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(nodes.node) = 'object'
             and jsonb_typeof(nodes.node -> 'content') = 'array'
          then nodes.node -> 'content'
        else '[]'::jsonb
      end
    ) as child(value)
  )
  select coalesce(string_agg(node ->> 'text', ' '), '')
  from nodes
  where jsonb_typeof(node) = 'object'
    and node ? 'text'
$$;
