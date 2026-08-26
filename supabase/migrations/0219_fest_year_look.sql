-- 0219_fest_year_look.sql
--
-- Give each fest YEAR its own identity and look, editable in the app.
--
-- Migration 0053 made the fest's *content* year-keyed (schedule, dinners, dues,
-- payees), and lib/festYears.ts made the app resolve the current year from the
-- data — so a finished fest slides into Past Years and a new one takes the hub
-- with nothing to switch by hand. But a fest's IDENTITY was still stuck in code
-- and in app-wide singletons:
--
--   * the theme line ("Ye Olde Family Feste") was a hardcoded `FAMILY_FEST.theme`
--     in lib/data.ts, so 2027 would advertise 2026's theme until someone shipped
--     a build;
--   * the cover photo lived in `app_images` under ONE global key, `fest_cover`,
--     so uploading 2027's poster would retroactively replace the one the 2026
--     archive shows — the archive's whole promise is that it stays put;
--   * the parchment/heraldry palette, the section background, and the display
--     font were hardcoded CSS (`.ff-section` in app/globals.css), so a year with
--     a different theme had no way to look different.
--
-- All three become per-year columns here. The point is that a fest editor
-- (admin or Family Fest committee — `can_edit_fest()`, added in 0053) can set up
-- a whole new year in the app: dates, theme, cover, colors, background, font,
-- and the daily plan.
--
-- ⚠️ EVERY COLUMN IS NULLABLE AND NULL MEANS "USE THE BUILT-IN LOOK". The
-- `.ff-section` CSS stays the default — the parchment + heraldic wine/azure
-- established in 2026, including its Display-P3 wide-gamut upgrade. A year only
-- overrides what it actually chose. This is deliberately NOT backfilled with the
-- current hexes: doing so would freeze 2026 onto sRGB literals (inline custom
-- properties beat the `@supports (color: display-p3)` rules that upgrade them)
-- and would turn "the default look" into six rows of duplicated truth.

alter table public.fest_config
  add column if not exists theme                  text,   -- the year's theme/title line, e.g. "Ye Olde Family Feste"
  add column if not exists cover_url              text,   -- this year's cover photo (hub header + its archive page)
  add column if not exists theme_primary          text,   -- headings, buttons, links  (default #8b2e2e heraldic wine)
  add column if not exists theme_accent           text,   -- warnings / secondary      (default #1e3a8a heraldic azure)
  add column if not exists theme_background       text,   -- the section canvas        (default #f4ecd8 parchment)
  add column if not exists theme_card             text,   -- card + sheet surfaces     (default #fdfaf1 vellum)
  add column if not exists theme_border           text,   -- hairlines / rings         (default #d8c7a3 tan)
  add column if not exists theme_ink              text,   -- body text                 (default #3a2a18 sepia)
  add column if not exists theme_bg_style         text,   -- 'default' (parchment wash) | 'flat' | 'image'
  add column if not exists theme_bg_image_url     text,   -- backdrop photo/pattern when style = 'image'
  add column if not exists theme_bg_image_mode    text,   -- 'cover' (one photo) | 'tile' (repeating pattern)
  add column if not exists theme_bg_image_opacity int,    -- 0–100; how strongly the backdrop shows through
  add column if not exists theme_font             text;   -- 'cinzel' | 'playfair' | 'sans'

-- ── Validation ────────────────────────────────────────────────────────────────
-- These values are interpolated into CSS custom properties on the client, so the
-- shapes are pinned HERE rather than trusted from the form. Writes are already
-- limited to fest editors, but a colour column is exactly the kind of field that
-- ends up carrying `red; background: url(...)` one day, and the client-side
-- validator in lib/festTheme.ts can't defend rows written by anything else
-- (SQL editor, iOS, a future script). Six-digit hex only, closed enums for the
-- three mode columns, and a bounded opacity.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fest_config_theme_hex') then
    alter table public.fest_config add constraint fest_config_theme_hex check (
      (theme_primary    is null or theme_primary    ~ '^#[0-9A-Fa-f]{6}$') and
      (theme_accent     is null or theme_accent     ~ '^#[0-9A-Fa-f]{6}$') and
      (theme_background is null or theme_background ~ '^#[0-9A-Fa-f]{6}$') and
      (theme_card       is null or theme_card       ~ '^#[0-9A-Fa-f]{6}$') and
      (theme_border     is null or theme_border     ~ '^#[0-9A-Fa-f]{6}$') and
      (theme_ink        is null or theme_ink        ~ '^#[0-9A-Fa-f]{6}$')
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fest_config_theme_modes') then
    alter table public.fest_config add constraint fest_config_theme_modes check (
      (theme_bg_style      is null or theme_bg_style      in ('default', 'flat', 'image')) and
      (theme_bg_image_mode is null or theme_bg_image_mode in ('cover', 'tile')) and
      (theme_font          is null or theme_font          in ('cinzel', 'playfair', 'sans')) and
      (theme_bg_image_opacity is null or theme_bg_image_opacity between 0 and 100)
    );
  end if;
end $$;

-- ── The one thing that IS backfilled: 2026's theme line ───────────────────────
-- It was already written (as `FAMILY_FEST.theme` in lib/data.ts) and the hub now
-- reads this column instead, so without this the 2026 archive would lose the
-- name of its own theme. Colours/background/font are left null on purpose — see
-- the note above; null already renders exactly the 2026 look.
update public.fest_config
   set theme = 'Ye Olde Family Feste'
 where fest_year = 2026
   and theme is null;

-- No RLS changes: `fest_config` already reads public and writes through
-- can_edit_fest() (0053), and new columns inherit the table's policies.
comment on column public.fest_config.theme is
  'This year''s theme/title line, shown under the fest name. Null = no theme line.';
comment on column public.fest_config.cover_url is
  'This year''s cover photo. Null = app_images.fest_cover, then the bundled art.';
comment on column public.fest_config.theme_bg_style is
  'default = the built-in parchment wash; flat = theme_background only; image = theme_bg_image_url.';
