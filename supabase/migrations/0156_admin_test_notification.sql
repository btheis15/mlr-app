-- 0156_admin_test_notification.sql
-- Admin tool: ping ONE specific member with a test notification (Activity tab
-- + phone push), so an admin can check that a member's notifications are
-- actually working for them — e.g. "I'm not getting notified" support
-- requests. Nothing is sent until an admin explicitly picks a member and taps
-- send; there's no audience/schedule, just a single targeted row.
--
-- Bypasses profiles.notif_types entirely, same as the 'broadcast' kind (0030)
-- — the admin explicitly targeted this one person, so there's no preference
-- to check. The phone push is likewise an OVERRIDE in both mini senders (see
-- push-sender.js / apns-sender.js, mirroring help_urgent/signup_reminder): it
-- reaches anyone with phone push on regardless of their per-category picks,
-- since the whole point is testing the pipeline itself, not respecting a
-- category preference.

create or replace function public.send_test_notification(
  p_user  uuid,
  p_title text default null,
  p_body  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'Member not found';
  end if;

  insert into public.notifications
    (recipient_id, type, actor_id, title, body, entity_type)
  values
    (p_user, 'admin_test', auth.uid(),
     coalesce(nullif(btrim(p_title), ''), '🔔 Test notification'),
     coalesce(nullif(btrim(p_body), ''), 'An admin sent this to check your notification settings.'),
     'admin_test')
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.send_test_notification(uuid, text, text) from public, anon;
grant execute on function public.send_test_notification(uuid, text, text) to authenticated;
