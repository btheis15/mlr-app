-- Unify "Anytime activities" and "Anytime events" into ONE concept: an anytime
-- schedule event (migration 0139's `anytime` flag). Existing activities (the
-- scavenger hunt, merch, kids' activities, …) are converted into anytime
-- `fest_schedule_items` so there's no separate type — same editor, same card,
-- and they're linkable from Home callouts like any other event.
--
-- The web app stops reading/creating `fest_activities` after this; we DON'T drop
-- the table or its rows, because the native iOS app still reads it for its own
-- "Anytime all week" section (web-now/iOS-later). Provenance columns make the
-- conversion idempotent and let a later pass reconcile iOS.

alter table public.fest_schedule_items   add column if not exists source_activity_id      uuid;
alter table public.fest_schedule_slots   add column if not exists source_activity_slot_id uuid;
alter table public.fest_schedule_signups add column if not exists source_activity_signup_id uuid;

-- ── 1. Each activity → an anytime event ──────────────────────────────────────
-- `day` is NOT NULL but ignored for anytime items, so we park it on current_date.
-- blurb + details fold into the event's single `description`.
insert into public.fest_schedule_items (
  fest_year, day, anytime, title, emoji, description, location, is_private,
  lead_user_id, lead_name, lead_phone, crew_user_ids, position,
  signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time,
  signup_end_time, signup_mode, signup_instructions, signup_fields,
  signup_reminder_minutes, source_activity_id)
select
  a.fest_year, current_date, true, a.title, a.emoji,
  nullif(concat_ws(E'\n\n', a.blurb, a.details), ''),
  a.location, false,
  a.lead_user_id, a.lead_name, a.lead_phone, coalesce(a.crew_user_ids, '{}'), a.position,
  a.signup_enabled, a.signup_capacity, a.signup_slot_minutes, a.signup_start_time,
  a.signup_end_time, coalesce(a.signup_mode, 'interval'), a.signup_instructions,
  coalesce(a.signup_fields, '[]'::jsonb), coalesce(a.signup_reminder_minutes, '{}'), a.id
from public.fest_activities a
where not exists (
  select 1 from public.fest_schedule_items i where i.source_activity_id = a.id
);

-- ── 2. Their explicit sign-up slots → schedule slots ─────────────────────────
insert into public.fest_schedule_slots (
  schedule_item_id, day, start_time, end_time, label, capacity, position, source_activity_slot_id)
select i.id, asl.day, asl.start_time, asl.end_time, asl.label, asl.capacity, asl.position, asl.id
from public.fest_activity_slots asl
join public.fest_schedule_items i on i.source_activity_id = asl.activity_id
where not exists (
  select 1 from public.fest_schedule_slots s where s.source_activity_slot_id = asl.id
);

-- ── 3. Their sign-ups → schedule sign-ups (remap slot_id via provenance) ─────
insert into public.fest_schedule_signups (
  schedule_item_id, slot_start, slot_id, user_id, name, added_by, fields, created_at, source_activity_signup_id)
select
  i.id, asg.slot_start, ns.id, asg.user_id, asg.name, asg.added_by,
  coalesce(asg.fields, '{}'::jsonb), asg.created_at, asg.id
from public.fest_activity_signups asg
join public.fest_schedule_items i on i.source_activity_id = asg.activity_id
left join public.fest_schedule_slots ns on ns.source_activity_slot_id = asg.slot_id
where not exists (
  select 1 from public.fest_schedule_signups s where s.source_activity_signup_id = asg.id
);
