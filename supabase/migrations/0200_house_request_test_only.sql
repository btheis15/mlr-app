-- 0200_house_request_test_only.sql
--
-- "Just test it — only notify me": submit a REAL house request end-to-end without
-- paging anyone else.
--
-- Why this exists: testing the feature against the live family is how 6 app admins
-- got an email and a push about a vacuum (see 0199). Once a house has two or three
-- House Admins, checking that the fan-out, the push and the email all still work
-- shouldn't cost everyone else a notification.
--
-- A test request is a real row that goes through every code path — RPCs, triggers,
-- realtime, the mini's mailer, the push senders — with exactly two differences:
--   • the ONLY person notified (in-app, push, email) is the person who made it;
--   • it's hidden from the rest of the house, so the shared board stays clean.
--
-- Everything else is genuine, which is the point: a "test" that skipped the real
-- machinery would prove nothing.
--
-- Apply after 0199.

-- ── 1. The flag ──────────────────────────────────────────────────────────────
alter table public.house_requests
  add column if not exists test_only boolean not null default false;

comment on column public.house_requests.test_only is
  'A test submission: only the creator is notified (in-app/push/email), and it is hidden from the rest of the house. Set at creation via create_house_request(p_test_only).';

-- ── 2. Keep test rows off everyone else's board ──────────────────────────────
-- Recreated from 0195's policy with one added clause. A test row is visible to
-- its creator and to app admins (who can see everything anyway) — nobody else,
-- so nobody has to wonder whether "TEST vacuum" is a real ask.
drop policy if exists "house_requests: house or admin read" on public.house_requests;
create policy "house_requests: house or admin read" on public.house_requests for select
  using (
    public.is_approved_member()
    and (
      created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
      or (
        not test_only
        and (house_id is null or public.is_house_member(house_id))
      )
    )
  );

-- ── 3. Create, with the test switch ──────────────────────────────────────────
-- ⚠️ DROP the old 7-arg signature first. Adding a defaulted parameter creates a
-- SECOND overload rather than replacing the function, and two overloads that
-- differ only by a trailing default is exactly the 0115 cabin bug (every call
-- silently resolved to the older one, so the flag never took effect).
drop function if exists public.create_house_request(uuid, text, text, text, jsonb, numeric, int);

-- Recreated from 0195 §4's body (its current production form — 0198/0199 didn't
-- touch it) plus the p_test_only branch.
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
      '[Test] New ' || public._house_request_kind_label(p_kind) || ' for ' || v_house,
      'Only you were notified. ' || btrim(p_title)
        || case when p_est_cost is not null then ' — $' || trim(to_char(p_est_cost, 'FM999999990.00')) else '' end,
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
        'New ' || public._house_request_kind_label(p_kind) || ' for ' || v_house,
        v_who || ': ' || btrim(p_title)
          || case when p_est_cost is not null then ' — $' || trim(to_char(p_est_cost, 'FM999999990.00')) else '' end,
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

-- ── 4. The submission email goes to the tester, not the admins ───────────────
-- Recreated from 0195 §10's body. On a test row the whole point is inverted: the
-- creator is the ONLY recipient, where normally they're the one excluded.
create or replace function public.house_request_approver_emails(p_request uuid)
returns table (recipient_id uuid, recipient_name text, recipient_email text)
language sql
security definer
set search_path = ''
as $$
  select p.id,
         coalesce(nullif(btrim(p.display_name), ''), split_part(u.email::text, '@', 1), 'Member'),
         u.email::text
    from public.house_requests r
    join public.profiles p
      on p.id = case when r.test_only then r.created_by else null end
    join auth.users u on u.id = p.id
   where r.id = p_request and r.test_only and u.email is not null
  union all
  select p.id,
         coalesce(nullif(btrim(p.display_name), ''), split_part(u.email::text, '@', 1), 'Member'),
         u.email::text
    from public._house_request_approvers(p_request) a(id)
    join public.profiles p on p.id = a.id
    join auth.users u on u.id = a.id
    join public.house_requests r on r.id = p_request
   where u.email is not null
     and not r.test_only
     -- Never email the person who just submitted it.
     and p.id <> r.created_by;
$$;
revoke all on function public.house_request_approver_emails(uuid) from public, anon, authenticated;
grant execute on function public.house_request_approver_emails(uuid) to service_role;

-- ── 5. No co-admin chatter about a test ──────────────────────────────────────
-- Recreated from 0198 §2 with a single early return. Without this, approving your
-- own test request would tell every other House Admin about it — defeating the
-- entire purpose.
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
  if r.test_only then return; end if;  -- a test tells nobody but its author

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

-- ── 6. …and no co-admin EMAIL about a test either ────────────────────────────
-- Recreated from 0198 §7 with the test_only exclusion.
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
     and not r.test_only
     and p.id is distinct from r.last_action_by
     and p.id is distinct from r.created_by;
$$;
revoke all on function public.house_request_coadmin_emails(uuid) from public, anon, authenticated;
grant execute on function public.house_request_coadmin_emails(uuid) to service_role;

-- ── 7. Sanity check ──────────────────────────────────────────────────────────
-- Expect exactly one create_house_request (8 args) — two rows here would be the
-- 0115 overload bug reappearing.
select p.oid::regprocedure as signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'create_house_request';
