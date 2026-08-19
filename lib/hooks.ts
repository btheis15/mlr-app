"use client";

// Small shared React hooks. Keep cross-component stateful patterns here so the
// components stay focused on their UI (the same spirit as lib/format.ts for
// formatting).

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchMyCommitteeRole } from "@/lib/roles";
import {
  effectiveStatus,
  fetchAttendance,
  fetchEvents,
  fetchMyAttendance,
  setAttendance,
  summarize,
  type RsvpResult,
} from "@/lib/events";
import { fetchHelpRequests } from "@/lib/helpRequests";
import {
  fetchTournamentsForHost,
  applyMatchResult,
  recordMatchResult,
  type Tournament,
  type TournamentHost,
} from "@/lib/tournaments";
import { fetchPrivateActivities, type PrivateActivity } from "@/lib/privateActivities";
import { fetchDropBoxes, fetchDropBox, type DropBox } from "@/lib/dropBoxes";
import {
  fetchHouseRequests,
  fetchIsHouseAdmin,
  NO_HOUSE_REQUESTS,
  type HouseRequest,
  type HouseRequestsResult,
} from "@/lib/houseRequests";
import { markPending } from "@/lib/appReady";
import { readPersisted, useCachedResource, writePersisted } from "@/lib/swrCache";
import { canEditFest } from "@/lib/festContent";
import {
  createHouseStay,
  deleteHouseStay,
  fetchHouseStays,
  updateHouseStay,
  type StayInput,
} from "@/lib/houseCalendar";
import {
  addHouseListItem,
  clearCheckedHouseListItems,
  createHouseList,
  deleteHouseList,
  deleteHouseListItem,
  fetchHouseLists,
  setHouseListItemChecked,
  uncheckHouseListItems,
  updateHouseList,
  updateHouseListItem,
  type HouseListInput,
} from "@/lib/houseLists";
import { fetchHouseBySlug, fetchMyHouse } from "@/lib/houses";
import type {
  AttendanceStatus,
  AttendanceSummary,
  EventAttendance,
  HelpRequest,
  House,
  HouseList,
  HouseStay,
  ResortEvent,
} from "@/lib/types";

// One-time monkey-patch so client-side navigations (router.push/replace to
// the SAME route, which Next doesn't remount for) are observable without
// pulling in useSearchParams (that forces a Suspense boundary around the
// whole page — see PostsView's original deep-link comment). Idempotent;
// safe to call from every useUrlParam mount.
let urlPatchInstalled = false;
function ensureUrlChangePatched() {
  if (urlPatchInstalled || typeof window === "undefined") return;
  urlPatchInstalled = true;
  const notify = () => window.dispatchEvent(new Event("mlr:locationchange"));
  const wrap = (fn: History["pushState"]): History["pushState"] =>
    function (this: History, ...args: Parameters<History["pushState"]>) {
      const ret = fn.apply(this, args);
      notify();
      return ret;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener("popstate", notify);
}

/**
 * Reactively read one query-string param off the CURRENT url. Unlike a
 * one-shot `new URLSearchParams(window.location.search)` read in a mount
 * effect, this updates whenever the url changes client-side — including a
 * second `router.push()` to the same route (e.g. tapping a second Activity
 * notification while already on /posts), which Next doesn't remount for.
 * Returns null until the first client tick (hydration-safe) and whenever the
 * param is absent.
 */
export function useUrlParam(name: string): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    ensureUrlChangePatched();
    const read = () => setValue(new URLSearchParams(window.location.search).get(name));
    read();
    window.addEventListener("mlr:locationchange", read);
    return () => window.removeEventListener("mlr:locationchange", read);
  }, [name]);
  return value;
}

/**
 * Deep-link scroll-and-flash: once `target` (a query-param value, e.g. a post
 * or message id) and `ready` (the real data load, NOT an unrelated "some
 * local state settled" flag) are both set, poll for `#${idPrefix}${target}`
 * until it exists in the DOM (up to ~3s) and scroll+flash it. Handles the
 * common failure mode where the id shows up in the DOM a beat after `ready`
 * flips (still rendering a long list, or the cold-open snapshot doesn't yet
 * contain an older item that the full fetch hasn't landed for). Re-arms
 * whenever `target` changes, so a second deep-link to a new id works even
 * without a remount. Returns the currently-flashed id (or null) to drive a
 * ring/highlight class.
 */
export function useDeepLinkFlash(idPrefix: string, target: string | null, ready: boolean): string | null {
  const [flashId, setFlashId] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);
  // The very FIRST deep-link landed on for a given mount snaps straight there
  // (no animation) — the room/feed hasn't shown the viewer anything to scroll
  // "from" yet, so an animated scroll here just reads as an extra visible hop
  // on top of whatever load/transition already got them here. Once one has
  // landed, a second deep-link arriving later (a new search/notification tap
  // without a remount) DOES scroll smoothly, since that one's motion is the
  // useful cue that the view actually moved.
  const hasLandedRef = useRef(false);
  useEffect(() => {
    if (!target || !ready || typeof document === "undefined") return;
    if (handledRef.current === target) return;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(`${idPrefix}${target}`);
      if (el) {
        handledRef.current = target;
        el.scrollIntoView({ behavior: hasLandedRef.current ? "smooth" : "auto", block: "center" });
        hasLandedRef.current = true;
        setFlashId(target);
        setTimeout(() => setFlashId((cur) => (cur === target ? null : cur)), 2200);
        return;
      }
      attempts += 1;
      if (attempts < 20) setTimeout(tryScroll, 150); // ~3s of retries
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [idPrefix, target, ready]);
  return flashId;
}

/**
 * The dismiss pattern shared by every sheet/overlay: flip `closing` so the
 * panel plays its -close animation, then call `onClose` once it finishes;
 * Escape closes too. Honors the OS reduce-motion toggle by closing
 * immediately. `dismissThen(fn)` is for overlays with more than one exit
 * (e.g. a cropper's cancel vs save) — it runs `fn` instead of `onClose`.
 */
export function useSheetDismiss(onClose: () => void, ms = 440) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const done = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const dismissThen = useCallback(
    (fn?: () => void) => {
      if (done.current) return;
      done.current = true;
      const finish = () => (fn ?? closeRef.current)();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
      }
      setClosing(true);
      timer.current = window.setTimeout(finish, ms);
    },
    [ms],
  );
  // Stable zero-arg close — safe to pass straight to onClick (drops the event).
  const close = useCallback(() => dismissThen(), [dismissThen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [close]);

  return { closing, close, dismissThen };
}

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
  // Rides the shared SWR cache (lib/swrCache), persisted per account: the
  // badge paints the last-known count on the first tick of a cold open (no
  // 0 → N flicker) and revalidates in the background. Keyed on the REAL
  // session uid — the badge is always your own account's, never a preview's.
  const { user, userId } = useIdentity();
  const signedIn = !!user && !!userId;
  const [schedule] = useDebouncedCallback(250);

  const { data: count, reload } = useCachedResource<number>(
    isSupabaseConfigured && signedIn ? `unread.${userId}` : null,
    0,
    async () => {
      const sb = supabase;
      if (!sb || !userId) return 0;
      const nowIso = new Date().toISOString();
      const { count: c } = await sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .is("seen_at", null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      return c ?? 0;
    },
    { persist: "local" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !signedIn || !userId) return;
    const channel = sb
      .channel(`notif-badge-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        () => schedule(reload),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [signedIn, userId, schedule, reload]);

  return count;
}

// Stale-while-revalidate cache for the committee-management gate, keyed by
// slug + viewer identity (admin flag + previewed member, mirroring useEvents'
// previewAsId key). Without it the Lead/admin-only panels start hidden
// (canManage=false) on every visit and pop in a moment later — reads like an RLS
// glitch. Memory for tab switches, plus a persisted copy (never for previews)
// so a cold app open paints the gate right too. Written only inside the effect /
// exposed setter (never during SSR), so a cold first render still yields
// canManage=false to match the server-rendered HTML — no hydration mismatch. The
// effect always re-fetches and overwrites, so a revoked Lead flips back to false.
const managedCommitteeCache = new Map<string, { committeeId: string | null; canManage: boolean }>();

export function useManagedCommittee(
  slug: string,
  opts: { watch: string; load: (committeeId: string) => Promise<void> | void },
) {
  const { user, userId, isAdmin, previewAsId } = useIdentity();
  // Include the real viewer identity: without it two different non-admin members
  // collide on `slug|false|self`, so a non-Lead briefly paints the Lead/admin
  // management panel from another viewer's cached canManage:true.
  const key = `${slug}|${user?.email ?? "guest"}|${isAdmin}|${previewAsId ?? "self"}`;
  const storeKey = userId && !previewAsId ? `managedCommittee.${userId}.${slug}.${isAdmin}` : null;
  const cached = managedCommitteeCache.get(key);
  const [committeeId, setCommitteeId] = useState<string | null>(cached?.committeeId ?? null);
  const [canManage, setCanManage] = useState(cached?.canManage ?? false);
  // Always call the latest `load` without making it a dependency (it's a fresh
  // closure each render), so the effect only re-runs on slug/admin changes.
  const loadRef = useRef(opts.load);
  loadRef.current = opts.load;

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    // Cold open: restore the persisted gate (post-mount, hydration-safe) so a
    // Lead/admin's management panels don't pop in a beat late; the fetch below
    // still re-derives and overwrites.
    if (!managedCommitteeCache.has(key) && storeKey) {
      const snap = readPersisted<{ committeeId: string | null; canManage: boolean }>(storeKey);
      if (snap) {
        managedCommitteeCache.set(key, snap);
        setCommitteeId(snap.committeeId);
        setCanManage(snap.canManage);
      }
    }
    (async () => {
      const cid = await fetchCommitteeId(slug);
      if (!cid || cancelled) return;
      setCommitteeId(cid);
      // While previewing as a member, judge "can manage" by THAT member's role
      // (isAdmin is already forced off in preview), so the preview is faithful.
      const manage = isAdmin || (await fetchMyCommitteeRole(cid, previewAsId ?? undefined)) === "Lead";
      if (cancelled) return;
      setCanManage(manage);
      // Source of truth for the cache — the effect always runs and overwrites
      // with the freshly fetched gate, so a revoked Lead corrects to false.
      managedCommitteeCache.set(key, { committeeId: cid, canManage: manage });
      if (storeKey) writePersisted(storeKey, { committeeId: cid, canManage: manage });
      if (!manage) return;
      await loadRef.current(cid);
      if (cancelled) return;
      // committee_roster is keyed by slug (no committee_id column); every other
      // watched table is keyed by committee_id.
      const watchFilter =
        opts.watch === "committee_roster" ? `committee_slug=eq.${slug}` : `committee_id=eq.${cid}`;
      channel = sb
        .channel(`mc-${opts.watch}-${slug}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: opts.watch, filter: watchFilter },
          () => loadRef.current(cid),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isAdmin, previewAsId]);

  // Wrapped setter for the leave-self path (CommitteeMembers): keep the cache in
  // sync so revisiting doesn't paint a stale `true` before the refetch corrects.
  const setCanManageCached = useCallback(
    (v: boolean) => {
      managedCommitteeCache.set(key, { committeeId, canManage: v });
      if (storeKey) writePersisted(storeKey, { committeeId, canManage: v });
      setCanManage(v);
    },
    [key, storeKey, committeeId],
  );

  return { committeeId, canManage, setCanManage: setCanManageCached, isAdmin };
}

export interface UseEvents {
  events: ResortEvent[];
  /** Roster + counts per event id. */
  summaries: Record<string, AttendanceSummary>;
  /** The viewer's own RSVP per event id (the previewed member's, while previewing). */
  mine: Record<string, EventAttendance>;
  loading: boolean;
  /** True when RSVPs can actually be written (a backend exists). */
  canRsvp: boolean;
  /** Set the viewer's RSVP for an event (optimistic). Prompts sign-in for guests;
   *  no-op while an admin is previewing as someone else. Resolves `false` (and
   *  rolls the optimistic `mine`/tally update back) if the write fails, so the
   *  caller can surface an inline retry message. A tap that lands while one is
   *  already in flight for the same event id rides along on that call's result
   *  instead of firing a second write. */
  /** Save my RSVP. See `RsvpResult` — a string is a failure WITH its reason,
   *  which the control puts on screen (migration 0210's lesson). */
  setStatus: (eventId: string, status: AttendanceStatus, days?: Record<string, AttendanceStatus> | null) => Promise<RsvpResult>;
  reload: () => Promise<void>;
}

/** `AttendanceSummary.counts` keys are `going` / `maybe` / `notGoing`;
 *  `AttendanceStatus` (and `effectiveStatus()`) spells the last one `not_going`.
 *  Bridges the two for the optimistic count nudge in `setStatus`. */
function countKey(status: AttendanceStatus): keyof AttendanceSummary["counts"] {
  return status === "not_going" ? "notGoing" : status;
}

/**
 * Loads the resort calendar (events ∪ seed) + attendance and the viewer's own
 * RSVPs, exposes per-event summaries, and writes RSVPs optimistically. Centralizes
 * the events feature's data flow so Home (`UpcomingEvents`) and the `/events` page
 * share one implementation (the spirit of `useManagedCommittee`). Pass
 * `{ realtime: true }` on the full page to keep counts live; Home loads once.
 */
/**
 * Stale-while-revalidate cache for the events feed. `useEvents` remounts on every
 * tab navigation; without this it resets to empty + `loading`, so Home's "Upcoming
 * Up North" and the /events calendar blank out and then pop back in — shoving the
 * page around. Holding the last result in memory lets a returning tab paint
 * instantly from cache while a background refetch keeps it current, so the layout
 * stays put. Two layers now: this module memory (tab switches) plus a persisted
 * copy under `mlr.cache.v1.events.<uid|guest>` (lib/swrCache) restored in a
 * post-mount effect, so a COLD app open paints the calendar instantly too.
 * Memory is only ever written *after* a client fetch — never during SSR — so it
 * can't change the server/first-paint render and can't cause a hydration
 * mismatch (a cold first render starts with an empty cache, i.e. the original
 * behavior; the storage seed lands one effect tick later).
 */
interface EventsSnapshot {
  events: ResortEvent[];
  rows: EventAttendance[];
  mine: Record<string, EventAttendance>;
}
let eventsCache: EventsSnapshot | null = null;

export function useEvents(opts?: { realtime?: boolean }): UseEvents {
  const { user, userId, authReady, previewAsId, promptSignIn } = useIdentity();
  const [events, setEvents] = useState<ResortEvent[]>(eventsCache?.events ?? []);
  const [rows, setRows] = useState<EventAttendance[]>(eventsCache?.rows ?? []);
  const [mine, setMine] = useState<Record<string, EventAttendance>>(eventsCache?.mine ?? {});
  // Warm cache ⇒ paint immediately (no skeleton/blank); still refetch in the
  // background below so the cached view is brought up to date.
  const [loading, setLoading] = useState(!eventsCache);
  // Splash readiness (lib/appReady): registered on a cold open when nothing
  // could seed, resolved when the first load lands (or on unmount).
  const pendingDoneRef = useRef<(() => void) | null>(null);

  // Persisted snapshot seed (post-mount, cold open only): the module cache
  // dies with the JS context, so restore the last known snapshot from storage
  // (`events.<uid>` — per account since `mine` is the viewer's own RSVPs;
  // `events.guest` for signed-out browsing). Never while previewing, and a
  // member key is only known once `userId` resolves (waiting for authReady
  // before falling back to "guest" so a member never seeds the guest copy).
  useEffect(() => {
    if (previewAsId || eventsCache) return;
    if (!userId && !authReady) return;
    const storeKey = `events.${userId ?? "guest"}`;
    const snap = readPersisted<EventsSnapshot>(storeKey);
    if (snap) {
      eventsCache = snap;
      setEvents(snap.events);
      setRows(snap.rows);
      setMine(snap.mine);
      setLoading(false);
      return;
    }
    // Nothing to seed: tell the splash a first paint is still cooking.
    if (!pendingDoneRef.current) pendingDoneRef.current = markPending(storeKey);
  }, [userId, authReady, previewAsId]);
  useEffect(() => {
    if (!loading && pendingDoneRef.current) {
      pendingDoneRef.current();
      pendingDoneRef.current = null;
    }
  }, [loading]);
  useEffect(
    () => () => {
      pendingDoneRef.current?.();
      pendingDoneRef.current = null;
    },
    [],
  );
  const [schedule] = useDebouncedCallback(250);
  const realtime = opts?.realtime ?? false;
  // Optimistic going/maybe/can't-make tally nudge, keyed by event id: the
  // viewer's own old→new bucket transition. Bridges the gap between the
  // optimistic `mine` write below and the real roster rows landing after
  // `reload()` — without it the counts visibly lag a beat behind the tap.
  // Cleared whenever a reload lands (the fresh rows already reflect it).
  const [countShift, setCountShift] = useState<
    Record<string, { from: keyof AttendanceSummary["counts"]; to: keyof AttendanceSummary["counts"] }>
  >({});
  // Per-event in-flight lock: a double-tap on the same control must not fire a
  // second `set_event_attendance` write that can settle out of order — a tap
  // that lands while one is already saving just awaits that call's result.
  const pending = useRef<Record<string, Promise<RsvpResult>>>({});

  const reload = useCallback(async () => {
    try {
      const [ev, at, my] = await Promise.all([
        fetchEvents(),
        fetchAttendance(),
        fetchMyAttendance(previewAsId ?? undefined),
      ]);
      setEvents(ev);
      setRows(at);
      setMine(my);
      setCountShift({});
      eventsCache = { events: ev, rows: at, mine: my };
      // Persist for the next cold open (never a preview's view). Oversized
      // snapshots are quietly skipped by the 200KB cap in writePersisted —
      // they just stay memory-only.
      if (!previewAsId) writePersisted(`events.${userId ?? "guest"}`, eventsCache);
    } finally {
      // A flaky/misconfigured backend must never leave the UI stuck "loading".
      setLoading(false);
    }
  }, [previewAsId, userId]);

  useEffect(() => {
    let cancelled = false;
    void reload();
    const sb = supabase;
    if (!realtime || !isSupabaseConfigured || !sb) {
      return () => {
        cancelled = true;
      };
    }
    const channel = sb
      .channel("events-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "event_attendance" }, () => schedule(reload))
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [reload, realtime, schedule]);

  const summaries = useMemo(() => {
    const byEvent: Record<string, EventAttendance[]> = {};
    for (const r of rows) (byEvent[r.eventId] ??= []).push(r);
    const out: Record<string, AttendanceSummary> = {};
    for (const e of events) {
      const base = summarize(byEvent[e.id] ?? []);
      const shift = countShift[e.id];
      if (!shift || shift.from === shift.to) {
        out[e.id] = base;
        continue;
      }
      // Nudge just the numeric tally (not the going/maybe/not-going name lists,
      // which need the real row to know who to show) so it moves with the tap.
      out[e.id] = {
        ...base,
        counts: {
          ...base.counts,
          [shift.from]: Math.max(0, base.counts[shift.from] - 1),
          [shift.to]: base.counts[shift.to] + 1,
        },
      };
    }
    return out;
  }, [rows, events, countShift]);

  const setStatus = useCallback(
    (eventId: string, status: AttendanceStatus, days?: Record<string, AttendanceStatus> | null): Promise<RsvpResult> => {
      // Guests get the sign-in sheet; no backend ⇒ nothing to write; while
      // previewing as a member, writes are disabled (they'd act as the real admin).
      // All three resolve `null`, not a failure: nothing was attempted, and the
      // UI has already explained itself — a guest shouldn't get "couldn't save"
      // stacked behind the sign-in sheet they were just handed.
      if (!isSupabaseConfigured) return Promise.resolve(null);
      if (!user) {
        promptSignIn();
        return Promise.resolve(null);
      }
      if (previewAsId) return Promise.resolve(null);
      // Already saving this event — ride along on that write's result instead
      // of firing a second RPC that could settle in either order.
      const inFlight = pending.current[eventId];
      if (inFlight) return inFlight;

      const prevMine = mine[eventId] ?? null;
      const prevBucket = countKey(prevMine ? effectiveStatus(prevMine.status, prevMine.days) : "not_going");
      const nextBucket = countKey(effectiveStatus(status, days ?? null));

      // Optimistic: reflect the choice — and its effect on the going/maybe
      // tally — immediately, then reconcile with the server.
      setMine((m) => ({
        ...m,
        [eventId]: {
          id: m[eventId]?.id ?? eventId,
          eventId,
          userId: m[eventId]?.userId ?? "",
          name: m[eventId]?.name ?? user.name,
          avatarUrl: m[eventId]?.avatarUrl ?? user.avatarUrl ?? null,
          status,
          days: days ?? null,
          // A self-write always confirms (mirrors set_event_attendance's upsert).
          confirmed: true,
        },
      }));
      if (prevBucket !== nextBucket) {
        setCountShift((c) => ({ ...c, [eventId]: { from: prevBucket, to: nextBucket } }));
      }

      const run = (async (): Promise<RsvpResult> => {
        try {
          // Pass the title so the server can label the "X is going to <event>"
          // notification for seed events (no public.events row to look it up from).
          const { error } = await setAttendance(eventId, status, days, events.find((e) => e.id === eventId)?.title);
          if (error) {
            // The write didn't stick — roll the optimistic mine + tally back
            // instead of letting the next reload() silently swallow the failure.
            setMine((m) => {
              if (!prevMine) {
                const { [eventId]: _drop, ...rest } = m;
                return rest;
              }
              return { ...m, [eventId]: prevMine };
            });
            if (prevBucket !== nextBucket) {
              setCountShift((c) => {
                const { [eventId]: _drop, ...rest } = c;
                return rest;
              });
            }
            // Carry the server's own words up to the control. A generic
            // "try again" hides an app-wide outage inside what looks like one
            // person's bad connection — see RsvpResult.
            return error;
          }
          await reload();
          return true;
        } finally {
          delete pending.current[eventId];
        }
      })();
      pending.current[eventId] = run;
      return run;
    },
    [user, previewAsId, promptSignIn, reload, events, mine],
  );

  return {
    events,
    summaries,
    mine,
    loading,
    canRsvp: isSupabaseConfigured && !previewAsId,
    setStatus,
    reload,
  };
}

/**
 * Loads the "Ask for Help" log (migration 0037) and keeps it live. Mirrors the
 * shape of `useEvents`: an initial load plus a debounced Realtime subscription on
 * both source tables (a new/edited request, and responses landing). The view
 * calls the RPC wrappers (requestHelp/respondToHelp/setHelpStatus) then `reload()`
 * for an immediate refresh; Realtime keeps everyone else's view in sync. Safe
 * no-op (empty list) with no backend.
 */
export function useHelpRequests(): {
  requests: HelpRequest[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  // Shared SWR cache (`helpRequests.<uid>`, persisted): the log paints the
  // last-known list instantly on a cold open instead of blanking to a
  // skeleton, then revalidates. uid-scoped because rows carry the viewer's
  // own response state and reads are members-only.
  const { userId } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  const { data: requests, loading, reload } = useCachedResource<HelpRequest[]>(
    isSupabaseConfigured && userId ? `helpRequests.${userId}` : null,
    [],
    fetchHelpRequests,
    { persist: "local" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    const channel = sb
      .channel("help-requests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "help_requests" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "help_responses" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "help_request_items" }, () => schedule(reload))
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [reload, schedule]);

  return { requests, loading, reload };
}

/**
 * Live tournaments for one activity (schedule item). Mirrors `useEvents` /
 * `useHelpRequests`: an SWR-cached load + a debounced Realtime subscription over
 * the four tournament tables, plus an OPTIMISTIC `recordResult` for the manager's
 * score entry (paints the advanced bracket immediately, then reconciles on the
 * realtime reload). Members-only reads, so the key is uid-scoped and null for
 * guests (they get [] and a sign-in nudge). Usually one tournament per activity,
 * but the shape is a list (an activity could host two).
 */
export function useTournament(host: TournamentHost | null): {
  tournaments: Tournament[];
  loading: boolean;
  reload: () => Promise<void>;
  recordResult: (
    matchId: string,
    winnerId: string,
    score1?: number | null,
    score2?: number | null,
  ) => Promise<boolean>;
} {
  const { userId } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  const hostId = host ? `${host.kind}.${host.id}` : null;
  const key = isSupabaseConfigured && userId && hostId ? `tournament.${userId}.${hostId}` : null;
  const { data: tournaments, loading, reload, mutate } = useCachedResource<Tournament[]>(
    key,
    [],
    () => (host ? fetchTournamentsForHost(host) : Promise.resolve([])),
    { persist: "session" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !hostId) return;
    const channel = sb
      .channel(`tournament-${hostId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_entrants" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_participants" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches" }, () => schedule(reload))
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [hostId, reload, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-match in-flight lock: a double-tap on the same match doesn't fire two
  // writes that could settle out of order (the useEvents.setStatus pattern).
  const pending = useRef<Record<string, Promise<boolean>>>({});
  const recordResult = useCallback(
    (matchId: string, winnerId: string, score1: number | null = null, score2: number | null = null): Promise<boolean> => {
      if (!isSupabaseConfigured) return Promise.resolve(false);
      const inFlight = pending.current[matchId];
      if (inFlight) return inFlight;
      // Optimistic: advance the winner in whichever tournament holds this match.
      mutate((list) => list.map((t) => (t.matches.some((m) => m.id === matchId) ? applyMatchResult(t, matchId, winnerId, score1, score2) : t)));
      const run = (async (): Promise<boolean> => {
        try {
          const { error } = await recordMatchResult(matchId, winnerId, score1, score2);
          if (error) {
            await reload(); // roll back the optimistic paint to server truth
            return false;
          }
          await reload();
          return true;
        } finally {
          delete pending.current[matchId];
        }
      })();
      pending.current[matchId] = run;
      return run;
    },
    [mutate, reload],
  );

  return { tournaments, loading, reload, recordResult };
}

/**
 * Private activities (migration 0150) the viewer can see — their own + any
 * they've been invited to. Uid-scoped SWR cache + realtime over the two tables.
 * Empty for guests / no backend.
 */
export function usePrivateActivities(): {
  activities: PrivateActivity[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const { userId, isAdmin } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  const key = isSupabaseConfigured && userId ? `privateActivities.${userId}` : null;
  const { data: activities, loading, reload } = useCachedResource<PrivateActivity[]>(
    key,
    [],
    () => fetchPrivateActivities(userId, isAdmin),
    { persist: "session" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !userId) return;
    const channel = sb
      .channel(`private-activities-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "private_activities" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "private_activity_members" }, () => schedule(reload))
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, reload, schedule]);

  return { activities, loading, reload };
}

/**
 * Every drop box the viewer can see (migration 0171), live. Mirrors
 * usePrivateActivities: a uid-scoped SWR cache + a debounced Realtime
 * subscription on both tables, so a box someone else creates — or a photo they
 * drop — shows up without a refresh. Empty with no backend / pre-migration.
 */
export function useDropBoxes(): { boxes: DropBox[]; loading: boolean; reload: () => Promise<void> } {
  const { userId, isAdmin } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  const key = isSupabaseConfigured && userId ? `dropBoxes.${userId}` : null;
  const { data: boxes, loading, reload } = useCachedResource<DropBox[]>(
    key,
    [],
    () => fetchDropBoxes(userId, isAdmin),
    { persist: "session" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !userId) return;
    const channel = sb
      .channel(`drop-boxes-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drop_boxes" }, () => schedule(reload))
      .on("postgres_changes", { event: "*", schema: "public", table: "drop_box_media" }, () => schedule(reload))
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, reload, schedule]);

  return { boxes, loading, reload };
}

/**
 * One drop box + its media (migration 0171), live. Pass `boxId = null` (an
 * unresolved deep-link) for an inert no-op. Realtime is scoped to this box's
 * media so an open folder fills in as others drop things into it.
 */
export function useDropBox(boxId: string | null): { box: DropBox | null; loading: boolean; reload: () => Promise<void> } {
  const { userId, isAdmin } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  const key = isSupabaseConfigured && userId && boxId ? `dropBox.${userId}.${boxId}` : null;
  const { data: box, loading, reload } = useCachedResource<DropBox | null>(
    key,
    null,
    () => (boxId ? fetchDropBox(boxId, userId, isAdmin) : Promise.resolve(null)),
    { persist: "session" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !userId || !boxId) return;
    const channel = sb
      .channel(`drop-box-${boxId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drop_box_media", filter: `box_id=eq.${boxId}` },
        () => schedule(reload),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drop_boxes", filter: `id=eq.${boxId}` },
        () => schedule(reload),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, boxId, reload, schedule]);

  return { box, loading, reload };
}

/**
 * Resolve which house the House Hub / calendar should show, and whether the
 * viewer may see it. With a `slug` (a deep-link like `?house=mjt-house`) it loads
 * that house and gates on membership (admins can view any); without a slug it
 * resolves the viewer's OWN house (they're always a member of it). Returns
 * `house = null` when the viewer is in no house and none was named. Re-runs when
 * the identity (and thus the viewer's house) changes.
 */
export function useResolvedHouse(slug?: string | null): {
  house: House | null;
  isMember: boolean;
  loading: boolean;
} {
  // Shared SWR cache: keyed by slug + everything that changes the resolved
  // value (uid, admin flag, preview), persisted so HouseHub / the calendar
  // paint instantly on a cold open instead of rebuilding from a SkeletonList.
  // The fetch always re-resolves membership and overwrites, so lost access
  // corrects on the revalidate. Previews stay memory-only.
  const { user, userId, authReady, isAdmin, previewAsId } = useIdentity();
  const key =
    user && userId
      ? previewAsId
        ? `resolvedHouse.preview.${previewAsId}.${slug ?? "mine"}.${isAdmin}`
        : `resolvedHouse.${userId}.${slug ?? "mine"}.${isAdmin}`
      : null;
  const { data, loading } = useCachedResource<{ house: House | null; isMember: boolean }>(
    key,
    { house: null, isMember: false },
    async () => {
      const mine = await fetchMyHouse(previewAsId ?? userId);
      if (slug) {
        const h = await fetchHouseBySlug(slug);
        return { house: h, isMember: !!h && (isAdmin || mine?.id === h.id) };
      }
      return { house: mine, isMember: !!mine };
    },
    { persist: previewAsId ? undefined : "local" },
  );

  // While the identity itself is still resolving (key null, auth pending),
  // report loading — otherwise the House screens would flash their "ask an
  // admin to add you" lock at a member whose sign-in just hasn't settled yet.
  const identityPending = isSupabaseConfigured && !authReady && !user;
  return { house: data.house, isMember: data.isMember, loading: loading || identityPending };
}

/**
 * Loads a house's calendar of stays (migration 0071) and keeps it live. Mirrors
 * `useEvents`/`useHelpRequests`: an initial load + a debounced Realtime
 * subscription on house_stays (filtered to this house), plus write wrappers that
 * write then `reload()` for an immediate local refresh (Realtime keeps everyone
 * else in sync). MLR resort-wide events are NOT loaded here — the calendar view
 * pairs this with `useEvents()` to overlay them. Guests get `promptSignIn()` on
 * write; no backend ⇒ safe empty. Pass `houseId = null` (not in a house) for a
 * no-op that never fetches.
 */
export function useHouseCalendar(houseId: string | null): {
  stays: HouseStay[];
  loading: boolean;
  canWrite: boolean;
  reload: () => Promise<void>;
  addStay: (input: StayInput) => Promise<{ error?: string }>;
  editStay: (id: string, input: StayInput) => Promise<{ error?: string }>;
  removeStay: (id: string) => Promise<{ error?: string }>;
} {
  const { user, previewAsId, promptSignIn } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  // Shared SWR cache (`houseCalendar.<houseId>`, persisted): the calendar/
  // agenda paints the last-known stays instantly on a cold open instead of
  // blanking to empty + loading, then revalidates. House-scoped key — reads
  // are RLS-gated on membership, and every persisted entry is wiped on
  // signOut like the rest of the cache.
  const { data: stays, loading, reload } = useCachedResource<HouseStay[]>(
    houseId ? `houseCalendar.${houseId}` : null,
    [],
    () => fetchHouseStays(houseId!),
    { persist: "local" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!houseId || !isSupabaseConfigured || !sb) return;
    const channel = sb
      .channel(`house-stays-${houseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "house_stays", filter: `house_id=eq.${houseId}` },
        () => schedule(reload),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [houseId, reload, schedule]);

  // Guests → sign-in sheet; no backend / preview-as ⇒ blocked (never writes as
  // the real member while an admin previews). Mirrors useEvents.setStatus.
  const guarded = useCallback(
    async (fn: () => Promise<{ error?: string }>): Promise<{ error?: string }> => {
      if (!isSupabaseConfigured) return {};
      if (!user) {
        promptSignIn();
        return {};
      }
      if (previewAsId) return {};
      const res = await fn();
      if (!res.error) await reload();
      return res;
    },
    [user, previewAsId, promptSignIn, reload],
  );

  const addStay = useCallback(
    (input: StayInput) => guarded(() => createHouseStay(houseId!, input)),
    [guarded, houseId],
  );
  const editStay = useCallback(
    (id: string, input: StayInput) => guarded(() => updateHouseStay(id, input)),
    [guarded],
  );
  const removeStay = useCallback(
    (id: string) => guarded(() => deleteHouseStay(id)),
    [guarded],
  );

  return {
    stays,
    loading,
    canWrite: isSupabaseConfigured && !!user && !previewAsId,
    reload,
    addStay,
    editStay,
    removeStay,
  };
}

/**
 * Loads a house's shared lists (migration 0169) and keeps them live. Same shape
 * as `useHouseCalendar` above: a cached initial load + a debounced Realtime
 * subscription (on BOTH house_lists and house_list_items, each filtered to this
 * house — items carry a denormalized house_id for exactly this), plus write
 * wrappers that write then `reload()`. Every write is allowed for any member of
 * the house, so there's no per-row ownership check on the client — the RPCs gate
 * on is_house_member. Guests get `promptSignIn()`; no backend / pre-migration ⇒
 * a safe empty. Pass `houseId = null` for a no-op that never fetches.
 */
export function useHouseLists(houseId: string | null): {
  lists: HouseList[];
  loading: boolean;
  canWrite: boolean;
  reload: () => Promise<void>;
  addList: (input: HouseListInput) => Promise<{ error?: string }>;
  editList: (id: string, input: HouseListInput) => Promise<{ error?: string }>;
  removeList: (id: string) => Promise<{ error?: string }>;
  addItem: (listId: string, text: string) => Promise<{ error?: string }>;
  editItem: (id: string, text: string) => Promise<{ error?: string }>;
  setItemChecked: (id: string, checked: boolean) => Promise<{ error?: string }>;
  removeItem: (id: string) => Promise<{ error?: string }>;
  clearChecked: (listId: string) => Promise<{ error?: string }>;
  uncheckAll: (listId: string) => Promise<{ error?: string }>;
} {
  const { user, previewAsId, promptSignIn } = useIdentity();
  const [schedule] = useDebouncedCallback(250);
  const { data: lists, loading, reload } = useCachedResource<HouseList[]>(
    houseId ? `houseLists.${houseId}` : null,
    [],
    () => fetchHouseLists(houseId!),
    { persist: "local" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!houseId || !isSupabaseConfigured || !sb) return;
    const channel = sb
      .channel(`house-lists-${houseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "house_lists", filter: `house_id=eq.${houseId}` },
        () => schedule(reload),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "house_list_items", filter: `house_id=eq.${houseId}` },
        () => schedule(reload),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [houseId, reload, schedule]);

  // Guests → sign-in sheet; no backend / preview-as ⇒ blocked (never writes as
  // the real member while an admin previews). Mirrors useHouseCalendar.
  const guarded = useCallback(
    async (fn: () => Promise<{ error?: string }>): Promise<{ error?: string }> => {
      if (!isSupabaseConfigured) return {};
      if (!user) {
        promptSignIn();
        return {};
      }
      if (previewAsId) return {};
      const res = await fn();
      if (!res.error) await reload();
      return res;
    },
    [user, previewAsId, promptSignIn, reload],
  );

  const addList = useCallback(
    (input: HouseListInput) => guarded(() => createHouseList(houseId!, input)),
    [guarded, houseId],
  );
  const editList = useCallback(
    (id: string, input: HouseListInput) => guarded(() => updateHouseList(id, input)),
    [guarded],
  );
  const removeList = useCallback((id: string) => guarded(() => deleteHouseList(id)), [guarded]);
  const addItem = useCallback(
    (listId: string, text: string) => guarded(() => addHouseListItem(listId, text)),
    [guarded],
  );
  const editItem = useCallback(
    (id: string, text: string) => guarded(() => updateHouseListItem(id, text)),
    [guarded],
  );
  const setItemChecked = useCallback(
    (id: string, checked: boolean) => guarded(() => setHouseListItemChecked(id, checked)),
    [guarded],
  );
  const removeItem = useCallback((id: string) => guarded(() => deleteHouseListItem(id)), [guarded]);
  const clearChecked = useCallback(
    (listId: string) => guarded(() => clearCheckedHouseListItems(listId)),
    [guarded],
  );
  const uncheckAll = useCallback(
    (listId: string) => guarded(() => uncheckHouseListItems(listId)),
    [guarded],
  );

  return {
    lists,
    loading,
    canWrite: isSupabaseConfigured && !!user && !previewAsId,
    reload,
    addList,
    editList,
    removeList,
    addItem,
    editItem,
    setItemChecked,
    removeItem,
    clearChecked,
    uncheckAll,
  };
}

/**
 * Is the viewer a House Admin (migration 0194)? Cached the same way
 * `useCanEditFest` is, and for the same reason: it gates the Approve/Deny
 * controls on the requests board, so a slow resolve would pop them in a beat
 * late (or worse, paint the read-only view to the person who's supposed to be
 * deciding). uid-scoped, wiped on signOut, false for guests / pre-migration.
 *
 * Resolved from the REAL `userId`, not `effectiveUserId`: this is a permission,
 * and an admin using "View as" is read-only anyway (every write no-ops while
 * `previewAsId` is set), so previewing must not hand the previewed member's
 * role to the admin or vice versa.
 */
export function useIsHouseAdmin(): boolean {
  const { user, userId, previewAsId } = useIdentity();
  const { data } = useCachedResource<boolean>(
    user && userId && !previewAsId ? `isHouseAdmin.${userId}` : null,
    false,
    () => fetchIsHouseAdmin(userId),
    { persist: previewAsId ? undefined : "local" },
  );
  return data;
}

/**
 * A house's requests board (migration 0195), live. Mirrors `useHouseLists`: a
 * house-scoped SWR cache + a debounced Realtime subscription filtered to this
 * house, so a request someone else submits — or a decision a House Admin
 * makes — lands without a refresh.
 *
 * Pass `houseId = null` (not in a house / still resolving) for an inert no-op.
 * `canReview` only decides which buttons paint; RLS and the RPCs are the real
 * gate, so an over-permissive value here can't grant anything.
 */
export function useHouseRequests(houseId: string | null): {
  requests: HouseRequest[];
  loading: boolean;
  canReview: boolean;
  /** false only when migration 0195 genuinely isn't applied — never for an
   *  empty-but-healthy board (see HouseRequestsResult). */
  ready: boolean;
  reload: () => Promise<void>;
} {
  const { userId, previewAsId } = useIdentity();
  const isHouseAdmin = useIsHouseAdmin();
  const [schedule] = useDebouncedCallback(250);
  // ⚠️ HOUSE ADMINS ONLY — being an app admin grants nothing here (migration
  // 0202). Deciding a house's spending belongs to that house. An app admin who
  // isn't one sees the board read-only, and can still modify or withdraw their
  // OWN pending ask, which keys on authorship rather than this flag.
  // A preview session is read-only too, so never paint reviewer controls in it.
  const canReview = isHouseAdmin && !previewAsId;
  const key =
    isSupabaseConfigured && userId && houseId ? `houseRequests.${userId}.${houseId}.${canReview}` : null;
  const { data, loading, reload } = useCachedResource<HouseRequestsResult>(
    key,
    NO_HOUSE_REQUESTS,
    () => (houseId ? fetchHouseRequests(houseId, userId, canReview) : Promise.resolve(NO_HOUSE_REQUESTS)),
    { persist: previewAsId ? undefined : "session" },
  );

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !houseId) return;
    const channel = sb
      .channel(`house-requests-${houseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "house_requests", filter: `house_id=eq.${houseId}` },
        () => schedule(reload),
      )
      // Attachments aren't house-scoped in their own row, so this one can't be
      // filtered server-side; a debounced reload on any change is cheap.
      .on("postgres_changes", { event: "*", schema: "public", table: "house_request_media" }, () =>
        schedule(reload),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [houseId, reload, schedule]);

  return { requests: data.requests, loading, canReview, ready: data.ready, reload };
}

/**
 * Cached Family-Fest edit permission. Seeds the last-known value instantly
 * (memory across tab switches, persisted across cold opens) so Edit affordances
 * don't pop in a frame or two late while can_edit_fest() re-resolves on each
 * visit. uid-scoped + wiped on signOut; false for guests / no backend.
 */
export function useCanEditFest(): boolean {
  const { user, userId } = useIdentity();
  const { data } = useCachedResource<boolean>(
    user && userId ? `canEditFest.${userId}` : null,
    false,
    canEditFest,
    { persist: "local" },
  );
  return data;
}

/**
 * Ephemeral "who's typing" for a chat room, on its OWN realtime channel
 * (`typing:<roomKey>`) — deliberately separate from the message subscription so
 * this can never disrupt message delivery. Returns the list of other people
 * currently typing (self excluded via broadcast self:false) and a throttled
 * `notifyTyping()` to call on each keystroke. Each typer self-clears ~4.5s after
 * their last keystroke, so a dropped "stopped typing" can't leave it stuck.
 * Nothing persists; if the broadcast can't reach anyone, it's simply a no-op.
 */
export function useTypingChannel(
  roomKey: string | null,
  uid: string | null,
  myName: string,
): { typers: string[]; notifyTyping: () => void } {
  const [typers, setTypers] = useState<Record<string, string>>({}); // uid -> name
  const chanRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSent = useRef(0);
  const myNameRef = useRef(myName);
  myNameRef.current = myName;

  useEffect(() => {
    const sb = supabase;
    if (!sb || !roomKey || !uid) return;
    const chan = sb.channel(`typing:${roomKey}`, { config: { broadcast: { self: false } } });
    chan
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { uid?: string; name?: string };
        if (!p?.uid || p.uid === uid) return;
        const who = p.uid;
        setTypers((prev) => (prev[who] ? prev : { ...prev, [who]: p.name || "Someone" }));
        const t = timers.current;
        if (t.has(who)) clearTimeout(t.get(who)!);
        t.set(
          who,
          setTimeout(() => {
            setTypers((prev) => {
              const next = { ...prev };
              delete next[who];
              return next;
            });
            t.delete(who);
          }, 4500),
        );
      })
      .subscribe();
    chanRef.current = chan;
    const localTimers = timers.current;
    return () => {
      localTimers.forEach(clearTimeout);
      localTimers.clear();
      setTypers({});
      sb.removeChannel(chan);
      chanRef.current = null;
    };
  }, [roomKey, uid]);

  const notifyTyping = useCallback(() => {
    if (!uid || !chanRef.current) return;
    const now = Date.now();
    if (now - lastSent.current < 2500) return; // throttle to one ping / 2.5s
    lastSent.current = now;
    void chanRef.current.send({ type: "broadcast", event: "typing", payload: { uid, name: myNameRef.current } });
  }, [uid]);

  return { typers: Object.values(typers), notifyTyping };
}
