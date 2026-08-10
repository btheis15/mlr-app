// Congestion-aware quality capping.
//
// THE PROBLEM THIS SOLVES
//
// Adaptive streaming lets each viewer pick the best quality THEIR connection can
// carry. That's the right call for one viewer and the wrong call for several: five
// relatives on good wifi will each happily choose the top rung, and 5 x 11 Mbps
// exceeds this house's ~105 Mbps uplink once anything else is going on. Every one
// of them then stalls, and none of them individually did anything unreasonable —
// hls.js measures the viewer's own throughput and has no idea it's competing with
// four siblings for the same pipe.
//
// So the SERVER, which is the only thing that can see the aggregate, caps quality
// when the pipe is genuinely under pressure. Deliberately conservative per Brian's
// framing: only when there are MULTIPLE concurrent viewers AND the total is close
// to the limit. One person watching alone always gets the best rung available, even
// if that's 11 Mbps.
//
// HOW LOAD IS MEASURED
//
// Actual bytes written out of /f, in a sliding window — not a guess from bitrate
// metadata. That naturally accounts for photos, downloads and zips competing with
// video, which a video-only estimate would miss entirely.
//
// Viewers are counted by a coarse client key (IP + user-agent). It's approximate:
// two relatives behind one NAT count as one, and a phone switching wifi->cellular
// briefly counts as two. Fine for the purpose — this only has to distinguish "one
// person" from "several", not bill anyone.

const WINDOW_MS = Number(process.env.LOAD_WINDOW_MS || 10_000);
const VIEWER_IDLE_MS = Number(process.env.LOAD_VIEWER_IDLE_MS || 30_000);
// Usable uplink for media, in Mbps. Measured capacity here is ~105-119 Mbps; the
// default leaves real headroom for everything else in the house rather than
// pretending the whole pipe is ours.
const CAPACITY_MBPS = Number(process.env.MEDIA_CAPACITY_MBPS || 80);
// ⚠️ THIS MUST BE RARE. Capping is NOT "the pipe is 65% busy so everyone gets
// worse video" — that would degrade quality constantly for no reason.
//
// The trigger is literally "another person is trying to stream and there isn't
// room for them unless quality drops for everyone". MEASURED SATURATION is the
// ground truth for that: a saturated link plateaus at capacity, and when it's
// plateaued with several viewers active, somebody is already being starved — they
// are the person who doesn't fit. At that moment a lower rung for everyone is
// strictly better than one person buffering.
//
// 0.90 keeps it genuinely rare: at 80 Mbps that's 72 Mbps of real, sustained media
// traffic before anything changes. Normal family browsing never gets close.
//
// ⚠️ An earlier version ALSO required `viewers * topRung > capacity` as a second
// condition. That was wrong and defeated the whole feature: it took ~8 simultaneous
// viewers to satisfy, so the exact case described — three people streaming and a
// fourth who can't fit — would never have capped at all, even with the link
// visibly pegged. Saturation already encodes "there is no room"; predicting it from
// viewer arithmetic only adds a way to be wrong.
const SATURATION_PRESSURE = Number(process.env.LOAD_SATURATION || 0.9);
// Capping requires at least this many concurrent viewers, so a single viewer is
// never throttled no matter how much of the pipe they're using.
const MIN_VIEWERS_TO_CAP = Number(process.env.LOAD_MIN_VIEWERS || 2);
// Per-rung Mbps, highest first — mirrors hls.js RUNGS. Used for the "is there room
// for everyone?" arithmetic rather than guessing from a percentage.
const RUNG_MBPS = [11, 4, 1.6];

/** @type {{at:number, bytes:number}[]} */
let samples = [];
/** @type {Map<string, number>} client key -> last seen ms */
const viewers = new Map();

function prune(now) {
  const cutoff = now - WINDOW_MS;
  if (samples.length && samples[0].at < cutoff) {
    samples = samples.filter((s) => s.at >= cutoff);
  }
  for (const [k, seen] of viewers) {
    if (now - seen > VIEWER_IDLE_MS) viewers.delete(k);
  }
}

/** A coarse, non-identifying key for "one viewer". Never logged or persisted. */
function clientKey(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || "?";
  const ua = String(req.get?.("user-agent") || "").slice(0, 40);
  return `${ip}|${ua}`;
}

/**
 * Record bytes actually delivered. Call once per media response, from the
 * response's 'finish' handler so it reflects what was really sent (a viewer who
 * seeks away mid-segment shouldn't be counted as full throughput).
 */
function record(req, bytes) {
  if (!bytes || bytes < 0) return;
  const now = Date.now();
  samples.push({ at: now, bytes });
  viewers.set(clientKey(req), now);
  prune(now);
}

/** Mark a client as active without attributing bytes (e.g. a playlist fetch). */
function touch(req) {
  const now = Date.now();
  viewers.set(clientKey(req), now);
  prune(now);
}

/**
 * @returns {{viewers:number, mbps:number, capacityMbps:number, pressure:number,
 *            capping:boolean, maxRungs:number|null}}
 *   `maxRungs` is how many rungs (counting from the LOWEST) a client should be
 *   allowed to use, or null for "no limit".
 */
function currentLoad() {
  const now = Date.now();
  prune(now);
  const bytes = samples.reduce((s, x) => s + x.bytes, 0);
  const seconds = Math.min(WINDOW_MS, Math.max(1000, now - (samples[0]?.at ?? now))) / 1000;
  const mbps = (bytes * 8) / 1e6 / seconds;
  const pressure = CAPACITY_MBPS > 0 ? mbps / CAPACITY_MBPS : 0;
  const count = viewers.size;

  // The link is genuinely full right now, and it's full with more than one person
  // on it — so someone is not getting the bandwidth they're asking for.
  const capping = count >= MIN_VIEWERS_TO_CAP && pressure >= SATURATION_PRESSURE;

  // How far to drop: normally just the top rung. Fall to the lowest only when
  // there are so many viewers that even the middle rung can't fit them all, since
  // dropping one rung then wouldn't relieve anything.
  const maxRungs = capping ? (count * RUNG_MBPS[1] <= CAPACITY_MBPS ? 2 : 1) : null;
  return { viewers: count, mbps: Number(mbps.toFixed(1)), capacityMbps: CAPACITY_MBPS, pressure: Number(pressure.toFixed(2)), capping, maxRungs };
}

/**
 * Rewrite a master playlist to expose only the lowest `maxRungs` variants.
 *
 * Capping at the PLAYLIST is what makes this work without a cooperating client:
 * a player can only ever select a variant the manifest offers, so an old app
 * build, a native iOS player, or anything else gets shaped too. The client-side
 * `autoLevelCapping` is an additional refinement for mid-playback response, not
 * the enforcement mechanism.
 *
 * Variants appear lowest-first (RUNGS is ordered that way and ffmpeg preserves
 * it), so keeping the first N entries keeps the N lowest qualities.
 */
function capMasterPlaylist(text, maxRungs) {
  if (!maxRungs || maxRungs < 1) return text;
  const lines = String(text).split("\n");
  const header = [];
  /** @type {string[][]} */
  const variants = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      current = [line];
      variants.push(current);
    } else if (current) {
      current.push(line);
      // A variant is the STREAM-INF tag plus the URI line that follows it.
      if (line.trim() && !line.startsWith("#")) current = null;
    } else {
      header.push(line);
    }
  }
  if (variants.length <= maxRungs) return text;
  return [...header, ...variants.slice(0, maxRungs).flat()].join("\n");
}

module.exports = { record, touch, currentLoad, capMasterPlaylist, CAPACITY_MBPS };
