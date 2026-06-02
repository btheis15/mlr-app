"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { contactActions, payActions, type Action, type MemberContact } from "@/lib/contact";

// Tap a member's avatar/name anywhere → this bottom sheet. It slides up from the
// bottom over a backdrop that dims as it rises, and can be flicked or dragged
// DOWN (by the grab handle / header) to dismiss — the handle is real. Shows
// their photo + name, then Contact and Pay with their preferred choice first.
const SHEET_MS = 440; // keep in sync with --dur-sheet in globals.css

export function MemberSheet({
  id,
  name,
  avatarUrl,
  onClose,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<MemberContact | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0); // current translateY (px); 0 = resting
  const [h, setH] = useState(0); // measured panel height (for progress + offscreen)
  const [entered, setEntered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ y0: 0, y: 0, yPrev: 0, tPrev: 0, v: 0, active: false });
  const closed = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const reduce = useRef(
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  ).current;

  // Load the member's contact/pay info on open.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) {
        setLoaded(true);
        return;
      }
      const { data: row, error } = await supabase
        .from("profiles")
        .select("phone, contact_email, venmo, zelle, cashapp, paypal, pay_preferred, contact_preferred")
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      setData(error ? {} : ((row as MemberContact) ?? {}));
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Measure, place just off-screen (no transition), then slide up next frame.
  useLayoutEffect(() => {
    const ph = panelRef.current?.offsetHeight ?? 0;
    setH(ph);
    if (reduce) {
      setEntered(true);
      setY(0);
      return;
    }
    setY(ph || 800);
    const raf = requestAnimationFrame(() => {
      setEntered(true);
      setY(0);
    });
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  // Keep the measured height in sync as the body loads/changes — the mount-time
  // measure is the short "Loading…" height. Without this, the drag threshold,
  // the scrim's 1 - y/h math, AND the close slide all use a stale short height,
  // so close only travels partway (looks like "slides halfway, pauses, vanishes").
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    setDragging(false);
    if (reduce) {
      onClose();
      return;
    }
    // Slide down by the panel's CURRENT height (bottom-anchored → fully clears),
    // measured live so a stale mount-time ("Loading…") height can't leave it
    // half-off. setH keeps the scrim's 1 - y/h fade in step.
    const ch = panelRef.current?.offsetHeight || h || 800;
    setH(ch);
    setY(ch);
    closeTimer.current = window.setTimeout(onClose, SHEET_MS);
  };

  // Escape closes (with the slide-down).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-to-dismiss (handlers live on the header zone; the body scrolls freely).
  const onDown = (e: React.PointerEvent) => {
    if (closed.current) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { y0: e.clientY, y: 0, yPrev: e.clientY, tPrev: e.timeStamp, v: 0, active: true };
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const dy = Math.max(0, e.clientY - drag.current.y0); // down only
    const dt = e.timeStamp - drag.current.tPrev;
    if (dt > 0) drag.current.v = (e.clientY - drag.current.yPrev) / dt; // px/ms, + = downward
    drag.current.yPrev = e.clientY;
    drag.current.tPrev = e.timeStamp;
    drag.current.y = dy;
    setY(dy);
  };
  const onUp = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    const span = h || 600;
    // Read the live offset (ref), not state `y`, so a fast flick isn't undershot.
    if (drag.current.y > span * 0.3 || drag.current.v > 0.5) close();
    else setY(0); // snap back
  };
  const onCancel = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    setY(0); // interrupted gesture (call, back-swipe) → snap back, never dismiss
  };

  const contacts = data ? contactActions(data) : [];
  const pays = data ? payActions(data) : [];
  const copy = (v: string, key: string) => {
    navigator.clipboard?.writeText(v).catch(() => {});
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const progress = h > 0 ? Math.max(0, Math.min(1, 1 - y / h)) : entered ? 1 : 0;
  const noTrans = dragging || !entered || reduce;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-sheet-name"
      onClick={close}
      style={{
        backgroundColor: `rgba(0,0,0,${0.5 * progress})`,
        transition: noTrans ? "none" : `background-color ${SHEET_MS}ms var(--ease-ios)`,
      }}
    >
      <div
        ref={panelRef}
        className="relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl bg-background ring-1 ring-border sm:mb-6 sm:max-w-sm sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: `translateY(${y}px)`,
          transition: noTrans ? "none" : `transform ${SHEET_MS}ms var(--ease-ios)`,
          willChange: "transform",
        }}
      >
        <button
          onClick={close}
          aria-label="Close"
          className="press absolute right-4 top-4 z-10 text-foreground/40 hover:text-foreground"
        >
          ✕
        </button>

        {/* Grab handle + header: drag this DOWN to dismiss. touch-action:none so
            the vertical drag isn't swallowed as a scroll. */}
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          style={{ touchAction: "none" }}
          className="shrink-0 cursor-grab px-5 pt-3 active:cursor-grabbing"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-foreground/20" aria-hidden />
          <div className="flex flex-col items-center gap-2 text-center">
            <Avatar name={name} url={avatarUrl} size={72} />
            <p id="member-sheet-name" className="text-lg font-bold">
              {name}
            </p>
          </div>
        </div>

        {/* Body — scrolls if a member ever has many methods (rare). */}
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pt-4"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          {!loaded && <p className="text-center text-xs text-foreground/40">Loading…</p>}
          {loaded && contacts.length === 0 && pays.length === 0 && (
            <p className="rounded-xl bg-card p-3 text-center text-xs text-foreground/50 ring-1 ring-border">
              No contact or pay info shared yet.
            </p>
          )}

          {contacts.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-foreground/45">Contact</h3>
              {contacts.map((a) => (
                <ActionRow key={a.key} a={a} copied={copied === a.key} onCopy={() => copy(a.value, a.key)} />
              ))}
            </section>
          )}
          {pays.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-foreground/45">Pay</h3>
              {pays.map((a) => (
                <ActionRow key={a.key} a={a} copied={copied === a.key} onCopy={() => copy(a.value, a.key)} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ a, copied, onCopy }: { a: Action; copied: boolean; onCopy: () => void }) {
  const branded = Boolean(a.brand);
  const inner = (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-3 transition ${branded ? "text-white shadow-sm active:opacity-90" : "bg-card text-foreground ring-1 ring-border active:bg-background"}`}
      style={branded ? { backgroundColor: a.brand } : undefined}
    >
      {a.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.logo} alt="" className="h-5 w-5 shrink-0" />
      ) : a.emoji ? (
        <span className="shrink-0 text-base leading-none">{a.emoji}</span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {a.label}
          {a.preferred && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${branded ? "bg-white/25 text-white" : "bg-primary/15 text-primary"}`}
            >
              Preferred
            </span>
          )}
        </p>
        <p className={`truncate text-xs ${branded ? "text-white/80" : "text-foreground/55"}`}>
          {a.value}
          {a.note ? ` · ${a.note}` : ""}
        </p>
      </div>
      {!a.href && copied && (
        <span className={`shrink-0 text-xs font-semibold ${branded ? "text-white" : "text-primary"}`}>Copied ✓</span>
      )}
    </div>
  );
  return a.href ? (
    <a href={a.href} target={a.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="press block">
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onCopy} className="press block w-full text-left">
      {inner}
    </button>
  );
}
