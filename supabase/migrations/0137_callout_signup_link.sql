-- Let a Home call-out point at a specific event's SIGN-UP (the limited sign-up
-- slots from migrations 0135/0136) — e.g. a work-weekend flyer whose button
-- takes people straight to "Ye Olde Family Faire" to grab a slot.
--
-- This is separate from the callout's existing `event_id` (migration 0096),
-- which links the card to a resort event only for *targeting* (hide it from
-- people who RSVP'd "can't make it"). A callout can do both at once: be linked
-- to Family Fest 2026 for targeting AND carry a button that redirects to a
-- signup-enabled schedule item's sign-up page.
--
-- `signup_item_id` is the fest_schedule_items id (text, not an FK — same as
-- `event_id`, so it tolerates the in-code seed ids too and never couples the
-- public home_callouts table to a fest_year-scoped fest table). The client
-- renders a "Sign up" button that deep-links to /family-fest/schedule/<id>,
-- where the event's ScheduleSignupSlots now render.
alter table public.home_callouts
  add column if not exists signup_item_id text;
