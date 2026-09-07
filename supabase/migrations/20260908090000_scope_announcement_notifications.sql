-- 공지 알림이 공지의 권한 범위를 무시하고 전 회원에게 나가던 것을 고친다.
-- 알림 message 에 제목이 그대로 담기므로, 범위 밖 사람에게는 제목조차 나가면 안 된다.
-- 이미 잘못 나간 알림도 함께 회수한다.

begin;

create or replace function public.notify_on_announcement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
  select p.id, 'announcement', new.author_id, 'announcement', new.id, new.title
    from public.profiles p
   where p.id <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and (
       -- 전체 공지는 모두에게, 스터디 공지는 그 권한을 가진 사람에게만 간다.
       new.required_permission is null
       or exists (
         select 1
           from public.profile_permissions pp
          where pp.profile_id = p.id
            and pp.permission_key = new.required_permission
       )
     );
  return null;
end;
$function$;

-- 권한 범위 밖으로 이미 나간 공지 알림을 지운다.
delete from public.notifications n
 using public.announcements a
 where n.type = 'announcement'
   and n.target_id = a.id
   and a.required_permission is not null
   and not exists (
     select 1
       from public.profile_permissions pp
      where pp.profile_id = n.user_id
        and pp.permission_key = a.required_permission
   );

commit;
