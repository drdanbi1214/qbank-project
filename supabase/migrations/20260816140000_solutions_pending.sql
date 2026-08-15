-- 일반 풀이도 문제가 아직 없는 학번에 대해 미리 받아둘 수 있게 한다.
--
-- 선배해설은 senior_solutions_pending 으로 이미 이렇게 하고 있다. 같은
-- 필요가 스터디 그룹 풀이에도 생겼다(네잎클로버가 19·20학번 문제 풀이를
-- 먼저 넘겨줬는데 그 시험은 아직 등록 전이다).
--
-- 선배해설과 달리 한 문제에 풀이가 여러 개 달릴 수 있으므로 question_code
-- 를 기본키로 쓰지 않고, 작성자·공개범위까지 함께 대기시킨다.
create table if not exists public.solutions_pending (
  id            uuid primary key default gen_random_uuid(),
  question_code text not null,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  required_permission text
    references public.access_permissions(key) on update cascade on delete restrict,
  content       jsonb not null,
  "references"  jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists solutions_pending_code_idx
  on public.solutions_pending (question_code);

drop trigger if exists solutions_pending_set_updated_at on public.solutions_pending;
create trigger solutions_pending_set_updated_at
  before update on public.solutions_pending
  for each row execute function public.set_updated_at();

alter table public.solutions_pending enable row level security;

create policy "solutions_pending_all" on public.solutions_pending
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- questions 에 행이 들어오면 그 코드로 대기 중인 풀이를 전부 옮긴다.
create or replace function public.promote_pending_solutions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  code := public.question_code(new.*);
  if code is null then
    return new;
  end if;

  insert into public.solutions (question_id, author_id, required_permission, content, "references")
  select new.id, p.author_id, p.required_permission, p.content, p."references"
    from public.solutions_pending p
   where p.question_code = code;

  delete from public.solutions_pending where question_code = code;
  return new;
end;
$$;

drop trigger if exists questions_promote_pending_solutions on public.questions;
create trigger questions_promote_pending_solutions
  after insert on public.questions
  for each row execute function public.promote_pending_solutions();
