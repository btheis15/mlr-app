-- 0034_unified_push_prefs.sql
-- Unifies phone-push preferences into ONE list of categories and adds a
-- first-run prompt flag.
--
-- Until now `push_types` (migration 0020) was a coarse 4-value set
-- {chat, mentions, alerts, birthdays}, and several things that members clearly
-- want on their phone (committee decisions, being tagged in a post, post
-- replies) had NO phone-push path at all — they only landed in the in-app
-- Activity feed (notif_types, migration 0029/0030).
--
-- New model: `push_types` is the single source of truth for "buzz my phone",
-- with one entry per category the member can toggle:
--   chat            → every new message in your committees      (firehose)
--   alerts          → broadcast alerts                          (announcements)
--   birthdays       → a member's birthday                       (daily job)
--   committee_join  → your committee join request was decided   (feed-backed)
--   cabin_decision  → your cabin stay request was decided       (feed-backed)
--   post_tag        → you were tagged in a post                 (feed-backed)
--   post_mention    → you were @mentioned in a comment          (feed-backed)
--   post_reply      → a reply/comment on a post you're on       (feed-backed)
-- The five feed-backed categories are delivered by the mini's push-sender
-- mirroring new `notifications` rows of that type to a phone push (gated on
-- push_types). The three firehose categories keep their existing senders.
--
-- Apply in the Supabase SQL editor after 0033.

-- ── Migrate the legacy 'mentions' value forward ──────────────────────────────
-- The old single 'mentions' meant "@mentions and replies" (in chat + post
-- comments). Its closest equivalent in the new vocabulary is post_mention +
-- post_reply. Chat @mentions are now covered by the 'chat' firehose category.
update public.profiles
set push_types = (
  select array_agg(distinct t)
  from unnest(
    array_remove(push_types, 'mentions')
    || case when 'mentions' = any(push_types)
            then array['post_mention', 'post_reply'] else array[]::text[] end
  ) as t
)
where 'mentions' = any(push_types);

-- ── First-run push prompt flag ───────────────────────────────────────────────
-- Drives a one-time "Turn on notifications?" prompt the next time a member opens
-- the app. Anyone who has ALREADY enabled push (non-empty push_types) is treated
-- as already-decided, so they aren't re-prompted; everyone else gets prompted
-- once and, on accept, has the full set of categories turned on (the backfill
-- happens client-side so it can also subscribe the device in the same gesture).
alter table public.profiles
  add column if not exists push_prompted boolean not null default false;

update public.profiles
  set push_prompted = true
  where push_types <> '{}';

-- Members may set their own prompt flag + push categories (column-level grant,
-- same guardrail pattern as 0020 — still can't touch is_admin etc.).
grant update (push_prompted) on public.profiles to authenticated;
