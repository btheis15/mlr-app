-- 0059_help_work_item_followup.sql
-- Link an "Ask for Help" request to a Work Checklist task and schedule a
-- "did it get done?" follow-up.
--
-- When a requester links their help request to a work_items task, the app sets
-- work_item_id + followup_at (9 PM resort-local that day, or 8 AM next morning
-- if posted after 6 PM) and leaves followup_sent = false. The Mac-mini job
-- media-server/work-followup.js polls these columns (service_role): once
-- followup_at passes, if the linked task is still status='open' it pushes the
-- requester (APNs, category WORK_FOLLOWUP), then stamps followup_sent = true so
-- it never re-fires; an already-done task sends nothing but is still stamped.
--
-- NOTE: these columns were applied to the shared Supabase project directly; this
-- migration backfills the repo and is idempotent (safe to run anywhere — a no-op
-- where they already exist).

alter table public.help_requests
  add column if not exists work_item_id  uuid references public.work_items(id) on delete set null,
  add column if not exists followup_at   timestamptz,
  add column if not exists followup_sent boolean not null default false;

-- Cheap lookup for the poller: only rows still awaiting a follow-up.
create index if not exists help_requests_followup_idx
  on public.help_requests (followup_at)
  where work_item_id is not null and followup_sent = false;
