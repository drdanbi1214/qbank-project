-- Run the feed view with the caller's permissions so the underlying
-- discussions/questions/exams RLS policies remain authoritative.

alter view public.discussions_feed set (security_invoker = true);
