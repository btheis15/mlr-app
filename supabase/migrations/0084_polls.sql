-- 0084_polls.sql
-- Family polls — one dead-simple voting tool for the questions the family
-- actually argues about (fest merch designs, meal choices, dates). A poll is a
-- question + 2–10 options; every member gets exactly ONE vote per poll (the
-- primary key on poll_votes enforces it) and can change it any time while the
-- poll is open. A poll closes when its creator/an admin closes it, or when its
-- optional closes_on date has passed (open THROUGH the closes-on day).
--
-- Unlike events (0034, admin-managed), ANY signed-in member can create a poll —
-- it's a family tool, not an admin broadcast. Closing/deleting stays with the
-- creator or an app admin.
--
-- All three tables are MEMBERS-ONLY reads (auth.uid() is not null — the 0081
-- lockdown doctrine, not public-read: votes are member activity, no reason for
-- a guest/scraper to see them). All writes go through SECURITY DEFINER RPCs so
-- authorization lives in one place, the same shape as events/attendance
-- (0034/0035). Apply in the Supabase SQL editor after the prior migrations.

create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  closes_on  date,                          -- null ⇒ open until closed by hand
  is_closed  boolean not null default false
);
create index if not exists polls_created_idx on public.polls (created_at desc);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls (id) on delete cascade,
  label    text not null,
  position int  not null default 0
);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id);

-- ONE vote per member per poll — the (poll_id, user_id) PK is the guarantee;
-- changing your vote is an upsert on that key (cast_poll_vote below).
create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

-- Members-only reads; no client writes at all (RPCs only).
drop policy if exists "polls: member read" on public.polls;
create policy "polls: member read" on public.polls
  for select using (auth.uid() is not null);

drop policy if exists "poll_options: member read" on public.poll_options;
create policy "poll_options: member read" on public.poll_options
  for select using (auth.uid() is not null);

drop policy if exists "poll_votes: member read" on public.poll_votes;
create policy "poll_votes: member read" on public.poll_votes
  for select using (auth.uid() is not null);

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- Create a poll — ANY signed-in member (family tool). Blank options are
-- dropped; what's left must be 2–10.
create or replace function public.create_poll(
  p_question  text,
  p_options   text[],
  p_closes_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_question text;
  v_labels   text[];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  v_question := btrim(coalesce(p_question, ''));
  if v_question = '' then raise exception 'A question is required'; end if;
  if length(v_question) > 300 then raise exception 'Keep the question under 300 characters'; end if;
  if p_closes_on is not null and p_closes_on < current_date then
    raise exception 'The close date can''t be in the past';
  end if;

  -- Trim, drop blanks, keep the composer's order.
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

  insert into public.polls (question, created_by, closes_on)
  values (v_question, auth.uid(), p_closes_on)
  returning id into v_id;

  insert into public.poll_options (poll_id, label, position)
  select v_id, l, ord
  from unnest(v_labels) with ordinality as t(l, ord);

  return v_id;
end;
$$;
revoke all on function public.create_poll(text, text[], date) from public, anon;
grant execute on function public.create_poll(text, text[], date) to authenticated;

-- Cast (or change) MY vote — upsert on the (poll_id, user_id) PK, so a member
-- can only ever hold one vote per poll. Rejected once the poll is closed
-- (is_closed, or its closes_on day has passed).
create or replace function public.cast_poll_vote(
  p_poll   uuid,
  p_option uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll public.polls%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into v_poll from public.polls where id = p_poll;
  if not found then raise exception 'Poll not found'; end if;
  if v_poll.is_closed or (v_poll.closes_on is not null and v_poll.closes_on < current_date) then
    raise exception 'This poll is closed';
  end if;
  if not exists (
    select 1 from public.poll_options o where o.id = p_option and o.poll_id = p_poll
  ) then
    raise exception 'That option isn''t part of this poll';
  end if;

  insert into public.poll_votes (poll_id, option_id, user_id)
  values (p_poll, p_option, auth.uid())
  on conflict (poll_id, user_id)
  do update set option_id = excluded.option_id, created_at = now();
end;
$$;
revoke all on function public.cast_poll_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_poll_vote(uuid, uuid) to authenticated;

-- Close a poll (freeze the results) — its creator or an app admin.
create or replace function public.close_poll(p_poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.polls where id = p_poll) then
    raise exception 'Poll not found';
  end if;
  if not exists (
    select 1 from public.polls pl
    where pl.id = p_poll
      and (pl.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then
    raise exception 'Not authorized';
  end if;
  update public.polls set is_closed = true where id = p_poll;
end;
$$;
revoke all on function public.close_poll(uuid) from public, anon;
grant execute on function public.close_poll(uuid) to authenticated;

-- Delete a poll (options + votes cascade) — its creator or an app admin.
create or replace function public.delete_poll(p_poll uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.polls where id = p_poll) then
    raise exception 'Poll not found';
  end if;
  if not exists (
    select 1 from public.polls pl
    where pl.id = p_poll
      and (pl.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then
    raise exception 'Not authorized';
  end if;
  delete from public.polls where id = p_poll;
end;
$$;
revoke all on function public.delete_poll(uuid) from public, anon;
grant execute on function public.delete_poll(uuid) to authenticated;

-- Live results — new polls appear and the % bars move as votes land (mirrors
-- events/event_attendance in 0034/0035). Options only change with their poll,
-- so polls + poll_votes are enough to know when to refetch.
alter table public.polls replica identity full;
do $$ begin alter publication supabase_realtime add table public.polls; exception when duplicate_object then null; end $$;
alter table public.poll_votes replica identity full;
do $$ begin alter publication supabase_realtime add table public.poll_votes; exception when duplicate_object then null; end $$;
