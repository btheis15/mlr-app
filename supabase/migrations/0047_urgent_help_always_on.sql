-- 0047_urgent_help_always_on.sql
-- Urgent help (category='urgent') is an emergency: it must reach EVERYONE and
-- can't be muted in-app. The ONLY way it's "off" is the device's notification
-- permission / master push switch being off.
--
-- Today `_notify` drops a notification when the recipient hasn't opted into that
-- `type`, so a member who unticked 'help_urgent' got no feed row — and because
-- the mini's push override keys off that feed row existing, they also got no
-- push. This makes _notify treat 'help_urgent' as non-suppressible: it's always
-- inserted (still skipping the actor and a null recipient). Every other kind
-- still respects the per-member `notif_types` pref. The UI no longer offers a
-- toggle for it (Profile → Notifications).
--
-- Apply: paste into the Supabase SQL editor and Run (after 0046).

create or replace function public._notify(
  p_recipient uuid, p_type text, p_actor uuid, p_title text,
  p_body text default null, p_url text default null,
  p_entity_type text default null, p_entity_id uuid default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_recipient = p_actor then return; end if;
  -- 'help_urgent' is an emergency broadcast — never gated on the per-member
  -- notif_types pref (it can't be muted in-app). Everything else respects it.
  if p_type <> 'help_urgent' and not exists (
    select 1 from public.profiles p
    where p.id = p_recipient and p_type = any(p.notif_types)
  ) then
    return;
  end if;
  insert into public.notifications
    (recipient_id, type, actor_id, title, body, url, entity_type, entity_id, expires_at)
  values
    (p_recipient, p_type, p_actor, p_title, p_body, p_url, p_entity_type, p_entity_id, p_expires_at);
end;
$$;
