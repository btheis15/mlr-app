-- 0132_meeting_email_all_members.sql
--
-- Meeting emails should reach EVERYONE in the room, not just members who have
-- the general "Email alerts" toggle on. That toggle (profiles.email_alerts) is
-- for passive broadcast announcements — but a meeting proposal ("mark when
-- you're free") and a meeting confirmation ("here's the Google Meet link") are
-- deliberate, actionable emails about a meeting you're part of, so the opt-in
-- for alerts shouldn't silently drop you from them.
--
-- This drops the `p.email_alerts = true` filter from both meeting-email recipient
-- RPCs (0117 proposal, 0118 confirmation), keeping every other condition: valid
-- email, room membership (committee roster + area / house), and — for the
-- proposal — excluding the organizer. The proposal email is still OPT-IN overall
-- (it only sends when the organizer checks "Also email everyone a link to vote",
-- which stamps meetings.notify_email); this only changes WHO it reaches once
-- opted in. No mac-mini mailer change is needed — it just sends whatever these
-- RPCs return.

-- ── Proposal email (was migration 0117) ──────────────────────────────────────
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
    );
end;
$$;
revoke all on function public.meeting_proposal_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_proposal_email(uuid) to service_role;

-- ── Confirmation email (was migration 0118) ──────────────────────────────────
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
    );
end;
$$;
revoke all on function public.meeting_confirmed_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_confirmed_email(uuid) to service_role;
