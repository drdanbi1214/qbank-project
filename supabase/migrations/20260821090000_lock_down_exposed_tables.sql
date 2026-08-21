-- Three tables created through SQL were left in the exposed public schema
-- without RLS. PostgREST therefore allowed anon/authenticated roles to read
-- and mutate every row.
--
-- lecture metadata is exposed only through get_question_lecture_sources(),
-- which performs the question permission check. Import scripts use the
-- service_role and continue to bypass RLS as intended.

begin;

alter table public.lecture_sources enable row level security;
alter table public.question_lecture_sources enable row level security;
alter table public.senior_solutions_backup_20260816 enable row level security;

revoke all privileges on table public.lecture_sources
  from public, anon, authenticated;
revoke all privileges on table public.question_lecture_sources
  from public, anon, authenticated;
revoke all privileges on table public.senior_solutions_backup_20260816
  from public, anon, authenticated;

commit;
