-- 0228_fest_theme_icons.sql
-- What: an optional list (max 5) of emoji that represent a fest year's theme
--       (e.g. 1970s -> {🪩,🕺,💃,✌️,🌼}), shown on the iOS Family Fest card and tiles.
-- Why:  the fest theme lives in public.fest_config (one row per fest_year, 0219).
-- Writes: fest_config is written by direct upsert/update under RLS via
--       can_edit_fest() (0053; see 0219 note "No RLS changes"), so NO function
--       is needed and none is added: new columns inherit those policies.
-- Image: theme_icon_url is an uploaded logo in the public `site-assets` bucket
--       (same as the fest cover). Its write policy "site-assets write" already
--       allows can_edit_fest() (0055); no storage policy is added.
-- Reads: every reader uses select * on fest_config (iOS fetches "*"); no view
--       or definer read function lists its columns, so nothing else to change.
--       save_fest_config (0220) does not touch this column, so it is not blanked.
-- Compat: nullable and unknown to the web app and old iOS builds, which ignore
--       it. NULL/empty = pick icons automatically from the theme text.
begin;

alter table public.fest_config
  add column if not exists theme_icons text[],
  add column if not exists theme_icon_url text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'fest_config_theme_icons_max5'
                   and conrelid = 'public.fest_config'::regclass) then
    alter table public.fest_config
      add constraint fest_config_theme_icons_max5
      check (theme_icons is null or coalesce(array_length(theme_icons, 1), 0) <= 5);
  end if;
end $$;

comment on column public.fest_config.theme_icon_url is
  'Uploaded logo/image for this fest''s tile. Wins over theme_icons. Null = none.';
comment on column public.fest_config.theme_icons is
  'Up to 5 emoji representing this fest''s theme. Null/empty = automatic from theme text.';

commit;
