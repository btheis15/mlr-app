-- 0206_house_order_reminders.sql
--
-- "PEOPLE ARE HEADING UP TO THE HOUSE — AND NOBODY HAS ORDERED THIS YET."
--
-- The gap: a purchase request gets approved and then just sits, because ordering
-- it has no deadline attached. But there IS a natural one — the next time anyone
-- is actually AT the house to take delivery. Pairing the two turns "somebody
-- should buy this eventually" into "order it this week and have it waiting at the
-- door when everyone arrives."
--
-- Once a day, for each house that has approved purchase requests nobody has
-- marked ordered, if somebody will be at that house within
-- `_house_order_reminder_days()` (7), every House Admin of that house gets one
-- `house_request_reminder` notification (in-app + phone push via the mini's
-- existing relay).
--
-- ⚠️ WHO COUNTS AS "AT THE HOUSE" — two sources, and the second is the important
-- one. A `house_stays` row is somebody explicitly saying "I'm going up." But most
-- people never add one for an event they've already RSVP'd to, so this ALSO
-- counts **a member of that house who is `going` to a resort event**: if you're
-- in the house and you're going to something at the resort, you'll be at the
-- house — whether you end up tenting, in a cabin, or in a bed. (One-directional:
-- a stay implies nothing about any event.) The web client derives the same union
-- in lib/housePresence.ts; keep the two rules in step.
--
-- ⚠️ RUNS IN POSTGRES ON pg_cron, NOT on the mac mini — same as
-- `run_scheduled_broadcasts` (0097) and `run_signup_reminders` (0140). The mini
-- is frequently asleep or mid-restart, and a reminder that only fires when a
-- laptop happens to be awake is not a reminder. The mini's only involvement is
-- relaying the resulting row to a phone push, which it already does for every
-- notification type.
--
-- ⚠️ KNOWN LIMIT: Family Fest is SYNTHESIZED in client code (lib/data.ts), not an
-- `events` row, so SQL cannot see it and it won't trigger a reminder. Every
-- admin-created event — work weekends, holidays, the ones this is actually for —
-- is a real row and works. Documented rather than worked around: mirroring the
-- fest dates into SQL would give them two sources of truth.
--
-- Depends on: 0071 (house_stays), 0034/0035 (events + attendance), 0194
-- (profiles.house_admin), 0195 (house_requests, _notify, _house_request_url).
-- Apply after 0205.

-- ── 1. Tunables ──────────────────────────────────────────────────────────────
-- A function rather than a literal sprinkled through the query, so the horizon
-- can be changed in one place without recreating the whole job.
create or replace function public._house_order_reminder_days()
returns int
language sql
immutable
set search_path = ''
as $$ select 7 $$;

-- ── 2. The dedup ledger ──────────────────────────────────────────────────────
-- ⚠️ Without this the job re-sends every single day for a week, which is how a
-- useful nudge becomes something people mute. One reminder per (house,
-- occasion) — `occasion_start` is the first day of the stretch people are there,
-- so a NEW trip later gets its own reminder while the current one stays quiet.
create table if not exists public.house_order_reminders_sent (
  house_id       uuid not null references public.houses (id) on delete cascade,
  occasion_start date not null,
  sent_at        timestamptz not null default now(),
  primary key (house_id, occasion_start)
);
alter table public.house_order_reminders_sent enable row level security;
-- Deny-all by design: this is bookkeeping for a cron job, nothing renders it.
-- (Every write below is SECURITY DEFINER, which bypasses RLS.)

-- ── 3. When is somebody next at this house? ──────────────────────────────────
-- Returns the soonest day, within the horizon, that either a stay or a
-- house-member's event RSVP puts somebody at the house — plus what event it was,
-- for the wording. Null when nobody is coming.
create or replace function public._house_next_presence(p_house uuid, p_within_days int)
returns table (occasion_start date, occasion_end date, event_title text)
language sql
stable
security definer
set search_path = ''
as $$
  with horizon as (
    select current_date as today, current_date + p_within_days as limit_day
  ),
  -- (a) Somebody typed a stay.
  from_stays as (
    select greatest(s.start_date, h.today) as starts,
           s.end_date                      as ends,
           null::text                      as title
      from public.house_stays s
      cross join horizon h
     where s.house_id = p_house
       and s.end_date >= h.today          -- includes one already underway
       and s.start_date <= h.limit_day
  ),
  -- (b) A MEMBER OF THIS HOUSE is going to a resort event. `event_attendance.status`
  --     is always the rolled-up value (the client keeps it in sync even for
  --     day-RSVP events — see 0096), so a plain 'going' test is correct here.
  from_events as (
    select greatest(e.start_date, h.today)        as starts,
           coalesce(e.end_date, e.start_date)     as ends,
           e.title                                as title
      from public.event_attendance a
      join public.profiles p on p.id = a.user_id
      join public.events   e on e.id::text = a.event_id
      cross join horizon h
     where p.house_id = p_house
       and a.status = 'going'
       and coalesce(e.end_date, e.start_date) >= h.today
       and e.start_date <= h.limit_day
  )
  -- ⚠️ Not aliased `both` — that's a reserved word (TRIM(BOTH …)) and errors.
  select starts, ends, title
    from (select * from from_stays union all select * from from_events) all_presence
   order by starts, (title is null)   -- prefer a named event for the wording
   limit 1;
$$;
revoke all on function public._house_next_presence(uuid, int) from public, anon;

-- ── 4. The daily tick ────────────────────────────────────────────────────────
create or replace function public.run_house_order_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house record;
  v_when  record;
  v_admin uuid;
  v_count int;
  v_total numeric;
  v_sent  int := 0;
  v_req   uuid;
  v_days  int := public._house_order_reminder_days();
begin
  -- Only houses that actually have something approved-but-unordered. ⚠️ PURCHASES
  -- only: an approved reimbursement needs PAYING (no delivery to time), and an
  -- approved idea has nothing to buy at all.
  for v_house in
    select r.house_id,
           count(*)                                             as n,
           coalesce(sum(coalesce(r.actual_cost, r.est_cost)), 0) as total,
           -- The oldest one — the notification deep-links somewhere real, and the
           -- longest-waiting request is the most deserving landing spot.
           (array_agg(r.id order by r.created_at))[1]           as any_request
      from public.house_requests r
     where r.house_id is not null
       and r.kind = 'purchase'
       and r.status = 'approved'
       and not r.test_only
     group by r.house_id
  loop
    select * into v_when from public._house_next_presence(v_house.house_id, v_days);
    -- FOUND is the reliable test here: `v_when IS NULL` on a record is
    -- all-fields-null semantics, which is easy to get subtly wrong.
    if not found or v_when.occasion_start is null then
      continue;
    end if;

    -- Already told them about this trip.
    if exists (
      select 1 from public.house_order_reminders_sent s
       where s.house_id = v_house.house_id and s.occasion_start = v_when.occasion_start
    ) then
      continue;
    end if;
    insert into public.house_order_reminders_sent (house_id, occasion_start)
    values (v_house.house_id, v_when.occasion_start)
    on conflict do nothing;

    v_count := v_house.n;
    v_total := v_house.total;
    v_req   := v_house.any_request;

    -- Every House Admin of THAT house, and nobody else — the 0199/0202 rule. An
    -- app admin who isn't a House Admin here has no authority to order anything
    -- and must not be paged about it.
    for v_admin in
      select p.id from public.profiles p
       where p.house_id = v_house.house_id and p.house_admin
    loop
      perform public._notify(
        v_admin,
        'house_request_reminder',
        null,  -- ⚠️ no actor: _notify returns early when recipient = actor, and
               -- nobody "did" this — the calendar did.
        case
          when v_when.event_title is not null
            then 'Order in time for ' || v_when.event_title
          else 'Somebody''s at the house ' || to_char(v_when.occasion_start, 'Mon DD')
        end,
        v_count::text || ' approved ' || case when v_count = 1 then 'purchase hasn''t' else 'purchases haven''t' end
          || ' been ordered'
          || case when v_total > 0 then ' ($' || trim(to_char(v_total, 'FM999999990.00')) || ')' else '' end
          || '. Order '
          || case when v_count = 1 then 'it' else 'them' end
          || ' now for delivery while people are up there — or mark '
          || case when v_count = 1 then 'it' else 'them' end
          || ' ordered if you already did.',
        public._house_request_url(v_req),
        'house_request',
        v_req
      );
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end;
$$;
revoke all on function public.run_house_order_reminders() from public, anon;

-- ── 5. Schedule it — once a day at 15:00 UTC (~9-10am Central) ───────────────
-- Daily, not per-minute: the input only changes when somebody approves a request
-- or RSVPs, and a morning nudge is when an errand like this actually gets done.
-- cron.schedule upserts by job name, so re-running this file is safe.
select cron.schedule('run-house-order-reminders', '0 15 * * *', $$select public.run_house_order_reminders();$$);

-- ── 6. Preference plumbing ───────────────────────────────────────────────────
-- On by default for everyone, and backfilled for members who already have push
-- switched on — the 0159/0161/0163 pattern, copied verbatim from 0198 §8 (which
-- is the current production shape of this column's default; ⚠️ extend that list,
-- never hand-write a fresh one, or a kind silently disappears for new signups).
alter table public.profiles
  alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder,tournament_published,tournament_match_ready,tournament_champion,chat_poll_created,private_activity_invite,house_request_submitted,house_request_decision,house_request_handled,house_request_reminder}';

update public.profiles
  set notif_types = array(select distinct e from unnest(notif_types || '{house_request_reminder}'::text[]) e)
  where not (notif_types @> '{house_request_reminder}'::text[]);

-- ⚠️ `push_types <> '{}'` is load-bearing: a member who has push fully OFF must
-- stay off. This only adds a category to people who already accepted push.
update public.profiles
  set push_types = array(select distinct e from unnest(push_types || '{house_request_reminder}'::text[]) e)
  where push_types <> '{}'
    and not (push_types @> '{house_request_reminder}'::text[]);

-- ── What would go out right now ──────────────────────────────────────────────
-- Run this BEFORE the cron fires to see it without sending anything.
select h.name                as house,
       n.occasion_start,
       n.occasion_end,
       n.event_title,
       (select count(*) from public.house_requests r
         where r.house_id = h.id and r.kind = 'purchase' and r.status = 'approved' and not r.test_only) as unordered
  from public.houses h
  left join lateral public._house_next_presence(h.id, public._house_order_reminder_days()) n on true
 order by h.name;
