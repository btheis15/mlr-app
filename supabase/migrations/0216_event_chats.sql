-- 0216_event_chats.sql
-- EVENT CHATS — a private room per event, for the people actually going.
--
-- THE PROBLEM. The Family Feed is where you post things you want EVERYONE to
-- see. But most talk about a Work Weekend or a holiday weekend only concerns
-- the dozen people who'll be there — and posting it to the feed bombards
-- everybody else's notifications with logistics they have no use for. So people
-- either spam the feed or say nothing.
--
-- THE MODEL (per Brian). Creating an event creates its chat, immediately. Its
-- members are everyone going — resolved LIVE, not snapshotted, so somebody who
-- RSVPs three weeks later just appears in it, with the FULL history readable
-- from their first visit. Seven days after the event ends the chat archives
-- itself: it drops into a collapsed "Archived chats" line at the foot of the
-- Feed and becomes read-only, so the record survives without cluttering
-- anything. The 7 days exist so last-minute details can still land after the
-- weekend is over.
--
-- ── Who is in the room ───────────────────────────────────────────────────────
-- `is_event_chat_member` (below) — an approved member who is any of:
--   1. RSVP'd **going or maybe** (per Brian: a Maybe is often the person most in
--      need of the detail that would settle it),
--   2. the event's creator,
--   3. a named host — a person host, or a committee host resolved with 0209's
--      own leads-else-members rule.
--
-- ⚠️⚠️ **THERE IS NO APP-ADMIN OVERRIDE. This is the app's first genuinely
-- admin-blind room, and that is the point** — per Brian, "you'd only ever see
-- the event if you RSVPed that you were going, even for App Admins." Note this
-- DIFFERS from every other chat: `is_committee_member` (0057) and
-- `is_house_member` (0064) both return true for any `is_admin` profile, so an
-- admin can read any committee or house room today. Do not "fix" the
-- inconsistency by adding the usual `or is_admin` — it would silently undo the
-- feature. (Moderation is handled WITHOUT such an override; see §RLS.)
--
-- ⚠️ Hosts are only ever EXPLICIT rows. `can_manage_event` (0209) has a
-- "no hosts named ⇒ any signed-in member may run it" fallback, which is
-- reasonable for editing a location and catastrophic for room access — it would
-- put the entire family in every hostless event's chat. So this function is
-- written from scratch rather than delegating to `can_manage_event`, and it
-- deliberately does NOT call `is_committee_member` either, since that carries
-- the admin bypass this whole feature exists to avoid.
--
-- ⚠️ **Family with no app account cannot be in a chat, even when marked going.**
-- A manual add (0196) can be a member (`user_id`), a rostered family member with
-- no account yet (`roster_id`), or an outside guest (`guest_name`). Only the
-- first has anything to authenticate as. The other two keep getting the event
-- EMAILS (0190/0197), which is exactly why that path exists — and a roster
-- person is picked up automatically the moment their account links, since
-- membership is resolved live off `event_attendance.user_id`. Guests are
-- excluded permanently and on purpose.
--
-- ── Archiving is DERIVED, not swept ──────────────────────────────────────────
-- No cron, no `archived_at` column to keep current: a chat is archived once its
-- event ended more than 7 days ago, computed at read time. Same "a timer just
-- auto-clears itself by going stale" reasoning as 0155's mute durations — and
-- with none of the failure mode 0215 just fixed, since there is no second column
-- that can disagree with the first. An admin can reopen a chat temporarily;
-- `event_chats.reopened_until` is that override, and it expires by going stale
-- too.
--
-- ⚠️ `events.end_date` is NULL on a single-day event, so every comparison uses
-- `coalesce(end_date, start_date)` — a bare `end_date` read treats every
-- one-day event as never-ending (the trap already documented for
-- `ResortEvent.endDate` in CLAUDE.md).
--
-- ── Only events going forward ────────────────────────────────────────────────
-- Per Brian: "just events going forward, since obviously events in the past
-- won't have chats." A chat exists only where an `event_chats` row does, created
-- by the trigger below — so history stays untouched, and the backfill at the
-- foot of this file seeds only events that haven't finished yet.
--
-- ⚠️ **The two code-seeded events get nothing, and today that needs no special
-- case**: `family-fest-2026` (ended 2026-08-01) and `up-north-4th-2026` (ended
-- 2026-07-05) are both already past. They also have no `events` row at all
-- (`lib/data.ts` `RESORT_EVENTS`, `persisted: false`), so no trigger can fire
-- for them and no SQL can read their dates. **This comes back the moment Family
-- Fest 2027's dates land in `lib/data.ts`** — a future seeded event would need
-- either a chat created on first open or a deliberate decision to leave the fest
-- to its committee rooms (it already has six). Not built now, because building
-- for it would mean inventing a lazy-create path with nothing to test against.

-- ── 1. The chat's own row: does it exist, and is it force-open? ───────────────
create table if not exists public.event_chats (
  -- TEXT with no FK, matching event_attendance (0035) and event_hosts (0209):
  -- seeded events carry string ids, and a uuid FK would make exactly the events
  -- the family cares most about the only ones that can't have a chat.
  event_id       text primary key,
  created_at     timestamptz not null default now(),
  -- Admin "unarchive for a while". Null = follow the automatic 7-day rule.
  reopened_until timestamptz,
  reopened_by    uuid references public.profiles (id) on delete set null
);

alter table public.event_chats enable row level security;
-- (Its read policy is created at the end of §2 — it names is_event_chat_member,
-- which has to exist first.)

-- ── 2. Membership ────────────────────────────────────────────────────────────
create or replace function public.is_event_chat_member(p_event_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
begin
  if v_uid is null then return false; end if;
  -- An unverified signup is not in any room (0181/0183/0213). Deliberately the
  -- ONLY profiles check here — see the no-admin-override note in the header.
  if not public.is_approved_member() then return false; end if;

  -- 1. Going or maybe, as a real account holder. A guest row has a null
  --    user_id and a roster row has no account, so both fall out for free.
  if exists (
    select 1 from public.event_attendance a
    where a.event_id = p_event_id
      and a.user_id = v_uid
      and a.status in ('going', 'maybe')
  ) then return true; end if;

  -- 2. The event's own creator, so whoever set the weekend up is never locked
  --    out of its room for not having tapped Going on their own event.
  begin
    select created_by into v_creator from public.events where id = p_event_id::uuid;
  exception when invalid_text_representation then
    v_creator := null; -- a seeded event id isn't a uuid
  end;
  if v_creator is not null and v_creator = v_uid then return true; end if;

  -- 3. A named host, personally.
  if exists (
    select 1 from public.event_hosts h
    where h.event_id = p_event_id and h.user_id = v_uid
  ) then return true; end if;

  -- 4. A committee host, using 0209's leads-else-members rule. Membership is
  --    checked against committee_roster DIRECTLY rather than via
  --    is_committee_member, which would hand every app admin a way in.
  return exists (
    select 1
    from public.event_hosts h
    where h.event_id = p_event_id
      and h.committee_id is not null
      and case
            when public.committee_has_leads(h.committee_id)
              then public.is_committee_lead(h.committee_id)
            else exists (
              select 1
              from public.committee_roster r
              join public.committees c on c.slug = r.committee_slug
              where c.id = h.committee_id and r.linked_user_id = v_uid
            )
          end
  );
end;
$$;
revoke all on function public.is_event_chat_member(text) from public, anon;
grant execute on function public.is_event_chat_member(text) to authenticated;

-- Now that the predicate exists, gate the chat rows on it. Readable by the
-- room's members only — the row's mere existence tells you an event has a chat,
-- which is only interesting if you're in it. No client writes; the trigger and
-- the admin RPC below are the only writers.
drop policy if exists "event_chats: member read" on public.event_chats;
create policy "event_chats: member read" on public.event_chats for select
  using (public.is_event_chat_member(event_id));

-- ── 3. Archived? ─────────────────────────────────────────────────────────────
-- True once the event finished more than 7 days ago, unless an admin has it
-- temporarily reopened. A chat whose `events` row is gone reads as archived
-- rather than erroring — though the delete trigger below normally removes it.
create or replace function public.is_event_chat_archived(p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce(
    (select c.reopened_until > now() from public.event_chats c where c.event_id = p_event_id),
    false
  )
  and coalesce(
    (
      select coalesce(e.end_date, e.start_date) < (current_date - interval '7 days')
      from public.events e
      where e.id::text = p_event_id
    ),
    true  -- no event row (deleted, or a seeded id): nothing to keep open for
  );
$$;
revoke all on function public.is_event_chat_archived(text) from public, anon;
grant execute on function public.is_event_chat_archived(text) to authenticated;

-- ── 4. Messages ──────────────────────────────────────────────────────────────
-- NOT named `event_messages` — that table is already taken by the "email
-- everyone about this event" blasts (0190), which are a completely different
-- thing. Keeping the names far apart is deliberate.
create table if not exists public.event_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  text        text,
  reply_to_id uuid references public.event_chat_messages (id) on delete set null,
  -- Moderation, mirroring 0128's chat columns exactly.
  status      text not null default 'visible' check (status in ('visible', 'pending', 'hidden')),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
create index if not exists event_chat_messages_room_idx
  on public.event_chat_messages (event_id, created_at);
alter table public.event_chat_messages enable row level security;

-- ── RLS: the room gate, and how moderation survives an admin-blind room ──────
-- ⚠️ Per Brian, an admin who isn't going cannot browse this room. But 0128 holds
-- a flagged photo or blocklisted message as `status <> 'visible'` and relies on
-- ADMINS being able to read held rows for the review queue — so a naive
-- "members only, no exceptions" policy would strand held messages nobody can
-- ever approve or remove.
--
-- The chosen resolution (Brian: "blind list, moderation still works"): an admin
-- can read a message ONLY while it is held. So they see the item they have to
-- rule on, and never the conversation around it. A member sees the room's
-- visible messages; an author always sees their own, held or not.
drop policy if exists "ecmsg: member read" on public.event_chat_messages;
create policy "ecmsg: member read" on public.event_chat_messages for select
  using (
    (status = 'visible' and public.is_event_chat_member(event_id))
    or author_id = auth.uid()
    or (
      status <> 'visible'
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

-- Posting needs membership AND a live (non-archived) chat: archiving makes a
-- room read-only, and that is enforced here, not just hidden in the UI.
drop policy if exists "ecmsg: member insert own" on public.event_chat_messages;
create policy "ecmsg: member insert own" on public.event_chat_messages for insert
  with check (
    author_id = auth.uid()
    and public.is_event_chat_member(event_id)
    and not public.is_event_chat_archived(event_id)
  );

-- Author edits/soft-deletes their own within 24h; an admin any time (the
-- moderation escape hatch — this is how a held message gets removed).
drop policy if exists "ecmsg: author edit/delete 24h or admin" on public.event_chat_messages;
create policy "ecmsg: author edit/delete 24h or admin" on public.event_chat_messages for update
  using (
    (author_id = auth.uid() and created_at > now() - interval '24 hours')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    (author_id = auth.uid() and created_at > now() - interval '24 hours')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "ecmsg: admin hard delete" on public.event_chat_messages;
create policy "ecmsg: admin hard delete" on public.event_chat_messages for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── 5. Attachments / reactions / mentions ────────────────────────────────────
-- Straight mirrors of 0065's house-chat children, with is_house_member swapped
-- for is_event_chat_member.
create table if not exists public.event_chat_message_media (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.event_chat_messages (id) on delete cascade,
  storage_path text not null,
  -- Includes 'file' from the start (0074 had to add it to the other two chats
  -- after the fact) and `file_name` alongside it, so an event room can carry
  -- the PDF of a work list like any other chat.
  media_type   text not null default 'image'
               check (media_type in ('image','video','sticker','gif','file')),
  file_name    text,
  width        int,
  height       int,
  position     int not null default 0,
  -- 0173's grid-thumbnail column, included at creation rather than backfilled.
  thumbnail_url text,
  created_at   timestamptz not null default now()
);
create index if not exists event_chat_message_media_idx
  on public.event_chat_message_media (message_id, position);
alter table public.event_chat_message_media enable row level security;

drop policy if exists "ecmedia: member read" on public.event_chat_message_media;
create policy "ecmedia: member read" on public.event_chat_message_media for select
  using (exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id and public.is_event_chat_member(m.event_id)
  ));
drop policy if exists "ecmedia: insert on own message" on public.event_chat_message_media;
create policy "ecmedia: insert on own message" on public.event_chat_message_media for insert
  with check (exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id and m.author_id = auth.uid()
  ));
drop policy if exists "ecmedia: delete own or admin" on public.event_chat_message_media;
create policy "ecmedia: delete own or admin" on public.event_chat_message_media for delete
  using (exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id
      and (m.author_id = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ));

create table if not exists public.event_chat_message_reactions (
  message_id uuid not null references public.event_chat_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.event_chat_message_reactions enable row level security;

drop policy if exists "ecreact: member read" on public.event_chat_message_reactions;
create policy "ecreact: member read" on public.event_chat_message_reactions for select
  using (exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id and public.is_event_chat_member(m.event_id)
  ));
drop policy if exists "ecreact: insert own" on public.event_chat_message_reactions;
create policy "ecreact: insert own" on public.event_chat_message_reactions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id
      and public.is_event_chat_member(m.event_id)
      and not public.is_event_chat_archived(m.event_id)
  ));
drop policy if exists "ecreact: update own" on public.event_chat_message_reactions;
create policy "ecreact: update own" on public.event_chat_message_reactions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "ecreact: delete own" on public.event_chat_message_reactions;
create policy "ecreact: delete own" on public.event_chat_message_reactions for delete
  using (user_id = auth.uid());

create table if not exists public.event_chat_message_mentions (
  message_id        uuid not null references public.event_chat_messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);
alter table public.event_chat_message_mentions enable row level security;

drop policy if exists "ecmention: member read" on public.event_chat_message_mentions;
create policy "ecmention: member read" on public.event_chat_message_mentions for select
  using (exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id and public.is_event_chat_member(m.event_id)
  ));
-- You can only @ someone who can actually see the room — i.e. someone else
-- who's going. Mirrors 0024/0065, minus their admin arm (an admin who isn't
-- going isn't in this room and must not be mentionable into it).
drop policy if exists "ecmention: insert on own message" on public.event_chat_message_mentions;
create policy "ecmention: insert on own message" on public.event_chat_message_mentions for insert
  with check (exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id
      and m.author_id = auth.uid()
      and exists (
        select 1 from public.event_attendance a
        where a.event_id = m.event_id
          and a.user_id = mentioned_user_id
          and a.status in ('going', 'maybe')
      )
  ));

-- ── 6. Per-member read + mute state ──────────────────────────────────────────
-- Carries the 0215-correct split from the start: `muted` = permanent,
-- `muted_until` = a timer, never both.
create table if not exists public.event_chat_reads (
  event_id     text not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted        boolean not null default false,
  muted_until  timestamptz,
  primary key (event_id, user_id)
);
alter table public.event_chat_reads enable row level security;

drop policy if exists "ecreads: own read" on public.event_chat_reads;
create policy "ecreads: own read" on public.event_chat_reads for select
  using (user_id = auth.uid());
drop policy if exists "ecreads: own insert" on public.event_chat_reads;
create policy "ecreads: own insert" on public.event_chat_reads for insert
  with check (user_id = auth.uid());
drop policy if exists "ecreads: own update" on public.event_chat_reads;
create policy "ecreads: own update" on public.event_chat_reads for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.mark_event_chat_read(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.event_chat_reads (event_id, user_id, last_read_at)
  values (p_event_id, auth.uid(), now())
  on conflict (event_id, user_id) do update set last_read_at = now();
$$;
revoke all on function public.mark_event_chat_read(text) from public, anon;
grant execute on function public.mark_event_chat_read(text) to authenticated;

-- Mute/unmute one event chat. Same shape as set_house_mute AS FIXED BY 0215 —
-- a duration writes only `muted_until` so it can expire by going stale.
create or replace function public.set_event_chat_mute(
  p_event_id    text,
  p_muted       boolean,
  p_muted_until timestamptz default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.event_chat_reads (event_id, user_id, muted, muted_until)
  values (
    p_event_id, auth.uid(),
    p_muted and p_muted_until is null,
    case when p_muted then p_muted_until else null end
  )
  on conflict (event_id, user_id)
  do update set muted = excluded.muted, muted_until = excluded.muted_until;
$$;
revoke all on function public.set_event_chat_mute(text, boolean, timestamptz) from public, anon;
grant execute on function public.set_event_chat_mute(text, boolean, timestamptz) to authenticated;

-- ── 7. Creating and destroying the chat, by trigger ──────────────────────────
-- ⚠️ A TRIGGER, not an edit to create_event. `create_event` would have to be
-- recreated from its current production body to add one INSERT, which is
-- exactly the move that caused the 0160 incident (a "recreate" silently
-- dropping an unrelated earlier fix, undetectable by Postgres). A trigger also
-- catches every path that ever creates an event, including ones added later.
create or replace function public.create_event_chat_on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nothing to talk about for an event entered after the fact. Also keeps a
  -- historical import from spraying rooms across the Feed.
  if coalesce(new.end_date, new.start_date) < (current_date - interval '7 days') then
    return new;
  end if;
  insert into public.event_chats (event_id)
  values (new.id::text)
  on conflict (event_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_create_event_chat on public.events;
create trigger trg_create_event_chat
  after insert on public.events
  for each row execute function public.create_event_chat_on_event();

-- `event_id` is text with no FK, so nothing cascades — mirroring how
-- `delete_event` has to clear event_attendance and event_hosts by hand (0209).
-- Doing it in a trigger rather than by recreating `delete_event` for the same
-- reason as above.
create or replace function public.delete_event_chat_on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.event_chat_messages where event_id = old.id::text;
  delete from public.event_chat_reads    where event_id = old.id::text;
  delete from public.event_chats         where event_id = old.id::text;
  return old;
end;
$$;

drop trigger if exists trg_delete_event_chat on public.events;
create trigger trg_delete_event_chat
  after delete on public.events
  for each row execute function public.delete_event_chat_on_event();

-- ── 8. Admin: reopen an archived chat for a day or a week ────────────────────
-- ⚠️ App-admin-gated, which is NOT a contradiction of the no-admin-override
-- rule: reopening changes whether the room accepts posts, it grants the admin
-- no ability to READ it. An admin who isn't going still can't see a word.
-- Because of that, this is driven from an admin surface listing archived
-- chats, not from the Feed (where they'd never see one).
create or replace function public.set_event_chat_reopened(p_event_id text, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an app admin can reopen an archived event chat'
      using errcode = '42501';
  end if;
  if p_days is null then
    v_until := null;                                  -- re-archive immediately
  elsif p_days in (1, 7) then
    v_until := now() + (p_days || ' days')::interval; -- the two offered choices
  else
    raise exception 'An event chat can only be reopened for 1 or 7 days'
      using errcode = '22023';
  end if;

  insert into public.event_chats (event_id, reopened_until, reopened_by)
  values (p_event_id, v_until, auth.uid())
  on conflict (event_id)
  do update set reopened_until = excluded.reopened_until, reopened_by = excluded.reopened_by;
  return v_until;
end;
$$;
revoke all on function public.set_event_chat_reopened(text, int) from public, anon;
grant execute on function public.set_event_chat_reopened(text, int) to authenticated;

-- Every archived chat, for that admin surface. SECURITY DEFINER because an
-- admin deliberately cannot read `event_chats` through RLS (they're not a
-- member) — so this returns only the metadata needed to reopen one: which
-- event, its dates, and how big the room is. ⚠️ Never message contents.
create or replace function public.admin_archived_event_chats()
returns table (
  event_id       text,
  title          text,
  emoji          text,
  start_date     date,
  end_date       date,
  message_count  bigint,
  reopened_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.event_id, e.title, e.emoji, e.start_date, e.end_date,
         (select count(*) from public.event_chat_messages m
           where m.event_id = c.event_id and m.deleted_at is null),
         c.reopened_until
    from public.event_chats c
    left join public.events e on e.id::text = c.event_id
   where exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
     and public.is_event_chat_archived(c.event_id)
   order by coalesce(e.end_date, e.start_date) desc nulls last;
$$;
revoke all on function public.admin_archived_event_chats() from public, anon;
grant execute on function public.admin_archived_event_chats() to authenticated;

-- ── 9. The caller's own event chats, in one round-trip ───────────────────────
-- The Feed needs, per chat: the event, whether it's archived, the last message
-- preview, an unread count, and mute state. Resolving that client-side would be
-- a membership probe per event plus four reads each. This does it in one call,
-- and — being the same `is_event_chat_member` the policies use — it cannot
-- drift from what the member can actually open (the `event_message_preview`
-- doctrine, 0192).
create or replace function public.my_event_chats()
returns table (
  event_id      text,
  title         text,
  emoji         text,
  start_date    date,
  end_date      date,
  archived      boolean,
  last_text     text,
  last_at       timestamptz,
  last_author   text,
  last_media    text,
  unread        bigint,
  muted         boolean,
  muted_until   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select c.event_id
      from public.event_chats c
     where public.is_event_chat_member(c.event_id)
  ), last_msg as (
    -- DISTINCT ON, not `created_at = (select max(...))`: two messages landing in
    -- the same microsecond would otherwise both match and emit a DUPLICATE Feed
    -- row for that event. Also one pass instead of a correlated subquery.
    select distinct on (m.event_id)
           m.event_id, m.text, m.created_at, m.author_id, m.id
      from public.event_chat_messages m
      join mine on mine.event_id = m.event_id
     where m.deleted_at is null and m.status = 'visible'
     order by m.event_id, m.created_at desc, m.id desc
  )
  select
    mine.event_id,
    e.title,
    e.emoji,
    e.start_date,
    e.end_date,
    public.is_event_chat_archived(mine.event_id),
    lm.text,
    lm.created_at,
    p.display_name,
    (select md.media_type from public.event_chat_message_media md
      where md.message_id = lm.id order by md.position limit 1),
    (select count(*) from public.event_chat_messages um
      where um.event_id = mine.event_id
        and um.deleted_at is null
        and um.status = 'visible'
        and um.author_id <> auth.uid()
        and um.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
    -- The 0215 rule, evaluated here so the client can't get it wrong: muted by
    -- the permanent flag, or by a timer that hasn't run out.
    coalesce(r.muted, false) or coalesce(r.muted_until > now(), false),
    case when r.muted_until > now() then r.muted_until else null end
  from mine
  left join public.events e on e.id::text = mine.event_id
  left join last_msg lm on lm.event_id = mine.event_id
  left join public.profiles p on p.id = lm.author_id
  left join public.event_chat_reads r
         on r.event_id = mine.event_id and r.user_id = auth.uid();
$$;
revoke all on function public.my_event_chats() from public, anon;
grant execute on function public.my_event_chats() to authenticated;

-- ── 9a. "…as this other person" twins of two existing predicates ────────────
-- `is_committee_lead` (0177) and roster membership both key on `auth.uid()`,
-- which inside a SECURITY DEFINER function is still the CALLING admin — so
-- neither can answer "is *that member* a lead of this committee?", which is what
-- the View-As list below needs.
--
-- ⚠️ These are parameterized copies of 0177's `is_committee_lead` body. Two
-- details in it are easy to get wrong and were both gotten wrong on a first
-- pass here: the committee-LEVEL `committee_roster.is_lead` boolean counts as
-- lead in addition to a role suffix, and the suffix pattern is `'% · Lead'`
-- **with a space before the separator**. Keep these in step with 0177 (and with
-- `baseArea`/`isAreaLead` in lib/committeeAdmin.ts, which is the client-side
-- copy of the same convention).
--
-- ⚠️ Deliberately NOT wired into anything that grants access — they exist only
-- to describe somebody else's UI. Access always runs through the auth.uid()
-- originals.
create or replace function public._is_committee_lead_as(cid uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.committee_roster r
    join public.committees c on c.slug = r.committee_slug
    where c.id = cid
      and r.linked_user_id = p_uid
      and (
        r.is_lead
        or exists (
          select 1 from unnest(coalesce(r.roles, '{}'::text[])) role
          where role like '% · Lead'
        )
      )
  );
$$;
revoke all on function public._is_committee_lead_as(uuid, uuid) from public, anon;
grant execute on function public._is_committee_lead_as(uuid, uuid) to authenticated;

-- Roster membership for a given member. ⚠️ NOT is_committee_member, which grants
-- every app admin a pass (0057) — using that here would report every admin as
-- being in every committee-hosted event's room.
create or replace function public._is_committee_member_as(cid uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.committee_roster r
    join public.committees c on c.slug = r.committee_slug
    where c.id = cid and r.linked_user_id = p_uid
  );
$$;
revoke all on function public._is_committee_member_as(uuid, uuid) from public, anon;
grant execute on function public._is_committee_member_as(uuid, uuid) to authenticated;

-- ── 9b. "View as" — the LIST only, never a word of the conversation ──────────
-- Per Brian: an app admin using View As should see WHICH chats a member has (so
-- they can check the UI — "she's going to this, does her Events section look
-- right?"), but must NOT be able to read the conversation. "View As is to
-- cross-check the UI/UX of a certain user, not to invade their privacy."
--
-- Why this needs its own function at all: `my_event_chats()` keys on
-- `auth.uid()`, so during a preview it returns the ADMIN'S OWN rooms — the
-- wrong answer entirely — and it carries `last_text`/`last_author`, which IS
-- conversation content.
--
-- ⚠️ So this deliberately returns **no last message, no author, no media** — the
-- room's identity and the shape of its badge, nothing more. Do NOT "improve" it
-- by adding a preview line; that is precisely the thing being withheld. Unread
-- count is kept: it's a property of the member's UI, not of what anyone said.
--
-- ⚠️ Being SECURITY DEFINER, this MUST gate on is_admin itself — and it also
-- runs the target's own membership predicate rather than reimplementing it, so
-- a previewed list can't drift from the real one. `is_event_chat_member` reads
-- `auth.uid()`, which is still the ADMIN inside a definer function, so it can't
-- be reused here; the going/maybe + creator + host rule is instead evaluated
-- for p_user explicitly below. Keep the two in step.
create or replace function public.preview_event_chats(p_user uuid)
returns table (
  event_id    text,
  title       text,
  emoji       text,
  start_date  date,
  end_date    date,
  archived    boolean,
  unread      bigint,
  muted       boolean,
  muted_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.event_id,
    e.title,
    e.emoji,
    e.start_date,
    e.end_date,
    public.is_event_chat_archived(c.event_id),
    (select count(*) from public.event_chat_messages um
      where um.event_id = c.event_id
        and um.deleted_at is null
        and um.status = 'visible'
        and um.author_id <> p_user
        and um.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
    coalesce(r.muted, false) or coalesce(r.muted_until > now(), false),
    case when r.muted_until > now() then r.muted_until else null end
  from public.event_chats c
  left join public.events e on e.id::text = c.event_id
  left join public.event_chat_reads r
         on r.event_id = c.event_id and r.user_id = p_user
  where exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    and (
      -- the same four arms as is_event_chat_member, evaluated for p_user
      exists (
        select 1 from public.event_attendance a
        where a.event_id = c.event_id and a.user_id = p_user
          and a.status in ('going', 'maybe')
      )
      or exists (
        select 1 from public.events e2
        where e2.id::text = c.event_id and e2.created_by = p_user
      )
      or exists (
        select 1 from public.event_hosts h
        where h.event_id = c.event_id and h.user_id = p_user
      )
      or exists (
        select 1 from public.event_hosts h
        where h.event_id = c.event_id and h.committee_id is not null
          and case
                when public.committee_has_leads(h.committee_id)
                  then public._is_committee_lead_as(h.committee_id, p_user)
                else public._is_committee_member_as(h.committee_id, p_user)
              end
      )
    );
$$;
revoke all on function public.preview_event_chats(uuid) from public, anon;
grant execute on function public.preview_event_chats(uuid) to authenticated;

-- ── 10. @mention notification ────────────────────────────────────────────────
-- Mirrors 0065's house-chat mention trigger: one `chat_mention` row, deep-linked
-- into the room via the Feed (never the standalone chat route — see CLAUDE.md's
-- installed-PWA warning).
create or replace function public.notif_on_event_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg    record;
  v_title  text;
begin
  select m.event_id, m.author_id into v_msg
    from public.event_chat_messages m where m.id = new.message_id;
  if v_msg.author_id = new.mentioned_user_id then return new; end if;

  select e.title into v_title from public.events e where e.id::text = v_msg.event_id;

  -- ⚠️ Argument order is (recipient, type, ACTOR, title, body, url) — the actor
  -- is the THIRD parameter, not the last (0030). Getting it wrong silently
  -- files the notification against the wrong person.
  perform public._notify(
    new.mentioned_user_id,
    'chat_mention',
    v_msg.author_id,
    coalesce(v_title, 'Event') || ' chat',
    'You were mentioned',
    '/posts?event=' || v_msg.event_id
  );
  return new;
end;
$$;

drop trigger if exists trg_notif_event_chat_mention on public.event_chat_message_mentions;
create trigger trg_notif_event_chat_mention
  after insert on public.event_chat_message_mentions
  for each row execute function public.notif_on_event_chat_mention();

-- ── 11. The 0213 approval guard ──────────────────────────────────────────────
-- ⚠️ 0213's DO block only attached this to tables that existed then, so every
-- new member-writable table has to opt in by hand or an unverified account can
-- write to it. `event_chat_reads` is a read receipt, which 0213 exempts as a
-- class — but it also carries mute state now, and there is no reason an
-- unapproved account should be touching either, so it's included.
do $$
declare t text;
begin
  foreach t in array array[
    'event_chats', 'event_chat_messages', 'event_chat_message_media',
    'event_chat_message_reactions', 'event_chat_message_mentions', 'event_chat_reads'
  ]
  loop
    execute format('drop trigger if exists require_approved_member_trg on public.%I', t);
    execute format(
      'create trigger require_approved_member_trg before insert or update or delete on public.%I
         for each row execute function public.require_approved_member()', t);
  end loop;
end;
$$;

-- ── 12. Realtime ─────────────────────────────────────────────────────────────
-- Guarded, so re-running this file can't fail on an already-published table
-- (the idiom from 0003/0004/0013).
do $$ begin alter publication supabase_realtime add table public.event_chat_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.event_chat_message_reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.event_chats; exception when duplicate_object then null; end $$;

-- ── 13. Backfill: every event that hasn't finished yet ───────────────────────
-- "Just events going forward" — an event still ahead of us (or inside its 7-day
-- tail) gets a room now, since people are RSVPing to it today. Anything already
-- past stays chatless, which is the whole point.
insert into public.event_chats (event_id)
select e.id::text
  from public.events e
 where coalesce(e.end_date, e.start_date) >= (current_date - interval '7 days')
on conflict (event_id) do nothing;
