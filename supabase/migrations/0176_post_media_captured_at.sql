-- 0176_post_media_captured_at.sql
-- Keep a Feed photo's "date taken" from the moment it's posted, so it's still
-- there if those photos are added to an album later.
--
-- THE GAP: a photo's capture date can only be read from the ORIGINAL file, on
-- the client, before compressImage re-encodes it away. The post composer now
-- does that read for every photo — but `post_media` had nowhere to put the
-- answer, so it was computed and thrown away for anything not bound straight
-- for an album. When those same photos were later referenced into one
-- ("Also add to an album" while editing a post), the original File was long
-- gone and all that remained was the weaker source-post-timestamp proxy from
-- 0175.
--
-- Storing it here closes the loop: post now → add to an album whenever →
-- the album still gets the real capture date.
--
-- Nullable + additive; `captured_at_source` mirrors 0175's vocabulary so the
-- two tables rank provenance identically ('exif'/'video' = real file
-- metadata, 'file' = the picked file's mtime, 'post' = the post's own date).

alter table public.post_media
  add column if not exists captured_at timestamptz;
alter table public.post_media
  add column if not exists captured_at_source text
  check (captured_at_source is null or captured_at_source in ('exif', 'video', 'file', 'post'));

-- create_post (0080) builds post_media rows from a jsonb array the client
-- controls, so it just reads two more optional keys per item — no signature
-- change, and jsonb already tolerates a client sending them before this runs.
-- Recreated from the CURRENT definition (0173's, which added `thumbnail`),
-- per the 0160 rule: never rebuild a function from an older migration's copy.
create or replace function public.create_post(
  p_caption     text        default null,
  p_occurred_at timestamptz default null,
  p_media       jsonb       default '[]'::jsonb,
  p_tags        uuid[]      default '{}',
  p_held        boolean     default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_media   jsonb := coalesce(p_media, '[]'::jsonb);
  v_id      uuid;
  v_item    jsonb;
  v_path    text;
  v_type    text;
  v_thumb   text;
  v_taken   timestamptz;
  v_source  text;
  v_pos     int  := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(v_media) <> 'array' then raise exception 'Invalid media'; end if;
  if v_caption is null and jsonb_array_length(v_media) = 0
    then raise exception 'Nothing to post'; end if;

  insert into public.posts (author_id, text, status, occurred_at)
  values (
    v_uid,
    v_caption,
    case when coalesce(p_held, false) then 'pending' else 'visible' end,
    coalesce(p_occurred_at, now())
  )
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(v_media) loop
    v_path := nullif(btrim(coalesce(v_item->>'path', '')), '');
    v_type := coalesce(v_item->>'type', 'image');
    v_thumb := nullif(btrim(coalesce(v_item->>'thumbnail', '')), '');
    if v_path is null then raise exception 'Media path required'; end if;
    if v_type not in ('image', 'video') then raise exception 'Invalid media type'; end if;

    -- Optional, best-effort: a bad/absent timestamp must never fail the post.
    begin
      v_taken := nullif(btrim(coalesce(v_item->>'capturedAt', '')), '')::timestamptz;
    exception when others then
      v_taken := null;
    end;
    v_source := nullif(btrim(coalesce(v_item->>'capturedAtSource', '')), '');
    if v_taken is null then
      v_source := null;
    elsif v_source is null or v_source not in ('exif', 'video', 'file', 'post') then
      v_source := 'exif';
    end if;

    insert into public.post_media
      (post_id, storage_path, media_type, position, thumbnail_url, captured_at, captured_at_source)
    values (v_id, v_path, v_type, v_pos, v_thumb, v_taken, v_source);
    v_pos := v_pos + 1;
  end loop;

  if p_tags is not null and cardinality(p_tags) > 0 then
    insert into public.post_tags (post_id, tagged_user_id)
    select v_id, t from unnest(p_tags) as t
    on conflict (post_id, tagged_user_id) do nothing;
  end if;

  return v_id;
end;
$$;
revoke all on function public.create_post(text, timestamptz, jsonb, uuid[], boolean) from public, anon;
grant execute on function public.create_post(text, timestamptz, jsonb, uuid[], boolean) to authenticated;

-- Backfill what's already recoverable: an album item that resolved a REAL
-- capture date (0175's mini sweep) and points at the same stored file as a
-- post's media can hand that date back to post_media.
update public.post_media pm
   set captured_at = m.captured_at,
       captured_at_source = m.captured_at_source
  from public.drop_box_media m
 where m.storage_path = pm.storage_path
   and m.captured_at is not null
   and m.captured_at_source in ('exif', 'video')
   and pm.captured_at is null;
