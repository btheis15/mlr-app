-- 0221_work_item_completed_by_columns.sql
--
-- ⚠️ INCIDENT: NOBODY COULD CHECK OFF A WORK ITEM. Tapping the circle on the
-- Home Work Checklist ticked it, then silently un-ticked it (reported by Zack,
-- but it failed for every member, admins included).
--
-- Root cause: migration 0088 (which ADDS work_items.completed_by/completed_at)
-- never ran on production, but 0186 later recreated mark_work_item_done() with
-- a body that writes those columns. Every call therefore raised
--   42703 column "completed_by" of relation "work_items" does not exist
-- and the client reverted the optimistic tick without showing the error.
-- (The 7 items that ARE done were closed through update_work_item's edit sheet,
-- whose live body predates 0088 and never touches these columns.)
--
-- The permission rule itself was already right and is unchanged: any approved
-- signed-in member can check off an MLR item, and any member of the house can
-- check off a house item — not just its author or an admin.
--
-- This only adds the missing columns (idempotent — a no-op wherever 0088 did
-- run). No function is recreated: the live mark_work_item_done() is already
-- the correct 0186 body and starts working the moment the columns exist.

alter table public.work_items
  add column if not exists completed_by uuid references public.profiles (id) on delete set null,
  add column if not exists completed_at timestamptz;
