-- 0079_work_item_author_edit.sql
-- Let the person who CREATED a work item edit their own item, in addition to
-- admins. Editing *any* item stays admin-only; this only widens the guard so an
-- author isn't locked out of the task they submitted. Re-creates update_work_item
-- (last touched in 0069) to swap the "admin only" check for "admin OR author".
-- Delete stays admin-only (delete_work_item is unchanged). Apply after 0078.

-- ── update_work_item — admin OR the item's author ────────────────────────────
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
  if p_urgency is not null and p_urgency not in ('asap','this_year','nice_to_have')
    then raise exception 'Invalid urgency'; end if;
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
    updated_at     = now()
  where id = p_id;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text) to authenticated;
