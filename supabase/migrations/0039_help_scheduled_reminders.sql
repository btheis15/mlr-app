-- 0039_help_scheduled_reminders.sql
-- Two upgrades to "Ask for Help" (0037/0038):
--
--   A) PERSONAL notification copy. The push/feed now leads with WHO needs help and
--      WHERE (and WHEN, if scheduled) — "🙌 Brian needs a hand · 📍 Pavilion",
--      not a generic "help request".
--
--   B) SCHEDULED requests. The form already takes an optional time (needed_at). A
--      scheduled request still goes out immediately; then ~15 min before the time
--      a per-minute pg_cron job (process_help_reminders) does two things:
--        • reminds everyone who said "on my way" ("⏰ helping Brian at 2:00 PM"), and
--        • if there still aren't enough helpers, RE-BROADCASTS to eligible members
--          ("⏳ Brian still needs help at 2:00 PM — 1 of 4 so far") + nudges the
--          requester. Fired once per request (reminder_sent_at guards re-sends).
--      Reminders are DB-written via _notify, so the mini's push-sender mirrors them
--      to phone pushes with no mini change.
--
-- Times are shown in resort-local (America/Chicago). "Scheduled" = needed_at is
-- >20 min after the request was created (an immediate request has needed_at≈now,
-- so it never enters the reminder flow). Apply after 0038.

-- ── reminder bookkeeping ─────────────────────────────────────────────────────
alter table public.help_requests
  add column if not exists reminder_sent_at timestamptz;

-- ── A) notif_on_help_request: personal copy (who · where · when) + self-ping ──
create or replace function public.notif_on_help_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text;
  v_emoji     text;
  v_title     text;
  v_body      text;
  v_scheduled boolean := NEW.needed_at > NEW.created_at + interval '20 minutes';
  v_when      text := to_char(NEW.needed_at at time zone 'America/Chicago', 'FMHH12:MI AM');
begin
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;
  v_emoji := case NEW.category
    when 'urgent'   then '🚨'
    when 'move'     then '🪵'
    when 'setup'    then '🔧'
    when 'ride'     then '🚗'
    when 'supplies' then '🛒'
    else '🙌' end;
  -- Lead with the person; surface the place right in the title.
  v_title := case when NEW.category = 'urgent'
                  then '🚨 ' || v_name || ' needs help now'
                  else v_name || ' needs a hand ' || v_emoji end
             || case when NEW.where_text is not null then '  ·  📍 ' || NEW.where_text else '' end;
  -- Body carries the ask + (for a scheduled request) the time.
  v_body := left(NEW.description, 140)
            || case when v_scheduled then '  ·  ⏰ by ' || v_when else '' end;

  -- Fan out to willing + present recipients (excludes the requester).
  perform public._notify(
    r.id, 'help_request', NEW.user_id,
    v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
  from public._help_recipients(
    NEW.eligible_event_ids, NEW.strict_event_ids, NEW.today_key, NEW.audience, NEW.user_id
  ) r;

  -- Self-ping the requester when they're a beta tester (actor = null so it isn't
  -- skipped), so a tester sees the feed + push for their own request — even solo.
  if exists (select 1 from public.profiles p where p.id = NEW.user_id and p.beta_tester) then
    perform public._notify(
      NEW.user_id, 'help_request', null,
      '🙌 Your help request is posted' || case when v_scheduled then ' (for ' || v_when || ')' else '' end,
      v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at);
  end if;

  return NEW;
end;
$$;
-- (trigger trg_notif_help_request from 0037 already points at this function.)

-- ── notif_on_help_response: over-subscribe friendly progress ping ───────────
-- Re-created from 0037 with one change: once a request is already covered, MORE
-- people can still say "on my way" (status stays 'open' until resolved) and the
-- requester is told they're getting even more help than they asked for. The
-- race-safe "tip to fulfilled" logic is unchanged.
create or replace function public.notif_on_help_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         text;
  v_req           public.help_requests;
  v_count         int;
  v_reqname       text;
  v_now_fulfilled boolean := false;
begin
  select * into v_req from public.help_requests where id = NEW.request_id;
  if v_req.user_id is null then return NEW; end if;

  select count(*) into v_count from public.help_responses where request_id = NEW.request_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_actor
    from public.profiles where id = NEW.user_id;

  if v_count >= v_req.needed_count and v_req.fulfilled_at is null then
    update public.help_requests set fulfilled_at = now()
      where id = NEW.request_id and fulfilled_at is null;
    v_now_fulfilled := found;
  end if;

  -- (1) Tell the requester — unless this is the response that tips it to covered
  -- (the nicer "covered" message below replaces it). Over the asked-for number it
  -- reads as bonus help.
  if not v_now_fulfilled then
    if v_count > v_req.needed_count then
      perform public._notify(
        v_req.user_id, 'help_response', NEW.user_id,
        v_actor || ' is also on the way 🙌',
        v_count || ' coming now — you only asked for ' || v_req.needed_count || '!  ·  ' || left(v_req.description, 100),
        '/help-requests', 'help_request', NEW.request_id, null);
    else
      perform public._notify(
        v_req.user_id, 'help_response', NEW.user_id,
        v_actor || ' is on the way 🚶',
        'On the way: ' || v_count || ' of ' || v_req.needed_count || '  ·  ' || left(v_req.description, 100),
        '/help-requests', 'help_request', NEW.request_id, null);
    end if;
  end if;

  -- (2) Fulfilled (first time only): tell everyone eligible + the requester.
  if v_now_fulfilled then
    select coalesce(nullif(btrim(display_name), ''), 'A member') into v_reqname
      from public.profiles where id = v_req.user_id;
    perform public._notify(
      r.id, 'help_request', NEW.user_id,
      '✅ Covered — ' || v_reqname || ' has enough help',
      v_req.needed_count || ' on the way  ·  ' || left(v_req.description, 100),
      '/help-requests', 'help_request', NEW.request_id, v_req.expires_at)
    from public._help_recipients(
      v_req.eligible_event_ids, v_req.strict_event_ids, v_req.today_key, v_req.audience, v_req.user_id
    ) r;
    perform public._notify(
      v_req.user_id, 'help_response', NEW.user_id,
      '✅ You''ve got enough help',
      v_req.needed_count || ' on the way for: ' || left(v_req.description, 100),
      '/help-requests', 'help_request', NEW.request_id, null);
  end if;

  return NEW;
end;
$$;
-- (trigger trg_notif_help_response from 0037 already points at this function.)

-- ── B) process_help_reminders(): the ~15-min-before pass (run by pg_cron) ─────
create or replace function public.process_help_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.help_requests;
  v_cnt  int;
  v_name text;
  v_when text;
begin
  for r in
    select * from public.help_requests
    where status = 'open'
      and reminder_sent_at is null
      and needed_at > created_at + interval '20 minutes'   -- genuinely scheduled
      and needed_at <= now() + interval '15 minutes'        -- within the lead window
      and needed_at >  now() - interval '30 minutes'        -- skip ones the cron long missed
  loop
    update public.help_requests set reminder_sent_at = now() where id = r.id;

    select count(*) into v_cnt from public.help_responses where request_id = r.id;
    select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
      from public.profiles where id = r.user_id;
    v_when := to_char(r.needed_at at time zone 'America/Chicago', 'FMHH12:MI AM');

    -- (1) Remind everyone who said they're on the way.
    perform public._notify(
      resp.user_id, 'help_response', null,
      '⏰ Reminder: helping ' || v_name || ' at ' || v_when,
      left(r.description, 140) || case when r.where_text is not null then '  ·  📍 ' || r.where_text else '' end,
      '/help-requests', 'help_request', r.id, r.expires_at)
    from public.help_responses resp where resp.request_id = r.id;

    -- (2) Still short → re-broadcast to eligible members + nudge the requester.
    if v_cnt < r.needed_count then
      perform public._notify(
        rec.id, 'help_request', r.user_id,
        '⏳ ' || v_name || ' still needs help at ' || v_when,
        v_cnt || ' of ' || r.needed_count || ' on the way  ·  ' || left(r.description, 110)
          || case when r.where_text is not null then '  ·  📍 ' || r.where_text else '' end,
        '/help-requests', 'help_request', r.id, r.expires_at)
      from public._help_recipients(r.eligible_event_ids, r.strict_event_ids, r.today_key, r.audience, r.user_id) rec;

      perform public._notify(
        r.user_id, 'help_response', null,
        '⏳ Your ' || v_when || ' request still needs help',
        'Only ' || v_cnt || ' of ' || r.needed_count || ' on the way — re-sent to people nearby.',
        '/help-requests', 'help_request', r.id, null);
    end if;
  end loop;
end;
$$;
revoke all on function public.process_help_reminders() from public, anon, authenticated;

-- ── Schedule it every minute (pg_cron) ───────────────────────────────────────
-- If `create extension` errors, enable pg_cron once in the Supabase dashboard
-- (Database → Extensions → pg_cron), then re-run the two statements below.
-- cron.schedule upserts by job name, so re-running this file is safe.
create extension if not exists pg_cron;
select cron.schedule('mlr-help-reminders', '* * * * *', $$ select public.process_help_reminders(); $$);
