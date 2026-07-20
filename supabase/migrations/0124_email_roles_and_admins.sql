-- 0124_email_roles_and_admins.sql
-- Rounds out the People-page "Email members" tool (components/EmailMembers.tsx):
--   1. committee_member_recipients(cid) now also returns each person's `roles`
--      (their committee_members.areas — e.g. Family Fest's Meals / Entertainment
--      & Games / …). EmailMembersComposer already has a "By Role" picker that
--      lights up the moment a Recipient carries `roles` (see its `hasRoles`/
--      `roleOptions`) — it just had nothing to read yet for this pool. No new UI
--      needed: picking a role-based committee now offers "Everyone / By Role /
--      Pick specific" the same way CommitteeEmailMembers already does from the
--      committee detail page.
--   2. admin_recipients() — a new pool, "App Admins", open to any signed-in
--      member (same openness as directory_recipients/all_member_recipients;
--      admin emails aren't more sensitive than the rest of the member directory
--      those already expose).
--   3. The House pool piggybacks on the existing house_member_recipients(hid)
--      (migration 0123) — no SQL change needed there, just a client wire-up.
--
-- Apply: paste into the Supabase SQL editor and Run (after 0123).

-- Return type is growing a column, so the old signature has to go first.
drop function if exists public.committee_member_recipients(uuid);

create function public.committee_member_recipients(cid uuid)
returns table (id uuid, name text, email text, roles text[])
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email,
    case when coalesce(array_length(m.areas, 1), 0) = 0 then null else m.areas end as roles
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

-- Every app admin. Any signed-in member can pick this pool — reaching the
-- resort's admins with a question is useful for everyone, not just other
-- admins, and it discloses nothing the member directory doesn't already.
create or replace function public.admin_recipients()
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
    and p.is_admin
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$$;
revoke all on function public.admin_recipients() from public, anon;
grant execute on function public.admin_recipients() to authenticated;
