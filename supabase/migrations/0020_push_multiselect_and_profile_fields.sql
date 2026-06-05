-- 0020_push_multiselect_and_profile_fields.sql
-- Multi-select push prefs (replacing the single push_level), a gated self-notify
-- test flag, and two shared profile fields: birthday + address. Apply after 0019.

-- ── Multi-select push types ──────────────────────────────────────────────────
-- Any subset of {'chat','mentions','alerts','birthdays'}. Empty array = no push.
alter table public.profiles
  add column if not exists push_types text[] not null default '{}';

-- Backfill from the old single-value push_level (kept, unused, for one release).
-- 'birthdays' is a NEW category, so it starts OFF for everyone (opt-in via the UI).
update public.profiles
  set push_types = case push_level
    when 'all'      then array['chat','mentions','alerts']
    when 'mentions' then array['mentions','alerts']
    when 'alerts'   then array['alerts']
    else array[]::text[]
  end
  where push_types = '{}' and push_level is not null and push_level <> 'off';

-- ── Self-notify (testing only) ───────────────────────────────────────────────
-- When on, the sender ALSO notifies you of your OWN actions — but ONLY honored
-- for accounts listed in the mini's PUSH_SELF_NOTIFY_USER_IDS env. Setting it
-- has no effect for anyone not on that list (gated in the UI and the sender).
alter table public.profiles
  add column if not exists push_self_notify boolean not null default false;

-- ── Shared profile fields ────────────────────────────────────────────────────
-- Birthday (full date; the member card shows the day/month + computed age) and a
-- mailing address (tap on the card → maps directions). Both optional.
alter table public.profiles add column if not exists birthday date;
alter table public.profiles add column if not exists address text;

-- Members may set their own prefs/fields — column-level grant, same guardrail
-- pattern as 0001/0019 (they still can't touch is_admin, etc.).
grant update (push_types, push_self_notify, birthday, address) on public.profiles to authenticated;
