-- A schedule event can carry an optional cover photo (uploaded to the
-- existing public `site-assets` bucket, same as the Home logo / Family Fest
-- cover, migration 0055) and an optional link (a Google Doc/Sheet, sign-up
-- form, or any web page someone can click through to). Both are plain nullable
-- columns on fest_schedule_items — no new table needed, mirroring how
-- home_callouts (0083) already carries image_url/link_href/link_label.

alter table public.fest_schedule_items
  add column if not exists image_url  text,
  add column if not exists link_url   text,
  add column if not exists link_label text;
