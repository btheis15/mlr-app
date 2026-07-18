-- 0113_sync_fest_lead_names.sql
-- Keep the denormalized Family Fest lead/chef names in step with the profile.
--
-- The fest tables each carry a display-name SNAPSHOT alongside the real link:
--   fest_schedule_items.lead_name  ← lead_user_id
--   fest_activities.lead_name      ← lead_user_id
--   fest_dinners.chef_name         ← chef_user_id
-- The name is stamped when someone is assigned (from their display_name at that
-- moment) and the public cards (FestWeek "IN CHARGE", FestStatus, dinner detail)
-- render that stored copy. So when a member later renames themselves — e.g. a
-- brand-new member whose name was still the email prefix ("motu42") when they
-- were assigned, then set it to "Mikey 😀" — the schedule kept showing the old
-- snapshot even though "Edit event" resolved the live profile via *_user_id.
--
-- Fix, mirroring how a committee rename cascades through its denormalized copies
-- (0056 link trigger / 0112 rename_committee_area): a trigger on profiles that,
-- whenever display_name changes, rewrites the stored name on every fest row this
-- person leads/cooks (matched by *_user_id, never by the free-text name — an
-- account-less lead with no user id is left untouched). Plus a one-time backfill
-- so the names that already drifted are corrected now. Both apps read the same
-- columns, so this fixes web + iOS with no client changes.

create or replace function public.sync_fest_lead_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n text := nullif(btrim(new.display_name), '');
begin
  -- Only sync to a real, non-empty name. If a profile's display_name is somehow
  -- blank, keep the last-good snapshot rather than wiping the card to nothing.
  if n is null then
    return new;
  end if;

  update public.fest_schedule_items
     set lead_name = n
   where lead_user_id = new.id
     and lead_name is distinct from n;

  update public.fest_activities
     set lead_name = n
   where lead_user_id = new.id
     and lead_name is distinct from n;

  update public.fest_dinners
     set chef_name = n
   where chef_user_id = new.id
     and chef_name is distinct from n;

  return new;
end;
$$;

drop trigger if exists sync_fest_lead_names_trg on public.profiles;
create trigger sync_fest_lead_names_trg
  after update of display_name on public.profiles
  for each row execute function public.sync_fest_lead_names();

-- ── One-time backfill: correct names that already drifted from the profile ────
update public.fest_schedule_items s
   set lead_name = p.display_name
  from public.profiles p
 where s.lead_user_id = p.id
   and nullif(btrim(p.display_name), '') is not null
   and s.lead_name is distinct from p.display_name;

update public.fest_activities a
   set lead_name = p.display_name
  from public.profiles p
 where a.lead_user_id = p.id
   and nullif(btrim(p.display_name), '') is not null
   and a.lead_name is distinct from p.display_name;

update public.fest_dinners d
   set chef_name = p.display_name
  from public.profiles p
 where d.chef_user_id = p.id
   and nullif(btrim(p.display_name), '') is not null
   and d.chef_name is distinct from p.display_name;
