-- 0073_chat_files.sql
-- Let chat attachments be ANY file (PDFs, docs, etc.), not just photos/videos —
-- matching iMessage-style "send me the file". Adds a 'file' media_type to both
-- chat media tables and a nullable file_name so the client can show the original
-- name on the file bubble. Stickers/GIFs stay valid (kept for old messages, even
-- though the web composer no longer offers them). Apply in the Supabase SQL
-- editor. The Mac-mini media server must also be redeployed to accept non-media
-- uploads for category=chat (see media-server/server.js).

-- ── committee_message_media ──────────────────────────────────────────────────
alter table public.committee_message_media
  drop constraint if exists committee_message_media_media_type_check;
alter table public.committee_message_media
  add constraint committee_message_media_media_type_check
  check (media_type in ('image', 'video', 'sticker', 'gif', 'file'));
alter table public.committee_message_media
  add column if not exists file_name text;

-- ── house_message_media ──────────────────────────────────────────────────────
alter table public.house_message_media
  drop constraint if exists house_message_media_media_type_check;
alter table public.house_message_media
  add constraint house_message_media_media_type_check
  check (media_type in ('image', 'video', 'sticker', 'gif', 'file'));
alter table public.house_message_media
  add column if not exists file_name text;
