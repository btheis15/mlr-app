"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSaveStatus } from "@/lib/hooks";
import { getMediaServerStatus, restartMediaServer, markModerationReviewed, deleteModerationItem, type MediaServerStatus, type MediaServerDisk, type MediaServerUsage, type MediaServerModeration, type MediaServerStorage, type MediaServerVolume, type MediaServerPatches } from "@/lib/admin";
import { useIdentity } from "@/components/IdentityProvider";
import { SkeletonCard } from "@/components/Skeleton";
import { formatBytes } from "@/lib/format";

// Segment/swatch color per media type (app breakdown). Kept on-brand rather than
// a generic chart palette so it matches the rest of the card.
const CAT_COLOR: Record<string, string> = {
  photo: "bg-primary", // forest green
  video: "bg-accent", // chestnut
  other: "bg-muted", // grey
};

function Swatch({ className }: { className: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${className}`} />;
}

/**
 * AI safety-scan progress, owner-only. Answers "how much has actually been
 * checked, and is anything waiting on me?" — the queue alone couldn't, because a
 * resolved item is dropped from it, so nothing tracked the running total.
 *
 * Two very different states are deliberately worded differently:
 *  - `flagged` — the model SAW something (nudity/violence/drugs). Already hidden
 *    from the family, approved in the album itself.
 *  - `gaveUp`  — the model REFUSED to read the photo, or re-checks ran out. Left
 *    VISIBLE on purpose (a refusal is weak evidence and fires on ordinary
 *    photos), with a push sent so it gets looked at promptly rather than sitting.
 */
function SafetyScans({
  moderation,
  onReviewed,
}: {
  moderation: MediaServerModeration;
  onReviewed: () => void;
}) {
  const { user } = useIdentity();
  const [busy, setBusy] = useState<string | null>(null);
  // Which row's Delete is armed for a second confirming tap — deleting is
  // destructive (the file + its *_media row are gone for good), so it isn't
  // one tap away like "Approve" (which only clears the review list, nothing else).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<{ url: string; message: string } | null>(null);
  const review = moderation.gaveUp ?? [];
  // "52 of 156" — everything the model has resolved, out of that plus whatever
  // is still queued, so the denominator is the real total it has to get through.
  const total = moderation.scanned + moderation.pending;
  const approved = Math.max(0, moderation.scanned - moderation.flagged);

  const dismiss = async (url: string) => {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (!token) {
      setError({ url, message: "Sign in again to review this." });
      return;
    }
    setError(null);
    setBusy(url);
    try {
      await markModerationReviewed(token, url);
      onReviewed();
    } catch (err) {
      // Surface it — silently doing nothing is exactly what reads as "the
      // button is broken" when the request actually just failed.
      setError({ url, message: err instanceof Error ? err.message : "Couldn't clear this — try again." });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (url: string, relPath: string) => {
    if (confirmDelete !== url) {
      setConfirmDelete(url);
      setError(null);
      return;
    }
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (!token) {
      setError({ url, message: "Sign in again to delete this." });
      return;
    }
    setError(null);
    setBusy(url);
    try {
      await deleteModerationItem(token, url, relPath);
      setConfirmDelete(null);
      onReviewed();
    } catch (err) {
      setError({ url, message: err instanceof Error ? err.message : "Couldn't delete this — try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Safety scans</p>
        {moderation.models && <p className="text-[11px] text-faint">{moderation.models}</p>}
      </div>
      <p className="text-sm">
        <span className="font-semibold">{moderation.scanned.toLocaleString()}</span> of{" "}
        <span className="font-semibold">{total.toLocaleString()}</span> scanned
        {" — "}
        {approved.toLocaleString()} cleared
        {moderation.flagged > 0 && <>, {moderation.flagged.toLocaleString()} flagged</>}
        {review.length > 0 && <>, {review.length.toLocaleString()} to review</>}
      </p>
      {moderation.pending > 0 && (
        <p className="text-xs text-muted">
          {moderation.pending.toLocaleString()} waiting on the model — re-checked every 15 minutes, so this catches up on
          its own.
        </p>
      )}

      {review.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-semibold text-accent">For review</p>
          <p className="text-[11px] text-muted">
            The safety check couldn&rsquo;t read these, so they&rsquo;re still visible in their album. View it, then either
            Delete it (removes the file for good) or tap Approve to keep it and clear this list.
          </p>
          {review.map((r) => (
            <div key={r.url} className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-xl bg-background px-2.5 py-2 ring-1 ring-border">
                {r.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- mini-hosted, no loader
                  <img src={r.url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base">
                    🎬
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{r.reason || "couldn't be scanned"}</p>
                  <p className="truncate text-[11px] text-faint">{r.relPath}</p>
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="press shrink-0 rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold text-primary ring-1 ring-border"
                >
                  View
                </a>
                <button
                  type="button"
                  onClick={() => remove(r.url, r.relPath)}
                  disabled={busy === r.url || !user}
                  className={`press shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                    confirmDelete === r.url ? "bg-accent text-white" : "bg-accent/10 text-accent"
                  }`}
                >
                  {busy === r.url ? "…" : confirmDelete === r.url ? "Confirm delete" : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(r.url)}
                  disabled={busy === r.url || !user}
                  className="press shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary disabled:opacity-50"
                >
                  {busy === r.url ? "…" : "Approve"}
                </button>
              </div>
              {error?.url === r.url && <p className="px-1 text-[11px] font-medium text-accent">{error.message}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Whole-drive space, split three ways: what MLR itself stores (green), everything
 * else on the drive — personal, non-app files (grey), and what's free. Lets the
 * owner see at a glance that the app is a tiny sliver of a drive mostly holding
 * their own stuff.
 *
 * The "other" segment is a NEUTRAL grey (`bg-zinc-400`), deliberately not the
 * `muted` token — that token is `#4b5b52`, a green-tinted slate, and reading as
 * another shade of the brand green made personal files look like part of the
 * app's own storage. The point of this bar is that they're unrelated.
 */
function DriveStorage({ disk, appBytes }: { disk: MediaServerDisk; appBytes: number }) {
  const total = disk.totalBytes || 1;
  const app = Math.max(0, Math.min(appBytes, disk.usedBytes));
  const other = Math.max(0, disk.usedBytes - app); // personal / non-app
  const usedPct = (disk.usedBytes / total) * 100;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">Drive storage</p>
        <p className="text-xs text-muted">
          {disk.external ? "External drive" : "Internal disk"} · {Math.round(usedPct)}% full
        </p>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-background">
        {app > 0 && <div className="h-full bg-primary" style={{ width: `${Math.max((app / total) * 100, 0.5)}%` }} />}
        {other > 0 && <div className="h-full bg-zinc-400" style={{ width: `${(other / total) * 100}%` }} />}
      </div>
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-2">
          <Swatch className="bg-primary" />
          <span className="font-medium">MLR app</span>
          <span className="ml-auto">{formatBytes(app)}</span>
        </p>
        <p className="flex items-center gap-2 text-muted">
          <Swatch className="bg-zinc-400" />
          <span>Other (personal, non-app)</span>
          <span className="ml-auto">{formatBytes(other)}</span>
        </p>
        <p className="flex items-center gap-2">
          <Swatch className="bg-background ring-1 ring-border" />
          <span className="font-medium">Free</span>
          <span className="ml-auto font-semibold">{formatBytes(disk.freeBytes)}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * The app's own footprint, broken down by media type — a proportional bar +
 * per-type count/size. Each object's auto-generated thumbnail is folded into its
 * size (a photo's bytes include its thumbnail), and counts are real objects.
 */
function AppUsage({ usage }: { usage: MediaServerUsage }) {
  const total = usage.totalBytes || 1;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">MLR App storage</p>
        <p className="text-sm">
          <span className="font-semibold">{formatBytes(usage.totalBytes)}</span>
          <span className="text-muted"> · {usage.totalFiles.toLocaleString()} files</span>
        </p>
      </div>
      {usage.categories.length > 0 && (
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-background">
          {usage.categories.map((c) => (
            <div key={c.key} className={`h-full ${CAT_COLOR[c.key] ?? "bg-muted"}`} style={{ width: `${(c.bytes / total) * 100}%` }} />
          ))}
        </div>
      )}
      <div className="space-y-1 text-sm">
        {usage.categories.map((c) => (
          <p key={c.key} className="flex items-center gap-2">
            <Swatch className={CAT_COLOR[c.key] ?? "bg-muted"} />
            <span className="font-medium">{c.label}</span>
            <span className="text-muted">{c.files.toLocaleString()}</span>
            <span className="ml-auto">{formatBytes(c.bytes)}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Both storage volumes, each with its drive meter + app-footprint breakdown.
 *
 * The SSD is where every read is served from; the external drive is the backup
 * mirror and the home for anything over the per-file SSD limit. The two cases
 * worth surfacing loudly are a drive that's unplugged (media stored only there
 * is 404ing right now) and no backup drive configured at all (nothing has a
 * second copy) — both are quiet failures otherwise.
 */
function Volumes({ storage }: { storage: MediaServerStorage }) {
  const { hot, cold } = storage;
  return (
    <div className="space-y-3">
      <VolumeBlock volume={hot} />
      {cold ? (
        cold.mounted ? (
          <VolumeBlock volume={cold} />
        ) : (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-sm font-semibold">{cold.label} · backup</p>
            <p className="text-sm text-accent">
              Not plugged in. New photos aren&apos;t being backed up, and anything stored only on this drive
              won&apos;t load until it&apos;s reconnected.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-1 border-t border-border pt-3">
          <p className="text-sm font-semibold">Backup</p>
          <p className="text-sm text-accent">No backup drive is set up — photos and videos have only one copy.</p>
        </div>
      )}
    </div>
  );
}

function VolumeBlock({ volume }: { volume: MediaServerVolume }) {
  return (
    <div className="space-y-2">
      <p className="border-t border-border pt-3 text-sm font-semibold">
        {volume.label}
        <span className="ml-1.5 font-normal text-muted">
          · {volume.role === "primary" ? "primary — everything loads from here" : "backup"}
        </span>
      </p>
      {volume.disk ? <DriveStorage disk={volume.disk} appBytes={volume.usage?.totalBytes ?? 0} /> : null}
      {volume.usage ? <AppUsage usage={volume.usage} /> : null}
    </div>
  );
}

/**
 * Security patches available for the software this mini exposes to the internet.
 *
 * Port 443 now reaches Caddy -> the media server directly, so Caddy, Node and the
 * production npm tree are internet-facing. The scan runs weekly and only REPORTS —
 * nothing is upgraded unattended, because a broken sharp or Caddy takes the
 * family's photos offline with nobody watching.
 */
function Patches({ patches }: { patches: MediaServerPatches }) {
  const { outdated, audit } = patches;
  const sev = (audit.critical || 0) + (audit.high || 0);
  if (!patches.needsAttention) {
    return (
      <div className="space-y-1 border-t border-border pt-3">
        <p className="text-sm font-semibold">Security patches</p>
        <p className="text-sm text-muted">Everything up to date ✓</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <p className="text-sm font-semibold">Security patches available</p>
      {outdated.length > 0 && (
        <ul className="space-y-0.5">
          {outdated.map((o) => (
            <li key={o.name} className="text-sm text-muted">
              <span className="font-medium text-foreground">{o.name}</span> {o.current} → {o.latest}
            </li>
          ))}
        </ul>
      )}
      {sev > 0 && (
        <p className="text-sm text-accent">
          {sev} high/critical advisor{sev === 1 ? "y" : "ies"} in server dependencies
        </p>
      )}
      <p className="text-xs text-muted">
        Nothing is installed automatically. On the mini:{" "}
        <code className="rounded bg-background px-1">brew upgrade caddy</code> ·{" "}
        <code className="rounded bg-background px-1">npm audit fix</code>, then restart.
      </p>
    </div>
  );
}

async function currentToken(): Promise<string | null> {
  const sb = supabase;
  return (await sb?.auth.getSession())?.data.session?.access_token ?? null;
}

/**
 * Restarts the media server running on the mac mini (push/APNs/mailer/
 * moderation/uploads — see CLAUDE.md "Mac-mini media server"). Pulls
 * origin/main (fast-forward only) into the mini's checkout, then exits the
 * process so launchd's KeepAlive relaunches it within ~10s on the new code —
 * the same "git pull + restart" cycle that otherwise needed someone on the
 * mini itself. A brief connection drop during the relaunch is expected; push/
 * email/uploads resume once it's back (usually well under a minute).
 */
export function AdminMediaServer() {
  const [status, setStatus] = useState<MediaServerStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const save = useSaveStatus(6000);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const token = await currentToken();
      if (!token) throw new Error("Sign in again to check the server.");
      setStatus(await getMediaServerStatus(token));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't reach the mini.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restart = () =>
    save.run(async () => {
      setConfirming(false);
      const token = await currentToken();
      if (!token) return "Sign in again to restart the server.";
      try {
        const r = await restartMediaServer(token);
        // The process exits right after responding, so give launchd a few
        // seconds (ThrottleInterval is 10s) before re-checking status.
        setTimeout(load, 12000);
        return r.updated
          ? `Updated ${r.from} → ${r.to} (${r.filesChanged} file${r.filesChanged === 1 ? "" : "s"}) and restarting…`
          : "Already on the latest code — restarting anyway…";
      } catch (err) {
        return err instanceof Error ? err.message : "Couldn't restart the server.";
      }
    });

  if (loading) return <SkeletonCard />;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <p className="text-sm font-semibold">Status</p>
      {loadError ? (
        <p className="text-sm text-accent">{loadError}</p>
      ) : status ? (
        <div className="space-y-1 text-sm">
          <p>
            Running commit <code className="rounded bg-background px-1 py-0.5">{status.commit}</code>
          </p>
          <p className={status.upToDate ? "text-primary" : "text-accent"}>
            {status.upToDate
              ? "Up to date with origin/main ✓"
              : `${status.behind} commit${status.behind === 1 ? "" : "s"} behind origin/main`}
          </p>
          {status.storage ? (
            <Volumes storage={status.storage} />
          ) : (
            /* Older mini, before tiered storage — one volume only. */
            <>
              {status.disk ? <DriveStorage disk={status.disk} appBytes={status.usage?.totalBytes ?? 0} /> : null}
              {status.usage ? <AppUsage usage={status.usage} /> : null}
            </>
          )}
          {status.quarantine && status.quarantine.files > 0 ? (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-sm font-semibold">Deleted media</p>
              <p className="text-sm text-muted">
                {status.quarantine.files.toLocaleString()} file
                {status.quarantine.files === 1 ? "" : "s"} ({formatBytes(status.quarantine.bytes)}) removed from the
                app and held on the external drive
                {status.quarantine.nextPurgeInDays != null
                  ? `, deleted for good in ${status.quarantine.nextPurgeInDays} day${status.quarantine.nextPurgeInDays === 1 ? "" : "s"}`
                  : ""}
                .
              </p>
            </div>
          ) : null}
          {status.patches ? <Patches patches={status.patches} /> : null}
          {status.moderation ? (
            <SafetyScans moderation={status.moderation} onReviewed={load} />
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-1">
        {save.status && <span className="text-xs font-medium text-primary">{save.status}</span>}
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="press rounded-full px-4 py-2 text-sm font-semibold text-foreground/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={restart}
              disabled={save.pending}
              className="press rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {save.pending ? "Restarting…" : "Yes, pull & restart"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={save.pending}
            className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Pull latest & restart
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Pulls the latest merged code and restarts the process. Push notifications, email, and
        uploads pause for a few seconds while it comes back up.
      </p>
    </div>
  );
}
