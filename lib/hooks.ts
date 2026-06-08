"use client";

// Small shared React hooks. Keep cross-component stateful patterns here so the
// components stay focused on their UI (the same spirit as lib/format.ts for
// formatting).

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchMyCommitteeRole } from "@/lib/roles";

/**
 * Track a single in-flight action by id (the row/button being acted on) so a
 * list can disable just that control and show a spinner. `run(id, fn)` sets
 * `busy = id` for the duration of `fn`, then clears it — even if `fn` throws.
 */
export function useBusyAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(id: string, fn: () => PromiseLike<T>): Promise<T> => {
    setBusy(id);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, run };
}

/**
 * A debounced scheduler for coalescing bursts (e.g. a flurry of realtime row
 * events into one refetch). Returns `[schedule, cancel]`: `schedule(fn)` runs
 * `fn` after `delay` ms, replacing any pending call; `cancel()` drops a pending
 * call (use it in effect cleanup so a stale callback can't fire after a
 * re-subscribe/unmount). The timer is also cleared automatically on unmount.
 */
export function useDebouncedCallback(delay: number): [(fn: () => void) => void, () => void] {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);
  const schedule = useCallback(
    (fn: () => void) => {
      cancel();
      timer.current = setTimeout(fn, delay);
    },
    [cancel, delay],
  );
  return [schedule, cancel];
}

/**
 * Form feedback for a save/submit action: a `pending` flag plus a transient
 * `status` message that auto-dismisses (and is cleaned up on unmount, so no
 * stray timers). `show(msg, ms)` sets the message — pass `ms = 0` to make it
 * stick (e.g. a persistent error). `run(fn)` flips `pending` around `fn` and,
 * if it returns a string, shows it.
 */
export function useSaveStatus(defaultDismissMs = 3000) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = useCallback(
    (msg: string | null, ms: number = defaultDismissMs) => {
      if (timer.current) clearTimeout(timer.current);
      setStatus(msg);
      if (msg && ms > 0) timer.current = setTimeout(() => setStatus(null), ms);
    },
    [defaultDismissMs],
  );

  const run = useCallback(
    async (fn: () => Promise<string | null | void>, ms: number = defaultDismissMs) => {
      setPending(true);
      try {
        const msg = await fn();
        // A string shows it; null clears; `undefined` (void) leaves whatever the
        // handler set itself (e.g. a persistent error via `show(..., 0)`).
        if (msg !== undefined) show(msg, ms);
      } finally {
        setPending(false);
      }
    },
    [defaultDismissMs, show],
  );

  return { pending, status, show, run };
}

/**
 * A photo/video picker for composers: holds the chosen `File`s and their
 * preview entries, mints object URLs for the previews, and revokes them all on
 * unmount. `add` handles a file <input> change; `removeAt` drops one;
 * `reset` clears everything after a successful post.
 */
export function useMediaPicker() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; type: "image" | "video" }[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const nf = [...files];
    const np = [...previews];
    for (const f of Array.from(list)) {
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      nf.push(f);
      np.push({ url, type: f.type.startsWith("video") ? "video" : "image" });
    }
    setFiles(nf);
    setPreviews(np);
    e.target.value = "";
  };
  const removeAt = (i: number) => {
    setFiles((f) => f.filter((_, idx) => idx !== i));
    setPreviews((p) => p.filter((_, idx) => idx !== i));
  };
  const reset = () => {
    setFiles([]);
    setPreviews([]);
  };
  return { files, previews, add, removeAt, reset };
}

/**
 * Shared plumbing for the committee management panels (roster, join requests):
 * resolve the committee id from its slug, decide whether the viewer can manage
 * it (app admin or this committee's Lead — migration 0015), run an initial
 * `load`, and keep it live by re-running `load` on changes to the watched table.
 * Returns the resolved id, the manage gate (with a setter for the leave-self
 * case that drops a non-admin's access), and the viewer's admin flag.
 */
/**
 * Live unread-notifications count for the Notifications tab badge (migration
 * 0030). Counts the signed-in member's notifications that are unseen AND not
 * expired — so opening the tab (which stamps seen_at via mark_notifications_seen)
 * or an item expiring both drop the count, while the items themselves stay in
 * the list. Keeps itself fresh with a Realtime subscription on the member's own
 * rows (debounced), and re-runs when sign-in state flips. Always reads the REAL
 * session id (not an admin "view as" preview) — the badge is your own account's.
 */
export function useUnreadNotifications(): number {
  const { user } = useIdentity();
  const signedIn = !!user;
  const [count, setCount] = useState(0);
  const [schedule] = useDebouncedCallback(250);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !signedIn) {
      setCount(0);
      return;
    }
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const refresh = async (uid: string) => {
      const nowIso = new Date().toISOString();
      const { count: c } = await sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", uid)
        .is("seen_at", null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (!cancelled) setCount(c ?? 0);
    };

    (async () => {
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) {
        if (!cancelled) setCount(0);
        return;
      }
      await refresh(uid);
      channel = sb
        .channel(`notif-badge-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${uid}` },
          () => schedule(() => refresh(uid)),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [signedIn, schedule]);

  return count;
}

export function useManagedCommittee(
  slug: string,
  opts: { watch: string; load: (committeeId: string) => Promise<void> | void },
) {
  const { isAdmin } = useIdentity();
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  // Always call the latest `load` without making it a dependency (it's a fresh
  // closure each render), so the effect only re-runs on slug/admin changes.
  const loadRef = useRef(opts.load);
  loadRef.current = opts.load;

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      const cid = await fetchCommitteeId(slug);
      if (!cid || cancelled) return;
      setCommitteeId(cid);
      const manage = isAdmin || (await fetchMyCommitteeRole(cid)) === "Lead";
      if (cancelled) return;
      setCanManage(manage);
      if (!manage) return;
      await loadRef.current(cid);
      if (cancelled) return;
      channel = sb
        .channel(`mc-${opts.watch}-${slug}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: opts.watch, filter: `committee_id=eq.${cid}` },
          () => loadRef.current(cid),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isAdmin]);

  return { committeeId, canManage, setCanManage, isAdmin };
}
