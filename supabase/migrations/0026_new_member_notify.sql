-- 0026_new_member_notify.sql
-- Notify admins (push) when a new member joins, so they know who joined and when.
--
-- Two pieces:
--  1) profiles.notify_new_members — a per-admin opt-out (default ON). Members
--     change their own email etc. as before; this flag only matters for admins,
--     since the mini's push-sender only notifies admins. Default true so it works
--     out of the box; the admin-only toggle in Profile -> Notifications writes it.
--  2) profiles is added to the realtime publication so the mini's push-sender can
--     listen for the INSERT that handle_new_user() fires on every signup (whether
--     a self sign-up or an admin invite) and push every opted-in admin.
--
-- Apply: paste into the Supabase SQL editor and Run.

alter table public.profiles
  add column if not exists notify_new_members boolean not null default true;

-- Members may set their own pref — column-level grant, same guardrail pattern as
-- 0020 (still can't touch is_admin, etc.).
grant update (notify_new_members) on public.profiles to authenticated;

-- Let Realtime broadcast profile INSERTs to the mini's push-sender. profiles is
-- already world-readable (no new exposure); duplicate-tolerant if already added.
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
