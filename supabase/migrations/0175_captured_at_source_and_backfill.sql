-- 0175_captured_at_source_and_backfill.sql
-- Make the Drop Box "sort by when it was taken" (0174) actually work for the
-- photos that are already in an album.
--
-- THE GAP 0174 LEFT: a photo's EXIF is read client-side, off the ORIGINAL file,
-- because compressImage re-encodes it away before upload. That covers a fresh
-- upload — but the dominant way photos reach the Family Fest album is being
-- referenced in from an existing Feed post, where there is no original File
-- left on the client at all, only a URL. Those rows all landed with
-- captured_at = null, so the album collapsed to upload order (and, since a
-- bulk "add to album" writes every row inside the same second, to essentially
-- no order at all).
--
-- TWO SOURCES ARE ADDED, best first:
--   1. Real metadata read off the stored file by the mini
--      (media-server/captured-at-backfill.js — EXIF for photos, container
--      creation_time for videos). Works whenever the bytes still carry it,
--      which is any photo compressImage decided not to re-encode.
--   2. The source POST's own timestamp, as a proxy — backfilled below. It's
--      the family's own statement of when the moment happened (the composer
--      even lets you backdate a post), so it is far better than upload time,
--      and for the current album it spreads 41 photos back across the real
--      fest week instead of stacking them all on one upload second.
--
-- captured_at_source records which one a row got, so the mini's sweep can
-- later UPGRADE a 'post' proxy to real 'exif'/'video' metadata if it finds it,
-- without ever downgrading in the other direction.

alter table public.drop_box_media
  add column if not exists captured_at_source text
  check (captured_at_source is null or captured_at_source in ('exif', 'video', 'file', 'post'));

-- Anything 0174 already stored came from real metadata at upload time.
update public.drop_box_media
   set captured_at_source = 'exif'
 where captured_at is not null and captured_at_source is null;

-- Proxy backfill: an album item that is the SAME stored file as a Feed post's
-- media inherits that post's timestamp. Only fills rows with nothing better,
-- and only where exactly one post owns the file, so a shared file can't pick
-- an arbitrary date.
update public.drop_box_media m
   set captured_at = src.when_taken,
       captured_at_source = 'post'
  from (
    select pm.storage_path,
           min(coalesce(p.occurred_at, p.created_at)) as when_taken,
           count(distinct p.id) as posts
      from public.post_media pm
      join public.posts p on p.id = pm.post_id
     group by pm.storage_path
  ) src
 where m.storage_path = src.storage_path
   and src.posts = 1
   and m.captured_at is null;

-- Widen add_drop_box_media so a caller can say where its date came from —
-- same "new overload, drop the stale one" shape as 0173/0174 (see the
-- CLAUDE.md 0115 incident on silently coexisting overloads).
drop function if exists public.add_drop_box_media(uuid, text, text, text, timestamptz);
create or replace function public.add_drop_box_media(
  p_box               uuid,
  p_url               text,
  p_type              text,
  p_thumbnail_url     text default null,
  p_captured_at       timestamptz default null,
  p_captured_at_source text default null
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
  insert into public.drop_box_media
      (box_id, storage_path, media_type, uploaded_by, thumbnail_url, captured_at, captured_at_source)
    values (
      p_box, p_url, p_type, auth.uid(),
      nullif(btrim(coalesce(p_thumbnail_url, '')), ''),
      p_captured_at,
      case when p_captured_at is null then null
           when p_captured_at_source in ('exif', 'video', 'file', 'post') then p_captured_at_source
           else 'exif' end
    )
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_drop_box_media(uuid, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.add_drop_box_media(uuid, text, text, text, timestamptz, text) to authenticated;
