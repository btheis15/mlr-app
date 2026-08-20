-- 0210_fix_rsvp_conflict_target.sql
-- ⚠️⚠️ INCIDENT: NOBODY COULD RSVP FOR THEMSELVES. Every "Going / Maybe /
-- Can't make" tap in the app answered "Couldn't save — try again", for every
-- member, on every event, from the moment 0196 was applied. A member worked
-- around it by opening "Add a person" and adding HIMSELF, which succeeded —
-- that asymmetry is the whole clue, and it points at the exact line below.
--
-- ── What broke ────────────────────────────────────────────────────────────────
-- 0196 replaced event_attendance's composite primary key (event_id, user_id)
-- with a surrogate `id` plus two PARTIAL unique indexes:
--
--   create unique index event_attendance_event_user_uidx
--     on public.event_attendance (event_id, user_id) where user_id is not null;
--
-- Postgres will only infer a PARTIAL index as an ON CONFLICT arbiter when the
-- statement repeats its predicate. A bare `on conflict (event_id, user_id)`
-- no longer matches anything, so it raises
--   42P10  there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
-- 0196 knew this — it says so in its own header — and fixed the conflict
-- target. It just fixed THE WRONG COPY of the function.
--
-- ── Why there were two copies ────────────────────────────────────────────────
-- 0035 created set_event_attendance(text, text, jsonb).
-- 0036 replaced it with a 4-arg (…, p_title) version that also fans out the
--      "X is going to <event>" notification, and DROPPED the 3-arg one
--      explicitly "so PostgREST resolves the new overload unambiguously".
-- 0122 then did `create or replace` on the 3-ARG signature to add
--      `confirmed = true`, resurrecting the overload 0036 had deliberately
--      removed — and its body has no notification fan-out.
-- 0196 recreated "from 0122's current production body", i.e. the 3-arg one,
--      and corrected the conflict target THERE.
--
-- The web app has always called this with 4 arguments (it passes p_title so a
-- seed event like Family Fest can be named in the notification), so every
-- browser RSVP resolved to 0036's 4-arg body — the one still carrying the bare
-- `on conflict (event_id, user_id)`. The fixed 3-arg copy was reachable only
-- from the iOS app, which sends 3 arguments, which is why iOS RSVP kept working
-- and nobody connected the two reports.
--
-- Two other consequences of the same split, fixed here:
--   • 0122's `confirmed = true` on re-RSVP never applied to a web RSVP at all
--     (it only ever landed in the 3-arg copy), so "hasn't confirmed" could
--     stick to somebody who HAD re-tapped their answer.
--   • iOS RSVPs have silently never fanned out an `event_rsvp` notification,
--     because the 3-arg body has no _notify block.
--
-- ── The fix ──────────────────────────────────────────────────────────────────
-- 1. The 4-arg function is the ONE canonical body: recreated verbatim from its
--    current production definition (the 0160 rule — never re-copy an older
--    migration's body) with exactly two changes: the conflict target now
--    repeats the index predicate, and the DO UPDATE stamps `confirmed = true`
--    (0122's intent, finally on the path that actually runs).
-- 2. The 3-arg signature is DROPPED, restoring 0036's deliberate one-function
--    state. Keeping both is not an option: with the 4-arg version's p_title
--    defaulted, BOTH are candidates for a 3-argument call, and Postgres refuses
--    it outright —
--      42725  function public.set_event_attendance(p_event => unknown,
--             p_status => unknown, p_days => jsonb) is not unique
--    (verified against production before this migration was written). That is
--    the shape the shipped iOS build sends, so iOS RSVP has been broken too
--    since 0122 resurrected the overload — by a different error, which is why
--    the two reports were never connected. With one function left, a 3-argument
--    call resolves to it through p_title's default and iOS additionally gains
--    the confirmed stamp and the RSVP notification it never had.
--    ⚠️ Never re-add an overload of this function. Add a defaulted parameter
--    to the one signature instead (the 0115 cabin / 0200 house-request rule).
-- 3. finalize_meeting_as_event() carried the identical broken conflict target
--    when copying date-poll votes into event_attendance, so turning a date poll
--    into a real Event has been failing the same way since 0196. Recreated
--    verbatim from its current production body with only that line changed.

-- ── 1. The canonical self-RSVP ───────────────────────────────────────────────
create or replace function public.set_event_attendance(
  p_event  text,
  p_status text,
  p_days   jsonb default null,
  p_title  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_event      text := btrim(p_event);
  v_prev       text;
  v_actor_name text;
  v_title      text;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  if coalesce(v_event, '') = '' then raise exception 'An event is required'; end if;
  if p_status not in ('going', 'maybe', 'not_going') then raise exception 'Invalid status'; end if;

  select status into v_prev
    from public.event_attendance
    where event_id = v_event and user_id = v_actor;

  -- ⚠️ The `where user_id is not null` is REQUIRED, not decoration: since 0196
  -- the only unique index on (event_id, user_id) is partial, and Postgres will
  -- not infer a partial index as an arbiter unless the statement repeats its
  -- predicate. Without it this raises 42P10 and the RSVP silently fails.
  insert into public.event_attendance (event_id, user_id, status, days)
  values (v_event, v_actor, p_status, p_days)
  on conflict (event_id, user_id) where user_id is not null
  do update set status = excluded.status, days = excluded.days, confirmed = true, updated_at = now();

  if p_status = 'going' and v_prev is distinct from 'going' then
    select coalesce(display_name, 'Someone') into v_actor_name
      from public.profiles where id = v_actor;
    v_title := coalesce(
      nullif(btrim(coalesce(p_title, '')), ''),
      (select title from public.events where id::text = v_event),
      'an event'
    );
    perform public._notify(
      p.id, 'event_rsvp', v_actor,
      v_actor_name || ' is going to ' || v_title, null,
      '/events', 'event', null, null)
    from public.profiles p
    where p.id <> v_actor and 'event_rsvp' = any(p.notif_types);
  end if;
end;
$$;
revoke all on function public.set_event_attendance(text, text, jsonb, text) from public, anon;
grant execute on function public.set_event_attendance(text, text, jsonb, text) to authenticated;

-- ── 2. Drop the stale 3-arg overload (see the header) ────────────────────────
-- Must come AFTER the create above: dropping first would leave a window with no
-- function at all for a 3-argument caller.
drop function if exists public.set_event_attendance(text, text, jsonb);

-- ── 3. Date poll → real Event: same broken arbiter ───────────────────────────
create or replace function public.finalize_meeting_as_event(
  p_meeting     uuid,
  p_slot        uuid,
  p_kind        text default 'work_weekend',
  p_title       text default null,
  p_description text default null,
  p_location    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m            public.meetings%rowtype;
  v_slot       public.meeting_slots%rowtype;
  v_title      text;
  v_start_date date;
  v_end_date   date;
  v_event_id   uuid;
  v_url        text;
  v_when       text;
  v_remind_at  timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'Meeting not found'; end if;
  if not (m.created_by = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)) then
    raise exception 'Not authorized';
  end if;

  select * into v_slot from public.meeting_slots where id = p_slot and meeting_id = p_meeting;
  if not found then raise exception 'That time option isn''t part of this meeting'; end if;

  v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''), m.title);
  v_start_date := (v_slot.starts_at at time zone 'America/Chicago')::date;
  v_end_date := case when v_slot.ends_at is not null
                  then (v_slot.ends_at at time zone 'America/Chicago')::date
                  else null end;

  insert into public.events
    (title, start_date, end_date, kind, location, description, source, source_meeting_id, created_by)
  values (
    v_title, v_start_date, v_end_date,
    coalesce(nullif(p_kind, ''), 'work_weekend'),
    nullif(btrim(coalesce(p_location, '')), ''),
    nullif(btrim(coalesce(p_description, m.description, '')), ''),
    'meeting', p_meeting, auth.uid()
  )
  returning id into v_event_id;

  -- Same partial-index arbiter as set_event_attendance above.
  insert into public.event_attendance (event_id, user_id, status, confirmed)
  select v_event_id::text, a.user_id,
         case a.status when 'yes' then 'going' else 'maybe' end,
         false
  from public.meeting_availability a
  where a.slot_id = p_slot and a.status in ('yes', 'if_need_be')
  on conflict (event_id, user_id) where user_id is not null do nothing;

  update public.meetings
     set status = 'scheduled',
         chosen_slot_id = p_slot,
         created_event_id = v_event_id,
         finalized_at = now(),
         finalized_by = auth.uid()
   where id = p_meeting;

  v_url := '/events?open=' || v_event_id;
  v_when := to_char(v_start_date, 'Dy Mon DD')
            || case when v_end_date is not null and v_end_date <> v_start_date
                 then ' – ' || to_char(v_end_date, 'Dy Mon DD') else '' end;
  perform public._notify_meeting_room(
    p_meeting, 'meeting_scheduled', auth.uid(),
    'Event created: ' || v_title, v_when, v_url
  );

  -- Auto-queue one "still coming?" reminder 14 days out (skipped if that's
  -- already in the past) — fully editable/cancelable afterward from the
  -- event's own Reminders section or Admin → Scheduled, same as any other
  -- reminder in this app.
  v_remind_at := ((v_start_date - 14)::text || ' 09:00')::timestamp at time zone 'America/Chicago';
  if v_remind_at > now() then
    insert into public.scheduled_broadcasts (kind, payload, scheduled_at, created_by)
    values (
      'notification',
      jsonb_build_object(
        'title', 'Still coming to ' || v_title || '?',
        'body', 'You said you might be available — tap to confirm you''re still in.',
        'url', v_url,
        'audience', 'everyone',
        'eventId', v_event_id::text,
        'onlyUnconfirmed', true,
        'sourceType', 'event',
        'sourceId', v_event_id::text,
        'sourceLabel', v_title
      ),
      v_remind_at,
      auth.uid()
    );
  end if;

  return v_event_id;
end;
$$;
revoke all on function public.finalize_meeting_as_event(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.finalize_meeting_as_event(uuid, uuid, text, text, text, text) to authenticated;
