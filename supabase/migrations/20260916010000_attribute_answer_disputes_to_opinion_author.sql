-- 답 의견 때문에 자동 생성된 정답이의 글은, 관리자 계정이 아니라 실제로
-- 기준 답과 다른 답을 처음 제기한 풀이자의 이름으로 보여 준다. Y답과 편집자답만
-- 서로 다른 기존 이의는 별도 풀이자 의견이 없으므로 기존 관리자 fallback을 유지한다.

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
    -- 여러 사람이 이의를 낸 경우에는 첫 이의 제기자를 스레드 작성자로 유지한다.
    select o.author_id
      into thread_author_id
      from public.question_answer_opinions o
     where o.question_id = p_question_id
       and public.answers_differ(o.answer, baseline)
     order by o.created_at, o.id
     limit 1;

    -- 풀이자 의견 없이 Y답과 편집자답만 충돌한 레거시 이의는 기존처럼 관리자 명의다.
    if thread_author_id is null then
      select p.id into thread_author_id
        from public.profiles p
       where p.role = 'admin'
       order by p.created_at, p.id
       limit 1;
    end if;

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
        author_id = excluded.author_id,
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

-- 새 규칙을 기존 자동 이의글에도 적용한다. 풀이자 이의가 없는 레거시 글의 작성자는
-- 바뀌지 않고, 의견 기반 자동 이의글만 해당 풀이자 명의로 교체된다.
select public.refresh_answer_dispute_discussion(d.question_id)
  from public.discussions d
 where d.is_auto_answer_dispute;
