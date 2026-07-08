-- 0078_fest_dues_per_day.sql
-- Marks which Family Fest dues tiers are billed PER DAY (e.g. "Adult - With
-- Food (Per day)") vs. a flat one-time/full-week amount.
--
-- The Pay screen's dues calculator (FestDuesCalculator) needs to know this to
-- multiply a per-day tier by a shared "how many days" count instead of
-- treating it like a flat per-person amount — see lib/types.ts DuesTier.perDay.
-- Backfills true for any existing tier whose label reads as a per-day rate
-- (matches the live "(Per day)" tiers already in the Planner); everything
-- else defaults false (flat/full-week), which is the safe default for new
-- tiers going forward too.
--
-- Idempotent: `add column if not exists` + a backfill that only touches rows
-- still at the default. Apply: paste into the Supabase SQL editor and Run.

alter table public.fest_dues
  add column if not exists per_day boolean not null default false;

update public.fest_dues
set per_day = true
where per_day = false
  and label ilike '%per day%';
