"use client";

// First-paint readiness registry — the tiny signal behind the splash screen's
// "hold until the screen is actually ready" behavior (see SplashIntro).
//
// Data hooks (useCachedResource in lib/swrCache.ts) call markPending(key) when
// they start a COLD load — one where nothing could seed from memory or
// persisted storage, so the screen would otherwise paint an empty state and
// pop the content in later. When the fetch settles (or the component unmounts)
// the pending mark is cleared. While anything is pending, the registry is
// "loud"; when the set drains it's "quiet" and the first paint is complete.
//
// On a warm open (persisted caches seeded everything) nothing ever registers,
// so the registry is quiet immediately and the splash adds zero extra hold.
// No React here on purpose — plain module state, callable from anywhere.

const pending = new Set<string>();
const subs = new Set<() => void>();

function notify() {
  if (pending.size === 0) for (const cb of [...subs]) cb();
}

/** Mark a resource as cold-loading. Returns an idempotent done() that clears it. */
export function markPending(key: string): () => void {
  pending.add(key);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending.delete(key);
    notify();
  };
}

/** True when no cold loads are in flight. */
export function isQuiet(): boolean {
  return pending.size === 0;
}

/**
 * Run cb once, when the registry goes quiet OR after capMs — whichever comes
 * first. Checks quietness on a microtask first so cold loads registered in the
 * same render tick are counted before we conclude "already quiet".
 * Returns a cancel function.
 */
export function onQuietOnce(capMs: number, cb: () => void): () => void {
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (fired) return;
    fired = true;
    subs.delete(onDrain);
    if (timer) clearTimeout(timer);
    cb();
  };
  const onDrain = () => fire();
  timer = setTimeout(fire, capMs);
  // Defer the initial quiet-check one tick so same-render markPending calls
  // (effects flushing in the same commit) land first.
  queueMicrotask(() => {
    if (!fired && isQuiet()) fire();
    else if (!fired) subs.add(onDrain);
  });
  return () => {
    fired = true;
    subs.delete(onDrain);
    if (timer) clearTimeout(timer);
  };
}
