"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

/**
 * A Robinhood-style stack of Home call-out cards. Temporary cards (future
 * news/alerts) sit ON TOP of a permanent base card and can be
 * **swiped away** (left or right) or dismissed with the ✕; the next card slides
 * up to take its place, until only the base card is left. The base is marked
 * `swipeable: false`, so it can never be removed — that's what keeps something
 * always in this slot (and Ask for Help below it always in view) instead of the
 * call-outs pushing the page down.
 *
 * Pass `items` front-to-back: the swipeable call-outs first (newest first), the
 * permanent base last. Dismissals are kept in `sessionStorage`, keyed by each
 * item's `id` — so a swiped card stays gone while you move between tabs, but
 * **comes back the next time the app is opened** (a fresh session). Give
 * temporary cards a **versioned** id (e.g. tied to a deadline) so a brand-new
 * alert reappears even within a session where an old one was swiped.
 */
export type StackItem = {
  id: string;
  node: ReactNode;
  /** Swipeable/dismissible? The permanent base card sets this false. */
  swipeable: boolean;
};

const SWIPE_THRESHOLD = 140; // px of horizontal travel that counts as a dismiss
// — deliberately long so a small drag/scroll jitter never flings a card away.
const PEEK = 8; // px each card behind the front peeks out at the bottom
const MAX_PEEK = 2; // cap how many cards visibly stack behind the front
const FLY_MS = 260; // off-screen fling duration (kept in sync with the CSS below)

export function CalloutStack({
  items,
  storageKey = "mlr.callouts.dismissed",
}: {
  items: StackItem[];
  storageKey?: string;
}) {
  // Read this session's dismissals synchronously so a card swiped earlier in
  // the session never flashes in on first paint (window is absent only during
  // prerender). sessionStorage (not localStorage) is deliberate: dismissals
  // survive tab navigation but reset when the app is reopened.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  const visible = items.filter((it) => !it.swipeable || !dismissed.has(it.id));
  const front = visible[0];

  // Drag state for the front card. `snap` toggles the transition off while the
  // finger is down (so the card tracks 1:1) and back on for the release/fling.
  const [dx, setDx] = useState(0);
  const [snap, setSnap] = useState(true);
  const start = useRef<{ x: number; y: number; axis: "h" | "v" | null } | null>(null);
  const dragged = useRef(false);

  const persist = useCallback(
    (next: Set<string>) => {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* private mode / no storage — dismissal just won't persist */
      }
    },
    [storageKey],
  );

  const fly = useCallback(
    (id: string, dir: 1 | -1) => {
      setSnap(true);
      setDx(dir * 700);
      window.setTimeout(() => {
        setDismissed((prev) => {
          const next = new Set(prev);
          next.add(id);
          persist(next);
          return next;
        });
        setDx(0); // the next card mounts fresh at 0 (new key → no animation)
      }, FLY_MS);
    },
    [persist],
  );

  // One gentle wiggle the first time a swipeable card is on top this session,
  // hinting it can be swiped away. Skipped under reduce-motion.
  const [wiggle, setWiggle] = useState(false);
  useEffect(() => {
    if (!front?.swipeable) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (sessionStorage.getItem("mlr.callouts.wiggled")) return;
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => {
      setWiggle(true);
      try {
        sessionStorage.setItem("mlr.callouts.wiggled", "1");
      } catch {
        /* ignore */
      }
      window.setTimeout(() => setWiggle(false), 1500);
    }, 650);
    return () => window.clearTimeout(t);
  }, [front?.id, front?.swipeable]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    setWiggle(false);
    start.current = { x: e.clientX, y: e.clientY, axis: null };
    setSnap(false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (s.axis === null) {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
      // Lock to the dominant axis: horizontal = swipe, vertical = let it scroll.
      s.axis = Math.abs(ddx) > Math.abs(ddy) ? "h" : "v";
    }
    if (s.axis !== "h") return;
    dragged.current = true;
    setDx(ddx);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    setSnap(true);
    if (!s || !front) return;
    const ddx = e.clientX - s.x;
    if (s.axis === "h" && Math.abs(ddx) > SWIPE_THRESHOLD) {
      fly(front.id, ddx > 0 ? 1 : -1);
    } else {
      setDx(0); // snap back
    }
  };

  // A swipe ends with a click event on the underlying <Link> — swallow it so a
  // dismiss gesture doesn't also navigate. A genuine tap leaves dragged false.
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (dragged.current) {
      e.preventDefault();
      e.stopPropagation();
      dragged.current = false;
    }
  };

  if (!front) return null;

  // Only the front card's content is rendered; the cards behind it are implied
  // by decorative "plates" that fill the front card's box (position:absolute
  // inset-0) and peek a fixed sliver out the bottom — so the stacked look is
  // identical no matter how tall each call-out happens to be. The real next
  // card mounts once it becomes the front (after a dismiss).
  const behind = Math.min(visible.length - 1, MAX_PEEK);
  const frontStyle: CSSProperties = {
    position: "relative",
    zIndex: behind + 1,
    transform: `translateX(${dx}px)`,
    transition: snap ? `transform ${FLY_MS}ms ease` : "none",
    opacity: dx ? Math.max(1 - Math.abs(dx) / 600, 0.5) : 1,
    touchAction: "pan-y",
  };
  const swipeProps =
    front.swipeable
      ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture }
      : {};

  return (
    <div className="relative">
      {/* Peeking plates for each call-out still stacked behind the front one. */}
      {Array.from({ length: behind }, (_, i) => {
        const depth = i + 1;
        return (
          <div
            key={`plate-${depth}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl bg-card shadow-sm ring-1 ring-border"
            style={{
              zIndex: behind - i,
              transform: `translateY(${depth * PEEK}px) scaleX(${1 - depth * 0.05})`,
              transformOrigin: "top center",
              transition: "transform .3s ease",
              opacity: 1 - depth * 0.06,
            }}
          />
        );
      })}

      <div
        key={front.id}
        style={frontStyle}
        className={front.swipeable && wiggle ? "callout-wiggle" : undefined}
        {...swipeProps}
      >
        {front.node}
        {front.swipeable && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => fly(front.id, 1)}
            className="press absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-card text-foreground/60 shadow-md ring-1 ring-border before:absolute before:-inset-2.5 before:content-['']"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
