"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MigrationHint } from "@/components/MigrationHint";
import { useSaveStatus } from "@/lib/hooks";

interface OverrideStatus {
  votes: number;
  voters: string[];
  unlocked_until: string | null;
}

/**
 * Admin-only "break glass" for editing a member's email FOR them (the backup
 * when a member can't change their own). Because it rewrites someone's login,
 * it takes TWO different admins to vote, which unlocks email editing in the
 * Members panel for 24h; after that it re-locks. State lives in migration 0025
 * (request_admin_override / admin_override_status / cancel_admin_override); the
 * mini enforces the window again server-side before any write.
 */
export function AdminProfileOverride() {
  const [status, setStatus] = useState<OverrideStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // false until migration 0025 answers
  const { pending, status: msg, show, run } = useSaveStatus();

  const load = useCallback(async () => {
    const sb = supabase;
    if (!sb) return;
    const { data, error } = await sb.rpc("admin_override_status");
    if (error || !data) {
      setReady(false);
    } else {
      setReady(true);
      setStatus(data as OverrideStatus);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const requestUnlock = () =>
    run(async () => {
      const sb = supabase;
      if (!sb) return "Sign-in isn't available.";
      const { error } = await sb.rpc("request_admin_override");
      if (error) return error.message;
      await load();
      return "Your approval is recorded.";
    });

  const relock = () =>
    run(async () => {
      const sb = supabase;
      if (!sb) return "Sign-in isn't available.";
      const { error } = await sb.rpc("cancel_admin_override");
      if (error) return error.message;
      await load();
      return "Re-locked.";
    });

  const unlockedUntil = status?.unlocked_until ? new Date(status.unlocked_until) : null;
  const isUnlocked = !!unlockedUntil && unlockedUntil.getTime() > Date.now();
  const hoursLeft = isUnlocked
    ? Math.max(1, Math.round((unlockedUntil!.getTime() - Date.now()) / 3_600_000))
    : 0;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Edit a member&rsquo;s email</h2>
      </div>

      <p className="text-xs text-foreground/60">
        Members change their own email under their profile. This is the backup for
        when someone can&rsquo;t. Changing another person&rsquo;s login needs{" "}
        <strong>two admins</strong> to unlock it — then any admin can edit emails in{" "}
        <strong>Members</strong> for 24 hours.
      </p>

      {!ready && !loading ? (
        <MigrationHint file="0025_admin_profile_override.sql">
          To turn on the two-admin email-edit unlock,
        </MigrationHint>
      ) : loading ? (
        <p className="py-3 text-center text-xs text-foreground/45">Loading…</p>
      ) : isUnlocked ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-xs ring-1 ring-primary/30">
            <span className="text-base">🔓</span>
            <span className="font-medium text-foreground/80">
              Unlocked — email editing is on for about {hoursLeft}h. Go to{" "}
              <strong>Members</strong> to set someone&rsquo;s email.
            </span>
          </div>
          <button
            type="button"
            onClick={relock}
            disabled={pending}
            className="press rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground/60 ring-1 ring-border disabled:opacity-50"
          >
            {pending ? "…" : "Re-lock now"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-foreground/70">
            <span className="rounded-full bg-background px-2 py-0.5 font-semibold ring-1 ring-border">
              {status?.votes ?? 0}/2 approvals
            </span>
            {status?.voters && status.voters.length > 0 && (
              <span className="truncate text-foreground/50">{status.voters.join(", ")}</span>
            )}
          </div>
          <p className="text-xs text-foreground/50">
            Tap to add your approval. Once a second admin approves (within 30 min),
            email editing unlocks for 24 hours.
          </p>
          <button
            type="button"
            onClick={requestUnlock}
            disabled={pending}
            className="press rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "…" : "Approve unlock"}
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-foreground/60">{msg}</p>}
    </div>
  );
}
