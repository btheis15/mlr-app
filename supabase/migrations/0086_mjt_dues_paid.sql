-- 0086_mjt_dues_paid.sql
-- Lets an MJT House member mark themself "I've paid" for a given Family Fest
-- year's house dues (see components/MjtHouseDuesCard.tsx), so the card stops
-- prompting them once they have. A single nullable year column rather than a
-- payments table — this is one house's one seasonal reminder, not a ledger;
-- next year's dues naturally prompt again since the stored year won't match.
-- Same shape as profiles.willing_to_help (0037): a plain self-editable column,
-- gated by the existing "profiles: update own" RLS policy (0001) plus a
-- column-level grant (no new table/RLS needed).
--
-- Apply: paste into the Supabase SQL editor and Run.

alter table public.profiles
  add column if not exists mjt_dues_paid_year integer;

grant update (mjt_dues_paid_year) on public.profiles to authenticated;
