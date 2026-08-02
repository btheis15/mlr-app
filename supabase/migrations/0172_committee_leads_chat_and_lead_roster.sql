-- 0172_committee_leads_chat_and_lead_roster.sql
--
-- Three related additions, from the request to (1) give each committee a
-- private "Leads" chat, (2) let a committee's leads manage its roster, and
-- (3) let a lead step themselves (or anyone) down as lead.
--
-- "Lead" here means the AREA lead — a committee_roster.roles[] entry ending in
-- " · Lead" (what the roster UI renders as a "Lead" badge and what
-- can_organize_meeting already keys on), NOT committee_members.role = 'Lead'.
-- committee_roster has been the source of truth for committee chat access since
-- migration 0057, so everything here keys off it.

-- ── 1. Is the caller an AREA lead of this committee? ──────────────────────────
-- True iff they hold ANY " · Lead" role in the committee's roster. It
-- DELIBERATELY does not include app admins: the Leads chat is for actual leads
-- only (explicit product decision — an admin who isn't a lead of the committee
-- is not in its Leads room), so the gate is strictly the roster suffix.
create or replace function public.is_committee_area_lead(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.committee_roster r
    join public.committees c on c.slug = r.committee_slug
    where c.id = cid
      and r.linked_user_id = auth.uid()
      and exists (
        select 1 from unnest(coalesce(r.roles, '{}'::text[])) role
        where role like '% · Lead'
      )
  );
$$;
revoke all on function public.is_committee_area_lead(uuid) from public, anon;
grant execute on function public.is_committee_area_lead(uuid) to authenticated;

-- Slug-keyed twin, for the committee_roster RLS policies below (which key on
-- committee_slug, not the committee id).
create or replace function public.is_committee_area_lead_slug(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.committee_roster r
    where r.committee_slug = p_slug
      and r.linked_user_id = auth.uid()
      and exists (
        select 1 from unnest(coalesce(r.roles, '{}'::text[])) role
        where role like '% · Lead'
      )
  );
$$;
revoke all on function public.is_committee_area_lead_slug(text) from public, anon;
grant execute on function public.is_committee_area_lead_slug(text) to authenticated;

-- ── 2. The "Leads" chat channel ──────────────────────────────────────────────
-- Recreated VERBATIM from migration 0063 (the current production definition —
-- per the 0160 lesson, never rebuild an RLS function from an older migration's
-- copy) with ONE branch layered on top: a reserved area value of 'Leads'
-- (case-insensitive) resolves to "is the caller an area lead of this committee?"
-- with NO admin override. The `not exists(... a real 'Leads' area ...)` guard
-- means that if an admin ever creates an actual role literally named "Leads",
-- this branch backs off and it behaves as an ordinary area — so the sentinel
-- can never hijack a real role, and we don't have to reserve the word in
-- add_/rename_committee_area. The Leads channel stores its messages in
-- committee_messages with area = 'Leads' (a value valid_committee_areas would
-- reject as a role, so nobody is ever assigned it).
create or replace function public.can_access_committee_area(cid uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when lower(p_area) = 'leads'
           and not exists (
             select 1
             from public.committee_areas ca
             join public.committees c on c.slug = ca.committee_slug
             where c.id = cid and lower(ca.area) = 'leads'
           )
        then public.is_committee_area_lead(cid)
      else
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
        or (
          exists (
            select 1
            from public.committee_roster r
            join public.committees c on c.slug = r.committee_slug
            where c.id = cid and r.linked_user_id = auth.uid()
          )
          and (
            p_area is null
            or exists (
              select 1
              from public.committee_roster r
              join public.committees c on c.slug = r.committee_slug
              where c.id = cid
                and r.linked_user_id = auth.uid()
                and (p_area = any(r.roles) or (p_area || ' · Lead') = any(r.roles))
            )
          )
        )
    end;
$$;

-- ── 3. Let a committee's AREA LEADS manage its roster (full control, scoped) ──
-- committee_roster already has an admin-only "committee_roster write" FOR ALL
-- policy (migration 0056). These three ADD leads as a second permissive writer
-- for their OWN committee only (Postgres ORs permissive policies per command),
-- so a lead can add/remove people, edit their details, assign areas, and
-- set/unset other leads (all via the existing direct-table writes in
-- lib/committeeRoster.ts) — but only within a committee they lead, never
-- cross-committee. Reads are unchanged (members-only, migration 0081). Admins
-- keep full control everywhere via the existing FOR ALL policy.
drop policy if exists "committee_roster lead insert" on public.committee_roster;
create policy "committee_roster lead insert" on public.committee_roster
  for insert to authenticated
  with check (public.is_committee_area_lead_slug(committee_slug));

drop policy if exists "committee_roster lead update" on public.committee_roster;
create policy "committee_roster lead update" on public.committee_roster
  for update to authenticated
  using (public.is_committee_area_lead_slug(committee_slug))
  with check (public.is_committee_area_lead_slug(committee_slug));

drop policy if exists "committee_roster lead delete" on public.committee_roster;
create policy "committee_roster lead delete" on public.committee_roster
  for delete to authenticated
  using (public.is_committee_area_lead_slug(committee_slug));
