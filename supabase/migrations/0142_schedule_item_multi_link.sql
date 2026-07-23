-- 0142_schedule_item_multi_link.sql
-- Schedule events (migration 0134) could only carry ONE click-through link.
-- Some events need two (e.g. a sign-up form AND a separate info doc) — same
-- fix as home_callouts (migration 0093): replace the single link_url/
-- link_label pair with an ordered `links` jsonb array (each item
-- `{href, label}`), rendered as separate buttons so they read as distinctly
-- separate actions, not run together.

alter table public.fest_schedule_items add column if not exists links jsonb not null default '[]'::jsonb;

update public.fest_schedule_items
   set links = jsonb_build_array(jsonb_build_object('href', link_url, 'label', link_label))
 where link_url is not null and links = '[]'::jsonb;

alter table public.fest_schedule_items drop column if exists link_url;
alter table public.fest_schedule_items drop column if exists link_label;
