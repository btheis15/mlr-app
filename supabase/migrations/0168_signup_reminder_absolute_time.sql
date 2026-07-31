-- Sign-up reminders now state the slot's REAL day + time, not just a relative
-- lead-time phrase.
--
-- Migration 0165 fixed the MANUAL "🔔 Notify this slot" send to resolve and
-- state the slot's actual instant rather than echoing the sender's chosen chip
-- label. The automatic pg_cron reminder (0140) was deliberately left alone,
-- because "starts in 30 minutes" IS accurate there — the cron fires at exactly
-- that offset. Two things argue for stating the absolute time anyway:
--
--   1. The known wart from 0165's header: someone who signs up INSIDE the lead
--      window (2:45 for a 3:00 slot with a 30m lead) gets "starts in 30
--      minutes" on the next tick when it's really 15 away. Never an early buzz,
--      just imprecise copy — and impossible for the recipient to detect.
--   2. A relative-only reminder is unfalsifiable. When the fest UI was labeling
--      every slot a day early (`formatDate()` parsed a bare "YYYY-MM-DD" as UTC
--      midnight, so a slot stored 2026-07-31 rendered "Thu, Jul 30"), members
--      whose slot showed as yesterday got a correct-but-inexplicable reminder
--      this morning. The cron was right the whole time; nothing in the message
--      said so. Stating the resolved day+time makes any future mismatch
--      self-evident at a glance instead of a support thread.
--
-- The wording lives in ONE place now — `_format_slot_when(timestamptz)` — shared
-- by the cron and 0165's manual RPC, so the two can't drift the way
-- `moderate_content_text()` silently drifted in the 0160 incident.

-- ── Shared wording for a resolved slot instant ───────────────────────────────
-- "Fri, Jul 31 at 9:00 AM" (Central, matching the rest of the fest). Null in,
-- null out, so callers can fall back to relative phrasing for a slot with no
-- resolvable calendar moment (an activity's interval slot has no day at all).
create or replace function public._format_slot_when(p_when timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_when is null then null else
    to_char(p_when at time zone 'America/Chicago', 'Dy, Mon FMDD')
      || ' at ' || to_char(p_when at time zone 'America/Chicago', 'FMHH12:MI AM')
  end;
$$;

-- ── The pg_cron tick — unchanged except the notification body ────────────────
-- Recreated from the CURRENT production definition (the 0159 version, which
-- added the signup_reminder_email queueing) per the 0160 takeaway — NOT from
-- 0140's original body.
create or replace function public.run_signup_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_when timestamptz;
  m      int;
begin
  for r in
    with sched as (
      select s.id as signup_id, 'schedule' as kind,
             coalesce(s.user_id, s.added_by) as recipient,
             (s.user_id is null) as is_write_in, s.name as who,
             i.title, i.signup_reminder_minutes as mins, i.signup_reminder_email as email_on,
             s.schedule_item_id as item_id, s.slot_id as slot_id, s.slot_start as interval_start,
             coalesce(sl.day, i.day::text) as day,
             coalesce(sl.start_time, s.slot_start) as start_time,
             (select count(*) from public.fest_schedule_signups o
                where o.schedule_item_id = s.schedule_item_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_count,
             (select string_agg(o.name, ', ' order by o.created_at) from public.fest_schedule_signups o
                where o.schedule_item_id = s.schedule_item_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_names,
             '/family-fest/schedule/' || i.id::text as url
      from public.fest_schedule_signups s
      join public.fest_schedule_items i on i.id = s.schedule_item_id
      left join public.fest_schedule_slots sl on sl.id = s.slot_id
      where coalesce(s.user_id, s.added_by) is not null
        and i.signup_enabled
        and array_length(i.signup_reminder_minutes, 1) > 0
    ),
    act as (
      select s.id as signup_id, 'activity' as kind,
             coalesce(s.user_id, s.added_by) as recipient,
             (s.user_id is null) as is_write_in, s.name as who,
             a.title, a.signup_reminder_minutes as mins, a.signup_reminder_email as email_on,
             s.activity_id as item_id, s.slot_id as slot_id, s.slot_start as interval_start,
             sl.day as day,                        -- activities have no own day
             coalesce(sl.start_time, s.slot_start) as start_time,
             (select count(*) from public.fest_activity_signups o
                where o.activity_id = s.activity_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_count,
             (select string_agg(o.name, ', ' order by o.created_at) from public.fest_activity_signups o
                where o.activity_id = s.activity_id
                  and ((s.slot_id is not null and o.slot_id = s.slot_id)
                    or (s.slot_id is null and o.slot_id is null and o.slot_start = s.slot_start))) as slot_names,
             '/family-fest' as url
      from public.fest_activity_signups s
      join public.fest_activities a on a.id = s.activity_id
      left join public.fest_activity_slots sl on sl.id = s.slot_id
      where coalesce(s.user_id, s.added_by) is not null
        and a.signup_enabled
        and array_length(a.signup_reminder_minutes, 1) > 0
    )
    select * from sched where day is not null and start_time is not null
    union all
    select * from act where day is not null and start_time is not null
  loop
    begin
      v_when := (r.day || ' ' || r.start_time)::timestamp at time zone 'America/Chicago';
    exception when others then
      continue;
    end;

    foreach m in array r.mins loop
      if now() >= v_when - make_interval(mins => m)
         and now() < v_when
         and not exists (
           select 1 from public.fest_signup_reminders_sent x
           where x.signup_id = r.signup_id and x.minutes = m
         )
      then
        begin
          perform public._notify(
            r.recipient, 'signup_reminder', null,
            'Sign-up reminder: ' || r.title,
            (case when r.is_write_in
              then r.who || '''s ' || r.title || ' time slot starts ' || public._humanize_minutes(m)
              else 'Your ' || r.title || ' time slot starts ' || public._humanize_minutes(m)
            end)
            -- The resolved instant is the authority; the relative phrase above
            -- is colour. v_when is never null here (the query already dropped
            -- rows with no day/start), but coalesce keeps this honest if that
            -- filter ever loosens.
            || coalesce(' — ' || public._format_slot_when(v_when), '') || '.'
            || case when r.slot_count > 1 then ' In this slot: ' || r.slot_names || '.' else '' end,
            r.url, r.kind, r.signup_id, v_when + interval '1 hour');
          insert into public.fest_signup_reminders_sent (signup_id, minutes, kind)
          values (r.signup_id, m, r.kind)
          on conflict do nothing;
          if r.email_on then
            insert into public.fest_reminder_emails (kind, item_id, slot_id, slot_start, lead_minutes)
            values (r.kind, r.item_id, r.slot_id, r.interval_start, m)
            on conflict do nothing;
          end if;
        exception when others then
          continue;
        end;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_signup_reminders() from public, anon, authenticated;

-- ── The manual send now shares the same wording helper (0165's inline copy) ──
-- Behaviour is identical to 0165/0166; only the phrasing source moves into
-- _format_slot_when so there's exactly one definition of "Fri, Jul 31 at 9:00 AM".
create or replace function public.send_signup_slot_reminder_now(
  p_kind text,
  p_item uuid,
  p_slot_id uuid,
  p_slot_start text,
  p_minutes int default null,
  p_email boolean default false
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
      v_day := null; -- activities have no day of their own
      v_start := p_slot_start;
    end if;
  end if;
  if v_title is null then
    raise exception 'Not found';
  end if;

  -- The SAME conversion run_signup_reminders() uses, so the two can't disagree.
  if v_day is not null and v_start is not null then
    begin
      v_when := (v_day || ' ' || v_start)::timestamp at time zone 'America/Chicago';
    exception when others then
      v_when := null;
    end;
  end if;

  v_url := case when p_kind = 'schedule' then '/family-fest/schedule/' || p_item::text else '/family-fest' end;
  v_lead := case when p_minutes is not null and p_minutes > 0 then public._humanize_minutes(p_minutes) else null end;

  -- Prefer the real, resolved time - never the sender's lead-time label.
  v_phrase := coalesce(
    'starts ' || public._format_slot_when(v_when),
    'starts ' || v_lead,
    'is coming up'
  );

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

  -- Re-queue rather than silently no-op: with p_minutes now always null, the
  -- dedup index would otherwise pin ONE email per slot forever. A repeat
  -- within 90s (a double-tap) still collapses to nothing.
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
