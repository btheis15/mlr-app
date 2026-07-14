-- 0089_cabin_editable_details.sql
-- Lets admins edit a cabin's own details instead of them being fixed at seed
-- time: bed_count (sleeping capacity, separate from room_count, so members can
-- tell if they'd be sharing a bed/room) and notes (a free-form heads-up, e.g.
-- "windows are in but not sealed yet — water isn't hooked up"). Also opens up
-- room_count/active editing, which the schema already supported but had no
-- write policy for — closing a cabin (active = false) takes it out of the
-- bookable list on /request-stay without touching its booking history.

alter table public.cabins
  add column if not exists bed_count int check (bed_count is null or bed_count >= 0),
  add column if not exists notes text;

drop policy if exists "cabins: admin write" on public.cabins;
create policy "cabins: admin write" on public.cabins for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
