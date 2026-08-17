-- 스터디 그룹 '레전드옵세스터디'.
--
-- 합본3·네잎클로버·E조스터디와 같은 성격이다. 이 권한으로 공개한 풀이는
-- 같은 권한을 가진 사람만 읽는다. 아직 아무에게도 주지 않았으므로, 관리자
-- 화면의 사용자 관리에서 대상을 지정해야 실제로 쓰인다.
insert into public.access_permissions (key, name, description, kind, sort_order)
values ('study_legendob', '레전드옵세스터디',
        '레전드옵세스터디에서 작성한 풀이를 봅니다.', 'study', 13)
on conflict (key) do nothing;
