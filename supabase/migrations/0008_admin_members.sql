-- 0008_admin_members.sql
-- Admin member management (see who's registered; promote/demote admins).
--
-- Two SECURITY DEFINER functions, both gated to existing admins:
--   • admin_members()        → the member directory WITH private emails. We keep
--     emails OUT of the public `profiles` table (it's world-readable), so admins
--     read them through this function instead of exposing the column.
--   • set_admin(target,value) → flip another member's is_admin. Clients are
--     blocked from writing is_admin directly (see 0001), so this is the only way
--     to grant/revoke admin from inside the app.
--
-- Apply: paste into the Supabase SQL editor and Run. Until it's run, the admin
-- Members list still works from the public profiles table (no emails) and the
-- promote/remove buttons are disabled with a "run the migration" note.

-- The member directory, emails included — admins only.
create or replace function public.admin_members()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  household text,
  email text,
  is_admin boolean,
  created_at timestamptz
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
    select p.id, p.display_name, p.avatar_url, p.household,
           u.email::text, p.is_admin, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.is_admin desc, lower(coalesce(p.display_name, u.email::text));
end;
$$;

revoke all on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;

-- Grant/revoke another member's admin — admins only; you can't drop your own.
create or replace function public.set_admin(target uuid, value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if target = auth.uid() and value = false then
    raise exception 'You can''t remove your own admin access.';
  end if;
  update public.profiles set is_admin = value where id = target;
end;
$$;

revoke all on function public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.set_admin(uuid, boolean) to authenticated;
