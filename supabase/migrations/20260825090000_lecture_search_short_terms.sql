-- PDF 추출 과정에서 `UVJ`가 `U V J`처럼 갈라진 검색어를 각 한 글자 AND로
-- 평가하면 거의 모든 영문 페이지가 후보가 되어 statement timeout이 난다.
-- 한 글자 토큰이 여러 개면 입력 순서대로 다시 붙인 문자열을 반드시 포함하게
-- 하여 원래 약어를 찾고, 함께 입력한 긴 낱말은 기존 AND 규칙을 유지한다.

begin;

create or replace function public.search_text_rank(input_text text, query_text text)
returns real
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text := regexp_replace(lower(coalesce(input_text, '')), '[[:space:]]+', ' ', 'g');
  phrase text := regexp_replace(lower(btrim(coalesce(query_text, ''))), '[[:space:]]+', ' ', 'g');
  compact_text text := regexp_replace(lower(coalesce(input_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  compact_phrase text := regexp_replace(lower(coalesce(query_text, '')), '[^[:alnum:]가-힣]+', '', 'g');
  all_terms text[] := public.search_query_terms(query_text);
  terms text[] := '{}'::text[];
  short_phrase text := '';
  term text;
  term_at integer;
  first_at integer := null;
  last_at integer := null;
begin
  if cardinality(all_terms) = 0 or compact_phrase = '' then
    return 0;
  end if;

  -- 사용자가 입력한 문장이 그대로 있으면 가장 관련성이 높다.
  if phrase <> '' and strpos(cleaned, phrase) > 0 then
    return 4.0;
  end if;

  -- PDF·리치텍스트 추출 중 공백이나 구두점만 끼어든 문장이다.
  if strpos(compact_text, compact_phrase) > 0 then
    return 3.5;
  end if;

  if cardinality(all_terms) > 1 then
    foreach term in array all_terms loop
      if char_length(term) = 1 then
        short_phrase := short_phrase || term;
      else
        terms := array_append(terms, term);
      end if;
    end loop;

    -- `u v j`를 u·v·j가 페이지 아무 곳에나 있는 조건으로 풀지 않는다.
    if short_phrase <> '' and strpos(compact_text, short_phrase) = 0 then
      return 0;
    end if;
  else
    terms := all_terms;
  end if;

  -- 한 글자 토큰으로만 된 검색은 위의 compact 일치에서 이미 처리됐다.
  if cardinality(terms) = 0 then
    return 0;
  end if;

  -- 나머지는 모든 긴 낱말이 있어야 하며, 첫 출현끼리 가까울수록 앞에 둔다.
  foreach term in array terms loop
    term_at := strpos(cleaned, term);
    if term_at = 0 then
      return 0;
    end if;
    first_at := least(coalesce(first_at, term_at), term_at);
    last_at := greatest(coalesce(last_at, term_at), term_at);
  end loop;

  return (
    2.0 + 1.0 / (1.0 + greatest(0, coalesce(last_at, 0) - coalesce(first_at, 0)) / 40.0)
  )::real;
end;
$$;

revoke all on function public.search_text_rank(text, text) from public, anon;
grant execute on function public.search_text_rank(text, text) to authenticated, service_role;

comment on function public.search_text_rank(text, text) is
  '정확 문장·공백 제거 문장·낱말 AND 순으로 검색 관련도를 계산하며, 여러 한 글자 토큰은 분리된 약어로 처리한다.';

commit;
