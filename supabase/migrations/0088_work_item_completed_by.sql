-- 0088_work_item_completed_by.sql
-- Work items collapsed a "done" item into just a count — no title, no record of
-- who checked it off. Adds completed_by / completed_at so the checklist can show
-- what was done and by whom. Stamped by mark_work_item_done() on check-off, and
-- maintained by update_work_item() (admin/author edits): stamps on a fresh
-- open→done transition, clears on done→open (reopening), left untouched when an
-- already-done item is edited without changing its status.

alter table public.work_items
  add column if not exists completed_by uuid references public.profiles (id) on delete set null,
  add column if not exists completed_at timestamptz;

-- ── mark_work_item_done — same signature as 0066, now stamps who/when ────────
create or replace function public.mark_work_item_done(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select house_id into v_house from public.work_items where id = p_id;
  if not found then raise exception 'Item not found'; end if;
  if v_house is not null and not public.is_house_member(v_house)
    then raise exception 'Not a member of this house'; end if;

  update public.work_items
  set status = 'done', completed_by = auth.uid(), completed_at = now(), updated_at = now()
  where id = p_id and status = 'open';
end;
$$;
revoke all on function public.mark_work_item_done(uuid) from public, anon;
grant execute on function public.mark_work_item_done(uuid) to authenticated;

-- ── update_work_item — same signature as 0079, now maintains completed_by/at ─
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
  v_uid         uuid    := auth.uid();
  v_is_admin    boolean := exists (select 1 from public.profiles where id = v_uid and is_admin);
  v_author      uuid;
  v_prev_status text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select created_by, status into v_author, v_prev_status from public.work_items where id = p_id;
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
    completed_by   = case
                       when p_status = 'done' and v_prev_status is distinct from 'done' then v_uid
                       when p_status = 'done' then completed_by
                       else null
                     end,
    completed_at   = case
                       when p_status = 'done' and v_prev_status is distinct from 'done' then now()
                       when p_status = 'done' then completed_at
                       else null
                     end,
    updated_at     = now()
  where id = p_id;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text) to authenticated;
