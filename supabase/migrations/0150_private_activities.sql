-- 0150_private_activities.sql
--
-- PRIVATE ACTIVITIES — a member-created, invite-only one-off get-together that
-- lives in the Events tab but is visible ONLY to the people it's shared with.
-- The use case: someone wants to run a quick ping-pong / baggo tournament with a
-- few family members over a random weekend, WITHOUT making a big resort "event",
-- without an announcement, and without everyone seeing it. They just "create an
-- activity", optionally make it a tournament, and share it with a handful of
-- people. Notifications (if the organizer opts in) only ever go to the people
-- involved.
--
-- Who can create: ANY signed-in member (the polls / work-items / cabin-request
-- member-createable doctrine — NOT the admin-only events model).
--
-- Privacy: modeled the same way houses/cabins scope content — a SECURITY DEFINER
-- membership predicate (`is_private_activity_member`) used in the RLS `using(...)`
-- clause, so only the creator + the invited members (+ admins, for moderation)
-- can read the activity, its roster, and its tournament. There is deliberately no
-- public/all-members visibility: a private activity is private, full stop.
--
-- Tournaments: a private activity can host the exact same tournament as a Family
-- Fest activity (migration 0144) — bracket / round-robin / pools, scoring,
-- rearrange, everything. Rather than fork that machinery, `tournaments` becomes
-- polymorphic: it hangs off EITHER a `schedule_item_id` (a fest activity) OR a
-- `private_activity_id` (a private activity), exactly one of the two.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.private_activities (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  emoji              text,
  description        text,
  location           text,
  starts_at          timestamptz,               -- null = "sometime" / TBD
  ends_at            timestamptz,
  tournament_enabled boolean not null default false,
  archived_at        timestamptz,               -- set = a finished game, tucked away (still deletable)
  created_by         uuid not null references public.profiles (id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists private_activities_creator_idx on public.private_activities (created_by);

-- The roster: who this activity is shared with. A member is either a linked app
-- user (`user_id`) or an account-less typed name (`user_id` null, the 0143
-- linked-or-typed idiom) so a tournament can include people not on the app. The
-- creator is inserted as the first `host`; hosts can manage/score/invite.
create table if not exists public.private_activity_members (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.private_activities (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  name        text not null,
  role        text not null default 'player' check (role in ('host', 'player')),
  rsvp        text check (rsvp in ('going', 'maybe', 'out')),
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists private_activity_members_uniq
  on public.private_activity_members (activity_id, user_id) where user_id is not null;
create index if not exists private_activity_members_activity_idx on public.private_activity_members (activity_id);
create index if not exists private_activity_members_user_idx on public.private_activity_members (user_id);

-- ── Membership predicates (SECURITY DEFINER, the houses/cabin-approver pattern) ─

-- A member of a private activity = its creator, an app admin, or anyone on its
-- roster. Definer so it can read the tables regardless of the caller's RLS (no
-- recursion — the definer bypass means the SELECT policies below don't re-enter).
create or replace function public.is_private_activity_member(p_activity uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.private_activities a
    where a.id = p_activity and (
      a.created_by = auth.uid()
      or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin)
      or exists (
        select 1 from public.private_activity_members m
        where m.activity_id = p_activity and m.user_id = auth.uid()
      )
    )
  );
$$;
revoke all on function public.is_private_activity_member(uuid) from public, anon;
grant execute on function public.is_private_activity_member(uuid) to authenticated;

-- A host can edit the activity, manage the roster, and run its tournament.
create or replace function public.is_private_activity_host(p_activity uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.private_activities a
    where a.id = p_activity and (
      a.created_by = auth.uid()
      or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin)
      or exists (
        select 1 from public.private_activity_members m
        where m.activity_id = p_activity and m.user_id = auth.uid() and m.role = 'host'
      )
    )
  );
$$;
revoke all on function public.is_private_activity_host(uuid) from public, anon;
grant execute on function public.is_private_activity_host(uuid) to authenticated;

-- ── RLS: members-only reads; all writes via SECURITY DEFINER RPCs ────────────

alter table public.private_activities        enable row level security;
alter table public.private_activity_members  enable row level security;

drop policy if exists "private_activities: member read" on public.private_activities;
create policy "private_activities: member read" on public.private_activities
  for select using (public.is_private_activity_member(id));

drop policy if exists "private_activity_members: member read" on public.private_activity_members;
create policy "private_activity_members: member read" on public.private_activity_members
  for select using (public.is_private_activity_member(activity_id));

-- updated_at (reuse the shared trigger fn from 0035).
drop trigger if exists private_activities_set_updated_at on public.private_activities;
create trigger private_activities_set_updated_at before update on public.private_activities
  for each row execute function public.set_updated_at();

-- Realtime.
alter table public.private_activities       replica identity full;
alter table public.private_activity_members replica identity full;
do $$ begin alter publication supabase_realtime add table public.private_activities;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.private_activity_members; exception when duplicate_object then null; end $$;

-- ── Make `tournaments` polymorphic: fest activity OR private activity ────────

alter table public.tournaments alter column schedule_item_id drop not null;
alter table public.tournaments
  add column if not exists private_activity_id uuid references public.private_activities (id) on delete cascade;
do $$ begin
  alter table public.tournaments add constraint tournaments_one_host
    check (num_nonnulls(schedule_item_id, private_activity_id) = 1);
exception when duplicate_object then null; end $$;
create index if not exists tournaments_private_activity_idx on public.tournaments (private_activity_id);

-- The manager gate now branches on which host the tournament hangs off.
create or replace function public.is_tournament_manager(p_tournament uuid)
returns boolean language plpgsql security definer stable set search_path = '' as $$
declare v_item uuid; v_act uuid;
begin
  select schedule_item_id, private_activity_id into v_item, v_act
    from public.tournaments where id = p_tournament;
  if v_item is not null then return public._can_manage_item_signups(v_item); end if;
  if v_act is not null then return public.is_private_activity_host(v_act); end if;
  return false;
end;
$$;
revoke all on function public.is_tournament_manager(uuid) from public, anon;
grant execute on function public.is_tournament_manager(uuid) to authenticated;

-- Tighten the tournament read policies: a fest tournament stays members-only (as
-- before), but a private-activity tournament is visible ONLY to that activity's
-- members — so a private bracket/scores can't be read by the whole family.
drop policy if exists "tournaments: member read" on public.tournaments;
create policy "tournaments: member read" on public.tournaments for select using (
  auth.uid() is not null
  and (private_activity_id is null or public.is_private_activity_member(private_activity_id))
);
drop policy if exists "tournament_entrants: member read" on public.tournament_entrants;
create policy "tournament_entrants: member read" on public.tournament_entrants for select using (
  auth.uid() is not null and exists (
    select 1 from public.tournaments t
    where t.id = tournament_entrants.tournament_id
      and (t.private_activity_id is null or public.is_private_activity_member(t.private_activity_id))
  )
);
drop policy if exists "tournament_participants: member read" on public.tournament_participants;
create policy "tournament_participants: member read" on public.tournament_participants for select using (
  auth.uid() is not null and exists (
    select 1 from public.tournaments t
    where t.id = tournament_participants.tournament_id
      and (t.private_activity_id is null or public.is_private_activity_member(t.private_activity_id))
  )
);
drop policy if exists "tournament_matches: member read" on public.tournament_matches;
create policy "tournament_matches: member read" on public.tournament_matches for select using (
  auth.uid() is not null and exists (
    select 1 from public.tournaments t
    where t.id = tournament_matches.tournament_id
      and (t.private_activity_id is null or public.is_private_activity_member(t.private_activity_id))
  )
);

-- The tournament notification deep-link now resolves to the right home page:
-- the fest activity detail, or the Events tab with the private activity open.
create or replace function public._tournament_deep_link(p_t uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when t.schedule_item_id is not null then '/family-fest/schedule/' || t.schedule_item_id::text
    when t.private_activity_id is not null then '/events?activity=' || t.private_activity_id::text
    else '/events'
  end
  from public.tournaments t where t.id = p_t;
$$;
revoke all on function public._tournament_deep_link(uuid) from public, anon, authenticated;

create or replace function public._notify_tournament_all(
  p_t uuid, p_type text, p_title text, p_body text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; rec record;
begin
  v_url := public._tournament_deep_link(p_t);
  for rec in
    select distinct pp.user_id
    from public.tournament_participants pp
    where pp.tournament_id = p_t and pp.user_id is not null
  loop
    perform public._notify(rec.user_id, p_type, auth.uid(), p_title, p_body, v_url, 'tournament', p_t, null);
  end loop;
end;
$$;
revoke all on function public._notify_tournament_all(uuid, text, text, text) from public, anon, authenticated;

create or replace function public._notify_tournament_match(
  p_match uuid, p_type text, p_title text, p_body text
) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tournament_matches; v_url text; rec record;
begin
  select * into m from public.tournament_matches where id = p_match;
  if not found then return; end if;
  v_url := public._tournament_deep_link(m.tournament_id);
  for rec in
    select distinct pp.user_id
    from public.tournament_participants pp
    where pp.user_id is not null
      and pp.entrant_id in (m.slot1_entrant_id, m.slot2_entrant_id)
  loop
    perform public._notify(rec.user_id, p_type, auth.uid(), p_title, p_body, v_url, 'tournament', m.tournament_id, null);
  end loop;
end;
$$;
revoke all on function public._notify_tournament_match(uuid, text, text, text) from public, anon, authenticated;

-- ── Invite notification (the ONLY notification a private activity ever sends,
--    and only when the organizer opts in — always just to the people involved) ─

create or replace function public._notify_private_activity_invite(
  p_activity uuid, p_only_user uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_title text; v_emoji text; v_by text; v_url text; rec record;
begin
  select title, emoji into v_title, v_emoji from public.private_activities where id = p_activity;
  v_url := '/events?activity=' || p_activity::text;
  select display_name into v_by from public.profiles where id = auth.uid();
  for rec in
    select m.user_id from public.private_activity_members m
    where m.activity_id = p_activity and m.user_id is not null and m.user_id <> auth.uid()
      and (p_only_user is null or m.user_id = p_only_user)
  loop
    perform public._notify(
      rec.user_id, 'private_activity_invite', auth.uid(),
      coalesce(nullif(v_emoji, '') || ' ', '') || coalesce(nullif(v_title, ''), 'An activity'),
      coalesce(nullif(v_by, ''), 'Someone') || ' invited you to join',
      v_url, 'private_activity', p_activity, null);
  end loop;
end;
$$;
revoke all on function public._notify_private_activity_invite(uuid, uuid) from public, anon, authenticated;

-- ── Lifecycle RPCs (any signed-in member creates; hosts manage) ──────────────

create or replace function public.create_private_activity(
  p_title              text,
  p_emoji              text        default null,
  p_description        text        default null,
  p_location           text        default null,
  p_starts_at          timestamptz default null,
  p_ends_at            timestamptz default null,
  p_tournament_enabled boolean     default false,
  p_members            jsonb       default null,   -- [{user_id?:uuid, name?:text}, …]
  p_notify             boolean     default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text; v_me uuid := auth.uid(); v_my_name text;
        v_member jsonb; v_uid uuid; v_name text;
begin
  if v_me is null then raise exception 'Sign in required'; end if;
  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  select display_name into v_my_name from public.profiles where id = v_me;

  insert into public.private_activities
    (title, emoji, description, location, starts_at, ends_at, tournament_enabled, created_by)
  values
    (v_title, nullif(btrim(coalesce(p_emoji, '')), ''), nullif(btrim(coalesce(p_description, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''), p_starts_at, p_ends_at, coalesce(p_tournament_enabled, false), v_me)
  returning id into v_id;

  -- The creator is the first host, RSVP'd going.
  insert into public.private_activity_members (activity_id, user_id, name, role, rsvp, added_by)
  values (v_id, v_me, coalesce(nullif(btrim(coalesce(v_my_name, '')), ''), 'Me'), 'host', 'going', v_me);

  -- Everyone else they invited (linked members or typed-in names).
  if p_members is not null and jsonb_typeof(p_members) = 'array' then
    for v_member in select * from jsonb_array_elements(p_members) loop
      v_uid := nullif(v_member->>'user_id', '')::uuid;
      if v_uid = v_me then continue; end if;              -- creator already added
      if v_uid is not null then
        select display_name into v_name from public.profiles where id = v_uid;
      else
        v_name := btrim(coalesce(v_member->>'name', ''));
      end if;
      if v_uid is null and coalesce(v_name, '') = '' then continue; end if;
      insert into public.private_activity_members (activity_id, user_id, name, role, added_by)
      values (v_id, v_uid, coalesce(nullif(btrim(coalesce(v_name, '')), ''), 'Guest'), 'player', v_me)
      on conflict (activity_id, user_id) where user_id is not null do nothing;
    end loop;
  end if;

  if coalesce(p_notify, false) then perform public._notify_private_activity_invite(v_id, null); end if;
  return v_id;
end;
$$;
revoke all on function public.create_private_activity(text, text, text, text, timestamptz, timestamptz, boolean, jsonb, boolean) from public, anon;
grant execute on function public.create_private_activity(text, text, text, text, timestamptz, timestamptz, boolean, jsonb, boolean) to authenticated;

create or replace function public.update_private_activity(
  p_activity           uuid,
  p_title              text        default null,
  p_emoji              text        default null,
  p_description        text        default null,
  p_location           text        default null,
  p_starts_at          timestamptz default null,
  p_ends_at            timestamptz default null,
  p_tournament_enabled boolean     default null,
  p_clear_start        boolean     default false   -- explicit "make it TBD"
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;
  update public.private_activities set
    title              = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
    emoji              = coalesce(p_emoji, emoji),
    description        = coalesce(p_description, description),
    location           = coalesce(p_location, location),
    starts_at          = case when p_clear_start then null else coalesce(p_starts_at, starts_at) end,
    ends_at            = case when p_clear_start then null else coalesce(p_ends_at, ends_at) end,
    tournament_enabled = coalesce(p_tournament_enabled, tournament_enabled)
  where id = p_activity;
end;
$$;
revoke all on function public.update_private_activity(uuid, text, text, text, text, timestamptz, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.update_private_activity(uuid, text, text, text, text, timestamptz, timestamptz, boolean, boolean) to authenticated;

create or replace function public.delete_private_activity(p_activity uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;
  delete from public.private_activities where id = p_activity;   -- cascades to members + tournament
end;
$$;
revoke all on function public.delete_private_activity(uuid) from public, anon;
grant execute on function public.delete_private_activity(uuid) to authenticated;

-- Archive a finished game (tuck it out of the active list without deleting it) —
-- or un-archive. Deleting is still available separately for a full wipe.
create or replace function public.set_private_activity_archived(p_activity uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;
  update public.private_activities
    set archived_at = case when coalesce(p_archived, true) then now() else null end
    where id = p_activity;
end;
$$;
revoke all on function public.set_private_activity_archived(uuid, boolean) from public, anon;
grant execute on function public.set_private_activity_archived(uuid, boolean) to authenticated;

-- ── Roster RPCs ──────────────────────────────────────────────────────────────

create or replace function public.add_private_activity_member(
  p_activity uuid,
  p_user_id  uuid    default null,
  p_name     text    default null,
  p_role     text    default 'player',
  p_notify   boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text; v_uid uuid; v_id uuid; v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;
  v_role := case when p_role = 'host' then 'host' else 'player' end;
  if p_user_id is not null then
    select display_name into v_name from public.profiles where id = p_user_id;
    if v_name is null then raise exception 'Member not found'; end if;
    v_uid := p_user_id;
  else
    v_name := btrim(coalesce(p_name, ''));
    if v_name = '' then raise exception 'A name is required'; end if;
    v_uid := null;
  end if;
  insert into public.private_activity_members (activity_id, user_id, name, role, added_by)
  values (p_activity, v_uid, coalesce(nullif(btrim(coalesce(v_name, '')), ''), 'Guest'), v_role, auth.uid())
  on conflict (activity_id, user_id) where user_id is not null do nothing
  returning id into v_id;
  if v_id is not null and coalesce(p_notify, false) and v_uid is not null then
    perform public._notify_private_activity_invite(p_activity, v_uid);
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_private_activity_member(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.add_private_activity_member(uuid, uuid, text, text, boolean) to authenticated;

-- A host can remove anyone; a member can remove (i.e. leave) their own row. The
-- creator's own host row can't be removed (delete the activity instead).
create or replace function public.remove_private_activity_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_activity uuid; v_uid uuid; v_creator uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select m.activity_id, m.user_id into v_activity, v_uid
    from public.private_activity_members m where m.id = p_member;
  if v_activity is null then raise exception 'Not found'; end if;
  select created_by into v_creator from public.private_activities where id = v_activity;
  if v_uid is not null and v_uid = v_creator then raise exception 'The organizer can''t leave — delete the activity instead'; end if;
  if not (public.is_private_activity_host(v_activity) or (v_uid is not null and v_uid = auth.uid())) then
    raise exception 'Not authorized';
  end if;
  delete from public.private_activity_members where id = p_member;
end;
$$;
revoke all on function public.remove_private_activity_member(uuid) from public, anon;
grant execute on function public.remove_private_activity_member(uuid) to authenticated;

create or replace function public.set_private_activity_member_role(p_member uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_activity uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_role not in ('host', 'player') then raise exception 'Unknown role'; end if;
  select activity_id into v_activity from public.private_activity_members where id = p_member;
  if v_activity is null then raise exception 'Not found'; end if;
  if not public.is_private_activity_host(v_activity) then raise exception 'Not authorized'; end if;
  update public.private_activity_members set role = p_role where id = p_member;
end;
$$;
revoke all on function public.set_private_activity_member_role(uuid, text) from public, anon;
grant execute on function public.set_private_activity_member_role(uuid, text) to authenticated;

-- Any member sets their OWN going/maybe/out.
create or replace function public.set_private_activity_rsvp(p_activity uuid, p_rsvp text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_rsvp is not null and p_rsvp not in ('going', 'maybe', 'out') then raise exception 'Unknown RSVP'; end if;
  if not public.is_private_activity_member(p_activity) then raise exception 'Not authorized'; end if;
  update public.private_activity_members
    set rsvp = p_rsvp
    where activity_id = p_activity and user_id = auth.uid();
end;
$$;
revoke all on function public.set_private_activity_rsvp(uuid, text) from public, anon;
grant execute on function public.set_private_activity_rsvp(uuid, text) to authenticated;

-- ── Tournament on a private activity ─────────────────────────────────────────

create or replace function public.create_activity_tournament(
  p_activity     uuid,
  p_title        text,
  p_format       text default 'single_elim',
  p_entrant_type text default 'individual',
  p_team_size    int  default null,
  p_bye_strategy text default 'byes'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_private_activity_host(p_activity) then raise exception 'Not authorized'; end if;
  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if p_format not in ('single_elim', 'round_robin', 'pools_bracket') then raise exception 'Unknown format'; end if;
  if p_entrant_type not in ('individual', 'team') then raise exception 'Unknown entrant type'; end if;
  if p_bye_strategy not in ('byes', 'play_in') then raise exception 'Unknown bye strategy'; end if;

  update public.private_activities set tournament_enabled = true where id = p_activity;

  insert into public.tournaments (private_activity_id, title, format, entrant_type, team_size, bye_strategy, created_by)
  values (p_activity, v_title, p_format,
          p_entrant_type,
          case when p_entrant_type = 'team' then greatest(coalesce(p_team_size, 2), 2) else null end,
          p_bye_strategy, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_activity_tournament(uuid, text, text, text, int, text) from public, anon;
grant execute on function public.create_activity_tournament(uuid, text, text, text, int, text) to authenticated;

-- Seed the tournament's pool from the private activity's roster (the analogue of
-- import_entrants_from_signups). Individuals → pool (generate_bracket makes one
-- solo entrant each); a team tournament then uses generate_teams to pair them.
create or replace function public.import_entrants_from_activity_members(p_tournament uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_count int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.private_activity_id is null then raise exception 'Not a private-activity tournament'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket before re-importing'; end if;

  delete from public.tournament_participants where tournament_id = p_tournament;
  delete from public.tournament_entrants where tournament_id = p_tournament;

  insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
  select p_tournament, null, m.user_id, m.name, row_number() over (order by m.created_at)
  from public.private_activity_members m
  where m.activity_id = v_t.private_activity_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.import_entrants_from_activity_members(uuid) from public, anon;
grant execute on function public.import_entrants_from_activity_members(uuid) to authenticated;

-- ── The new notification kind, on by default (in-app); push stays opt-in ─────

alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder,tournament_published,tournament_match_ready,tournament_champion,chat_poll_created,private_activity_invite}';
update public.profiles set notif_types = array_append(notif_types, 'private_activity_invite')
  where not ('private_activity_invite' = any(notif_types));
