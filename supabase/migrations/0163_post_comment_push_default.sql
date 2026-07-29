-- 0163_post_comment_push_default.sql
-- Make `post_comment` (a phone push when someone comments on YOUR post) ON by
-- default, same treatment as 0161's new_post.
--
-- Gap: `post_reply` (notifying every OTHER member who'd already commented on a
-- post) was already a normal, default-on push category — but `post_comment`
-- (notifying the POST'S OWN AUTHOR that someone commented) was never wired to
-- push at all, only the in-app Activity feed. So the one person most invested
-- in a post's comments — the person who wrote it — was the one NOT getting
-- pinged. Reported directly: "if Pops makes a post, he should get a
-- notification when everyone comments on his post."
--
-- Two halves, mirroring 0161/0159/0037's backfill pattern exactly:
--   • NEW members: `post_comment` is in DEFAULT_PUSH_TYPES (lib/types.ts).
--   • EXISTING members: backfilled below, same guard — only members who
--     already have push ON AT ALL (`push_types <> '{}'`) are touched; this
--     never re-enables push for someone who turned it fully off.
--
-- Still individually opt-OUT-able in PushToggle ("Comments on my posts").
--
-- Idempotent.

update public.profiles
  set push_types = array(
    select distinct e from unnest(push_types || '{post_comment}'::text[]) e
  )
  where push_types <> '{}'
    and not (push_types @> '{post_comment}'::text[]);
