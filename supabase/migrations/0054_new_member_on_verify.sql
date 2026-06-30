-- 0054_new_member_on_verify.sql
-- Only create a profile (and notify admins) when OTP is verified, not at
-- email-submission time. Fixes two problems:
--   1) Typo/abandoned emails that never verify get no profile row and never
--      appear in the member directory or admin views.
--   2) Admin "new member" push fires at verification, not at email entry.
--
-- How it works:
--   handle_new_user  (auth.users INSERT)  — skips profile creation when
--     email_confirmed_at is NULL (OTP flow). Admin invites that arrive
--     pre-confirmed still go through the normal path.
--   handle_user_email_confirmed (auth.users UPDATE) — called the first time
--     email_confirmed_at is set; upserts the profile row (with joined_at
--     stamped) so the member appears in the app for the first time.
--
-- push-sender.js switches from profiles INSERT → profiles UPDATE where
-- joined_at transitions from NULL to a value.

-- Add joined_at (NULL = unverified stub; set = fully joined member).
alter table public.profiles
  add column if not exists joined_at timestamptz;

-- Existing members are already verified — backfill so they are never re-notified.
update public.profiles set joined_at = now() where joined_at is null;

-- Replace handle_new_user: skip profile creation for unconfirmed OTP sign-ups.
-- Admin invites and any flow that pre-confirms the email still create the row
-- immediately (email_confirmed_at is non-null at INSERT time).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- OTP sign-ups: email_confirmed_at is NULL at this point — defer to
  -- handle_user_email_confirmed so the profile only appears after verification.
  if new.email_confirmed_at is null then
    return new;
  end if;

  insert into public.profiles (id, display_name, contact_email, joined_at)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.email,
    new.email_confirmed_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Stamp joined_at (and create the profile if needed) when OTP is verified.
create or replace function public.handle_user_email_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    insert into public.profiles (id, display_name, contact_email, joined_at)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
      new.email,
      new.email_confirmed_at
    )
    on conflict (id) do update
      set joined_at = excluded.joined_at
      where public.profiles.joined_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update on auth.users
  for each row execute function public.handle_user_email_confirmed();
