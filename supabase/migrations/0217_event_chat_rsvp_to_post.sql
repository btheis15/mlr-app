-- 0217_event_chat_rsvp_to_post.sql
-- SEEING an event chat and being IN it are now two different things.
--
-- 0216 gave `is_event_chat_member` four arms — RSVP'd going/maybe, the event's
-- creator, a named person host, or a committee host — and used that one
-- predicate for BOTH reading and posting. So whoever created a Work Weekend
-- could talk in its room without ever saying whether they were coming, which
-- sits badly against the rule the whole feature is built on ("you'd only ever
-- see the event if you RSVPed that you were going").
--
-- Per Brian: keep the room VISIBLE and READABLE to a creator/host who hasn't
-- answered yet — "you can still see it, I think that's fine" — but make them
-- RSVP before they can say anything or count as having joined.
--
-- So:
--   * READ  — `is_event_chat_member`, unchanged. An organizer can watch their
--             own event's room before deciding, which is the point of the
--             creator/host arms.
--   * WRITE — `can_post_in_event_chat` (new): going or maybe, full stop. No
--             creator arm, no host arm, no admin arm.
--
-- ⚠️ Do not "simplify" this back into one predicate. The two answer different
-- questions, and collapsing them either locks organizers out of their own
-- event's room or lets them post without ever RSVPing.
--
-- ⚠️ A reaction counts as saying something and is gated the same way — an emoji
-- from someone who hasn't answered still reads to the room as a participant.

create or replace function public.can_post_in_event_chat(p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and public.is_approved_member()
    -- The ONLY arm. Deliberately no creator/host/admin fallback: this is the
    -- "have you actually said you're coming" gate.
    and exists (
      select 1 from public.event_attendance a
      where a.event_id = p_event_id
        and a.user_id = auth.uid()
        and a.status in ('going', 'maybe')
    )
    -- Archiving makes a room read-only for everybody; folding it in here keeps
    -- one gate rather than two that can drift.
    and not public.is_event_chat_archived(p_event_id);
$$;
revoke all on function public.can_post_in_event_chat(text) from public, anon;
grant execute on function public.can_post_in_event_chat(text) to authenticated;

-- ── Swap the write gates ─────────────────────────────────────────────────────
-- Replaces 0216's "member and not archived" with the narrower predicate (which
-- carries the archived check itself).
drop policy if exists "ecmsg: member insert own" on public.event_chat_messages;
create policy "ecmsg: member insert own" on public.event_chat_messages for insert
  with check (
    author_id = auth.uid()
    and public.can_post_in_event_chat(event_id)
  );

drop policy if exists "ecreact: insert own" on public.event_chat_message_reactions;
create policy "ecreact: insert own" on public.event_chat_message_reactions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.event_chat_messages m
    where m.id = message_id and public.can_post_in_event_chat(m.event_id)
  ));

-- Media + mentions hang off a message the caller already had to be allowed to
-- insert (both policies require `m.author_id = auth.uid()`), so they inherit the
-- new gate and are deliberately left alone.

-- ── Tell the client which rooms it may actually post in ─────────────────────
-- Both functions gain a `can_post` column. A return-type change needs DROP +
-- CREATE, and both bodies below are 0216's verbatim (their current production
-- form) with only that column added — the 0160 rule.
drop function if exists public.my_event_chats();
create or replace function public.my_event_chats()
returns table (
  event_id      text,
  title         text,
  emoji         text,
  start_date    date,
  end_date      date,
  archived      boolean,
  can_post      boolean,
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
    public.can_post_in_event_chat(mine.event_id),
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

-- The View-As list gains it too, so an admin checking a member's UI can see
-- "she has this room but hasn't RSVP'd, so she can't post yet" — which is
-- exactly the kind of thing View As exists to confirm.
--
-- ⚠️ Still returns NO message content. See 0216 §9b before touching this.
drop function if exists public.preview_event_chats(uuid);
create or replace function public.preview_event_chats(p_user uuid)
returns table (
  event_id    text,
  title       text,
  emoji       text,
  start_date  date,
  end_date    date,
  archived    boolean,
  can_post    boolean,
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
    -- can_post for THAT member: the same single arm as
    -- can_post_in_event_chat, evaluated for p_user (that function reads
    -- auth.uid(), which is still the calling admin in here).
    (
      exists (
        select 1 from public.event_attendance a
        where a.event_id = c.event_id and a.user_id = p_user
          and a.status in ('going', 'maybe')
      )
      and not public.is_event_chat_archived(c.event_id)
    ),
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
