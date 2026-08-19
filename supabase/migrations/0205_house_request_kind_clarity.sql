-- 0205_house_request_kind_clarity.sql
--
-- MAKE A NOTIFICATION SAY WHO IS SUPPOSED TO BUY THE THING.
--
-- ⚠️⚠️ THE INCIDENT THIS FIXES. Brian filed a **purchase request** for MJT House.
-- The House Admins received "New purchase request for MJT House — Brian: <thing>"
-- and read it as *"Brian is buying this himself"*, so nobody ordered anything.
-- Nothing in the notification, the email or the app said otherwise: every surface
-- named the PAPERWORK ("purchase request") and none of them named the DEAL ("the
-- House Trust pays, and a House Admin places the order").
--
-- The app half of the fix is `KIND_META` in lib/houseRequests.ts (every surface
-- now carries that sentence) and the email half is in
-- media-server/house-request-email-template.js. This is the third channel: the
-- in-app row and the phone push, which for an admin who hasn't opened the app is
-- the ONLY thing they see.
--
-- What changes:
--   1. `_house_request_kind_label` — clean nouns, and 'reimbursement request'
--      loses its redundant "request" (it reads in "Your <label> was approved").
--   2. `create_house_request` — the submission notice is now written PER KIND,
--      naming the recipient's actual job instead of a generic "New X for Y".
--   3. `set_house_request_progress` — refuses `ordered`/`received` for an IDEA.
--      Nothing is ever bought or paid for an idea, so agreeing to it is the end
--      of the line; the client no longer offers the step and this stops anything
--      else creating a state the UI has no meaning for.
--
-- ⚠️ NO DATA IS CHANGED OR DELETED. Existing rows keep their kind, status,
-- amounts and history exactly as they are — only the wording of FUTURE
-- notifications differs, and the client re-renders what's already there in the
-- new, clearer form.
--
-- 2 and 3 are recreated from their CURRENT PRODUCTION bodies (0200 §3 and 0198
-- §4 respectively), per the 0160 rule — never from an older migration's copy.
-- Apply after 0204.

-- ── 1. Kind labels ───────────────────────────────────────────────────────────
-- Used in "Your <label> was approved" / "A House Admin updated your <label>", so
-- it must stay a bare noun phrase that survives a possessive.
create or replace function public._house_request_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'purchase'      then 'purchase request'
    when 'reimbursement' then 'reimbursement'
    else 'idea'
  end;
$$;

-- ── 2. The submission notice, per kind ───────────────────────────────────────
-- ⚠️ Split into two helpers rather than inlined into create_house_request, so the
-- real send and the test-only send below cannot drift in wording — the test mode
-- exists precisely to check what the family will receive.
create or replace function public._house_request_notice_title(p_kind text, p_house text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    -- Leads with the ACTION the recipient owes, not the document type.
    when 'purchase'      then 'Order needed for ' || p_house
    when 'reimbursement' then 'Money owed for ' || p_house
    else 'New idea for ' || p_house
  end;
$$;

create or replace function public._house_request_notice_body(
  p_kind text,
  p_who  text,
  p_title text,
  p_cost numeric
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'purchase' then
      p_who || ' is asking the House Trust to buy: ' || p_title
        || case when p_cost is not null then ' (about $' || trim(to_char(p_cost, 'FM999999990.00')) || ')' else '' end
        || '. You place the order.'
    when 'reimbursement' then
      p_who || ' already paid for ' || p_title
        || case when p_cost is not null then ' — $' || trim(to_char(p_cost, 'FM999999990.00')) || ' to pay back' else '' end
        || '.'
    else
      p_who || ': ' || p_title || '. Just an idea — nothing to buy.'
  end;
$$;

-- Recreated from 0200 §3's body (its current production form). The ONLY changes
-- are the two _notify title/body arguments in each branch.
create or replace function public.create_house_request(
  p_house_id uuid,
  p_kind     text,
  p_title    text,
  p_reason   text default '',
  p_links    jsonb default '[]'::jsonb,
  p_est_cost numeric default null,
  p_quantity int default null,
  p_test_only boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_who text;
  v_house text;
  v_recipient uuid;
  v_test boolean := coalesce(p_test_only, false);
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if not public.is_approved_member() then raise exception 'Your account is still waiting to be verified'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A short title is required'; end if;
  if p_kind not in ('purchase', 'idea', 'reimbursement') then raise exception 'Unknown request type'; end if;

  if p_house_id is not null and not public.is_house_member(p_house_id) then
    raise exception 'You are not in that house';
  end if;
  if p_kind = 'reimbursement' and coalesce(p_est_cost, 0) <= 0 then
    raise exception 'How much was it? A reimbursement needs an amount';
  end if;

  insert into public.house_requests (house_id, created_by, kind, title, reason, links, est_cost, quantity, test_only)
  values (
    p_house_id, v_uid, p_kind, btrim(p_title),
    coalesce(btrim(coalesce(p_reason, '')), ''),
    coalesce(p_links, '[]'::jsonb),
    p_est_cost,
    case when p_quantity is null or p_quantity < 1 then null else p_quantity end,
    v_test
  )
  returning id into v_id;

  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_who
    from public.profiles p where p.id = v_uid;
  select coalesce(h.name, 'the resort') into v_house
    from public.houses h where h.id = p_house_id;
  v_house := coalesce(v_house, 'the resort');

  if v_test then
    -- ⚠️ p_actor is NULL on purpose. _notify returns early when recipient =
    -- actor, so notifying YOURSELF is impossible with the actor set — a null
    -- actor is what lets the test row reach its own author. The row then relays
    -- to a phone push like any other, which is the half worth testing.
    perform public._notify(
      v_uid,
      'house_request_submitted',
      null,
      '[Test] ' || public._house_request_notice_title(p_kind, v_house),
      'Only you were notified. '
        || public._house_request_notice_body(p_kind, v_who, btrim(p_title), p_est_cost),
      public._house_request_url(v_id),
      'house_request',
      v_id
    );
  else
    for v_recipient in select * from public._house_request_approvers(v_id) loop
      perform public._notify(
        v_recipient,
        'house_request_submitted',
        v_uid,
        public._house_request_notice_title(p_kind, v_house),
        public._house_request_notice_body(p_kind, v_who, btrim(p_title), p_est_cost),
        public._house_request_url(v_id),
        'house_request',
        v_id
      );
    end loop;
  end if;

  return v_id;
end;
$$;
revoke all on function public.create_house_request(uuid, text, text, text, jsonb, numeric, int, boolean) from public, anon;
grant execute on function public.create_house_request(uuid, text, text, text, jsonb, numeric, int, boolean) to authenticated;

-- ── 3. An idea has no "ordered" or "paid" step ───────────────────────────────
-- Recreated from 0198 §4's body (its current production form). The ONLY change
-- is the added idea guard.
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
  -- ⚠️ And nothing is ordered OR paid for an idea. Saying yes to an idea is the
  -- end of it; if it turns into something to actually buy, that's a separate
  -- purchase request (the client offers a one-tap "turn this into a purchase
  -- request" for exactly that).
  if p_status in ('ordered', 'received') and r.kind = 'idea' then
    raise exception 'An idea has nothing to order — send it on as a purchase request instead';
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
        when p_status = 'ordered' then 'A House Admin ordered it with House Trust money.'
        when r.kind = 'reimbursement' then 'Your money has been sent back to you.'
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

-- ── What a notification will read like now ───────────────────────────────────
select public._house_request_notice_title('purchase', 'MJT House')      as title,
       public._house_request_notice_body('purchase', 'Brian', 'Soft-close cabinet bumpers', 17.98) as body
union all
select public._house_request_notice_title('reimbursement', 'MJT House'),
       public._house_request_notice_body('reimbursement', 'Brian', 'deck stain', 84.50)
union all
select public._house_request_notice_title('idea', 'MJT House'),
       public._house_request_notice_body('idea', 'Brian', 'Clear the trees behind the house', null);
