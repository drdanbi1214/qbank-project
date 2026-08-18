-- =============================================================================
-- 테마 ↔ 야마 역인덱스
--
-- 야마는 테마 본문(topics.content) 안에 yamaEmbed 노드로 박힌다. 본문이 정본이고
-- 이 표는 거기서 뽑아낸 파생 데이터다. 저장할 때마다 다시 만든다.
--
-- 그럼에도 표가 필요한 이유: "이 문제가 어느 테마에 속하나" 를 역방향으로 찾을
-- 때 모든 테마의 jsonb 본문을 뒤질 수는 없다. 5단계에서 문제 풀이 화면에 이론
-- 카드를 띄울 때 이 표를 탄다.
--
-- 손으로 편집하지 않는다. 본문에서 야마를 지웠는데 여기 행이 남으면, 그 문제를
-- 풀 때 있지도 않은 이론이 뜬다.
-- =============================================================================

create table if not exists public.topic_questions (
  topic_id    uuid not null references public.topics(id)    on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  -- 본문에서 몇 번째로 나오는지. 목록을 등장 순서대로 보여줄 때 쓴다.
  position    int  not null default 0,
  primary key (topic_id, question_id)
);

comment on table public.topic_questions is
  '테마 본문에 박힌 야마의 역인덱스. topics.content 에서 자동 추출하며 손으로 고치지 않는다.';

-- 문제 쪽에서 테마를 찾는 것이 주 용도라 이쪽에도 인덱스를 둔다.
create index if not exists topic_questions_question_idx
  on public.topic_questions (question_id);

alter table public.topic_questions enable row level security;

-- 부모 테마를 볼 수 있으면 이 표도 볼 수 있다.
drop policy if exists topic_questions_select on public.topic_questions;
create policy topic_questions_select on public.topic_questions
  for select to authenticated
  using (exists (
    select 1 from public.topics t
     where t.id = topic_questions.topic_id
       and public.can_edit_topic(t.required_permission)
  ));

drop policy if exists topic_questions_write on public.topic_questions;
create policy topic_questions_write on public.topic_questions
  for all to authenticated
  using (exists (
    select 1 from public.topics t
     where t.id = topic_questions.topic_id
       and public.can_edit_topic(t.required_permission)
  ))
  with check (exists (
    select 1 from public.topics t
     where t.id = topic_questions.topic_id
       and public.can_edit_topic(t.required_permission)
  ));
