-- 0133_transactional_email_overrides.sql
--
-- Principle: profiles.email_alerts gates ONLY the broadcast alerts/notifications
-- sent from Admin -> Alerts & Notifications (the `alert_recipients` RPC, migration
-- 0127 — deliberately LEFT UNTOUCHED here). Every *transactional* email — meeting
-- proposal/confirmation, and the "message the guests staying here" cabin note —
-- must reach the whole room/guest list regardless of that toggle.
--
-- Two things this migration does:
--
-- 1. FIXES A REGRESSION from 0132. Migration 0123 had extended the meeting-email
--    RPCs to ALSO email account-less rostered people (committee_roster / family_roster
--    slots that have an email but no account yet — i.e. people not on the app yet).
--    0132 removed the email_alerts filter but was based on the older 0117/0118 and
--    accidentally dropped those UNIONs. This restores them AND keeps email_alerts
--    removed — so meeting emails reach: verified members, invited-but-unverified temp
--    accounts, AND account-less rostered people, none gated by email_alerts.
--
-- 2. OVERRIDES the cabin "message guests" recipient list (cabin_message_recipients,
--    0120) to drop its email_alerts filter — a note to the people currently staying
--    ("water's off this weekend") is transactional, not a broadcast alert.
--
-- Cabin approve/deny/edit/cancel emails already ignore email_alerts (they go to the
-- single requester via cabin_booking_notification, which never filtered), so no
-- change is needed there. No mailer code change — it sends whatever these RPCs return.

-- ── Meeting proposal email (restore 0123 UNIONs, minus email_alerts) ──────────
create or replace function public.meeting_proposal_email(p_meeting uuid)
returns table(title text, url text, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then return; end if;

  return query
  select
    m.title,
    public._meeting_url(m),
    array(
      -- Room members with an account (verified or invited-but-unverified temp).
      select u.email::text
      from public.profiles p
      join auth.users u on u.id = p.id
      where u.email is not null
        and p.id <> coalesce(m.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          case
            when m.scope_type = 'committee' then exists (
              select 1 from public.committee_roster r
              where r.committee_slug = m.committee_slug
                and r.linked_user_id = p.id
                and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
            )
            when m.scope_type = 'house' then p.house_id = m.house_id
            else false
          end
        )
      union
      -- Account-less committee roster (committee meetings), matching area.
      select btrim(r.email)
      from public.committee_roster r
      where m.scope_type = 'committee'
        and r.committee_slug = m.committee_slug
        and r.linked_user_id is null
        and nullif(btrim(r.email), '') is not null
        and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
      union
      -- Account-less family roster (house meetings), assigned to the house.
      select btrim(fr.email)
      from public.family_roster fr
      where m.scope_type = 'house'
        and fr.house_id = m.house_id
        and fr.linked_user_id is null
        and nullif(btrim(fr.email), '') is not null
    );
end;
$$;
revoke all on function public.meeting_proposal_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_proposal_email(uuid) to service_role;

-- ── Meeting confirmation email (restore 0123 UNIONs, minus email_alerts) ──────
create or replace function public.meeting_confirmed_email(p_meeting uuid)
returns table(title text, description text, meet_url text, when_label text, url text, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  m    public.meetings%rowtype;
  slot public.meeting_slots%rowtype;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found or m.chosen_slot_id is null then return; end if;
  select * into slot from public.meeting_slots where id = m.chosen_slot_id;
  if not found then return; end if;

  return query
  select
    m.title,
    m.description,
    m.meet_url,
    to_char(slot.starts_at at time zone 'America/Chicago', 'FMDay, FMMonth FMDD')
      || ' at ' || to_char(slot.starts_at at time zone 'America/Chicago', 'FMHH12:MI AM'),
    public._meeting_url(m),
    array(
      select u.email::text
      from public.profiles p
      join auth.users u on u.id = p.id
      where u.email is not null
        and (
          case
            when m.scope_type = 'committee' then exists (
              select 1 from public.committee_roster r
              where r.committee_slug = m.committee_slug
                and r.linked_user_id = p.id
                and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
            )
            when m.scope_type = 'house' then p.house_id = m.house_id
            else false
          end
        )
      union
      select btrim(r.email)
      from public.committee_roster r
      where m.scope_type = 'committee'
        and r.committee_slug = m.committee_slug
        and r.linked_user_id is null
        and nullif(btrim(r.email), '') is not null
        and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
      union
      select btrim(fr.email)
      from public.family_roster fr
      where m.scope_type = 'house'
        and fr.house_id = m.house_id
        and fr.linked_user_id is null
        and nullif(btrim(fr.email), '') is not null
    );
end;
$$;
revoke all on function public.meeting_confirmed_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_confirmed_email(uuid) to service_role;

-- ── Cabin "message guests" recipients (drop email_alerts) ─────────────────────
create or replace function public.cabin_message_recipients(p_message uuid)
returns table(subject text, body text, cabin_name text, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.cabin_messages%rowtype;
begin
  select * into m from public.cabin_messages where id = p_message;
  if not found then return; end if;

  return query
  select
    m.subject,
    m.body,
    (select name from public.cabins where id = m.cabin_id),
    array(
      select distinct u.email::text
      from public.cabin_bookings b
      join public.profiles p on p.id = b.user_id
      join auth.users u on u.id = p.id
      where b.cabin_id = m.cabin_id
        and b.status = 'approved'
        and b.check_out >= current_date
        and u.email is not null
        and p.id <> coalesce(m.sender_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );
end;
$$;
revoke all on function public.cabin_message_recipients(uuid) from public, anon, authenticated;
grant execute on function public.cabin_message_recipients(uuid) to service_role;
