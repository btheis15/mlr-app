-- 0071_house_calendar.sql
-- House calendar: a shared calendar of "stays" for each house (0064). A stay is
-- one member saying "I'm going up to the house on these dates, with these people."
-- Everyone in the house sees who's staying and when, and can add their own stay
-- for the same (or any) window — so overlapping stays show who's up at the same
-- time. Resort-wide MLR events (the existing `events` table, 0034) are overlaid
-- on the calendar by the client so a house's members never miss a family-wide
-- gathering — but those live in `events`, not here.
--
-- Data model mirrors the house-scoped features (chat 0065, work items 0066):
--   • house_stays               — one row per member's stay, scoped to a house.
--   • RLS read = is_house_member(house_id) (private to the house + admins).
--   • Writes go through SECURITY DEFINER RPCs (create/update/delete) — a member
--     writes only their OWN stay; the author or an admin can edit/cancel it.
--   • house_stay_created notification → the rest of the house + every app admin
--     (mirrors the work_item_created house audience, 0070). Default ON.
--
-- Apply in the Supabase SQL editor after 0070.

-- ── The stays table ──────────────────────────────────────────────────────────
create table if not exists public.house_stays (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  title       text,                 -- optional label ("Fishing weekend"); null ⇒ "<Name>'s stay"
  start_date  date not null,
  end_date    date not null,        -- inclusive; a one-night stay has end = start
  -- Who's coming along, as a free list of names — NO account needed (a spouse,
  -- kids, the dog, a friend). The member who submits the stay has an account;
  -- everyone they add is just a name. Head count = 1 (the member) + this list.
  guest_names text[] not null default '{}',
  note        text,                 -- free-form description ("bringing the boat")
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists house_stays_house_idx on public.house_stays (house_id, start_date);
create index if not exists house_stays_creator_idx on public.house_stays (created_by);

alter table public.house_stays enable row level security;

-- The security core: only this house's members (and admins) can see its stays.
-- No client write policies — every write goes through the SECURITY DEFINER RPCs
-- below (authorization lives in one place), same as the events table (0034).
drop policy if exists "house_stays: member read" on public.house_stays;
create policy "house_stays: member read" on public.house_stays for select
  using (public.is_house_member(house_id));

-- Keep updated_at fresh (reuses the generic trigger fn from 0001).
drop trigger if exists house_stays_set_updated_at on public.house_stays;
create trigger house_stays_set_updated_at
  before update on public.house_stays
  for each row execute function public.set_updated_at();

-- ── RPCs ─────────────────────────────────────────────────────────────────────
-- Add my stay. Any member of the house (or an admin) can add; the row is stamped
-- to the caller (created_by = auth.uid()).
-- Normalize a free list of guest names: trim each, drop blanks, cap the count +
-- each name's length so the list can't be abused. Returns '{}' for null/empty.
create or replace function public._clean_guest_names(p_names text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_agg(left(btrim(n), 80) order by ord)
      filter (where btrim(coalesce(n, '')) <> ''),
    '{}'
  )
  from (
    select n, ord from unnest(coalesce(p_names, '{}'::text[])) with ordinality as t(n, ord)
    limit 40
  ) s;
$$;

create or replace function public.create_house_stay(
  p_house       uuid,
  p_start_date  date,
  p_end_date    date,
  p_title       text default null,
  p_guest_names text[] default '{}',
  p_note        text default null
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
  if not public.is_house_member(p_house) then raise exception 'Not a member of this house'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'Start and end dates are required'; end if;
  if p_end_date < p_start_date then raise exception 'End date must be on or after the start date'; end if;

  insert into public.house_stays (house_id, created_by, title, start_date, end_date, guest_names, note)
  values (
    p_house, auth.uid(),
    nullif(btrim(coalesce(p_title, '')), ''),
    p_start_date, p_end_date,
    public._clean_guest_names(p_guest_names),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_house_stay(uuid, date, date, text, text[], text) from public, anon;
grant execute on function public.create_house_stay(uuid, date, date, text, text[], text) to authenticated;

-- Edit a stay. The author (anytime — a stay is a future plan) or an admin.
create or replace function public.update_house_stay(
  p_id          uuid,
  p_start_date  date,
  p_end_date    date,
  p_title       text default null,
  p_guest_names text[] default '{}',
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select created_by into v_owner from public.house_stays where id = p_id;
  if v_owner is null then raise exception 'Stay not found'; end if;
  if v_owner <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if p_end_date < p_start_date then raise exception 'End date must be on or after the start date'; end if;

  update public.house_stays set
    title       = nullif(btrim(coalesce(p_title, '')), ''),
    start_date  = p_start_date,
    end_date    = p_end_date,
    guest_names = public._clean_guest_names(p_guest_names),
    note        = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;
end;
$$;
revoke all on function public.update_house_stay(uuid, date, date, text, text[], text) from public, anon;
grant execute on function public.update_house_stay(uuid, date, date, text, text[], text) to authenticated;

-- Cancel a stay. The author or an admin.
create or replace function public.delete_house_stay(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select created_by into v_owner from public.house_stays where id = p_id;
  if v_owner is null then return; end if;
  if v_owner <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  delete from public.house_stays where id = p_id;
end;
$$;
revoke all on function public.delete_house_stay(uuid) from public, anon;
grant execute on function public.delete_house_stay(uuid) to authenticated;

-- ── Notification: a new stay tells the house ─────────────────────────────────
-- New kind `house_stay_created`, fanned out on insert into house_stays to that
-- house's members + every app admin (mirrors work_item_created's house audience,
-- 0070). The actor is never notified of their own stay (_notify skips the actor).
-- Rides the Activity feed / notif_types gate (0030); default ON for everyone.
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created}';

update public.profiles set notif_types = array_append(notif_types, 'house_stay_created')
  where not ('house_stay_created' = any(notif_types));

create or replace function public.notif_on_house_stay_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_house text;
  v_slug  text;
  v_when  text;
  v_url   text;
begin
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_actor
    from public.profiles where id = NEW.created_by;
  select name, slug into v_house, v_slug from public.houses where id = NEW.house_id;
  -- A compact human date range ("Jul 18" or "Jul 18 – Jul 20").
  v_when := to_char(NEW.start_date, 'Mon FMDD');
  if NEW.end_date <> NEW.start_date then
    v_when := v_when || ' – ' || to_char(NEW.end_date, 'Mon FMDD');
  end if;
  -- Deep-link to the house calendar. The `?house=<slug>` param lets an admin (who
  -- may not belong to this house) open the right calendar; a member's own hub
  -- resolves without it. Static-export-safe (no dynamic route segment).
  v_url := '/house/calendar?house=' || coalesce(v_slug, '');

  perform public._notify(
    p.id, 'house_stay_created', NEW.created_by,
    v_actor || ' is staying at ' || coalesce(v_house, 'the house') || ' (' || v_when || ')',
    nullif(NEW.title, ''), v_url, 'house_stay', NEW.id, null)
  from public.profiles p
  where p.id <> NEW.created_by
    and (p.house_id = NEW.house_id or p.is_admin);

  return NEW;
end;
$$;
drop trigger if exists trg_notif_house_stay_created on public.house_stays;
create trigger trg_notif_house_stay_created after insert on public.house_stays
  for each row execute function public.notif_on_house_stay_created();

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Live-update the calendar when anyone in the house adds/edits/cancels a stay.
alter table public.house_stays replica identity full;
do $$ begin alter publication supabase_realtime add table public.house_stays; exception when duplicate_object then null; end $$;
