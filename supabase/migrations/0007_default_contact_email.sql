-- 0007_default_contact_email.sql
-- Default each member's contact email to the address they registered with, so
-- "Email" works on the member card without anyone re-typing it. Existing
-- members are backfilled; new sign-ups get it from the signup trigger. Members
-- can still change it in Profile → Contact & payment (only overwrites blanks).
--
-- Apply: paste into the Supabase SQL editor and Run.

-- 1) Backfill existing profiles from their auth email (only where unset).
update public.profiles p
set contact_email = u.email
from auth.users u
where p.id = u.id
  and u.email is not null
  and (p.contact_email is null or p.contact_email = '');

-- 2) Seed contact_email from the auth email for future sign-ups (the trigger
--    that creates the profile row; replacing the function keeps the existing
--    on_auth_user_created trigger pointing at the new version).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, contact_email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
