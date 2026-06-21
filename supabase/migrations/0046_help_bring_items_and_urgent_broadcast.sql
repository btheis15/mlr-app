-- 0046_help_bring_items_and_urgent_broadcast.sql
-- Two upgrades to "Ask for Help" (0037–0039):
--
--   1) "WHAT TO BRING" CHECKLIST. A request can carry an optional list of things
--      the helpers should bring (e.g. "2 long tables", "6 chairs", "3 coolers").
--      Each line is a checkbox in the log; a helper taps the ones they're bringing
--      (one or many). Claiming an item also marks them "on the way" (a normal
--      help_responses row), so bringing something counts toward the head-count. A
--      new table public.help_request_items holds the lines + who's bringing each;
--      claim_help_item() toggles a claim, race-safe (an item is brought by at most
--      one person).
--
--   2) URGENT GOES TO EVERYONE. A request with category='urgent' is an emergency,
--      so it alerts EVERY member app-wide — not just willing + present + beta — via
--      a new 'help_urgent' notification kind (default on; members can still mute it
--      in Profile → Notifications). The mini's push-sender treats help_urgent as an
--      OVERRIDE push: anyone whose phone push is on gets buzzed, regardless of their
--      per-category push picks (see media-server/push-sender.js). Non-beta members
--      can also respond to / help with an urgent request (the beta gate is waived
--      for urgent only).
--
-- Re-creates request_help (adds p_items + urgent reach-count), respond_to_help
-- (urgent: no beta gate), notif_on_help_request + notif_on_help_response (urgent →
-- everyone) from their 0038/0039 versions. Apply in the SQL editor after 0045.

-- ── Part 1: notif_types gains 'help_urgent' (default on + backfill) ──────────
-- Canonical "all on" set (mirrors lib/types.ts DEFAULT_NOTIF_TYPES) + help_urgent.
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,event_rsvp,help_request,help_response,help_urgent}';

-- Existing members opt INTO urgent by default (emergencies should reach them).
update public.profiles
  set notif_types = array(
    select distinct e from unnest(notif_types || '{help_urgent}'::text[]) e
  )
  where not (notif_types @> '{help_urgent}'::text[]);

-- ── Part 2: help_request_items — the optional "what to bring" checklist ──────
-- One row per line the requester listed. `claimed_by` is the helper bringing it
-- (null = still unclaimed). Member-read like the rest of the feature; writes go
-- through claim_help_item() (claims) and request_help() (creation).
create table if not exists public.help_request_items (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.help_requests (id) on delete cascade,
  label       text not null,
  position    int  not null default 0,            -- display order as the requester typed them
  claimed_by  uuid references public.profiles (id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists help_request_items_request_idx
  on public.help_request_items (request_id, position);

alter table public.help_request_items enable row level security;

drop policy if exists "help_request_items: members read" on public.help_request_items;
create policy "help_request_items: members read" on public.help_request_items for select
  using (auth.uid() is not null);

-- ── Part 3: request_help() — now also takes the bring-list + urgent reach ────
-- Re-created from 0038 with: (a) a new p_items text[] of bring-list labels, and
-- (b) the notified_count reflecting the URGENT audience (everyone with the
-- help_urgent pref) when category='urgent'. Drop the old 12-arg signature first.
drop function if exists public.request_help(text, text, text, double precision, double precision, timestamptz, int, text, text[], text[], text, timestamptz);

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
  p_expires_at   timestamptz default null,
  p_items        text[] default '{}'
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
  v_cat     text := nullif(btrim(coalesce(p_category, '')), '');
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
    v_cat,
    nullif(btrim(coalesce(p_where_text, '')), ''),
    p_lat, p_lng, v_needed, greatest(1, coalesce(p_needed_count, 1)),
    p_audience, coalesce(p_eligible, '{}'), coalesce(p_strict, '{}'), v_today, v_expires
  )
  returning help_requests.id into v_id;

  -- Optional "what to bring" lines, in the order the requester typed them.
  insert into public.help_request_items (request_id, label, position)
  select v_id, btrim(t.label), (t.ord - 1)::int
  from unnest(coalesce(p_items, '{}')) with ordinality as t(label, ord)
  where btrim(coalesce(t.label, '')) <> '';

  -- How many it reaches: urgent goes app-wide (everyone with the help_urgent pref);
  -- everything else is the willing + present set.
  if v_cat = 'urgent' then
    select count(*) into v_count
    from public.profiles p
    where p.id <> v_uid and 'help_urgent' = any(p.notif_types);
  else
    select count(*) into v_count
    from public._help_recipients(coalesce(p_eligible, '{}'), coalesce(p_strict, '{}'), v_today, p_audience, v_uid);
  end if;

  update public.help_requests set notified_count = v_count where help_requests.id = v_id;

  return query select v_id, v_count;
end;
$$;
revoke all on function public.request_help(text, text, text, double precision, double precision, timestamptz, int, text, text[], text[], text, timestamptz, text[]) from public, anon;
grant execute on function public.request_help(text, text, text, double precision, double precision, timestamptz, int, text, text[], text[], text, timestamptz, text[]) to authenticated;

-- ── Part 4: claim_help_item() — a helper checks off what they're bringing ────
-- Toggle one bring-list item: claim it (p_claim=true) or release it (false). A
-- claim is race-safe (only succeeds while the item is free or already yours) and
-- also records a 'on my way' response — bringing something means you're helping.
-- Urgent requests are open to everyone; other requests keep the beta gate.
create or replace function public.claim_help_item(p_item uuid, p_claim boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_item public.help_request_items;
  v_req  public.help_requests;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_item from public.help_request_items where id = p_item;
  if not found then raise exception 'That item is no longer on the list'; end if;
  select * into v_req from public.help_requests where id = v_item.request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'open' then raise exception 'That request is no longer open'; end if;

  -- Beta gate, waived for urgent (urgent is open to the whole family).
  if not public.is_beta_tester() and v_req.category is distinct from 'urgent' then
    raise exception 'Ask for Help is in beta';
  end if;

  if p_claim then
    -- Claim only while free or already mine (race-safe — first tap wins).
    update public.help_request_items
      set claimed_by = v_uid, claimed_at = now()
      where id = p_item and (claimed_by is null or claimed_by = v_uid);
    if not found then
      raise exception 'Someone else is already bringing that';
    end if;
    -- Bringing something = on the way (no-op if they already responded).
    insert into public.help_responses (request_id, user_id)
    values (v_item.request_id, v_uid)
    on conflict (request_id, user_id) do nothing;
  else
    -- Release only your own claim; leave your "on my way" response in place.
    update public.help_request_items
      set claimed_by = null, claimed_at = null
      where id = p_item and claimed_by = v_uid;
  end if;
end;
$$;
revoke all on function public.claim_help_item(uuid, boolean) from public, anon;
grant execute on function public.claim_help_item(uuid, boolean) to authenticated;

-- ── Part 5: respond_to_help() — urgent is open to non-beta members ───────────
-- Re-created from 0037 with one change: the beta gate is waived when the request
-- is urgent, so anyone can say "on my way" to an emergency.
create or replace function public.respond_to_help(
  p_request uuid,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select category into v_cat from public.help_requests where id = p_request and status = 'open';
  if not found then raise exception 'That request is no longer open'; end if;
  if not public.is_beta_tester() and v_cat is distinct from 'urgent' then
    raise exception 'Ask for Help is in beta';
  end if;

  insert into public.help_responses (request_id, user_id, note)
  values (p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (request_id, user_id) do nothing;
end;
$$;
revoke all on function public.respond_to_help(uuid, text) from public, anon;
grant execute on function public.respond_to_help(uuid, text) to authenticated;

-- ── Part 6: notif_on_help_request() — urgent fans out to EVERYONE ────────────
-- Re-created from 0039. Adds the urgent branch: instead of willing + present
-- recipients (_help_recipients), an urgent request notifies every member who has
-- the 'help_urgent' pref on (the mini then pushes it to all phones with push on).
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
  v_urgent    boolean := NEW.category = 'urgent';
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
  v_title := case when v_urgent
                  then '🚨 ' || v_name || ' needs help now'
                  else v_name || ' needs a hand ' || v_emoji end
             || case when NEW.where_text is not null then '  ·  📍 ' || NEW.where_text else '' end;
  v_body := left(NEW.description, 140)
            || case when v_scheduled then '  ·  ⏰ by ' || v_when else '' end;

  if v_urgent then
    -- URGENT → everyone app-wide who hasn't muted urgent (no willing/present/beta
    -- filter). _notify checks the 'help_urgent' pref + skips the actor.
    perform public._notify(
      p.id, 'help_urgent', NEW.user_id,
      v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
    from public.profiles p
    where p.id <> NEW.user_id;
  else
    -- Routine → willing + present recipients (the beta-gated path).
    perform public._notify(
      r.id, 'help_request', NEW.user_id,
      v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
    from public._help_recipients(
      NEW.eligible_event_ids, NEW.strict_event_ids, NEW.today_key, NEW.audience, NEW.user_id
    ) r;
  end if;

  -- Self-ping the requester when they're a beta tester (actor = null so it isn't
  -- skipped), so a tester sees the feed + push for their own request — even solo.
  if exists (select 1 from public.profiles p where p.id = NEW.user_id and p.beta_tester) then
    perform public._notify(
      NEW.user_id, case when v_urgent then 'help_urgent' else 'help_request' end, null,
      '🙌 Your help request is posted' || case when v_scheduled then ' (for ' || v_when || ')' else '' end,
      v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at);
  end if;

  return NEW;
end;
$$;
-- (trigger trg_notif_help_request from 0037 already points at this function.)

-- ── Part 7: notif_on_help_response() — urgent "covered" goes to everyone ─────
-- Re-created from 0039. Only the "✅ Covered" fan-out changes: for an urgent
-- request it tells everyone who was alerted (help_urgent audience), not just the
-- willing + present set.
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

  -- (1) Tell the requester — unless this is the response that tips it to covered.
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
    if v_req.category = 'urgent' then
      perform public._notify(
        p.id, 'help_urgent', NEW.user_id,
        '✅ Covered — ' || v_reqname || ' has enough help',
        v_req.needed_count || ' on the way  ·  ' || left(v_req.description, 100),
        '/help-requests', 'help_request', NEW.request_id, v_req.expires_at)
      from public.profiles p
      where p.id <> v_req.user_id;
    else
      perform public._notify(
        r.id, 'help_request', NEW.user_id,
        '✅ Covered — ' || v_reqname || ' has enough help',
        v_req.needed_count || ' on the way  ·  ' || left(v_req.description, 100),
        '/help-requests', 'help_request', NEW.request_id, v_req.expires_at)
      from public._help_recipients(
        v_req.eligible_event_ids, v_req.strict_event_ids, v_req.today_key, v_req.audience, v_req.user_id
      ) r;
    end if;
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

-- ── Part 8: Realtime — claims update the log live ────────────────────────────
alter table public.help_request_items replica identity full;
do $$ begin alter publication supabase_realtime add table public.help_request_items; exception when duplicate_object then null; end $$;
