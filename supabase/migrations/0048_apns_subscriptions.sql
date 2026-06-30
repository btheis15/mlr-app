-- 0048_apns_subscriptions.sql
-- Native Apple Push Notification service: per-device APNs token registrations
-- for the iOS app (ios/MLRApp). The mini's push-sender (service role) reads
-- these to deliver via APNs; clients manage only their own rows under RLS.
-- The web-push equivalent is push_subscriptions (0019); this is its native peer.

create table if not exists public.apns_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  device_token text not null,                  -- APNs device token (hex)
  environment  text not null default 'production'
                 check (environment in ('sandbox', 'production')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- One row per (user, device token). Matches the app's upsert onConflict
  -- ("user_id,device_token") so re-registering the same device is idempotent.
  unique (user_id, device_token)
);
create index if not exists apns_subscriptions_user_idx
  on public.apns_subscriptions (user_id);

alter table public.apns_subscriptions enable row level security;

-- A member sees and manages only their own device tokens. The sender on the
-- mini uses the service-role key, which bypasses RLS to read everyone's.
drop policy if exists apns_sub_select on public.apns_subscriptions;
create policy apns_sub_select on public.apns_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists apns_sub_insert on public.apns_subscriptions;
create policy apns_sub_insert on public.apns_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists apns_sub_update on public.apns_subscriptions;
create policy apns_sub_update on public.apns_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists apns_sub_delete on public.apns_subscriptions;
create policy apns_sub_delete on public.apns_subscriptions
  for delete using (user_id = auth.uid());
