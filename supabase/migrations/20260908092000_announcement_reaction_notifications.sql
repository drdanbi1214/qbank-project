-- 공지 추천·댓글 알림. create_notification 이 자기 자신 알림을 이미 걸러준다.

begin;

-- 타입 제약을 넓히지 않으면 알림 insert 가 조용히 실패한다.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'solution_comment', 'inline_comment', 'comment_reply', 'mention',
    'solution_upvote', 'assignment', 'comment_resolved', 'discussion_reply',
    'answer_accepted', 'announcement',
    'announcement_upvote', 'announcement_comment'
  ]));

create or replace function public.notify_on_announcement_upvote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a_author uuid;
  a_title  text;
begin
  select author_id, title into a_author, a_title
    from public.announcements where id = new.announcement_id;

  -- 추천을 껐다 켜도 알림은 한 번만 간다. 같은 사람이 같은 글로 다시 보내지 않는다.
  if exists (
    select 1 from public.notifications n
     where n.user_id = a_author
       and n.type = 'announcement_upvote'
       and n.target_id = new.announcement_id
       and n.actor_id = new.user_id
  ) then
    return null;
  end if;

  perform public.create_notification(
    a_author, 'announcement_upvote', new.user_id,
    'announcement', new.announcement_id,
    format('%s 글을 추천했습니다.', a_title));
  return null;
end;
$function$;

create trigger announcement_upvotes_notify
  after insert on public.announcement_upvotes
  for each row execute function public.notify_on_announcement_upvote();

create or replace function public.notify_on_announcement_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a_author      uuid;
  a_title       text;
  parent_author uuid;
begin
  select author_id, title into a_author, a_title
    from public.announcements where id = new.announcement_id;

  if new.parent_id is null then
    perform public.create_notification(
      a_author, 'announcement_comment', new.author_id,
      'announcement', new.announcement_id,
      format('%s 글에 댓글이 달렸습니다.', a_title));
  else
    -- 답글은 부모 댓글 작성자에게 간다. 타입은 게시판 답글과 같은 것을 쓴다.
    select author_id into parent_author
      from public.announcement_comments where id = new.parent_id;
    perform public.create_notification(
      parent_author, 'comment_reply', new.author_id,
      'announcement', new.announcement_id,
      '남기신 댓글에 답글이 달렸습니다.');
  end if;
  return null;
end;
$function$;

create trigger announcement_comments_notify
  after insert on public.announcement_comments
  for each row execute function public.notify_on_announcement_comment();

commit;
