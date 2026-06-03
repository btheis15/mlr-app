-- 0010_profiles_insert_guard.sql
-- Defense-in-depth. 0001 blocks clients from UPDATING is_admin (column-level
-- grant), but the INSERT policy wasn't column-restricted. The signup trigger
-- already pre-creates each profile row (so a re-insert hits the primary key,
-- and there's no delete policy to clear it), which makes this hard to exploit —
-- but to be airtight we also forbid a client from inserting a row that's
-- already flagged is_admin = true. The SECURITY DEFINER signup trigger bypasses
-- RLS and seeds is_admin = false, so it's unaffected.
--
-- Apply: paste into the Supabase SQL editor and Run.

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id and is_admin = false);
