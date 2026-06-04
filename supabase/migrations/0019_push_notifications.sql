-- 0019_push_notifications.sql
-- Web Push: a per-user notification level + per-device push subscriptions.
-- The mini's push-sender (service role) reads these to deliver notifications;
-- clients manage only their own subscription rows under RLS. Apply after 0018.

-- ── Per-user preference ──────────────────────────────────────────────────────
-- What this member wants to be notified about. Mirrors the email_alerts opt-in.
--   all      → every new committee chat message (+ broadcast alerts)
--   mentions → only @mentions / replies to me (+ broadcast alerts)
--   alerts   → only admin / Family Fest broadcast alerts
--   off      → nothing (default)
alter table public.profiles
  add column if not exists push_level text not null default 'off'
  check (push_level in ('all', 'mentions', 'alerts', 'off'));

-- Let members set their own preference (column-level grant, same guardrail
-- pattern as 0001 — they still can't touch is_admin etc.).
grant update (push_level) on public.profiles to authenticated;

-- ── Per-device subscriptions ─────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique,           -- the browser's push endpoint
  p256dh       text not null,                  -- subscription public key
  auth         text not null,                  -- subscription auth secret
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A member sees and manages only their own device subscriptions. The sender on
-- the mini uses the service-role key, which bypasses RLS to read everyone's.
drop policy if exists push_sub_select on public.push_subscriptions;
create policy push_sub_select on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_sub_insert on public.push_subscriptions;
create policy push_sub_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_sub_update on public.push_subscriptions;
create policy push_sub_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());
