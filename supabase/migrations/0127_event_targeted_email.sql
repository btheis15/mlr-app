-- 0127_event_targeted_email.sql
-- Event-targeted broadcasts (migration 0096) already hide a banner, Home
-- callout, or Activity-tab notification from anyone who explicitly RSVP'd
-- "Can't make it" to the linked event — but the EMAIL side of a banner send
-- (alert-mailer.js's `handle()`, via `alert_recipients()`) never checked event
-- attendance at all, so an admin linking an alert to an event and emailing
-- opted-in members would still email people who said they're not coming. This
-- widens `alert_recipients()` the same way `send_broadcast_notification` was
-- widened in 0096, so the mailer can pass the announcement's own
-- event_id/exclude_not_attending through.
--
-- Explicit DROP before CREATE (rather than relying on CREATE OR REPLACE to
-- extend the existing 1-arg signature in place) — adding parameters changes a
-- function's identity in Postgres, so without the DROP the old 1-arg overload
-- would silently keep existing alongside the new one (the exact
-- request_cabin_stay overload-coexistence bug from migration 0115, avoided
-- here by following 0017's own drop-then-create pattern instead).

drop function if exists public.alert_recipients(text);

create or replace function public.alert_recipients(
  audience text default 'all',
  p_event_id text default null,
  p_exclude_not_attending boolean default false
)
returns table (email text)
language sql
security definer
set search_path = ''
as $$
  select u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.email_alerts = true
    and u.email is not null
    and (audience is distinct from 'admins' or p.is_admin = true)
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
$$;
revoke all on function public.alert_recipients(text, text, boolean) from public, anon, authenticated;
grant execute on function public.alert_recipients(text, text, boolean) to service_role;
