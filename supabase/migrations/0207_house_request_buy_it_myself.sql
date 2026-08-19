-- 0207_house_request_buy_it_myself.sql
--
-- "JUST GRAB IT AND WE'LL PAY YOU BACK" — turn a purchase request into a
-- reimbursement without starting over.
--
-- The real-world flow this exists for: you file a purchase request, and then a
-- House Admin catches you in person (or texts) and says *"easier if you just
-- order it, we'll pay you back."* Until now that meant abandoning or withdrawing
-- the original request and re-typing the whole thing — title, reason, link,
-- amount — as a brand-new reimbursement. So people didn't; they just bought it
-- and the board quietly went stale.
--
-- Now it's one action on the request you already have: **you keep the title, the
-- reason, the links, the photos, the whole discussion and the approval that's
-- already on it**, and all you add is what it actually cost and the receipt.
--
-- ⚠️⚠️ ONLY THE REQUESTER CAN DO THIS, and that is a correctness rule, not a
-- permissions preference. A reimbursement pays `created_by` — the pay-methods
-- panel resolves THAT person's Venmo/Zelle. If a House Admin could convert
-- somebody else's request, the money would be routed to the person who ASKED for
-- the item rather than the person who actually paid for it. Whoever spent the
-- money has to be the one to say so.
--
-- ⚠️ THE APPROVAL SURVIVES, and re-approval is only demanded when the number
-- moved materially. The house already said yes to spending roughly this much;
-- making somebody re-approve a $7 item because the receipt came to $9.12 is the
-- kind of friction that stops people using the board at all. But an approved
-- estimate is not a blank cheque either, so anything more than
-- `_house_request_overspend_grace()` ($25) over what was approved drops back to
-- `pending` for a quick second look. The requester is told which will happen
-- BEFORE they submit (the client mirrors this rule).
--
-- Also here: a small widening of `update_house_request` so the requester can fix
-- their OWN request (swap the link when they bought a different product, correct
-- the title) right up until the money actually moves — not just while pending.
--
-- Apply after 0206.

-- ── 1. Provenance ────────────────────────────────────────────────────────────
-- Keep the fact that this started life as a purchase request. Without it the
-- board silently rewrites history: a row that the house approved as "please buy
-- this" would read as though it had always been a receipt, and the approval on it
-- would look like it was granted for a spend that had already happened.
alter table public.house_requests
  add column if not exists converted_from_kind text,
  add column if not exists converted_at        timestamptz;

comment on column public.house_requests.converted_from_kind is
  'Set when a request changed kind in place (today: purchase -> reimbursement, when the requester bought it themselves). Null for anything created as-is.';

-- ── 2. How much overspend is fine without re-asking ──────────────────────────
create or replace function public._house_request_overspend_grace()
returns numeric
language sql
immutable
set search_path = ''
as $$ select 25::numeric $$;

-- ── 3. The conversion ────────────────────────────────────────────────────────
create or replace function public.convert_request_to_reimbursement(
  p_id          uuid,
  p_actual_cost numeric,
  p_note        text  default null,
  -- Optional: they bought a DIFFERENT product than the one linked (a better
  -- price, the original was out of stock). Passing these keeps the row honest
  -- about what was actually bought instead of pointing at something else.
  p_title       text  default null,
  p_links       jsonb default null
)
returns text          -- the resulting status, so the client can say what happened
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid    uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
  v_who    text;
  v_house  text;
  v_admin  uuid;
  v_grace  numeric := public._house_request_overspend_grace();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;

  -- See the header: the payout follows created_by, so only they may convert.
  if r.created_by <> v_uid then
    raise exception 'Only the person who paid for it can turn this into a reimbursement';
  end if;
  if r.kind <> 'purchase' then
    raise exception 'Only a purchase request can become a reimbursement';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'This request is already finished — send a new reimbursement instead';
  end if;
  if coalesce(p_actual_cost, 0) <= 0 then
    raise exception 'How much did it come to? A reimbursement needs an amount';
  end if;

  -- Approved stays approved unless the receipt is materially over the estimate.
  -- A request that was still pending stays pending — nobody has agreed to
  -- anything yet, and buying it early doesn't change that.
  if r.status = 'approved'
     and (r.est_cost is null or p_actual_cost <= r.est_cost + v_grace)
  then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  update public.house_requests
     set kind                = 'reimbursement',
         converted_from_kind = coalesce(converted_from_kind, 'purchase'),
         converted_at        = now(),
         title               = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         links               = coalesce(p_links, links),
         -- For a reimbursement `est_cost` IS the real total (0195's convention).
         est_cost            = p_actual_cost,
         actual_cost         = p_actual_cost,
         -- ⚠️ Quantity is a purchase-request idea ("get me 2 of these"). On a
         -- receipt the total already covers however many were bought, so leaving
         -- it set would make the sheet read "$42 · ×2" and imply $84 was owed.
         quantity            = null,
         status              = v_status,
         -- ⚠️ Re-open the email claim so the requester's own decision email can
         -- fire again for the new state (the 0195 §7 rule).
         decision_email_sent_at = null,
         -- Anything that needs a fresh decision must not keep the old one's
         -- reviewer stamp, or the board would show it as decided by someone who
         -- never saw this version.
         reviewed_by  = case when v_status = 'pending' then null else reviewed_by end,
         reviewed_at  = case when v_status = 'pending' then null else reviewed_at end,
         review_note  = case when v_status = 'pending' then null else review_note end,
         order_note   = coalesce(v_note, order_note),
         last_action  = 'converted',
         last_action_by = v_uid,
         handled_notify_requested_at = now()
   where id = p_id;

  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_who
    from public.profiles p where p.id = v_uid;
  select coalesce(h.name, 'the resort') into v_house
    from public.houses h where h.id = r.house_id;
  v_house := coalesce(v_house, 'the resort');

  -- Tell the House Admins: the thing they were going to order is bought, and
  -- somebody is now out of pocket for it.
  for v_admin in select * from public._house_request_approvers(p_id) loop
    perform public._notify(
      v_admin,
      'house_request_submitted',
      v_uid,
      'Bought it themselves — pay back for ' || v_house,
      v_who || ' bought ' || r.title || ' with their own money — $'
        || trim(to_char(p_actual_cost, 'FM999999990.00')) || ' to pay back.'
        || case
             when v_status = 'pending' and r.status = 'approved'
               then ' That''s more than was approved, so it needs another OK.'
             when v_status = 'approved'
               then ' Already approved — it just needs paying.'
             else ''
           end
        || coalesce(' “' || v_note || '”', ''),
      public._house_request_url(p_id),
      'house_request',
      p_id
    );
  end loop;

  return v_status;
end;
$$;
revoke all on function public.convert_request_to_reimbursement(uuid, numeric, text, text, jsonb) from public, anon;
grant execute on function public.convert_request_to_reimbursement(uuid, numeric, text, text, jsonb) to authenticated;

-- ── 4. Let the requester fix their own request until the money moves ─────────
-- Recreated from 0198 §5's body (its current production form — the 0160 rule).
-- ⚠️ The ONLY change is the creator's status gate: `pending` → `pending` or
-- `approved`. Swapping the link because you bought a different product is the
-- motivating case, and it's a normal thing to need AFTER approval. Once a
-- request is ordered/paid/denied/withdrawn it's history and stays put.
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
    if r.status not in ('pending', 'approved') then
      raise exception 'This is already finished — ask a House Admin to change it';
    end if;
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

-- ── Anything already converted ───────────────────────────────────────────────
select r.title, r.kind, r.converted_from_kind, r.status, r.est_cost, r.converted_at
  from public.house_requests r
 where r.converted_from_kind is not null
 order by r.converted_at desc;
