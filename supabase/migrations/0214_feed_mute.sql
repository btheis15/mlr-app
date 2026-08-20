-- 0214_feed_mute.sql
-- MUTE THE FAMILY FEED from the Feed list — the same bell, on the same row
-- style, with the same 1/3/7-day/permanent choices as every committee and house
-- chat next to it.
--
-- ── Why this needs a table at all ────────────────────────────────────────────
-- "Mute the Family Feed" already existed, but only buried in Profile →
-- Notifications as two independent checkbox-style prefs on `profiles`:
--   * notif_types  ∋ 'new_post'  → new posts land in your Activity tab (0029)
--   * push_types   ∋ 'new_post'  → new posts buzz your phone (0161)
-- Neither has any notion of an expiry, so neither can express "mute for 3
-- days" — the thing every other bell in that list offers. Rather than bolt an
-- expiry onto two array columns that are shared by ~40 other notification
-- categories, the feed gets its own mute row, exactly like the per-room mute
-- state on committee_area_reads / house_reads (0155).
--
-- ── Two controls, deliberately, and what each one means ──────────────────────
-- Per product decision, muting the feed silences the PUSH but leaves posts in
-- the Activity tab: "stop interrupting me" is not "hide things from me". So:
--   * the BELL (this table)      → "don't buzz my phone about new posts",
--                                  optionally only for a while.
--   * push_types ∋ 'new_post'    → "do I ever want this notification at all".
-- The bell is the timed, in-the-moment control; the settings toggle stays the
-- permanent category opt-out. A member with the category already off is simply
-- not pushed either way — the two compose as AND, and the bell never rewrites
-- the settings row behind the member's back.
-- The Activity-tab pref (notif_types) is untouched by the bell by design.
--
-- NAMING: `feed_mutes`, not `feed_reads`. The committee/house tables are
-- `*_reads` because they were born tracking last_read_at and only later grew
-- mute columns; the Family Feed has no unread state in this list (its row shows
-- no badge), so a `*_reads` name here would promise a column that isn't there.

create table if not exists public.feed_mutes (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  muted       boolean not null default false,
  -- Set only for a TIMED mute; a permanent mute leaves this null. See the
  -- "effectively muted" rule below — these two are never both set.
  muted_until timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.feed_mutes enable row level security;

-- You can read your own mute state and nothing else. No client writes — the
-- RPC below is the only writer, so "whose row is this" is decided in one place.
drop policy if exists "feed_mutes: own read" on public.feed_mutes;
create policy "feed_mutes: own read" on public.feed_mutes for select
  using (user_id = auth.uid());

drop trigger if exists feed_mutes_set_updated_at on public.feed_mutes;
create trigger feed_mutes_set_updated_at
  before update on public.feed_mutes
  for each row execute function public.set_updated_at();

-- ⚠️ 0213's guard does NOT reach a table created after it ran — its DO block
-- looped over the tables that existed at the time. Attach it explicitly, or an
-- unverified account could mute things while being unable to do anything else.
drop trigger if exists require_approved_member_trg on public.feed_mutes;
create trigger require_approved_member_trg
  before insert or update or delete on public.feed_mutes
  for each row execute function public.require_approved_member();

-- Mute / unmute the Family Feed. Mirrors set_house_mute (0155) — including the
-- muted / muted_until split fixed below: a duration writes ONLY muted_until so
-- it expires by going stale, a permanent mute writes ONLY muted.
create or replace function public.set_feed_mute(p_muted boolean, p_muted_until timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.feed_mutes (user_id, muted, muted_until)
  values (
    auth.uid(),
    p_muted and p_muted_until is null,
    case when p_muted then p_muted_until else null end
  )
  on conflict (user_id)
  do update set muted = excluded.muted, muted_until = excluded.muted_until;
$$;
revoke all on function public.set_feed_mute(boolean, timestamptz) from public, anon;
grant execute on function public.set_feed_mute(boolean, timestamptz) to authenticated;
