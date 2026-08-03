-- 0177_committee_level_leads.sql
--
-- Committee-LEVEL leads, independent of subcommittees.
--
-- Migration 0172 (committee_leads_chat_and_lead_roster) gave every committee a
-- private "Leads" chat and let leads run the roster — but it defined "lead"
-- ONLY as an AREA lead (a committee_roster.roles[] entry ending in " · Lead").
-- A committee with NO subcommittees/roles (e.g. Resort Maintenance) therefore
-- has no possible leads and an unreachable Leads chat. This adds a
-- committee-level lead marker so a committee can name as many leads as it likes
-- with no subcommittee required, and folds it into every place "lead" is decided
-- so the SAME private Leads chat, scoped roster control, and (via the mini's
-- senders) notifications all light up for it.
--
-- Builds on 0172's objects (already live in prod). is_committee_lead inlines
-- both checks so it has no function dependency of its own; can_access_committee_area
-- is recreated verbatim from its current 0172 form with a single swap.

-- ── 1. The committee-level lead marker ───────────────────────────────────────
-- A roster entry flagged is_lead is a lead of the WHOLE committee, regardless of
-- (and not requiring) any area role. Additive, defaults false, so every existing
-- row is unaffected and any committee starts with zero leads until one is named.
alter table public.committee_roster
  add column if not exists is_lead boolean not null default false;

-- ── 2. "Is the caller a lead of this committee?" (area OR committee-level) ────
-- Unifies the two notions of lead: holds any " · Lead" area role, OR is flagged
-- is_lead. Like 0172's is_committee_area_lead it DELIBERATELY excludes app admins
-- (the Leads chat is for actual leads only — an admin who isn't a lead of the
-- committee is not in its Leads room). Inlined, so it needs no other function.
create or replace function public.is_committee_lead(cid uuid)
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
      and (
        r.is_lead
        or exists (
          select 1 from unnest(coalesce(r.roles, '{}'::text[])) role
          where role like '% · Lead'
        )
      )
  );
$$;
revoke all on function public.is_committee_lead(uuid) from public, anon;
grant execute on function public.is_committee_lead(uuid) to authenticated;

-- Slug-keyed twin, for the committee_roster RLS policies below (keyed on slug).
create or replace function public.is_committee_lead_slug(p_slug text)
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
      and (
        r.is_lead
        or exists (
          select 1 from unnest(coalesce(r.roles, '{}'::text[])) role
          where role like '% · Lead'
        )
      )
  );
$$;
revoke all on function public.is_committee_lead_slug(text) from public, anon;
grant execute on function public.is_committee_lead_slug(text) to authenticated;

-- ── 3. Point the Leads-chat gate at the unified check ────────────────────────
-- Recreated VERBATIM from 0172's can_access_committee_area (itself 0063 + the
-- 'leads' branch) with ONE change: the 'leads' branch resolves to
-- is_committee_lead(cid) instead of is_committee_area_lead(cid). Everything else
-- is byte-for-byte identical (the 0160/0172 "recreate from the current
-- production form, never an older copy" rule). So a committee-level lead now
-- enters the private Leads room even with zero subcommittees, while area leads
-- keep their access exactly as before.
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
        then public.is_committee_lead(cid)
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

-- ── 4. Widen scoped roster control to committee-level leads ──────────────────
-- 0172 let AREA leads manage their committee's roster (three permissive policies
-- gated on is_committee_area_lead_slug, OR-ing onto the 0056 admin FOR ALL).
-- Repoint them at is_committee_lead_slug so committee-level leads have the same
-- scoped control — including appointing or removing OTHER leads (setting is_lead
-- or a " · Lead" role) within their OWN committee, never cross-committee. Admins
-- keep full control everywhere via the existing 0056 policy.
drop policy if exists "committee_roster lead insert" on public.committee_roster;
create policy "committee_roster lead insert" on public.committee_roster
  for insert to authenticated
  with check (public.is_committee_lead_slug(committee_slug));

drop policy if exists "committee_roster lead update" on public.committee_roster;
create policy "committee_roster lead update" on public.committee_roster
  for update to authenticated
  using (public.is_committee_lead_slug(committee_slug))
  with check (public.is_committee_lead_slug(committee_slug));

drop policy if exists "committee_roster lead delete" on public.committee_roster;
create policy "committee_roster lead delete" on public.committee_roster
  for delete to authenticated
  using (public.is_committee_lead_slug(committee_slug));
