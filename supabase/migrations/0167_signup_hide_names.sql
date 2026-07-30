-- "Hide who's signed up" for a schedule event's sign-ups — e.g. a variety-show
-- cast list the organizer wants to keep a surprise. Everyone still sees an
-- accurate headcount ("17 signed up"); individual names are visible only to
-- the event's organizer (the existing _can_manage_schedule_signups predicate
-- — can_edit_fest() OR this event's own lead/crew, migration 0135) and to a
-- person's own entry.
--
-- Schedule-events only, like signup_team_size (0143) / tournament_enabled
-- (0147) — fest_activities was retired on the web (0141) and isn't extended
-- here.

alter table public.fest_schedule_items
  add column if not exists signup_hide_names boolean not null default false;

-- Replace the blanket public-read policy: a signup row is always visible to
-- whoever signed up (or was added) — so a hidden roster still shows you your
-- own entry — and to everyone else only when the event isn't hiding names, or
-- the caller can manage this event's sign-ups.
drop policy if exists "fest_schedule_signups: public read" on public.fest_schedule_signups;
create policy "fest_schedule_signups: read" on public.fest_schedule_signups
  for select
  using (
    user_id = auth.uid()
    or added_by = auth.uid()
    or exists (
      select 1 from public.fest_schedule_items i
      where i.id = fest_schedule_signups.schedule_item_id
        and (not i.signup_hide_names or public._can_manage_schedule_signups(i))
    )
  );

-- A plain, accurate per-slot headcount that bypasses the row-level hide above
-- (SECURITY DEFINER) — so a member who can't see names still sees a real
-- count instead of an undercount from only their own visible row(s).
create or replace function public.fest_schedule_signup_counts(p_item uuid)
returns table(slot_start text, slot_id uuid, cnt bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.slot_start, s.slot_id, count(*)::bigint
  from public.fest_schedule_signups s
  where s.schedule_item_id = p_item
  group by s.slot_start, s.slot_id;
$$;
revoke all on function public.fest_schedule_signup_counts(uuid) from public, anon;
grant execute on function public.fest_schedule_signup_counts(uuid) to authenticated;
