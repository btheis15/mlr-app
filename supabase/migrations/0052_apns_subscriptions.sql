-- Native iOS push: APNs device tokens (parallels the web `push_subscriptions`).
--
-- The iOS app (PushService.saveToken) upserts (user_id, device_token, environment)
-- with onConflict (user_id, device_token). The Mac-mini `apns-sender.js` reads
-- these (service_role) to deliver pushes; gating on push_types happens in the
-- sender exactly like web push. RLS keeps each member to their own tokens.

create table if not exists public.apns_subscriptions (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  device_token text not null,
  environment  text not null default 'production'
               check (environment in ('sandbox', 'production')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, device_token)
);

alter table public.apns_subscriptions enable row level security;

-- Owner-only: a member sees and manages only their own device tokens.
drop policy if exists "apns: read own" on public.apns_subscriptions;
create policy "apns: read own" on public.apns_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "apns: insert own" on public.apns_subscriptions;
create policy "apns: insert own" on public.apns_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "apns: update own" on public.apns_subscriptions;
create policy "apns: update own" on public.apns_subscriptions
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "apns: delete own" on public.apns_subscriptions;
create policy "apns: delete own" on public.apns_subscriptions
  for delete to authenticated using (user_id = auth.uid());
