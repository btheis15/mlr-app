-- 0148_tournament_match_scheduling.sql
-- Schedule tournament matches + push players about their matchup:
--   • schedule_match  — set a match's time + reminder lead-times (manager).
--   • notify_match    — send an immediate "you're up next / heads up" push now.
--   • run_tournament_match_reminders — a pg_cron tick that fires the timed
--     reminders ("your matchup … is in 15 minutes") for scheduled matches, like
--     run_signup_reminders (0140).
--
-- Each push is personalized per side ("against {the OTHER team}") and rides the
-- existing `tournament_match_ready` notif kind (already default-on + pushable),
-- so no new preference is introduced. Times are Central (America/Chicago).
-- Reads use tournament_matches(*), so these columns are additive-safe.
--
-- Apply in the Supabase SQL editor after 0147.

alter table public.tournament_matches
  add column if not exists scheduled_at     timestamptz,
  add column if not exists reminder_minutes int[] not null default '{}';

-- Ledger of which (match, lead-time) reminders already fired — owner-only.
create table if not exists public.tournament_match_reminders_sent (
  match_id uuid not null,
  minutes  int  not null,
  sent_at  timestamptz not null default now(),
  primary key (match_id, minutes)
);
alter table public.tournament_match_reminders_sent enable row level security;

-- ── Per-side matchup push ("against {the other team} {when}") ────────────────
-- p_when is the trailing phrase, e.g. 'is up next!' or 'is in 15 minutes'. Each
-- side hears the OTHER entrant's name. App-user players only (typed-in names have
-- no account to notify). Owner-only; called by the RPCs + cron below.
create or replace function public._notify_match_matchup(p_match uuid, p_when text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.tournament_matches; v_item uuid; v_url text; n1 text; n2 text; rec record;
begin
  select * into m from public.tournament_matches where id = p_match;
  if not found or m.slot1_entrant_id is null or m.slot2_entrant_id is null then return; end if;
  select display_name into n1 from public.tournament_entrants where id = m.slot1_entrant_id;
  select display_name into n2 from public.tournament_entrants where id = m.slot2_entrant_id;
  select schedule_item_id into v_item from public.tournaments where id = m.tournament_id;
  v_url := '/family-fest/schedule/' || v_item::text;
  for rec in
    select distinct pp.user_id, pp.entrant_id
    from public.tournament_participants pp
    where pp.user_id is not null and pp.entrant_id in (m.slot1_entrant_id, m.slot2_entrant_id)
  loop
    perform public._notify(
      rec.user_id, 'tournament_match_ready', auth.uid(),
      '🏆 You''re up',
      'Your matchup against ' || (case when rec.entrant_id = m.slot1_entrant_id then n2 else n1 end) || ' ' || p_when,
      v_url, 'tournament', m.tournament_id, null);
  end loop;
end;
$$;
revoke all on function public._notify_match_matchup(uuid, text) from public, anon, authenticated;

-- ── Set / clear a match's schedule + reminder lead-times (manager) ───────────
create or replace function public.schedule_match(
  p_match uuid, p_at timestamptz default null, p_reminders int[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select tournament_id into v_t from public.tournament_matches where id = p_match;
  if v_t is null then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(v_t) then raise exception 'Not authorized'; end if;
  update public.tournament_matches
    set scheduled_at = p_at, reminder_minutes = coalesce(p_reminders, '{}')
    where id = p_match;
  -- (Re)scheduling resets the fired-reminder ledger so the new time re-arms them.
  delete from public.tournament_match_reminders_sent where match_id = p_match;
end;
$$;
revoke all on function public.schedule_match(uuid, timestamptz, int[]) from public, anon;
grant execute on function public.schedule_match(uuid, timestamptz, int[]) to authenticated;

-- ── Send an immediate matchup push (manager) ─────────────────────────────────
-- p_when defaults to "is up next!"; pass e.g. 'is in about 15 minutes' for a
-- heads-up without committing to a scheduled time.
create or replace function public.notify_match(p_match uuid, p_when text default 'is up next!')
returns void language plpgsql security definer set search_path = '' as $$
declare v_t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select tournament_id into v_t from public.tournament_matches where id = p_match;
  if v_t is null then raise exception 'Match not found'; end if;
  if not public.is_tournament_manager(v_t) then raise exception 'Not authorized'; end if;
  perform public._notify_match_matchup(p_match, coalesce(nullif(btrim(p_when), ''), 'is up next!'));
end;
$$;
revoke all on function public.notify_match(uuid, text) from public, anon;
grant execute on function public.notify_match(uuid, text) to authenticated;

-- ── pg_cron tick: fire timed reminders for scheduled matches ─────────────────
create or replace function public.run_tournament_match_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; m int; v_when text;
begin
  for r in
    select id, scheduled_at, reminder_minutes
    from public.tournament_matches
    where scheduled_at is not null
      and status <> 'complete'
      and slot1_entrant_id is not null and slot2_entrant_id is not null
      and array_length(reminder_minutes, 1) > 0
      and scheduled_at > now() - interval '2 hours'  -- ignore long-past matches
  loop
    foreach m in array r.reminder_minutes loop
      if now() >= r.scheduled_at - make_interval(mins => m)
         and not exists (
           select 1 from public.tournament_match_reminders_sent x
           where x.match_id = r.id and x.minutes = m
         )
      then
        begin
          v_when := case when m <= 0 then 'is starting now' else 'is ' || public._humanize_minutes(m) end;
          perform public._notify_match_matchup(r.id, v_when);
          insert into public.tournament_match_reminders_sent (match_id, minutes)
          values (r.id, m) on conflict do nothing;
        exception when others then
          continue; -- a bad row shouldn't sink the batch
        end;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_tournament_match_reminders() from public, anon, authenticated;

select cron.schedule('run-tournament-match-reminders', '* * * * *', $$select public.run_tournament_match_reminders();$$);
