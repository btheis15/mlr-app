-- 0170_committee_areas_read_policy.sql
-- FIX: every role / subcommittee in the app was INVISIBLE to every client.
--
-- `committee_areas` (the per-committee role allow-list, created in 0073) had
-- **row level security ENABLED with ZERO policies** — the deny-all state. No
-- migration ever enabled it (0073 creates the table with no RLS clause at all
-- and 0081's lockdown header explicitly lists committee_areas as one of the
-- tables that STAYS public-read), so it was switched on out-of-band in the
-- Supabase dashboard — almost certainly in response to the Security Advisor's
-- "RLS disabled in public" warning, which flags the table but can't know the
-- app reads it anonymously.
--
-- Why it read as "adding a subcommittee does nothing":
--   • WRITES kept working — add_committee_area / rename / archive (0112) are all
--     SECURITY DEFINER, so they bypass RLS entirely. The row really landed.
--   • READS returned zero rows, with NO error — RLS filters rows, it doesn't
--     raise. So committeeAdmin.ts's fetchCommitteeAreas() got `[]` and every
--     surface treated the committee as having no roles.
--   • Nothing revealed the truth, because fetchCommitteeAreas() falls back to
--     the in-code FAMILY_FEST_AREAS seed on an empty result — so Family Fest
--     (the one committee anyone looks at) kept rendering its five roles from
--     hardcoded data and looked completely healthy. Every OTHER committee got
--     an empty list.
--   • Knock-on effect that made "how do I add people to a subcommittee?"
--     unanswerable: CommitteeMembers.tsx renders its per-member role picker
--     only when `areaOptions.length > 0`, and CommitteeJoin gates its area
--     picker the same way — so the assignment UI didn't exist on screen either.
--     One unreadable table silently removed the whole feature.
--
-- The fix is the policy that should have shipped with 0073. Read is PUBLIC by
-- design (the 0081 doctrine): these rows are role LABELS ONLY — a committee
-- slug and a role name, no PII, nothing member-specific — and committees
-- themselves are already public-read, so gating the labels behind sign-in would
-- only break the browse-first committee pages for guests.
--
-- Deliberately NO write policy: every write already goes through the admin-gated
-- SECURITY DEFINER RPCs in 0112 (add/rename/archive/restore_committee_area), so
-- leaving writes with no policy keeps direct table writes denied for anon AND
-- authenticated — strictly tighter than the pre-dashboard state, where RLS was
-- off and the broad table grants meant anyone could INSERT/UPDATE/DELETE rows
-- directly. That grant is still on the table; RLS is what makes it inert.
--
-- TAKEAWAY for anyone tempted to flip RLS on from the dashboard: enabling RLS
-- without adding a policy is not "securing" a table, it's silently deleting it
-- from the client's point of view — and a client-side seed/fallback (which this
-- codebase uses everywhere for graceful pre-migration degradation) will happily
-- disguise that as normal, empty-but-working behavior.

alter table public.committee_areas enable row level security;

drop policy if exists "committee_areas: public read" on public.committee_areas;
create policy "committee_areas: public read"
  on public.committee_areas
  for select
  using (true);
