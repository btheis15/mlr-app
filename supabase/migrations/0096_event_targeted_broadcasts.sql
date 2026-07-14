-- 0096_event_targeted_broadcasts.sql
-- Lets an admin link a Home callout, a top-of-app banner alert, or a
-- broadcast notification to a specific event, and hide it from anyone who
-- explicitly RSVP'd "Can't make it" to that event (default ON once an event
-- is picked). Deliberately does NOT hide it from a no-response member — they
-- might still come, and seeing it could nudge them to RSVP; only an explicit
-- decline suppresses it. See lib/eventTargeting.ts for the shared client rule.
--
-- Callouts and the banner render fully client-side (see HomeSpotlight /
-- AnnouncementBanner), so their filtering happens in the browser against the
-- viewer's own event_attendance row — these two just need the extra columns.
-- Broadcast notifications persist one row per recipient at send time, so
-- send_broadcast_notification does the filtering server-side.

alter table public.home_callouts
  add column if not exists event_id text,
  add column if not exists exclude_not_attending boolean not null default true;

alter table public.announcements
  add column if not exists event_id text,
  add column if not exists exclude_not_attending boolean not null default true;

-- Adds two new trailing-default parameters — CREATE OR REPLACE allows this
-- without a DROP as long as existing parameter names/types/order are
-- untouched, so every existing caller keeps working unchanged.
create or replace function public.send_broadcast_notification(
  p_title text,
  p_body text default null,
  p_url text default null,
  p_audience text default 'everyone',
  p_expires_at timestamptz default null,
  p_event_id text default null,
  p_exclude_not_attending boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'A title is required';
  end if;
  if p_audience not in ('everyone', 'beta', 'admins') then
    raise exception 'Unknown audience';
  end if;

  insert into public.notifications
    (recipient_id, type, actor_id, title, body, url, entity_type, expires_at)
  select p.id, 'broadcast', auth.uid(), p_title, nullif(p_body, ''), nullif(p_url, ''),
         'broadcast', p_expires_at
  from public.profiles p
  where case p_audience
          when 'everyone' then true
          when 'beta'     then p.beta_tester
          when 'admins'   then p.is_admin
        end
    and not (
      p_exclude_not_attending
      and p_event_id is not null
      and exists (
        select 1 from public.event_attendance ea
        where ea.event_id = p_event_id
          and ea.user_id = p.id
          and ea.status = 'not_going'
      )
    );

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.send_broadcast_notification(text, text, text, text, timestamptz, text, boolean) from public, anon;
grant execute on function public.send_broadcast_notification(text, text, text, text, timestamptz, text, boolean) to authenticated;
