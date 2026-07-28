-- 0161_new_post_push_default.sql
-- Make `new_post` (a phone push for a new Main Feed post) ON by default.
--
-- `new_post` was introduced as a push category in the same change that added
-- it to both mini senders' pushable sets + a PushToggle row, but deliberately
-- OPT-IN (absent from DEFAULT_PUSH_TYPES, no backfill) on the theory that it's
-- the highest-frequency category and most people wouldn't want a buzz per post.
--
-- Reversed by product decision: the family feed is the app's town square, and
-- during a live Family Fest a post ("dinner is ready!") is precisely the thing
-- people need to hear about immediately — an in-app-only Activity row that
-- nobody sees until they happen to open the app defeats the purpose. It stays
-- individually opt-OUT-able in PushToggle ("New posts in the Feed"), so anyone
-- who doesn't want it can untick just that one without turning off push.
--
-- Two halves, exactly mirroring 0159's signup_reminder change (which itself
-- mirrored 0037's help_request/help_response backfill):
--   • NEW members: `new_post` is in DEFAULT_PUSH_TYPES (lib/types.ts), which is
--     what gets written when someone accepts the first-run push prompt.
--   • EXISTING members: backfilled below.
--
-- Only members who already have push ON AT ALL (`push_types <> '{}'`) are
-- backfilled — someone who deliberately turned phone push fully off stays
-- fully off; this never re-enables push for them.
--
-- Idempotent (the `not (... @> ...)` guard + distinct re-aggregation mean
-- re-running is a no-op).

update public.profiles
  set push_types = array(
    select distinct e from unnest(push_types || '{new_post}'::text[]) e
  )
  where push_types <> '{}'
    and not (push_types @> '{new_post}'::text[]);
