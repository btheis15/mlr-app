-- 0049_work_item_people_needed.sql
-- Adds an optional "how many people needed" count to work_items, and re-creates
-- the create_work_item / update_work_item RPCs to accept the new parameter.

alter table public.work_items
  add column if not exists people_needed integer check (people_needed > 0);

-- Re-create create_work_item with p_people_needed.
create or replace function public.create_work_item(
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_people_needed integer default null
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

  insert into public.work_items (title, notes, category, people_needed, created_by)
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_people_needed,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_work_item(text, text, text, integer) from public, anon;
grant execute on function public.create_work_item(text, text, text, integer) to authenticated;

-- Re-create update_work_item with p_people_needed.
create or replace function public.update_work_item(
  p_id            uuid,
  p_title         text,
  p_notes         text    default null,
  p_category      text    default null,
  p_status        text    default 'open',
  p_people_needed integer default null
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

  update public.work_items
  set
    title          = btrim(p_title),
    notes          = nullif(btrim(coalesce(p_notes, '')), ''),
    category       = nullif(btrim(coalesce(p_category, '')), ''),
    status         = p_status,
    people_needed  = p_people_needed,
    updated_at     = now()
  where id = p_id;

  if not found then raise exception 'Item not found'; end if;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer) to authenticated;

-- Drop the old 5-arg signatures so they don't shadow the new ones.
drop function if exists public.create_work_item(text, text, text);
drop function if exists public.update_work_item(uuid, text, text, text, text);
