"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { useIdentity } from "@/components/IdentityProvider";
import { useBusyAction } from "@/lib/hooks";
import { fetchProfiles, profileMap, type ProfileLite } from "@/lib/roles";
import { fetchBookings, formatStay, reviewStay, cancelStay } from "@/lib/cabins";
import { EditBookingSheet } from "@/components/EditBookingSheet";
import type { CabinBooking } from "@/lib/types";

/**
 * Stale-while-revalidate cache for the admin cabin-stay queue. This component
 * remounts every time the admin section is opened; without this it resets to
 * empty and the "Pending" + "Upcoming stays" lists blank out and then pop back
 * in when the fetch lands. Holding the last result in memory lets a returning
 * admin paint instantly from cache while the background refetch (and Realtime)
 * keep it current. Memory-only (per session, admin-only) and only ever written
 * *after* a client fetch in load() — never during SSR/render — so it can't
 * change the server/first-paint render and can't cause a hydration mismatch (a
 * cold load starts with an empty cache, i.e. the original empty-lists behavior;
 * `user`/`isAdmin` are null during prerender so this component renders null
 * server-side regardless).
 */
let adminCabinCache: {
  pending: CabinBooking[];
  approved: CabinBooking[];
  people: Map<string, ProfileLite>;
} | null = null;

/**
 * Admin queue for cabin stay requests (Profile → Cabin Stays). Lists pending
 * requests with Approve / Deny (+ an optional note that rides along in the
 * confirmation email), and an "Upcoming stays" roster of what's approved.
 * Renders only for app admins; backed by review_cabin_stay(). Mirrors
 * AdminJoinRequests — load → act via RPC → reload, kept live via Realtime.
 */
export function AdminCabinBookings() {
  const { isAdmin } = useIdentity();
  const [pending, setPending] = useState<CabinBooking[]>(adminCabinCache?.pending ?? []);
  const [approved, setApproved] = useState<CabinBooking[]>(adminCabinCache?.approved ?? []);
  const [people, setPeople] = useState<Map<string, ProfileLite>>(adminCabinCache?.people ?? new Map());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState<Record<string, boolean>>({});
  const { busy, run } = useBusyAction();
  // Deep-link from a "X requested a cabin stay" notification
  // (/admin/cabins?booking=<id>) — scroll to and flash-ring that request
  // instead of leaving the admin to find it in the list themselves. Fires
  // once pending has loaded (not on `loading`, so the warm-cache instant
  // paint still gets the flash) and only once (deepLinked ref).
  const [flashId, setFlashId] = useState<string | null>(null);
  const deepLinked = useRef(false);
  const [editing, setEditing] = useState<CabinBooking | null>(null);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([fetchBookings(["pending"]), fetchBookings(["approved"])]);
    setPending(p);
    setApproved(a);
    const ids = Array.from(
      new Set([...p, ...a].flatMap((b) => [b.userId, b.bookedBy]).filter(Boolean) as string[]),
    );
    const ppl = profileMap(await fetchProfiles(ids));
    setPeople(ppl);
    // Warm the cache after the successful fetch so revisiting paints instantly;
    // Realtime + the next load() keep it current.
    adminCabinCache = { pending: p, approved: a, people: ppl };
  }, []);

  useEffect(() => {
    if (deepLinked.current || typeof window === "undefined" || pending.length === 0) return;
    const want = new URLSearchParams(window.location.search).get("booking");
    if (!want) return;
    if (!pending.some((b) => b.id === want)) return;
    deepLinked.current = true;
    setFlashId(want);
    window.setTimeout(() => document.getElementById(`cabin-request-${want}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    window.setTimeout(() => setFlashId(null), 2200);
  }, [pending]);

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
      const { error } = await reviewStay(b.id, approve, notes[b.id], notify[b.id] ?? true);
      if (error) {
        window.alert(error);
        return;
      }
      setNotes((n) => {
        const next = { ...n };
        delete next[b.id];
        return next;
      });
      setNotify((n) => {
        const next = { ...n };
        delete next[b.id];
        return next;
      });
      await load();
    });

  const cancel = (b: CabinBooking) => {
    const who = (b.userId ? people.get(b.userId) : undefined)?.name ?? "this member";
    if (!window.confirm(`Cancel ${who}'s ${b.cabinName ?? "cabin"} stay for ${formatStay(b.checkIn, b.checkOut)}?`)) return;
    run(b.id, async () => {
      const { error } = await cancelStay(b.id);
      if (error) {
        window.alert(error);
        return;
      }
      await load();
    });
  };

  if (!isAdmin || !isSupabaseConfigured) return null;

  return (
    <div className="space-y-4">
      {/* Pending queue */}
      <section className="space-y-2">
        <h3 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">
          Pending {pending.length > 0 && `(${pending.length})`}
        </h3>
        {pending.length === 0 ? (
          <p className="rounded-xl bg-card p-3 text-center text-xs text-muted ring-1 ring-border">
            No requests waiting. 🎉
          </p>
        ) : (
          pending.map((b) => {
            const who = b.userId ? people.get(b.userId) : undefined;
            return (
              <div
                key={b.id}
                id={`cabin-request-${b.id}`}
                className={`space-y-2 rounded-2xl bg-card p-3 transition-shadow ${flashId === b.id ? "ring-2 ring-primary" : "ring-1 ring-border"}`}
              >
                <div className="flex items-center gap-2">
                  <Avatar name={who?.name ?? "Member"} url={who?.avatarUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{who?.name ?? "Member"}</p>
                    <p className="truncate text-xs text-muted">
                      {b.cabinName} · {formatStay(b.checkIn, b.checkOut)}
                    </p>
                    <p className="text-xs text-faint">
                      {b.guests} guest{b.guests === 1 ? "" : "s"}
                      {b.bookedBy && ` · booked by ${people.get(b.bookedBy)?.name ?? "an admin"}`}
                    </p>
                    <p className="text-xs text-muted">
                      🛏️ {b.rooms.length > 0 ? b.rooms.map((r) => r.name).join(", ") : "No rooms assigned"}
                      {" · "}
                      <button type="button" onClick={() => setEditing(b)} className="press font-medium text-primary">
                        Edit
                      </button>
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
                <label className="flex items-center gap-1.5 px-0.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={notify[b.id] ?? true}
                    onChange={(e) => setNotify((n) => ({ ...n, [b.id]: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded"
                  />
                  Email them a confirmation
                </label>
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
                  <button
                    disabled={busy === b.id}
                    onClick={() => cancel(b)}
                    className="press rounded-full px-3 py-2 text-xs font-medium text-accent disabled:opacity-50"
                  >
                    Cancel
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
          <h3 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">
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
                    <p className="truncate text-xs text-muted">
                      {b.cabinName} · {formatStay(b.checkIn, b.checkOut)} · {b.guests}👤
                      {b.bookedBy && ` · booked by ${people.get(b.bookedBy)?.name ?? "an admin"}`}
                    </p>
                    <p className="truncate text-xs text-muted">
                      🛏️ {b.rooms.length > 0 ? b.rooms.map((r) => r.name).join(", ") : "No rooms assigned"}
                      {" · "}
                      <button type="button" onClick={() => setEditing(b)} className="press font-medium text-primary">
                        Edit
                      </button>
                    </p>
                  </div>
                  <button
                    disabled={busy === b.id}
                    onClick={() => cancel(b)}
                    className="press shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {editing && (
        <EditBookingSheet
          booking={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
