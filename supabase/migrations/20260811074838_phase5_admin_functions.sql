-- =============================================================================
-- Phase 5 관리자 기능
--   - 운영 통계 대시보드
--   - 편집 이력 되돌리기
--   - 사용자 목록 (이메일 포함, 관리자만)
--   - 신고 처리
--
-- 실제 적용본은 mcp apply_migration 으로 넣었고 이 파일은 그 사본이다.
-- =============================================================================

create or replace function public.get_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'members', (select count(*) from public.profiles),
    'pending_members', (select count(*) from public.profiles where is_suspended),
    'active_7d', (
      select count(distinct a.user_id) from public.attempts a
      where a.created_at > now() - interval '7 days'
    ),
    'questions', (select count(*) from public.questions),
    'published', (select count(*) from public.questions where status = 'published'),
    'unlabeled', (select count(*) from public.questions where unit_id is null),
    'unconfirmed_answers', (
      select count(*) from public.questions where answer_status <> 'confirmed'
    ),
    'incomplete', (select count(*) from public.questions where completeness <> 'complete'),
    'solutions', (select count(*) from public.solutions),
    'questions_without_solution', (
      select count(*) from public.questions q
      where q.status = 'published'
        and not exists (
          select 1 from public.solutions s
          where s.question_id = q.id
             or (q.group_id is not null and s.group_id = q.group_id)
        )
    ),
    'discussions', (select count(*) from public.discussions),
    'open_reports', (select count(*) from public.reports where status <> 'resolved'),
    'open_assignments', (select count(*) from public.assignments where status <> 'done'),
    'overdue_assignments', (
      select count(*) from public.assignments
      where status <> 'done' and due_date is not null and due_date < current_date
    ),
    'daily_active', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb)
      from (
        select
          (a.created_at at time zone 'Asia/Seoul')::date as day,
          count(distinct a.user_id)::int as users,
          count(*)::int as attempts
        from public.attempts a
        where a.created_at > now() - interval '14 days'
        group by 1
      ) d
    ),
    'hardest', (
      select coalesce(jsonb_agg(row_to_json(h)), '[]'::jsonb)
      from (
        select
          q.id as question_id,
          q.question_number,
          e.cohort,
          s.name as subject_name,
          count(*)::int as attempts,
          round(100.0 * count(*) filter (where a.is_correct) / count(*))::int as accuracy
        from public.attempts a
        join public.questions q on q.id = a.question_id
        join public.exams e on e.id = q.exam_id
        join public.subjects s on s.id = e.subject_id
        where a.is_active and a.is_correct is not null
        group by q.id, q.question_number, e.cohort, s.name
        having count(*) >= 3
        order by accuracy asc
        limit 10
      ) h
    )
  ) into result;

  return result;
end;
$$;

-- 편집 이력 되돌리기.
-- revisions.diff 의 before 값을 문제에 다시 써넣는다.
-- 되돌리는 것도 편집이라 트리거가 새 revision 을 또 남긴다.
create or replace function public.revert_question_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rev public.revisions;
  field text;
  before_value jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 되돌릴 수 있습니다.' using errcode = '42501';
  end if;

  select * into rev from public.revisions where id = p_revision_id;
  if not found or rev.entity_type <> 'question' then
    raise exception '되돌릴 수 있는 이력이 아닙니다.' using errcode = 'no_data_found';
  end if;

  for field, before_value in select key, value -> 'before' from jsonb_each(rev.diff) loop
    -- 컬럼마다 타입이 달라 개별로 처리한다. jsonb 를 그대로 넣을 수 없다.
    case field
      when 'unit_id' then
        update public.questions set unit_id = nullif(before_value #>> '{}', '')::uuid
         where id = rev.entity_id;
      when 'exam_id' then
        update public.questions set exam_id = (before_value #>> '{}')::uuid
         where id = rev.entity_id;
      when 'group_id' then
        update public.questions set group_id = nullif(before_value #>> '{}', '')::uuid
         where id = rev.entity_id;
      when 'set_id' then
        update public.questions set set_id = nullif(before_value #>> '{}', '')::uuid
         where id = rev.entity_id;
      when 'question_number' then
        update public.questions set question_number = (before_value #>> '{}')::int
         where id = rev.entity_id;
      when 'answer_count' then
        update public.questions set answer_count = (before_value #>> '{}')::int
         where id = rev.entity_id;
      when 'question_type' then
        update public.questions set question_type = before_value #>> '{}' where id = rev.entity_id;
      when 'answer_status' then
        update public.questions set answer_status = before_value #>> '{}' where id = rev.entity_id;
      when 'completeness' then
        update public.questions set completeness = before_value #>> '{}' where id = rev.entity_id;
      when 'status' then
        update public.questions set status = before_value #>> '{}' where id = rev.entity_id;
      when 'variant_type' then
        update public.questions set variant_type = before_value #>> '{}' where id = rev.entity_id;
      when 'professor' then
        update public.questions set professor = before_value #>> '{}' where id = rev.entity_id;
      when 'restorer_note' then
        update public.questions set restorer_note = before_value #>> '{}' where id = rev.entity_id;
      when 'answer_note' then
        update public.questions set answer_note = before_value #>> '{}' where id = rev.entity_id;
      when 'model_answer' then
        update public.questions set model_answer = before_value #>> '{}' where id = rev.entity_id;
      when 'editor_answer' then
        update public.questions
           set editor_answer = coalesce(
             (select array_agg(value::int) from jsonb_array_elements_text(before_value) as t(value)),
             '{}'::int[])
         where id = rev.entity_id;
      when 'yama_answer' then
        update public.questions
           set yama_answer = (
             select array_agg(value::int) from jsonb_array_elements_text(before_value) as t(value)
           )
         where id = rev.entity_id;
      when 'source_tags' then
        update public.questions
           set source_tags = coalesce(
             (select array_agg(value) from jsonb_array_elements_text(before_value) as t(value)),
             '{}'::text[])
         where id = rev.entity_id;
      when 'stem_blocks' then
        update public.questions set stem_blocks = before_value where id = rev.entity_id;
      when 'choices' then
        update public.questions set choices = before_value where id = rev.entity_id;
      when 'official_explanation' then
        update public.questions set official_explanation = before_value where id = rev.entity_id;
      when 'grading_points' then
        update public.questions set grading_points = before_value where id = rev.entity_id;
      else
        -- 알 수 없는 필드는 건드리지 않는다.
        null;
    end case;
  end loop;
end;
$$;

-- 사용자 목록 (관리자 전용). 활동량까지 묶어 한 번에 내려준다.
create or replace function public.admin_list_members()
returns table (
  id             uuid,
  email          text,
  display_name   text,
  role           text,
  is_suspended   boolean,
  created_at     timestamptz,
  attempt_count  int,
  solution_count int,
  last_active_at timestamptz
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
    p.role,
    p.is_suspended,
    p.created_at,
    (select count(*)::int from public.attempts a where a.user_id = p.id),
    (select count(*)::int from public.solutions s where s.author_id = p.id),
    (select max(a.created_at) from public.attempts a where a.user_id = p.id)
  from public.profiles p
  where public.is_admin()
  order by p.created_at
$$;

create or replace function public.admin_resolve_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용할 수 있습니다.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'in_progress', 'resolved') then
    raise exception '알 수 없는 상태입니다.' using errcode = 'check_violation';
  end if;

  update public.reports
     set status = p_status,
         handled_by = auth.uid()
   where id = p_report_id;
end;
$$;

revoke execute on function public.get_admin_stats() from public, anon;
revoke execute on function public.revert_question_revision(uuid) from public, anon;
revoke execute on function public.admin_list_members() from public, anon;
revoke execute on function public.admin_resolve_report(uuid, text) from public, anon;

grant execute on function public.get_admin_stats() to authenticated;
grant execute on function public.revert_question_revision(uuid) to authenticated;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;
