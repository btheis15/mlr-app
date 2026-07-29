-- 0165_signup_notify_real_time.sql
--
-- Bug: the manual "🔔 Notify this slot" send (migrations 0158 → 0159) always
-- worded its notification off the SENDER's chosen lead-time chip ("Starts in
-- 15 min" / "Starts in 30 min" / …) with zero connection to the slot's real,
-- stored day + time — by design, per 0158's own header ("descriptive only...
-- doesn't touch the dedup ledger"). That's exactly what let a coordinator
-- click the wrong chip (or the wrong slot's button) and send "starts in 30
-- minutes" for a slot that was actually a full day away — a member gets
-- buzzed with a lead time that doesn't line up with the real slot time at
-- all, and has no way to tell from the notification alone.
--
-- Fix: resolve the SAME real instant run_signup_reminders() computes (the
-- slot's actual day + start_time, Central/America/Chicago, DST-safe) and
-- state it plainly in the message — "starts Wed, Jul 30 at 3:00 PM" — instead
-- of trusting the sender's manual minutes label. `p_minutes` is kept (the
-- client still sends it, and it still keys the email dedup row) but no
-- longer drives the notification's wording; when a real day/time can't be
-- resolved (an activity's interval-mode slot with no day) the old
-- minutes-driven phrasing is the only thing available, so it stays as the
-- fallback.
--
-- Recreated from 0159's current (6-arg) body verbatim, per the 0160 lesson:
-- always diff against the CURRENT production definition, never an older
-- migration's copy-pasted one.

create or replace function public.send_signup_slot_reminder_now(
  p_kind text, p_item uuid, p_slot_id uuid, p_slot_start text, p_minutes int default null, p_email boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title  text;
  v_url    text;
  v_names  text;
  v_lead   text;
  v_day    text;
  v_start  text;
  v_when   timestamptz;
  v_phrase text;
  v_count  int := 0;
  r        record;
begin
  if p_kind not in ('schedule', 'activity') then
    raise exception 'Invalid kind';
  end if;

  if p_kind = 'schedule' then
    if not public._can_manage_item_signups(p_item) then
      raise exception 'Not authorized';
    end if;
    select title into v_title from public.fest_schedule_items where id = p_item;
    if p_slot_id is not null then
      select sl.day, sl.start_time into v_day, v_start from public.fest_schedule_slots sl where sl.id = p_slot_id;
    else
      select i.day::text, p_slot_start into v_day, v_start from public.fest_schedule_items i where i.id = p_item;
    end if;
  else
    if not public._can_manage_activity_item_signups(p_item) then
      raise exception 'Not authorized';
    end if;
    select title into v_title from public.fest_activities where id = p_item;
    if p_slot_id is not null then
      select sl.day, sl.start_time into v_day, v_start from public.fest_activity_slots sl where sl.id = p_slot_id;
    else
      v_day := null; -- activities have no day of their own; an interval slot has no calendar moment
      v_start := p_slot_start;
    end if;
  end if;
  if v_title is null then
    raise exception 'Not found';
  end if;

  -- Resolve the slot's real instant, same conversion run_signup_reminders()
  -- uses, so the two paths can never disagree.
  if v_day is not null and v_start is not null then
    begin
      v_when := (v_day || ' ' || v_start)::timestamp at time zone 'America/Chicago';
    exception when others then
      v_when := null;
    end;
  end if;

  v_url := case when p_kind = 'schedule' then '/family-fest/schedule/' || p_item::text else '/family-fest' end;
  v_lead := case when p_minutes is not null and p_minutes > 0 then public._humanize_minutes(p_minutes) else null end;

  -- Prefer stating the real, resolved time — never the sender's possibly
  -- mismatched lead-time chip — so the notification always lines up with the
  -- slot it's actually about. Falls back to the old descriptive phrasing only
  -- when there's no real day/time to resolve (e.g. an activity's interval
  -- slot has no calendar day at all).
  v_phrase := case
    when v_when is not null then
      'starts ' || to_char(v_when at time zone 'America/Chicago', 'Dy, Mon FMDD') || ' at '
        || to_char(v_when at time zone 'America/Chicago', 'FMHH12:MI AM')
    else
      coalesce('starts ' || v_lead, 'is coming up')
  end;

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
          then r.who || '''s ' || v_title || ' time slot ' || v_phrase || '.'
          else 'Your ' || v_title || ' time slot ' || v_phrase || '.'
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
          then r.who || '''s ' || v_title || ' time slot ' || v_phrase || '.'
          else 'Your ' || v_title || ' time slot ' || v_phrase || '.'
        end)
        || case when v_names is not null and position(',' in v_names) > 0 then ' In this slot: ' || v_names || '.' else '' end,
        v_url, 'activity', p_item, now() + interval '3 hours');
      v_count := v_count + 1;
    end loop;
  end if;

  if p_email and v_count > 0 then
    insert into public.fest_reminder_emails (kind, item_id, slot_id, slot_start, lead_minutes)
    values (p_kind, p_item, p_slot_id, p_slot_start, p_minutes)
    on conflict do nothing;
  end if;

  return v_count;
end;
$$;
revoke all on function public.send_signup_slot_reminder_now(text, uuid, uuid, text, int, boolean) from public, anon;
grant execute on function public.send_signup_slot_reminder_now(text, uuid, uuid, text, int, boolean) to authenticated;
