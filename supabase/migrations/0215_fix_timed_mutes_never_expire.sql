-- 0215_fix_timed_mutes_never_expire.sql
-- BUG: "Mute for 1 day" mutes a chat FOREVER. Every timed mute anyone has ever
-- set is still in effect.
--
-- ── The intended design (0155's own header) ──────────────────────────────────
--   "A row is effectively muted when `muted` is true (the existing permanent
--    toggle) OR `muted_until` is set and still in the future — a timer just
--    auto-clears itself by going stale, no cron needed."
--
-- That rule is correct, and every READER implements it faithfully:
--   * components/FeedView.tsx      →  (read.muted ?? false) || muted_until > now
--   * media-server/push-sender.js  →  .or('muted.eq.true,muted_until.gt.<now>')
--   * media-server/apns-sender.js  →  same .or(...) filter, twice
--
-- The WRITERS break it. set_area_mute / set_house_mute both store
-- `muted = p_muted`, and the only caller (FeedView's applyMute) always passes
-- p_muted = true — it passes the DURATION separately as p_muted_until. So
-- picking "1 day" writes muted = true AND muted_until = now + 24h. The
-- `muted.eq.true` arm of every reader's OR then matches unconditionally, for
-- ever, and the timestamp beside it never gets a chance to go stale. The
-- expiry half of the feature has never once fired in production.
--
-- Worse, it is invisible: the row still says "Muted until <date>" in the UI
-- (FeedView derives that label from muted_until), so the app actively tells the
-- member their mute expires on a date it will sail straight past.
--
-- ── The fix: let the two columns mean what 0155 said they mean ───────────────
-- `muted` = "permanent, until I turn it back on". `muted_until` = "the timer".
-- Exactly one is ever set, so the readers' OR does the right thing with NO
-- reader changes (the client and both senders are already correct):
--   permanent  (p_muted=true,  until=null)   → muted=true,  until=null
--   timed      (p_muted=true,  until=+Nh)    → muted=false, until=+Nh
--   unmute     (p_muted=false, until=*)      → muted=false, until=null
--
-- Recreated from 0155's bodies, which are still the current definitions for
-- both (verified against the migration history — nothing has redefined either
-- since). The ONLY change in each is the `muted` value; the insert targets,
-- conflict targets, grants and signatures are byte-for-byte 0155's.
--
-- NOT TOUCHED: the older 3-arg overload set_area_mute(uuid, text, boolean) from
-- 0063 is left exactly as-is. It has no duration parameter, so it can only ever
-- express a permanent mute — for which `muted = p_muted` is already right — and
-- the native iOS app may still be calling that signature.

create or replace function public.set_area_mute(cid uuid, p_area text, p_muted boolean, p_muted_until timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.committee_area_reads (committee_id, user_id, area, muted, muted_until)
  values (
    cid, auth.uid(), coalesce(p_area, ''),
    p_muted and p_muted_until is null,
    case when p_muted then p_muted_until else null end
  )
  on conflict (committee_id, user_id, area)
  do update set muted = excluded.muted, muted_until = excluded.muted_until;
$$;
revoke all on function public.set_area_mute(uuid, text, boolean, timestamptz) from public, anon;
grant execute on function public.set_area_mute(uuid, text, boolean, timestamptz) to authenticated;

create or replace function public.set_house_mute(hid uuid, p_muted boolean, p_muted_until timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.house_reads (house_id, user_id, muted, muted_until)
  values (
    hid, auth.uid(),
    p_muted and p_muted_until is null,
    case when p_muted then p_muted_until else null end
  )
  on conflict (house_id, user_id)
  do update set muted = excluded.muted, muted_until = excluded.muted_until;
$$;
revoke all on function public.set_house_mute(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_house_mute(uuid, boolean, timestamptz) to authenticated;

-- ── Repair the rows the bug already wrote ────────────────────────────────────
-- Any row with BOTH set is a timed mute that was silently made permanent. Hand
-- it back to its timer: clear `muted` and let muted_until govern. A timer that
-- has already passed means the member is now correctly UNMUTED — which is what
-- they asked for when they picked "1 day" however long ago.
--
-- This can only ever un-stick a mute; it never mutes anyone who isn't. A
-- genuine permanent mute has muted_until IS NULL and is not matched.
update public.committee_area_reads
   set muted = false
 where muted and muted_until is not null;

update public.house_reads
   set muted = false
 where muted and muted_until is not null;
