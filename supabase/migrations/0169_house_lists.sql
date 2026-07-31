-- 0169_house_lists.sql
-- House Lists: shared lists for a house (0064) — groceries for the weekend, a
-- cabin close-up checklist, "stuff to fix", a packing list. Anyone in the house
-- can create a list and add, check off, edit, or delete ANY item on it (this is
-- a shared scratchpad, not a per-person to-do; the house's work items — 0066 —
-- remain the tracked, author-owned surface).
--
-- ONE flexible list shape, deliberately: a list is a title + items, and every
-- item can be checked off. A shopping list and a checklist are then the same
-- thing (you check items as you get/do them), so there's no "kind" to pick at
-- creation time and one code path serves any kind of list.
--
-- Data model mirrors the other house-scoped features (chat 0065, work items
-- 0066, calendar 0071):
--   • house_lists        — one row per list, scoped to a house.
--   • house_list_items   — one row per item; carries a DENORMALIZED house_id so
--                          its RLS read and the client's Realtime filter can both
--                          key off the house directly (kept honest by the RPCs,
--                          which always copy it from the parent list, plus a
--                          trigger that re-derives it defensively).
--   • RLS read = is_house_member(...) on both (private to the house + admins).
--   • Writes go through SECURITY DEFINER RPCs. Unlike stays (own-row only),
--     ANY member may mutate ANY list/item in their house — that's the point.
--     Admins pass too (is_house_member returns true for them).
--   • NO notifications, by design: a grocery run would spam the whole house.
--     Lists are a quiet pull-only surface, kept live by Realtime while open.
--
-- Apply in the Supabase SQL editor after 0168.

-- ── The lists ────────────────────────────────────────────────────────────────
create table if not exists public.house_lists (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  emoji       text not null default '📝',   -- a small visual handle ("🛒", "✅")
  note        text,                         -- optional one-liner of context
  position    int  not null default 0,      -- manual order; ties break on created_at
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists house_lists_house_idx on public.house_lists (house_id, position, created_at);

alter table public.house_lists enable row level security;

-- Only this house's members (and admins) can see its lists. No client write
-- policies — every write goes through the RPCs below, so authorization lives in
-- exactly one place (the house_stays doctrine, 0071).
drop policy if exists "house_lists: member read" on public.house_lists;
create policy "house_lists: member read" on public.house_lists for select
  using (public.is_house_member(house_id));

drop trigger if exists house_lists_set_updated_at on public.house_lists;
create trigger house_lists_set_updated_at
  before update on public.house_lists
  for each row execute function public.set_updated_at();

-- ── The items ────────────────────────────────────────────────────────────────
create table if not exists public.house_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.house_lists (id) on delete cascade,
  -- Denormalized from the parent list so RLS + the Realtime filter can key off
  -- the house without a join. Always written by the RPCs from the parent list;
  -- the trigger below re-derives it so it can never drift.
  house_id    uuid not null references public.houses (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  text        text not null,
  -- Checked state, as a stamp rather than a boolean: it doubles as "who got the
  -- milk / who closed the windows, and when", which is what a house actually
  -- wants to know. null ⇒ open.
  checked_at  timestamptz,
  checked_by  uuid references public.profiles (id) on delete set null,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists house_list_items_list_idx on public.house_list_items (list_id, position, created_at);
create index if not exists house_list_items_house_idx on public.house_list_items (house_id);

alter table public.house_list_items enable row level security;

drop policy if exists "house_list_items: member read" on public.house_list_items;
create policy "house_list_items: member read" on public.house_list_items for select
  using (public.is_house_member(house_id));

drop trigger if exists house_list_items_set_updated_at on public.house_list_items;
create trigger house_list_items_set_updated_at
  before update on public.house_list_items
  for each row execute function public.set_updated_at();

-- Keep the denormalized house_id honest no matter who writes the row.
create or replace function public.house_list_item_sync_house()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select house_id into NEW.house_id from public.house_lists where id = NEW.list_id;
  if NEW.house_id is null then raise exception 'List not found'; end if;
  return NEW;
end;
$$;
-- A trigger function has no business being reachable as an RPC — revoke it from
-- every client role (the trigger still fires: it runs as the table owner, and
-- every insert arrives through a SECURITY DEFINER RPC anyway). Keeps the Supabase
-- security advisor's "anon can execute SECURITY DEFINER function" lint clean for
-- this migration.
revoke all on function public.house_list_item_sync_house() from public, anon, authenticated;

drop trigger if exists trg_house_list_item_sync_house on public.house_list_items;
create trigger trg_house_list_item_sync_house
  before insert or update of list_id on public.house_list_items
  for each row execute function public.house_list_item_sync_house();

-- ── List RPCs ────────────────────────────────────────────────────────────────
-- Create a list. Any member of the house. New lists sort to the top (a house
-- cares about what was just started), so position = min - 1.
create or replace function public.create_house_list(
  p_house uuid,
  p_title text,
  p_emoji text default '📝',
  p_note  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_pos   int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_house_member(p_house) then raise exception 'Not a member of this house'; end if;
  if v_title = '' then raise exception 'A list needs a name'; end if;

  select coalesce(min(position), 0) - 1 into v_pos
    from public.house_lists where house_id = p_house;

  insert into public.house_lists (house_id, created_by, title, emoji, note, position)
  values (
    p_house, auth.uid(), left(v_title, 120),
    coalesce(nullif(btrim(coalesce(p_emoji, '')), ''), '📝'),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_pos
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_house_list(uuid, text, text, text) from public, anon;
grant execute on function public.create_house_list(uuid, text, text, text) to authenticated;

-- Rename / retitle a list. ANY member of its house (shared surface).
create or replace function public.update_house_list(
  p_id    uuid,
  p_title text,
  p_emoji text default null,
  p_note  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_lists where id = p_id;
  if v_house is null then raise exception 'List not found'; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;
  if v_title = '' then raise exception 'A list needs a name'; end if;

  update public.house_lists set
    title = left(v_title, 120),
    emoji = coalesce(nullif(btrim(coalesce(p_emoji, '')), ''), emoji),
    note  = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id;
end;
$$;
revoke all on function public.update_house_list(uuid, text, text, text) from public, anon;
grant execute on function public.update_house_list(uuid, text, text, text) to authenticated;

-- Delete a list (its items cascade). ANY member of its house.
create or replace function public.delete_house_list(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_lists where id = p_id;
  if v_house is null then return; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;
  delete from public.house_lists where id = p_id;
end;
$$;
revoke all on function public.delete_house_list(uuid) from public, anon;
grant execute on function public.delete_house_list(uuid) to authenticated;

-- ── Item RPCs ────────────────────────────────────────────────────────────────
-- Add an item to the end of a list. ANY member of the list's house.
create or replace function public.add_house_list_item(p_list uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_text  text := btrim(coalesce(p_text, ''));
  v_id    uuid;
  v_pos   int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_lists where id = p_list;
  if v_house is null then raise exception 'List not found'; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;
  if v_text = '' then raise exception 'An item needs some text'; end if;

  select coalesce(max(position), 0) + 1 into v_pos
    from public.house_list_items where list_id = p_list;

  insert into public.house_list_items (list_id, house_id, created_by, text, position)
  values (p_list, v_house, auth.uid(), left(v_text, 300), v_pos)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_house_list_item(uuid, text) from public, anon;
grant execute on function public.add_house_list_item(uuid, text) to authenticated;

-- Edit an item's text. ANY member of the list's house.
create or replace function public.update_house_list_item(p_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_text  text := btrim(coalesce(p_text, ''));
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_list_items where id = p_id;
  if v_house is null then raise exception 'Item not found'; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;
  if v_text = '' then raise exception 'An item needs some text'; end if;

  update public.house_list_items set text = left(v_text, 300) where id = p_id;
end;
$$;
revoke all on function public.update_house_list_item(uuid, text) from public, anon;
grant execute on function public.update_house_list_item(uuid, text) to authenticated;

-- Check / uncheck an item. ANY member of the list's house — the person who got
-- the milk is rarely the person who wrote it down. Stamps who + when (checked_by
-- is cleared on uncheck so the stamp never lies).
create or replace function public.set_house_list_item_checked(p_id uuid, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_list_items where id = p_id;
  if v_house is null then raise exception 'Item not found'; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;

  update public.house_list_items set
    checked_at = case when p_checked then now() else null end,
    checked_by = case when p_checked then auth.uid() else null end
  where id = p_id;
end;
$$;
revoke all on function public.set_house_list_item_checked(uuid, boolean) from public, anon;
grant execute on function public.set_house_list_item_checked(uuid, boolean) to authenticated;

-- Delete one item. ANY member of the list's house.
create or replace function public.delete_house_list_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_list_items where id = p_id;
  if v_house is null then return; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;
  delete from public.house_list_items where id = p_id;
end;
$$;
revoke all on function public.delete_house_list_item(uuid) from public, anon;
grant execute on function public.delete_house_list_item(uuid) to authenticated;

-- Sweep every checked item off a list in one tap — the natural "we're home from
-- the store" gesture, so a recurring shopping list doesn't have to be rebuilt
-- item by item. Returns how many were cleared. ANY member of the list's house.
create or replace function public.clear_checked_house_list_items(p_list uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_lists where id = p_list;
  if v_house is null then raise exception 'List not found'; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;

  with gone as (
    delete from public.house_list_items
    where list_id = p_list and checked_at is not null
    returning 1
  )
  select count(*) into v_count from gone;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.clear_checked_house_list_items(uuid) from public, anon;
grant execute on function public.clear_checked_house_list_items(uuid) to authenticated;

-- Uncheck every item on a list — the other half of the recurring-list story: a
-- cabin close-up checklist gets reused next trip rather than cleared.
create or replace function public.uncheck_house_list_items(p_list uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select house_id into v_house from public.house_lists where id = p_list;
  if v_house is null then raise exception 'List not found'; end if;
  if not public.is_house_member(v_house) then raise exception 'Not a member of this house'; end if;

  with back as (
    update public.house_list_items set checked_at = null, checked_by = null
    where list_id = p_list and checked_at is not null
    returning 1
  )
  select count(*) into v_count from back;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.uncheck_house_list_items(uuid) from public, anon;
grant execute on function public.uncheck_house_list_items(uuid) to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Two people at the store with the app open both see items check off live.
alter table public.house_lists replica identity full;
alter table public.house_list_items replica identity full;
do $$ begin alter publication supabase_realtime add table public.house_lists; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.house_list_items; exception when duplicate_object then null; end $$;
