-- 0058 committee_roster realtime
--
-- Membership moved to committee_roster (0057), and FeedView now subscribes to
-- it so the chat pills refresh live when someone is added/removed or their
-- roster row auto-links to an account on verify. postgres_changes only fires
-- for tables in the supabase_realtime publication, so register the table.
-- (The old committee_members listener was never published either, which is why
-- the pills never updated live before.) RLS read policy is `using (true)`, so
-- realtime can deliver to any signed-in member; no policy change needed.

do $$ begin
  alter publication supabase_realtime add table public.committee_roster;
exception when duplicate_object then null; end $$;
