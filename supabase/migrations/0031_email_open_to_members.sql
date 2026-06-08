-- 0031_email_open_to_members.sql
-- Open the "Email members" tool up beyond admins (it was App-Admin / Lead only
-- in 0028). New access model:
--   • Custom hand-picked list — ANY signed-in member, via the new
--     directory_recipients() (the whole member directory, to pick from).
--   • A committee's roster — ANY member of THAT committee (was: its Lead/admin),
--     via committee_member_recipients(cid) re-gated to is_committee_member().
--   • Everyone (all members) — App Admin OR anyone who's in ANY committee, via
--     all_member_recipients() with the widened gate. This keeps the one-tap
--     "email everyone" to people who've shown they're involved.
--
-- Same email rule as 0028: each row is the member's shared contact_email
-- (0006/0007) when set, else their login email (auth.users) so the message still
-- reaches them. Reading auth.users needs SECURITY DEFINER; the access check is
-- baked into each query (an unauthorized caller just gets an empty set).
--
-- Privacy note: directory_recipients() lets any signed-in member see every
-- member's best email — consistent with the app's model (contact info is already
-- shared between members via the member card). Nothing is emailed server-side:
-- the app builds a `mailto:` and hands off to the member's own mail app.
--
-- Apply: paste into the Supabase SQL editor and Run (after 0028).

-- Whole member directory — ANY signed-in member (to hand-pick a custom list).
create or replace function public.directory_recipients()
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where auth.uid() is not null
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$$;
revoke all on function public.directory_recipients() from public, anon;
grant execute on function public.directory_recipients() to authenticated;

-- Every member — now App Admin OR anyone in ANY committee (was admin-only).
create or replace function public.all_member_recipients()
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where (
      exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
      or exists (select 1 from public.committee_members cm where cm.user_id = auth.uid())
    )
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$$;
revoke all on function public.all_member_recipients() from public, anon;
grant execute on function public.all_member_recipients() to authenticated;

-- One committee's roster — now ANY member of that committee (was its Lead/admin).
-- is_committee_member(cid) is true for that committee's members AND app admins.
create or replace function public.committee_member_recipients(cid uuid)
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.committee_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = p.id
  where public.is_committee_member(cid)
    and m.committee_id = cid
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$$;
revoke all on function public.committee_member_recipients(uuid) from public, anon;
grant execute on function public.committee_member_recipients(uuid) to authenticated;
