-- 0116_meetings.sql
-- Meeting scheduling for committee/subcommittee AND house chat rooms (everything
-- except the resort-wide Main Feed). An organizer (an app admin, or — for a
-- committee — one of that committee's/area's Leads) proposes a handful of
-- candidate time slots; every member of that room marks Yes / If-need-be / No on
-- each slot (Doodle-style). The organizer sees the tallies + the best slot,
-- picks the winning time, pastes in a Google Meet link, and the meeting is
-- "scheduled" — which posts a join-link message into the room and notifies
-- everyone. It replaces asking the group chat over and over.
--
-- Shape mirrors polls (0084) + event_attendance (0035): member-read tables under
-- RLS (scoped to the room via the existing can_access_committee_area (0063) /
-- is_house_member (0064) gates), ALL writes through SECURITY DEFINER RPCs so the
-- organizer/one-row-per-member rules live server-side, and realtime so tallies
-- move live. Everything is additive; degrades to "no meetings" pre-migration.
--
-- Apply in the Supabase SQL editor after 0115.

-- ── 1. Tables ────────────────────────────────────────────────────────────────

-- A meeting proposal — one per scheduling round, scoped to exactly one room.
--  • committee scope: committee_id (+ denormalized committee_slug for the client
--    filter / deep-link, which never changes — 0112) and a nullable `area`
--    (NULL = the committee-wide General channel; else a role channel like
--    'Meals', matching committee_messages.area).
--  • house scope: house_id (a house is one room, no areas).
create table if not exists public.meetings (
  id             uuid primary key default gen_random_uuid(),
  scope_type     text not null check (scope_type in ('committee', 'house')),
  committee_id   uuid references public.committees (id) on delete cascade,
  committee_slug text,
  area           text,
  house_id       uuid references public.houses (id) on delete cascade,
  title          text not null,
  description    text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  respond_by     date,                      -- optional "please answer by" (informational)
  status         text not null default 'open' check (status in ('open', 'scheduled', 'cancelled')),
  chosen_slot_id uuid,                       -- set on finalize (FK added after meeting_slots exists)
  meet_url       text,                       -- the pasted Google Meet / calendar link
  finalized_at   timestamptz,
  finalized_by   uuid references public.profiles (id) on delete set null,
  -- exactly one scope is populated, and it matches scope_type
  check (
    (scope_type = 'committee' and committee_id is not null and house_id is null)
    or (scope_type = 'house' and house_id is not null and committee_id is null)
  )
);
create index if not exists meetings_committee_idx on public.meetings (committee_slug, area, created_at desc);
create index if not exists meetings_house_idx on public.meetings (house_id, created_at desc);

-- Candidate times (like poll_options).
create table if not exists public.meeting_slots (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings (id) on delete cascade,
  starts_at    timestamptz not null,
  duration_min int not null default 60,
  position     int not null default 0
);
create index if not exists meeting_slots_meeting_idx on public.meeting_slots (meeting_id);

-- Now that meeting_slots exists, point chosen_slot_id at it (nulled if the slot
-- is deleted, so a finalized meeting whose slot vanished degrades gracefully).
do $$ begin
  alter table public.meetings
    add constraint meetings_chosen_slot_fk
    foreign key (chosen_slot_id) references public.meeting_slots (id) on delete set null;
exception when duplicate_object then null; end $$;

-- One availability answer per member per slot (like event_attendance's PK).
create table if not exists public.meeting_availability (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  slot_id    uuid not null references public.meeting_slots (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text not null check (status in ('yes', 'if_need_be', 'no')),
  updated_at timestamptz not null default now(),
  primary key (slot_id, user_id)
);
create index if not exists meeting_availability_meeting_idx on public.meeting_availability (meeting_id);

-- ── 2. RLS — members-only reads, scoped to the room; no client writes ─────────

alter table public.meetings enable row level security;
alter table public.meeting_slots enable row level security;
alter table public.meeting_availability enable row level security;

-- A member reads a meeting iff they can access its room (same gate as the chat).
drop policy if exists "meetings: room read" on public.meetings;
create policy "meetings: room read" on public.meetings for select using (
  case
    when scope_type = 'committee' then public.can_access_committee_area(committee_id, area)
    when scope_type = 'house' then public.is_house_member(house_id)
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
        else false
      end
  )
);

-- ── 3. Gate helper: can the caller ORGANIZE a meeting in this room? ───────────
-- Admin (any room), OR — committee scope only — a Lead of that committee/area
-- (a roster row linked to the caller whose roles hold '<area> · Lead', or any
-- '· Lead' when area is NULL / the General channel). Houses are admin-only.
create or replace function public.can_organize_meeting(
  p_scope        text,
  p_committee_id uuid,
  p_area         text,
  p_house_id     uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or (
      p_scope = 'committee'
      and exists (
        select 1
        from public.committee_roster r
        join public.committees c on c.slug = r.committee_slug
        where c.id = p_committee_id
          and r.linked_user_id = auth.uid()
          and (
            case
              when p_area is null then exists (
                select 1 from unnest(r.roles) role where role like '%· Lead'
              )
              else (p_area || ' · Lead') = any(r.roles)
            end
          )
      )
    );
$$;
revoke all on function public.can_organize_meeting(text, uuid, text, uuid) from public, anon;
grant execute on function public.can_organize_meeting(text, uuid, text, uuid) to authenticated;

-- ── 4. Fan-out helper: notify every member of a meeting's room ────────────────
-- One notification per room member (except the actor), gated by their
-- notif_types (via _notify). Committee → roster-linked members who can access
-- the area; house → profiles in that house.
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
  end if;
end;
$$;
revoke all on function public._notify_meeting_room(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- Build the in-app deep-link to a meeting's room (opens the chat + the sheet).
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
    else '/posts'
  end;
$$;

-- ── 5. RPCs (all admin/lead/one-row-per-member rules server-side) ─────────────

-- Propose a meeting. p_slots is a jsonb array of {starts_at, duration_min}.
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
  if p_scope not in ('committee', 'house') then raise exception 'Invalid scope'; end if;
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

  insert into public.meeting_slots (meeting_id, starts_at, duration_min, position)
  select
    v_id,
    (elem->>'starts_at')::timestamptz,
    coalesce((elem->>'duration_min')::int, 60),
    (ord - 1)::int
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

-- Set (or change) MY availability across a meeting's slots — bulk upsert of my
-- own rows. p_answers is a jsonb object {slot_id: 'yes'|'if_need_be'|'no'}.
-- Only for an OPEN meeting whose room I can access (RLS on the read side; the
-- membership recheck here mirrors that so a stale client can't write blind).
create or replace function public.set_my_availability(
  p_meeting uuid,
  p_answers jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
  v_can boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'Meeting not found'; end if;
  if m.status <> 'open' then raise exception 'This meeting is closed'; end if;

  v_can := case
    when m.scope_type = 'committee' then public.can_access_committee_area(m.committee_id, m.area)
    when m.scope_type = 'house' then public.is_house_member(m.house_id)
    else false
  end;
  if not v_can then raise exception 'Not authorized'; end if;

  insert into public.meeting_availability (meeting_id, slot_id, user_id, status, updated_at)
  select
    p_meeting,
    (key)::uuid,
    auth.uid(),
    value #>> '{}',
    now()
  from jsonb_each(p_answers) as t(key, value)
  where exists (select 1 from public.meeting_slots s where s.id = (key)::uuid and s.meeting_id = p_meeting)
    and (value #>> '{}') in ('yes', 'if_need_be', 'no')
  on conflict (slot_id, user_id)
  do update set status = excluded.status, updated_at = now();
end;
$$;
revoke all on function public.set_my_availability(uuid, jsonb) from public, anon;
grant execute on function public.set_my_availability(uuid, jsonb) to authenticated;

-- Finalize — the organizer (creator) or an admin picks the winning slot and
-- attaches the Google Meet link. Marks the meeting scheduled, posts a join-link
-- message into the room's chat (as the finalizer), and notifies every member.
create or replace function public.finalize_meeting(
  p_meeting  uuid,
  p_slot     uuid,
  p_meet_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.meetings%rowtype;
  v_slot  public.meeting_slots%rowtype;
  v_url   text;
  v_when  text;
  v_body  text;
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

  v_url := nullif(btrim(coalesce(p_meet_url, '')), '');

  update public.meetings
     set status = 'scheduled',
         chosen_slot_id = p_slot,
         meet_url = v_url,
         finalized_at = now(),
         finalized_by = auth.uid()
   where id = p_meeting;

  -- Post the outcome into the room's chat so it's visible where it started.
  -- Render in the resort's local time (Central) — starts_at is stored UTC, and
  -- the DB session tz is UTC, so a bare to_char would show the wrong clock time.
  v_when := to_char(v_slot.starts_at at time zone 'America/Chicago', 'Dy Mon DD, HH12:MI AM');
  v_body := '📅 Meeting set — ' || m.title || ' · ' || v_when
            || coalesce(E'\nJoin: ' || v_url, '');
  if m.scope_type = 'committee' then
    insert into public.committee_messages (committee_id, author_id, text, area)
    values (m.committee_id, auth.uid(), v_body, m.area);
  elsif m.scope_type = 'house' then
    insert into public.house_messages (house_id, author_id, text)
    values (m.house_id, auth.uid(), v_body);
  end if;

  perform public._notify_meeting_room(
    p_meeting, 'meeting_scheduled', auth.uid(),
    'Meeting set: ' || m.title,
    v_when || case when v_url is not null then ' · join link inside' else '' end,
    (select public._meeting_url(mm) from public.meetings mm where mm.id = p_meeting)
  );
end;
$$;
revoke all on function public.finalize_meeting(uuid, uuid, text) from public, anon;
grant execute on function public.finalize_meeting(uuid, uuid, text) to authenticated;

-- Cancel a meeting (freeze it, keep the record) — organizer or admin.
create or replace function public.cancel_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.meetings where id = p_meeting) then
    raise exception 'Meeting not found';
  end if;
  if not exists (
    select 1 from public.meetings mm
    where mm.id = p_meeting
      and (mm.created_by = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ) then
    raise exception 'Not authorized';
  end if;
  update public.meetings set status = 'cancelled' where id = p_meeting;
end;
$$;
revoke all on function public.cancel_meeting(uuid) from public, anon;
grant execute on function public.cancel_meeting(uuid) to authenticated;

-- Delete a meeting (slots + availability cascade) — organizer or admin.
create or replace function public.delete_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.meetings where id = p_meeting) then
    raise exception 'Meeting not found';
  end if;
  if not exists (
    select 1 from public.meetings mm
    where mm.id = p_meeting
      and (mm.created_by = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ) then
    raise exception 'Not authorized';
  end if;
  delete from public.meetings where id = p_meeting;
end;
$$;
revoke all on function public.delete_meeting(uuid) from public, anon;
grant execute on function public.delete_meeting(uuid) to authenticated;

-- ── 6. Notification kinds (default ON for every member) ───────────────────────
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled}';

update public.profiles set notif_types = array_append(notif_types, 'meeting_proposed')
  where not ('meeting_proposed' = any(notif_types));
update public.profiles set notif_types = array_append(notif_types, 'meeting_scheduled')
  where not ('meeting_scheduled' = any(notif_types));

-- ── 7. Realtime (live tallies + new/finalized meetings) ──────────────────────
alter table public.meetings replica identity full;
do $$ begin alter publication supabase_realtime add table public.meetings; exception when duplicate_object then null; end $$;
alter table public.meeting_slots replica identity full;
do $$ begin alter publication supabase_realtime add table public.meeting_slots; exception when duplicate_object then null; end $$;
alter table public.meeting_availability replica identity full;
do $$ begin alter publication supabase_realtime add table public.meeting_availability; exception when duplicate_object then null; end $$;
