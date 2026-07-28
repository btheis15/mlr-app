-- Two follow-ups to the sign-up reminder feature (0140 automatic cron +
-- 0158 manual "notify this slot" send):
--
-- 1. `signup_reminder` becomes a normal, listed push category (PushToggle's
--    "Activity reminders") instead of a hidden override — ON by default for
--    everyone: new members get it via DEFAULT_PUSH_TYPES (client-side), and
--    existing members who already have push on at all are backfilled here,
--    mirroring exactly how migration 0037 backfilled help_request/
--    help_response for members who'd already turned push on.
-- 2. An organizer can opt an event/activity's reminders into ALSO emailing
--    everyone signed up (in addition to the always-on push + in-app), and the
--    same option is available on a one-off manual "notify this slot" send.
--    Emails are queued into `fest_reminder_emails` (resolved + sent by the
--    mini's alert-mailer.js, mirroring the cabin_messages claim/BCC pattern)
--    rather than sent inline, since the actual SMTP send only happens on the
--    mini (service-role only — this project doesn't hold SMTP creds).

-- ── 1. Backfill push_types for existing push-on members ──────────────────────
update public.profiles
  set push_types = array(
    select distinct e from unnest(push_types || '{signup_reminder}'::text[]) e
  )
  where push_types <> '{}'
    and not (push_types @> '{signup_reminder}'::text[]);

-- ── 2. Organizer opt-in for reminder emails ──────────────────────────────────
alter table public.fest_schedule_items
  add column if not exists signup_reminder_email boolean not null default false;
alter table public.fest_activities
  add column if not exists signup_reminder_email boolean not null default false;

-- ── The email queue — one row per (item, slot, lead-time) firing, resolved
--    and sent by the mini (service-role only; no client select grant). Same
--    "deny-all RLS, SECURITY DEFINER writes, service-role reads" doctrine as
--    content_embeddings (0129) / chat_poll_votes (0149). ─────────────────────
create table if not exists public.fest_reminder_emails (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('schedule', 'activity')),
  item_id      uuid not null,
  slot_id      uuid,
  slot_start   text,
  lead_minutes int,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
-- Dedup: at most one queued email per (item, slot, lead-time) — collapses the
-- automatic cron's per-recipient loop into one row, and stops an accidental
-- double-click on the manual send from queuing two batches.
create unique index if not exists fest_reminder_emails_dedup
  on public.fest_reminder_emails (
    kind, item_id,
    coalesce(slot_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(slot_start, ''),
    coalesce(lead_minutes, -1)
  );
alter table public.fest_reminder_emails enable row level security;
-- No policies: only SECURITY DEFINER functions (owner) and the mini's
-- service-role key ever touch this table.

-- ── Who to email for one queued row, + the text (service-role only, mirrors
--    cabin_message_recipients). Resolves the item's title/url and every
--    signed-up person's email via their linked profile (write-in/typed-name
--    rows have no account and are skipped — nothing to email). Transactional:
--    like meeting/cabin-message emails, this overrides `email_alerts`, since
--    the organizer explicitly opted the ITEM into email and the member
--    explicitly signed up for the slot. ────────────────────────────────────
create or replace function public.signup_reminder_email_recipients(p_row uuid)
returns table(item_title text, url text, lead_minutes int, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.fest_reminder_emails%rowtype;
begin
  select * into q from public.fest_reminder_emails where id = p_row;
  if not found then return; end if;

  if q.kind = 'schedule' then
    return query
    select i.title, '/family-fest/schedule/' || i.id::text, q.lead_minutes,
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
    select a.title, '/family-fest', q.lead_minutes,
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

-- ── run_signup_reminders(): also queue an email when the item opted in ──────
-- Same body as migration 0140, plus item_id/slot_id/interval-slot_start +
-- the email flag threaded through the CTEs, and one `on conflict do nothing`
-- insert into fest_reminder_emails per fired (item, slot, lead-time).
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
              then r.who || '''s ' || r.title || ' time slot starts ' || public._humanize_minutes(m) || '.'
              else 'Your ' || r.title || ' time slot starts ' || public._humanize_minutes(m) || '.'
            end)
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

-- ── Manual send (0158) grows an optional email queue too ────────────────────
create or replace function public.send_signup_slot_reminder_now(
  p_kind text, p_item uuid, p_slot_id uuid, p_slot_start text, p_minutes int default null, p_email boolean default false
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
-- Drop the old 5-arg signature (0158) now that the 6-arg one above covers it —
-- the client always passes p_email now, so nothing else calls the old form.
drop function if exists public.send_signup_slot_reminder_now(text, uuid, uuid, text, int);
