-- 0185_work_item_urgency_custom.sql
-- Add a "Next year" tier plus a fully custom urgency (free-text wording + a
-- picked color) so the checklist can express more specific timings than the
-- fixed ASAP / This year / Next year / Nice to have set. `urgency = 'custom'`
-- stores its label/color in two new columns; every other urgency value keeps
-- reading purely off URGENCY_META client-side (no data on the row beyond the
-- tag itself). Re-creates create_work_item / update_work_item (last touched in
-- 0079) to thread p_custom_label / p_custom_color. Apply after 0079.

alter table public.work_items
  drop constraint if exists work_items_urgency_check;

alter table public.work_items
  add constraint work_items_urgency_check
  check (urgency in ('asap','this_year','next_year','nice_to_have','custom'));

alter table public.work_items
  add column if not exists custom_label text,
  add column if not exists custom_color text
    check (custom_color in ('red','orange','yellow','green','blue','purple','gray'));

-- ── create_work_item — now with p_custom_label / p_custom_color ─────────────
create or replace function public.create_work_item(
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_people_needed integer default null,
  p_house_id      uuid    default null,
  p_urgency       text    default null,
  p_custom_label  text    default null,
  p_custom_color  text    default null
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
  if p_urgency is not null and p_urgency not in ('asap','this_year','next_year','nice_to_have','custom')
    then raise exception 'Invalid urgency'; end if;
  if p_urgency = 'custom' then
    if coalesce(btrim(p_custom_label), '') = ''
      then raise exception 'Custom urgency needs a label'; end if;
    if p_custom_color is null or p_custom_color not in ('red','orange','yellow','green','blue','purple','gray')
      then raise exception 'Custom urgency needs a color'; end if;
  end if;

  insert into public.work_items (title, notes, category, people_needed, house_id, urgency, custom_label, custom_color, created_by)
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_people_needed,
    p_house_id,
    p_urgency,
    case when p_urgency = 'custom' then btrim(p_custom_label) else null end,
    case when p_urgency = 'custom' then p_custom_color else null end,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_work_item(text, text, text, integer, uuid, text, text, text) from public, anon;
grant execute on function public.create_work_item(text, text, text, integer, uuid, text, text, text) to authenticated;

-- ── update_work_item — admin OR the item's author, now with custom fields ───
create or replace function public.update_work_item(
  p_id            uuid,
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_status        text    default 'open',
  p_people_needed integer default null,
  p_house_id      uuid    default null,
  p_urgency       text    default null,
  p_custom_label  text    default null,
  p_custom_color  text    default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid    := auth.uid();
  v_is_admin boolean := exists (select 1 from public.profiles where id = v_uid and is_admin);
  v_author   uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select created_by into v_author from public.work_items where id = p_id;
  if not found then raise exception 'Item not found'; end if;

  -- Admins may edit any item; everyone else only the item they created.
  if not v_is_admin and v_author is distinct from v_uid
    then raise exception 'Only the item''s creator or an admin can edit it'; end if;

  if p_status not in ('open', 'done')
    then raise exception 'Invalid status'; end if;
  if coalesce(btrim(p_title), '') = ''
    then raise exception 'Title is required'; end if;
  if p_people_needed is not null and p_people_needed < 1
    then raise exception 'People needed must be at least 1'; end if;
  if p_urgency is not null and p_urgency not in ('asap','this_year','next_year','nice_to_have','custom')
    then raise exception 'Invalid urgency'; end if;
  if p_urgency = 'custom' then
    if coalesce(btrim(p_custom_label), '') = ''
      then raise exception 'Custom urgency needs a label'; end if;
    if p_custom_color is null or p_custom_color not in ('red','orange','yellow','green','blue','purple','gray')
      then raise exception 'Custom urgency needs a color'; end if;
  end if;
  -- House scoping: a non-admin can only move an item into a house they belong to
  -- (admins may target any house). Mirrors create_work_item's membership gate.
  if p_house_id is not null then
    if not exists (select 1 from public.houses h where h.id = p_house_id)
      then raise exception 'House not found'; end if;
    if not v_is_admin and not public.is_house_member(p_house_id)
      then raise exception 'Not a member of this house'; end if;
  end if;

  update public.work_items
  set
    title          = btrim(p_title),
    notes          = nullif(btrim(coalesce(p_notes, '')), ''),
    category       = nullif(btrim(coalesce(p_category, '')), ''),
    status         = p_status,
    people_needed  = p_people_needed,
    house_id       = p_house_id,
    urgency        = p_urgency,
    custom_label   = case when p_urgency = 'custom' then btrim(p_custom_label) else null end,
    custom_color   = case when p_urgency = 'custom' then p_custom_color else null end,
    updated_at     = now()
  where id = p_id;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text, text, text) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text, text, text) to authenticated;

-- Drop the prior (0079) signatures so they don't shadow the new ones.
drop function if exists public.create_work_item(text, text, text, integer, uuid, text);
drop function if exists public.update_work_item(uuid, text, text, text, text, integer, uuid, text);
