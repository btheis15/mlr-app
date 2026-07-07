-- 0073_new_member_notify_review_exception.sql
-- Exempt the App Store review account from the "new member" admin alert.
--
-- The reviewer signs in through a hidden bypass account (appreview@…). When its
-- profile is created/confirmed, joined_at gets stamped like any member, which
-- would normally fan out a "👋 … joined the resort" notification to every admin
-- (0062) and a web push (push-sender.js). This adds an email exception so the
-- reviewer account is created silently — no admin is notified.
--
-- Companion guard for the mini's web push lives in media-server/push-sender.js
-- (handleNewMember skips the same email). apns-sender.js never pushed new_member.
--
-- Idempotent: re-defines the function only; triggers from 0062 are unchanged.
-- Apply: paste into the Supabase SQL editor and Run.

create or replace function public.notif_on_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- Fire exactly once, when joined_at is first stamped (0054/0062).
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
