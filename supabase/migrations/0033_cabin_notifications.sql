-- 0033_cabin_notifications.sql
-- Wire cabin-stay events into the in-app Notifications feed (0030) so they're
-- toggleable per-type in Profile → Notifications, like every other kind:
--   • cabin_request  — a member submitted a cabin request → notify app admins.
--   • cabin_decision — an admin approved/denied a request → notify the requester.
-- Both are added to profiles.notif_types (default + backfill, so existing members
-- get them ON), and AFTER triggers on cabin_bookings fan out via _notify() (which
-- respects each recipient's notif_types). The mini's push-sender is updated to
-- check the SAME notif_types before pushing cabin events, so the profile toggle
-- turns the phone push on/off too (one switch per type). Apply after 0032, then
-- pull + restart the mini (`com.mlr.media-server`) for the push-sender change.

-- New members get the two cabin kinds on by default (extends the 0029 default).
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,cabin_request,cabin_decision}';

-- Existing members: add the two cabin kinds (ON), idempotent (skip rows that
-- already have both).
update public.profiles
  set notif_types = array(
    select distinct e from unnest(notif_types || '{cabin_request,cabin_decision}'::text[]) e
  )
  where not (notif_types @> '{cabin_request,cabin_decision}'::text[]);

-- New cabin request → notify every app admin (≠ the requester). _notify() skips
-- anyone whose notif_types lacks 'cabin_request', and skips the actor.
create or replace function public.notif_on_cabin_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabin text;
  v_name  text;
begin
  select name into v_cabin from public.cabins where id = NEW.cabin_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;
  perform public._notify(
    p.id, 'cabin_request', NEW.user_id,
    v_name || ' requested a cabin stay',
    coalesce(v_cabin, 'A cabin') || ' · ' || to_char(NEW.check_in, 'Mon FMDD') || '–' || to_char(NEW.check_out, 'Mon FMDD'),
    '/profile', 'cabin_booking', NEW.id, null)
  from public.profiles p
  where p.is_admin;
  return NEW;
end;
$$;
drop trigger if exists trg_notif_cabin_request on public.cabin_bookings;
create trigger trg_notif_cabin_request after insert on public.cabin_bookings
  for each row execute function public.notif_on_cabin_request();

-- Approve/deny (pending → decision) → notify the requester.
create or replace function public.notif_on_cabin_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabin text;
begin
  if OLD.status = 'pending' and NEW.status in ('approved', 'denied') then
    select name into v_cabin from public.cabins where id = NEW.cabin_id;
    perform public._notify(
      NEW.user_id, 'cabin_decision', NEW.reviewed_by,
      case when NEW.status = 'approved'
        then 'Your cabin stay was approved ✓'
        else 'Your cabin stay request wasn''t approved' end,
      coalesce(v_cabin, 'Cabin') || ' · ' || to_char(NEW.check_in, 'Mon FMDD') || '–' || to_char(NEW.check_out, 'Mon FMDD'),
      '/request-stay', 'cabin_booking', NEW.id, null);
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_notif_cabin_decision on public.cabin_bookings;
create trigger trg_notif_cabin_decision after update on public.cabin_bookings
  for each row execute function public.notif_on_cabin_decision();
