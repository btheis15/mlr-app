"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSaveStatus } from "@/lib/hooks";
import { getMediaServerStatus, restartMediaServer, type MediaServerStatus, type MediaServerDisk, type MediaServerUsage } from "@/lib/admin";
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
 * Whole-drive space, split three ways: what MLR itself stores (green), everything
 * else on the drive — personal, non-app files (grey), and what's free. Lets the
 * owner see at a glance that the app is a tiny sliver of a drive mostly holding
 * their own stuff.
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
        {other > 0 && <div className="h-full bg-muted" style={{ width: `${(other / total) * 100}%` }} />}
      </div>
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-2">
          <Swatch className="bg-primary" />
          <span className="font-medium">MLR app</span>
          <span className="ml-auto">{formatBytes(app)}</span>
        </p>
        <p className="flex items-center gap-2 text-muted">
          <Swatch className="bg-muted" />
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
          {status.disk ? <DriveStorage disk={status.disk} appBytes={status.usage?.totalBytes ?? 0} /> : null}
          {status.usage ? <AppUsage usage={status.usage} /> : null}
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
