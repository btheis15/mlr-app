-- 0187_member_created_events.sql
-- Events were admin-only end to end — creating one, editing/deleting it, and
-- assigning work items to it. That's the wrong shape for something like "let's
-- get a Work Weekend on the calendar and line up the tasks for it" — any member
-- should be able to spin that up without needing admin access, the same
-- member-createable doctrine as polls (0084) and private activities (0150).
--
-- Widened here:
--   • create_event   — any signed-in member (was admin-only).
--   • update_event    — admin OR the event's own creator (was admin-only;
--     mirrors work_items' author-or-admin edit, 0079).
--   • delete_event    — admin OR the event's own creator (same reasoning).
--   • sync_event_work_items — admin OR the event's own creator (was admin-only) —
--     this is what lets a member assign checklist items to the event they just
--     created without being an admin.
-- add_work_item_to_event (0050) was ALREADY open to any signed-in member — no
-- change needed there.
--
-- Recreated from the CURRENT production definitions (0101 for create_event/
-- update_event, 0048 for sync_event_work_items) plus the widened gate — the
-- 0160 "recreate from current form, not an old migration's body" rule.
-- Apply after 0186.

-- ── create_event — any signed-in member ──────────────────────────────────────
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
  if auth.uid() is null then raise exception 'Sign in required'; end if;
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

-- ── update_event — admin OR the event's own creator ──────────────────────────
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
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := exists (select 1 from public.profiles where id = v_uid and is_admin);
  v_creator  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select created_by into v_creator from public.events where id = p_id;
  if not found then raise exception 'Event not found'; end if;
  if not v_is_admin and v_creator is distinct from v_uid then
    raise exception 'Only the event''s creator or an admin can edit it';
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

-- ── delete_event — admin OR the event's own creator ──────────────────────────
create or replace function public.delete_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := exists (select 1 from public.profiles where id = v_uid and is_admin);
  v_creator  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select created_by into v_creator from public.events where id = p_id;
  if not found then raise exception 'Event not found'; end if;
  if not v_is_admin and v_creator is distinct from v_uid then
    raise exception 'Only the event''s creator or an admin can delete it';
  end if;

  delete from public.events where id = p_id;
  -- Attendance keys on the event id as TEXT (0035 — no FK cascade), so clean up
  -- its rows here.
  delete from public.event_attendance where event_id = p_id::text;
end;
$$;
revoke all on function public.delete_event(uuid) from public, anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- ── sync_event_work_items — admin OR the event's own creator ─────────────────
-- Still replaces the full set of work items attached to an event atomically;
-- only the gate widened (was admin-only). A seed/synthesized event (Family
-- Fest, a Google Calendar row) has no `events` row to look up creator on, so
-- it's still admin-only there (v_creator stays null, matching nobody).
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
  v_uid      uuid := auth.uid();
  v_is_admin boolean := exists (select 1 from public.profiles where id = v_uid and is_admin);
  v_creator  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = ''
    then raise exception 'Event ID required'; end if;

  begin
    select created_by into v_creator from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_creator := null; -- a seed/synthesized event id isn't a real uuid
  end;

  if not v_is_admin and (v_creator is null or v_creator is distinct from v_uid) then
    raise exception 'Only the event''s creator or an admin can assign work items';
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
