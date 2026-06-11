-- 0038_help_test_affordances.sql
-- Two beta-testing affordances for "Ask for Help" (0037), so it can be exercised
-- end-to-end without physically being at an event:
--
--   1) Admins BYPASS the requester presence gate in request_help() — so an admin
--      can post a request from anywhere (to test/demo). The beta gate still
--      applies; regular beta testers still must be "present" (RSVP'd to a current
--      event / approved stay), so the real behavior stays testable too.
--
--   2) Beta testers get the ping for their OWN request. _notify() normally skips
--      the actor, so a requester never saw their own request. notif_on_help_request
--      now also self-notifies the requester (actor = null, so it isn't skipped)
--      when they're a beta tester — so a tester can confirm the in-app feed + phone
--      push fire, even solo. Respects their help_request pref; non-beta requesters
--      (post-GA, once the beta gates are dropped) don't self-ping.
--
-- Re-creates the two functions from 0037 with these changes; everything else is
-- identical. Apply in the Supabase SQL editor after 0037.

-- ── request_help(): admins skip the presence gate ───────────────────────────
create or replace function public.request_help(
  p_description  text,
  p_category     text default null,
  p_where_text   text default null,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_needed_at    timestamptz default null,
  p_needed_count int default 1,
  p_audience     text default 'present',
  p_eligible     text[] default '{}',
  p_strict       text[] default '{}',
  p_today        text default null,
  p_expires_at   timestamptz default null
)
returns table (id uuid, notified int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   text := nullif(btrim(coalesce(p_today, '')), '');
  v_needed  timestamptz := coalesce(p_needed_at, now());
  v_expires timestamptz;
  v_present boolean;
  v_id      uuid;
  v_count   int;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if not public.is_beta_tester() then raise exception 'Ask for Help is in beta'; end if;   -- ⚑ beta gate
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Please describe what you need help with';
  end if;
  if v_today is null then raise exception 'Your device''s date is missing — please refresh and try again.'; end if;
  if p_audience not in ('present', 'all_willing') then raise exception 'Unknown audience'; end if;

  if (select count(*) from public.help_requests where user_id = v_uid and status = 'open') >= 10 then
    raise exception 'You have several open requests already — resolve or cancel some first.';
  end if;

  -- Requester gate (mirrors _help_recipients, day-aware for the strict set).
  v_present :=
    exists (
      select 1 from public.event_attendance ea
      where ea.user_id = v_uid
        and ea.event_id = any(coalesce(p_eligible, '{}'))
        and case
              when ea.event_id = any(coalesce(p_strict, '{}'))
                then ((ea.days is null or ea.days = '{}'::jsonb) and ea.status = 'going')
                     or (v_today is not null and (ea.days ->> v_today) = 'going')
              else ea.status = 'going'
                   or exists (select 1 from jsonb_each_text(coalesce(ea.days, '{}'::jsonb)) d where d.value = 'going')
            end
    )
    or exists (
      select 1 from public.cabin_bookings b
      where b.user_id = v_uid and b.status = 'approved'
        and b.check_in <= v_today::date and b.check_out > v_today::date
    );
  -- Admins bypass presence (test/demo from anywhere). Beta gate above still applies.
  if not v_present
     and not exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin) then
    raise exception 'You can ask for help once you''re at the resort — RSVP "going" to a current event first.';
  end if;

  v_expires := coalesce(p_expires_at, greatest(now(), v_needed) + interval '6 hours');

  insert into public.help_requests (
    user_id, description, category, where_text, lat, lng, needed_at, needed_count,
    audience, eligible_event_ids, strict_event_ids, today_key, expires_at
  ) values (
    v_uid,
    btrim(p_description),
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_where_text, '')), ''),
    p_lat, p_lng, v_needed, greatest(1, coalesce(p_needed_count, 1)),
    p_audience, coalesce(p_eligible, '{}'), coalesce(p_strict, '{}'), v_today, v_expires
  )
  returning help_requests.id into v_id;

  select count(*) into v_count
  from public._help_recipients(coalesce(p_eligible, '{}'), coalesce(p_strict, '{}'), v_today, p_audience, v_uid);

  update public.help_requests set notified_count = v_count where help_requests.id = v_id;

  return query select v_id, v_count;
end;
$$;
revoke all on function public.request_help(text, text, text, double precision, double precision, timestamptz, int, text, text[], text[], text, timestamptz) from public, anon;
grant execute on function public.request_help(text, text, text, double precision, double precision, timestamptz, int, text, text[], text[], text, timestamptz) to authenticated;

-- ── notif_on_help_request(): fan out to recipients + self-ping beta requester ─
create or replace function public.notif_on_help_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_body  text;
  v_emoji text;
  v_title text;
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
  v_title := v_emoji || ' ' || v_name
    || case when NEW.category = 'urgent' then ' needs help — urgent' else ' needs a hand' end;
  v_body := left(NEW.description, 140)
            || case when NEW.where_text is not null then '  ·  📍 ' || NEW.where_text else '' end;

  -- Fan out to willing + present recipients (excludes the requester).
  perform public._notify(
    r.id, 'help_request', NEW.user_id,
    v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
  from public._help_recipients(
    NEW.eligible_event_ids, NEW.strict_event_ids, NEW.today_key, NEW.audience, NEW.user_id
  ) r;

  -- Self-ping the requester when they're a beta tester (actor = null so _notify
  -- doesn't skip them), so a tester can see the in-app feed + phone push for their
  -- own request — even solo. Respects their help_request notif/push prefs.
  if exists (select 1 from public.profiles p where p.id = NEW.user_id and p.beta_tester) then
    perform public._notify(
      NEW.user_id, 'help_request', null,
      '🙌 Your help request is posted',
      v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at);
  end if;

  return NEW;
end;
$$;
-- (trigger trg_notif_help_request from 0037 already points at this function.)
