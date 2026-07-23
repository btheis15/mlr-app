-- 0144 — cheap idle guard + supporting indexes for run_signup_reminders().
--
-- run_signup_reminders() runs on a pg_cron tick EVERY MINUTE (0140). As shipped
-- it always executes a 2-way UNION over every signup-enabled item's signups,
-- with two correlated aggregate subqueries per row and a per-row timezone cast —
-- regardless of whether any reminder is actually due. Family Fest is one week a
-- year, so ~51 weeks out of 52 there are ZERO signup-enabled items carrying
-- reminder lead times, yet the heavy CTE ran anyway, 1440 times a day, forever.
--
-- This migration:
--   1. Adds a cheap early-exit guard: if no item in either table is
--      signup-enabled AND has a non-empty reminder-minutes list, return before
--      touching the signups tables at all. Backed by the partial indexes below,
--      an idle tick is a near-empty index probe.
--   2. Adds a partial index on each parent table matching that predicate so the
--      guard's EXISTS check is instant.
--
-- The actual send path (the loop body) is UNCHANGED — this only skips work when
-- there is provably nothing to send.

create index if not exists fest_schedule_items_signup_reminders_idx
  on public.fest_schedule_items (id)
  where signup_enabled and coalesce(cardinality(signup_reminder_minutes), 0) > 0;

create index if not exists fest_activities_signup_reminders_idx
  on public.fest_activities (id)
  where signup_enabled and coalesce(cardinality(signup_reminder_minutes), 0) > 0;

create or replace function public.run_signup_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_when timestamptz;
  m      int;
begin
  -- Cheap idle-tick exit. If nothing is signup-enabled with a reminder lead time,
  -- there is nothing this tick could ever send — skip the heavy CTE entirely.
  if not exists (
    select 1 from public.fest_schedule_items
      where signup_enabled and coalesce(cardinality(signup_reminder_minutes), 0) > 0
  ) and not exists (
    select 1 from public.fest_activities
      where signup_enabled and coalesce(cardinality(signup_reminder_minutes), 0) > 0
  ) then
    return;
  end if;

  -- One unified pass over both signup flavors. Each row already resolves its
  -- slot's day + start time and its parent's title/reminder list. The recipient
  -- is the linked member (user_id) OR, for a free-text write-in row, whoever
  -- ADDED it (added_by) — so a coordinator who signed a guest up still gets the
  -- nudge. We keep rows that have SOMEONE to notify, a real day, and a lead time.
  for r in
    with sched as (
      select s.id as signup_id, 'schedule' as kind,
             coalesce(s.user_id, s.added_by) as recipient,
             (s.user_id is null) as is_write_in, s.name as who,
             i.title, i.signup_reminder_minutes as mins,
             coalesce(sl.day, i.day::text) as day,
             coalesce(sl.start_time, s.slot_start) as start_time,
             -- Everyone else sharing this same slot (family event — say who
             -- they're with). Just the names, linked or write-in; no field data.
             (select count(*) from public.fest_schedule_signups o
                where o.schedule_item_id = s.schedule_item_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_count,
             (select string_agg(o.name, ', ' order by o.created_at) from public.fest_schedule_signups o
                where o.schedule_item_id = s.schedule_item_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_names,
             '/family-fest/schedule/' || i.id::text as url
      from public.fest_schedule_signups s
      join public.fest_schedule_items i on i.id = s.schedule_item_id
      left join public.fest_schedule_slots sl on sl.id = s.slot_id
      where coalesce(s.user_id, s.added_by) is not null
        and i.signup_enabled
        and array_length(i.signup_reminder_minutes, 1) > 0
    ),
    act as (
      select s.id as signup_id, 'activity' as kind,
             coalesce(s.user_id, s.added_by) as recipient,
             (s.user_id is null) as is_write_in, s.name as who,
             a.title, a.signup_reminder_minutes as mins,
             sl.day as day,                        -- activities have no own day
             coalesce(sl.start_time, s.slot_start) as start_time,
             (select count(*) from public.fest_activity_signups o
                where o.activity_id = s.activity_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_count,
             (select string_agg(o.name, ', ' order by o.created_at) from public.fest_activity_signups o
                where o.activity_id = s.activity_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_names,
             '/family-fest' as url
      from public.fest_activity_signups s
      join public.fest_activities a on a.id = s.activity_id
      left join public.fest_activity_slots sl on sl.id = s.slot_id
      where coalesce(s.user_id, s.added_by) is not null
        and a.signup_enabled
        and array_length(a.signup_reminder_minutes, 1) > 0
    )
    select * from sched where day is not null and start_time is not null
    union all
    select * from act where day is not null and start_time is not null
  loop
    -- Resolve the slot's absolute instant (Central wall time → timestamptz).
    begin
      v_when := (r.day || ' ' || r.start_time)::timestamp at time zone 'America/Chicago';
    exception when others then
      continue; -- unparseable time on this row; skip it, don't sink the batch
    end;

    foreach m in array r.mins loop
      -- Due once: we've reached (slot - m minutes), the slot hasn't started yet,
      -- and we haven't already fired this (signup, m) pair.
      if now() >= v_when - make_interval(mins => m)
         and now() < v_when
         and not exists (
           select 1 from public.fest_signup_reminders_sent x
           where x.signup_id = r.signup_id and x.minutes = m
         )
      then
        begin
          perform public._notify(
            r.recipient, 'signup_reminder', null,
            'Sign-up reminder: ' || r.title,
            (case when r.is_write_in
              then r.who || '''s ' || r.title || ' time slot starts ' || public._humanize_minutes(m) || '.'
              else 'Your ' || r.title || ' time slot starts ' || public._humanize_minutes(m) || '.'
            end)
            -- Family event: list everyone in the same slot (names only) so they
            -- know who they're with. Skipped when they're the only one in it.
            || case when r.slot_count > 1 then ' In this slot: ' || r.slot_names || '.' else '' end,
            r.url, r.kind, r.signup_id, v_when + interval '1 hour');
          insert into public.fest_signup_reminders_sent (signup_id, minutes, kind)
          values (r.signup_id, m, r.kind)
          on conflict do nothing;
        exception when others then
          continue; -- a bad row shouldn't stop the rest
        end;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_signup_reminders() from public, anon, authenticated;
