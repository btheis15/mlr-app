"use client";

// Shared stale-while-revalidate cache — THE loading-stability primitive.
//
// The app's pages remount on every tab switch (app/template.tsx re-fires the
// page-enter animation), and a cold app open starts from nothing — so for
// years every data consumer hand-rolled the same dance: a module-level cache
// Map, `loading = !cache`, refetch on mount, write back. That killed the
// tab-switch flicker but not the cold-open pop-in (module memory dies with
// the JS context). This module replaces the copy-paste with one hook that
// layers BOTH:
//
//   1. a module memory Map (survives tab-switch remounts, dies on app close)
//   2. optional persisted storage (localStorage/sessionStorage) so the last
//      known data paints instantly on the NEXT app open too
//
// …always revalidating in the background, with in-flight request dedup so two
// components mounting the same key don't double-fetch.
//
// ── The iron hydration rule ──────────────────────────────────────────────
// SSR/prerender always renders the guest/empty view, so the first client
// render MUST match it. Memory seeds are synchronous and safe (the Map is
// empty at cold boot, so cold first render === server HTML; it's only warm on
// in-session remounts, which aren't hydration). Storage seeds are applied in
// a post-mount EFFECT only (the WeatherCard pattern) — never in a useState
// initializer. Don't "optimize" that.
//
// ── Key rules ────────────────────────────────────────────────────────────
// • User-scoped data embeds the auth uid: `myHouse.<uid>`, `feed.<uid>`, …
//   Pass `key = null` while the uid is unresolved — the hook stays inert, so
//   another account's rows can never seed.
// • Public data uses unscoped keys: `festContent`, `weather`, `appImages`.
// • Admin preview mode must never persist: pass `persist: undefined` while
//   previewing and put the preview id in the (memory-only) key.
// • Day-fresh data embeds the date: `birthdays.<uid>.<today>` — a stale day
//   never paints.
// • IdentityProvider.signOut() calls clearAllCaches(); uid-scoped keys are
//   the second line of defense for the token-expiry path where signOut never
//   runs (leftover entries are inert without a session).

import { useCallback, useEffect, useRef, useState } from "react";
import { markPending } from "@/lib/appReady";

const PREFIX = "mlr.cache.v1."; // versioned — bump to invalidate everything
const MAX_PERSIST_BYTES = 200_000; // oversized snapshots stay memory-only
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type Persist = "local" | "session";

interface Envelope<T> {
  ts: number;
  data: T;
}

function store(which: Persist): Storage | null {
  try {
    return which === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked (private browsing etc.) — degrade to cold
  }
}

/** Read a persisted snapshot; null on miss, parse error, or expired TTL. */
export function readPersisted<T>(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
  which: Persist = "local",
): T | null {
  try {
    const s = store(which);
    const raw = s?.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (typeof parsed?.ts !== "number") return null;
    if (Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

/** Write-through (JSON envelope with ts). Quota/serialize errors are swallowed. */
export function writePersisted<T>(
  key: string,
  data: T,
  which: Persist = "local",
): void {
  try {
    const str = JSON.stringify({ ts: Date.now(), data } satisfies Envelope<T>);
    if (str.length > MAX_PERSIST_BYTES) return;
    store(which)?.setItem(PREFIX + key, str);
  } catch {
    /* quota / serialize — stay memory-only */
  }
}

export function removePersisted(key: string, which: Persist = "local"): void {
  try {
    store(which)?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

// ── memory layer (module-level; survives tab-switch remounts) ─────────────
const memory = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Wipe every mlr.cache.* key from BOTH storages plus the memory map.
 * Called from IdentityProvider.signOut so no account data outlives a session
 * on a shared device.
 */
export function clearAllCaches(): void {
  memory.clear();
  inflight.clear();
  for (const which of ["local", "session"] as const) {
    try {
      const s = store(which);
      if (!s) continue;
      const doomed: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(PREFIX)) doomed.push(k);
      }
      for (const k of doomed) s.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export interface CachedResourceOpts {
  /** Persist across app opens ("local") or the browser session ("session").
   *  Omit for memory-only (the old behavior, now deduped + shared). */
  persist?: Persist;
  /** Max age of a persisted snapshot to seed from (default 24h). Memory
   *  entries never expire — they die with the JS context. */
  ttlMs?: number;
}

export interface CachedResource<T> {
  data: T;
  /** True only when NOTHING could seed (no memory, no storage) and the first
   *  fetch hasn't settled. A warm seed serves stale immediately (loading
   *  false) while the background revalidate runs. */
  loading: boolean;
  /** Force a fresh fetch (replaces any in-flight dedup entry) + write-back. */
  reload: () => Promise<void>;
  /** Optimistic overwrite: updates state, memory, AND storage in one call. */
  mutate: (next: T | ((prev: T) => T)) => void;
}

/**
 * The shared SWR hook. `key` is the cache key WITHOUT the mlr.cache.v1.
 * prefix; pass null to disable entirely (no seed, no fetch, data = `empty`) —
 * used while a uid the key needs is still unresolved, or for guests on
 * member-only resources. `empty` is the SSR-safe empty value and MUST equal
 * what the prerendered HTML renders from.
 */
export function useCachedResource<T>(
  key: string | null,
  empty: T,
  fetcher: () => Promise<T>,
  opts?: CachedResourceOpts,
): CachedResource<T> {
  const persist = opts?.persist;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;

  const [data, setData] = useState<T>(() =>
    key !== null && memory.has(key) ? (memory.get(key) as T) : empty,
  );
  const [loading, setLoading] = useState(key !== null && !memory.has(key));

  // Refs so a fresh fetcher/empty closure never re-runs the load effect (the
  // useManagedCommittee loadRef pattern in lib/hooks.ts).
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const emptyRef = useRef(empty);
  emptyRef.current = empty;
  const dataRef = useRef(data);
  dataRef.current = data;
  const keyRef = useRef(key);
  keyRef.current = key;
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const commit = useCallback((k: string, value: T) => {
    memory.set(k, value);
    if (persistRef.current) writePersisted(k, value, persistRef.current);
  }, []);

  useEffect(() => {
    if (key === null) {
      dataRef.current = emptyRef.current;
      setData(emptyRef.current);
      setLoading(false);
      return;
    }
    let cancelled = false;

    // Seed: memory first (may already be the initializer's value), then the
    // post-mount persisted snapshot. Track whether ANYTHING seeded — that
    // decides `loading` and whether this counts as a cold load for the
    // splash's readiness registry.
    let seeded = memory.has(key);
    if (seeded) {
      dataRef.current = memory.get(key) as T;
      setData(dataRef.current);
      setLoading(false);
    } else if (persist) {
      const hit = readPersisted<T>(key, ttlMs, persist);
      if (hit !== null) {
        memory.set(key, hit);
        dataRef.current = hit;
        setData(hit);
        setLoading(false);
        seeded = true;
      }
    }
    if (!seeded) {
      dataRef.current = emptyRef.current;
      setData(emptyRef.current);
      setLoading(true);
    }
    const done = seeded ? null : markPending(key);

    // Always revalidate — join an in-flight fetch for this key if one exists.
    const existing = inflight.get(key) as Promise<T> | undefined;
    const p = existing ?? fetchRef.current();
    if (!existing) {
      inflight.set(key, p);
      p.finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      }).catch(() => {});
    }
    p.then(
      (fresh) => {
        commit(key, fresh); // cache even if unmounted — don't lose the fetch
        if (cancelled) return;
        dataRef.current = fresh;
        setData(fresh);
        setLoading(false);
      },
      () => {
        if (!cancelled) setLoading(false); // never stick on loading
      },
    ).finally(() => done?.());

    return () => {
      cancelled = true;
      done?.();
    };
    // persist/ttl are config, fixed per call site; fetcher lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(async () => {
    const k = keyRef.current;
    if (k === null) return;
    const p = fetchRef.current();
    inflight.set(k, p); // replace any stale in-flight entry
    try {
      const fresh = await p;
      commit(k, fresh);
      if (keyRef.current === k) {
        dataRef.current = fresh;
        setData(fresh);
        setLoading(false);
      }
    } catch {
      if (keyRef.current === k) setLoading(false);
    } finally {
      if (inflight.get(k) === p) inflight.delete(k);
    }
  }, [commit]);

  const mutate = useCallback(
    (next: T | ((prev: T) => T)) => {
      const value =
        typeof next === "function"
          ? (next as (prev: T) => T)(dataRef.current)
          : next;
      dataRef.current = value;
      setData(value);
      const k = keyRef.current;
      if (k !== null) commit(k, value);
    },
    [commit],
  );

  return { data, loading, reload, mutate };
}
