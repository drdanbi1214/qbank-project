-- Preserve each solver's answer instead of letting the last editor overwrite
-- questions.editor_answer.  Visibility follows the union of the study
-- permissions held by the author when the opinion is saved.

create table public.question_answer_opinions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  answer integer[] not null,
  permission_keys text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, author_id),
  check (cardinality(answer) > 0)
);

create index question_answer_opinions_question_idx
  on public.question_answer_opinions (question_id, updated_at desc);
create index question_answer_opinions_author_idx
  on public.question_answer_opinions (author_id);

create trigger question_answer_opinions_set_updated_at
  before update on public.question_answer_opinions
  for each row execute function public.set_updated_at();

alter table public.question_answer_opinions enable row level security;

create policy question_answer_opinions_select
  on public.question_answer_opinions
  for select to authenticated
  using (
    public.can_view_question(question_id)
    and (
      author_id = auth.uid()
      or public.is_admin()
      or cardinality(permission_keys) = 0
      or exists (
        select 1
          from unnest(permission_keys) as permission_key
         where public.has_permission(permission_key)
      )
    )
  );

-- Direct writes would let a client claim permissions it does not own.  The RPC
-- below reads the author's study permissions on the server and is the only
-- write path exposed to members.
revoke all on table public.question_answer_opinions from anon, authenticated;
grant select on table public.question_answer_opinions to authenticated;

create or replace function public.save_my_answer_opinion(
  p_question_id uuid,
  p_answer integer[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_answer integer[];
  audience_permissions text[];
  choice_count integer;
  saved_id uuid;
begin
  if not public.can_write() then
    raise exception '답 의견을 등록할 수 없는 계정입니다.' using errcode = '42501';
  end if;
  if not public.can_view_question(p_question_id) then
    raise exception '볼 수 없는 문제입니다.' using errcode = '42501';
  end if;

  select jsonb_array_length(q.choices)
    into choice_count
    from public.questions q
   where q.id = p_question_id;

  select coalesce(array_agg(distinct value order by value), '{}'::integer[])
    into normalized_answer
    from unnest(coalesce(p_answer, '{}'::integer[])) as value;

  if cardinality(normalized_answer) = 0 then
    delete from public.question_answer_opinions
     where question_id = p_question_id and author_id = auth.uid();
    return null;
  end if;

  if exists (
    select 1 from unnest(normalized_answer) as value
     where value < 1 or value > choice_count
  ) then
    raise exception '문제의 선지 범위를 벗어난 답입니다.' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(pp.permission_key order by ap.sort_order, pp.permission_key), '{}'::text[])
    into audience_permissions
    from public.profile_permissions pp
    join public.access_permissions ap on ap.key = pp.permission_key
   where pp.profile_id = auth.uid()
     and ap.kind = 'study';

  insert into public.question_answer_opinions (
    question_id, author_id, answer, permission_keys
  ) values (
    p_question_id, auth.uid(), normalized_answer, audience_permissions
  )
  on conflict (question_id, author_id) do update
    set answer = excluded.answer,
        permission_keys = excluded.permission_keys,
        updated_at = now()
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.save_my_answer_opinion(uuid, integer[]) from public, anon;
grant execute on function public.save_my_answer_opinion(uuid, integer[]) to authenticated;

-- A viewer can see an opinion-generated dispute only when they can see at
-- least one differing opinion.  A legacy Y답/편집자답 dispute remains visible
-- to everyone who can see the question.
create or replace function public.can_view_answer_dispute(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select q.editor_answer,
           q.yama_answer,
           case
             when cardinality(q.editor_answer) > 0 then q.editor_answer
             else coalesce(q.yama_answer, '{}'::integer[])
           end as baseline
      from public.questions q
     where q.id = p_question_id
  )
  select public.is_admin()
      or exists (
        select 1 from target t
         where public.answers_differ(t.editor_answer, t.yama_answer)
      )
      or exists (
        select 1
          from target t
          join public.question_answer_opinions o on o.question_id = p_question_id
         where public.answers_differ(o.answer, t.baseline)
           and (
             o.author_id = auth.uid()
             or cardinality(o.permission_keys) = 0
             or exists (
               select 1 from unnest(o.permission_keys) as permission_key
                where public.has_permission(permission_key)
             )
           )
      );
$$;

revoke all on function public.can_view_answer_dispute(uuid) from public, anon;
grant execute on function public.can_view_answer_dispute(uuid) to authenticated;

create or replace function public.refresh_answer_dispute_discussion(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_author_id uuid;
  subject_name text;
  exam_cohort text;
  question_number integer;
  baseline integer[];
  has_dispute boolean;
begin
  select s.name,
         e.cohort,
         q.question_number,
         case
           when cardinality(q.editor_answer) > 0 then q.editor_answer
           else coalesce(q.yama_answer, '{}'::integer[])
         end,
         public.answers_differ(q.editor_answer, q.yama_answer)
    into subject_name, exam_cohort, question_number, baseline, has_dispute
    from public.questions q
    join public.exams e on e.id = q.exam_id
    join public.subjects s on s.id = e.subject_id
   where q.id = p_question_id
     and q.status = 'published';

  if not found then
    has_dispute := false;
  else
    has_dispute := has_dispute or exists (
      select 1
        from public.question_answer_opinions o
       where o.question_id = p_question_id
         and public.answers_differ(o.answer, baseline)
    );
  end if;

  if has_dispute then
    select p.id into thread_author_id
      from public.profiles p
     where p.role = 'admin'
     order by p.created_at, p.id
     limit 1;

    thread_author_id := coalesce(
      thread_author_id,
      (select o.author_id
         from public.question_answer_opinions o
        where o.question_id = p_question_id
        order by o.created_at, o.id
        limit 1)
    );

    if thread_author_id is not null then
      insert into public.discussions (
        question_id, author_id, category, title, content, status,
        is_auto_answer_dispute
      ) values (
        p_question_id,
        thread_author_id,
        '정답이의',
        format('[%s %s] %s번 정답 이의', subject_name, exam_cohort, question_number),
        jsonb_build_object(
          'type', 'doc',
          'content', jsonb_build_array(jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(jsonb_build_object(
              'type', 'text',
              'text', '기준 답과 다른 풀이자 의견이 있습니다. 볼 수 있는 의견과 풀이를 함께 확인해주세요.'
            ))
          ))
        ),
        'open',
        true
      )
      on conflict (question_id) where is_auto_answer_dispute
      do update set
        category = '정답이의',
        title = excluded.title,
        content = excluded.content,
        status = 'open',
        updated_at = now();
    end if;
  else
    update public.discussions
       set category = '일반', status = 'resolved', updated_at = now()
     where question_id = p_question_id and is_auto_answer_dispute;
  end if;
end;
$$;

create or replace function public.sync_answer_dispute_discussion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_answer_dispute_discussion(new.id);
  return new;
end;
$$;

create or replace function public.sync_answer_opinion_discussion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_question_id uuid;
begin
  if tg_op = 'DELETE' then
    target_question_id := old.question_id;
  else
    target_question_id := new.question_id;
  end if;
  perform public.refresh_answer_dispute_discussion(target_question_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.refresh_answer_dispute_discussion(uuid) from public, anon, authenticated;
revoke all on function public.sync_answer_dispute_discussion() from public, anon, authenticated;
revoke all on function public.sync_answer_opinion_discussion() from public, anon, authenticated;

create trigger question_answer_opinions_sync_discussion
  after insert or update or delete on public.question_answer_opinions
  for each row execute function public.sync_answer_opinion_discussion();

drop policy if exists discussions_select on public.discussions;
create policy discussions_select on public.discussions
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.can_view_question(question_id)
      and (
        not is_auto_answer_dispute
        or public.can_view_answer_dispute(question_id)
      )
    )
  );

-- Child rows must not reveal a restricted automatic thread by id.
drop policy if exists discussion_replies_select on public.discussion_replies;
create policy discussion_replies_select on public.discussion_replies
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.discussions d where d.id = discussion_id)
  );

drop policy if exists discussion_replies_insert on public.discussion_replies;
create policy discussion_replies_insert on public.discussion_replies
  for insert to authenticated
  with check (
    public.can_write()
    and author_id = auth.uid()
    and exists (select 1 from public.discussions d where d.id = discussion_id)
  );

-- Re-evaluate all existing automatic threads under the combined rule.
select public.refresh_answer_dispute_discussion(q.id)
  from public.questions q
 where exists (
   select 1 from public.discussions d
    where d.question_id = q.id and d.is_auto_answer_dispute
 );
