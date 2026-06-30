-- Make the committee-roster ↔ account auto-link bulletproof in BOTH directions.
--
-- 0056 added a trigger on profiles.contact_email so that when someone verifies
-- with an email matching a roster fill-in, that slot's linked_user_id is stamped
-- (the fill-in upgrades to their real account — no duplicate). That covers the
-- main case: a new member signs up. But it only fires from the *profiles* side.
--
-- Two residual gaps, closed here:
--   1) Reverse direction. If an admin ADDS or EDITS a roster slot's email to one
--      that ALREADY has an account, nothing relinks it — 0056 only ran a one-time
--      backfill at migration time. Add a trigger on committee_roster.email that
--      links to a matching existing account on insert/update.
--   2) Whitespace. The 0056 match was lower(email) with no trim, so a stray
--      leading/trailing space on either side would silently miss. Trim both sides.
--
-- Email stays the single claim key (exact, case-insensitive, trimmed). The
-- profiles-side trigger keeps email authoritative (re-links if a member's email
-- changes); the new roster-side trigger only FILLS an empty link, so it never
-- clobbers an explicit admin link (RosterEditor's "pick a member" already sets
-- linked_user_id directly). Name matching stays display-only on the client and
-- is deliberately NOT used to stamp linked_user_id (too risky to grant chat /
-- membership on a fuzzy match).

-- ── profiles side: same behaviour as 0056, now trimming both emails ────────────
create or replace function public.link_committee_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_email is not null and length(trim(new.contact_email)) > 0 then
    update public.committee_roster r
       set linked_user_id = new.id, updated_at = now()
     where r.email is not null
       and lower(trim(r.email)) = lower(trim(new.contact_email))
       and r.linked_user_id is distinct from new.id;
  end if;
  return new;
end;
$$;

-- ── roster side: link a slot to an already-existing account on insert/edit ─────
-- Only fills when the slot isn't already linked, so it never overrides an
-- explicit admin link. Picks the earliest-joined matching account if (rarely)
-- more than one shares the email.
create or replace function public.link_committee_roster_from_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_id uuid;
begin
  if new.linked_user_id is null
     and new.email is not null
     and length(trim(new.email)) > 0 then
    select p.id into match_id
      from public.profiles p
     where p.contact_email is not null
       and lower(trim(p.contact_email)) = lower(trim(new.email))
     order by p.joined_at nulls last, p.id
     limit 1;
    if match_id is not null then
      new.linked_user_id := match_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists link_committee_roster_from_slot_trg on public.committee_roster;
create trigger link_committee_roster_from_slot_trg
  before insert or update of email, linked_user_id on public.committee_roster
  for each row execute function public.link_committee_roster_from_slot();

-- One-time backfill (idempotent): link any slot whose email already has an
-- account but isn't linked yet — now trim-tolerant.
update public.committee_roster r
   set linked_user_id = p.id, updated_at = now()
  from public.profiles p
 where r.email is not null
   and r.linked_user_id is null
   and lower(trim(p.contact_email)) = lower(trim(r.email));
