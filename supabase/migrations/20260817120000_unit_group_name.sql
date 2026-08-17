-- 단원을 "총론/각론" 같은 상위 그룹으로 묶어 보여주기 위한 선택적 필드.
-- null 이면 기존처럼 평평한 목록으로 렌더링한다.
alter table public.units add column group_name text;

update public.units
set group_name = '총론'
where subject_id = (select id from public.subjects where name = '소아청소년과')
  and name in (
    '소아 진찰·발달·영양',
    '예방접종·아동학대·손상',
    '수분 및 전해질 평형',
    '유전 및 유전성 대사질환',
    '신생아 - 소생술·호흡기',
    '신생아 - 황달',
    '신생아 - 기타'
  );

update public.units
set group_name = '각론'
where subject_id = (select id from public.subjects where name = '소아청소년과')
  and name in (
    '감염병',
    '소화기 질환',
    '호흡기 질환',
    '심혈관 질환',
    '신경계 질환',
    '내분비 질환',
    '혈액 질환',
    '종양성 질환',
    '알레르기 질환',
    '기타'
  );
