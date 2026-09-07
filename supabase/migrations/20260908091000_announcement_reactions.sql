-- 공지에 추천과 댓글을 단다. discussions 의 구조를 그대로 따른다.
-- 추천·댓글은 공지 자체의 권한 범위를 상속한다. 공지가 안 보이는 사람에게
-- 그 공지의 댓글이 보이면 안 되기 때문이다.

begin;

-- 목록에서 글마다 세지 않도록 카운터는 본문 행에 둔다. discussions 와 같다.
alter table public.announcements
  add column upvote_count  integer not null default 0,
  add column comment_count integer not null default 0;

-- 정책 안에서 announcements 를 직접 조회하면 그 표의 RLS 가 겹쳐 재귀와
-- 성능 문제가 생긴다. has_content_access 처럼 definer 함수로 한 번 감싼다.
create or replace function public.can_access_announcement(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.announcements a
     where a.id = p_id
       and (public.is_admin() or public.has_content_access(a.required_permission))
  );
$function$;

-- ---------------------------------------------------------------- 추천
create table public.announcement_upvotes (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id)      on delete cascade,
  created_at      timestamptz not null default now(),
  -- 1인 1추천을 스키마로 보장한다.
  primary key (announcement_id, user_id)
);

alter table public.announcement_upvotes enable row level security;
revoke all on table public.announcement_upvotes from anon;
grant select, insert, delete on table public.announcement_upvotes to authenticated;

create policy announcement_upvotes_select on public.announcement_upvotes
  for select to authenticated
  using (public.can_access_announcement(announcement_id));

create policy announcement_upvotes_insert on public.announcement_upvotes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_write()
    and public.can_access_announcement(announcement_id)
  );

create policy announcement_upvotes_delete on public.announcement_upvotes
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------- 댓글
create table public.announcement_comments (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  parent_id       uuid references public.announcement_comments(id)  on delete cascade,
  author_id       uuid not null references public.profiles(id)      on delete cascade,
  content         jsonb not null,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index announcement_comments_lookup_idx
  on public.announcement_comments (announcement_id, created_at);
create index announcement_comments_parent_idx
  on public.announcement_comments (parent_id);

alter table public.announcement_comments enable row level security;
revoke all on table public.announcement_comments from anon;
grant select, insert, update, delete on table public.announcement_comments to authenticated;

create policy announcement_comments_select on public.announcement_comments
  for select to authenticated
  using (public.can_access_announcement(announcement_id));

create policy announcement_comments_insert on public.announcement_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_write()
    and public.can_access_announcement(announcement_id)
  );

create policy announcement_comments_update on public.announcement_comments
  for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

create policy announcement_comments_delete on public.announcement_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create trigger announcement_comments_set_updated_at
  before update on public.announcement_comments
  for each row execute function public.set_updated_at();

-- 댓글 깊이 2단계 제한. 기존 함수가 이미 표 이름으로 갈라져 있어 분기만 넓힌다.
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

create trigger announcement_comments_depth
  before insert or update on public.announcement_comments
  for each row execute function public.enforce_reply_depth();

-- 답글이 달린 댓글을 지우면 답글이 통째로 사라지므로 내용만 비운다.
create or replace function public.soft_delete_announcement_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- 공지가 통째로 사라지는 중이면 그냥 지운다.
  if not exists (select 1 from public.announcements where id = old.announcement_id) then
    return old;
  end if;
  if exists (select 1 from public.announcement_comments where parent_id = old.id) then
    update public.announcement_comments
       set is_deleted = true, content = '{}'::jsonb, updated_at = now()
     where id = old.id;
    return null;
  end if;
  return old;
end;
$function$;

create trigger announcement_comments_soft_delete
  before delete on public.announcement_comments
  for each row execute function public.soft_delete_announcement_comment();

-- ---------------------------------------------------------------- 카운터
create or replace function public.sync_announcement_upvote_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare target uuid := coalesce(new.announcement_id, old.announcement_id);
begin
  update public.announcements a
     set upvote_count = (select count(*) from public.announcement_upvotes u
                          where u.announcement_id = target)
   where a.id = target;
  return null;
end;
$function$;

create trigger announcement_upvotes_sync
  after insert or delete on public.announcement_upvotes
  for each row execute function public.sync_announcement_upvote_count();

create or replace function public.sync_announcement_comment_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare target uuid := coalesce(new.announcement_id, old.announcement_id);
begin
  update public.announcements a
     set comment_count = (select count(*) from public.announcement_comments c
                           where c.announcement_id = target and not c.is_deleted)
   where a.id = target;
  return null;
end;
$function$;

create trigger announcement_comments_sync_count
  after insert or update or delete on public.announcement_comments
  for each row execute function public.sync_announcement_comment_count();

commit;
