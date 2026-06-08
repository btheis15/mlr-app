"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { useIdentity } from "@/components/IdentityProvider";
import { useBusyAction } from "@/lib/hooks";
import { fetchProfiles, profileMap, type ProfileLite } from "@/lib/roles";
import { fetchBookings, formatStay, reviewStay } from "@/lib/cabins";
import type { CabinBooking } from "@/lib/types";

/**
 * Admin queue for cabin stay requests (Profile → Cabin Stays). Lists pending
 * requests with Approve / Deny (+ an optional note that rides along in the
 * confirmation email), and an "Upcoming stays" roster of what's approved.
 * Renders only for app admins; backed by review_cabin_stay(). Mirrors
 * AdminJoinRequests — load → act via RPC → reload, kept live via Realtime.
 */
export function AdminCabinBookings() {
  const { isAdmin } = useIdentity();
  const [pending, setPending] = useState<CabinBooking[]>([]);
  const [approved, setApproved] = useState<CabinBooking[]>([]);
  const [people, setPeople] = useState<Map<string, ProfileLite>>(new Map());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { busy, run } = useBusyAction();

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([fetchBookings(["pending"]), fetchBookings(["approved"])]);
    setPending(p);
    setApproved(a);
    const ids = Array.from(new Set([...p, ...a].map((b) => b.userId).filter(Boolean) as string[]));
    setPeople(profileMap(await fetchProfiles(ids)));
  }, []);

  useEffect(() => {
    if (!isAdmin || !isSupabaseConfigured) return;
    const sb = supabase;
    if (!sb) return;
    let cancelled = false;
    load();
    const channel = sb
      .channel("admin-cabin-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "cabin_bookings" }, () => {
        if (!cancelled) load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [isAdmin, load]);

  const review = (b: CabinBooking, approve: boolean) =>
    run(b.id, async () => {
      const { error } = await reviewStay(b.id, approve, notes[b.id]);
      if (error) {
        window.alert(error);
        return;
      }
      setNotes((n) => {
        const next = { ...n };
        delete next[b.id];
        return next;
      });
      await load();
    });

  if (!isAdmin || !isSupabaseConfigured) return null;

  return (
    <div className="space-y-4">
      {/* Pending queue */}
      <section className="space-y-2">
        <h3 className="px-0.5 text-xs font-bold uppercase tracking-wide text-foreground/45">
          Pending {pending.length > 0 && `(${pending.length})`}
        </h3>
        {pending.length === 0 ? (
          <p className="rounded-xl bg-card p-3 text-center text-xs text-foreground/50 ring-1 ring-border">
            No requests waiting. 🎉
          </p>
        ) : (
          pending.map((b) => {
            const who = b.userId ? people.get(b.userId) : undefined;
            return (
              <div key={b.id} className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
                <div className="flex items-center gap-2">
                  <Avatar name={who?.name ?? "Member"} url={who?.avatarUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{who?.name ?? "Member"}</p>
                    <p className="truncate text-xs text-foreground/55">
                      {b.cabinName} · {formatStay(b.checkIn, b.checkOut)}
                    </p>
                    <p className="text-xs text-foreground/45">
                      {b.guests} guest{b.guests === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                {b.notes && (
                  <p className="rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
                    “{b.notes}”
                  </p>
                )}
                <input
                  type="text"
                  value={notes[b.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [b.id]: e.target.value }))}
                  placeholder="Optional note (included in their email)"
                  className="w-full rounded-xl bg-background px-3 py-2 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy === b.id}
                    onClick={() => review(b, true)}
                    className="press flex-1 rounded-full bg-primary py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy === b.id}
                    onClick={() => review(b, false)}
                    className="press flex-1 rounded-full bg-background py-2 text-xs font-medium text-foreground/60 ring-1 ring-border disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Approved roster */}
      {approved.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-0.5 text-xs font-bold uppercase tracking-wide text-foreground/45">
            Upcoming stays ({approved.length})
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {approved.map((b) => {
              const who = b.userId ? people.get(b.userId) : undefined;
              return (
                <li key={b.id} className="flex items-center gap-2 p-3">
                  <Avatar name={who?.name ?? "Member"} url={who?.avatarUrl} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{who?.name ?? "Member"}</p>
                    <p className="truncate text-xs text-foreground/50">
                      {b.cabinName} · {formatStay(b.checkIn, b.checkOut)} · {b.guests}👤
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
