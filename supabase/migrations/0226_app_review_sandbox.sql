-- 0226_app_review_sandbox.sql
-- App Review sandbox: nothing the App Store review account does is visible to,
-- or notifies, anyone else. Reviewers (and our own simulator QA signed in as
-- that account) post, comment, RSVP, vote and message like any member; the
-- account sees its own activity so the app looks normal to it, but no other
-- member (admins included) sees those rows and nobody gets a notification or
-- an email for them.
--
-- 0158/0159 covered four tables by flipping status='hidden' and three
-- notification functions. This closes the rest in three central places rather
-- than editing every function (the 0213 "one trigger, not N edits" approach):
--   1. RESTRICTIVE select policies on every content table: a row whose actor
--      is sandboxed is readable only by that actor. Realtime honours RLS, so
--      live updates are covered too.
--   2. One BEFORE INSERT trigger on notifications drops any notification for
--      another member caused by a sandboxed account.
--   3. BEFORE INSERT triggers pre-stamp the alert-mailer claim columns so no
--      email goes out.
-- Accounts are listed in public.sandboxed_accounts (seeded with the review
-- account), so adding a second test account is one insert.
--
-- NOT covered here (needs the sender patch): phone pushes that the mini's
-- push-sender / apns-sender send straight from realtime INSERTs as service
-- role. SECURITY DEFINER read functions bypass RLS; the ones that list chat
-- content filter status='visible', which the hide triggers handle.
--
-- Idempotent.

begin;

create table if not exists public.sandboxed_accounts (
  user_id    uuid primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.sandboxed_accounts enable row level security;
-- No policies on purpose: only the definer helpers below (and service role) read it.
revoke all on public.sandboxed_accounts from anon, authenticated;

insert into public.sandboxed_accounts (user_id, note)
select p.id, 'App Store review account'
from public.profiles p
where lower(p.contact_email) = 'appreview@muskellungelakeresort.com'
on conflict (user_id) do nothing;

insert into public.sandboxed_accounts (user_id, note)
select u.id, 'App Store review account (auth user)'
from auth.users u
where lower(u.email) in ('appreview@muskellungelakeresort.com', 'appreview@muskellunglakeresort.com')
on conflict (user_id) do nothing;

create or replace function public.is_sandboxed(uid uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.sandboxed_accounts s where s.user_id = uid) $$;

-- Array form for policies: wrapped in a scalar subquery it is evaluated once
-- per statement, not once per row.
create or replace function public.sandboxed_ids()
returns uuid[]
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(array_agg(s.user_id), '{}'::uuid[]) from public.sandboxed_accounts s $$;

-- Used in policies on anon-readable tables, so anon must be able to call them
-- (the 0211 lesson: a policy function anon cannot execute breaks the read).
grant execute on function public.is_sandboxed(uuid) to anon, authenticated, service_role;
grant execute on function public.sandboxed_ids() to anon, authenticated, service_role;

-- 1a. Tables with a direct actor column.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('posts','author_id'), ('post_comments','author_id'), ('post_reactions','user_id'),
      ('comment_reactions','user_id'), ('albums','created_by'),
      ('committee_messages','author_id'), ('house_messages','author_id'),
      ('event_chat_messages','author_id'), ('committee_message_reactions','user_id'),
      ('house_message_reactions','user_id'), ('event_chat_message_reactions','user_id'),
      ('cabin_messages','sender_id'), ('event_messages','sender_id'),
      ('chat_polls','created_by'), ('chat_poll_votes','user_id'),
      ('polls','created_by'), ('poll_votes','user_id'),
      ('work_items','created_by'), ('work_item_comments','author_id'),
      ('event_work_items','added_by'), ('house_stays','created_by'),
      ('house_lists','created_by'), ('house_list_items','created_by'),
      ('house_requests','created_by'), ('house_request_media','uploaded_by'),
      ('help_requests','user_id'), ('help_responses','user_id'),
      ('cabin_bookings','user_id'), ('drop_boxes','created_by'),
      ('drop_box_media','uploaded_by'), ('tournaments','created_by'),
      ('tournament_participants','user_id'), ('private_activities','created_by'),
      ('private_activity_members','user_id'), ('meetings','created_by'),
      ('meeting_availability','user_id'), ('events','created_by'),
      ('event_attendance','user_id'), ('event_hosts','user_id'),
      ('fest_activity_signups','user_id'), ('fest_schedule_signups','user_id'),
      ('committee_join_requests','user_id'), ('announcements','author_id'),
      ('content_reports','reporter_id')
    ) as v(t, c)
  loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = r.t and column_name = r.c) then
      raise exception '0226: public.%.% does not exist', r.t, r.c;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || r.t)) then
      raise exception '0226: RLS is not enabled on public.%', r.t;
    end if;
    execute format('drop policy if exists "sandbox: hide from others" on public.%I', r.t);
    execute format(
      'create policy "sandbox: hide from others" on public.%I as restrictive for select
         using (%I is null or %I = (select auth.uid()) or %I <> all ((select public.sandboxed_ids())::uuid[]))',
      r.t, r.c, r.c, r.c);
  end loop;
end $$;

-- 1b. Child tables with no actor column: decided by the parent row. The check
-- runs in a definer function because the parent row is itself hidden by 1a
-- from the member doing the read.
do $$
declare
  r record;
  idtype text;
  fn text;
begin
  for r in
    select * from (values
      ('post_media','post_id','posts','author_id'),
      ('post_comment_media','comment_id','post_comments','author_id'),
      ('committee_message_media','message_id','committee_messages','author_id'),
      ('house_message_media','message_id','house_messages','author_id'),
      ('event_chat_message_media','message_id','event_chat_messages','author_id'),
      ('work_item_media','work_item_id','work_items','created_by'),
      ('chat_poll_options','poll_id','chat_polls','created_by'),
      ('poll_options','poll_id','polls','created_by'),
      ('tournament_entrants','tournament_id','tournaments','created_by'),
      ('tournament_matches','tournament_id','tournaments','created_by'),
      ('cabin_booking_rooms','booking_id','cabin_bookings','user_id'),
      ('meeting_slots','meeting_id','meetings','created_by'),
      ('help_request_items','request_id','help_requests','user_id')
    ) as v(t, fk, parent, pcol)
  loop
    select format_type(a.atttypid, a.atttypmod) into idtype
    from pg_attribute a
    where a.attrelid = to_regclass('public.' || r.t) and a.attname = r.fk and not a.attisdropped;
    if idtype is null then
      raise exception '0226: public.%.% does not exist', r.t, r.fk;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || r.t)) then
      raise exception '0226: RLS is not enabled on public.%', r.t;
    end if;
    fn := '_sandbox_hidden_' || r.parent;
    execute format(
      'create or replace function public.%I(p_id %s) returns boolean
         language sql stable security definer set search_path = public, pg_temp
         as $f$ select exists (select 1 from public.%I p
                               where p.id = p_id
                                 and p.%I is distinct from auth.uid()
                                 and public.is_sandboxed(p.%I)) $f$',
      fn, idtype, r.parent, r.pcol, r.pcol);
    execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role', fn, idtype);
    execute format('drop policy if exists "sandbox: hide from others" on public.%I', r.t);
    execute format(
      'create policy "sandbox: hide from others" on public.%I as restrictive for select
         using (not public.%I(%I))',
      r.t, fn, r.fk);
  end loop;
end $$;

-- 2. Notifications: nothing a sandboxed account causes reaches anyone else.
-- Checks both the row's actor and the signed-in caller, so system
-- notifications with no actor (raised inside the account's own request) are
-- caught as well.
create or replace function public._sandbox_drop_notification()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.recipient_id is distinct from coalesce(new.actor_id, auth.uid())
     and (public.is_sandboxed(new.actor_id) or public.is_sandboxed(auth.uid())) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists sandbox_drop_notification on public.notifications;
create trigger sandbox_drop_notification
  before insert on public.notifications
  for each row execute function public._sandbox_drop_notification();

-- 3. Emails: pre-stamp the alert-mailer claim column so the row is never mailed.
create or replace function public._sandbox_mute_email()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  execute format('select ($1).%I', tg_argv[0]) into actor using new;
  if public.is_sandboxed(actor) or public.is_sandboxed(auth.uid()) then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[1], now()));
  end if;
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('announcements','author_id','email_sent_at'),
      ('cabin_messages','sender_id','email_sent_at'),
      ('event_messages','sender_id','email_sent_at'),
      ('house_requests','created_by','request_email_sent_at'),
      ('meetings','created_by','proposal_email_sent_at')
    ) as v(t, actor, stamp)
  loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = r.t and column_name = r.stamp) then
      raise exception '0226: public.%.% does not exist', r.t, r.stamp;
    end if;
    execute format('drop trigger if exists sandbox_mute_email on public.%I', r.t);
    execute format(
      'create trigger sandbox_mute_email before insert on public.%I
         for each row execute function public._sandbox_mute_email(%L, %L)',
      r.t, r.actor, r.stamp);
  end loop;
end $$;

-- 4. Event chats: same status flip 0158 gave committee and house chats, so the
-- definer chat lists (which filter status = 'visible') skip these messages.
create or replace function public._sandbox_hide_event_chat_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.is_sandboxed(new.author_id) then
    new.status := 'hidden';
  end if;
  return new;
end $$;

drop trigger if exists sandbox_hide_event_chat_message on public.event_chat_messages;
create trigger sandbox_hide_event_chat_message
  before insert on public.event_chat_messages
  for each row execute function public._sandbox_hide_event_chat_message();

commit;
