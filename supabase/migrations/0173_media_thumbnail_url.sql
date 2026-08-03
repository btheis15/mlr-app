-- 0173_media_thumbnail_url.sql
-- Fast-loading album/grid thumbnails (media-server perf pass).
--
-- Every grid (Feed, work items, Drop Box albums) used to render the exact
-- stored file — full-res photos, post-transcode videos — so scrolling an
-- album re-downloaded full-size assets for every tile. media-server/upload
-- now generates a small JPEG preview alongside the original at upload time
-- (media-server/thumbnail.js) and returns its url in the /upload response;
-- this just gives every *_media table a place to store it.
--
-- Nullable, additive, no backfill: existing rows simply have no thumbnail and
-- every renderer falls back to the full-res `storage_path` url when
-- `thumbnail_url` is null (pre-migration rows, or any future upload where
-- thumbnail generation failed — it's best-effort, never fatal).

alter table public.post_media           add column if not exists thumbnail_url text;
alter table public.post_comment_media   add column if not exists thumbnail_url text;
alter table public.work_item_media      add column if not exists thumbnail_url text;
alter table public.drop_box_media       add column if not exists thumbnail_url text;
alter table public.committee_message_media add column if not exists thumbnail_url text;
alter table public.house_message_media  add column if not exists thumbnail_url text;

-- post_media, post_comment_media, committee_message_media, and
-- house_message_media are all plain client inserts (RLS-gated, no RPC), so the
-- client just adds `thumbnail_url` to the row it already builds — no function
-- change needed for those four.
--
-- work_item_media and drop_box_media are inserted through SECURITY DEFINER
-- RPCs, so those two need a widened signature. Recreated as a NEW overload
-- with a trailing `p_thumbnail_url text default null` (backward compatible —
-- an existing 3-/4-arg call still resolves) and the STALE narrower overload is
-- explicitly dropped, so there is exactly one version of each — see the
-- CLAUDE.md "Places to stay" 0115 incident on silently-coexisting overloads
-- from a signature change that only added, never dropped, the old one.

-- create_post (0080) builds post_media rows from a jsonb array the client
-- controls entirely, so it just needs to read one more optional key
-- ("thumbnail") off each item — no signature/param change, jsonb already
-- tolerates the client sending it before this migration runs (the key is
-- simply ignored by the OLD function body until this replaces it).
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

    insert into public.post_media (post_id, storage_path, media_type, position, thumbnail_url)
    values (v_id, v_path, v_type, v_pos, v_thumb);
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

drop function if exists public.add_work_item_media(uuid, text, text, int);
create or replace function public.add_work_item_media(
  p_work_item_id   uuid,
  p_url            text,
  p_media_type     text default 'image',
  p_position       int  default 0,
  p_thumbnail_url  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_url), '') = '' then raise exception 'URL is required'; end if;
  if p_media_type not in ('image', 'video') then raise exception 'Invalid media type'; end if;

  select created_by into v_creator from public.work_items where id = p_work_item_id;
  if not found then raise exception 'Item not found'; end if;
  if v_creator is distinct from v_uid
     and not exists (select 1 from public.profiles where id = v_uid and is_admin)
    then raise exception 'Not authorized'; end if;

  insert into public.work_item_media (work_item_id, storage_path, media_type, position, thumbnail_url)
  values (p_work_item_id, btrim(p_url), p_media_type, coalesce(p_position, 0), nullif(btrim(coalesce(p_thumbnail_url, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_work_item_media(uuid, text, text, int, text) from public, anon;
grant execute on function public.add_work_item_media(uuid, text, text, int, text) to authenticated;

drop function if exists public.add_drop_box_media(uuid, text, text);
create or replace function public.add_drop_box_media(
  p_box            uuid,
  p_url            text,
  p_type           text,
  p_thumbnail_url  text default null
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
  insert into public.drop_box_media (box_id, storage_path, media_type, uploaded_by, thumbnail_url)
    values (p_box, p_url, p_type, auth.uid(), nullif(btrim(coalesce(p_thumbnail_url, '')), ''))
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_drop_box_media(uuid, text, text, text) from public, anon;
grant execute on function public.add_drop_box_media(uuid, text, text, text) to authenticated;
