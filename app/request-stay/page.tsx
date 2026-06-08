"use client";

import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { CabinRequestSheet } from "@/components/CabinRequestSheet";
import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  FF_CHECK_IN,
  FF_CHECK_OUT,
  cancelStay,
  fetchAvailability,
  fetchCabins,
  fetchMyBookings,
  formatStay,
} from "@/lib/cabins";
import type { Cabin, CabinAvailability, CabinBooking } from "@/lib/types";

// "Request a Cabin Stay" — members see how many rooms are open in each house for
// Family Fest week, request a room (any dates) via a sheet, and track their own
// requests. Admins approve/deny from Profile → Cabin Stays. Reads degrade to a
// "coming soon" when there's no backend yet (same idiom as Committees/Profile).

// The two houses, for the no-backend / signed-out preview (kept in sync with the
// migration 0032 seed).
const PREVIEW_CABINS = [
  { name: "Cabin 1", roomCount: 3 },
  { name: "Red & White House", roomCount: 4 },
];

export default function RequestStayPage() {
  const { user, previewAsId, promptSignIn } = useIdentity();
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [avail, setAvail] = useState<CabinAvailability[]>([]);
  const [myBookings, setMyBookings] = useState<CabinBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetCabin, setSheetCabin] = useState<Cabin | null>(null);

  const load = useCallback(async () => {
    const [c, a, b] = await Promise.all([
      fetchCabins(),
      fetchAvailability(FF_CHECK_IN, FF_CHECK_OUT),
      // While an admin is previewing as a member, show THAT member's requests.
      fetchMyBookings(previewAsId ?? undefined),
    ]);
    setCabins(c);
    setAvail(a);
    setMyBookings(b);
    setLoading(false);
  }, [previewAsId]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const sb = supabase;
    if (!sb) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      await load();
      const watch = previewAsId ?? (await sb.auth.getUser()).data.user?.id;
      if (cancelled || !watch) return;
      // Keep "Your requests" live when an admin approves/denies one (scoped to
      // whoever's requests are shown — the previewed member while previewing).
      channel = sb
        .channel(`my-cabin-bookings-${watch}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cabin_bookings", filter: `user_id=eq.${watch}` },
          () => load(),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [load, user?.email, previewAsId]);

  const availFor = (cabinId: string) => avail.find((a) => a.cabinId === cabinId)?.available ?? null;

  const cancel = async (b: CabinBooking) => {
    if (!window.confirm(`Cancel your ${b.cabinName ?? "cabin"} request for ${formatStay(b.checkIn, b.checkOut)}?`)) {
      return;
    }
    await cancelStay(b.id);
    await load();
  };

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">🏡 Request a Cabin Stay</h1>
        <p className="text-sm text-foreground/60">
          Reserve a room in one of the resort&rsquo;s two houses — defaulting to Family Fest week. An admin reviews
          each request.
        </p>
      </header>

      {/* ── No backend yet: informative preview ──────────────────────────── */}
      {!isSupabaseConfigured ? (
        <>
          <ComingSoonCTA
            icon="🏡"
            title="Cabin booking is coming soon"
            note="You'll be able to request a room and get an approval notification right here."
          />
          <section className="space-y-2">
            {PREVIEW_CABINS.map((c) => (
              <div key={c.name} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="mt-0.5 text-xs text-foreground/55">
                  {c.roomCount} room{c.roomCount === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </section>
        </>
      ) : !user ? (
        /* ── Signed out: invite to sign in, still show the houses ─────────── */
        <>
          <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
            <p className="text-sm text-foreground/70">Sign in to request a room and track your stay.</p>
            <button
              onClick={promptSignIn}
              className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
            >
              Add your name &amp; email
            </button>
          </div>
          <section className="space-y-2">
            {(cabins.length ? cabins : PREVIEW_CABINS.map((c, i) => ({ id: String(i), slug: "", name: c.name, roomCount: c.roomCount, sortOrder: i }))).map((c) => (
              <div key={c.name} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="mt-0.5 text-xs text-foreground/55">
                  {c.roomCount} room{c.roomCount === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </section>
        </>
      ) : loading ? (
        <p className="py-8 text-center text-sm text-foreground/40">Loading…</p>
      ) : cabins.length === 0 ? (
        <ComingSoonCTA
          icon="🏡"
          title="Cabin booking is almost ready"
          note="The booking tables aren't set up yet — check back soon."
        />
      ) : (
        <>
          {/* ── Family Fest availability ──────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <h2 className="text-sm font-semibold">🎉 Family Fest week</h2>
              <span className="text-xs text-foreground/50">{formatStay(FF_CHECK_IN, FF_CHECK_OUT)}</span>
            </div>
            {cabins.map((c) => (
              <CabinCard key={c.id} cabin={c} available={availFor(c.id)} onRequest={() => setSheetCabin(c)} />
            ))}
            <p className="px-1 pt-1 text-xs text-foreground/45">
              Need different dates? Tap <span className="font-medium text-foreground/70">Request a room</span> and pick
              any week.
            </p>
          </section>

          {/* ── Your requests ─────────────────────────────────────────────── */}
          {myBookings.length > 0 && (
            <section className="space-y-2">
              <h2 className="px-0.5 text-sm font-semibold">Your requests</h2>
              {myBookings.map((b) => (
                <BookingRow key={b.id} booking={b} onCancel={() => cancel(b)} />
              ))}
            </section>
          )}
        </>
      )}

      {sheetCabin && (
        <CabinRequestSheet
          cabin={sheetCabin}
          onClose={() => setSheetCabin(null)}
          onSubmitted={load}
        />
      )}
    </div>
  );
}

function CabinCard({
  cabin,
  available,
  onRequest,
}: {
  cabin: Cabin;
  available: number | null;
  onRequest: () => void;
}) {
  const left = available ?? cabin.roomCount;
  const full = available !== null && available <= 0;
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{cabin.name}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <CapacityDots total={cabin.roomCount} open={left} />
            <span className={`text-xs font-medium ${full ? "text-accent" : "text-foreground/60"}`}>
              {available === null
                ? `${cabin.roomCount} room${cabin.roomCount === 1 ? "" : "s"}`
                : full
                  ? "Currently full"
                  : `${left} of ${cabin.roomCount} room${cabin.roomCount === 1 ? "" : "s"} left`}
            </span>
          </div>
        </div>
        <button
          onClick={onRequest}
          className="press shrink-0 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-white"
        >
          Request a room
        </button>
      </div>
    </div>
  );
}

/** A little capacity meter: one dot per room — open rooms in green, taken in grey. */
function CapacityDots({ total, open }: { total: number; open: number }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i < open ? "bg-primary" : "bg-foreground/20"}`}
        />
      ))}
    </span>
  );
}

const STATUS: Record<CabinBooking["status"], { label: string; chip: string }> = {
  pending: { label: "Pending", chip: "bg-sun/15 text-sun" },
  approved: { label: "Approved ✓", chip: "bg-primary/15 text-primary" },
  denied: { label: "Not approved", chip: "bg-foreground/10 text-foreground/55" },
  cancelled: { label: "Cancelled", chip: "bg-foreground/10 text-foreground/45" },
};

function BookingRow({ booking, onCancel }: { booking: CabinBooking; onCancel: () => void }) {
  const s = STATUS[booking.status];
  const canCancel = booking.status === "pending" || booking.status === "approved";
  return (
    <div className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{booking.cabinName ?? "Cabin"}</p>
          <p className="mt-0.5 text-xs text-foreground/55">{formatStay(booking.checkIn, booking.checkOut)}</p>
          <p className="text-xs text-foreground/45">
            {booking.guests} guest{booking.guests === 1 ? "" : "s"}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.label}</span>
      </div>
      {booking.reviewNote && (
        <p className="rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
          <span className="font-medium">Note from the admin:</span> {booking.reviewNote}
        </p>
      )}
      {canCancel && (
        <button
          onClick={onCancel}
          className="press text-xs font-medium text-accent"
        >
          Cancel request
        </button>
      )}
    </div>
  );
}
