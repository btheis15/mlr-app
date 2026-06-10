-- 0036_event_rsvp_notifications.sql
-- Optional notifications when a member RSVPs "going" to an event. Depends on
-- 0030 (notifications feed + _notify), 0034 (unified push), 0035 (event_attendance).
--
-- OPT-IN: 'event_rsvp' is a valid notif_types / push_types category, but it is NOT
-- in any default and is NOT backfilled — members turn it on themselves via the
-- "Event RSVPs" toggle in NotifPrefs (in-app feed) and/or PushToggle (phone push).
-- The whole resort can get noisy on a popular event, so off-by-default is the
-- right floor; a member who wants it opts in.
--
-- Audience when on: EVERYONE who opted in (minus the person who RSVP'd) — the
-- "the resort wants to know who's coming" shape, same as new_post.
--
-- Trigger policy: ONLY a fresh "going" — the first time a member's overall status
-- becomes 'going' for an event. Maybe / can't-make and later edits stay silent.
--
-- Why this lives in the RPC (not a trigger on event_attendance, like the other
-- feeds): the fan-out needs the event's TITLE, and attendance is keyed by a
-- stable TEXT event id that is a uuid for DB events but a SLUG for synthesized
-- seed events (Family Fest, the 4th) — which have no row in public.events to look
-- the title up from. set_event_attendance already runs as the definer and knows
-- both the client-supplied title and the prior status, so it does the fan-out.
--
-- Apply in the Supabase SQL editor after 0035.

-- ── set_event_attendance: upsert my RSVP + fan out a fresh "going" ───────────
-- Replaces the 0035 (text,text,jsonb) version with a 4-arg one that also takes
-- the event title (for the notification copy on seed events). The old 3-arg
-- function is dropped so PostgREST resolves the new overload unambiguously.
drop function if exists public.set_event_attendance(text, text, jsonb);

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

  -- Prior overall status (null if this member hasn't RSVP'd yet), so we only
  -- fan out the FIRST transition into 'going'.
  select status into v_prev
    from public.event_attendance
    where event_id = v_event and user_id = v_actor;

  insert into public.event_attendance (event_id, user_id, status, days)
  values (v_event, v_actor, p_status, p_days)
  on conflict (event_id, user_id)
  do update set status = excluded.status, days = excluded.days, updated_at = now();

  -- Notify the resort when someone newly marks themselves going. _notify skips
  -- the actor and respects each recipient's notif_types (so only opt-ins hear it).
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
