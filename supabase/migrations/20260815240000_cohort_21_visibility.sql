-- 21학번 문제 열람 권한.
--
-- 22·23학번과 같은 취급이다. 21학번 문제를 넣기 전에 먼저 권한과 대상을
-- 만들어 둔다. 이걸 빼먹고 시험을 만들면 required_permission 이 null 이라
-- 전체공개로 들어가고, 넣는 순간 모두에게 노출된다.
--
-- 시험 자체는 문제를 넣을 때 required_permission = 'cohort_21_view' 로
-- 만든다. 그 뒤에 같은 학번으로 시험을 더 만들면 상속 트리거가 알아서
-- 같은 값을 물려준다.

insert into public.access_permissions (key, name, description, kind, sort_order)
values ('cohort_21_view', '21학번 문제', '21학번 시험의 문제를 봅니다.', 'cohort', 30)
on conflict (key) do nothing;

-- 22·23학번을 보는 사람과 같은 대상에게 준다.
insert into public.profile_permissions (profile_id, permission_key)
select pp.profile_id, 'cohort_21_view'
  from public.profile_permissions pp
 where pp.permission_key = 'cohort_22_view'
on conflict (profile_id, permission_key) do nothing;
