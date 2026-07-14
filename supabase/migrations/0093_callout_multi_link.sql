-- 0093_callout_multi_link.sql
-- Home call-outs (migration 0083) could only carry ONE action link. Some
-- call-outs need two distinct links (e.g. two separate order forms) — replace
-- the single link_href/link_label pair with an ordered `links` jsonb array
-- (each item `{href, label}`), rendered as separate lines/buttons in
-- CalloutCard so they read as distinctly separate actions, not run together.

alter table public.home_callouts add column if not exists links jsonb not null default '[]'::jsonb;

update public.home_callouts
   set links = jsonb_build_array(jsonb_build_object('href', link_href, 'label', link_label))
 where link_href is not null and links = '[]'::jsonb;

alter table public.home_callouts drop column if exists link_href;
alter table public.home_callouts drop column if exists link_label;
