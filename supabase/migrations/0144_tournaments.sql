-- 0144_tournaments.sql
-- Tournament brackets for activities (cornhole, ping-pong, horseshoes, …).
--
-- A tournament rides ON TOP OF the existing activity sign-up system: it attaches
-- to a fest_schedule_items row (the activity) and draws its entrants from that
-- item's fest_schedule_signups (individual OR fixed-size teams, migration 0143).
-- Its organizer is whoever can already manage that activity's sign-ups
-- (_can_manage_item_signups: admin OR Family Fest committee OR the item's
-- lead/crew, migrations 0110/0136) — no new organizer role. Any signed-in member
-- can WATCH the live bracket; only a manager can seed, arrange, and score it.
--
-- Doctrine (mirrors polls 0084 + signups 0143 + meetings 0116): members-only
-- reads (the 0081 lockdown — bracket state is member activity), ALL writes through
-- SECURITY DEFINER RPCs, realtime on every table.
--
-- The schema is designed ONCE to serve all three planned formats
-- (single_elim / round_robin / pools_bracket). THIS migration implements the
-- single-elimination RPCs (Phase A); round-robin + pools→bracket generation land
-- in later migrations against the same tables.
--
-- Apply in the Supabase SQL editor after 0143.

-- ── Tables ───────────────────────────────────────────────────────────────────

-- One tournament per (usually) activity. schedule_item_id is a real uuid FK —
-- unlike events (0034, which carry seed slugs), a schedule item is always a DB
-- row, so we get a clean cascade delete.
create table if not exists public.tournaments (
  id                 uuid primary key default gen_random_uuid(),
  schedule_item_id   uuid not null references public.fest_schedule_items (id) on delete cascade,
  title              text not null,
  format             text not null default 'single_elim'
                       check (format in ('single_elim', 'round_robin', 'pools_bracket')),
  entrant_type       text not null default 'individual'
                       check (entrant_type in ('individual', 'team')),
  team_size          int,                         -- null/1 = individual; e.g. 2 = doubles
  bye_strategy       text not null default 'byes'
                       check (bye_strategy in ('byes', 'play_in')),
  pool_count         int,                         -- pools_bracket: number of groups
  advance_per_pool   int,                         -- pools_bracket: top-N advance to the knockout
  tiebreakers        text[] not null default '{win_pct,head_to_head,point_diff,points_for}',
  target_score       int,                         -- optional (e.g. cornhole to 21) — display hint
  win_by             int,                         -- optional (e.g. win by 2)
  allow_ties         boolean not null default false,
  status             text not null default 'setup'
                       check (status in ('setup', 'live', 'complete')),
  created_by         uuid references public.profiles (id) on delete set null,
  winner_entrant_id  uuid,                         -- deferred FK (added after entrants exists)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists tournaments_item_idx on public.tournaments (schedule_item_id);

-- A bracket unit: a solo player OR a team. `seed` is null until the bracket is
-- generated. `pool` groups entrants for round_robin/pools formats (null = the one
-- implicit pool). `signup_team_id` remembers which fest_schedule_signups team it
-- was imported from.
create table if not exists public.tournament_entrants (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  seed           int,
  display_name   text not null,                   -- person's name, team_name, or "Alice & Bob"
  team_name      text,
  pool           text,                            -- 'A'/'B'/… (pools formats); null otherwise
  signup_team_id uuid,                            -- back-link to fest_schedule_signups.team_id
  position       int not null default 0,          -- stable entry order (tiebreak)
  withdrawn_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists tournament_entrants_t_idx on public.tournament_entrants (tournament_id);
create index if not exists tournament_entrants_seed_idx on public.tournament_entrants (tournament_id, seed);

-- The people. entrant_id NULL = a sign-up sitting in the pre-team POOL; non-null =
-- a member of that entrant. Linked-or-typed idiom from fest_schedule_signups: a
-- linked app user (user_id + snapshot name) OR an account-less typed name
-- (user_id null). on delete set null keeps the snapshot if a member deletes their
-- account, so the bracket is never disturbed.
create table if not exists public.tournament_participants (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  entrant_id    uuid references public.tournament_entrants (id) on delete set null,
  user_id       uuid references public.profiles (id) on delete set null,
  name          text not null,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists tournament_participants_t_idx on public.tournament_participants (tournament_id);
create index if not exists tournament_participants_e_idx on public.tournament_participants (entrant_id);
-- One app user can't be entered twice; typed names aren't deduped (two "John"s ok).
create unique index if not exists tournament_participants_uniq_user
  on public.tournament_participants (tournament_id, user_id) where user_id is not null;

-- The bracket graph AND round-robin/pool games. For single_elim, matches are wired
-- by next_match_id/next_slot; for round_robin/pool the pointer is null and matches
-- are grouped by round (round-robin) / pool. A bye = a round-1 match with one null
-- slot, auto-completed at generation.
create table if not exists public.tournament_matches (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references public.tournaments (id) on delete cascade,
  stage             text not null default 'bracket' check (stage in ('pool', 'bracket')),
  pool              text,
  round             int not null,                  -- 0 = play-in; 1 = first main round …
  position          int not null,                  -- 0-based within the round
  slot1_entrant_id  uuid references public.tournament_entrants (id) on delete set null,
  slot2_entrant_id  uuid references public.tournament_entrants (id) on delete set null,
  slot1_score       int,
  slot2_score       int,
  winner_entrant_id uuid references public.tournament_entrants (id) on delete set null,
  next_match_id     uuid references public.tournament_matches (id) on delete set null,
  next_slot         int check (next_slot in (1, 2)),
  is_play_in        boolean not null default false,
  ready_notified    boolean not null default false, -- guards the match-ready push from double-firing
  status            text not null default 'pending'
                      check (status in ('pending', 'ready', 'in_progress', 'complete')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists tournament_matches_t_idx on public.tournament_matches (tournament_id);
create index if not exists tournament_matches_next_idx on public.tournament_matches (next_match_id);
create unique index if not exists tournament_matches_slot_uniq
  on public.tournament_matches (tournament_id, stage, coalesce(pool, ''), round, position);

-- Deferred FK: winner points at an entrant (both tables now exist).
do $$ begin
  alter table public.tournaments
    add constraint tournaments_winner_fk
    foreign key (winner_entrant_id) references public.tournament_entrants (id) on delete set null;
exception when duplicate_object then null; end $$;

-- updated_at triggers (reuse the shared set_updated_at() from 0035).
drop trigger if exists tournaments_set_updated_at on public.tournaments;
create trigger tournaments_set_updated_at before update on public.tournaments
  for each row execute function public.set_updated_at();
drop trigger if exists tournament_matches_set_updated_at on public.tournament_matches;
create trigger tournament_matches_set_updated_at before update on public.tournament_matches
  for each row execute function public.set_updated_at();

-- ── RLS: members-only reads; no client writes (RPCs only) ────────────────────

alter table public.tournaments             enable row level security;
alter table public.tournament_entrants     enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.tournament_matches      enable row level security;

drop policy if exists "tournaments: member read" on public.tournaments;
create policy "tournaments: member read" on public.tournaments for select using (auth.uid() is not null);
drop policy if exists "tournament_entrants: member read" on public.tournament_entrants;
create policy "tournament_entrants: member read" on public.tournament_entrants for select using (auth.uid() is not null);
drop policy if exists "tournament_participants: member read" on public.tournament_participants;
create policy "tournament_participants: member read" on public.tournament_participants for select using (auth.uid() is not null);
drop policy if exists "tournament_matches: member read" on public.tournament_matches;
create policy "tournament_matches: member read" on public.tournament_matches for select using (auth.uid() is not null);

-- ── Authorization helper ─────────────────────────────────────────────────────
-- A tournament's manager = whoever can manage the parent activity's sign-ups
-- (admin OR Family Fest committee OR the item's lead/crew), the is_cabin_approver
-- precedent generalized. Resolves the item then defers to _can_manage_item_signups.
create or replace function public.is_tournament_manager(p_tournament uuid)
returns boolean language plpgsql security definer stable set search_path = '' as $$
declare v_item uuid;
begin
  select schedule_item_id into v_item from public.tournaments where id = p_tournament;
  if v_item is null then return false; end if;
  return public._can_manage_item_signups(v_item);
end;
$$;
revoke all on function public.is_tournament_manager(uuid) from public, anon;
grant execute on function public.is_tournament_manager(uuid) to authenticated;

-- ── Notification fan-out helpers (internal — owner-only, like _notify) ───────
-- Deep-link target is always the activity detail page.
create or replace function public._notify_tournament_all(
  p_t uuid, p_type text, p_title text, p_body text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_url text; rec record;
begin
  select schedule_item_id into v_item from public.tournaments where id = p_t;
  v_url := '/family-fest/schedule/' || v_item::text;
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
declare m public.tournament_matches; v_item uuid; v_url text; rec record;
begin
  select * into m from public.tournament_matches where id = p_match;
  if not found then return; end if;
  select schedule_item_id into v_item from public.tournaments where id = m.tournament_id;
  v_url := '/family-fest/schedule/' || v_item::text;
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

-- ── Pure bracket helper: standard fold-seed slot order for a size-B bracket ──
-- Returns an int[] of length p_size: entry p (1-based) = the seed number that
-- occupies slot p. Guarantees seed 1 meets the weakest, and 1 & 2 can only meet
-- in the final. Byes fall out of this naturally onto the top seeds.
create or replace function public._tournament_seed_order(p_size int)
returns int[] language plpgsql immutable set search_path = '' as $$
declare arr int[] := array[1, 2]; sz int := 2; nw int[]; s int;
begin
  if p_size <= 1 then return array[1]; end if;
  while sz < p_size loop
    nw := '{}';
    foreach s in array arr loop
      nw := nw || s || (2 * sz + 1 - s);
    end loop;
    arr := nw; sz := sz * 2;
  end loop;
  return arr;
end;
$$;
revoke all on function public._tournament_seed_order(int) from public, anon, authenticated;

-- ── Winner-propagation cascade (internal) ────────────────────────────────────
-- Walk one step forward: put p_new into slot p_slot of the next match. If that
-- match was already decided, its result is now stale — CLEAR it (score/winner)
-- and recurse so every downstream result derived from the old winner is wiped.
create or replace function public._tournament_advance(
  p_next uuid, p_slot int, p_old uuid, p_new uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare d public.tournament_matches; v_old uuid;
begin
  if p_next is null or p_slot is null then return; end if;
  update public.tournament_matches
    set slot1_entrant_id = case when p_slot = 1 then p_new else slot1_entrant_id end,
        slot2_entrant_id = case when p_slot = 2 then p_new else slot2_entrant_id end
    where id = p_next;
  select * into d from public.tournament_matches where id = p_next;
  if not found then return; end if;

  if d.winner_entrant_id is not null then
    -- The slot composition changed under a decided match → its result is invalid.
    v_old := d.winner_entrant_id;
    update public.tournament_matches
      set winner_entrant_id = null, slot1_score = null, slot2_score = null,
          ready_notified = false,
          status = case when d.slot1_entrant_id is not null and d.slot2_entrant_id is not null
                        then 'ready' else 'pending' end
      where id = d.id;
    perform public._tournament_advance(d.next_match_id, d.next_slot, v_old, null);
  else
    update public.tournament_matches
      set status = case when d.slot1_entrant_id is not null and d.slot2_entrant_id is not null
                        then 'ready' else 'pending' end
      where id = d.id;
  end if;
end;
$$;
revoke all on function public._tournament_advance(uuid, int, uuid, uuid) from public, anon, authenticated;

-- ── Lifecycle / config RPCs ──────────────────────────────────────────────────

-- Create a tournament on an activity. Gated on managing THAT activity's sign-ups
-- (there's no tournament yet to authorize against — same reasoning as create_cabin
-- being admin-checked directly).
create or replace function public.create_tournament(
  p_item         uuid,
  p_title        text,
  p_format       text default 'single_elim',
  p_entrant_type text default 'individual',
  p_team_size    int  default null,
  p_bye_strategy text default 'byes'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public._can_manage_item_signups(p_item) then raise exception 'Not authorized'; end if;
  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if p_format not in ('single_elim', 'round_robin', 'pools_bracket') then raise exception 'Unknown format'; end if;
  if p_entrant_type not in ('individual', 'team') then raise exception 'Unknown entrant type'; end if;
  if p_bye_strategy not in ('byes', 'play_in') then raise exception 'Unknown bye strategy'; end if;

  insert into public.tournaments (schedule_item_id, title, format, entrant_type, team_size, bye_strategy, created_by)
  values (p_item, v_title, p_format,
          p_entrant_type,
          case when p_entrant_type = 'team' then greatest(coalesce(p_team_size, 2), 2) else null end,
          p_bye_strategy, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_tournament(uuid, text, text, text, int, text) from public, anon;
grant execute on function public.create_tournament(uuid, text, text, text, int, text) to authenticated;

create or replace function public.update_tournament(
  p_tournament uuid,
  p_title text default null,
  p_bye_strategy text default null,
  p_allow_ties boolean default null,
  p_target_score int default null,
  p_win_by int default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;

  update public.tournaments set
    title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
    -- structural fields are frozen once live
    bye_strategy = case when v_t.status = 'setup' then coalesce(p_bye_strategy, bye_strategy) else bye_strategy end,
    allow_ties = coalesce(p_allow_ties, allow_ties),
    target_score = coalesce(p_target_score, target_score),
    win_by = coalesce(p_win_by, win_by)
  where id = p_tournament;
end;
$$;
revoke all on function public.update_tournament(uuid, text, text, boolean, int, int) from public, anon;
grant execute on function public.update_tournament(uuid, text, text, boolean, int, int) to authenticated;

create or replace function public.delete_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.tournaments where id = p_tournament) then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  delete from public.tournaments where id = p_tournament;
end;
$$;
revoke all on function public.delete_tournament(uuid) from public, anon;
grant execute on function public.delete_tournament(uuid) to authenticated;

-- ── Entrants / participants ──────────────────────────────────────────────────

-- Pull entrants from the activity's sign-ups. Replaces any current pool/entrants
-- (setup only). Team tournaments turn each fest_schedule_signups team_id group
-- into an entrant; loose sign-ups (and every individual-tournament sign-up) land
-- in the POOL (entrant_id null) for the organizer to seed or auto-team.
create or replace function public.import_entrants_from_signups(p_tournament uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_count int := 0; rec record; v_ent uuid; v_label text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket before re-importing'; end if;

  delete from public.tournament_participants where tournament_id = p_tournament;
  delete from public.tournament_entrants where tournament_id = p_tournament;

  if v_t.entrant_type = 'team' and coalesce(v_t.team_size, 1) > 1 then
    -- One entrant per fest_schedule_signups team_id group.
    for rec in
      select team_id,
             max(team_name) as team_name,
             string_agg(name, ' & ' order by created_at) as members,
             min(created_at) as first_at
      from public.fest_schedule_signups
      where schedule_item_id = v_t.schedule_item_id and team_id is not null
      group by team_id
    loop
      v_label := coalesce(nullif(btrim(coalesce(rec.team_name, '')), ''), rec.members, 'Team');
      insert into public.tournament_entrants (tournament_id, display_name, team_name, signup_team_id, position)
      values (p_tournament, v_label, nullif(btrim(coalesce(rec.team_name, '')), ''), rec.team_id, v_count)
      returning id into v_ent;
      insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
      select p_tournament, v_ent, s.user_id, s.name, row_number() over (order by s.created_at)
      from public.fest_schedule_signups s
      where s.schedule_item_id = v_t.schedule_item_id and s.team_id = rec.team_id;
      v_count := v_count + 1;
    end loop;
    -- Loose (un-teamed) sign-ups → pool.
    insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
    select p_tournament, null, s.user_id, s.name, row_number() over (order by s.created_at)
    from public.fest_schedule_signups s
    where s.schedule_item_id = v_t.schedule_item_id and s.team_id is null;
  else
    -- Individuals → pool (generate_bracket makes one solo entrant each).
    insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
    select p_tournament, null, s.user_id, s.name, row_number() over (order by s.created_at)
    from public.fest_schedule_signups s
    where s.schedule_item_id = v_t.schedule_item_id;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;
revoke all on function public.import_entrants_from_signups(uuid) from public, anon;
grant execute on function public.import_entrants_from_signups(uuid) to authenticated;

-- Add one person to the pool (typed name or a linked member).
create or replace function public.add_participant(
  p_tournament uuid, p_for_user uuid default null, p_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text; v_uid uuid; v_id uuid; v_pos int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if p_for_user is not null then
    select display_name into v_name from public.profiles where id = p_for_user;
    if v_name is null then raise exception 'Member not found'; end if;
    v_uid := p_for_user;
  else
    v_name := btrim(coalesce(p_name, ''));
    if v_name = '' then raise exception 'A name is required'; end if;
    v_uid := null;
  end if;
  select coalesce(max(position), -1) + 1 into v_pos from public.tournament_participants where tournament_id = p_tournament;
  insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
  values (p_tournament, null, v_uid, v_name, v_pos)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_participant(uuid, uuid, text) from public, anon;
grant execute on function public.add_participant(uuid, uuid, text) to authenticated;

create or replace function public.remove_participant(p_participant uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select tournament_id into v_t from public.tournament_participants where id = p_participant;
  if v_t is null then raise exception 'Not found'; end if;
  if not public.is_tournament_manager(v_t) then raise exception 'Not authorized'; end if;
  delete from public.tournament_participants where id = p_participant;
end;
$$;
revoke all on function public.remove_participant(uuid) from public, anon;
grant execute on function public.remove_participant(uuid) to authenticated;

-- Add an entrant by hand — the "already a team" path. p_members: jsonb array of
-- [{for_user:uuid|null, name:text|null}, …] (the 0143 shape).
create or replace function public.add_entrant(
  p_tournament uuid, p_team_name text default null, p_members jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_ent uuid; v_member jsonb; v_uid uuid; v_name text;
        v_names text[] := '{}'; v_label text; v_pos int; v_count int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;

  if p_members is null or jsonb_array_length(p_members) = 0 then raise exception 'Add at least one person'; end if;
  v_count := jsonb_array_length(p_members);
  if v_t.entrant_type = 'team' and v_count <> coalesce(v_t.team_size, 2) then
    raise exception 'A team needs exactly % people', coalesce(v_t.team_size, 2);
  end if;

  select coalesce(max(position), -1) + 1 into v_pos from public.tournament_entrants where tournament_id = p_tournament;
  insert into public.tournament_entrants (tournament_id, display_name, team_name, position)
  values (p_tournament, 'Entrant', nullif(btrim(coalesce(p_team_name, '')), ''), v_pos)
  returning id into v_ent;

  for v_member in select * from jsonb_array_elements(p_members) loop
    if (v_member->>'for_user') is not null then
      v_uid := (v_member->>'for_user')::uuid;
      select display_name into v_name from public.profiles where id = v_uid;
      if v_name is null then raise exception 'Member not found'; end if;
    else
      v_uid := null;
      v_name := btrim(coalesce(v_member->>'name', ''));
      if v_name = '' then raise exception 'A name is required'; end if;
    end if;
    v_names := v_names || v_name;
    insert into public.tournament_participants (tournament_id, entrant_id, user_id, name, position)
    values (p_tournament, v_ent, v_uid, v_name, coalesce(array_length(v_names, 1), 1) - 1);
  end loop;

  v_label := coalesce(nullif(btrim(coalesce(p_team_name, '')), ''), array_to_string(v_names, ' & '));
  update public.tournament_entrants set display_name = v_label where id = v_ent;
  return v_ent;
end;
$$;
revoke all on function public.add_entrant(uuid, text, jsonb) from public, anon;
grant execute on function public.add_entrant(uuid, text, jsonb) to authenticated;

-- Remove an entrant. Blocked once live (use reset_bracket to restructure). Its
-- members drop back to the pool so nobody is lost.
create or replace function public.remove_entrant(p_entrant uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_tid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select tournament_id into v_tid from public.tournament_entrants where id = p_entrant;
  if v_tid is null then raise exception 'Not found'; end if;
  select * into v_t from public.tournaments where id = v_tid;
  if not public.is_tournament_manager(v_tid) then raise exception 'Not authorized'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket to change entrants'; end if;
  update public.tournament_participants set entrant_id = null where entrant_id = p_entrant;
  delete from public.tournament_entrants where id = p_entrant;
end;
$$;
revoke all on function public.remove_entrant(uuid) from public, anon;
grant execute on function public.remove_entrant(uuid) to authenticated;

-- ── Team generation (individuals → random teams of team_size) ────────────────
create or replace function public.generate_teams(p_tournament uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments; v_size int; v_pool uuid[]; v_made int := 0; v_i int;
        v_ent uuid; v_names text[]; v_pos int; j int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket to re-make teams'; end if;
  if v_t.entrant_type <> 'team' or coalesce(v_t.team_size, 1) < 2 then
    raise exception 'This tournament isn''t set up for teams';
  end if;
  v_size := v_t.team_size;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament::text, 0));

  select array_agg(id order by random()) into v_pool
  from public.tournament_participants
  where tournament_id = p_tournament and entrant_id is null;

  select coalesce(max(position), -1) + 1 into v_pos from public.tournament_entrants where tournament_id = p_tournament;
  v_i := 1;
  while v_pool is not null and v_i + v_size - 1 <= array_length(v_pool, 1) loop
    insert into public.tournament_entrants (tournament_id, display_name, position)
    values (p_tournament, 'Team', v_pos) returning id into v_ent;
    for j in v_i .. v_i + v_size - 1 loop
      update public.tournament_participants set entrant_id = v_ent where id = v_pool[j];
    end loop;
    -- build the label from the members just assigned, in entry order
    select array_agg(name order by position) into v_names
      from public.tournament_participants where entrant_id = v_ent;
    update public.tournament_entrants set display_name = array_to_string(v_names, ' & ') where id = v_ent;
    v_made := v_made + 1; v_pos := v_pos + 1; v_i := v_i + v_size;
  end loop;

  return jsonb_build_object(
    'teams_created', v_made,
    'leftover', coalesce(array_length(v_pool, 1), 0) - (v_made * v_size)
  );
end;
$$;
revoke all on function public.generate_teams(uuid) from public, anon;
grant execute on function public.generate_teams(uuid) to authenticated;

-- Undo team generation (pre-bracket): return everyone to the pool, drop teams.
create or replace function public.ungroup_teams(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.status <> 'setup' then raise exception 'Reset the bracket first'; end if;
  update public.tournament_participants set entrant_id = null where tournament_id = p_tournament;
  delete from public.tournament_entrants where tournament_id = p_tournament;
end;
$$;
revoke all on function public.ungroup_teams(uuid) from public, anon;
grant execute on function public.ungroup_teams(uuid) to authenticated;

-- ── Single-elimination bracket generation ────────────────────────────────────
-- p_seed_order: entrant ids in seed order (1st = seed 1). Null ⇒ random seeding
-- (which naturally scatters the byes = "random byes").
create or replace function public.generate_bracket(p_tournament uuid, p_seed_order uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tournaments; v_n int; v_b int; v_r int; v_tmp int;
  v_order int[]; v_ent uuid[]; v_has_byes boolean;
  i int; cnt int; r int; s1 int; s2 int; e1 uuid; e2 uuid;
  m record; v_winner uuid; p record;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  if v_t.format <> 'single_elim' then raise exception 'Only single-elimination is supported yet'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament::text, 0));

  -- Individual format: make one solo entrant per pool participant.
  if v_t.entrant_type = 'individual' then
    for p in select * from public.tournament_participants
             where tournament_id = p_tournament and entrant_id is null loop
      insert into public.tournament_entrants (tournament_id, display_name, position)
      values (p_tournament, p.name, p.position) returning id into e1;
      update public.tournament_participants set entrant_id = e1 where id = p.id;
    end loop;
  end if;

  select count(*) into v_n from public.tournament_entrants
   where tournament_id = p_tournament and withdrawn_at is null;
  if v_n < 2 then raise exception 'Need at least two entrants to generate a bracket'; end if;

  -- Seed: explicit order, else random.
  if p_seed_order is not null and array_length(p_seed_order, 1) = v_n then
    for i in 1 .. v_n loop
      update public.tournament_entrants set seed = i
        where id = p_seed_order[i] and tournament_id = p_tournament;
    end loop;
  else
    with ord as (
      select id, row_number() over (order by random()) as rn
      from public.tournament_entrants where tournament_id = p_tournament and withdrawn_at is null
    )
    update public.tournament_entrants e set seed = ord.rn from ord where e.id = ord.id;
  end if;

  -- Bracket size B = next power of two ≥ N; rounds R = log2(B).
  v_b := 1; while v_b < v_n loop v_b := v_b * 2; end loop;
  v_r := 0; v_tmp := v_b; while v_tmp > 1 loop v_tmp := v_tmp / 2; v_r := v_r + 1; end loop;
  v_has_byes := (v_b > v_n);

  select array_agg(id order by seed) into v_ent
    from public.tournament_entrants where tournament_id = p_tournament and seed is not null;

  delete from public.tournament_matches where tournament_id = p_tournament;

  -- Create the match rows round by round (round r has B >> r matches).
  for r in 1 .. v_r loop
    cnt := v_b >> r;
    for i in 0 .. cnt - 1 loop
      insert into public.tournament_matches (tournament_id, stage, round, position, status)
      values (p_tournament, 'bracket', r, i, 'pending');
    end loop;
  end loop;

  -- Wire the progression pointers (child → parent).
  update public.tournament_matches child
    set next_match_id = parent.id,
        next_slot = case when child.position % 2 = 0 then 1 else 2 end
    from public.tournament_matches parent
    where child.tournament_id = p_tournament and parent.tournament_id = p_tournament
      and child.round < v_r and parent.round = child.round + 1
      and parent.position = child.position / 2;

  -- Seat round 1 by fold-seed order; phantom seeds (> N) are byes (null slot).
  v_order := public._tournament_seed_order(v_b);
  for i in 0 .. (v_b / 2) - 1 loop
    s1 := v_order[2 * i + 1];
    s2 := v_order[2 * i + 2];
    e1 := case when s1 <= v_n then v_ent[s1] end;
    e2 := case when s2 <= v_n then v_ent[s2] end;
    update public.tournament_matches
      set slot1_entrant_id = e1, slot2_entrant_id = e2,
          is_play_in = (v_t.bye_strategy = 'play_in' and v_has_byes and e1 is not null and e2 is not null),
          status = case when e1 is not null and e2 is not null then 'ready' else 'pending' end
      where tournament_id = p_tournament and round = 1 and position = i;
  end loop;

  -- Auto-resolve byes: a round-1 match with exactly one entrant advances it.
  for m in select * from public.tournament_matches
           where tournament_id = p_tournament and round = 1
             and ((slot1_entrant_id is null) <> (slot2_entrant_id is null)) loop
    v_winner := coalesce(m.slot1_entrant_id, m.slot2_entrant_id);
    update public.tournament_matches set winner_entrant_id = v_winner, status = 'complete' where id = m.id;
    perform public._tournament_advance(m.next_match_id, m.next_slot, null, v_winner);
  end loop;

  update public.tournaments set status = 'live', winner_entrant_id = null where id = p_tournament;
  perform public._notify_tournament_all(p_tournament, 'tournament_published',
    'Bracket is live: ' || v_t.title, 'The tournament bracket is set — good luck!');
end;
$$;
revoke all on function public.generate_bracket(uuid, uuid[]) from public, anon;
grant execute on function public.generate_bracket(uuid, uuid[]) to authenticated;

-- Re-open a tournament for restructuring: wipe matches + seeds, back to setup.
create or replace function public.reset_bracket(p_tournament uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.tournaments where id = p_tournament) then raise exception 'Tournament not found'; end if;
  if not public.is_tournament_manager(p_tournament) then raise exception 'Not authorized'; end if;
  delete from public.tournament_matches where tournament_id = p_tournament;
  update public.tournament_entrants set seed = null where tournament_id = p_tournament;
  update public.tournaments set status = 'setup', winner_entrant_id = null where id = p_tournament;
end;
$$;
revoke all on function public.reset_bracket(uuid) from public, anon;
grant execute on function public.reset_bracket(uuid) to authenticated;

-- ── Hand-placement / override ────────────────────────────────────────────────
-- Put an entrant (or clear, with null) into a specific match slot. If the match
-- was decided, the same cascade-clear as a result change runs.
create or replace function public.set_match_entrant(p_match uuid, p_slot int, p_entrant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.tournament_matches; v_old uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_slot not in (1, 2) then raise exception 'Invalid slot'; end if;
  select * into m from public.tournament_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(m.tournament_id) then raise exception 'Not authorized'; end if;
  if p_entrant_id is not null and not exists (
    select 1 from public.tournament_entrants where id = p_entrant_id and tournament_id = m.tournament_id
  ) then raise exception 'That entrant isn''t in this tournament'; end if;
  perform pg_advisory_xact_lock(hashtextextended(m.tournament_id::text, 0));

  v_old := m.winner_entrant_id;
  update public.tournament_matches
    set slot1_entrant_id = case when p_slot = 1 then p_entrant_id else slot1_entrant_id end,
        slot2_entrant_id = case when p_slot = 2 then p_entrant_id else slot2_entrant_id end,
        winner_entrant_id = null, slot1_score = null, slot2_score = null, ready_notified = false
    where id = p_match;
  select * into m from public.tournament_matches where id = p_match;
  update public.tournament_matches
    set status = case when m.slot1_entrant_id is not null and m.slot2_entrant_id is not null then 'ready' else 'pending' end
    where id = p_match;
  -- If this match had already been decided, its old winner no longer advances.
  if v_old is not null then
    perform public._tournament_advance(m.next_match_id, m.next_slot, v_old, null);
  end if;
end;
$$;
revoke all on function public.set_match_entrant(uuid, int, uuid) from public, anon;
grant execute on function public.set_match_entrant(uuid, int, uuid) to authenticated;

-- Swap the entrants occupying two slots (the common "move a seed" gesture).
create or replace function public.swap_match_entrants(
  p_match_a uuid, p_slot_a int, p_match_b uuid, p_slot_b int
) returns void language plpgsql security definer set search_path = '' as $$
declare a public.tournament_matches; b public.tournament_matches; ea uuid; eb uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_slot_a not in (1, 2) or p_slot_b not in (1, 2) then raise exception 'Invalid slot'; end if;
  select * into a from public.tournament_matches where id = p_match_a;
  select * into b from public.tournament_matches where id = p_match_b;
  if not found or a.id is null or b.id is null then raise exception 'Match not found'; end if;
  if a.tournament_id <> b.tournament_id then raise exception 'Matches must be in the same tournament'; end if;
  if not public.is_tournament_manager(a.tournament_id) then raise exception 'Not authorized'; end if;
  ea := case when p_slot_a = 1 then a.slot1_entrant_id else a.slot2_entrant_id end;
  eb := case when p_slot_b = 1 then b.slot1_entrant_id else b.slot2_entrant_id end;
  perform public.set_match_entrant(p_match_a, p_slot_a, eb);
  perform public.set_match_entrant(p_match_b, p_slot_b, ea);
end;
$$;
revoke all on function public.swap_match_entrants(uuid, int, uuid, int) from public, anon;
grant execute on function public.swap_match_entrants(uuid, int, uuid, int) to authenticated;

-- ── Record / clear results ───────────────────────────────────────────────────
-- Winner is the ONLY required input; scores are optional. A winner alone is a
-- complete result. If scores are given without a winner, higher score wins
-- (a tie must pass an explicit winner unless allow_ties). Propagates + cascades.
create or replace function public.record_match_result(
  p_match uuid, p_winner uuid default null, p_score1 int default null, p_score2 int default null
) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tournament_matches; v_t public.tournaments; v_winner uuid; v_old uuid; d public.tournament_matches;
        v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into m from public.tournament_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(m.tournament_id) then raise exception 'Not authorized'; end if;
  select * into v_t from public.tournaments where id = m.tournament_id;
  perform pg_advisory_xact_lock(hashtextextended(m.tournament_id::text, 0));

  if m.slot1_entrant_id is null or m.slot2_entrant_id is null then
    raise exception 'Both sides must be set before recording a result';
  end if;

  if p_winner is not null then
    if p_winner not in (m.slot1_entrant_id, m.slot2_entrant_id) then
      raise exception 'The winner must be one of the two entrants';
    end if;
    v_winner := p_winner;
  elsif p_score1 is not null and p_score2 is not null then
    if p_score1 = p_score2 then
      if not v_t.allow_ties then raise exception 'Pick a winner (the score is tied)'; end if;
      raise exception 'Pick a winner (the score is tied)';
    end if;
    v_winner := case when p_score1 > p_score2 then m.slot1_entrant_id else m.slot2_entrant_id end;
  else
    raise exception 'Pick a winner';
  end if;

  v_old := m.winner_entrant_id;
  update public.tournament_matches
    set slot1_score = p_score1, slot2_score = p_score2, winner_entrant_id = v_winner, status = 'complete'
    where id = m.id;

  if m.next_match_id is null then
    -- The final.
    update public.tournaments set winner_entrant_id = v_winner, status = 'complete' where id = m.tournament_id;
    select display_name into v_name from public.tournament_entrants where id = v_winner;
    perform public._notify_tournament_all(m.tournament_id, 'tournament_champion',
      '🏆 We have a champion!', coalesce(v_name, 'The winner') || ' won ' || v_t.title || '!');
  else
    if v_old is distinct from v_winner then
      perform public._tournament_advance(m.next_match_id, m.next_slot, v_old, v_winner);
    end if;
    -- Ping the next match's entrants once it's fully set (first time only).
    select * into d from public.tournament_matches where id = m.next_match_id;
    if d.status = 'ready' and not d.ready_notified then
      update public.tournament_matches set ready_notified = true where id = d.id;
      perform public._notify_tournament_match(d.id, 'tournament_match_ready',
        'Your next match is ready', 'Your next game is set — check the bracket.');
    end if;
  end if;
end;
$$;
revoke all on function public.record_match_result(uuid, uuid, int, int) from public, anon;
grant execute on function public.record_match_result(uuid, uuid, int, int) to authenticated;

create or replace function public.clear_match_result(p_match uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.tournament_matches;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into m from public.tournament_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(m.tournament_id) then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(m.tournament_id::text, 0));

  update public.tournament_matches
    set winner_entrant_id = null, slot1_score = null, slot2_score = null, ready_notified = false,
        status = case when m.slot1_entrant_id is not null and m.slot2_entrant_id is not null then 'ready' else 'pending' end
    where id = m.id;
  if m.winner_entrant_id is not null then
    perform public._tournament_advance(m.next_match_id, m.next_slot, m.winner_entrant_id, null);
  end if;
  -- If this was the final, the tournament is no longer complete.
  update public.tournaments set status = 'live', winner_entrant_id = null
    where id = m.tournament_id and m.next_match_id is null;
end;
$$;
revoke all on function public.clear_match_result(uuid) from public, anon;
grant execute on function public.clear_match_result(uuid) to authenticated;

-- ── Notification kinds: default-on for members, opt-in push ──────────────────
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,cabin_message,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention,work_item_created,house_stay_created,meeting_proposed,meeting_scheduled,signup_reminder,tournament_published,tournament_match_ready,tournament_champion}';
update public.profiles set notif_types = notif_types || '{tournament_published,tournament_match_ready,tournament_champion}'
  where not ('tournament_published' = any(notif_types));

-- ── Realtime: live bracket for every watcher ─────────────────────────────────
alter table public.tournaments             replica identity full;
alter table public.tournament_entrants     replica identity full;
alter table public.tournament_participants replica identity full;
alter table public.tournament_matches      replica identity full;
do $$ begin alter publication supabase_realtime add table public.tournaments;             exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tournament_entrants;     exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tournament_participants; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tournament_matches;      exception when duplicate_object then null; end $$;
