-- 0101_event_reminders.sql
-- Lets an admin attach one or more scheduled reminder notifications to an
-- event or a Home callout — e.g. "remind everyone 1 day before the Faire
-- sign-up deadline" or "2 hours before the work weekend starts". Reminders
-- are just rows in the existing scheduled_broadcasts queue (0097) — no new
-- delivery table — tagged with a `sourceType`/`sourceId`/`sourceLabel` in
-- `payload` so the event/callout editor can list "reminders for this item"
-- and the admin queue view can show what a reminder is for. That tagging is
-- opaque to `run_scheduled_broadcasts()`, which doesn't need to know it exists.
--
-- Two anchors gain an optional time-of-day to compute offsets ("N hours/days
-- before") from:
--   - events.start_time (time, optional) — a plain start_date has no time of
--     day today; setting this lets the reminder picker offer hour-based
--     offsets, not just day-based ones.
--   - home_callouts.deadline_at (timestamptz, optional) — a callout's
--     starts_on/ends_on are only a show/hide window, not a "due by" moment;
--     this is the actual deadline a reminder counts down to.
--
-- Also adds update_scheduled_broadcast() so a queued (not yet sent/cancelled)
-- item can be edited in place instead of cancel-and-recreate.

alter table public.events add column if not exists start_time time;

alter table public.home_callouts add column if not exists deadline_at timestamptz;

-- ── create_event()/update_event(): trailing p_start_time param ───────────────
-- CREATE OR REPLACE can add a new trailing-default param without a drop, same
-- as 0096's send_broadcast_notification — every existing caller is unaffected.
create or replace function public.create_event(
  p_title       text,
  p_start_date  date,
  p_end_date    date default null,
  p_kind        text default 'custom',
  p_emoji       text default null,
  p_location    text default null,
  p_description text default null,
  p_day_rsvp    boolean default false,
  p_start_time  time default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A title is required'; end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  insert into public.events (title, start_date, start_time, end_date, kind, emoji, location, description, day_rsvp, created_by)
  values (
    btrim(p_title), p_start_date, p_start_time, p_end_date,
    coalesce(nullif(p_kind, ''), 'custom'),
    nullif(btrim(coalesce(p_emoji, '')), ''),
    nullif(btrim(coalesce(p_location, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_day_rsvp, false),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_event(text, date, date, text, text, text, text, boolean, time) from public, anon;
grant execute on function public.create_event(text, date, date, text, text, text, text, boolean, time) to authenticated;

create or replace function public.update_event(
  p_id          uuid,
  p_title       text,
  p_start_date  date,
  p_end_date    date default null,
  p_kind        text default 'custom',
  p_emoji       text default null,
  p_location    text default null,
  p_description text default null,
  p_day_rsvp    boolean default false,
  p_start_time  time default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A title is required'; end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  update public.events set
    title       = btrim(p_title),
    start_date  = p_start_date,
    start_time  = p_start_time,
    end_date    = p_end_date,
    kind        = coalesce(nullif(p_kind, ''), 'custom'),
    emoji       = nullif(btrim(coalesce(p_emoji, '')), ''),
    location    = nullif(btrim(coalesce(p_location, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    day_rsvp    = coalesce(p_day_rsvp, false)
  where id = p_id;
  if not found then raise exception 'Event not found'; end if;
end;
$$;
revoke all on function public.update_event(uuid, text, date, date, text, text, text, text, boolean, time) from public, anon;
grant execute on function public.update_event(uuid, text, date, date, text, text, text, text, boolean, time) to authenticated;

-- ── update_scheduled_broadcast() — edit a still-pending queued item ──────────
-- Same validation as schedule_broadcast (0097): admin-only, non-empty title,
-- future send time. Refuses once the row has already fired or been cancelled
-- (edit a live/settled row makes no sense — cancel + recreate instead).
create or replace function public.update_scheduled_broadcast(
  p_id           uuid,
  p_payload      jsonb,
  p_scheduled_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_payload->>'title'), '') = '' then
    raise exception 'A title is required';
  end if;
  if p_scheduled_at <= now() then
    raise exception 'Scheduled time must be in the future';
  end if;

  update public.scheduled_broadcasts
    set payload = p_payload, scheduled_at = p_scheduled_at
    where id = p_id and sent_at is null and cancelled_at is null;
  if not found then
    raise exception 'That item has already gone out or been cancelled';
  end if;
end;
$$;
revoke all on function public.update_scheduled_broadcast(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.update_scheduled_broadcast(uuid, jsonb, timestamptz) to authenticated;
