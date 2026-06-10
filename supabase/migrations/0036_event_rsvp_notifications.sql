-- 0036_event_rsvp_notifications.sql
-- Optional notifications when a member RSVPs "going" to an event. Depends on
-- 0030 (notifications feed + _notify), 0034 (unified push), 0035 (event_attendance).
--
-- Audience: EVERYONE (minus the person who RSVP'd) — the same "the whole resort
-- wants to know who's coming" shape as new_post. Gated per-recipient on
-- notif_types (in-app Activity feed) and, for a phone buzz, on push_types via the
-- mini's push-sender. So it's fully optional: a member turns it off in either
-- list and stops hearing about it.
--
-- Trigger policy: ONLY a fresh "going" — i.e. the first time a member's overall
-- status becomes 'going' for an event. Maybe / can't-make and later edits stay
-- silent, so the feed only carries the meaningful signal ("X is coming").
--
-- Why this lives in the RPC (not a trigger on event_attendance, like the other
-- feeds): the fan-out needs the event's TITLE, and attendance is keyed by a
-- stable TEXT event id that is a uuid for DB events but a SLUG for synthesized
-- seed events (Family Fest, the 4th) — which have no row in public.events to look
-- the title up from. set_event_attendance already runs as the definer and knows
-- both the client-supplied title and the prior status, so it does the fan-out.
--
-- Apply in the Supabase SQL editor after 0035.

-- ── notif_types: add 'event_rsvp' (default + backfill) ───────────────────────
-- New members get it on by default; existing members keep their current picks
-- but gain the new kind (opt-out), so the Activity feed shows RSVPs for everyone
-- until they turn it off — mirrors how 0033 added the cabin kinds.
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,cabin_request,cabin_decision,event_rsvp}';

update public.profiles
  set notif_types = array(
    select distinct e from unnest(notif_types || '{event_rsvp}'::text[]) e
  )
  where not (notif_types @> '{event_rsvp}'::text[]);

-- ── push_types: backfill 'event_rsvp' for members who already use push ───────
-- push_types is the phone-buzz list (0034). New members get the full set
-- (DEFAULT_PUSH_TYPES, client-side) on the first-run prompt; here we add the new
-- category to anyone who ALREADY has push on (non-empty), so existing users get
-- the buzz without re-toggling. Members with push off ('{}') are left alone.
update public.profiles
  set push_types = array(
    select distinct e from unnest(push_types || '{event_rsvp}'::text[]) e
  )
  where push_types <> '{}'
    and not (push_types @> '{event_rsvp}'::text[]);

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
  -- the actor and respects each recipient's notif_types.
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
