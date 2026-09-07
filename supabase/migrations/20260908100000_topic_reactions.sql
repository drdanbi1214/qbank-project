-- 테마 본문에 추천과 댓글을 단다. 공지에 붙인 것과 같은 구조다.
-- 접근 범위는 테마 자신의 required_permission 을 그대로 상속한다.

begin;

alter table public.topics
  add column upvote_count  integer not null default 0,
  add column comment_count integer not null default 0;

-- 정책 안에서 topics 를 직접 조회하면 그 표의 RLS 가 겹친다. definer 로 감싼다.
create or replace function public.can_access_topic(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.topics t
     where t.id = p_id
       and public.can_edit_topic(t.required_permission)
  );
$function$;

-- ---------------------------------------------------------------- 추천
create table public.topic_upvotes (
  topic_id   uuid not null references public.topics(id)   on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (topic_id, user_id)
);

alter table public.topic_upvotes enable row level security;
revoke all on table public.topic_upvotes from anon;
grant select, insert, delete on table public.topic_upvotes to authenticated;

create policy topic_upvotes_select on public.topic_upvotes
  for select to authenticated
  using (public.can_access_topic(topic_id));

create policy topic_upvotes_insert on public.topic_upvotes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_write()
    and public.can_access_topic(topic_id)
  );

create policy topic_upvotes_delete on public.topic_upvotes
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------- 댓글
create table public.topic_comments (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.topics(id)          on delete cascade,
  parent_id  uuid references public.topic_comments(id)           on delete cascade,
  author_id  uuid not null references public.profiles(id)        on delete cascade,
  content    jsonb not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index topic_comments_lookup_idx on public.topic_comments (topic_id, created_at);
create index topic_comments_parent_idx on public.topic_comments (parent_id);

alter table public.topic_comments enable row level security;
revoke all on table public.topic_comments from anon;
grant select, insert, update, delete on table public.topic_comments to authenticated;

create policy topic_comments_select on public.topic_comments
  for select to authenticated
  using (public.can_access_topic(topic_id));

create policy topic_comments_insert on public.topic_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_write()
    and public.can_access_topic(topic_id)
  );

create policy topic_comments_update on public.topic_comments
  for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

create policy topic_comments_delete on public.topic_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create trigger topic_comments_set_updated_at
  before update on public.topic_comments
  for each row execute function public.set_updated_at();

-- 깊이 2단계 제한. 기존 함수 분기만 넓힌다.
create or replace function public.enforce_reply_depth()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare grandparent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  if tg_table_name = 'discussion_replies' then
    select parent_id into grandparent from public.discussion_replies where id = new.parent_id;
  elsif tg_table_name = 'announcement_comments' then
    select parent_id into grandparent from public.announcement_comments where id = new.parent_id;
  elsif tg_table_name = 'topic_comments' then
    select parent_id into grandparent from public.topic_comments where id = new.parent_id;
  else
    select parent_id into grandparent from public.inline_comments where id = new.parent_id;
  end if;
  if grandparent is not null then
    raise exception '댓글 깊이는 2단계까지만 허용됩니다. 멘션으로 답글을 남겨주세요.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger topic_comments_depth
  before insert or update on public.topic_comments
  for each row execute function public.enforce_reply_depth();

create or replace function public.soft_delete_topic_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.topics where id = old.topic_id) then
    return old;
  end if;
  if exists (select 1 from public.topic_comments where parent_id = old.id) then
    update public.topic_comments
       set is_deleted = true, content = '{}'::jsonb, updated_at = now()
     where id = old.id;
    return null;
  end if;
  return old;
end;
$function$;

create trigger topic_comments_soft_delete
  before delete on public.topic_comments
  for each row execute function public.soft_delete_topic_comment();

-- ---------------------------------------------------------------- 카운터
create or replace function public.sync_topic_upvote_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare target uuid := coalesce(new.topic_id, old.topic_id);
begin
  update public.topics t
     set upvote_count = (select count(*) from public.topic_upvotes u where u.topic_id = target)
   where t.id = target;
  return null;
end;
$function$;

create trigger topic_upvotes_sync
  after insert or delete on public.topic_upvotes
  for each row execute function public.sync_topic_upvote_count();

create or replace function public.sync_topic_comment_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare target uuid := coalesce(new.topic_id, old.topic_id);
begin
  update public.topics t
     set comment_count = (select count(*) from public.topic_comments c
                           where c.topic_id = target and not c.is_deleted)
   where t.id = target;
  return null;
end;
$function$;

create trigger topic_comments_sync_count
  after insert or update or delete on public.topic_comments
  for each row execute function public.sync_topic_comment_count();

-- ---------------------------------------------------------------- 알림
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'solution_comment', 'inline_comment', 'comment_reply', 'mention',
    'solution_upvote', 'assignment', 'comment_resolved', 'discussion_reply',
    'answer_accepted', 'announcement',
    'announcement_upvote', 'announcement_comment',
    'topic_upvote', 'topic_comment'
  ]));

create or replace function public.notify_on_topic_upvote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t_author uuid; t_title text;
begin
  select created_by, title into t_author, t_title
    from public.topics where id = new.topic_id;

  -- 껐다 켜도 알림은 한 번만 간다.
  if exists (
    select 1 from public.notifications n
     where n.user_id = t_author and n.type = 'topic_upvote'
       and n.target_id = new.topic_id and n.actor_id = new.user_id
  ) then
    return null;
  end if;

  perform public.create_notification(
    t_author, 'topic_upvote', new.user_id, 'topic', new.topic_id,
    format('%s 테마를 추천했습니다.', t_title));
  return null;
end;
$function$;

create trigger topic_upvotes_notify
  after insert on public.topic_upvotes
  for each row execute function public.notify_on_topic_upvote();

create or replace function public.notify_on_topic_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t_author uuid; t_title text; parent_author uuid;
begin
  select created_by, title into t_author, t_title
    from public.topics where id = new.topic_id;

  if new.parent_id is null then
    perform public.create_notification(
      t_author, 'topic_comment', new.author_id, 'topic', new.topic_id,
      format('%s 테마에 댓글이 달렸습니다.', t_title));
  else
    select author_id into parent_author
      from public.topic_comments where id = new.parent_id;
    perform public.create_notification(
      parent_author, 'comment_reply', new.author_id, 'topic', new.topic_id,
      '남기신 댓글에 답글이 달렸습니다.');
  end if;
  return null;
end;
$function$;

create trigger topic_comments_notify
  after insert on public.topic_comments
  for each row execute function public.notify_on_topic_comment();

commit;
