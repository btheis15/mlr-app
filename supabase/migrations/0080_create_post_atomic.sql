-- 0080_create_post_atomic.sql
-- Atomic post creation. The composer used to build a post with three separate
-- client inserts (posts → one insert per post_media row → post_tags), so a
-- failure mid-loop (flaky Wi-Fi, a bad tag id) left a live half-finished post
-- in the feed while the author saw "Couldn't post". This RPC lands the whole
-- post — caption, media, tags — in ONE transaction: any failure rolls the
-- entire post back, so the feed never shows a partial one.
--
-- Behavior is identical to the old multi-insert path:
--   • author is auth.uid() (sign-in required; SECURITY DEFINER bypasses RLS,
--     so the author check the "posts: insert own" policy did is enforced here);
--   • the moderate_content_text BEFORE INSERT trigger (0040) still fires on
--     the posts insert, so the length cap + blocklist auto-hold apply exactly
--     as before, as do the AFTER INSERT notification fan-outs (0030);
--   • p_held mirrors the client's AI text screen (lib/media moderatePostText):
--     true creates the post 'pending' (held for review), else the 0040 default
--     'visible' — the trigger can still escalate visible → pending;
--   • p_occurred_at backdates the post (0005); null lands it as now().
--
-- RPC (SECURITY DEFINER):
--   create_post(p_caption, p_occurred_at, p_media, p_tags, p_held) → uuid
--     p_media: jsonb array, in display order — [{"path": <mini URL>, "type":
--              "image" | "video"}, ...] → post_media rows (position = index).
--     p_tags:  uuid[] of profiles to tag → post_tags rows.
--
-- The client falls back to the old multi-insert path until this runs (the
-- usual pre-migration degrade). Apply after 0040.

-- ── RPC: create_post — any signed-in member, all-or-nothing ──────────────────

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
  v_pos     int  := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(v_media) <> 'array' then raise exception 'Invalid media'; end if;
  if v_caption is null and jsonb_array_length(v_media) = 0
    then raise exception 'Nothing to post'; end if;

  -- Same defaults the direct insert got: status 'visible' unless the client's
  -- text screen held it; occurred_at falls back to the column default (now()).
  -- The 0040 BEFORE INSERT trigger runs on this row like any other insert.
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
    if v_path is null then raise exception 'Media path required'; end if;
    if v_type not in ('image', 'video') then raise exception 'Invalid media type'; end if;

    insert into public.post_media (post_id, storage_path, media_type, position)
    values (v_id, v_path, v_type, v_pos);
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
