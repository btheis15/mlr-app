-- 0149_chat_polls.sql
-- "Quick polls" for committee/house chat rooms (everything except the
-- resort-wide Main Feed) — an iMessage/Messenger-style poll anyone in the room
-- can drop in: a question, 2-10 options (single- or multi-select), an
-- optional write-in "Other", and a choice of anonymous (counts only) or
-- attributed (counts + who picked what) results.
--
-- Shape mirrors meetings (0116) — a room-scoped table set, read via RLS scoped
-- to can_access_committee_area (0063) / is_house_member (0064), all writes
-- through SECURITY DEFINER RPCs, realtime for live tallies — and family polls
-- (0084) for the vote/option/close/delete RPC style.
--
-- One deliberate deviation: "anonymous" is a real promise here, not a UI
-- nicety, so raw vote rows (chat_poll_votes) get NO select grant at all —
-- nobody, including the voter's own client, can read that table directly,
-- the same "no anon/authenticated grant, deny-all RLS" doctrine as
-- content_embeddings (0129). All reads happen through SECURITY DEFINER RPCs
-- that decide what to reveal based on chat_polls.anonymous. Live tallies come
-- from denormalized counts on chat_polls/chat_poll_options (kept current by a
-- trigger), which ARE safely readable + realtime-able.
--
-- Apply in the Supabase SQL editor after 0148.

-- ── 1. Tables ────────────────────────────────────────────────────────────────

create table if not exists public.chat_polls (
  id               uuid primary key default gen_random_uuid(),
  scope_type       text not null check (scope_type in ('committee', 'house')),
  committee_id     uuid references public.committees (id) on delete cascade,
  committee_slug   text,
  area             text,
  house_id         uuid references public.houses (id) on delete cascade,
  question         text not null,               -- "what it's for"
  allow_multiple   boolean not null default false,
  anonymous        boolean not null default false,
  allow_other      boolean not null default false,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  closes_on        date,                         -- null ⇒ open until closed by hand
  is_closed        boolean not null default false,
  respondent_count int not null default 0,       -- distinct voters, kept live by trigger below
  check (
    (scope_type = 'committee' and committee_id is not null and house_id is null)
    or (scope_type = 'house' and house_id is not null and committee_id is null)
  )
);
create index if not exists chat_polls_committee_idx on public.chat_polls (committee_slug, area, created_at desc);
create index if not exists chat_polls_house_idx on public.chat_polls (house_id, created_at desc);

create table if not exists public.chat_poll_options (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.chat_polls (id) on delete cascade,
  label      text not null,
  position   int not null default 0,
  is_other   boolean not null default false,     -- the write-in slot
  vote_count int not null default 0              -- kept live by trigger below
);
create index if not exists chat_poll_options_poll_idx on public.chat_poll_options (poll_id);

-- Multi-select needs more than one row per (poll, user), so the PK includes
-- option_id — unlike poll_votes (0084) / meeting_availability (0116), which
-- are one-row-per-member. other_text only ever accompanies the is_other row.
create table if not exists public.chat_poll_votes (
  poll_id    uuid not null references public.chat_polls (id) on delete cascade,
  option_id  uuid not null references public.chat_poll_options (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  other_text text,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);
create index if not exists chat_poll_votes_poll_idx on public.chat_poll_votes (poll_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────────────

alter table public.chat_polls enable row level security;
alter table public.chat_poll_options enable row level security;
alter table public.chat_poll_votes enable row level security;

-- A member reads a poll iff they can access its room (same gate as the chat).
drop policy if exists "chat_polls: room read" on public.chat_polls;
create policy "chat_polls: room read" on public.chat_polls for select using (
  case
    when scope_type = 'committee' then public.can_access_committee_area(committee_id, area)
    when scope_type = 'house' then public.is_house_member(house_id)
    else false
  end
);

drop policy if exists "chat_poll_options: room read" on public.chat_poll_options;
create policy "chat_poll_options: room read" on public.chat_poll_options for select using (
  exists (
    select 1 from public.chat_polls p
    where p.id = poll_id
      and case
        when p.scope_type = 'committee' then public.can_access_committee_area(p.committee_id, p.area)
        when p.scope_type = 'house' then public.is_house_member(p.house_id)
        else false
      end
  )
);

-- chat_poll_votes DELIBERATELY GETS NO SELECT POLICY — RLS default-denies
-- every row to every role (including the voter's own client and devtools).
-- The only way in or out is the SECURITY DEFINER RPCs below.

-- ── 3. Live counts — a trigger keeps chat_poll_options.vote_count and
-- chat_polls.respondent_count current, so realtime tallies never need to read
-- chat_poll_votes directly. ────────────────────────────────────────────────
create or replace function public._chat_poll_votes_recount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option uuid := coalesce(new.option_id, old.option_id);
  v_poll   uuid := coalesce(new.poll_id, old.poll_id);
begin
  update public.chat_poll_options
     set vote_count = (select count(*) from public.chat_poll_votes where option_id = v_option)
   where id = v_option;
  update public.chat_polls
     set respondent_count = (select count(distinct user_id) from public.chat_poll_votes where poll_id = v_poll)
   where id = v_poll;
  return null;
end;
$$;

drop trigger if exists chat_poll_votes_recount on public.chat_poll_votes;
create trigger chat_poll_votes_recount
  after insert or delete on public.chat_poll_votes
  for each row execute function public._chat_poll_votes_recount();

-- ── 4. Fan-out + deep-link helpers (mirror _notify_meeting_room / _meeting_url) ─

create or replace function public._notify_chat_poll_room(
  p_poll uuid, p_type text, p_actor uuid, p_title text, p_body text, p_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll public.chat_polls%rowtype;
begin
  select * into poll from public.chat_polls where id = p_poll;
  if not found then return; end if;

  if poll.scope_type = 'committee' then
    perform public._notify(r.linked_user_id, p_type, p_actor, p_title, p_body, p_url, 'chat_poll', p_poll, null)
    from public.committee_roster r
    where r.committee_slug = poll.committee_slug
      and r.linked_user_id is not null
      and (
        poll.area is null
        or poll.area = any(r.roles)
        or (poll.area || ' · Lead') = any(r.roles)
      );
  elsif poll.scope_type = 'house' then
    perform public._notify(pr.id, p_type, p_actor, p_title, p_body, p_url, 'chat_poll', p_poll, null)
    from public.profiles pr
    where pr.house_id = poll.house_id;
  end if;
end;
$$;
revoke all on function public._notify_chat_poll_room(uuid, text, uuid, text, text, text) from public, anon, authenticated;

create or replace function public._chat_poll_url(p public.chat_polls)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.scope_type = 'committee' then
      '/posts?c=' || p.committee_slug || coalesce('&area=' || p.area, '') || '&poll=' || p.id
    when p.scope_type = 'house' then
      '/posts?house=' || (select h.slug from public.houses h where h.id = p.house_id) || '&poll=' || p.id
    else '/posts'
  end;
$$;

-- ── 5. RPCs ──────────────────────────────────────────────────────────────────

-- Create a poll — ANY room member (family-polls doctrine, not the
-- meeting-organizer doctrine). Blank options are dropped; what's left must be
-- 2-10. An "Other" write-in slot is appended automatically when requested,
-- not counted against the 10.
create or replace function public.create_chat_poll(
  p_scope          text,
  p_committee_id   uuid,
  p_area           text,
  p_house_id       uuid,
  p_question       text,
  p_options        text[],
  p_allow_multiple boolean default false,
  p_anonymous      boolean default false,
  p_allow_other    boolean default false,
  p_closes_on      date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_slug      text;
  v_question  text;
  v_labels    text[];
  v_can       boolean;
  v_actor     text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_scope not in ('committee', 'house') then raise exception 'Invalid scope'; end if;

  v_can := case
    when p_scope = 'committee' then public.can_access_committee_area(p_committee_id, p_area)
    when p_scope = 'house' then public.is_house_member(p_house_id)
    else false
  end;
  if not v_can then raise exception 'Not authorized'; end if;
  if p_scope = 'committee' and public.is_committee_area_archived(p_committee_id, p_area) then
    raise exception 'This chat is archived';
  end if;

  v_question := btrim(coalesce(p_question, ''));
  if v_question = '' then raise exception 'A question is required'; end if;
  if length(v_question) > 300 then raise exception 'Keep the question under 300 characters'; end if;

  select array_agg(l order by ord) into v_labels
  from (
    select btrim(x) as l, ord
    from unnest(coalesce(p_options, '{}')) with ordinality as t(x, ord)
    where btrim(coalesce(x, '')) <> ''
  ) s;
  if coalesce(array_length(v_labels, 1), 0) < 2 then
    raise exception 'Give people at least 2 options';
  end if;
  if array_length(v_labels, 1) > 10 then
    raise exception 'A poll can have at most 10 options';
  end if;

  if p_scope = 'committee' then
    select slug into v_slug from public.committees where id = p_committee_id;
    if v_slug is null then raise exception 'Committee not found'; end if;
  end if;

  insert into public.chat_polls
    (scope_type, committee_id, committee_slug, area, house_id, question,
     allow_multiple, anonymous, allow_other, created_by, closes_on)
  values
    (p_scope, p_committee_id, v_slug, p_area, p_house_id, v_question,
     coalesce(p_allow_multiple, false), coalesce(p_anonymous, false), coalesce(p_allow_other, false),
     auth.uid(), p_closes_on)
  returning id into v_id;

  insert into public.chat_poll_options (poll_id, label, position, is_other)
  select v_id, l, (ord - 1)::int, false
  from unnest(v_labels) with ordinality as t(l, ord);

  if coalesce(p_allow_other, false) then
    insert into public.chat_poll_options (poll_id, label, position, is_other)
    values (v_id, 'Other', array_length(v_labels, 1), true);
  end if;

  select coalesce(display_name, 'Someone') into v_actor from public.profiles where id = auth.uid();
  perform public._notify_chat_poll_room(
    v_id, 'chat_poll_created', auth.uid(),
    v_actor || ' started a poll: ' || v_question,
    'Tap to vote',
    (select public._chat_poll_url(p) from public.chat_polls p where p.id = v_id)
  );

  return v_id;
end;
$$;
revoke all on function public.create_chat_poll(text, uuid, text, uuid, text, text[], boolean, boolean, boolean, date) from public, anon;
grant execute on function public.create_chat_poll(text, uuid, text, uuid, text, text[], boolean, boolean, boolean, date) to authenticated;

-- Set (or change/clear) MY votes in one call — full-replace of my own rows.
-- Enforces closed/single-vs-multi/option-membership/"Other" needs text.
create or replace function public.set_chat_poll_votes(
  p_poll       uuid,
  p_option_ids uuid[],
  p_other_text text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll         public.chat_polls%rowtype;
  v_can        boolean;
  v_ids        uuid[];
  v_other_id   uuid;
  v_other_text text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into poll from public.chat_polls where id = p_poll;
  if not found then raise exception 'Poll not found'; end if;
  if poll.is_closed or (poll.closes_on is not null and poll.closes_on < current_date) then
    raise exception 'This poll is closed';
  end if;

  v_can := case
    when poll.scope_type = 'committee' then public.can_access_committee_area(poll.committee_id, poll.area)
    when poll.scope_type = 'house' then public.is_house_member(poll.house_id)
    else false
  end;
  if not v_can then raise exception 'Not authorized'; end if;

  select array_agg(distinct oid) into v_ids from unnest(coalesce(p_option_ids, '{}')) as oid;

  if coalesce(array_length(v_ids, 1), 0) > 0 and exists (
    select 1 from unnest(v_ids) as oid
    where not exists (select 1 from public.chat_poll_options o where o.id = oid and o.poll_id = p_poll)
  ) then
    raise exception 'That option isn''t part of this poll';
  end if;

  if not poll.allow_multiple and coalesce(array_length(v_ids, 1), 0) > 1 then
    raise exception 'This poll only allows one choice';
  end if;

  select id into v_other_id from public.chat_poll_options where poll_id = p_poll and is_other;
  v_other_text := nullif(btrim(coalesce(p_other_text, '')), '');
  if v_other_id is not null and v_other_id = any(coalesce(v_ids, '{}')) and v_other_text is null then
    raise exception 'Say what "Other" means';
  end if;

  delete from public.chat_poll_votes
  where poll_id = p_poll and user_id = auth.uid()
    and not (option_id = any(coalesce(v_ids, '{}')));

  insert into public.chat_poll_votes (poll_id, option_id, user_id, other_text)
  select p_poll, oid, auth.uid(), case when oid = v_other_id then v_other_text else null end
  from unnest(coalesce(v_ids, '{}')) as oid
  on conflict (poll_id, option_id, user_id)
  do update set other_text = excluded.other_text, created_at = now();
end;
$$;
revoke all on function public.set_chat_poll_votes(uuid, uuid[], text) from public, anon;
grant execute on function public.set_chat_poll_votes(uuid, uuid[], text) to authenticated;

-- Close a poll (freeze the results) — its creator or an app admin.
create or replace function public.close_chat_poll(p_poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.chat_polls where id = p_poll) then
    raise exception 'Poll not found';
  end if;
  if not exists (
    select 1 from public.chat_polls p
    where p.id = p_poll
      and (p.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then
    raise exception 'Not authorized';
  end if;
  update public.chat_polls set is_closed = true where id = p_poll;
end;
$$;
revoke all on function public.close_chat_poll(uuid) from public, anon;
grant execute on function public.close_chat_poll(uuid) to authenticated;

-- Delete a poll (options + votes cascade) — its creator or an app admin.
create or replace function public.delete_chat_poll(p_poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.chat_polls where id = p_poll) then
    raise exception 'Poll not found';
  end if;
  if not exists (
    select 1 from public.chat_polls p
    where p.id = p_poll
      and (p.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then
    raise exception 'Not authorized';
  end if;
  delete from public.chat_polls where id = p_poll;
end;
$$;
revoke all on function public.delete_chat_poll(uuid) from public, anon;
grant execute on function public.delete_chat_poll(uuid) to authenticated;

-- Every poll in a room, with options/counts + the caller's OWN selections —
-- enough to render the pinned bar. Re-checks room membership itself (a
-- SECURITY DEFINER function bypasses the caller's RLS), so a non-member
-- passing an arbitrary committee/house id just gets an empty array back.
create or replace function public.fetch_chat_polls_for_room(
  p_scope        text,
  p_committee_id uuid,
  p_area         text,
  p_house_id     uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  from (
    select
      p.id, p.question, p.allow_multiple, p.anonymous, p.allow_other,
      p.created_by, (p.created_by = auth.uid()) as created_by_me,
      p.created_at, p.closes_on, p.is_closed, p.respondent_count,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'label', o.label, 'position', o.position,
          'is_other', o.is_other, 'vote_count', o.vote_count
        ) order by o.position), '[]'::jsonb)
        from public.chat_poll_options o where o.poll_id = p.id
      ) as options,
      (
        select coalesce(jsonb_agg(v.option_id), '[]'::jsonb)
        from public.chat_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()
      ) as my_option_ids,
      (
        select v.other_text from public.chat_poll_votes v
        join public.chat_poll_options o on o.id = v.option_id and o.is_other
        where v.poll_id = p.id and v.user_id = auth.uid()
        limit 1
      ) as my_other_text
    from public.chat_polls p
    where case
      when p_scope = 'committee' then
        p.scope_type = 'committee' and p.committee_id = p_committee_id
        and (p.area is not distinct from p_area)
        and public.can_access_committee_area(p_committee_id, p_area)
      when p_scope = 'house' then
        p.scope_type = 'house' and p.house_id = p_house_id
        and public.is_house_member(p_house_id)
      else false
    end
  ) t;
$$;
revoke all on function public.fetch_chat_polls_for_room(text, uuid, text, uuid) from public, anon;
grant execute on function public.fetch_chat_polls_for_room(text, uuid, text, uuid) to authenticated;

-- The ONE place identity is ever revealed for a poll — and only when the
-- creator didn't ask for anonymous results. Called on demand when a poll's
-- results sheet opens, never as part of the room's poll list.
create or replace function public.chat_poll_voters(p_poll uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  poll  public.chat_polls%rowtype;
  v_can boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into poll from public.chat_polls where id = p_poll;
  if not found then raise exception 'Poll not found'; end if;

  v_can := case
    when poll.scope_type = 'committee' then public.can_access_committee_area(poll.committee_id, poll.area)
    when poll.scope_type = 'house' then public.is_house_member(poll.house_id)
    else false
  end;
  if not v_can then raise exception 'Not authorized'; end if;

  if poll.anonymous then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'option_id', v.option_id, 'user_id', v.user_id,
      'name', coalesce(pr.display_name, 'Someone'), 'avatar_url', pr.avatar_url,
      'other_text', v.other_text
    ))
    from public.chat_poll_votes v
    join public.profiles pr on pr.id = v.user_id
    where v.poll_id = p_poll
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.chat_poll_voters(uuid) from public, anon;
grant execute on function public.chat_poll_voters(uuid) to authenticated;

-- ── 6. Notification kind (default ON for every member) ────────────────────────
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder,tournament_published,tournament_match_ready,tournament_champion,chat_poll_created}';

update public.profiles set notif_types = array_append(notif_types, 'chat_poll_created')
  where not ('chat_poll_created' = any(notif_types));

-- ── 7. Realtime — chat_polls + chat_poll_options only. chat_poll_votes is
-- deliberately NOT added: there is nothing safe to broadcast from it. ─────────
alter table public.chat_polls replica identity full;
do $$ begin alter publication supabase_realtime add table public.chat_polls; exception when duplicate_object then null; end $$;
alter table public.chat_poll_options replica identity full;
do $$ begin alter publication supabase_realtime add table public.chat_poll_options; exception when duplicate_object then null; end $$;
