-- 0195_house_requests.sql
--
-- HOUSE REQUESTS — the path from "somebody noticed" to "somebody bought it."
--
-- Ideas for the house die in conversation. This is the board that catches them:
-- any member of a house submits one of three things, and a House Admin (0194)
-- decides, then records what actually happened.
--
--   • idea          — "we should have European-style dressers someday." No link
--                     or cost required; the lowest-friction kind on purpose,
--                     because the whole problem is that ideas never get written
--                     down anywhere a decision-maker will see them.
--   • purchase      — "here's the Amazon/Home Depot link, here's roughly what it
--                     costs, here's why we need it" (the cabinet-door bumpers).
--   • reimbursement — "I already bought it, pay me back."
--
-- THE POINT OF THE STATUS LADDER: pending → approved → ordered → received. An
-- approve-and-forget is the actual failure mode being fixed ("we only ever come
-- up with ideas"), so "approved but nobody ordered it" is a FIRST-CLASS, visible
-- state rather than something indistinguishable from done.
--
-- SCOPE: house_id is nullable and null means RESORT-WIDE MLR — the work_items
-- convention (0066). Nothing in the v1 UI creates a null-scope row (the composer
-- has no scope picker); the column and can_review_house_request()'s null branch
-- (0194) exist so "Resort Admins" — the LEDO Trust — drop in later without a
-- schema change.
--
-- NOT WORK ITEMS. work_items (0048/0066/0069) is the list of things that NEED
-- doing, with urgency tiers and recurrence, and it keeps that job and its
-- prominence. This is the separate "should we?" board. Neither creates the other
-- and there is deliberately no repair/fix kind here.
--
-- Shape follows cabin_bookings (0032) throughout: members-read, ZERO write
-- policies, every write through a SECURITY DEFINER RPC, realtime + replica
-- identity full so the mini's senders and every open client wake on a change.
--
-- Apply in the Supabase SQL editor after 0194.

-- ── 1. Requests ──────────────────────────────────────────────────────────────
create table if not exists public.house_requests (
  id           uuid primary key default gen_random_uuid(),
  -- null = resort-wide MLR (see header). cascade: deleting a house takes its
  -- board with it, like house_stays/house_lists.
  house_id     uuid references public.houses (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('purchase', 'idea', 'reimbursement')),
  title        text not null,
  reason       text not null default '',
  -- [{href, label}] — the EventLink shape the shared LinksEditor already edits
  -- (0093/0142), so a request can carry the product link AND a spec sheet.
  links        jsonb not null default '[]'::jsonb,
  -- For purchase/idea this is the ESTIMATE. For a reimbursement it's the real
  -- amount already spent (which the submitter knows), and actual_cost records
  -- what was actually paid out if the two differ.
  est_cost     numeric(10, 2) check (est_cost is null or est_cost >= 0),
  quantity     int check (quantity is null or quantity > 0),
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'denied', 'ordered', 'received', 'withdrawn')),
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,
  actual_cost  numeric(10, 2) check (actual_cost is null or actual_cost >= 0),
  order_note   text,
  ordered_at   timestamptz,
  ordered_by   uuid references public.profiles (id) on delete set null,
  received_at  timestamptz,
  received_by  uuid references public.profiles (id) on delete set null,
  -- A reviewer's note when they CHANGE a request rather than decide it ("yes but
  -- two of them, and this cheaper one"). Kept separate from review_note so a
  -- later decision's note doesn't overwrite the explanation of the edit.
  change_note text,
  -- Atomic claim columns for the mini's alert-mailer (the announcements /
  -- cabin_bookings pattern): stamped when sent, and pre-stamped by the RPCs when
  -- the actor opted out of emailing, which silently skips the send.
  request_email_sent_at  timestamptz,
  decision_email_sent_at timestamptz,
  -- The change email is a REQUEST/SENT pair rather than one claim column, so
  -- each separate edit can independently trigger (or skip) its own notice — the
  -- cabin-edit idiom from migration 0104. The mailer claims by advancing
  -- change_email_sent_at to match change_notify_requested_at.
  change_notify_requested_at timestamptz,
  change_email_sent_at       timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists house_requests_house_status_idx
  on public.house_requests (house_id, status, created_at desc);
create index if not exists house_requests_creator_idx
  on public.house_requests (created_by, created_at desc);

alter table public.house_requests enable row level security;

-- The whole house sees the whole board. That's the feature, not an oversight:
-- ideas get discussed instead of duplicated, and an approved-but-never-ordered
-- item is publicly stuck rather than quietly forgotten in one person's queue.
-- ⚠️ It also means a reimbursement AMOUNT is visible to every member of that
-- house — correct for a shared house fund, but it is a deliberate choice.
-- Resort-scope (house_id null) rows are visible to every approved member.
--
-- NO insert/update/delete policies — every write goes through the RPCs below.
drop policy if exists "house_requests: house or admin read" on public.house_requests;
create policy "house_requests: house or admin read" on public.house_requests for select
  using (
    public.is_approved_member()
    and (
      created_by = auth.uid()
      or house_id is null
      or public.is_house_member(house_id)
    )
  );

drop trigger if exists house_requests_set_updated_at on public.house_requests;
create trigger house_requests_set_updated_at
  before update on public.house_requests
  for each row execute function public.set_updated_at();

-- ── 2. Attachments (a receipt, a photo of the problem) ───────────────────────
-- Direct mirror of work_item_media (0067). Uploads reuse the EXISTING
-- category:"work" path on the mini, so this needs no media-server change —
-- files land under work/<ym>/ and are moderated in the background like any
-- other upload.
create table if not exists public.house_request_media (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.house_requests (id) on delete cascade,
  storage_path text not null,                    -- full Mac-mini media URL
  thumbnail_url text,                            -- 0173's small preview
  media_type   text not null default 'image' check (media_type in ('image', 'video')),
  status       text not null default 'visible' check (status in ('visible', 'pending', 'hidden')),
  uploaded_by  uuid not null references public.profiles (id) on delete cascade,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists house_request_media_idx
  on public.house_request_media (request_id, position);

alter table public.house_request_media enable row level security;

-- Follows the parent request's visibility, and status-aware like post_media: a
-- held item is visible only to its uploader and to app admins.
drop policy if exists "house_request_media: scoped read" on public.house_request_media;
create policy "house_request_media: scoped read" on public.house_request_media for select
  using (
    exists (
      select 1 from public.house_requests r
      where r.id = request_id
        and public.is_approved_member()
        and (r.created_by = auth.uid() or r.house_id is null or public.is_house_member(r.house_id))
    )
    and (
      status = 'visible'
      or uploaded_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

-- Hold a flagged attachment at insert time, reading the verdict the mini already
-- wrote to media_moderation. Copied from hold_drop_box_media_on_flagged (0171).
-- (Follow-up, not wired: a branch in hold_content_on_media_verdict (0128 §5b) so
-- a verdict that lands AFTER the row is inserted retro-holds it too.)
create or replace function public.hold_house_request_media_on_flagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v public.media_moderation%rowtype;
begin
  select * into v from public.media_moderation where storage_path = NEW.storage_path;
  if found and v.flagged then
    NEW.status := 'pending';
    insert into public.content_moderation_events
      (entity_type, entity_id, action, reason, severity, actor_id)
      values ('house_request_media', NEW.id, 'flagged', coalesce(v.reason, 'flagged media'), 'high', null);
  end if;
  return NEW;
end;
$$;

drop trigger if exists house_request_media_hold on public.house_request_media;
create trigger house_request_media_hold
  before insert on public.house_request_media
  for each row execute function public.hold_house_request_media_on_flagged();

-- ── 3. Internal helpers ──────────────────────────────────────────────────────
-- Human wording for a kind, used in every notification body so the three kinds
-- read differently in the Activity feed.
create or replace function public._house_request_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'purchase'      then 'purchase request'
    when 'reimbursement' then 'reimbursement request'
    else 'idea'
  end;
$$;

-- Deep link that works for BOTH audiences: a house member and an app admin
-- viewing another house (useResolvedHouse lets an admin open any ?house=slug).
create or replace function public._house_request_url(p_request uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when h.slug is null then '/house/requests?request=' || r.id::text
    else '/house/requests?house=' || h.slug || '&request=' || r.id::text
  end
  from public.house_requests r
  left join public.houses h on h.id = r.house_id
  where r.id = p_request;
$$;

-- Everyone who can act on this request: the House Admins of its house, plus
-- every app admin. Used for the submitted fan-out and by the mailer's recipient
-- RPC, so the two can never disagree about who an approver is.
create or replace function public._house_request_approvers(p_request uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.house_requests r
    join public.profiles p
      on (p.house_admin and p.house_id = r.house_id and r.house_id is not null)
      or p.is_admin
   where r.id = p_request
   group by p.id;
$$;

-- ── 4. Create ────────────────────────────────────────────────────────────────
create or replace function public.create_house_request(
  p_house_id uuid,
  p_kind     text,
  p_title    text,
  p_reason   text default '',
  p_links    jsonb default '[]'::jsonb,
  p_est_cost numeric default null,
  p_quantity int default null
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
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if not public.is_approved_member() then raise exception 'Your account is still waiting to be verified'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A short title is required'; end if;
  if p_kind not in ('purchase', 'idea', 'reimbursement') then raise exception 'Unknown request type'; end if;

  -- House scope requires membership. Resort scope (null) is open to any approved
  -- member — nothing in the v1 UI submits one, but the RPC stays honest.
  if p_house_id is not null and not public.is_house_member(p_house_id) then
    raise exception 'You are not in that house';
  end if;
  -- A reimbursement without an amount can't be acted on.
  if p_kind = 'reimbursement' and coalesce(p_est_cost, 0) <= 0 then
    raise exception 'How much was it? A reimbursement needs an amount';
  end if;

  insert into public.house_requests (house_id, created_by, kind, title, reason, links, est_cost, quantity)
  values (
    p_house_id, v_uid, p_kind, btrim(p_title),
    coalesce(btrim(coalesce(p_reason, '')), ''),
    coalesce(p_links, '[]'::jsonb),
    p_est_cost,
    case when p_quantity is null or p_quantity < 1 then null else p_quantity end
  )
  returning id into v_id;

  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_who
    from public.profiles p where p.id = v_uid;
  select coalesce(h.name, 'the resort') into v_house
    from public.houses h where h.id = p_house_id;
  v_house := coalesce(v_house, 'the resort');

  -- Tell the approvers. _notify already skips the actor and honors each
  -- recipient's own notif_types.
  for v_recipient in select * from public._house_request_approvers(v_id) loop
    perform public._notify(
      v_recipient,
      'house_request_submitted',
      v_uid,
      'New ' || public._house_request_kind_label(p_kind) || ' for ' || v_house,
      v_who || ': ' || btrim(p_title)
        || case when p_est_cost is not null then ' — $' || trim(to_char(p_est_cost, 'FM999999990.00')) else '' end,
      public._house_request_url(v_id),
      'house_request',
      v_id
    );
  end loop;

  return v_id;
end;
$$;
revoke all on function public.create_house_request(uuid, text, text, text, jsonb, numeric, int) from public, anon;
grant execute on function public.create_house_request(uuid, text, text, text, jsonb, numeric, int) to authenticated;

-- ── 5. Edit / "modify the request" ───────────────────────────────────────────
-- Two callers, one function: the CREATOR fixing their own wording while it's
-- still pending, and an APPROVER correcting the ask before approving it ("yes
-- but two of them, and this cheaper one"). Null means "leave alone" for every
-- field, so a caller can send just the one thing they changed.
--
-- ⚠️ A REVIEWER'S EDIT TELLS THE REQUESTER, with an optional note — the third
-- member of approve/deny/modify. Silently rewriting someone's ask (halving the
-- quantity, swapping the product) and then approving "their" request is the one
-- move here that could feel like being overruled behind your back, so the note
-- rides the in-app row, the phone push, and its own email. The CREATOR editing
-- their own pending request notifies nobody — there's nothing to tell.
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
         end
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
  end if;
end;
$$;
revoke all on function public.update_house_request(uuid, text, text, jsonb, numeric, int, boolean, boolean, text, boolean) from public, anon;
grant execute on function public.update_house_request(uuid, text, text, jsonb, numeric, int, boolean, boolean, text, boolean) to authenticated;

-- ── 6. Approve / deny ────────────────────────────────────────────────────────
-- p_notify false pre-stamps decision_email_sent_at, which "claims" the row the
-- same way the mailer does and so silently skips the email (0104's idiom). The
-- in-app notification always fires — that's the requester's record of the call.
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
         decision_email_sent_at = case when coalesce(p_notify, true) then null else now() end
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
end;
$$;
revoke all on function public.review_house_request(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.review_house_request(uuid, boolean, text, boolean) to authenticated;

-- ── 7. Progress: ordered → received ──────────────────────────────────────────
-- The half that closes the loop. Freely movable among approved/ordered/received
-- so a mis-tap is correctable without a support request.
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
         -- ⚠️ RE-OPEN THE EMAIL CLAIM on a forward step. The approval email
         -- already stamped decision_email_sent_at, and the mailer only sends
         -- for a row where it's still null — so without this, "Ordered" and
         -- "Paid" would fire the in-app notification and push but SILENTLY
         -- never email, which is the one channel the requester might be
         -- watching. Walking a status back to 'approved' is a correction, and
         -- doesn't notify, so it leaves the claim alone.
         decision_email_sent_at = case when p_status = 'approved' then decision_email_sent_at else null end
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
      -- The order note rides the body too, so the push/in-app row carries the
      -- same "ordered from Home Depot, here Thursday" detail the email shows
      -- rather than making them open the app for it.
      case
        when p_status = 'ordered' then 'It''s on the way.'
        when r.kind = 'reimbursement' then 'Your reimbursement has been paid.'
        else 'It''s here.'
      end || coalesce(' “' || nullif(btrim(coalesce(p_order_note, '')), '') || '”', ''),
      public._house_request_url(p_id),
      'house_request',
      p_id
    );
  end if;
end;
$$;
revoke all on function public.set_house_request_progress(uuid, text, numeric, text) from public, anon;
grant execute on function public.set_house_request_progress(uuid, text, numeric, text) to authenticated;

-- ── 8. Withdraw (the creator changed their mind) ─────────────────────────────
create or replace function public.withdraw_house_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.house_requests;
begin
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if r.created_by is distinct from auth.uid()
     and not public.can_review_house_request(r.house_id) then
    raise exception 'Not authorized';
  end if;
  update public.house_requests set status = 'withdrawn' where id = p_id;
end;
$$;
revoke all on function public.withdraw_house_request(uuid) from public, anon;
grant execute on function public.withdraw_house_request(uuid) to authenticated;

-- ── 9. Attachments: add / remove ─────────────────────────────────────────────
create or replace function public.add_house_request_media(
  p_request      uuid,
  p_url          text,
  p_type         text default 'image',
  p_thumbnail_url text default null,
  p_position     int default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_url), '') = '' then raise exception 'URL is required'; end if;
  if p_type not in ('image', 'video') then raise exception 'Invalid media type'; end if;

  select * into r from public.house_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if r.created_by is distinct from v_uid and not public.can_review_house_request(r.house_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.house_request_media (request_id, storage_path, thumbnail_url, media_type, uploaded_by, position)
  values (p_request, btrim(p_url), nullif(btrim(coalesce(p_thumbnail_url, '')), ''), p_type, v_uid, coalesce(p_position, 0))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_house_request_media(uuid, text, text, text, int) from public, anon;
grant execute on function public.add_house_request_media(uuid, text, text, text, int) to authenticated;

create or replace function public.remove_house_request_media(p_media uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_uploader uuid;
  v_house uuid;
  v_creator uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select m.uploaded_by, r.house_id, r.created_by into v_uploader, v_house, v_creator
    from public.house_request_media m
    join public.house_requests r on r.id = m.request_id
   where m.id = p_media;
  if not found then raise exception 'Media not found'; end if;
  if v_uploader is distinct from v_uid
     and v_creator is distinct from v_uid
     and not public.can_review_house_request(v_house) then
    raise exception 'Not authorized';
  end if;
  delete from public.house_request_media where id = p_media;
end;
$$;
revoke all on function public.remove_house_request_media(uuid) from public, anon;
grant execute on function public.remove_house_request_media(uuid) to authenticated;

-- ── 10. Email recipients for the mini's alert-mailer ─────────────────────────
-- service_role ONLY (both read auth.users for the address) — never the client.

-- The decision email: one row, the requester + everything needed to word it.
create or replace function public.house_request_notification(p_request uuid)
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
  -- So the mailer can CC whoever actually made the decision: every app email
  -- goes out from the resort's shared mailbox, so the real sender needs their
  -- own copy of what went out in their name.
  reviewer_email text,
  url text,
  pending_count int
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
    -- How many are pending in this same scope, so the approver email can say
    -- "there are 3 others waiting" — which turns "check the app" from a vague
    -- nudge into a concrete errand. Includes this row itself.
    (select count(*)::int from public.house_requests q
      where q.status = 'pending'
        and q.house_id is not distinct from r.house_id)
  from public.house_requests r
  left join public.houses h on h.id = r.house_id
  join public.profiles p on p.id = r.created_by
  join auth.users u on u.id = r.created_by
  where r.id = p_request;
$$;
revoke all on function public.house_request_notification(uuid) from public, anon, authenticated;
grant execute on function public.house_request_notification(uuid) to service_role;

-- The new-request email: every approver with an address. Uses the same
-- _house_request_approvers helper the in-app fan-out does, so the two channels
-- can't drift on who counts as an approver.
create or replace function public.house_request_approver_emails(p_request uuid)
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
   where u.email is not null
     -- Never email the person who just submitted it.
     and p.id <> (select created_by from public.house_requests where id = p_request);
$$;
revoke all on function public.house_request_approver_emails(uuid) from public, anon, authenticated;
grant execute on function public.house_request_approver_emails(uuid) to service_role;

-- ── 11. Notification prefs ───────────────────────────────────────────────────
-- Two kinds, both ON by default (0037's idiom: set the column default, then
-- backfill existing members so nobody has to go turn them on):
--   house_request_submitted — a request needs your decision (approvers).
--   house_request_decision  — the call on YOUR request, reused for the
--                             ordered/received/paid steps so the prefs list
--                             stays short and one switch governs the whole
--                             lifecycle of your own request.
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder,tournament_published,tournament_match_ready,tournament_champion,chat_poll_created,private_activity_invite,house_request_submitted,house_request_decision}';

update public.profiles
  set notif_types = array(
    select distinct e from unnest(notif_types || '{house_request_submitted,house_request_decision}'::text[]) e
  )
  where not (notif_types @> '{house_request_submitted,house_request_decision}'::text[]);

-- Phone push: low-frequency and actionable, so backfill it ON for members who
-- already have push at all (the 0159/0161/0163 pattern — a fully-push-off
-- member stays off). No column default change; push itself stays opt-in (0034).
update public.profiles
  set push_types = array(
    select distinct e from unnest(push_types || '{house_request_submitted,house_request_decision}'::text[]) e
  )
  where push_types <> '{}'
    and not (push_types @> '{house_request_submitted,house_request_decision}'::text[]);

-- ── 12. Realtime ─────────────────────────────────────────────────────────────
-- replica identity full so an UPDATE event carries the OLD row too — the mini's
-- mailer only sends on a real pending → decided transition.
alter table public.house_requests replica identity full;
alter table public.house_request_media replica identity full;
do $$ begin alter publication supabase_realtime add table public.house_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.house_request_media; exception when duplicate_object then null; end $$;
