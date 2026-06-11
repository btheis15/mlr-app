-- 0037_help_requests.sql
-- "Ask for Help" (BETA) — a member who's AT THE RESORT posts a short request for
-- help; everyone who (a) opted into "Willing to Help" AND (b) is also at the
-- resort right now gets an in-app notification + phone push, can respond "on my
-- way", and the open requests show in a shared log so people are aware of what's
-- going on and who's helping. A request can ask for N people; once N are on the
-- way it reads as fulfilled and everyone eligible is told.
--
-- "At the resort right now" — with no background geolocation possible in a PWA —
-- is approximated from data we already have: you're considered present if you're
-- RSVP'd "going" to an event whose window (±2 days, for early arrivals / lingering
-- long weekends) includes today, OR you have an APPROVED cabin stay covering
-- today. For day-RSVP events (Family Fest) on a real event day we check the
-- per-day map so someone who already drove home isn't pinged; on the ±2 grace
-- shoulder days we fall back to "going to the event at all".
--
-- The client computes which events are "live" today (it merges DB + in-code seed
-- events — Family Fest's dates live in code, not the DB) and passes that snapshot
-- to request_help(); the recipient set is then resolved SERVER-SIDE from it. The
-- server constrains recipients to willing + present + beta members and re-checks
-- the requester is present, but it TRUSTS the client's event-window snapshot
-- (recomputing it server-side would mean moving the seed-event dates into the DB,
-- and would also break the demo-date "see the app as if it's <date>" testing).
-- That trust is acceptable for a closed family beta; GA hardening = persist seed
-- event windows server-side and re-derive eligible/strict in the RPC. The
-- requester themselves must be present too (you can't ask from home).
--
-- BETA-GATED: every recipient must be a Beta Tester (profiles.beta_tester, 0029),
-- and request_help()/respond_to_help() require the caller to be one. Drop the two
-- `beta_tester` guards (marked ⚑ below) to take it resort-wide.
--
-- Reuses the shipped notifications feed (0030 _notify + notif_types) and the
-- mini's push-sender (which mirrors a 'help_request'/'help_response' notification
-- row to a phone push once those are added to PUSHABLE_FEED_TYPES + push_types).
-- Apply in the Supabase SQL editor after 0036.

-- ── "Willing to Help" opt-in (member-settable) ───────────────────────────────
alter table public.profiles
  add column if not exists willing_to_help boolean not null default false;
-- Members set their own flag (column-level grant, same guardrail as 0020/0034 —
-- still can't touch is_admin/beta_tester etc.).
grant update (willing_to_help) on public.profiles to authenticated;

-- ── notif_types: add the two help kinds (ON by default + backfill) ───────────
--   help_request  — someone at the resort asked for help → you (willing+present).
--   help_response — someone is responding to YOUR request.
-- 'willing_to_help' is the real opt-in for receiving help_request; help_request in
-- notif_types is the secondary in-app mute (on by default), like every other kind.
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,cabin_request,cabin_decision,help_request,help_response}';

update public.profiles
  set notif_types = array(
    select distinct e from unnest(notif_types || '{help_request,help_response}'::text[]) e
  )
  where not (notif_types @> '{help_request,help_response}'::text[]);

-- ── push_types: make the two help kinds phone-pushable for active push users ─
-- They're delivered by the mini's push-sender mirroring the notification row
-- (PUSHABLE_FEED_TYPES) gated on push_types — so add them for BETA TESTERS who've
-- already turned push on (non-empty push_types). Everyone else opts in via
-- PushToggle. (No column default change — push stays opt-in, migration 0034.)
update public.profiles
  set push_types = array(
    select distinct e from unnest(push_types || '{help_request,help_response}'::text[]) e
  )
  where beta_tester                                   -- ⚑ beta gate
    and push_types <> '{}'
    and not (push_types @> '{help_request,help_response}'::text[]);

-- ── help_requests ────────────────────────────────────────────────────────────
-- `eligible_event_ids` / `strict_event_ids` / `today_key` are the targeting
-- SNAPSHOT the client computed at submit time (see header). `audience='present'`
-- targets willing + present members; 'all_willing' is the escape hatch for when
-- nobody's around (still requires the REQUESTER to be present). `notified_count`
-- is stamped at submit so the requester sees how many it reached.
create table if not exists public.help_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  description   text not null,
  category      text,                       -- optional tag (ride / tools / …)
  where_text    text,                       -- freeform "where I am" (Pavilion, …)
  lat           double precision,           -- optional precise location (opt-in)
  lng           double precision,
  needed_at     timestamptz not null default now(),
  needed_count  int not null default 1 check (needed_count >= 1),  -- how many people are needed
  status        text not null default 'open'
                check (status in ('open', 'resolved', 'cancelled')),
  fulfilled_at  timestamptz,                       -- set once needed_count are on the way
  audience      text not null default 'present'
                check (audience in ('present', 'all_willing')),
  eligible_event_ids text[] not null default '{}',
  strict_event_ids   text[] not null default '{}',
  today_key     text,                       -- resort-local ISO date for day-aware matching
  notified_count int not null default 0,
  resolved_by   uuid references public.profiles (id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz
);
create index if not exists help_requests_status_idx on public.help_requests (status, created_at desc);
create index if not exists help_requests_user_idx on public.help_requests (user_id, created_at desc);

alter table public.help_requests enable row level security;

-- The log is visible to any signed-in member (guests/anon are kept out — these
-- carry a member's location + need). No client write policies: every write goes
-- through the SECURITY DEFINER RPCs below.
drop policy if exists "help_requests: members read" on public.help_requests;
create policy "help_requests: members read" on public.help_requests for select
  using (auth.uid() is not null);

drop trigger if exists help_requests_set_updated_at on public.help_requests;
create trigger help_requests_set_updated_at
  before update on public.help_requests
  for each row execute function public.set_updated_at();

-- ── help_responses ("on my way" — the only response) ────────────────────────
-- One row per (request, responder); a row just means "I'm coming to help".
-- Notifies the requester, and tips the request to fulfilled once needed_count
-- rows exist.
create table if not exists public.help_responses (
  request_id uuid not null references public.help_requests (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table public.help_responses enable row level security;

drop policy if exists "help_responses: members read" on public.help_responses;
create policy "help_responses: members read" on public.help_responses for select
  using (auth.uid() is not null);

-- ── Recipient resolver (the one place presence is computed) ──────────────────
-- Returns the profile ids to notify for a help request, applying willing_to_help
-- + beta + the in-app pref ('help_request' in notif_types, matching _notify's gate
-- so the count == the delivered count) + presence (unless audience='all_willing').
-- Presence = "going" to one of the eligible events today (day-aware for the
-- strict set) OR an approved cabin stay covering today. DEFINER-only.
create or replace function public._help_recipients(
  p_eligible text[],
  p_strict   text[],
  p_today    text,
  p_audience text,
  p_exclude  uuid
)
returns table (id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.willing_to_help
    and p.beta_tester                                   -- ⚑ beta gate
    and p.id <> p_exclude
    and 'help_request' = any(p.notif_types)
    and (
      p_audience = 'all_willing'
      or exists (
        select 1
        from public.event_attendance ea
        where ea.user_id = p.id
          and ea.event_id = any(p_eligible)
          and case
                when ea.event_id = any(p_strict)
                  -- day-RSVP event on a real event day: whole-run going (no map),
                  -- or explicitly going today.
                  then ((ea.days is null or ea.days = '{}'::jsonb) and ea.status = 'going')
                       or (p_today is not null and (ea.days ->> p_today) = 'going')
                  -- everything else (single/multi-day, or a grace shoulder day):
                  -- effective going (overall, or any chosen day).
                  else ea.status = 'going'
                       or exists (
                         select 1 from jsonb_each_text(coalesce(ea.days, '{}'::jsonb)) d
                         where d.value = 'going'
                       )
              end
      )
      or exists (
        select 1
        from public.cabin_bookings b
        where b.user_id = p.id
          and b.status = 'approved'
          and b.check_in <= nullif(p_today, '')::date
          and b.check_out > nullif(p_today, '')::date
      )
    );
$$;
revoke all on function public._help_recipients(text[], text[], text, text, uuid) from public, anon, authenticated;

-- ── request_help() — post a request (beta + present caller only) ─────────────
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

  -- Anti-spam: cap concurrent open requests per member (generous — no time cooldown,
  -- so back-to-back legit asks still work).
  if (select count(*) from public.help_requests where user_id = v_uid and status = 'open') >= 10 then
    raise exception 'You have several open requests already — resolve or cancel some first.';
  end if;

  -- Requester gate: you can only ask while you're actually at the resort. Mirrors
  -- _help_recipients exactly (day-aware for the strict set), so the requester
  -- passes the same bar as the people they'd reach.
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
  if not v_present then
    raise exception 'You can ask for help once you''re at the resort — RSVP "going" to a current event first.';
  end if;

  -- Default window: 6h after the time help is needed (the requester can resolve
  -- sooner). Past this the badge clears but the row stays in the log until resolved.
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

-- New request → fan out to the resolved recipients (in-app feed via _notify; the
-- mini mirrors each row to a phone push). Carries expires_at so the badge clears
-- when the help window passes.
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
  -- Lead glyph by request type (category key from the client). Default is the
  -- friendly "lend a hand", not an emergency — urgent is just one option.
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
  perform public._notify(
    r.id, 'help_request', NEW.user_id,
    v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
  from public._help_recipients(
    NEW.eligible_event_ids, NEW.strict_event_ids, NEW.today_key, NEW.audience, NEW.user_id
  ) r;
  return NEW;
end;
$$;
drop trigger if exists trg_notif_help_request on public.help_requests;
create trigger trg_notif_help_request after insert on public.help_requests
  for each row execute function public.notif_on_help_request();

-- ── respond_to_help() — "on my way" (the only response) ──────────────────────
create or replace function public.respond_to_help(
  p_request uuid,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_beta_tester() then raise exception 'Ask for Help is in beta'; end if;   -- ⚑ beta gate
  if not exists (select 1 from public.help_requests r where r.id = p_request and r.status = 'open') then
    raise exception 'That request is no longer open';
  end if;

  -- Idempotent: re-tapping "on my way" doesn't re-notify (the trigger fires once,
  -- on the first insert).
  insert into public.help_responses (request_id, user_id, note)
  values (p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (request_id, user_id) do nothing;
end;
$$;
revoke all on function public.respond_to_help(uuid, text) from public, anon;
grant execute on function public.respond_to_help(uuid, text) to authenticated;

-- Withdraw your "on my way" (plans changed). fulfilled_at is sticky — a request
-- that already reached its count stays fulfilled even if someone backs out.
create or replace function public.withdraw_help(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.help_responses where request_id = p_request and user_id = auth.uid();
end;
$$;
revoke all on function public.withdraw_help(uuid) from public, anon;
grant execute on function public.withdraw_help(uuid) to authenticated;

-- Someone said "on my way" → (1) tell the requester, with progress toward the
-- number they asked for, and (2) the FIRST time enough are on the way, stamp
-- fulfilled_at and tell everyone eligible it's covered (so others don't bother).
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

  -- Tip to fulfilled, race-safe: the conditional UPDATE + FOUND guarantees only the
  -- FIRST response to cross the count fires the "covered" fan-out, even if two land
  -- at once (the second's UPDATE matches no row because fulfilled_at is already set).
  if v_count >= v_req.needed_count and v_req.fulfilled_at is null then
    update public.help_requests set fulfilled_at = now()
      where id = NEW.request_id and fulfilled_at is null;
    v_now_fulfilled := found;
  end if;

  -- (1) Progress ping to the requester — unless this response is the one that tips
  -- it to fulfilled (the nicer "covered" message below replaces it).
  if not v_now_fulfilled then
    perform public._notify(
      v_req.user_id, 'help_response', NEW.user_id,
      v_actor || ' is on the way 🚶',
      'On the way: ' || v_count || ' of ' || v_req.needed_count || '  ·  ' || left(v_req.description, 100),
      '/help-requests', 'help_request', NEW.request_id, null);
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
drop trigger if exists trg_notif_help_response on public.help_responses;
create trigger trg_notif_help_response after insert on public.help_responses
  for each row execute function public.notif_on_help_response();

-- ── set_help_status() — resolve / cancel (requester or admin) ────────────────
create or replace function public.set_help_status(p_request uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.help_requests;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_status not in ('resolved', 'cancelled', 'open') then raise exception 'Invalid status'; end if;
  select * into r from public.help_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if r.user_id <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.help_requests
    set status = p_status,
        resolved_by = case when p_status = 'open' then null else auth.uid() end,
        resolved_at = case when p_status = 'open' then null else now() end
    where id = p_request;
end;
$$;
revoke all on function public.set_help_status(uuid, text) from public, anon;
grant execute on function public.set_help_status(uuid, text) to authenticated;

-- ── Realtime (the log + responder counts update live) ────────────────────────
alter table public.help_requests replica identity full;
alter table public.help_responses replica identity full;
do $$ begin alter publication supabase_realtime add table public.help_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.help_responses; exception when duplicate_object then null; end $$;
