"use client";

import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { CabinRequestSheet } from "@/components/CabinRequestSheet";
import { SkeletonList } from "@/components/Skeleton";
import { Avatar } from "@/components/Avatar";
import { Sheet, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { fetchProfiles, type ProfileLite } from "@/lib/roles";
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
//
// Admins can also book a stay ON BEHALF of another member (migration 0087) —
// for family who don't use the app themselves. The "Booking for" row (admin
// only) opens a member picker; once set, the cabin cards' "Request a room"
// flow books + auto-approves under that member's name instead of the admin's.

// Member tag search: an empty query matches everyone; otherwise a substring, or
// any word that starts with what's typed ("b" → all B names).
function matchesName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const n = name.toLowerCase();
  return n.includes(q) || n.split(/\s+/).some((w) => w.startsWith(q));
}

// The two houses, for the no-backend / signed-out preview (kept in sync with the
// migration 0032 seed).
const PREVIEW_CABINS = [
  { name: "Cabin 1", roomCount: 3 },
  { name: "Red & White House", roomCount: 4 },
];

export default function RequestStayPage() {
  const { user, isAdmin, previewAsId, promptSignIn } = useIdentity();
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [avail, setAvail] = useState<CabinAvailability[]>([]);
  const [myBookings, setMyBookings] = useState<CabinBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetCabin, setSheetCabin] = useState<Cabin | null>(null);
  // Admin-only: booking on behalf of another member instead of themselves.
  const [forUser, setForUser] = useState<ProfileLite | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);

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
                <p className="mt-0.5 text-xs text-muted">
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
                <p className="mt-0.5 text-xs text-muted">
                  {c.roomCount} room{c.roomCount === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </section>
        </>
      ) : loading ? (
        <SkeletonList count={2} />
      ) : cabins.length === 0 ? (
        <ComingSoonCTA
          icon="🏡"
          title="Cabin booking is almost ready"
          note="The booking tables aren't set up yet — check back soon."
        />
      ) : (
        <>
          {/* ── Admin: book on behalf of another member ───────────────────── */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setMemberPickerOpen(true)}
              className="press flex w-full items-center gap-2 rounded-2xl bg-card p-3 text-left ring-1 ring-border"
            >
              {forUser ? (
                <Avatar name={forUser.name} url={forUser.avatarUrl} size={32} />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base">🧑‍🤝‍🧑</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-faint">Booking for</span>
                <span className="block truncate text-sm font-semibold">{forUser ? forUser.name : "Yourself"}</span>
              </span>
              <span className="shrink-0 text-xs font-medium text-primary">{forUser ? "Change" : "Book for someone"}</span>
            </button>
          )}

          {/* ── Family Fest availability ──────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <h2 className="text-sm font-semibold">🎉 Family Fest week</h2>
              <span className="text-xs text-muted">{formatStay(FF_CHECK_IN, FF_CHECK_OUT)}</span>
            </div>
            {cabins.map((c) => (
              <CabinCard key={c.id} cabin={c} available={availFor(c.id)} onRequest={() => setSheetCabin(c)} />
            ))}
            <p className="px-1 pt-1 text-xs text-faint">
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
          forUser={forUser}
          onClose={() => setSheetCabin(null)}
          onSubmitted={async () => {
            await load();
            setForUser(null);
          }}
        />
      )}

      {memberPickerOpen && (
        <MemberPickerSheet
          selectedId={forUser?.id ?? null}
          onClose={() => setMemberPickerOpen(false)}
          onPick={(m) => {
            setForUser(m);
            setMemberPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MemberPickerSheet({
  selectedId,
  onClose,
  onPick,
}: {
  selectedId: string | null;
  onClose: () => void;
  onPick: (member: ProfileLite | null) => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [members, setMembers] = useState<ProfileLite[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchProfiles().then((ppl) => setMembers([...ppl].sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  const shown = members.filter((m) => matchesName(m.name, query));

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="member-picker-title"
      header={<h2 id="member-picker-title" className="text-lg font-bold">Book for who?</h2>}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search family…"
        autoFocus
        className={`${FIELD} w-full`}
      />
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => {
            onPick(null);
            close();
          }}
          className="press flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground/70 hover:bg-background"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base">🙋</span>
          <span className="font-medium">Yourself</span>
          {!selectedId && <span className="ml-auto text-primary">✓</span>}
        </button>
        {shown.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m)}
            className="press flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-background"
          >
            <Avatar name={m.name} url={m.avatarUrl} size={32} />
            <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
            {selectedId === m.id && <span className="text-primary">✓</span>}
          </button>
        ))}
        {shown.length === 0 && <p className="px-2 py-1 text-xs text-faint">No matching members.</p>}
      </div>
    </Sheet>
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
          {cabin.bedCount != null && (
            <p className="mt-0.5 text-xs text-muted">🛏️ {cabin.bedCount} bed{cabin.bedCount === 1 ? "" : "s"} total</p>
          )}
        </div>
        <button
          onClick={onRequest}
          className="press shrink-0 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-white"
        >
          Request a room
        </button>
      </div>
      {cabin.notes && (
        <p className="mt-3 rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
          ℹ️ {cabin.notes}
        </p>
      )}
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
  denied: { label: "Not approved", chip: "bg-foreground/10 text-muted" },
  cancelled: { label: "Cancelled", chip: "bg-foreground/10 text-faint" },
};

function BookingRow({ booking, onCancel }: { booking: CabinBooking; onCancel: () => void }) {
  const s = STATUS[booking.status];
  const canCancel = booking.status === "pending" || booking.status === "approved";
  return (
    <div className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{booking.cabinName ?? "Cabin"}</p>
          <p className="mt-0.5 text-xs text-muted">{formatStay(booking.checkIn, booking.checkOut)}</p>
          <p className="text-xs text-faint">
            {booking.guests} guest{booking.guests === 1 ? "" : "s"}
          </p>
          {booking.rooms.length > 0 && (
            <p className="text-xs text-faint">🛏️ {booking.rooms.map((r) => r.name).join(", ")}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.chip}`}>{s.label}</span>
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
