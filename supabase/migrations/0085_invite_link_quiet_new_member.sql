-- 0085_invite_link_quiet_new_member.sql
-- The new /admin/invite-link flow (branded, sign-in-without-a-code invites)
-- tags the auth user it creates with raw_user_meta_data.invited_via =
-- 'invite_link'. An admin who bulk-invites a whole list of family members
-- already knows exactly who's joining — getting a "👋 X joined the resort"
-- feed notification (0062/0077) AND a phone push (push-sender.js/
-- apns-sender.js) for every single one as they trickle in over the next few
-- days/weeks is just noise. This carries that tag from auth.users onto
-- profiles (mirroring how display_name/contact_email are already seeded from
-- raw_user_meta_data, 0054) so the notification trigger — and the mini's push
-- senders — can skip it, the same way the App Review account is already
-- skipped (0077).
--
-- Organic self-signups and the OLDER code-based /admin/invite are untouched —
-- neither sets this metadata key, so they keep notifying admins as before.
--
-- Companion guards for the mini's phone push live in
-- media-server/push-sender.js and media-server/apns-sender.js
-- (maybeNewMember skips rows where invited_via = 'invite_link').
--
-- Apply: paste into the Supabase SQL editor and Run (after 0084).

alter table public.profiles
  add column if not exists invited_via text;

-- Re-seed invited_via alongside display_name/contact_email at profile
-- creation, from whichever path creates the row first (0054's two triggers).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  insert into public.profiles (id, display_name, contact_email, joined_at, invited_via)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.email,
    new.email_confirmed_at,
    nullif(new.raw_user_meta_data ->> 'invited_via', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.handle_user_email_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    insert into public.profiles (id, display_name, contact_email, joined_at, invited_via)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
      new.email,
      new.email_confirmed_at,
      nullif(new.raw_user_meta_data ->> 'invited_via', '')
    )
    on conflict (id) do update
      set joined_at = excluded.joined_at,
          invited_via = excluded.invited_via
      where public.profiles.joined_at is null;
  end if;
  return new;
end;
$$;

-- Skip the admin feed notification for invite-link joins, right alongside the
-- existing App Review exemption (0077).
create or replace function public.notif_on_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if NEW.joined_at is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.joined_at is not null then
    return NEW;
  end if;

  -- App Review bypass: never notify admins about the reviewer account.
  if lower(coalesce(NEW.contact_email, '')) = 'appreview@muskellungelakeresort.com' then
    return NEW;
  end if;

  -- Admin-initiated invite-link joins: the admin already knows who's coming.
  if NEW.invited_via = 'invite_link' then
    return NEW;
  end if;

  v_name := coalesce(nullif(btrim(NEW.display_name), ''), 'A new member');

  insert into public.notifications
    (recipient_id, type, actor_id, title, body, url, entity_type, entity_id)
  select a.id,
         'new_member',
         NEW.id,
         '👋 ' || v_name || ' joined the resort',
         null,
         '/people?member=' || NEW.id,
         'profile',
         NEW.id
  from public.profiles a
  where a.is_admin
    and coalesce(a.notify_new_members, true)
    and a.id <> NEW.id;

  return NEW;
end;
$$;
