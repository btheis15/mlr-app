-- 0122_family_meetings_to_events.sql
-- Two extensions to the meeting scheduler (0116) requested together:
--
-- 1. A THIRD scope, 'family' — a poll open to every signed-in member, not
--    just one committee/house room (e.g. "which weekend for the Work
--    Weekend?"). Organizing one is app-admin-only (no Lead-equivalent for
--    "everyone"); this falls out of can_organize_meeting for free — it
--    already checks is_admin unconditionally before the committee-Lead
--    branch, so a 'family' scope with no matching branch is admin-only with
--    zero code change to that function.
--
-- 2. A second finalize outcome: instead of (or alongside) a pasted Google
--    Meet link, the winning slot can create a real row in `events` (the
--    same table backing "Work Weekend"), seeding attendee RSVPs from how
--    people voted. Carried-over RSVPs land UNCONFIRMED (event_attendance.
--    confirmed = false) — the org wants people to actively reconfirm once
--    the event is real, not just have their poll vote silently become a
--    final answer. Reconfirming is just tapping their existing Going/Maybe/
--    Can't-make control again (set_event_attendance flips confirmed back to
--    true on any self-write) — no new UI verb to learn. A reminder,
--    auto-queued through the existing scheduled-broadcast reminder
--    machinery (0097/0101/0103), nudges anyone who hasn't.
--
-- Also lets a slot represent a DATE RANGE (meeting_slots.ends_at) instead of
-- just a point-in-time call — "which weekend" needs to poll ranges, not
-- hours. Existing call-style slots (ends_at null) are untouched.
--
-- Everything here is additive; the plain committee/house → Google Meet path
-- (finalize_meeting) is unchanged.
--
-- Apply in the Supabase SQL editor after 0121.

-- ── 1. meetings: 'family' scope + date-range slots + the event back-link ────

-- These two CHECK constraints were declared inline (unnamed) in 0116, so
-- rather than guess Postgres's auto-generated name, find them by what they
-- actually check and drop whichever name they ended up with.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.meetings'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%scope_type%'
      and pg_get_constraintdef(oid) not ilike '%committee_id%'
  loop
    execute format('alter table public.meetings drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.meetings
  add constraint meetings_scope_type_check check (scope_type in ('committee', 'house', 'family'));

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.meetings'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%committee_id%'
      and pg_get_constraintdef(oid) ilike '%house_id%'
  loop
    execute format('alter table public.meetings drop constraint %I', r.conname);
  end loop;
end $$;
-- 'family' means neither a committee nor a house room — it's everyone.
alter table public.meetings
  add constraint meetings_scope_check check (
    (scope_type = 'committee' and committee_id is not null and house_id is null)
    or (scope_type = 'house' and house_id is not null and committee_id is null)
    or (scope_type = 'family' and committee_id is null and house_id is null)
  );

alter table public.meeting_slots add column if not exists ends_at timestamptz;

alter table public.meetings add column if not exists created_event_id uuid
  references public.events (id) on delete set null;

-- ── 2. events: a 'meeting' source + the reverse back-link ───────────────────

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.events drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.events
  add constraint events_source_check check (source in ('admin', 'gcal', 'meeting'));

alter table public.events add column if not exists source_meeting_id uuid
  references public.meetings (id) on delete set null;

-- ── 3. event_attendance: unconfirmed carryover RSVPs ─────────────────────────
-- Every existing row, and every RSVP a member sets themselves, is `true` (the
-- column default covers both transparently). Only finalize_meeting_as_event
-- (below) ever inserts `false`.
alter table public.event_attendance add column if not exists confirmed boolean not null default true;

-- Re-confirming is just "tap your own RSVP again" — no separate button. The
-- INSERT branch already gets `true` from the column default; the UPDATE
-- branch didn't touch the column before, so a carried-over `false` would sit
-- forever even after the member re-answered. This is the only behavior
-- change to this function.
create or replace function public.set_event_attendance(
  p_event  text,
  p_status text,
  p_days   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event), '') = '' then raise exception 'An event is required'; end if;
  if p_status not in ('going', 'maybe', 'not_going') then raise exception 'Invalid status'; end if;

  insert into public.event_attendance (event_id, user_id, status, days)
  values (btrim(p_event), auth.uid(), p_status, p_days)
  on conflict (event_id, user_id)
  do update set status = excluded.status, days = excluded.days, confirmed = true, updated_at = now();
end;
$$;
revoke all on function public.set_event_attendance(text, text, jsonb) from public, anon;
grant execute on function public.set_event_attendance(text, text, jsonb) to authenticated;

-- ── 4. RLS reads — 'family' means every signed-in member ─────────────────────

drop policy if exists "meetings: room read" on public.meetings;
create policy "meetings: room read" on public.meetings for select using (
  case
    when scope_type = 'committee' then public.can_access_committee_area(committee_id, area)
    when scope_type = 'house' then public.is_house_member(house_id)
    when scope_type = 'family' then auth.uid() is not null
    else false
  end
);

drop policy if exists "meeting_slots: room read" on public.meeting_slots;
create policy "meeting_slots: room read" on public.meeting_slots for select using (
  exists (
    select 1 from public.meetings m
    where m.id = meeting_id
      and case
        when m.scope_type = 'committee' then public.can_access_committee_area(m.committee_id, m.area)
        when m.scope_type = 'house' then public.is_house_member(m.house_id)
        when m.scope_type = 'family' then auth.uid() is not null
        else false
      end
  )
);

drop policy if exists "meeting_availability: room read" on public.meeting_availability;
create policy "meeting_availability: room read" on public.meeting_availability for select using (
  exists (
    select 1 from public.meetings m
    where m.id = meeting_id
      and case
        when m.scope_type = 'committee' then public.can_access_committee_area(m.committee_id, m.area)
        when m.scope_type = 'house' then public.is_house_member(m.house_id)
        when m.scope_type = 'family' then auth.uid() is not null
        else false
      end
  )
);

-- ── 5. _notify_meeting_room — fan out to everyone for a 'family' meeting ────

create or replace function public._notify_meeting_room(
  p_meeting uuid, p_type text, p_actor uuid, p_title text, p_body text, p_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then return; end if;

  if m.scope_type = 'committee' then
    perform public._notify(r.linked_user_id, p_type, p_actor, p_title, p_body, p_url, 'meeting', p_meeting, null)
    from public.committee_roster r
    where r.committee_slug = m.committee_slug
      and r.linked_user_id is not null
      and (
        m.area is null
        or m.area = any(r.roles)
        or (m.area || ' · Lead') = any(r.roles)
      );
  elsif m.scope_type = 'house' then
    perform public._notify(p.id, p_type, p_actor, p_title, p_body, p_url, 'meeting', p_meeting, null)
    from public.profiles p
    where p.house_id = m.house_id;
  elsif m.scope_type = 'family' then
    perform public._notify(p.id, p_type, p_actor, p_title, p_body, p_url, 'meeting', p_meeting, null)
    from public.profiles p;
  end if;
end;
$$;
revoke all on function public._notify_meeting_room(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- Family polls live on /events, not a chat room.
create or replace function public._meeting_url(m public.meetings)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when m.scope_type = 'committee' then
      '/posts?c=' || m.committee_slug ||
      coalesce('&area=' || m.area, '') ||
      '&meeting=' || m.id
    when m.scope_type = 'house' then
      '/posts?house=' || (select h.slug from public.houses h where h.id = m.house_id) ||
      '&meeting=' || m.id
    when m.scope_type = 'family' then '/events?meeting=' || m.id
    else '/posts'
  end;
$$;

-- ── 6. create_meeting / create_scheduled_meeting — 'family' scope + ends_at ─

create or replace function public.create_meeting(
  p_scope        text,
  p_committee_id uuid,
  p_area         text,
  p_house_id     uuid,
  p_title        text,
  p_description  text,
  p_slots        jsonb,
  p_respond_by   date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_slug    text;
  v_title   text;
  v_count   int;
  v_actor   text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_scope not in ('committee', 'house', 'family') then raise exception 'Invalid scope'; end if;
  if not public.can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id) then
    raise exception 'Not authorized';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if length(v_title) > 200 then raise exception 'Keep the title under 200 characters'; end if;

  v_count := coalesce(jsonb_array_length(p_slots), 0);
  if v_count < 1 then raise exception 'Add at least one time option'; end if;
  if v_count > 10 then raise exception 'A meeting can have at most 10 time options'; end if;

  if p_scope = 'committee' then
    select slug into v_slug from public.committees where id = p_committee_id;
    if v_slug is null then raise exception 'Committee not found'; end if;
  end if;

  insert into public.meetings
    (scope_type, committee_id, committee_slug, area, house_id, title, description, created_by, respond_by)
  values
    (p_scope, p_committee_id, v_slug, p_area, p_house_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), p_respond_by)
  returning id into v_id;

  insert into public.meeting_slots (meeting_id, starts_at, duration_min, position, ends_at)
  select
    v_id,
    (elem->>'starts_at')::timestamptz,
    coalesce((elem->>'duration_min')::int, 60),
    (ord - 1)::int,
    (elem->>'ends_at')::timestamptz
  from jsonb_array_elements(p_slots) with ordinality as t(elem, ord);

  select coalesce(display_name, 'Someone') into v_actor from public.profiles where id = auth.uid();
  perform public._notify_meeting_room(
    v_id, 'meeting_proposed', auth.uid(),
    v_actor || ' wants to schedule: ' || v_title,
    'Tap to mark when you''re free',
    (select public._meeting_url(m) from public.meetings m where m.id = v_id)
  );

  return v_id;
end;
$$;
revoke all on function public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date) from public, anon;
grant execute on function public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date) to authenticated;

create or replace function public.create_scheduled_meeting(
  p_scope        text,
  p_committee_id uuid,
  p_area         text,
  p_house_id     uuid,
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_duration_min int default 60,
  p_meet_url     text default null,
  p_ends_at      timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_slot  uuid;
  v_slug  text;
  v_title text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_scope not in ('committee', 'house', 'family') then raise exception 'Invalid scope'; end if;
  if not public.can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id) then
    raise exception 'Not authorized';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if length(v_title) > 200 then raise exception 'Keep the title under 200 characters'; end if;
  if p_starts_at is null then raise exception 'A date & time is required'; end if;

  if p_scope = 'committee' then
    select slug into v_slug from public.committees where id = p_committee_id;
    if v_slug is null then raise exception 'Committee not found'; end if;
  end if;

  insert into public.meetings
    (scope_type, committee_id, committee_slug, area, house_id, title, description, created_by)
  values
    (p_scope, p_committee_id, v_slug, p_area, p_house_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.meeting_slots (meeting_id, starts_at, duration_min, position, ends_at)
  values (v_id, p_starts_at, coalesce(p_duration_min, 60), 0, p_ends_at)
  returning id into v_slot;

  perform public.finalize_meeting(v_id, v_slot, p_meet_url);

  return v_id;
end;
$$;
revoke all on function public.create_scheduled_meeting(text, uuid, text, uuid, text, text, timestamptz, int, text, timestamptz) from public, anon;
grant execute on function public.create_scheduled_meeting(text, uuid, text, uuid, text, text, timestamptz, int, text, timestamptz) to authenticated;

-- ── 7. finalize_meeting_as_event — the second finalize outcome ──────────────
-- Same authorization as finalize_meeting (creator or admin), same "no status
-- guard" precedent (the UI's "Change time or link" re-finalizes an already-
-- scheduled meeting too). Derives the event's date(s) from the slot in the
-- resort's local time (matches finalize_meeting's existing Central-time
-- rendering). Carries over yes/if-need-be voters as unconfirmed going/maybe —
-- 'no' voters get no row, since declining one candidate slot isn't the same
-- as declining an event that may run longer than what they voted on.
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

  insert into public.event_attendance (event_id, user_id, status, confirmed)
  select v_event_id::text, a.user_id,
         case a.status when 'yes' then 'going' else 'maybe' end,
         false
  from public.meeting_availability a
  where a.slot_id = p_slot and a.status in ('yes', 'if_need_be')
  on conflict (event_id, user_id) do nothing;

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

-- ── 8. run_scheduled_broadcasts — the "onlyUnconfirmed" audience narrowing ───
-- Same shape as the existing excludeNotAttending/excludeCalloutDone
-- narrowing (0096/0103), except this one is an INCLUSION: when set (and an
-- eventId is present), only profiles with no event_attendance row for that
-- event, or one with confirmed = false, receive the notification. Anyone who
-- already confirmed doesn't need to hear it again.
create or replace function public.run_scheduled_broadcasts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.scheduled_broadcasts;
  v_expires_at timestamptz;
  v_event_id text;
  v_exclude boolean;
  v_callout_id uuid;
  v_only_unconfirmed boolean;
begin
  for r in
    select * from public.scheduled_broadcasts
    where sent_at is null and cancelled_at is null and scheduled_at <= now()
    order by scheduled_at
  loop
    begin
      v_expires_at := case
        when (r.payload->>'expiryHours') is not null
          then now() + make_interval(hours => (r.payload->>'expiryHours')::int)
        else null
      end;
      v_event_id := r.payload->>'eventId';
      v_exclude := coalesce((r.payload->>'excludeNotAttending')::boolean, false);
      v_only_unconfirmed := coalesce((r.payload->>'onlyUnconfirmed')::boolean, false);
      v_callout_id := case
        when r.payload->>'sourceType' = 'callout'
             and coalesce((r.payload->>'excludeCalloutDone')::boolean, true)
        then nullif(r.payload->>'sourceId', '')::uuid
        else null
      end;

      if r.kind = 'announcement' then
        insert into public.announcements
          (author_id, title, body, severity, notify_email, email_audience, expires_at, event_id, exclude_not_attending)
        values (
          r.created_by,
          r.payload->>'title',
          nullif(r.payload->>'body', ''),
          'alert',
          coalesce((r.payload->>'notifyEmail')::boolean, false),
          coalesce(r.payload->>'emailAudience', 'all'),
          coalesce(v_expires_at, now() + interval '6 hours'),
          v_event_id,
          v_exclude
        );

      elsif r.kind = 'notification' then
        insert into public.notifications
          (recipient_id, type, actor_id, title, body, url, entity_type, expires_at)
        select p.id, 'broadcast', r.created_by, r.payload->>'title', nullif(r.payload->>'body', ''),
               nullif(r.payload->>'url', ''), 'broadcast', v_expires_at
        from public.profiles p
        where case coalesce(r.payload->>'audience', 'everyone')
                when 'everyone' then true
                when 'admins'   then p.is_admin
                else false
              end
          and not (
            v_exclude and v_event_id is not null
            and exists (
              select 1 from public.event_attendance ea
              where ea.event_id = v_event_id and ea.user_id = p.id and ea.status = 'not_going'
            )
          )
          and not (
            v_callout_id is not null
            and exists (
              select 1 from public.home_callout_completions hcc
              where hcc.callout_id = v_callout_id and hcc.user_id = p.id
            )
          )
          and (
            not v_only_unconfirmed or v_event_id is null
            or not exists (
              select 1 from public.event_attendance ea
              where ea.event_id = v_event_id and ea.user_id = p.id and ea.confirmed = true
            )
          );

        if coalesce((r.payload->>'alsoBanner')::boolean, false)
           and coalesce(r.payload->>'audience', 'everyone') = 'everyone' then
          insert into public.announcements
            (author_id, title, body, severity, notify_email, expires_at, event_id, exclude_not_attending)
          values (
            r.created_by, r.payload->>'title', nullif(r.payload->>'body', ''), 'alert', false,
            coalesce(v_expires_at, now() + interval '6 hours'), v_event_id, v_exclude
          );
        end if;
      end if;

      update public.scheduled_broadcasts set sent_at = now(), error = null where id = r.id;
    exception when others then
      update public.scheduled_broadcasts set error = sqlerrm where id = r.id;
    end;
  end loop;
end;
$$;
revoke all on function public.run_scheduled_broadcasts() from public, anon, authenticated;

-- ── 9. Realtime ───────────────────────────────────────────────────────────────
-- meetings/meeting_slots/meeting_availability/scheduled_broadcasts already
-- publish (0116/0097) — new columns on existing tables need no new grant.
