-- Point every stored media URL at the new direct endpoint.
--
-- NOT a schema migration — a data correction, so it lives here rather than in
-- supabase/migrations. Run once in the Supabase SQL editor.
--
-- WHY
--   Media was published through Tailscale Funnel, which relays via Tailscale's
--   DERP infrastructure and measured 12-21 Mbps (varying 1.7x) against a 119 Mbps
--   uplink — about 15% of real capacity. A 36 Mbps video literally could not be
--   watched in real time. It now serves directly through Caddy + DuckDNS on the
--   same machine. Confirmed working from a phone on cellular.
--
-- WHY A REWRITE IS NEEDED AT ALL
--   The app stores ABSOLUTE media URLs, so the hostname is baked into ~1,732
--   values rather than being a config lookup. That's the cost of absolute URLs,
--   and it's why PUBLIC_URL should not be changed casually.
--
-- SAFE TO RUN
--   • The OLD Tailscale Funnel endpoint is deliberately STILL RUNNING, so any row
--     this misses keeps working. Nothing 404s if this is partial.
--   • Verified beforehand that no stored URL carries a :port, so a hostname-only
--     replace cannot corrupt one (a `…ts.net:8443/…` would have become
--     `…duckdns.org:8443/…` and broken — that URL shape does not exist here).
--   • replace(NULL, …) is NULL, so rows without a thumbnail stay untouched.
--   • Wrapped in a transaction: it all lands or none of it does.
--
-- NOT A MODERATION RE-RUN
--   media_moderation is an async, post-upload verdict LEDGER (the model runs in
--   the background after /upload responds). Rewriting its keys re-aligns the
--   admin review list's URL matching. It does NOT re-scan anything and cannot
--   change any content's approved/held status.

begin;

-- Before: how many values still hold the old hostname.
select 'BEFORE' as phase, 'post_media' as tbl,
       count(*) filter (where storage_path like '%tail49943c%')  as storage_paths,
       count(*) filter (where thumbnail_url like '%tail49943c%') as thumbnails
  from post_media
union all select 'BEFORE', 'post_comment_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from post_comment_media
union all select 'BEFORE', 'work_item_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from work_item_media
union all select 'BEFORE', 'drop_box_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from drop_box_media
union all select 'BEFORE', 'committee_message_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from committee_message_media
union all select 'BEFORE', 'house_message_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from house_message_media
union all select 'BEFORE', 'media_moderation',
       count(*) filter (where storage_path like '%tail49943c%'), 0 from media_moderation;

-- Hostname only, no scheme and no port, so any URL shape is handled.
update post_media
   set storage_path  = replace(storage_path,  'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org'),
       thumbnail_url = replace(thumbnail_url, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%' or thumbnail_url like '%tail49943c%';

update post_comment_media
   set storage_path  = replace(storage_path,  'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org'),
       thumbnail_url = replace(thumbnail_url, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%' or thumbnail_url like '%tail49943c%';

update work_item_media
   set storage_path  = replace(storage_path,  'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org'),
       thumbnail_url = replace(thumbnail_url, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%' or thumbnail_url like '%tail49943c%';

update drop_box_media
   set storage_path  = replace(storage_path,  'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org'),
       thumbnail_url = replace(thumbnail_url, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%' or thumbnail_url like '%tail49943c%';

update committee_message_media
   set storage_path  = replace(storage_path,  'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org'),
       thumbnail_url = replace(thumbnail_url, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%' or thumbnail_url like '%tail49943c%';

update house_message_media
   set storage_path  = replace(storage_path,  'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org'),
       thumbnail_url = replace(thumbnail_url, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%' or thumbnail_url like '%tail49943c%';

-- Ledger keys only. No re-scan, no status change.
update media_moderation
   set storage_path = replace(storage_path, 'brians-mac-mini.tail49943c.ts.net', 'mlr-media.duckdns.org')
 where storage_path like '%tail49943c%';

-- After: every count below should be 0.
select 'AFTER' as phase, 'post_media' as tbl,
       count(*) filter (where storage_path like '%tail49943c%')  as storage_paths,
       count(*) filter (where thumbnail_url like '%tail49943c%') as thumbnails
  from post_media
union all select 'AFTER', 'post_comment_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from post_comment_media
union all select 'AFTER', 'work_item_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from work_item_media
union all select 'AFTER', 'drop_box_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from drop_box_media
union all select 'AFTER', 'committee_message_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from committee_message_media
union all select 'AFTER', 'house_message_media',
       count(*) filter (where storage_path like '%tail49943c%'),
       count(*) filter (where thumbnail_url like '%tail49943c%') from house_message_media
union all select 'AFTER', 'media_moderation',
       count(*) filter (where storage_path like '%tail49943c%'), 0 from media_moderation;

commit;

-- ROLLBACK (only if something looks wrong). The Funnel endpoint is still up, so
-- reverting restores exactly the previous working state:
--
--   update post_media  set storage_path  = replace(storage_path,  'mlr-media.duckdns.org', 'brians-mac-mini.tail49943c.ts.net'),
--                          thumbnail_url = replace(thumbnail_url, 'mlr-media.duckdns.org', 'brians-mac-mini.tail49943c.ts.net')
--    where storage_path like '%duckdns%' or thumbnail_url like '%duckdns%';
--   -- …and the same for the other six tables.
