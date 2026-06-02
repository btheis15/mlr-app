"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { contactActions, payActions, type Action, type MemberContact } from "@/lib/contact";

// Tap a member's avatar/name anywhere → this popup. Shows their photo + name,
// then Contact and Pay options with their preferred choice first. Loads the
// info on open; degrades to "nothing shared yet" if the 0006 columns or the
// fields are empty.
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
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  // Play the slide-down/scale-out, THEN unmount (CSS can't animate an unmounted
  // node); 300ms matches --dur-sheet. Reduce-motion closes immediately. Guard
  // against double-fire (scrim + ✕); the timer is cleared on unmount.
  const dismiss = () => {
    if (closeTimer.current !== null) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 300);
  };

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

  // Escape closes (with the dismiss animation); clear any pending timer on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contacts = data ? contactActions(data) : [];
  const pays = data ? payActions(data) : [];
  const copy = (v: string, key: string) => {
    navigator.clipboard?.writeText(v).catch(() => {});
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center ${closing ? "scrim-out" : "scrim-in"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-sheet-name"
      onClick={dismiss}
    >
      <div
        className={`relative max-h-[85dvh] w-full max-w-sm space-y-4 overflow-y-auto overscroll-contain rounded-3xl bg-background p-5 ring-1 ring-border ${closing ? "sheet-close sm:pop-close" : "sheet-panel sm:pop-panel"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto -mt-1 h-1.5 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
        <button onClick={dismiss} aria-label="Close" className="press absolute right-5 top-5 text-foreground/40 hover:text-foreground">✕</button>
        <div className="flex flex-col items-center gap-2 pt-1 text-center">
          <Avatar name={name} url={avatarUrl} size={72} />
          <p id="member-sheet-name" className="text-lg font-bold">{name}</p>
        </div>

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
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${branded ? "bg-white/25 text-white" : "bg-primary/15 text-primary"}`}>Preferred</span>
          )}
        </p>
        <p className={`truncate text-xs ${branded ? "text-white/80" : "text-foreground/55"}`}>
          {a.value}
          {a.note ? ` · ${a.note}` : ""}
        </p>
      </div>
      {!a.href && copied && <span className={`shrink-0 text-xs font-semibold ${branded ? "text-white" : "text-primary"}`}>Copied ✓</span>}
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
