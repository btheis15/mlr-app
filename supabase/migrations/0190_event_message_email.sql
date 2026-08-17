-- 0190_event_message_email.sql
-- "Email everyone about this event" — a clean, professional email describing an
-- event AND exactly what's assigned to it, so a work weekend's task list (each
-- item's title + details) lands in people's inboxes instead of only living in
-- the app. Same shape as the cabin "message guests" feature (0120): one log row
-- per send carrying a notify_email flag + a claimed email_sent_at, with the
-- mac-mini alert-mailer building and BCC'ing the mail.
--
-- WHO CAN SEND: admin OR the event's own creator — the 0187 doctrine, so the
-- member who spun up the Work Weekend can email about it without being an
-- admin. This is not a new capability so much as a better delivery mechanism:
-- any member can already email Everyone from the People page's group-email
-- composer (it just hands off to a mailto: draft). A seed/synthesized event
-- (Family Fest, a gcal/meeting-sourced row) has no `events.created_by` to
-- match, so it stays admin-only — same as update_event/sync_event_work_items.
--
-- ⚠️⚠️ ONE SEND PER AUDIENCE ("buckets"), NOT ONE EMAIL.
-- A house-scoped work item is visible only to that house's members + admins
-- (0066 RLS / 0189), and a single BCC'd email has one body for everyone — so
-- this returns the recipients pre-sorted into buckets and the mailer sends one
-- email per bucket:
--   • one bucket PER HOUSE that has items on this event → that house's people
--     get the resort-wide items AND their own house's items, in full;
--   • the "general" bucket (everyone else — no house, or a house with nothing
--     assigned here) → resort-wide items only, with no hint that a house has
--     its own list.
-- Every send is BCC, so nobody sees who else got it (and can't infer buckets).
-- A person lands in EXACTLY ONE bucket — keyed off their own profiles.house_id
-- (or family_roster.house_id when they have no account) — so nobody is emailed
-- twice. Admins are bucketed by their own house like everyone else rather than
-- getting every house's list, which would mean several emails to one person;
-- the app already shows an admin everything.
--
-- ⚠️ ONLY WHAT'S ASSIGNED. Completed items are excluded outright
-- (`wi.status <> 'done'`) — a done task is noise in an email about what still
-- needs doing. The app remains the place to see history.
--
-- RECIPIENTS — three groups, deduped by address:
--   1. Members with an account (verified, OR invited-but-unverified temp
--      accounts from /admin/invite), gated on profiles.approved + email_alerts.
--   2. Account-less **family_roster** slots with an email (0123) — bucketed by
--      that slot's own house_id.
--   3. Account-less **committee_roster** slots with an email (0056) — no house
--      concept there, so always the general bucket.
-- Groups 2-3 are the people who "aren't on the app yet but are on the family
-- roster" — added by hand by an admin, so they're already vetted, and they have
-- no email_alerts pref or RSVP row to filter on. Included by default, switched
-- off with p_include_roster, mirroring the UNIONs the meeting emails use (0123,
-- restored in 0133).
--
-- Computed here rather than reusing alert_recipients() (0127) for two reasons:
-- that function predates the approval gate and does not check
-- profiles.approved — emailing the family's work-weekend plan to a
-- self-signed-up, not-yet-approved address is exactly what 0181/0183 exist to
-- prevent — and it has no roster UNIONs or bucketing. Otherwise the rules match
-- the established doctrine: honors profiles.email_alerts for account holders
-- (this is a broadcast, not a transactional receipt — see the PRINCIPLE note in
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
  -- Which buckets ('general' or a house uuid) have already been sent. The
  -- multi-send above means a failure partway through must NOT re-send the
  -- buckets that already went out on retry; the mailer appends each bucket here
  -- as it succeeds and skips anything already listed.
  sent_buckets          text[] not null default '{}',
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

  -- Total distinct people across every bucket (same predicates the mailer's own
  -- recipient query uses) so the UI can say "emailing N people" immediately.
  select count(*) into v_count from (
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
-- One round-trip returning everything for EVERY bucket:
--   mlr_items      — resort-wide open items, in full (every bucket gets these)
--   house_groups   — [{houseId, name, emoji, items[], emails[]}] one per house
--                    that has open items on this event
--   general_emails — everyone not in one of those houses
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
  mlr_items         jsonb,
  house_groups      jsonb,
  general_emails    text[]
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
  with items as (
    -- Open items only — a completed task is noise in a "here's what's assigned"
    -- email. `rank` mirrors urgencyRank() in lib/workItems.ts, where a `custom`
    -- urgency sorts between this_year and next_year.
    select
      wi.house_id,
      wi.created_at,
      case wi.urgency
        when 'asap'         then 0
        when 'this_year'    then 10
        when 'custom'       then 15
        when 'next_year'    then 20
        when 'nice_to_have' then 30
        else 40
      end as rank,
      jsonb_build_object(
        'title',        wi.title,
        'notes',        wi.notes,
        'urgency',      wi.urgency,
        'customLabel',  wi.custom_label,
        'customColor',  wi.custom_color,
        'peopleNeeded', wi.people_needed
      ) as item
    from public.event_work_items ewi
    join public.work_items wi on wi.id = ewi.work_item_id
    where ewi.event_id = m.event_id
      and wi.status <> 'done'
      and m.include_work_items
  ),
  item_houses as (
    select distinct i.house_id as hid from items i where i.house_id is not null
  ),
  -- Every recipient with the ONE bucket they belong to: their own house when
  -- that house has items here, else null (= the general bucket).
  recips as (
    select
      u.email::text as email,
      case when p.house_id in (select ih.hid from item_houses ih) then p.house_id end as bucket
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
    union all
    -- Account-less family roster — bucketed by that slot's own house.
    select
      btrim(fr.email),
      case when fr.house_id in (select ih.hid from item_houses ih) then fr.house_id end
    from public.family_roster fr
    where m.include_roster
      and fr.linked_user_id is null
      and nullif(btrim(fr.email), '') is not null
    union all
    -- Account-less committee roster — no house concept, always general.
    select btrim(cr.email), null::uuid
    from public.committee_roster cr
    where m.include_roster
      and cr.linked_user_id is null
      and nullif(btrim(cr.email), '') is not null
  ),
  -- Collapse duplicate addresses to a single bucket, preferring a house one so
  -- a house member is never demoted to the general (house-less) email.
  bucketed as (
    select r.email, (array_agg(r.bucket) filter (where r.bucket is not null))[1] as bucket
    from recips r
    group by r.email
  )
  select
    m.subject,
    m.body,
    (select coalesce(nullif(btrim(pr.display_name), ''), 'A member')
       from public.profiles pr where pr.id = m.sender_id),
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
    (select jsonb_agg(i.item order by i.rank, i.created_at desc)
       from items i where i.house_id is null),
    (select jsonb_agg(
              jsonb_build_object(
                'houseId', h.id,
                'name',    h.name,
                'emoji',   h.emoji,
                'items',   (select jsonb_agg(i.item order by i.rank, i.created_at desc)
                              from items i where i.house_id = h.id),
                'emails',  (select coalesce(array_agg(b.email), '{}'::text[])
                              from bucketed b where b.bucket = h.id)
              ) order by h.position, h.name
            )
       from public.houses h
      where exists (select 1 from items i where i.house_id = h.id)),
    (select coalesce(array_agg(b.email), '{}'::text[])
       from bucketed b where b.bucket is null);
end;
$$;
revoke all on function public.event_message_email(uuid) from public, anon, authenticated;
grant execute on function public.event_message_email(uuid) to service_role;

-- ── 5. Realtime (mailer watches INSERTs; its 3-min sweep is the safety net) ───
alter table public.event_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.event_messages; exception when duplicate_object then null; end $$;
