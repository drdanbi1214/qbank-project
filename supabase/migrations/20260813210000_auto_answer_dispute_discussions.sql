-- Y답과 편집자답이 모두 입력되어 있고 서로 다른 공개 문제는 정답이의 게시판에 자동 스레드를 만든다.
-- 복수정답 배열의 순서는 의미가 없으므로 포함 원소가 같으면 같은 답으로 본다.
create or replace function public.answers_differ(editor_answer int[], yama_answer int[])
returns boolean
language sql
immutable
as $$
  select coalesce(cardinality(editor_answer), 0) > 0
    and coalesce(cardinality(yama_answer), 0) > 0
    and not (
      editor_answer @> yama_answer
      and editor_answer <@ yama_answer
    );
$$;

alter table public.discussions
  add column if not exists is_auto_answer_dispute boolean not null default false;

create unique index if not exists discussions_auto_answer_dispute_question_idx
  on public.discussions (question_id)
  where is_auto_answer_dispute;

create or replace function public.sync_answer_dispute_discussion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_author_id uuid;
  subject_name text;
  exam_cohort text;
begin
  select p.id into thread_author_id
    from public.profiles p
   where p.role = 'admin'
   order by p.created_at, p.id
   limit 1;

  thread_author_id := coalesce(thread_author_id, new.updated_by, new.created_by);

  if new.status = 'published'
     and public.answers_differ(new.editor_answer, new.yama_answer)
     and thread_author_id is not null then
    select s.name, e.cohort into subject_name, exam_cohort
      from public.exams e
      join public.subjects s on s.id = e.subject_id
     where e.id = new.exam_id;

    insert into public.discussions (
      question_id,
      author_id,
      category,
      title,
      content,
      status,
      is_auto_answer_dispute
    ) values (
      new.id,
      thread_author_id,
      '정답이의',
      format('[%s %s] %s번 정답 이의', subject_name, exam_cohort, new.question_number),
      jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object(
            'type', 'text',
            'text', 'Y답과 편집자답이 서로 다른 문제입니다. 의견을 댓글로 남겨주세요.'
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
      status = 'open',
      updated_at = now();
  else
    -- 답이 같아져도 기존 댓글은 보존하고 정답이의 목록에서만 제외한다.
    update public.discussions
       set category = '일반',
           status = 'resolved',
           updated_at = now()
     where question_id = new.id
       and is_auto_answer_dispute;
  end if;

  return new;
end;
$$;

drop trigger if exists questions_sync_answer_dispute_discussion on public.questions;
create trigger questions_sync_answer_dispute_discussion
  after insert or update of editor_answer, yama_answer, status, exam_id, question_number
  on public.questions
  for each row execute function public.sync_answer_dispute_discussion();

-- 기존 문제도 같은 규칙으로 한 번에 채운다.
insert into public.discussions (
  question_id,
  author_id,
  category,
  title,
  content,
  status,
  created_at,
  is_auto_answer_dispute
)
select
  q.id,
  coalesce(
    (select p.id from public.profiles p where p.role = 'admin' order by p.created_at, p.id limit 1),
    q.updated_by,
    q.created_by
  ),
  '정답이의',
  format('[%s %s] %s번 정답 이의', s.name, e.cohort, q.question_number),
  jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(jsonb_build_object(
      'type', 'paragraph',
      'content', jsonb_build_array(jsonb_build_object(
        'type', 'text',
        'text', 'Y답과 편집자답이 서로 다른 문제입니다. 의견을 댓글로 남겨주세요.'
      ))
    ))
  ),
  'open',
  q.updated_at,
  true
from public.questions q
join public.exams e on e.id = q.exam_id
join public.subjects s on s.id = e.subject_id
where q.status = 'published'
  and public.answers_differ(q.editor_answer, q.yama_answer)
  and coalesce(
    (select p.id from public.profiles p where p.role = 'admin' order by p.created_at, p.id limit 1),
    q.updated_by,
    q.created_by
  ) is not null
on conflict (question_id) where is_auto_answer_dispute
do update set
  category = '정답이의',
  title = excluded.title,
  status = 'open';
