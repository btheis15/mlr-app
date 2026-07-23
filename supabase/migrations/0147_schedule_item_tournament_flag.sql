-- 0147_schedule_item_tournament_flag.sql
-- A per-activity "this is a tournament" flag, so the 🏆 Tournament section only
-- appears on activities the organizer explicitly marks — chosen right in the
-- activity editor (the ScheduleSheet toggle), mirroring signup_enabled. Public-
-- read like the rest of fest_schedule_items, so guests see the section (with a
-- sign-in nudge) only on real tournament activities, and nothing on the others.
--
-- ⚠️ Run this BEFORE deploying the matching app build: the schedule read selects
-- this column, so the code expects it to exist.
--
-- Apply in the Supabase SQL editor after 0146.

alter table public.fest_schedule_items
  add column if not exists tournament_enabled boolean not null default false;
