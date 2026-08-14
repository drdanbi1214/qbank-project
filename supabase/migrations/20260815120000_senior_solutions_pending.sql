-- 선배해설을 문제가 아직 없는 학번(예: 22학번)에 대해서도 미리 받아둘 수
-- 있게 한다. senior_solutions.question_id 는 questions(id)를 참조하는
-- not null 컬럼이라 문제가 없으면 그 테이블에 바로 못 넣는다. 대신 문제
-- 코드로 대기시켜두고, 나중에 그 코드에 해당하는 문제가 questions 에
-- 들어오는 순간 트리거가 자동으로 senior_solutions 로 옮긴다.
create table if not exists public.senior_solutions_pending (
  question_code text primary key,
  required_permission text not null default 'senior_solution_view'
    references public.access_permissions(key) on update cascade on delete restrict,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists senior_solutions_pending_set_updated_at on public.senior_solutions_pending;
create trigger senior_solutions_pending_set_updated_at
  before update on public.senior_solutions_pending
  for each row execute function public.set_updated_at();

alter table public.senior_solutions_pending enable row level security;

create policy "senior_solutions_pending_all" on public.senior_solutions_pending
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- questions 에 새 행이 들어올 때마다 문제 코드를 계산해 대기 중인 선배해설이
-- 있으면 senior_solutions 로 옮기고 대기열에서 지운다.
create or replace function public.promote_pending_senior_solution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
  pending public.senior_solutions_pending%rowtype;
begin
  code := public.question_code(new.*);
  if code is null then
    return new;
  end if;

  select * into pending from public.senior_solutions_pending where question_code = code;
  if found then
    insert into public.senior_solutions (question_id, required_permission, content)
    values (new.id, pending.required_permission, pending.content)
    on conflict (question_id) do nothing;
    delete from public.senior_solutions_pending where question_code = code;
  end if;

  return new;
end;
$$;

drop trigger if exists questions_promote_pending_senior_solution on public.questions;
create trigger questions_promote_pending_senior_solution
  after insert on public.questions
  for each row execute function public.promote_pending_senior_solution();
