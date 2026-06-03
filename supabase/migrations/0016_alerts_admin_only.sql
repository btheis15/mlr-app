-- 0016_alerts_admin_only.sql
-- App-wide alerts (the broadcast banner + email) are now APP ADMINS ONLY.
-- (0015 also allowed Family Fest leads; the resort decided alerts that reach
-- everyone / go to email should be admin-only.) This ONLY changes who can post
-- announcements — Committee Leads keep all their member-management powers
-- (is_committee_lead is untouched). The announcements INSERT policy already
-- calls can_post_alerts(), so redefining the function is all that's needed.
-- Apply after 0015.
create or replace function public.can_post_alerts()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;
revoke all on function public.can_post_alerts() from public, anon;
grant execute on function public.can_post_alerts() to authenticated;
