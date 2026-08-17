-- 0190_event_message_email.sql
-- "Email everyone about this event" — a polished, laid-out email describing an
-- event AND everything planned as part of it, so a work weekend's actual task
-- list (each item's title + details) lands in people's inboxes instead of only
-- living in the app. Same shape as the cabin "message guests" feature (0120):
-- one log row per send carrying a notify_email flag + a claimed email_sent_at,
-- with the mac-mini alert-mailer building and BCC'ing the message.
--
-- WHO CAN SEND: admin OR the event's own creator — the 0187 doctrine, so the
-- member who spun up the Work Weekend can email about it without being an
-- admin. This is not a new capability so much as a better delivery mechanism:
-- any member can already email Everyone from the People page's group-email
-- composer (it just hands off to a mailto: draft). A seed/synthesized event
-- (Family Fest, a gcal/meeting-sourced row) has no `events.created_by` to
-- match, so it stays admin-only — same as update_event/sync_event_work_items.
--
-- ⚠️ WORK-ITEM PRIVACY. A house-scoped work item is visible only to that
-- house's members + admins (0066 RLS, and the count-only treatment in 0189).
-- One BCC'd email can't be scoped per recipient, so the email embeds ONLY the
-- resort-wide (house_id is null) items in full and reduces each house's items
-- to a "🏠 MJT House · 2 items — in the app" count line, exactly matching what
-- EventSheet shows a non-member. Do NOT "improve" this by inlining house items
-- without first splitting the send per house-group.
--
-- RECIPIENTS — three groups, unioned (so a duplicate address collapses):
--   1. Members with an account (verified, OR invited-but-unverified temp
--      accounts from /admin/invite), gated on profiles.approved + email_alerts.
--   2. Account-less **family_roster** slots with an email (0123).
--   3. Account-less **committee_roster** slots with an email (0056).
-- Groups 2-3 are the people who "aren't on the app yet but are on the family
-- roster" — added by hand by an admin, so they're already vetted, and they have
-- no email_alerts pref or RSVP row to filter on. They're included by default and
-- switched off with p_include_roster, mirroring the same UNIONs the meeting
-- emails use (0123, restored in 0133).
--
-- Computed here rather than reusing alert_recipients() (0127) for two reasons:
-- that function predates the approval gate and does not check
-- profiles.approved — emailing the family's work-weekend plan to a
-- self-signed-up, not-yet-approved address is exactly what 0181/0183 exist to
-- prevent — and it has no roster UNIONs. Otherwise the rules match the
-- established doctrine: honors profiles.email_alerts for account holders (this
-- is a broadcast, not a transactional receipt — see the PRINCIPLE note in
-- CLAUDE.md's meeting-email section, and note that overriding someone's own
-- email opt-out on a mass send is also how a sending domain gets flagged), and
-- honors the event-targeting rule from 0096/0127 (skip anyone who explicitly
-- RSVP'd "Can't make it"). The sender IS included, like the meeting-confirmed
-- email — it doubles as their own confirmation of what went out.
--
-- Apply in the Supabase SQL editor after 0189. ⚠️ Also needs a mac-mini
-- `git pull` + restart (Admin → Media server) for alert-mailer.js to pick up
-- the new handler — until then rows queue up and send on the next restart.

-- ── 1. Send log ───────────────────────────────────────────────────────────────
-- event_id is TEXT, matching event_attendance/event_work_items (0035/0048): the
-- id is a stable string — a DB uuid OR a seed slug like 'family-fest-2026' —
-- never an FK, so synthesized events work too.
create table if not exists public.event_messages (
  id                    uuid primary key default gen_random_uuid(),
  event_id              text not null,
  -- Snapshots so a seed/synthesized event (no `events` row) still emails with a
  -- real title + date line, and so the email reflects what the sender saw.
  event_title           text not null,
  event_when            text,
  sender_id             uuid references public.profiles (id) on delete set null,
  subject               text,
  body                  text,
  include_work_items    boolean not null default true,
  exclude_not_attending boolean not null default true,
  -- Also email account-less rostered family (family_roster / committee_roster
  -- slots with an email but no linked account yet) — see the RECIPIENTS note.
  include_roster        boolean not null default true,
  recipient_count       integer,
  notify_email          boolean not null default true,
  email_sent_at         timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists event_messages_event_idx on public.event_messages (event_id, created_at desc);

alter table public.event_messages enable row level security;

-- The sender (or an admin) can see what they sent; no client writes (RPC only).
drop policy if exists "event_messages: sender read" on public.event_messages;
create policy "event_messages: sender read" on public.event_messages for select
  using (
    sender_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ── 2. Who may email about an event: admin OR its creator ─────────────────────
-- Same rule 0187/0188 inline into update_event/delete_event/
-- sync_event_work_items/remove_work_item_from_event, but as a reusable helper
-- for new callers. Deliberately does NOT re-create those four to call it —
-- they're working production functions and a "recreate" is exactly how the 0160
-- blocklist regression happened. New code should use this; those stay as-is.
-- The invalid_text_representation guard is what lets a seed event id
-- ('family-fest-2026') through as "no creator" → admin-only, instead of
-- erroring on the uuid cast.
create or replace function public.can_manage_event(p_event_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin) then return true; end if;

  begin
    select created_by into v_creator from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_creator := null; -- a seed/synthesized event id isn't a real uuid
  end;

  return v_creator is not null and v_creator = v_uid;
end;
$$;
revoke all on function public.can_manage_event(text) from public, anon;
grant execute on function public.can_manage_event(text) to authenticated;

-- ── 3. Send RPC — returns the recipient count so the UI can confirm ───────────
create or replace function public.send_event_message(
  p_event_id              text,
  p_event_title           text,
  p_event_when            text    default null,
  p_subject               text    default null,
  p_body                  text    default null,
  p_include_work_items    boolean default true,
  p_exclude_not_attending boolean default true,
  p_include_roster        boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_title   text;
  v_subject text;
  v_body    text;
  v_count   int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = '' then raise exception 'Event ID required'; end if;
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only the event''s creator or an admin can email about it';
  end if;

  -- Prefer the live events row's title; fall back to the client's snapshot for
  -- a seed/synthesized event that has no row.
  begin
    select title into v_title from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_title := null;
  end;
  v_title := coalesce(v_title, nullif(btrim(coalesce(p_event_title, '')), ''));
  if v_title is null then raise exception 'Event not found'; end if;

  v_subject := nullif(btrim(coalesce(p_subject, '')), '');
  v_body    := nullif(btrim(coalesce(p_body, '')), '');
  if v_subject is not null and length(v_subject) > 200
    then raise exception 'Keep the subject under 200 characters'; end if;
  if v_body is not null and length(v_body) > 4000
    then raise exception 'Keep the message under 4000 characters'; end if;

  -- Count now (same predicate the mailer's recipient list uses) so the UI can
  -- say "emailing N people" without waiting on the mini.
  select count(*) into v_count from (
    -- Members with an account (verified, or invited-but-unverified temp).
    select u.email::text as email
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null
      and (p.approved is true or p.is_admin is true)
      and p.email_alerts = true
      and not (
        coalesce(p_exclude_not_attending, true)
        and exists (
          select 1 from public.event_attendance ea
          where ea.event_id = p_event_id and ea.user_id = p.id and ea.status = 'not_going'
        )
      )
    union  -- dedupes against the account list and across both rosters
    select btrim(fr.email)
    from public.family_roster fr
    where coalesce(p_include_roster, true)
      and fr.linked_user_id is null
      and nullif(btrim(fr.email), '') is not null
    union
    select btrim(cr.email)
    from public.committee_roster cr
    where coalesce(p_include_roster, true)
      and cr.linked_user_id is null
      and nullif(btrim(cr.email), '') is not null
  ) q;

  insert into public.event_messages (
    event_id, event_title, event_when, sender_id, subject, body,
    include_work_items, exclude_not_attending, include_roster, recipient_count
  ) values (
    btrim(p_event_id), v_title, nullif(btrim(coalesce(p_event_when, '')), ''),
    auth.uid(), v_subject, v_body,
    coalesce(p_include_work_items, true), coalesce(p_exclude_not_attending, true),
    coalesce(p_include_roster, true), coalesce(v_count, 0)
  )
  returning id into v_id;

  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.send_event_message(text, text, text, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.send_event_message(text, text, text, text, text, boolean, boolean, boolean) to authenticated;

-- ── 4. Service-role payload for the mailer ────────────────────────────────────
-- Everything the email needs in one round-trip: the send's own copy, the live
-- event details, the resort-wide work items IN FULL (title + notes — the whole
-- point: "what is this task actually?"), a count-only summary per house, and
-- the recipient addresses.
create or replace function public.event_message_email(p_message uuid)
returns table(
  subject           text,
  body              text,
  sender_name       text,
  event_id          text,
  event_title       text,
  event_when        text,
  event_emoji       text,
  event_location    text,
  event_description text,
  work_items        jsonb,
  house_counts      jsonb,
  emails            text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.event_messages%rowtype;
  v_event uuid;
begin
  select * into m from public.event_messages where id = p_message;
  if not found then return; end if;

  begin
    v_event := m.event_id::uuid;
  exception when invalid_text_representation then
    v_event := null; -- seed/synthesized event: no events row to enrich from
  end;

  return query
  select
    m.subject,
    m.body,
    (select coalesce(nullif(btrim(p.display_name), ''), 'A member')
       from public.profiles p where p.id = m.sender_id),
    m.event_id,
    m.event_title,
    coalesce(
      m.event_when,
      (select case
                when e.end_date is not null and e.end_date <> e.start_date
                  then to_char(e.start_date, 'FMMon FMDD') || ' – ' || to_char(e.end_date, 'FMMon FMDD, YYYY')
                else to_char(e.start_date, 'FMDay, FMMon FMDD, YYYY')
              end
         from public.events e where e.id = v_event)
    ),
    (select e.emoji from public.events e where e.id = v_event),
    (select e.location from public.events e where e.id = v_event),
    (select e.description from public.events e where e.id = v_event),
    -- Resort-wide items only, ordered like the app's checklist (urgency, then
    -- newest). `custom` sorts between this_year and next_year, matching
    -- urgencyRank() in lib/workItems.ts.
    case when m.include_work_items then (
      select jsonb_agg(x order by x_rank, x_created desc)
      from (
        select
          jsonb_build_object(
            'title',        wi.title,
            'notes',        wi.notes,
            'urgency',      wi.urgency,
            'customLabel',  wi.custom_label,
            'customColor',  wi.custom_color,
            'peopleNeeded', wi.people_needed,
            'status',       wi.status
          ) as x,
          case wi.urgency
            when 'asap'         then 0
            when 'this_year'    then 10
            when 'custom'       then 15
            when 'next_year'    then 20
            when 'nice_to_have' then 30
            else 40
          end as x_rank,
          wi.created_at as x_created
        from public.event_work_items ewi
        join public.work_items wi on wi.id = ewi.work_item_id
        where ewi.event_id = m.event_id
          and wi.house_id is null
      ) s
    ) end,
    -- Per-house COUNTS only — never the titles (see the privacy note up top).
    case when m.include_work_items then (
      select jsonb_agg(
               jsonb_build_object('name', h.name, 'emoji', h.emoji, 'count', c.n)
               order by h.position, h.name
             )
      from (
        select wi.house_id as hid, count(*) as n
        from public.event_work_items ewi
        join public.work_items wi on wi.id = ewi.work_item_id
        where ewi.event_id = m.event_id
          and wi.house_id is not null
        group by wi.house_id
      ) c
      join public.houses h on h.id = c.hid
    ) end,
    array(
      -- Members with an account (verified, or invited-but-unverified temp).
      select u.email::text
      from public.profiles p
      join auth.users u on u.id = p.id
      where u.email is not null
        and (p.approved is true or p.is_admin is true)
        and p.email_alerts = true
        and not (
          m.exclude_not_attending
          and exists (
            select 1 from public.event_attendance ea
            where ea.event_id = m.event_id and ea.user_id = p.id and ea.status = 'not_going'
          )
        )
      union  -- dedupes against the account list and across both rosters
      -- Account-less family roster (0123) — manually added by an admin, so
      -- they're vetted; they have no email_alerts pref and no RSVP row.
      select btrim(fr.email)
      from public.family_roster fr
      where m.include_roster
        and fr.linked_user_id is null
        and nullif(btrim(fr.email), '') is not null
      union
      -- Account-less committee roster (0056) — same reasoning.
      select btrim(cr.email)
      from public.committee_roster cr
      where m.include_roster
        and cr.linked_user_id is null
        and nullif(btrim(cr.email), '') is not null
    );
end;
$$;
revoke all on function public.event_message_email(uuid) from public, anon, authenticated;
grant execute on function public.event_message_email(uuid) to service_role;

-- ── 5. Realtime (mailer watches INSERTs; its 3-min sweep is the safety net) ───
alter table public.event_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.event_messages; exception when duplicate_object then null; end $$;
