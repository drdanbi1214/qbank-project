-- These views are application read models. Supabase's default grants included
-- INSERT/UPDATE/DELETE, and questions_solve is automatically updatable. Writing
-- through it executes with the view owner's privileges and bypasses the base
-- table's can_write() RLS policy.

begin;

revoke all privileges on table public.questions_solve
  from public, anon, authenticated;
revoke all privileges on table public.discussions_feed
  from public, anon, authenticated;

grant select on table public.questions_solve to authenticated;
grant select on table public.discussions_feed to authenticated;

commit;
