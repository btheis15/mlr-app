-- 0209_event_hosts.sql
--
-- EVENT HOSTS — who is actually running this event, and therefore who may
-- change it and RSVP other people to it.
--
-- THE GAP. Since 0187 any member can create an event, and management (edit,
-- delete, assign work items, email everyone, manually add attendees) is
-- "an app admin OR the event's own creator". That's too narrow for how the
-- family actually runs things: a Work Weekend belongs to the Resort Maintenance
-- committee, not to whichever person happened to type it in first. If that one
-- person is away, nobody else can add the cousin who phoned to say she's
-- coming — even though five people on the committee are organising the weekend.
--
-- THE MODEL (per Brian). An event has zero or more hosts. A host is EITHER a
-- person OR a whole committee:
--
--   • no hosts at all      → any signed-in member may manage it
--   • person host(s)       → those people
--   • committee host, and that committee HAS leads → its LEADS only
--   • committee host with NO leads                 → any member of it
--
-- …plus, always, an app admin and the event's own creator. The creator is kept
-- deliberately: otherwise adding a committee host would be a one-way door that
-- locks the person who made the event out of their own event.
--
-- ⚠️ RSVPING YOURSELF IS NEVER GATED BY ANY OF THIS. `set_event_attendance`
-- (0035) is untouched — it writes the caller's own row and is the one thing
-- every member can always do. Hosts govern acting on OTHER people
-- (`add_event_attendee`, 0196) and changing the event itself.
--
-- ⚠️⚠️ THIS LOOSENS PERMISSIONS ON EVERY EXISTING EVENT. Nothing has hosts yet,
-- so the "no hosts → any member" branch applies to all of them the moment this
-- runs: an event that today only its creator could edit becomes editable by any
-- signed-in member. That is the requested behaviour ("anyone, if there's no
-- host") and it matches the app's member-createable doctrine — but it IS a real
-- change to existing rows, not just to new ones. Setting a host on an event is
-- what NARROWS it again. Two things are deliberately held back from the open
-- fallback, see `can_delete_event` below.
--
-- ⚠️ `event_id` is TEXT with no FK, matching `event_attendance` (0035) and
-- `event_work_items` (0048). Family Fest and the holiday weekends are
-- synthesized in client code from `lib/data.ts` and have string ids
-- ('family-fest-2026'), not `events` rows — a uuid FK here would make exactly
-- the events the family cares most about the only ones that can't have a host.
-- The price is that cleanup is manual; `delete_event` below does it.

-- ── 1. The table ──────────────────────────────────────────────────────────────

create table if not exists public.event_hosts (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null,
  -- Exactly one of these is set (see the check) — the polymorphic-parent idiom
  -- migration 0150 uses for `tournaments`.
  user_id      uuid references public.profiles (id) on delete cascade,
  committee_id uuid references public.committees (id) on delete cascade,
  added_by     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint event_hosts_exactly_one_kind check (num_nonnulls(user_id, committee_id) = 1)
);

create index if not exists event_hosts_event_idx on public.event_hosts (event_id);
-- Adding the same host twice is a no-op, not a duplicate row (partial uniques,
-- since the unused column is null and nulls don't collide in a plain unique).
create unique index if not exists event_hosts_event_user_uniq
  on public.event_hosts (event_id, user_id) where user_id is not null;
create unique index if not exists event_hosts_event_committee_uniq
  on public.event_hosts (event_id, committee_id) where committee_id is not null;

alter table public.event_hosts enable row level security;

-- Read: any signed-in member. ⚠️ NOT public, even though `events` itself is
-- public-read (0081 lists it as browse-first content): a host row names a
-- PERSON, and the 0081 lockdown put everything that names people
-- (committee_roster, event_attendance, profiles) behind sign-in. A guest
-- browsing the calendar simply sees no host line. Committee hosts alone would
-- have been safe to expose — `committees` is public — but splitting the read by
-- host kind would mean a guest seeing a partial host list with no indication
-- that a name was withheld, which reads as data being wrong rather than hidden.
drop policy if exists event_hosts_read on public.event_hosts;
create policy event_hosts_read on public.event_hosts
  for select using (auth.uid() is not null);

-- No write policies at all — every write goes through the RPCs below, which is
-- the only way to enforce "you must already be able to manage this event".
-- (Same shape as house_requests, 0195.)

-- ── 2. Does this committee have any leads? ────────────────────────────────────
-- The "committee host" rule needs both "am I a lead of it" (0177's
-- is_committee_lead, reused as-is) and "does it have leads AT ALL", because a
-- committee with no leads falls back to any member. Same predicate as 0177 —
-- `is_lead`, or any role ending ' · Lead' — with the auth.uid() filter dropped.
create or replace function public.committee_has_leads(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.committee_roster r
    join public.committees c on c.slug = r.committee_slug
    where c.id = cid
      and (
        r.is_lead
        or exists (
          select 1 from unnest(coalesce(r.roles, '{}'::text[])) role
          where role like '% · Lead'
        )
      )
  );
$$;
revoke all on function public.committee_has_leads(uuid) from public, anon;
grant execute on function public.committee_has_leads(uuid) to authenticated;

-- ── 3. can_manage_event — recreated, now host-aware ───────────────────────────
-- Recreated from its CURRENT production definition (0190), with only the final
-- return widened. That's the 0160 rule: never rebuild a function from an older
-- migration's copy-pasted body. The admin short-circuit, the
-- invalid_text_representation guard (so a seed event id like 'family-fest-2026'
-- resolves to "no creator" instead of erroring on the uuid cast) and the
-- creator check are all carried over verbatim.
create or replace function public.can_manage_event(p_event_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
  v_hosts   int;
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin) then return true; end if;

  begin
    select created_by into v_creator from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_creator := null; -- a seed/synthesized event id isn't a real uuid
  end;

  if v_creator is not null and v_creator = v_uid then return true; end if;

  select count(*) into v_hosts from public.event_hosts where event_id = p_event_id;

  -- No host named ⇒ nobody owns it ⇒ any signed-in member may run it. This is
  -- the branch that changes behaviour for every event that exists today.
  if v_hosts = 0 then return true; end if;

  -- Named as a host personally.
  if exists (
    select 1 from public.event_hosts h
    where h.event_id = p_event_id and h.user_id = v_uid
  ) then return true; end if;

  -- Hosted by a committee I'm in. If that committee has leads, only its leads
  -- qualify; with no leads, any member does. Evaluated per host row, so an
  -- event hosted by two committees is managed by whoever qualifies on EITHER.
  -- ⚠️ is_committee_lead (0177) deliberately excludes app admins, which is fine
  -- here — admins already returned true at the top.
  return exists (
    select 1
    from public.event_hosts h
    where h.event_id = p_event_id
      and h.committee_id is not null
      and case
            when public.committee_has_leads(h.committee_id)
              then public.is_committee_lead(h.committee_id)
            else public.is_committee_member(h.committee_id)
          end
  );
end;
$$;
revoke all on function public.can_manage_event(text) from public, anon;
grant execute on function public.can_manage_event(text) to authenticated;

-- ── 4. can_delete_event — the same rule MINUS the open fallback ───────────────
-- ⚠️ Deleting an event destroys every RSVP on it (delete_event clears
-- event_attendance by id) and cannot be undone. "Any member, because nobody set
-- a host" is a reasonable rule for editing a location or adding an attendee; it
-- is not one for erasing the Labor Day weekend and 30 people's answers. So
-- deletion requires someone who actually owns the event: an admin, its creator,
-- or a named host. A hostless event stays creator-and-admin-only to delete,
-- exactly as it is today.
create or replace function public.can_delete_event(p_event_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin) then return true; end if;

  begin
    select created_by into v_creator from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_creator := null;
  end;
  if v_creator is not null and v_creator = v_uid then return true; end if;

  return exists (
    select 1 from public.event_hosts h
    where h.event_id = p_event_id
      and (
        h.user_id = v_uid
        or (
          h.committee_id is not null
          and case
                when public.committee_has_leads(h.committee_id)
                  then public.is_committee_lead(h.committee_id)
                else public.is_committee_member(h.committee_id)
              end
        )
      )
  );
end;
$$;
revoke all on function public.can_delete_event(text) from public, anon;
grant execute on function public.can_delete_event(text) to authenticated;

-- ── 5. Setting hosts ─────────────────────────────────────────────────────────
-- Gated on can_manage_event, so whoever can run the event can name who runs it.
-- ⚠️ That intentionally means a member CAN hand an event to a committee while
-- the event has no host (because they qualify under the open fallback) and
-- thereby narrow it — including away from themselves. The creator check in
-- can_manage_event is what stops that being a trap for the event's own author.
create or replace function public.add_event_host(
  p_event_id     text,
  p_user_id      uuid default null,
  p_committee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = '' then raise exception 'Event ID required'; end if;
  if num_nonnulls(p_user_id, p_committee_id) <> 1 then
    raise exception 'Name either a person or a committee as host, not both';
  end if;
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only this event''s hosts, its creator or an admin can change who hosts it';
  end if;

  insert into public.event_hosts (event_id, user_id, committee_id, added_by)
  values (p_event_id, p_user_id, p_committee_id, v_uid)
  on conflict do nothing
  returning id into v_id;

  -- Already a host ⇒ hand back the existing row rather than erroring, so a
  -- double-tap is idempotent (the create_activity_tournament idiom, 0151).
  if v_id is null then
    select id into v_id from public.event_hosts
    where event_id = p_event_id
      and (p_user_id is not null and user_id = p_user_id
           or p_committee_id is not null and committee_id = p_committee_id);
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_event_host(text, uuid, uuid) from public, anon;
grant execute on function public.add_event_host(text, uuid, uuid) to authenticated;

-- Removing a host. ⚠️ Deliberately re-checks can_manage_event BEFORE deleting:
-- removing the last host re-opens the event to every member, so this is a
-- widening action and must be held to the same bar as narrowing one.
create or replace function public.remove_event_host(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select event_id into v_event from public.event_hosts where id = p_id;
  if not found then return; end if; -- already gone; nothing to do
  if not public.can_manage_event(v_event) then
    raise exception 'Only this event''s hosts, its creator or an admin can change who hosts it';
  end if;
  delete from public.event_hosts where id = p_id;
end;
$$;
revoke all on function public.remove_event_host(uuid) from public, anon;
grant execute on function public.remove_event_host(uuid) to authenticated;

-- ── 6. Re-gate the four write RPCs that INLINE the old rule ──────────────────
-- ⚠️⚠️ THIS IS THE STEP THAT MAKES HOSTS ACTUALLY DO ANYTHING. 0190 added
-- can_manage_event() as a helper for new callers and explicitly did NOT
-- recreate update_event / delete_event / sync_event_work_items /
-- remove_work_item_from_event to use it — they each carry their own copy of
-- "admin OR creator". So widening the helper alone would have left a host able
-- to email about an event and add attendees to it, but NOT to edit it: the
-- feature would look done and silently only half work.
--
-- Each body below is its CURRENT production definition copied verbatim (0187
-- for the first three, 0188 for the fourth), with ONLY the permission block
-- swapped. That is the 0160 rule — recreate from what's live, never from an
-- older migration.

-- update_event — 0187's body, gate swapped.
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
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.events where id = p_id) then
    raise exception 'Event not found';
  end if;
  if not public.can_manage_event(p_id::text) then
    raise exception 'Only this event''s hosts, its creator or an admin can edit it';
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
end;
$$;
revoke all on function public.update_event(uuid, text, date, date, text, text, text, text, boolean, time) from public, anon;
grant execute on function public.update_event(uuid, text, date, date, text, text, text, text, boolean, time) to authenticated;

-- delete_event — 0187's body, gated on can_DELETE_event (no open fallback), and
-- now also clearing the event's host rows (event_hosts has no FK to cascade,
-- same reason event_attendance is cleaned up by hand here).
create or replace function public.delete_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.events where id = p_id) then
    raise exception 'Event not found';
  end if;
  if not public.can_delete_event(p_id::text) then
    raise exception 'Only this event''s hosts, its creator or an admin can delete it';
  end if;

  delete from public.events where id = p_id;
  -- Attendance and hosts key on the event id as TEXT (0035 / this migration —
  -- no FK cascade), so clean up their rows here.
  delete from public.event_attendance where event_id = p_id::text;
  delete from public.event_hosts where event_id = p_id::text;
end;
$$;
revoke all on function public.delete_event(uuid) from public, anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- sync_event_work_items — 0187's body, gate swapped.
create or replace function public.sync_event_work_items(
  p_event_id text,
  p_item_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = ''
    then raise exception 'Event ID required'; end if;
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only this event''s hosts, its creator or an admin can assign work items';
  end if;

  -- Remove items no longer in the desired set.
  delete from public.event_work_items
  where event_id = p_event_id
    and (p_item_ids is null or work_item_id <> all(p_item_ids));

  -- Insert new links, skipping any that are already present.
  if p_item_ids is not null and cardinality(p_item_ids) > 0 then
    insert into public.event_work_items (event_id, work_item_id, added_by)
    select p_event_id, unnest(p_item_ids), v_uid
    on conflict (event_id, work_item_id) do nothing;
  end if;
end;
$$;
revoke all on function public.sync_event_work_items(text, uuid[]) from public, anon;
grant execute on function public.sync_event_work_items(text, uuid[]) to authenticated;

-- remove_work_item_from_event — 0188's body, gate swapped.
create or replace function public.remove_work_item_from_event(
  p_event_id     text,
  p_work_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = ''
    then raise exception 'Event ID required'; end if;
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only this event''s hosts, its creator or an admin can remove work items';
  end if;

  delete from public.event_work_items
  where event_id = p_event_id and work_item_id = p_work_item_id;
end;
$$;
revoke all on function public.remove_work_item_from_event(text, uuid) from public, anon;
grant execute on function public.remove_work_item_from_event(text, uuid) to authenticated;

-- ── 7. Hosts, resolved for display — BULK ────────────────────────────────────
-- Takes an ARRAY of event ids and returns every host on them, already resolved
-- to display names, so the calendar renders "Hosted by 🛠️ Resort Maintenance"
-- on every card from ONE round-trip and the client never joins profiles and
-- committees itself. SECURITY INVOKER on purpose, so the members-only read
-- policy above still applies (a guest gets nothing).
create or replace function public.event_hosts_for(p_event_ids text[])
returns table (
  id           uuid,
  event_id     text,
  user_id      uuid,
  committee_id uuid,
  display_name text,
  emoji        text,
  slug         text
)
language sql
stable
set search_path = ''
as $$
  select
    h.id,
    h.event_id,
    h.user_id,
    h.committee_id,
    coalesce(p.display_name, c.name)  as display_name,
    c.emoji                           as emoji,
    c.slug                            as slug
  from public.event_hosts h
  left join public.profiles p   on p.id = h.user_id
  left join public.committees c on c.id = h.committee_id
  where h.event_id = any(p_event_ids)
  -- Committees first, then people, each alphabetically — a committee is the
  -- headline ("the Maintenance committee is running this"), a person is detail.
  order by (h.committee_id is null), coalesce(p.display_name, c.name);
$$;
revoke all on function public.event_hosts_for(text[]) from public, anon;
grant execute on function public.event_hosts_for(text[]) to authenticated;

-- ── 8. "Which of these may I manage?" — one round-trip for the whole list ─────
-- ⚠️⚠️ THE CLIENT MUST NOT RE-IMPLEMENT THE HOST RULE. Mirroring it in
-- TypeScript would need the viewer's committee memberships, which of those they
-- lead, AND whether each committee has any leads — three reads and a second copy
-- of a four-branch predicate that would drift from this file the first time
-- either changed. The precedent is `event_message_preview` (0192): the preview
-- is built by the same SQL that does the real work, because "a preview built
-- from a second source is worse than none".
--
-- So the client asks. Pass every event id on screen; get back a row per event
-- with both flags. Ids with no row are simply not manageable (a guest gets an
-- empty set, since auth.uid() is null makes both functions false).
create or replace function public.my_event_permissions(p_event_ids text[])
returns table (
  event_id   text,
  can_manage boolean,
  can_delete boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e                             as event_id,
    public.can_manage_event(e)    as can_manage,
    public.can_delete_event(e)    as can_delete
  from unnest(coalesce(p_event_ids, '{}'::text[])) as e
  where auth.uid() is not null;
$$;
revoke all on function public.my_event_permissions(text[]) from public, anon;
grant execute on function public.my_event_permissions(text[]) to authenticated;
