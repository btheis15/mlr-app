-- 0125_committee_roster_to_family.sql
-- One person, one record: committee "Pending verification" people join the
-- Family roster automatically, and the Family roster becomes their master
-- record until they sign up.
--
-- Before this, an account-less person could exist in two disconnected places:
-- a committee_roster slot (added on a committee page, tagged "Pending
-- verification") and — only if an admin separately re-typed them — a
-- family_roster row (Admin → Members). Edits in one never reached the other.
-- Now:
--
--   1. Adding an email'd, account-less person to ANY committee roster also
--      puts them on the Family roster (if they're not already there), so the
--      admin can manage everything about them — house, phone, name, invite —
--      in one place. Their committee slot stays as a "manual add-in" and keeps
--      working exactly as before (roster emails, auto-link on signup, 0056/0060).
--   2. Editing a person's name/email/phone ON the Family roster cascades to
--      their account-less committee slots (matched by the old email), so the
--      two never drift apart. Email changes re-resolve the account link on the
--      committee side via the existing 0060 BEFORE trigger.
--   3. A one-time backfill sweeps everyone currently "Pending verification"
--      on a committee into the Family roster.
--
-- Nothing changes for slots already linked to a real account, and deleting a
-- Family-roster row still never touches committee slots or real accounts.
-- Apply in the Supabase SQL editor after 0124.

-- ── 1 · committee_roster → family_roster (auto-add on insert/update) ─────────
create or replace function public.family_from_committee_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only account-less people with a usable email belong on the family roster.
  if new.linked_user_id is not null
     or new.email is null or length(btrim(new.email)) = 0 then
    return new;
  end if;
  insert into public.family_roster (name, email, phone, updated_by)
  select coalesce(nullif(btrim(new.name), ''), split_part(btrim(new.email), '@', 1)),
         btrim(new.email),
         nullif(btrim(new.phone), ''),
         new.updated_by
  where not exists (
    select 1 from public.family_roster r
    where r.email is not null and lower(r.email) = lower(btrim(new.email))
  );
  return new;
end;
$$;

drop trigger if exists family_from_committee_roster_trg on public.committee_roster;
create trigger family_from_committee_roster_trg
  after insert or update of email, linked_user_id on public.committee_roster
  for each row execute function public.family_from_committee_roster();

-- ── 2 · family_roster edits cascade to account-less committee slots ──────────
create or replace function public.sync_committee_roster_from_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  slot record;
begin
  -- Only meaningful when the row had an email to match slots by, and only for
  -- slots that haven't linked to a real account (linked people are managed
  -- through their profile, which already syncs everywhere).
  if old.email is null or length(btrim(old.email)) = 0 then
    return new;
  end if;
  if new.name = old.name
     and coalesce(new.email, '') = coalesce(old.email, '')
     and coalesce(new.phone, '') = coalesce(old.phone, '') then
    return new;
  end if;

  for slot in
    select id, committee_slug from public.committee_roster r
    where r.linked_user_id is null
      and r.email is not null
      and lower(r.email) = lower(btrim(old.email))
  loop
    -- committee_roster has UNIQUE (committee_slug, name): keep the slot's old
    -- name if the new one would collide inside that committee.
    update public.committee_roster
       set email = nullif(btrim(new.email), ''),
           phone = nullif(btrim(new.phone), ''),
           name  = case
                     when exists (
                       select 1 from public.committee_roster c2
                       where c2.committee_slug = slot.committee_slug
                         and c2.id <> slot.id
                         and c2.name = btrim(new.name)
                     ) then name
                     else coalesce(nullif(btrim(new.name), ''), name)
                   end,
           updated_at = now(),
           updated_by = new.updated_by
     where id = slot.id;
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_committee_roster_from_family_trg on public.family_roster;
create trigger sync_committee_roster_from_family_trg
  after update of name, email, phone on public.family_roster
  for each row execute function public.sync_committee_roster_from_family();

-- ── 3 · Backfill: every current "Pending verification" person joins the roster ─
insert into public.family_roster (name, email, phone)
select distinct on (lower(btrim(cr.email)))
       coalesce(nullif(btrim(cr.name), ''), split_part(btrim(cr.email), '@', 1)),
       btrim(cr.email),
       nullif(btrim(cr.phone), '')
  from public.committee_roster cr
 where cr.linked_user_id is null
   and cr.email is not null
   and length(btrim(cr.email)) > 0
   and not exists (
     select 1 from public.family_roster r
     where r.email is not null and lower(r.email) = lower(btrim(cr.email))
   )
 order by lower(btrim(cr.email)), length(btrim(cr.name)) desc;
