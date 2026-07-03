-- 0069_work_item_urgency.sql
-- Add an urgency rating to work items so the list can distinguish "nice to have"
-- from "must happen this year" from "ASAP". Nullable (unrated) — the composer
-- defaults new items to 'this_year'. Re-creates create_work_item / update_work_item
-- (last touched in 0066) to thread p_urgency. Apply after 0068.

alter table public.work_items
  add column if not exists urgency text check (urgency in ('asap','this_year','nice_to_have'));

-- ── create_work_item — now with p_urgency ────────────────────────────────────
create or replace function public.create_work_item(
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_people_needed integer default null,
  p_house_id      uuid    default null,
  p_urgency       text    default null
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
  if p_urgency is not null and p_urgency not in ('asap','this_year','nice_to_have')
    then raise exception 'Invalid urgency'; end if;

  insert into public.work_items (title, notes, category, people_needed, house_id, urgency, created_by)
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_people_needed,
    p_house_id,
    p_urgency,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_work_item(text, text, text, integer, uuid, text) from public, anon;
grant execute on function public.create_work_item(text, text, text, integer, uuid, text) to authenticated;

-- ── update_work_item — admin only, now with p_urgency ────────────────────────
create or replace function public.update_work_item(
  p_id            uuid,
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_status        text    default 'open',
  p_people_needed integer default null,
  p_house_id      uuid    default null,
  p_urgency       text    default null
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
  if p_urgency is not null and p_urgency not in ('asap','this_year','nice_to_have')
    then raise exception 'Invalid urgency'; end if;

  update public.work_items
  set
    title          = btrim(p_title),
    notes          = nullif(btrim(coalesce(p_notes, '')), ''),
    category       = nullif(btrim(coalesce(p_category, '')), ''),
    status         = p_status,
    people_needed  = p_people_needed,
    house_id       = p_house_id,
    urgency        = p_urgency,
    updated_at     = now()
  where id = p_id;

  if not found then raise exception 'Item not found'; end if;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text) to authenticated;

-- Drop the prior (0066) signatures so they don't shadow the new ones.
drop function if exists public.create_work_item(text, text, text, integer, uuid);
drop function if exists public.update_work_item(uuid, text, text, text, text, integer, uuid);
