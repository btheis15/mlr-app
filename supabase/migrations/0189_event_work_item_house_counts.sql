-- 0189_event_work_item_house_counts.sql
-- An event's "Work items planned" list now groups items by scope (Around the
-- Resort vs. a specific house) — but a house-scoped work item is only VISIBLE
-- (RLS, 0066) to that house's members + admins, so a non-member's plain read
-- of event_work_items already silently drops those rows (fetchEventWorkItems'
-- `.filter(Boolean)`). That's correct for the item DETAILS, but leaves no way
-- to even show "MJT House has 2 items planned" without a SECURITY DEFINER
-- count that bypasses RLS — mirrors fest_schedule_signup_counts' shape
-- (0167): the aggregate is fine to reveal, the specifics aren't. Apply after
-- 0188.

create or replace function public.event_work_item_house_counts(p_event_id text)
returns table(house_id uuid, house_name text, house_emoji text, item_count integer)
language sql
security definer
set search_path = ''
as $$
  select h.id, h.name, h.emoji, count(*)::int
  from public.event_work_items ewi
  join public.work_items wi on wi.id = ewi.work_item_id
  join public.houses h on h.id = wi.house_id
  where ewi.event_id = p_event_id
  group by h.id, h.name, h.emoji;
$$;
revoke all on function public.event_work_item_house_counts(text) from public, anon;
grant execute on function public.event_work_item_house_counts(text) to authenticated;
