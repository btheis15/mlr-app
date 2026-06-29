-- Lets any signed-in member link a single work item to an event directly from
-- the "Add work item" sheet. Unlike sync_event_work_items (which replaces the
-- full set for an event), this is purely additive — it never removes existing
-- links. Safe to call multiple times (conflicts are ignored).

create or replace function add_work_item_to_event(
  p_event_id     text,
  p_work_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;
  insert into event_work_items (event_id, work_item_id, added_by)
  values (p_event_id, p_work_item_id, auth.uid())
  on conflict (event_id, work_item_id) do nothing;
end;
$$;
