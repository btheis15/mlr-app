// Members-only media: the client half.
//
// The media server now requires a signed token on every `/f` read (see
// media-server/media-auth.js). It rides in the QUERY STRING because `<img src>`
// and `<video src>` cannot carry an Authorization header, and a cookie would have
// to be third-party — which Safari/iOS blocks outright.
//
// So every media URL the app renders needs `?t=<token>` appended, and this is the
// one place that happens.
//
// The token is issued per 24h window and is IDENTICAL for every member in that
// window, which matters more than it sounds: a token that varied per request would
// change every URL on every render, so nothing would ever hit the browser cache and
// the app would get slower while gaining no security.

import { MEDIA_URL } from "@/lib/media";
import { supabase } from "@/lib/supabase";

const CACHE_KEY = "mlr.mediaToken.v1";

type Cached = { token: string; expiresAt: string };

let current: string | null = null;
/** When `current` stops being usable. Tracked so a long-lived session (an installed
 *  PWA left open for days) drops its in-memory token instead of signing URLs with
 *  an expired one — `fromStorage()` already refuses a near-expiry token, but
 *  `current` would otherwise never be reconsidered. */
let currentExpiresAt = 0;
let inFlight: Promise<string | null> | null = null;

/** Usable for at least another minute, so a URL can't expire mid-flight. */
function stillFresh(): boolean {
  return !!current && currentExpiresAt - Date.now() >= 60_000;
}

/** Read the cached token, ignoring one that's expired or nearly so. */
function fromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (!c?.token || !c?.expiresAt) return null;
    // Drop it a minute early so we never render a URL that expires mid-flight.
    const exp = Date.parse(c.expiresAt);
    if (exp - Date.now() < 60_000) return null;
    currentExpiresAt = exp;
    return c.token;
  } catch {
    return null;
  }
}

/**
 * Fetch (or reuse) the media token. Safe to call repeatedly — concurrent callers
 * share one request, and the result is cached in localStorage so a cold app open
 * has it before the first photo renders.
 */
export async function ensureMediaToken(force = false): Promise<string | null> {
  if (!force) {
    if (stillFresh()) return current;
    const cached = fromStorage();
    if (cached) {
      current = cached;
      return current;
    }
  }
  // Expired (or a deliberate refresh): forget it, so a failed fetch renders an
  // unsigned URL (one broken image) rather than a confidently-signed URL the server
  // will 403.
  current = null;
  currentExpiresAt = 0;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const session = (await supabase?.auth.getSession())?.data.session;
      const jwt = session?.access_token;
      if (!jwt) return null; // a guest gets no token — and sees no media
      const res = await fetch(`${MEDIA_URL}/media-token`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as Cached;
      if (!j?.token) return null;
      current = j.token;
      currentExpiresAt = Date.parse(j.expiresAt) || Date.now() + 60_000;
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(j));
      } catch {
        /* private mode / quota — the in-memory copy still works for this session */
      }
      return current;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Called by signOut so a shared device doesn't leave a usable media token behind. */
export function clearMediaToken() {
  current = null;
  currentExpiresAt = 0;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The token if we already have one, without triggering a fetch (render is sync). */
export function peekMediaToken(): string | null {
  if (stillFresh()) return current;
  current = fromStorage();
  return current;
}

/**
 * Add the media token to a URL. THE function every `<img>`/`<video>` src should go
 * through.
 *
 * Non-media URLs (Supabase avatars, data: URIs, blob: previews of a file being
 * uploaded, repo-shipped /assets) are returned untouched — appending a token to
 * those would be noise at best and a cache-buster at worst.
 *
 * Returns the URL unchanged when there's no token yet. That's deliberate: with
 * enforcement off it simply works, and with enforcement on a missing token yields
 * one broken image rather than a thrown render.
 */
export function mediaSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (!url.startsWith(MEDIA_URL)) return url; // not ours
  if (url.includes("/assets/")) return url; // repo assets stay public
  const token = peekMediaToken();
  if (!token) return url;
  if (/[?&]t=/.test(url)) return url; // already signed
  return `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}
