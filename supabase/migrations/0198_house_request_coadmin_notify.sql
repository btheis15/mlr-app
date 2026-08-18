-- 0198_house_request_coadmin_notify.sql
--
-- CO-ADMIN VISIBILITY on house requests.
--
-- A house can have several House Admins (0194), and after 0195 each of them saw
-- a request arrive but NOT what any of the others did about it. So two admins
-- could both work the same queue with no idea the other had already handled
-- something — either double-ordering an item, or each assuming the other would.
-- Brian's example: Beth should learn that Lee approved Brian's reimbursement.
--
-- This adds one notification kind, `house_request_handled`, fanned out to the
-- OTHER approvers (never the actor, never the requester — they already get
-- `house_request_decision`) whenever a reviewer approves, denies, changes,
-- orders, or receives something. It names WHO did WHAT to WHOSE request.
--
-- ⚠️ All three RPCs below are recreated from their CURRENT production bodies —
-- 0195's, applied 2026-08-18, with no later migration touching them (the
-- 0160/0187 rule). The only additions are the last_action stamps and the
-- co-admin fan-out; every existing line is unchanged.
--
-- Apply in the Supabase SQL editor after 0197.

-- ── 1. Who did what, last ────────────────────────────────────────────────────
-- Needed by the mailer: the co-admin email has to name the actor and must not
-- send to them, and `reviewed_by` alone can't say whether the action was an
-- approval, an order, or a change.
alter table public.house_requests
  add column if not exists last_action text
    check (last_action is null or last_action in ('approved','denied','ordered','received','changed')),
  add column if not exists last_action_by uuid references public.profiles (id) on delete set null,
  -- Request/sent pair like change_* (the 0104 idiom), so every separate action
  -- can trigger its own co-admin notice rather than collapsing onto one claim.
  add column if not exists handled_notify_requested_at timestamptz,
  add column if not exists handled_email_sent_at timestamptz;

-- ── 2. The fan-out helper ────────────────────────────────────────────────────
-- Tell the OTHER approvers. _notify already skips the actor itself (recipient =
-- actor ⇒ no row), so the acting admin is excluded for free; the requester is
-- excluded explicitly because they get their own house_request_decision and two
-- notifications for one event reads as a bug.
create or replace function public._notify_house_request_coadmins(
  p_request uuid,
  p_actor   uuid,
  p_action  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_actor text;
  v_who   text;
  v_recipient uuid;
  v_verb text;
begin
  select * into r from public.house_requests where id = p_request;
  if not found then return; end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'A House Admin') into v_actor
    from public.profiles p where p.id = p_actor;
  select coalesce(nullif(btrim(p.display_name), ''), 'a member') into v_who
    from public.profiles p where p.id = r.created_by;

  v_verb := case p_action
    when 'approved' then 'approved'
    when 'denied'   then 'turned down'
    when 'ordered'  then 'ordered'
    when 'received' then case when r.kind = 'reimbursement' then 'paid' else 'marked as here' end
    else 'changed'
  end;

  for v_recipient in select * from public._house_request_approvers(p_request) loop
    -- Skip the requester: they already got house_request_decision.
    if v_recipient is distinct from r.created_by then
      perform public._notify(
        v_recipient,
        'house_request_handled',
        p_actor,
        v_actor || ' ' || v_verb || ' ' || v_who || '''s ' || public._house_request_kind_label(r.kind),
        r.title
          || case when r.est_cost is not null
                  then ' — $' || trim(to_char(coalesce(r.actual_cost, r.est_cost), 'FM999999990.00'))
                  else '' end,
        public._house_request_url(p_request),
        'house_request',
        p_request
      );
    end if;
  end loop;
end;
$$;
revoke all on function public._notify_house_request_coadmins(uuid, uuid, text) from public, anon;

-- ── 3. Approve / deny (0195 §6 + the co-admin fan-out) ───────────────────────
create or replace function public.review_house_request(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null,
  p_notify  boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
  v_status text;
begin
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.can_review_house_request(r.house_id) then raise exception 'Not authorized'; end if;
  if r.status = 'withdrawn' then raise exception 'That request was withdrawn'; end if;

  v_status := case when p_approve then 'approved' else 'denied' end;

  update public.house_requests
     set status      = v_status,
         reviewed_by = v_uid,
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         -- Re-open the email claim so a re-decision can send again.
         decision_email_sent_at = case when coalesce(p_notify, true) then null else now() end,
         last_action = v_status,
         last_action_by = v_uid,
         handled_notify_requested_at = now()
   where id = p_id;

  perform public._notify(
    r.created_by,
    'house_request_decision',
    v_uid,
    case when p_approve then 'Approved: ' || r.title else 'Not approved: ' || r.title end,
    case
      when p_approve then 'Your ' || public._house_request_kind_label(r.kind) || ' was approved.'
      else 'Your ' || public._house_request_kind_label(r.kind) || ' wasn''t approved.'
    end || coalesce(' “' || nullif(btrim(coalesce(p_note, '')), '') || '”', ''),
    public._house_request_url(p_id),
    'house_request',
    p_id
  );

  perform public._notify_house_request_coadmins(p_id, v_uid, v_status);
end;
$$;
revoke all on function public.review_house_request(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.review_house_request(uuid, boolean, text, boolean) to authenticated;

-- ── 4. Progress (0195 §7 + the co-admin fan-out) ─────────────────────────────
create or replace function public.set_house_request_progress(
  p_id          uuid,
  p_status      text,
  p_actual_cost numeric default null,
  p_order_note  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
begin
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.can_review_house_request(r.house_id) then raise exception 'Not authorized'; end if;
  if p_status not in ('approved', 'ordered', 'received') then
    raise exception 'Use review_house_request to approve or deny';
  end if;
  if r.status not in ('approved', 'ordered', 'received') then
    raise exception 'Approve this first';
  end if;
  -- Nothing gets "ordered" for a reimbursement — the money just goes out.
  if p_status = 'ordered' and r.kind = 'reimbursement' then
    raise exception 'A reimbursement goes straight to paid';
  end if;

  update public.house_requests
     set status      = p_status,
         actual_cost = coalesce(p_actual_cost, actual_cost),
         order_note  = coalesce(nullif(btrim(coalesce(p_order_note, '')), ''), order_note),
         ordered_at  = case when p_status = 'ordered' and ordered_at is null then now() else ordered_at end,
         ordered_by  = case when p_status = 'ordered' and ordered_by is null then v_uid else ordered_by end,
         received_at = case when p_status = 'received' then now() else null end,
         received_by = case when p_status = 'received' then v_uid else null end,
         -- ⚠️ RE-OPEN THE EMAIL CLAIM on a forward step (see 0195 §7).
         decision_email_sent_at = case when p_status = 'approved' then decision_email_sent_at else null end,
         last_action = case when p_status = 'approved' then last_action else p_status end,
         last_action_by = case when p_status = 'approved' then last_action_by else v_uid end,
         handled_notify_requested_at = case when p_status = 'approved' then handled_notify_requested_at else now() end
   where id = p_id;

  -- Only the forward steps are worth a ping; walking a status back is a
  -- correction, and notifying on it would read as a second announcement.
  if p_status <> 'approved' then
    perform public._notify(
      r.created_by,
      'house_request_decision',
      v_uid,
      case
        when p_status = 'ordered' then 'Ordered: ' || r.title
        when r.kind = 'reimbursement' then 'Paid: ' || r.title
        else 'Got it: ' || r.title
      end,
      case
        when p_status = 'ordered' then 'It''s on the way.'
        when r.kind = 'reimbursement' then 'Your reimbursement has been paid.'
        else 'It''s here.'
      end || coalesce(' “' || nullif(btrim(coalesce(p_order_note, '')), '') || '”', ''),
      public._house_request_url(p_id),
      'house_request',
      p_id
    );
    perform public._notify_house_request_coadmins(p_id, v_uid, p_status);
  end if;
end;
$$;
revoke all on function public.set_house_request_progress(uuid, text, numeric, text) from public, anon;
grant execute on function public.set_house_request_progress(uuid, text, numeric, text) to authenticated;

-- ── 5. Edit (0195 §5 + the co-admin fan-out) ─────────────────────────────────
create or replace function public.update_house_request(
  p_id       uuid,
  p_title    text default null,
  p_reason   text default null,
  p_links    jsonb default null,
  p_est_cost numeric default null,
  p_quantity int default null,
  p_clear_cost boolean default false,
  p_clear_quantity boolean default false,
  p_note     text default null,
  p_notify   boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
  v_can_review boolean;
  v_is_creator boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;

  v_is_creator := r.created_by = v_uid;
  v_can_review := public.can_review_house_request(r.house_id);
  if not v_can_review then
    if not v_is_creator then raise exception 'Not authorized'; end if;
    if r.status <> 'pending' then raise exception 'This has already been decided — ask a House Admin to change it'; end if;
  end if;

  update public.house_requests
     set title    = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         reason   = coalesce(p_reason, reason),
         links    = coalesce(p_links, links),
         est_cost = case when p_clear_cost then null else coalesce(p_est_cost, est_cost) end,
         quantity = case when p_clear_quantity then null
                         else coalesce(case when p_quantity < 1 then null else p_quantity end, quantity) end,
         -- Only a reviewer's edit records a note / queues a notice.
         change_note = case when v_can_review and not v_is_creator then coalesce(v_note, change_note) else change_note end,
         change_notify_requested_at = case
           when v_can_review and not v_is_creator and coalesce(p_notify, true) then now()
           else change_notify_requested_at
         end,
         last_action = case when v_can_review and not v_is_creator then 'changed' else last_action end,
         last_action_by = case when v_can_review and not v_is_creator then v_uid else last_action_by end,
         handled_notify_requested_at = case
           when v_can_review and not v_is_creator then now() else handled_notify_requested_at end
   where id = p_id;

  if v_can_review and not v_is_creator then
    perform public._notify(
      r.created_by,
      'house_request_decision',
      v_uid,
      'Changed: ' || r.title,
      'A House Admin updated your ' || public._house_request_kind_label(r.kind) || '.'
        || coalesce(' “' || v_note || '”', ''),
      public._house_request_url(p_id),
      'house_request',
      p_id
    );
    perform public._notify_house_request_coadmins(p_id, v_uid, 'changed');
  end if;
end;
$$;
revoke all on function public.update_house_request(uuid, text, text, jsonb, numeric, int, boolean, boolean, text, boolean) from public, anon;
grant execute on function public.update_house_request(uuid, text, text, jsonb, numeric, int, boolean, boolean, text, boolean) to authenticated;

-- ── 6. Widen the mailer's info RPC ───────────────────────────────────────────
-- Return type changes, so DROP + CREATE (create-or-replace can't widen a TABLE
-- signature). Recreated from 0195 §10's body — its current production form —
-- plus last_action / last_action_by / the actor's name.
drop function if exists public.house_request_notification(uuid);
create function public.house_request_notification(p_request uuid)
returns table (
  request_id uuid,
  kind text,
  title text,
  reason text,
  status text,
  est_cost numeric,
  actual_cost numeric,
  quantity int,
  review_note text,
  order_note text,
  change_note text,
  links jsonb,
  house_name text,
  house_slug text,
  requester_id uuid,
  requester_name text,
  requester_email text,
  reviewer_name text,
  reviewer_email text,
  url text,
  pending_count int,
  last_action text,
  last_action_by uuid,
  last_action_by_name text
)
language sql
security definer
set search_path = ''
as $$
  select
    r.id, r.kind, r.title, r.reason, r.status, r.est_cost, r.actual_cost, r.quantity,
    r.review_note, r.order_note, r.change_note, r.links,
    coalesce(h.name, 'MLR'), h.slug,
    r.created_by,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email::text, '@', 1), 'Member'),
    u.email::text,
    (select coalesce(nullif(btrim(rp.display_name), ''), 'A House Admin')
       from public.profiles rp where rp.id = r.reviewed_by),
    (select ru.email::text from auth.users ru where ru.id = r.reviewed_by),
    public._house_request_url(r.id),
    (select count(*)::int from public.house_requests q
      where q.status = 'pending'
        and q.house_id is not distinct from r.house_id),
    r.last_action,
    r.last_action_by,
    (select coalesce(nullif(btrim(ap.display_name), ''), 'A House Admin')
       from public.profiles ap where ap.id = r.last_action_by)
  from public.house_requests r
  left join public.houses h on h.id = r.house_id
  join public.profiles p on p.id = r.created_by
  join auth.users u on u.id = r.created_by
  where r.id = p_request;
$$;
revoke all on function public.house_request_notification(uuid) from public, anon, authenticated;
grant execute on function public.house_request_notification(uuid) to service_role;

-- ── 7. Co-admin email recipients ─────────────────────────────────────────────
-- The other approvers: not the one who acted (they know), and not the requester
-- (they get the decision email). service_role only — reads auth.users.
create or replace function public.house_request_coadmin_emails(p_request uuid)
returns table (recipient_id uuid, recipient_name text, recipient_email text)
language sql
security definer
set search_path = ''
as $$
  select p.id,
         coalesce(nullif(btrim(p.display_name), ''), split_part(u.email::text, '@', 1), 'Member'),
         u.email::text
    from public._house_request_approvers(p_request) a(id)
    join public.profiles p on p.id = a.id
    join auth.users u on u.id = a.id
    join public.house_requests r on r.id = p_request
   where u.email is not null
     and p.id is distinct from r.last_action_by
     and p.id is distinct from r.created_by;
$$;
revoke all on function public.house_request_coadmin_emails(uuid) from public, anon, authenticated;
grant execute on function public.house_request_coadmin_emails(uuid) to service_role;

-- ── 8. The new notification kind ─────────────────────────────────────────────
-- ON by default, and backfilled — the whole point is that a co-admin learns
-- about it without having to go turn something on. Only ever reaches actual
-- approvers, so it can't become noise for a regular member.
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder,tournament_published,tournament_match_ready,tournament_champion,chat_poll_created,private_activity_invite,house_request_submitted,house_request_decision,house_request_handled}';

update public.profiles
  set notif_types = array(select distinct e from unnest(notif_types || '{house_request_handled}'::text[]) e)
  where not (notif_types @> '{house_request_handled}'::text[]);

update public.profiles
  set push_types = array(select distinct e from unnest(push_types || '{house_request_handled}'::text[]) e)
  where push_types <> '{}'
    and not (push_types @> '{house_request_handled}'::text[]);

-- ── 9. Sanity check ──────────────────────────────────────────────────────────
select count(*) filter (where 'house_request_handled' = any(notif_types)) as in_app_on,
       count(*) filter (where 'house_request_handled' = any(push_types))  as push_on
  from public.profiles;
