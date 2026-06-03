-- 0011_admin_signin_log.sql
-- Admin: recent authentication events with the IP they came from, so an admin
-- can sanity-check that access attempts look local — not from some random
-- far-off place. Reads GoTrue's `auth.audit_log_entries` (admins only). The
-- IP → approximate city/country is resolved in the app, not here.
--
-- `auth.audit_log_entries` columns: id, payload (json: actor_username, action,
-- …), created_at, ip_address. We surface access-relevant events and skip the
-- constant token refreshes / logouts that just add noise.
--
-- Apply: paste into the Supabase SQL editor and Run.

create or replace function public.recent_signins(limit_n int default 50)
returns table (
  created_at timestamptz,
  email text,
  action text,
  ip_address text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  return query
    select a.created_at,
           (a.payload ->> 'actor_username')::text,
           (a.payload ->> 'action')::text,
           a.ip_address::text
    from auth.audit_log_entries a
    where coalesce(a.payload ->> 'action', '') not in ('token_refreshed', 'logout')
      and a.ip_address is not null
      and a.ip_address <> ''
    order by a.created_at desc
    limit greatest(1, least(coalesce(limit_n, 50), 200));
end;
$$;

revoke all on function public.recent_signins(int) from public, anon;
grant execute on function public.recent_signins(int) to authenticated;
