-- A coordinator's on-demand "your time is soon" nudge for a signup slot
-- (schedule events + activities), on top of the fully-automatic pre-configured
-- lead times from migration 0140. That system only fires reminders a creator
-- configured ahead of time, at the exact computed offset before the slot's
-- real date/time — there was no way to just tell everyone in a slot "hey,
-- it's coming up" right now (e.g. the coordinator forgot to set up lead times,
-- the schedule slipped, or they just want to nudge people a specific slot is
-- close). This RPC sends the exact same `signup_reminder` notification (reuses
-- the notif type + push override wired in 0140 — no new prefs/push plumbing)
-- immediately, to everyone signed up for ONE slot, gated by the same
-- "creator" predicate as the rest of the signup feature (can_edit_fest() OR
-- the item's own lead/crew).
--
-- The lead-time text (`p_minutes`, e.g. 60 -> "in 1 hour") is descriptive only
-- — the coordinator picks whatever best describes how soon the slot actually
-- is. This send is immediate and manual, not computed off the slot's stored
-- time, so it doesn't touch the fest_signup_reminders_sent dedup ledger the
-- automatic cron uses.

create or replace function public.send_signup_slot_reminder_now(
  p_kind text, p_item uuid, p_slot_id uuid, p_slot_start text, p_minutes int default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_url   text;
  v_names text;
  v_lead  text;
  v_count int := 0;
  r       record;
begin
  if p_kind not in ('schedule', 'activity') then
    raise exception 'Invalid kind';
  end if;

  if p_kind = 'schedule' then
    if not public._can_manage_item_signups(p_item) then
      raise exception 'Not authorized';
    end if;
    select title into v_title from public.fest_schedule_items where id = p_item;
  else
    if not public._can_manage_activity_item_signups(p_item) then
      raise exception 'Not authorized';
    end if;
    select title into v_title from public.fest_activities where id = p_item;
  end if;
  if v_title is null then
    raise exception 'Not found';
  end if;

  v_url := case when p_kind = 'schedule' then '/family-fest/schedule/' || p_item::text else '/family-fest' end;
  v_lead := case when p_minutes is not null and p_minutes > 0 then public._humanize_minutes(p_minutes) else null end;

  if p_kind = 'schedule' then
    select string_agg(s.name, ', ' order by s.created_at) into v_names
    from public.fest_schedule_signups s
    where s.schedule_item_id = p_item
      and ((p_slot_id is not null and s.slot_id = p_slot_id)
        or (p_slot_id is null and s.slot_id is null and s.slot_start is not distinct from p_slot_start));

    for r in
      select coalesce(s.user_id, s.added_by) as recipient,
             (s.user_id is null) as is_write_in, s.name as who
      from public.fest_schedule_signups s
      where s.schedule_item_id = p_item
        and ((p_slot_id is not null and s.slot_id = p_slot_id)
          or (p_slot_id is null and s.slot_id is null and s.slot_start is not distinct from p_slot_start))
        and coalesce(s.user_id, s.added_by) is not null
    loop
      perform public._notify(
        r.recipient, 'signup_reminder', null,
        'Sign-up reminder: ' || v_title,
        (case when r.is_write_in
          then r.who || '''s ' || v_title || ' time slot ' || coalesce('starts ' || v_lead, 'is coming up') || '.'
          else 'Your ' || v_title || ' time slot ' || coalesce('starts ' || v_lead, 'is coming up') || '.'
        end)
        || case when v_names is not null and position(',' in v_names) > 0 then ' In this slot: ' || v_names || '.' else '' end,
        v_url, 'schedule', p_item, now() + interval '3 hours');
      v_count := v_count + 1;
    end loop;
  else
    select string_agg(s.name, ', ' order by s.created_at) into v_names
    from public.fest_activity_signups s
    where s.activity_id = p_item
      and ((p_slot_id is not null and s.slot_id = p_slot_id)
        or (p_slot_id is null and s.slot_id is null and s.slot_start is not distinct from p_slot_start));

    for r in
      select coalesce(s.user_id, s.added_by) as recipient,
             (s.user_id is null) as is_write_in, s.name as who
      from public.fest_activity_signups s
      where s.activity_id = p_item
        and ((p_slot_id is not null and s.slot_id = p_slot_id)
          or (p_slot_id is null and s.slot_id is null and s.slot_start is not distinct from p_slot_start))
        and coalesce(s.user_id, s.added_by) is not null
    loop
      perform public._notify(
        r.recipient, 'signup_reminder', null,
        'Sign-up reminder: ' || v_title,
        (case when r.is_write_in
          then r.who || '''s ' || v_title || ' time slot ' || coalesce('starts ' || v_lead, 'is coming up') || '.'
          else 'Your ' || v_title || ' time slot ' || coalesce('starts ' || v_lead, 'is coming up') || '.'
        end)
        || case when v_names is not null and position(',' in v_names) > 0 then ' In this slot: ' || v_names || '.' else '' end,
        v_url, 'activity', p_item, now() + interval '3 hours');
      v_count := v_count + 1;
    end loop;
  end if;

  return v_count;
end;
$$;
revoke all on function public.send_signup_slot_reminder_now(text, uuid, uuid, text, int) from public, anon;
grant execute on function public.send_signup_slot_reminder_now(text, uuid, uuid, text, int) to authenticated;
