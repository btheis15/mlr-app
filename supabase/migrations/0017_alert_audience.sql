-- 0017_alert_audience.sql
-- Let an alert choose who gets the EMAIL: everyone opted in ('all'), or app
-- admins only ('admins'). The in-app banner is always seen by everyone; this is
-- only about the email copy. Apply after 0016.

alter table public.announcements
  add column if not exists email_audience text not null default 'all'
    check (email_audience in ('all', 'admins'));

-- alert_recipients now takes an audience. Default 'all' so an arg-less call (the
-- old mailer) still works → no broken window during rollout. 'admins' restricts
-- to opted-in app admins.
drop function if exists public.alert_recipients();
create or replace function public.alert_recipients(audience text default 'all')
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
    and (audience is distinct from 'admins' or p.is_admin = true);
$$;
revoke all on function public.alert_recipients(text) from public, anon, authenticated;
grant execute on function public.alert_recipients(text) to service_role;
