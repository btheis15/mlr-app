-- 0110_schedule_activity_crew_self_edit.sql
-- Extends the dinner chef/crew self-edit pattern (migration 0099) to the two
-- other Family Fest content types that have a "who's responsible" concept:
--   • fest_schedule_items already has lead_user_id/lead_name/lead_phone (0053)
--     but no crew — add crew_user_ids so a lead can bring in helpers who can
--     also edit, same shape as fest_dinners.crew_user_ids.
--   • fest_activities ("Anytime all week") had NO lead/crew concept at all —
--     add the full lead_user_id/lead_name/lead_phone + crew_user_ids set,
--     mirroring fest_schedule_items.
-- Both get the same narrower self-edit UPDATE policy fest_dinners has,
-- layered on top of the existing blanket can_edit_fest() policy from 0053.

alter table public.fest_schedule_items
  add column if not exists crew_user_ids uuid[] not null default '{}';

drop policy if exists "fest_schedule_items: lead or crew self-edit" on public.fest_schedule_items;
create policy "fest_schedule_items: lead or crew self-edit" on public.fest_schedule_items for update
  using (lead_user_id = auth.uid() or auth.uid() = any(crew_user_ids))
  with check (lead_user_id = auth.uid() or auth.uid() = any(crew_user_ids));

alter table public.fest_activities
  add column if not exists lead_user_id uuid references public.profiles (id) on delete set null,
  add column if not exists lead_name text,
  add column if not exists lead_phone text,
  add column if not exists crew_user_ids uuid[] not null default '{}';

drop policy if exists "fest_activities: lead or crew self-edit" on public.fest_activities;
create policy "fest_activities: lead or crew self-edit" on public.fest_activities for update
  using (lead_user_id = auth.uid() or auth.uid() = any(crew_user_ids))
  with check (lead_user_id = auth.uid() or auth.uid() = any(crew_user_ids));
