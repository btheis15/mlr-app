-- 0048_work_items.sql
-- Work items checklist: a shared list of things that need to be done around the
-- resort. Any signed-in member can add items; admins can edit, delete, and mark
-- done. Items can also be attached to events so attendees know what's planned for
-- a work weekend (or any gathering), which helps more people show up to pitch in.
--
-- Two tables:
--   work_items       — the master checklist (public-read, like events)
--   event_work_items — many-to-many: which items are planned for which event
--                      (TEXT event_id, not FK — same trick as event_attendance,
--                       so seed events like Family Fest can carry work items too)
--
-- RPCs (SECURITY DEFINER):
--   create_work_item(p_title, p_notes, p_category) → uuid  (any signed-in member)
--   update_work_item(p_id, p_title, p_notes, p_category, p_status) → void  (admin)
--   delete_work_item(p_id) → void  (admin)
--   sync_event_work_items(p_event_id, p_item_ids) → void  (admin)
--     Replaces the full set of items attached to an event in one idempotent call.
--     Safe to call with an empty array to clear all links.

-- ── Table: work_items ─────────────────────────────────────────────────────────

create table if not exists public.work_items (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null,
  notes       text,                                        -- optional extra detail
  category    text,                                        -- free-form tag, e.g. "Cabin", "Grounds"
  status      text        not null default 'open',         -- 'open' | 'done'
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists work_items_status_idx on public.work_items (status, created_at desc);

alter table public.work_items enable row level security;

-- Public read — consistent with events + event_attendance being public-read.
-- The resort checklist is informational and non-sensitive.
drop policy if exists "work_items: public read" on public.work_items;
create policy "work_items: public read" on public.work_items
  for select using (true);

-- ── Table: event_work_items ───────────────────────────────────────────────────

create table if not exists public.event_work_items (
  event_id     text        not null,            -- TEXT (not FK) — allows seed events
  work_item_id uuid        not null references public.work_items(id) on delete cascade,
  added_by     uuid        references public.profiles(id) on delete set null,
  added_at     timestamptz not null default now(),
  primary key (event_id, work_item_id)
);

create index if not exists event_work_items_event_idx on public.event_work_items (event_id);

alter table public.event_work_items enable row level security;

drop policy if exists "event_work_items: public read" on public.event_work_items;
create policy "event_work_items: public read" on public.event_work_items
  for select using (true);

-- ── RPC: create_work_item — any signed-in member ─────────────────────────────

create or replace function public.create_work_item(
  p_title    text,
  p_notes    text    default null,
  p_category text    default null
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
  if coalesce(btrim(p_title), '') = '' then raise exception 'Title is required'; end if;

  insert into public.work_items (title, notes, category, created_by)
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_work_item(text, text, text) from public, anon;
grant execute on function public.create_work_item(text, text, text) to authenticated;

-- ── RPC: update_work_item — admin only ───────────────────────────────────────

create or replace function public.update_work_item(
  p_id       uuid,
  p_title    text,
  p_notes    text    default null,
  p_category text    default null,
  p_status   text    default 'open'
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
  if not exists (select 1 from public.profiles where id = v_uid and is_admin)
    then raise exception 'Admin required'; end if;
  if p_status not in ('open', 'done')
    then raise exception 'Invalid status'; end if;
  if coalesce(btrim(p_title), '') = ''
    then raise exception 'Title is required'; end if;

  update public.work_items
  set
    title      = btrim(p_title),
    notes      = nullif(btrim(coalesce(p_notes, '')), ''),
    category   = nullif(btrim(coalesce(p_category, '')), ''),
    status     = p_status,
    updated_at = now()
  where id = p_id;

  if not found then raise exception 'Item not found'; end if;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text) to authenticated;

-- ── RPC: delete_work_item — admin only ───────────────────────────────────────

create or replace function public.delete_work_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin)
    then raise exception 'Admin required'; end if;

  delete from public.work_items where id = p_id;
end;
$$;
revoke all on function public.delete_work_item(uuid) from public, anon;
grant execute on function public.delete_work_item(uuid) to authenticated;

-- ── RPC: sync_event_work_items — admin only ───────────────────────────────────
-- Replaces the full set of work items attached to an event atomically. Call with
-- an empty array to clear all links for the event.

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
  if not exists (select 1 from public.profiles where id = v_uid and is_admin)
    then raise exception 'Admin required'; end if;
  if coalesce(btrim(p_event_id), '') = ''
    then raise exception 'Event ID required'; end if;

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

-- ── RPC: mark_work_item_done — any signed-in member ─────────────────────────
-- Any member can check off an item once the work is done. Admins can re-open an
-- item via update_work_item (status → 'open').

create or replace function public.mark_work_item_done(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  update public.work_items
  set status = 'done', updated_at = now()
  where id = p_id and status = 'open';

  if not found then raise exception 'Item not found or already done'; end if;
end;
$$;
revoke all on function public.mark_work_item_done(uuid) from public, anon;
grant execute on function public.mark_work_item_done(uuid) to authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────────

alter table public.work_items replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.work_items;
exception when duplicate_object then null; end $$;

alter table public.event_work_items replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.event_work_items;
exception when duplicate_object then null; end $$;
