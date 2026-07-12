-- 0082_resort_config.sql
-- Singleton row of resort-level config: the Help page's human escape-hatch
-- contact (name/phone/email) + basic public resort info (address/phone/
-- wifi/check-in). These used to be hard-coded in lib/help.ts (HELP_CONTACT)
-- and lib/data.ts (RESORT) — which meant real names/a personal phone/email
-- shipped as literal strings in the public client JS bundle, with no way to
-- change them short of a redeploy. This table lets an admin edit them in-app
-- (future admin UI); lib/resortConfig.ts (`fetchResortConfig`) reads it and
-- falls back to the old hard-coded values only when Supabase isn't
-- configured or this migration hasn't run yet.
--
-- ⚠️ READ POLICY IS DELIBERATELY PUBLIC (anon + authenticated) — a deliberate
-- exception to the "gate sensitive stuff behind sign-in" posture documented in
-- CLAUDE.md's "Privacy wall (guests vs members)" section. Reasoning:
--   • help_contact_* is the SIGN-IN ESCAPE HATCH itself (see app/help/page.tsx
--     and lib/help.ts) — a guest who can't sign in (lost code, no account yet,
--     doesn't trust the app yet) must still be able to reach a real human, so
--     it can't be gated behind the very sign-in it's there to unblock.
--   • resort_address / resort_phone / wifi_note / checkin_note are ordinary
--     public resort/business info (the kind of thing on a business card or a
--     "contact us" page), not personal PII, so public read is appropriate.
-- Writes are admin-only, matching the app_images (0055) / announcements (0016)
-- admin-write pattern (RLS check against profiles.is_admin; no client
-- allow-list — see CLAUDE.md "Admins").

create table if not exists public.resort_config (
  -- Boolean PK + a "must be true" check is a standard Postgres singleton
  -- trick: only one row (id = true) can ever exist.
  id                  boolean primary key default true,
  help_contact_name   text not null default '',
  help_contact_phone  text not null default '', -- E.164, e.g. "+17155551234"; empty ⇒ Help page falls back to email-only
  help_contact_email  text not null default '',
  resort_address      text not null default '',
  resort_phone        text not null default '', -- E.164
  wifi_note           text not null default '', -- free text, e.g. Network + password
  checkin_note        text not null default '', -- free text, e.g. check-in/out times
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null,
  constraint resort_config_singleton check (id)
);

alter table public.resort_config enable row level security;

drop policy if exists "resort_config: public read" on public.resort_config;
create policy "resort_config: public read" on public.resort_config
  for select using (true);

drop policy if exists "resort_config: admin write" on public.resort_config;
create policy "resort_config: admin write" on public.resort_config
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Seed the singleton row with TODAY's hard-coded values (lib/help.ts
-- HELP_CONTACT + lib/data.ts RESORT) so the DB starts out matching what's
-- currently live. `on conflict do nothing` makes this migration safe to
-- re-run without clobbering an admin's later edits.
insert into public.resort_config (
  id, help_contact_name, help_contact_phone, help_contact_email,
  resort_address, resort_phone, wifi_note, checkin_note
) values (
  true,
  'Brian',
  '+12248005389',
  'brian.theis15@gmail.com',
  'Muskellunge Lake · 5 mi from Tomahawk on Hwy 8 · Tomahawk, WI',
  '+17155550100',
  'Network "MLR-Guest" · Password "musky2026"',
  'Check-in 4:00 PM · Check-out 11:00 AM'
)
on conflict (id) do nothing;
