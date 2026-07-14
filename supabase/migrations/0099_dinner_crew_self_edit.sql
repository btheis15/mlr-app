-- 0099_dinner_crew_self_edit.sql
-- Lets a dinner's head chef AND any crew members assigned to that day edit
-- that dinner's operational details (menu/served/prep) directly — without
-- needing Family Fest committee/admin access (can_edit_fest()), which today
-- is the ONLY way to write to fest_dinners. `chef_user_id` was already a real
-- FK to profiles; `crew_user_ids` is new — a plain array (mirrors the
-- existing `houses text[]` column on this same table) rather than a join
-- table, since it's just a small assignment list, not something that needs
-- its own relational history.
--
-- This is a second, narrower UPDATE policy layered on top of the existing
-- blanket "fest_dinners write" (can_edit_fest()) policy from 0053 — Postgres
-- OR's multiple permissive policies together for the same command, so this
-- composes without touching that one. It's UPDATE-only (not ALL): a chef/crew
-- member can edit an existing dinner's row, but can't insert a new one or
-- delete this one — that stays admin/committee-only.

alter table public.fest_dinners
  add column if not exists crew_user_ids uuid[] not null default '{}';

drop policy if exists "fest_dinners: chef or crew self-edit" on public.fest_dinners;
create policy "fest_dinners: chef or crew self-edit" on public.fest_dinners for update
  using (chef_user_id = auth.uid() or auth.uid() = any(crew_user_ids))
  with check (chef_user_id = auth.uid() or auth.uid() = any(crew_user_ids));
