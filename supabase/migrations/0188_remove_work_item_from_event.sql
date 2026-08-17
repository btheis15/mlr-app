-- 0188_remove_work_item_from_event.sql
-- The event sheet's "Work items planned" list had no way to UNLINK an item —
-- add_work_item_to_event (0050) is additive-only, and the only removal path was
-- sync_event_work_items' full-set replace (used by the standalone EventComposer
-- editor, not the quick-add flow in EventSheet/EventWorkItemPicker). Adds a
-- single-item removal RPC, gated the same as sync_event_work_items: admin OR the
-- event's own creator (migration 0187's doctrine). This only unlinks the item
-- from the event — it never deletes the work item itself from the checklist.
-- Apply after 0187.

create or replace function public.remove_work_item_from_event(
  p_event_id     text,
  p_work_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := exists (select 1 from public.profiles where id = v_uid and is_admin);
  v_creator  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = ''
    then raise exception 'Event ID required'; end if;

  begin
    select created_by into v_creator from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_creator := null; -- a seed/synthesized event id isn't a real uuid
  end;

  if not v_is_admin and (v_creator is null or v_creator is distinct from v_uid) then
    raise exception 'Only the event''s creator or an admin can remove work items';
  end if;

  delete from public.event_work_items
  where event_id = p_event_id and work_item_id = p_work_item_id;
end;
$$;
revoke all on function public.remove_work_item_from_event(text, uuid) from public, anon;
grant execute on function public.remove_work_item_from_event(text, uuid) to authenticated;
