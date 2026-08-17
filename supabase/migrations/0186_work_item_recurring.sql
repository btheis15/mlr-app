-- 0186_work_item_recurring.sql
-- Recurring work items: a task like "stain the deck" that comes due every
-- N years (1-15) shouldn't just vanish once checked off — it should quietly
-- reappear as a fresh open item so people can plan ahead. Rather than firing
-- it back up on the exact anniversary (which would surface it mid-summer,
-- after the planning window for that year has already passed), the reappear
-- date is always January 1st of the year it's next due — so a deck stained in
-- August 2026 on a 3-year cycle resurfaces Jan 1 2029, well before that
-- summer. Deliberately NO notification on the auto-created item (that would
-- mean a burst of "new work item" pings every time something recurs) — the
-- `mlr.skip_work_item_notify` GUC bypass mirrors the `mlr.mod_bypass` idiom
-- used elsewhere in this app to suppress a trigger's normal side effect for
-- one specific, deliberate write. Apply after 0185.

alter table public.work_items
  add column if not exists recur_every_years integer check (recur_every_years between 1 and 15),
  add column if not exists surface_on date;

-- ── create_work_item — now with p_recur_every_years ──────────────────────────
create or replace function public.create_work_item(
  p_title             text,
  p_notes             text    default null,
  p_category          text    default null,
  p_people_needed     integer default null,
  p_house_id          uuid    default null,
  p_urgency           text    default null,
  p_custom_label      text    default null,
  p_custom_color      text    default null,
  p_recur_every_years integer default null
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
  if p_recur_every_years is not null and (p_recur_every_years < 1 or p_recur_every_years > 15)
    then raise exception 'Recurs every must be between 1 and 15 years'; end if;

  insert into public.work_items (title, notes, category, people_needed, house_id, urgency, custom_label, custom_color, recur_every_years, created_by)
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    p_people_needed,
    p_house_id,
    p_urgency,
    case when p_urgency = 'custom' then btrim(p_custom_label) else null end,
    case when p_urgency = 'custom' then p_custom_color else null end,
    p_recur_every_years,
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_work_item(text, text, text, integer, uuid, text, text, text, integer) from public, anon;
grant execute on function public.create_work_item(text, text, text, integer, uuid, text, text, text, integer) to authenticated;

-- ── update_work_item — admin OR the item's author, now with p_recur_every_years ─
create or replace function public.update_work_item(
  p_id                uuid,
  p_title             text,
  p_notes             text    default null,
  p_category          text    default null,
  p_status            text    default 'open',
  p_people_needed     integer default null,
  p_house_id          uuid    default null,
  p_urgency           text    default null,
  p_custom_label      text    default null,
  p_custom_color      text    default null,
  p_recur_every_years integer default null
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
  if p_recur_every_years is not null and (p_recur_every_years < 1 or p_recur_every_years > 15)
    then raise exception 'Recurs every must be between 1 and 15 years'; end if;
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
    title              = btrim(p_title),
    notes              = nullif(btrim(coalesce(p_notes, '')), ''),
    category           = nullif(btrim(coalesce(p_category, '')), ''),
    status             = p_status,
    people_needed      = p_people_needed,
    house_id           = p_house_id,
    urgency            = p_urgency,
    custom_label       = case when p_urgency = 'custom' then btrim(p_custom_label) else null end,
    custom_color       = case when p_urgency = 'custom' then p_custom_color else null end,
    recur_every_years  = p_recur_every_years,
    updated_at         = now()
  where id = p_id;
end;
$$;
revoke all on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text, text, text, integer) from public, anon;
grant execute on function public.update_work_item(uuid, text, text, text, text, integer, uuid, text, text, text, integer) to authenticated;

-- Drop the prior (0185) signatures so they don't shadow the new ones.
drop function if exists public.create_work_item(text, text, text, integer, uuid, text, text, text);
drop function if exists public.update_work_item(uuid, text, text, text, text, integer, uuid, text, text, text);

-- ── mark_work_item_done — same signature as 0088, now spawns the next cycle ──
-- for a recurring item. The clone lands Jan 1 of the year it's next due
-- (checked-off year + recur_every_years), open, carrying the same
-- recur_every_years so the cycle repeats indefinitely. Notification is
-- suppressed for this one insert via the mlr.skip_work_item_notify GUC —
-- see notif_on_work_item_created() below.
create or replace function public.mark_work_item_done(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house        uuid;
  v_recur        integer;
  v_title        text;
  v_notes        text;
  v_category     text;
  v_people       integer;
  v_urgency      text;
  v_custom_label text;
  v_custom_color text;
  v_created_by   uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select house_id, recur_every_years, title, notes, category, people_needed,
         urgency, custom_label, custom_color, created_by
    into v_house, v_recur, v_title, v_notes, v_category, v_people,
         v_urgency, v_custom_label, v_custom_color, v_created_by
    from public.work_items where id = p_id;
  if not found then raise exception 'Item not found'; end if;
  if v_house is not null and not public.is_house_member(v_house)
    then raise exception 'Not a member of this house'; end if;

  update public.work_items
  set status = 'done', completed_by = auth.uid(), completed_at = now(), updated_at = now()
  where id = p_id and status = 'open';

  if found and v_recur is not null then
    perform set_config('mlr.skip_work_item_notify', 'true', true);
    insert into public.work_items (
      title, notes, category, people_needed, house_id, urgency, custom_label, custom_color,
      recur_every_years, surface_on, created_by
    ) values (
      v_title, v_notes, v_category, v_people, v_house, v_urgency, v_custom_label, v_custom_color,
      v_recur, make_date(extract(year from now())::int + v_recur, 1, 1), v_created_by
    );
  end if;
end;
$$;
revoke all on function public.mark_work_item_done(uuid) from public, anon;
grant execute on function public.mark_work_item_done(uuid) to authenticated;

-- ── notif_on_work_item_created — recreated verbatim from 0070, plus the bypass ─
create or replace function public.notif_on_work_item_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_title text;
  v_house text;
  v_body  text;
  v_url   text;
begin
  if coalesce(current_setting('mlr.skip_work_item_notify', true), '') = 'true' then
    return NEW;
  end if;

  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_actor
    from public.profiles where id = NEW.created_by;
  v_title := left(coalesce(NEW.title, 'a work item'), 80);
  v_body  := nullif(left(coalesce(NEW.notes, ''), 140), '');
  v_url   := '/?work=' || NEW.id;

  if NEW.house_id is null then
    perform public._notify(
      p.id, 'work_item_created', NEW.created_by,
      v_actor || ' added "' || v_title || '" to the checklist', v_body, v_url,
      'work_item', NEW.id, null)
    from public.profiles p
    where p.id <> NEW.created_by;
  else
    select name into v_house from public.houses where id = NEW.house_id;
    perform public._notify(
      p.id, 'work_item_created', NEW.created_by,
      v_actor || ' added "' || v_title || '" to ' || coalesce(v_house, 'the house') || '''s checklist', v_body, v_url,
      'work_item', NEW.id, null)
    from public.profiles p
    where p.id <> NEW.created_by
      and (p.house_id = NEW.house_id or p.is_admin);
  end if;

  return NEW;
end;
$$;
