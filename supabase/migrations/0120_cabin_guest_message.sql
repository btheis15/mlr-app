-- 0120_cabin_guest_message.sql
-- Let whoever runs a bookable place (its designated approver, or an app admin)
-- send a note to everyone currently/soon staying there — "water's off this
-- weekend", "gate code changed", etc. Recipients = the distinct members with an
-- APPROVED booking for that cabin whose stay hasn't ended yet (check_out >=
-- today). Delivered as an in-app Activity notification (+ phone push, opt-in),
-- and optionally as an email (mac-mini alert-mailer), gated by the sender's
-- is_cabin_approver(cabin) — the same per-place gate from 0114.
--
-- Mirrors the announcements email pattern: one message row with a notify_email
-- flag + a claimed email_sent_at; the in-app fan-out happens synchronously in
-- the RPC via _notify (so it respects each member's cabin_message pref).
--
-- Apply in the Supabase SQL editor after 0119.

-- ── 1. Message log ────────────────────────────────────────────────────────────
create table if not exists public.cabin_messages (
  id            uuid primary key default gen_random_uuid(),
  cabin_id      uuid not null references public.cabins (id) on delete cascade,
  sender_id     uuid references public.profiles (id) on delete set null,
  subject       text,
  body          text not null,
  notify_email  boolean not null default false,
  email_sent_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists cabin_messages_cabin_idx on public.cabin_messages (cabin_id, created_at desc);

alter table public.cabin_messages enable row level security;

-- The place's approver (or an admin) can see the history; no client writes (RPC only).
drop policy if exists "cabin_messages: approver read" on public.cabin_messages;
create policy "cabin_messages: approver read" on public.cabin_messages for select
  using (public.is_cabin_approver(cabin_id));

-- ── 2. Notification kind (default ON — guests want to hear about their stay) ──
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled}';

update public.profiles set notif_types = array_append(notif_types, 'cabin_message')
  where not ('cabin_message' = any(notif_types));

-- ── 3. Send RPC — approver/admin only; fans out to current+upcoming guests ────
create or replace function public.send_cabin_message(
  p_cabin   uuid,
  p_subject text,
  p_body    text,
  p_email   boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_body    text;
  v_subject text;
  v_cabin   text;
  v_title   text;
  v_count   int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_cabin_approver(p_cabin) then raise exception 'Not authorized'; end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'A message is required'; end if;
  if length(v_body) > 2000 then raise exception 'Keep the message under 2000 characters'; end if;
  v_subject := nullif(btrim(coalesce(p_subject, '')), '');

  select name into v_cabin from public.cabins where id = p_cabin;
  if v_cabin is null then raise exception 'Place not found'; end if;

  insert into public.cabin_messages (cabin_id, sender_id, subject, body, notify_email)
  values (p_cabin, auth.uid(), v_subject, v_body, coalesce(p_email, false))
  returning id into v_id;

  v_title := v_cabin || ' — ' || coalesce(v_subject, 'A note about your stay');

  -- Fan out to distinct current/upcoming approved guests (excluding the sender,
  -- handled by _notify). _notify also honors each member's cabin_message pref.
  with recips as (
    select distinct b.user_id
    from public.cabin_bookings b
    where b.cabin_id = p_cabin
      and b.status = 'approved'
      and b.check_out >= current_date
      and b.user_id is not null
  )
  select count(*) into v_count
  from recips r
  where r.user_id <> auth.uid();

  perform public._notify(r.user_id, 'cabin_message', auth.uid(), v_title, v_body, '/request-stay', 'cabin', p_cabin, null)
  from (
    select distinct b.user_id
    from public.cabin_bookings b
    where b.cabin_id = p_cabin
      and b.status = 'approved'
      and b.check_out >= current_date
      and b.user_id is not null
  ) r;

  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.send_cabin_message(uuid, text, text, boolean) from public, anon;
grant execute on function public.send_cabin_message(uuid, text, text, boolean) to authenticated;

-- ── 4. Service-role recipient list for the mailer ─────────────────────────────
create or replace function public.cabin_message_recipients(p_message uuid)
returns table(subject text, body text, cabin_name text, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.cabin_messages%rowtype;
begin
  select * into m from public.cabin_messages where id = p_message;
  if not found then return; end if;

  return query
  select
    m.subject,
    m.body,
    (select name from public.cabins where id = m.cabin_id),
    array(
      select distinct u.email::text
      from public.cabin_bookings b
      join public.profiles p on p.id = b.user_id
      join auth.users u on u.id = p.id
      where b.cabin_id = m.cabin_id
        and b.status = 'approved'
        and b.check_out >= current_date
        and p.email_alerts = true
        and u.email is not null
        and p.id <> coalesce(m.sender_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );
end;
$$;
revoke all on function public.cabin_message_recipients(uuid) from public, anon, authenticated;
grant execute on function public.cabin_message_recipients(uuid) to service_role;

-- ── 5. Realtime (mailer watches INSERTs; sweep is the safety net) ─────────────
alter table public.cabin_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.cabin_messages; exception when duplicate_object then null; end $$;
