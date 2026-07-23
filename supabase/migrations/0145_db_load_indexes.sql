-- 0145 — indexes that cut constant/hot DB work (no behavior change).
--
-- Three load reductions found in the stability/battery audit:
--
-- (a) media-verdict hold triggers (0043 posts, 0128 chat) run, per verdict, up
--     to three `UPDATE ... WHERE EXISTS(select from *_media where
--     storage_path = NEW.storage_path)` against post_media /
--     committee_message_media / house_message_media. Those tables were indexed
--     only by (parent_id, position), so each verdict did 3 sequential scans
--     matching on the unindexed storage_path (the media URL). Index it.
--
-- (b) search_conversations (0131) filters `to_tsvector('english', <text>) @@
--     websearch_to_tsquery(...)` over posts/comments/committee/house message
--     text. With no GIN index the keyword filter recomputes a tsvector for every
--     visible row per query. A GIN expression index on each base text column lets
--     the planner keyword-narrow the candidate set before joining embeddings.
--
-- (c) the frequent `event_attendance.status = 'not_going'` exclusion (event
--     targeting in run_scheduled_broadcasts / send_broadcast_notification / the
--     mailer / push senders) was a residual filter on top of the (event_id)
--     index. A tiny partial index covers exactly the excluded rows.

-- (a) storage_path lookups behind the media-moderation hold triggers.
create index if not exists post_media_storage_path_idx
  on public.post_media (storage_path);
create index if not exists committee_message_media_storage_path_idx
  on public.committee_message_media (storage_path);
create index if not exists house_message_media_storage_path_idx
  on public.house_message_media (storage_path);

-- (b) full-text GIN indexes backing search_conversations' `@@` keyword filter.
-- The expression MUST match the function's exactly — `to_tsvector('english',
-- <col>)`, no coalesce — or the planner won't use the index. (Nulls just don't
-- get an index entry; the function already skips null/blank content.)
create index if not exists posts_text_fts_idx
  on public.posts using gin (to_tsvector('english', text));
create index if not exists post_comments_text_fts_idx
  on public.post_comments using gin (to_tsvector('english', text));
create index if not exists committee_messages_text_fts_idx
  on public.committee_messages using gin (to_tsvector('english', text));
create index if not exists house_messages_text_fts_idx
  on public.house_messages using gin (to_tsvector('english', text));

-- (c) the not-going exclusion used by every event-targeted broadcast channel.
create index if not exists event_attendance_not_going_idx
  on public.event_attendance (event_id, user_id)
  where status = 'not_going';
