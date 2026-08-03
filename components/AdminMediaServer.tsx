"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSaveStatus } from "@/lib/hooks";
import { getMediaServerStatus, restartMediaServer, type MediaServerStatus, type MediaServerDisk } from "@/lib/admin";
import { SkeletonCard } from "@/components/Skeleton";
import { formatBytes } from "@/lib/format";

/** Drive space for the media store — a usage bar + free/used/total, so the
 *  owner can watch the drive fill up right from the app. */
function StorageMeter({ disk }: { disk: MediaServerDisk }) {
  const usedPct = disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
  // Green normally; amber past 80%, red past 90% — a full media drive means
  // uploads start failing, so surface the pressure before it's a problem.
  const barColor = usedPct >= 90 ? "bg-accent" : usedPct >= 80 ? "bg-fest" : "bg-primary";
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">Storage</p>
        <p className="text-xs text-muted">{disk.external ? "External drive" : "Internal disk"}</p>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-background" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(2, usedPct))}%` }} />
      </div>
      <p className="text-sm">
        <span className="font-semibold">{formatBytes(disk.freeBytes)} free</span>
        <span className="text-muted">
          {" "}
          · {formatBytes(disk.usedBytes)} used of {formatBytes(disk.totalBytes)} ({Math.round(usedPct)}%)
        </span>
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
          {status.disk ? <StorageMeter disk={status.disk} /> : null}
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
