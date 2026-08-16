-- 20학번 문제 열람 권한.
--
-- 21·22·23학번과 같은 취급이다. 문제를 넣기 전에 먼저 만들어 둔다.
-- 이걸 빼먹고 시험을 만들면 required_permission 이 null 이라 전체공개로
-- 들어가고, 넣는 순간 모두에게 노출된다. 상속 트리거는 같은 학번에
-- 잠긴 시험이 이미 있을 때만 물려주므로 첫 시험은 지켜주지 못한다.
insert into public.access_permissions (key, name, description, kind, sort_order)
values ('cohort_20_view', '20학번 문제', '20학번 시험의 문제를 봅니다.', 'cohort', 25)
on conflict (key) do nothing;

-- 21학번을 보는 사람과 같은 대상에게 준다.
insert into public.profile_permissions (profile_id, permission_key)
select pp.profile_id, 'cohort_20_view'
  from public.profile_permissions pp
 where pp.permission_key = 'cohort_21_view'
on conflict (profile_id, permission_key) do nothing;
