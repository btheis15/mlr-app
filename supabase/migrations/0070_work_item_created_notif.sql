-- 0070_work_item_created_notif.sql
-- Notify when a work item is ADDED (until now the checklist only notified on
-- comments/mentions, 0068 — a brand-new task landed silently). New kind
-- `work_item_created`, fanned out on insert into work_items:
--   • MLR item (house_id null)   → every member (resort-wide, like new_post).
--   • House item (house_id set)  → that house's members + every app admin,
--     mirroring the committee_join_request audience (0042).
-- The actor is never notified of their own item (_notify skips the actor).
-- Rides the existing Activity feed / notif_types gate (0030); default ON for
-- everyone. Apply after 0069.

-- New members get the new kind on by default.
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created}';

-- Existing members: add the new kind (ON), idempotent.
update public.profiles set notif_types = array_append(notif_types, 'work_item_created')
  where not ('work_item_created' = any(notif_types));

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
drop trigger if exists trg_notif_work_item_created on public.work_items;
create trigger trg_notif_work_item_created after insert on public.work_items
  for each row execute function public.notif_on_work_item_created();
