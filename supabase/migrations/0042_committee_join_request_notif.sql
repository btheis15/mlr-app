-- 0042_committee_join_request_notif.sql
-- Notify when a member *requests* to join a committee. Until now the only
-- committee-join notification fired the other direction (`committee_join` → the
-- REQUESTER, when their request was approved/declined, migration 0030); nobody was
-- told a request had come IN, so requests sat silently in the approval queue.
--
-- This adds `committee_join_request` → fan out to the people who can act on it:
-- that committee's LEADS (committee_members.role = 'Lead', migration 0015) plus
-- every app ADMIN, minus the requester. It rides the in-app Notifications feed
-- (toggleable in Profile → Notifications) and — for admins who opt in — the phone
-- push (the mini's push-sender mirrors this type when push_types contains it).
--
-- request_to_join() UPSERTS (a re-ask after a rejection is an UPDATE back to
-- 'pending', not a fresh INSERT), so the trigger fires on INSERT *and* on the
-- UPDATE that flips a row back to pending. Apply after 0030/0015; then pull +
-- restart the mini (`com.mlr.media-server`) for the push-sender change.

-- New members get the new kind on by default (extends the 0037 default list —
-- keep help_request/help_response, which 0037 added after 0033).
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,help_request,help_response}';

-- Existing members: add the new kind (ON), idempotent (skip rows that have it).
update public.profiles
  set notif_types = array(
    select distinct e from unnest(notif_types || '{committee_join_request}'::text[]) e
  )
  where not (notif_types @> '{committee_join_request}'::text[]);

-- A pending join request appeared → notify the committee's leads + every app
-- admin (≠ the requester). _notify() skips anyone whose notif_types lacks
-- 'committee_join_request', and skips the actor. One row per matching profile.
create or replace function public.notif_on_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cname text;
  v_slug  text;
  v_name  text;
begin
  -- Only when a request is/just-became pending: a fresh INSERT, or a re-ask that
  -- flips a previously reviewed row back to pending (request_to_join upserts).
  if NEW.status <> 'pending' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'pending' then return NEW; end if;

  select name, slug into v_cname, v_slug from public.committees where id = NEW.committee_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;

  perform public._notify(
    p.id, 'committee_join_request', NEW.user_id,
    v_name || ' asked to join ' || coalesce(v_cname, 'a committee'),
    nullif(btrim(NEW.message), ''),
    '/committees/' || coalesce(v_slug, ''),
    'committee', NEW.committee_id, null)
  from public.profiles p
  where p.is_admin
     or exists (
       select 1 from public.committee_members m
       where m.committee_id = NEW.committee_id
         and m.user_id = p.id
         and m.role = 'Lead'
     );
  return NEW;
end;
$$;

drop trigger if exists trg_notif_join_request on public.committee_join_requests;
create trigger trg_notif_join_request after insert or update on public.committee_join_requests
  for each row execute function public.notif_on_join_request();
