-- Let a schedule event be "anytime" — not locked to a specific day — right from
-- the event editor, instead of forcing the creator over to the separate
-- "Anytime activities" section for the same effect.
--
-- Modeled as a boolean flag (not a nullable `day`) so the NOT NULL `day` column
-- and every date formatter that reads it stay safe: an anytime event still
-- carries a (default) day in the column, but the client ignores it and renders
-- the event in the "Anytime all week" group alongside activities.
alter table public.fest_schedule_items
  add column if not exists anytime boolean not null default false;
