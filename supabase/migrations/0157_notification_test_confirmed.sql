-- 0157_notification_test_confirmed.sql
-- "Notification Test" (Admin dashboard) grows a lightweight per-member
-- checklist alongside the single-member test ping (0156): once an admin has
-- watched a member's phone actually receive a test notification, they can
-- check "Notifications confirmed" next to that member's name — a simple,
-- admin-visible record of who's been verified. It's deliberately just a flag
-- (not gated behind anything else in the app, doesn't affect notif_types or
-- push_types) — any admin can check or uncheck it for any member.

alter table public.profiles
  add column if not exists notifications_confirmed boolean not null default false,
  add column if not exists notifications_confirmed_at timestamptz,
  add column if not exists notifications_confirmed_by uuid references public.profiles(id) on delete set null;

-- Admin-only write path — same guardrail as is_admin/set_admin (0008) and
-- beta_tester/set_beta_tester (0029): deliberately NOT in any client update
-- grant (profiles' blanket `revoke update ... from authenticated`, 0001,
-- covers new columns by default), so this RPC is the only way to flip it.
create or replace function public.set_notification_test_confirmed(
  p_user  uuid,
  p_value boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'Member not found';
  end if;

  update public.profiles
     set notifications_confirmed = p_value,
         notifications_confirmed_at = case when p_value then now() else null end,
         notifications_confirmed_by = case when p_value then auth.uid() else null end
   where id = p_user;
end;
$$;
revoke all on function public.set_notification_test_confirmed(uuid, boolean) from public, anon;
grant execute on function public.set_notification_test_confirmed(uuid, boolean) to authenticated;
