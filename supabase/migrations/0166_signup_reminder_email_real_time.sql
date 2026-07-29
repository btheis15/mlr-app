-- 0166_signup_reminder_email_real_time.sql
--
-- Follow-up to 0165, which fixed the manual "🔔 Notify this slot" send's
-- in-app/push wording to state the slot's REAL day + time (Central) instead of
-- echoing the sender's chosen lead-time chip. Two loose ends from that change:
--
-- 1. The EMAIL half of the same send still worded itself off `lead_minutes`
--    ("Your … time slot starts in 30 minutes"). With the chips now gone from
--    the UI (a manual send always passes null minutes), that email degraded to
--    a vague "is coming up" — not wrong, but it no longer tells anyone WHEN.
--    `signup_reminder_email_recipients` now also returns the slot's resolved
--    instant (`slot_when`), so the mini's alert-mailer can state the real time
--    the same way the notification does. The automatic cron path still passes
--    a real `lead_minutes`, so its "starts in 30 minutes" wording — which was
--    always correct there, since the cron fires AT that offset — is unchanged.
--
-- 2. The email dedup index keys on `coalesce(lead_minutes, -1)`. With manual
--    sends now always passing null, every manual email for a given slot
--    collapsed onto ONE row forever — so a coordinator who legitimately
--    re-sent a nudge later got the push but silently no email. The manual
--    insert now re-queues the existing row (clearing `sent_at`) when it's
--    older than 90 seconds, which keeps the index's real job — swallowing an
--    accidental double-click — while letting a deliberate re-send through.
--
-- Recreated from 0165's current body (the 0160 lesson: always diff against the
-- CURRENT production definition, never an older migration's copy).

-- ── 1. Resolve the slot's real instant for the email too ─────────────────────
-- Return type changes (a new column), so this needs a drop + create rather
-- than a plain `create or replace`.
drop function if exists public.signup_reminder_email_recipients(uuid);

create function public.signup_reminder_email_recipients(p_row uuid)
returns table(item_title text, url text, lead_minutes int, slot_when timestamptz, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  q       public.fest_reminder_emails%rowtype;
  v_day   text;
  v_start text;
  v_when  timestamptz;
begin
  select * into q from public.fest_reminder_emails where id = p_row;
  if not found then return; end if;

  -- Same resolution order as run_signup_reminders()/send_signup_slot_reminder_now:
  -- an explicit slot carries its own day; otherwise a schedule event falls back
  -- to the item's day + the interval slot_start. An activity has no day of its
  -- own, so a day-less activity slot simply has no instant to state.
  if q.kind = 'schedule' then
    if q.slot_id is not null then
      select sl.day, sl.start_time into v_day, v_start
        from public.fest_schedule_slots sl where sl.id = q.slot_id;
    else
      select i.day::text, q.slot_start into v_day, v_start
        from public.fest_schedule_items i where i.id = q.item_id;
    end if;
  else
    if q.slot_id is not null then
      select sl.day, sl.start_time into v_day, v_start
        from public.fest_activity_slots sl where sl.id = q.slot_id;
    else
      v_day := null;
      v_start := q.slot_start;
    end if;
  end if;

  if v_day is not null and v_start is not null then
    begin
      v_when := (v_day || ' ' || v_start)::timestamp at time zone 'America/Chicago';
    exception when others then
      v_when := null;
    end;
  end if;

  if q.kind = 'schedule' then
    return query
    select i.title, '/family-fest/schedule/' || i.id::text, q.lead_minutes, v_when,
      array(
        select distinct u.email::text
        from public.fest_schedule_signups s
        join public.profiles p on p.id = s.user_id
        join auth.users u on u.id = p.id
        where s.schedule_item_id = q.item_id
          and ((q.slot_id is not null and s.slot_id = q.slot_id)
            or (q.slot_id is null and s.slot_id is null and s.slot_start is not distinct from q.slot_start))
          and u.email is not null
      )
    from public.fest_schedule_items i where i.id = q.item_id;
  else
    return query
    select a.title, '/family-fest', q.lead_minutes, v_when,
      array(
        select distinct u.email::text
        from public.fest_activity_signups s
        join public.profiles p on p.id = s.user_id
        join auth.users u on u.id = p.id
        where s.activity_id = q.item_id
          and ((q.slot_id is not null and s.slot_id = q.slot_id)
            or (q.slot_id is null and s.slot_id is null and s.slot_start is not distinct from q.slot_start))
          and u.email is not null
      )
    from public.fest_activities a where a.id = q.item_id;
  end if;
end;
$$;
revoke all on function public.signup_reminder_email_recipients(uuid) from public, anon, authenticated;

-- ── 2. Let a deliberate manual re-send queue a fresh email ───────────────────
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

  if v_day is not null and v_start is not null then
    begin
      v_when := (v_day || ' ' || v_start)::timestamp at time zone 'America/Chicago';
    exception when others then
      v_when := null;
    end;
  end if;

  v_url := case when p_kind = 'schedule' then '/family-fest/schedule/' || p_item::text else '/family-fest' end;
  v_lead := case when p_minutes is not null and p_minutes > 0 then public._humanize_minutes(p_minutes) else null end;

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

  -- Re-queue rather than silently no-op: with p_minutes now always null from
  -- the UI, the dedup index would otherwise pin one email per slot forever.
  -- A repeat within 90s (a double-tap) still collapses to nothing.
  if p_email and v_count > 0 then
    insert into public.fest_reminder_emails (kind, item_id, slot_id, slot_start, lead_minutes)
    values (p_kind, p_item, p_slot_id, p_slot_start, p_minutes)
    on conflict (kind, item_id,
                 coalesce(slot_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(slot_start, ''::text),
                 coalesce(lead_minutes, -1))
    do update set sent_at = null, created_at = now()
      where public.fest_reminder_emails.created_at < now() - interval '90 seconds';
  end if;

  return v_count;
end;
$$;
revoke all on function public.send_signup_slot_reminder_now(text, uuid, uuid, text, int, boolean) from public, anon;
grant execute on function public.send_signup_slot_reminder_now(text, uuid, uuid, text, int, boolean) to authenticated;
