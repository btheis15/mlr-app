-- 0062_new_member_notification_feed.sql
-- New-member joins were PUSH-ONLY: the Mac-mini push-sender.js watched
-- profiles.joined_at and pushed admins in a ~10-minute realtime window (0026 +
-- 0054). There was NO durable record — nothing in the in-app Activity feed, no
-- badge, and if the mini was down or missed the event, the alert vanished with
-- no retry. That's why an admin could get zero trace of a join.
--
-- This adds a feed row for new members, exactly like every other alert
-- (0030): fan-out-on-write, one notifications row per opted-in admin, created by
-- a SECURITY DEFINER trigger. It's independent of the mini, shows in Activity,
-- and drives the badge.
--
-- Gating: notify_new_members (the new-member opt-out, default ON, 0026) — NOT
-- notif_types (which the shared _notify helper checks), so we insert directly
-- like send_broadcast_notification does.
--
-- Push behavior is UNCHANGED: apns-sender.js only pushes its PUSHABLE set, which
-- does not include 'new_member', so this creates NO duplicate push. (See the
-- companion note if you also want the push routed through the reliable feed.)
--
-- Apply: paste into the Supabase SQL editor and Run (after 0061).

create or replace function public.notif_on_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- Fire exactly once, when joined_at is first stamped: either an OTP verify
  -- (UPDATE null -> value, 0054) or a pre-confirmed admin invite (INSERT with
  -- joined_at already set). Never on later profile edits / re-sign-ins.
  if NEW.joined_at is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.joined_at is not null then
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

drop trigger if exists trg_notif_new_member_ins on public.profiles;
create trigger trg_notif_new_member_ins
  after insert on public.profiles
  for each row execute function public.notif_on_new_member();

drop trigger if exists trg_notif_new_member_upd on public.profiles;
create trigger trg_notif_new_member_upd
  after update of joined_at on public.profiles
  for each row execute function public.notif_on_new_member();
