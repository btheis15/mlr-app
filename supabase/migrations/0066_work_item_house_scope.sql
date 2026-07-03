-- 0066_work_item_house_scope.sql
-- Scope work items to a house. Until now the checklist was one flat, resort-wide
-- ("MLR") list, public-read. This adds an optional house_id:
--   • house_id IS NULL  → an MLR / resort-wide item. Everyone sees it (guests too),
--                         exactly like before. This is the default; MLR is the
--                         universal baseline every member always belongs to.
--   • house_id = <house> → a house-only item (e.g. "MJT House → sweep off the roof"),
--                         visible only to that house's members (and admins).
--
-- The unified "Work things to do" list stays one list, sectioned client-side into
-- an MLR section + the viewer's house section. Read access is enforced in the DB:
-- the old `using(true)` read policy is replaced so house items never leak to
-- non-members, while MLR items stay publicly browsable. Writes keep going through
-- the SECURITY DEFINER RPCs, now house-aware. Apply after 0065.

-- ── The scope column ─────────────────────────────────────────────────────────
-- on delete cascade: deleting a house removes its house-only items (its members
-- keep all MLR items, which are house_id null and untouched).
alter table public.work_items
  add column if not exists house_id uuid references public.houses (id) on delete cascade;

create index if not exists work_items_house_idx on public.work_items (house_id);

-- ── Read policy: MLR items public; house items members-only ───────────────────
drop policy if exists "work_items: public read" on public.work_items;
create policy "work_items: scoped read" on public.work_items for select
  using (house_id is null or public.is_house_member(house_id));

-- ── RPC: create_work_item — MLR (any member) or a house you belong to ─────────
-- Re-created with a trailing p_house_id. Null → MLR item (any signed-in member,
-- unchanged). Non-null → require membership in that house (admins pass via
-- is_house_member). Drops the 0049 4-arg signature at the end.
create or replace function public.create_work_item(
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_people_needed integer default null,
  p_house_id      uuid    default null
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
  if p_people_needed is not null and p_people_needed < 1
    then raise exception 'People needed must be at least 1'; end if;
  if p_house_id is not null and not public.is_house_member(p_house_id)
    then raise exception 'Not a member of this house'; end if;

  insert into public.work_items (title, notes, category, people_needed, house_id, created_by)
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_people_needed,
    p_house_id,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_work_item(text, text, text, integer, uuid) from public, anon;
grant execute on function public.create_work_item(text, text, text, integer, uuid) to authenticated;

-- ── RPC: mark_work_item_done — anyone who can see the item ────────────────────
-- Re-created to gate on visibility: MLR items (house_id null) → any signed-in
-- member (unchanged); house items → only that house's members (or admin). Because
-- this runs SECURITY DEFINER (bypassing RLS), the check is explicit.
create or replace function public.mark_work_item_done(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_found boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select house_id into v_house from public.work_items where id = p_id;
  if not found then raise exception 'Item not found'; end if;
  if v_house is not null and not public.is_house_member(v_house)
    then raise exception 'Not a member of this house'; end if;

  update public.work_items
  set status = 'done', updated_at = now()
  where id = p_id and status = 'open';

  if not found then raise exception 'Item not found or already done'; end if;
end;
$$;
revoke all on function public.mark_work_item_done(uuid) from public, anon;
grant execute on function public.mark_work_item_done(uuid) to authenticated;

-- ── RPC: update_work_item — admin only, now house-aware ──────────────────────
-- Re-created with a trailing p_house_id so an admin can re-scope an item (e.g.
-- move an MLR item into a house, or vice-versa). Drops the 0049 6-arg signature.
create or replace function public.update_work_item(
  p_id            uuid,
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_status        text    default 'open',
  p_people_needed integer default null,
  p_house_id      uuid    default null
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
  if p_people_needed is not null and p_people_needed < 1
    then raise exception 'People needed must be at least 1'; end if;
  if p_house_id is not null and not exists (select 1 from public.houses h where h.id = p_house_id)
    then raise exception 'House not found'; end if;

  update public.work_items
  set
    title          = btrim(p_title),
    notes          = nullif(btrim(coalesce(p_notes, '')), ''),
    category       = nullif(btrim(coalesce(p_category, '')), ''),
    status         = p_status,
    people_needed  = p_people_needed,
    house_id       = p_house_id,
    updated_at     = now()
  where id = p_id;

  if not found then raise exception 'Item not found'; end if;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer, uuid) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer, uuid) to authenticated;

-- Drop the old signatures so they don't shadow the new house-aware ones.
drop function if exists public.create_work_item(text, text, text, integer);
drop function if exists public.update_work_item(uuid, text, text, text, text, integer);
