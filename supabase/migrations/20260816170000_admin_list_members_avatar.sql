-- 사용자 관리 화면에서 프로필 사진을 보여준다.
--
-- 화면은 이미 Avatar 컴포넌트를 쓰고 있었지만 경로를 넘겨줄 곳이 없어
-- 늘 닉네임 첫 글자만 나왔다. RPC 가 avatar_url 을 함께 돌려주면 된다.
--
-- 반환 열이 늘어나므로 drop 후 다시 만든다.
drop function if exists public.admin_list_members();

create function public.admin_list_members()
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  role text,
  is_suspended boolean,
  created_at timestamptz,
  attempt_count integer,
  solution_count integer,
  last_active_at timestamptz,
  permission_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.email,
    p.display_name,
    p.avatar_url,
    p.role,
    p.is_suspended,
    p.created_at,
    (select count(*)::int from public.attempts a where a.user_id = p.id),
    (select count(*)::int from public.solutions s where s.author_id = p.id),
    (select max(a.created_at) from public.attempts a where a.user_id = p.id),
    coalesce(
      (select array_agg(pp.permission_key order by ap.sort_order, pp.permission_key)
         from public.profile_permissions pp
         join public.access_permissions ap on ap.key = pp.permission_key
        where pp.profile_id = p.id),
      '{}'::text[]
    )
  from public.profiles p
  where public.is_admin()
  order by p.created_at
$$;

grant execute on function public.admin_list_members() to authenticated;
