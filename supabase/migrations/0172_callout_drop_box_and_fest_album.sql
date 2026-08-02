-- 0172_callout_drop_box_and_fest_album.sql
-- Two small drop-box (0171) follow-ups:
--   1. A Home callout can link to a Drop Box FOLDER — CalloutCard renders a
--      "📸 Add & see photos" button deep-linking /drop?box=<id>. Mirrors the
--      signup_item_id link (0137): one nullable column, public-read rides along.
--   2. Seed the official Family Fest 2026 album as a well-known box with a
--      FIXED id so the app can deep-link to it (the wrap-phase CTAs on Home +
--      the fest hub, and callouts) without a lookup. Id matches
--      FEST_ALBUM_BOX_ID in lib/data.ts.

-- 1) Callout → Drop Box link ---------------------------------------------------
alter table public.home_callouts
  add column if not exists drop_box_id uuid references public.drop_boxes(id) on delete set null;

-- 2) Seed the Family Fest 2026 album -------------------------------------------
-- created_by is NOT NULL (→ profiles); a seed row has no personal author, so
-- own it to an admin (any admin can manage it anyway — canManage = creator OR
-- admin). Idempotent: re-running leaves an existing row (and its photos) alone.
insert into public.drop_boxes (id, title, emoji, created_by)
values (
  '0000fe57-2026-4000-8000-000000000001',
  'Family Fest 2026: Ye Olde Family Feste',
  '🏰',
  coalesce(
    (select id from public.profiles where is_admin order by created_at limit 1),
    (select id from public.profiles order by created_at limit 1)
  )
)
on conflict (id) do nothing;
