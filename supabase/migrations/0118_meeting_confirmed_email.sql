-- 0118_meeting_confirmed_email.sql
-- The CONFIRMATION email: when a meeting is finalized to a specific time WITH a
-- Google Meet link (finalize_meeting, 0116), every member of the group gets a
-- polished email describing the meeting + a big "Join the Google Meet" button.
-- Unlike the optional proposal email (0117, an opt-in checkbox), this one always
-- goes out on confirmation — it's the payoff — but still respects each member's
-- profiles.email_alerts opt-in, and includes the organizer (they want the link
-- too). No change to finalize_meeting: the mac-mini alert-mailer watches for a
-- meeting turning 'scheduled' with a meet_url and claims confirm_email_sent_at,
-- so a linkless finalize sends nothing until the link is added later (then it
-- fires with the link). Same claim-a-row pattern as every other mailer path.
--
-- Apply in the Supabase SQL editor after 0117.

alter table public.meetings
  add column if not exists confirm_email_sent_at timestamptz;

-- Service-role recipient list + preformatted details for the confirmation email.
-- Emails = every room member with email_alerts on (INCLUDING the organizer).
-- when_label is rendered in the resort's local time (Central), like the chat
-- message finalize_meeting posts.
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
      where p.email_alerts = true
        and u.email is not null
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
