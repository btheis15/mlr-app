-- 0174_drop_box_captured_at.sql
-- Sort Drop Box albums by when the photo/video was actually TAKEN, not just
-- when it was uploaded. Family photos get dropped into an album long after
-- the moment (end of the trip, after someone finally digs their phone out),
-- so "newest upload first" often reads out of order against the real
-- timeline. `captured_at` holds the shot's real date/time when it could be
-- read from the file (EXIF DateTimeOriginal for photos, the container's
-- creation_time for videos — see media-server/captured-at.js); the album
-- sorts by captured_at when present, falling back to created_at (upload
-- time) otherwise — never a reason to hide an item for lacking metadata.
--
-- Nullable, additive, no backfill: existing rows just have no captured_at and
-- keep sorting by upload time exactly as before.

alter table public.drop_box_media add column if not exists captured_at timestamptz;

-- Widen add_drop_box_media with a trailing `p_captured_at` default param —
-- same "new overload, drop the stale one" shape as 0173's thumbnail_url add
-- (see that migration's header + the CLAUDE.md 0115 incident on silently
-- coexisting overloads from a signature change that only added, never
-- dropped, the old one).
drop function if exists public.add_drop_box_media(uuid, text, text, text);
create or replace function public.add_drop_box_media(
  p_box            uuid,
  p_url            text,
  p_type           text,
  p_thumbnail_url  text default null,
  p_captured_at    timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  if p_type not in ('image', 'video') then raise exception 'Unsupported media type.'; end if;
  if not exists (select 1 from public.drop_boxes b where b.id = p_box and b.archived_at is null) then
    raise exception 'That folder is not available.';
  end if;
  insert into public.drop_box_media (box_id, storage_path, media_type, uploaded_by, thumbnail_url, captured_at)
    values (p_box, p_url, p_type, auth.uid(), nullif(btrim(coalesce(p_thumbnail_url, '')), ''), p_captured_at)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_drop_box_media(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.add_drop_box_media(uuid, text, text, text, timestamptz) to authenticated;
