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
