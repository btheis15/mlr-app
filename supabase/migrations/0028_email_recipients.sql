-- 0028_email_recipients.sql
-- Recipient lists for the "Email members" tool (Profile → Admin tools, and the
-- per-committee panel). Each function returns name + a usable email: the
-- member's shared contact_email (migrations 0006/0007) when they've set one,
-- else the address they sign in with (auth.users.email). The fallback means the
-- blast still reaches members who blanked their contact field.
--
--   • all_member_recipients()          — APP ADMINS only → every member.
--   • committee_member_recipients(cid) — app admin OR that committee's Lead
--                                        (is_committee_lead, migration 0015) →
--                                        the committee's roster.
--
-- Reading auth.users needs SECURITY DEFINER, so the role check is baked into
-- each query (a non-authorized caller just gets an empty set — no leak — and the
-- UI gates the tool on top of that). Nothing is emailed server-side: the app
-- builds a `mailto:` from these and hands off to the admin's mail app.
--
-- Apply: paste into the Supabase SQL editor and Run.

-- Every member, app-admins only. contact_email → login email fallback.
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
  where exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$$;
revoke all on function public.all_member_recipients() from public, anon;
grant execute on function public.all_member_recipients() to authenticated;

-- One committee's roster — the app admin or that committee's Lead. Same email
-- rule. is_committee_lead(cid) is the gate (true for app admins too, per 0015).
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
  where public.is_committee_lead(cid)
    and m.committee_id = cid
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$$;
revoke all on function public.committee_member_recipients(uuid) from public, anon;
grant execute on function public.committee_member_recipients(uuid) to authenticated;
