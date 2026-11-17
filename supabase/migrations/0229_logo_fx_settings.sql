-- 0229_logo_fx_settings.sql
-- Admin-editable schedule for the seasonal effect over the Home logo in the iOS
-- app (falling leaves, snowfall, ...). Stored on the resort_config singleton,
-- which already has "public read" / "admin write" policies, so no policy change.
-- Shape (all optional; null or a missing key = the app's built-in default):
--   { "enabled": true,
--     "seasons": { "autumn": { "enabled": true, "start": "09-22", "end": "11-30" },
--                  "winter": { "enabled": true, "start": "12-01", "end": "02-28" }, ... } }
-- start/end are "MM-DD", inclusive, and a range may wrap the new year.
-- The web app and older iOS builds ignore the column.
begin;
alter table public.resort_config add column if not exists logo_fx jsonb;
comment on column public.resort_config.logo_fx is
  'Seasonal Home-logo effect schedule for the iOS app. Null = built-in defaults. See 0229.';
commit;
