-- =============================================================================
-- 함수 및 트리거
--  - 추천수/댓글수 캐시 갱신
--  - 댓글 깊이 2단계 제한, 대댓글 달린 댓글 소프트 삭제
--  - 편집 이력(revisions) 자동 기록
--  - 배정 자동 완료
--  - 알림 생성
--  - 정답 비노출 처리 및 채점 RPC
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 표기 헬퍼: 정답 배열을 ①②③ 형태로 렌더링
-- -----------------------------------------------------------------------------
create or replace function public.circled_answer(a int[])
returns text
language sql
immutable
as $$
  select coalesce(
    string_agg(case when n between 1 and 20 then chr(9311 + n) else n::text end, '' order by ord),
    ''
  )
  from unnest(coalesce(a, '{}'::int[])) with ordinality as t(n, ord);
$$;

-- -----------------------------------------------------------------------------
-- 알림 생성 헬퍼
-- -----------------------------------------------------------------------------
create or replace function public.create_notification(
  p_user_id     uuid,
  p_type        text,
  p_actor_id    uuid,
  p_target_type text,
  p_target_id   uuid,
  p_message     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 본인 행위에는 알림을 만들지 않는다.
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;
  insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
  values (p_user_id, p_type, p_actor_id, p_target_type, p_target_id, p_message);
end;
$$;

-- -----------------------------------------------------------------------------
-- 추천수 캐시
-- -----------------------------------------------------------------------------
create or replace function public.sync_solution_upvote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.solution_id, old.solution_id);
begin
  update public.solutions s
     set upvote_count = (select count(*) from public.solution_upvotes u where u.solution_id = target)
   where s.id = target;
  return null;
end;
$$;

create trigger solution_upvotes_sync
  after insert or delete on public.solution_upvotes
  for each row execute function public.sync_solution_upvote_count();

create or replace function public.sync_discussion_upvote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.discussion_id, old.discussion_id);
begin
  update public.discussions d
     set upvote_count = (select count(*) from public.discussion_upvotes u where u.discussion_id = target)
   where d.id = target;
  return null;
end;
$$;

create trigger discussion_upvotes_sync
  after insert or delete on public.discussion_upvotes
  for each row execute function public.sync_discussion_upvote_count();

create or replace function public.sync_reply_upvote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.reply_id, old.reply_id);
begin
  update public.discussion_replies r
     set upvote_count = (select count(*) from public.reply_upvotes u where u.reply_id = target)
   where r.id = target;
  return null;
end;
$$;

create trigger reply_upvotes_sync
  after insert or delete on public.reply_upvotes
  for each row execute function public.sync_reply_upvote_count();

-- 댓글수 캐시. 삭제 표시된 댓글은 세지 않는다.
create or replace function public.sync_discussion_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.discussion_id, old.discussion_id);
begin
  update public.discussions d
     set reply_count = (
           select count(*) from public.discussion_replies r
            where r.discussion_id = target and r.is_deleted = false
         )
   where d.id = target;
  return null;
end;
$$;

create trigger discussion_replies_sync_count
  after insert or delete or update of is_deleted on public.discussion_replies
  for each row execute function public.sync_discussion_reply_count();

-- -----------------------------------------------------------------------------
-- 댓글 깊이 제한 (2단계까지만)
-- -----------------------------------------------------------------------------
create or replace function public.enforce_reply_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  grandparent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if tg_table_name = 'discussion_replies' then
    select parent_id into grandparent from public.discussion_replies where id = new.parent_id;
  else
    select parent_id into grandparent from public.inline_comments where id = new.parent_id;
  end if;

  if grandparent is not null then
    raise exception '댓글 깊이는 2단계까지만 허용됩니다. 멘션으로 답글을 남겨주세요.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger discussion_replies_depth
  before insert or update of parent_id on public.discussion_replies
  for each row execute function public.enforce_reply_depth();

create trigger inline_comments_depth
  before insert or update of parent_id on public.inline_comments
  for each row execute function public.enforce_reply_depth();

-- 대댓글이 달린 댓글은 물리삭제 대신 is_deleted 플래그로 전환한다.
-- 원글 자체가 삭제되어 연쇄삭제로 들어온 경우에는 그대로 물리삭제한다.
create or replace function public.soft_delete_reply_with_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.discussions where id = old.discussion_id) then
    return old;
  end if;

  if exists (select 1 from public.discussion_replies where parent_id = old.id) then
    update public.discussion_replies
       set is_deleted = true,
           content = '{}'::jsonb,
           updated_at = now()
     where id = old.id;
    return null;
  end if;

  return old;
end;
$$;

create trigger discussion_replies_soft_delete
  before delete on public.discussion_replies
  for each row execute function public.soft_delete_reply_with_children();

-- -----------------------------------------------------------------------------
-- 편집 이력 (revisions)
-- -----------------------------------------------------------------------------
create or replace function public.record_question_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  d jsonb := '{}'::jsonb;
  k text;
  parts text[] := '{}';
  tracked text[] := array[
    'exam_id', 'unit_id', 'question_number', 'question_type', 'set_id',
    'stem_blocks', 'choices', 'answer_count',
    'editor_answer', 'yama_answer', 'answer_status', 'answer_note',
    'official_explanation', 'model_answer', 'grading_points',
    'professor', 'restorer_note', 'source_tags', 'variant_type',
    'group_id', 'completeness', 'status'
  ];
  before_name text;
  after_name text;
begin
  foreach k in array tracked loop
    if (o -> k) is distinct from (n -> k) then
      d := d || jsonb_build_object(k, jsonb_build_object('before', o -> k, 'after', n -> k));
    end if;
  end loop;

  if d = '{}'::jsonb then
    return null;
  end if;

  if d ? 'unit_id' then
    select name into before_name from public.units where id = old.unit_id;
    select name into after_name from public.units where id = new.unit_id;
    parts := parts || format('단원 이동: %s → %s',
                             coalesce(before_name, '미분류'), coalesce(after_name, '미분류'));
  end if;

  if d ? 'editor_answer' then
    parts := parts || format('편집자답 변경 %s → %s',
                             public.circled_answer(old.editor_answer),
                             public.circled_answer(new.editor_answer));
  end if;

  if d ? 'answer_status' then
    parts := parts || format('정답 상태 변경 %s → %s', old.answer_status, new.answer_status);
  end if;

  if d ? 'stem_blocks' then parts := parts || '문제 본문 수정'::text; end if;
  if d ? 'choices'     then parts := parts || '보기 수정'::text; end if;
  if d ? 'group_id'    then parts := parts || '중복 그룹 변경'::text; end if;

  if array_length(parts, 1) is null then
    parts := array['문제 정보 수정'];
  end if;

  insert into public.revisions (entity_type, entity_id, editor_id, diff, change_summary)
  values ('question', new.id, coalesce(auth.uid(), new.updated_by), d, array_to_string(parts, ', '));

  return null;
end;
$$;

create trigger questions_record_revision
  after update on public.questions
  for each row execute function public.record_question_revision();

create or replace function public.record_solution_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb := '{}'::jsonb;
begin
  if (old.content is distinct from new.content) then
    d := d || jsonb_build_object('content', jsonb_build_object('before', old.content, 'after', new.content));
  end if;
  if (old."references" is distinct from new."references") then
    d := d || jsonb_build_object('references',
              jsonb_build_object('before', old."references", 'after', new."references"));
  end if;

  if d = '{}'::jsonb then
    return null;
  end if;

  insert into public.revisions (entity_type, entity_id, editor_id, diff, change_summary)
  values ('solution', new.id, coalesce(auth.uid(), new.author_id), d, '풀이 수정');

  return null;
end;
$$;

create trigger solutions_record_revision
  after update on public.solutions
  for each row execute function public.record_solution_revision();

-- 문제 수정자 기록
create or replace function public.stamp_question_editor()
returns trigger
language plpgsql
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger questions_stamp_editor
  before update on public.questions
  for each row execute function public.stamp_question_editor();

-- 풀이 본문이 바뀌면 edited_at 갱신 (하단 '수정됨' 표시용)
create or replace function public.stamp_solution_edited()
returns trigger
language plpgsql
as $$
begin
  if old.content is distinct from new.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger solutions_stamp_edited
  before update on public.solutions
  for each row execute function public.stamp_solution_edited();

-- -----------------------------------------------------------------------------
-- 배정 자동 완료 — 담당자가 해당 문제에 풀이를 쓰면 done 처리
-- -----------------------------------------------------------------------------
create or replace function public.complete_assignment_on_solution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assignments a
     set status = 'done',
         completed_at = now()
   where a.assignee_id = new.author_id
     and a.status <> 'done'
     and a.question_id in (
       select q.id from public.questions q
        where (new.question_id is not null and q.id = new.question_id)
           or (new.group_id is not null and q.group_id = new.group_id)
     );
  return null;
end;
$$;

create trigger solutions_complete_assignment
  after insert on public.solutions
  for each row execute function public.complete_assignment_on_solution();

-- -----------------------------------------------------------------------------
-- 알림 트리거
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_inline_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  solution_author uuid;
  parent_author   uuid;
begin
  select author_id into solution_author from public.solutions where id = new.solution_id;

  if new.parent_id is null then
    perform public.create_notification(
      solution_author, 'inline_comment', new.author_id, 'solution', new.solution_id,
      '작성하신 풀이에 코멘트가 달렸습니다.');
  else
    select author_id into parent_author from public.inline_comments where id = new.parent_id;
    perform public.create_notification(
      parent_author, 'comment_reply', new.author_id, 'solution', new.solution_id,
      '남기신 코멘트에 답글이 달렸습니다.');
  end if;
  return null;
end;
$$;

create trigger inline_comments_notify
  after insert on public.inline_comments
  for each row execute function public.notify_on_inline_comment();

create or replace function public.notify_on_inline_comment_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'open' and new.status = 'resolved' then
    perform public.create_notification(
      new.author_id, 'comment_resolved', new.resolved_by, 'solution', new.solution_id,
      '남기신 코멘트가 해결 처리되었습니다.');
  end if;
  return null;
end;
$$;

create trigger inline_comments_notify_resolved
  after update of status on public.inline_comments
  for each row execute function public.notify_on_inline_comment_resolved();

create or replace function public.notify_on_discussion_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  discussion_author uuid;
  parent_author     uuid;
  discussion_title  text;
begin
  select author_id, title into discussion_author, discussion_title
    from public.discussions where id = new.discussion_id;

  if new.parent_id is null then
    perform public.create_notification(
      discussion_author, 'discussion_reply', new.author_id, 'discussion', new.discussion_id,
      format('%s 글에 댓글이 달렸습니다.', discussion_title));
  else
    select author_id into parent_author from public.discussion_replies where id = new.parent_id;
    perform public.create_notification(
      parent_author, 'comment_reply', new.author_id, 'discussion', new.discussion_id,
      '남기신 댓글에 답글이 달렸습니다.');
  end if;
  return null;
end;
$$;

create trigger discussion_replies_notify
  after insert on public.discussion_replies
  for each row execute function public.notify_on_discussion_reply();

create or replace function public.notify_on_reply_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_accepted = false and new.is_accepted = true then
    perform public.create_notification(
      new.author_id, 'answer_accepted', auth.uid(), 'discussion', new.discussion_id,
      '작성하신 댓글이 답변으로 채택되었습니다.');
  end if;
  return null;
end;
$$;

create trigger discussion_replies_notify_accepted
  after update of is_accepted on public.discussion_replies
  for each row execute function public.notify_on_reply_accepted();

create or replace function public.notify_on_solution_upvote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  solution_author uuid;
begin
  select author_id into solution_author from public.solutions where id = new.solution_id;
  perform public.create_notification(
    solution_author, 'solution_upvote', new.user_id, 'solution', new.solution_id,
    '작성하신 풀이가 추천을 받았습니다.');
  return null;
end;
$$;

create trigger solution_upvotes_notify
  after insert on public.solution_upvotes
  for each row execute function public.notify_on_solution_upvote();

create or replace function public.notify_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.assignee_id, 'assignment', new.assigned_by, 'question', new.question_id,
    '새로운 풀이 작성 문제가 배정되었습니다.');
  return null;
end;
$$;

create trigger assignments_notify
  after insert on public.assignments
  for each row execute function public.notify_on_assignment();

create or replace function public.notify_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, actor_id, target_type, target_id, message)
  select p.id, 'announcement', new.author_id, 'announcement', new.id, new.title
    from public.profiles p
   where p.id <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000'::uuid);
  return null;
end;
$$;

create trigger announcements_notify
  after insert on public.announcements
  for each row execute function public.notify_on_announcement();
