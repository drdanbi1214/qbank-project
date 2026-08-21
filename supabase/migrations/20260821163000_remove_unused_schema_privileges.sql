-- The application has no anonymous data pages and never issues TRUNCATE,
-- REFERENCES or TRIGGER commands from a browser session. Remove those broad
-- Supabase defaults across the schema and make future objects private by
-- default so a newly added table/function is not accidentally exposed.

begin;

revoke all privileges on all tables in schema public from public, anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

commit;
