-- Per-slot reminder push notifications for sign-ups (events + activities). The
-- creator of a signup-enabled event/activity chooses one or more lead times —
-- "15 minutes before", "1 hour before", "2 hours before", any minutes they want
-- — and everyone signed up for a slot gets an in-app + phone-push reminder that
-- long before THEIR slot starts.
--
-- Fires from a pg_cron tick (like run_scheduled_broadcasts, migration 0097), so
-- it works whether or not anyone has the app open. A reminder needs a real
-- date+time to count down to, so it only fires for slots that resolve to one:
-- an interval-mode SCHEDULE event's slot (its day + "HH:MM"), or any explicit
-- slot that has a day. Activity interval slots and day-less explicit slots have
-- no calendar moment, so they're simply skipped. Times are Central
-- (America/Chicago), matching the rest of the fest.

-- ── Creator-chosen lead times (minutes before the slot) ──────────────────────
alter table public.fest_schedule_items
  add column if not exists signup_reminder_minutes int[] not null default '{}';
alter table public.fest_activities
  add column if not exists signup_reminder_minutes int[] not null default '{}';

-- ── A new notification kind, on by default ───────────────────────────────────
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder}';
update public.profiles set notif_types = array_append(notif_types, 'signup_reminder')
  where not ('signup_reminder' = any(notif_types));

-- ── Ledger: which (signup, lead-time) reminders have already fired ───────────
-- signup ids are uuids (globally unique) across the two signup tables, so
-- (signup_id, minutes) is a sufficient key; `kind` is kept for readability.
create table if not exists public.fest_signup_reminders_sent (
  signup_id uuid not null,
  minutes   int  not null,
  kind      text not null,
  sent_at   timestamptz not null default now(),
  primary key (signup_id, minutes)
);
alter table public.fest_signup_reminders_sent enable row level security;
-- No policies: only the SECURITY DEFINER cron function (owner) touches this.

-- "in 15 minutes" / "in 1 hour" / "in 2 hours" / "in 1 day" — friendly lead-time.
create or replace function public._humanize_minutes(m int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when m % 1440 = 0 and m >= 1440 then 'in ' || (m / 1440) || case when m / 1440 = 1 then ' day' else ' days' end
    when m % 60 = 0 and m >= 60     then 'in ' || (m / 60)   || case when m / 60 = 1 then ' hour' else ' hours' end
    else 'in ' || m || ' minutes'
  end;
$$;

-- ── The pg_cron tick — fire any reminders now due ────────────────────────────
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

select cron.schedule('run-signup-reminders', '* * * * *', $$select public.run_signup_reminders();$$);
