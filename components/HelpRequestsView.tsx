"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AskForHelpSheet } from "@/components/AskForHelpSheet";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { useIdentity } from "@/components/IdentityProvider";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useBusyAction, useEvents, useHelpRequests } from "@/lib/hooks";
import { amIPresent, claimHelpItem, helpType, mapsUrl, respondToHelp, setHelpStatus, withdrawHelp } from "@/lib/helpRequests";
import { effectiveStatus } from "@/lib/events";
import { fetchMyBookings } from "@/lib/cabins";
import type { BringItem, HelpRequest } from "@/lib/types";

// The "Ask for Help" log (migration 0037). Shows open requests from members at
// the resort, lets you say "On my way" (the only response), and gives anyone
// who's present the button to post their own. A request can ask for N people;
// once N are on the way it reads as fulfilled (and everyone eligible is told).

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function relTime(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function firstNames(names: string[]): string {
  const fn = names.map((n) => n.split(" ")[0]);
  if (fn.length <= 3) return fn.join(", ");
  return `${fn.slice(0, 3).join(", ")} +${fn.length - 3}`;
}

export function HelpRequestsView() {
  const { user, isAdmin, promptSignIn, effectiveUserId, previewAsId } = useIdentity();
  const { today } = useDemoDate();
  const { events, mine, loading: eventsLoading } = useEvents();
  const { requests, loading, reload } = useHelpRequests();
  const { busy, run } = useBusyAction();

  const [bookingCoversToday, setBookingCoversToday] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // "am I on the way" + own-request controls resolve against the EFFECTIVE
  // viewer (the previewed member while an admin is previewing) — never a raw
  // auth.getUser() call, which would always be the real admin's id.
  const myId = effectiveUserId;

  // Whether an approved cabin stay covers today — a second "I'm here" signal,
  // read for the effective viewer so a preview sees what THAT member would.
  useEffect(() => {
    if (!user || !myId) {
      setBookingCoversToday(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const bookings = await fetchMyBookings(previewAsId ?? undefined);
      if (cancelled || !today) return;
      setBookingCoversToday(
        bookings.some((b) => b.status === "approved" && b.checkIn <= today && b.checkOut > today),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user, myId, previewAsId, today]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(id);
  }, [flash]);

  const atResort = useMemo(
    () => (today ? amIPresent(mine, events, today, bookingCoversToday) : false),
    [mine, events, today, bookingCoversToday],
  );
  // Upcoming events the viewer is RSVP'd GOING to (starts after today) — the
  // targets for a scheduled-ahead request. You can ask for help now for, say,
  // Labor Day weekend, and everyone attending it gets notified. Only events
  // you're going to (so it can never reach random people, and it's always an
  // MLR event). Rolled-up `effectiveStatus` handles day-RSVP events too.
  const goingFuture = useMemo(
    () =>
      !today
        ? []
        : events
            .filter((e) => e.startDate > today)
            .filter((e) => {
              const a = mine[e.id];
              return a ? effectiveStatus(a.status, a.days) === "going" : false;
            })
            .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [events, mine, today],
  );
  // Admins can post from anywhere (to test/demo); everyone else must be present
  // OR have a future event they're going to that they can schedule help for.
  // Never true while previewing — "view as" is read-only (see `previewAsId`
  // guards below), so there's no CTA to ask as the previewed member.
  const canAsk = !previewAsId && (atResort || goingFuture.length > 0 || isAdmin);

  const { active, done } = useMemo(() => {
    const active = requests.filter((r) => r.status === "open");
    const done = requests.filter((r) => r.status !== "open").slice(0, 10);
    return { active, done };
  }, [requests]);

  // Every write below is a no-op while previewing as another member — "view
  // as" only shows what they'd see, it never acts as them (or as the real
  // admin dressed up as them).
  const toggleOnWay = (r: HelpRequest) =>
    run(r.id, async () => {
      if (previewAsId) return;
      const already = myId != null && r.responses.some((x) => x.userId === myId);
      if (already) await withdrawHelp(r.id);
      else await respondToHelp(r.id);
      await reload();
    });

  const resolve = (r: HelpRequest) =>
    run(r.id, async () => {
      if (previewAsId) return;
      await setHelpStatus(r.id, "resolved");
      await reload();
    });

  const cancel = (r: HelpRequest) =>
    run(r.id, async () => {
      if (previewAsId) return;
      await setHelpStatus(r.id, "cancelled");
      await reload();
    });

  // Claim / release a "what to bring" item (keyed per-item, independent of the
  // per-request busy lock so checking off an item doesn't disable the card).
  const claimItem = async (itemId: string, claim: boolean) => {
    if (previewAsId) return;
    await claimHelpItem(itemId, claim);
    await reload();
  };

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">🙌 Ask for Help</h1>
        <p className="text-sm text-foreground/60">
          Need a hand at the resort? Send a quick request — members who are here and willing to help get
          notified. Open requests show below so everyone knows what&rsquo;s going on and who&rsquo;s helping.
        </p>
      </header>

      {flash && (
        <p className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-medium text-primary ring-1 ring-primary/20">
          {flash}
        </p>
      )}

      {/* ── Ask CTA ───────────────────────────────────────────────────────── */}
      {!user ? (
        <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          <p className="text-sm text-foreground/70">Sign in to ask for help or offer it.</p>
          <button
            onClick={promptSignIn}
            className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
          >
            Add your name &amp; email
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="press w-full rounded-2xl bg-primary py-4 text-base font-semibold text-white shadow-sm"
          >
            🙌 Ask for help
          </button>
          {isAdmin && !atResort && (
            <p className="px-1 text-xs text-muted">
              🔧 Admin test mode — you&rsquo;re not at a live event. Tick{" "}
              <span className="font-medium">&ldquo;Notify everyone willing to help&rdquo;</span> in the form so it reaches testers.
            </p>
          )}
          {!canAsk && !isAdmin && (
            <p className="px-1 text-xs text-muted">
              Requests only reach people at MLR — when you&rsquo;re RSVP&rsquo;d{" "}
              <span className="font-medium">going</span> to a current event (or have an approved cabin stay), or by
              scheduling ahead for an upcoming event you&rsquo;re going to. RSVP{" "}
              <span className="font-medium">going</span> to an event and it&rsquo;ll go live automatically.
            </p>
          )}
        </div>
      )}

      {/* ── Active requests ───────────────────────────────────────────────── */}
      {loading || eventsLoading ? (
        <SkeletonList count={2} />
      ) : active.length === 0 ? (
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-2xl" aria-hidden>🌲</p>
          <p className="mt-1 text-sm font-medium">No open requests right now</p>
          <p className="text-xs text-muted">All quiet. Anyone who needs a hand can post above.</p>
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-semibold">Open requests</h2>
          {active.map((r) => (
            <HelpCard
              key={r.id}
              req={r}
              myId={myId}
              isAdmin={isAdmin}
              busy={busy === r.id}
              onToggleOnWay={() => toggleOnWay(r)}
              onResolve={() => resolve(r)}
              onCancel={() => cancel(r)}
              onClaimItem={claimItem}
            />
          ))}
        </section>
      )}

      {/* ── Recently handled ──────────────────────────────────────────────── */}
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-semibold text-foreground/60">Recently handled</h2>
          {done.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-border">
              <span aria-hidden>{r.status === "resolved" ? "✅" : "✖️"}</span>
              <span className="min-w-0 flex-1 truncate text-muted">
                <span className="font-medium text-foreground/70">{r.name.split(" ")[0]}</span> · {r.description}
              </span>
              <span className="shrink-0 text-xs text-faint">
                {r.status === "resolved" ? "Resolved" : "Cancelled"}
              </span>
            </div>
          ))}
        </section>
      )}

      {sheetOpen && today && (
        <AskForHelpSheet
          events={events}
          today={today}
          futureEvents={goingFuture}
          presentNow={atResort}
          onClose={() => setSheetOpen(false)}
          onSubmitted={(n, audience) => {
            void reload();
            setFlash(
              n > 0
                ? `🔔 Sent to ${n} ${n === 1 ? "person" : "people"}. They'll get a ping and can say they're on the way.`
                : audience === "all_willing"
                  ? "Posted. No willing helpers are reachable right now — it's in the log for when people open the app."
                  : "Posted to the log. No one else is checked in as here right now — it'll be seen when people arrive or open the app.",
            );
          }}
        />
      )}
    </div>
  );
}

function HelpCard({
  req,
  myId,
  isAdmin,
  busy,
  onToggleOnWay,
  onResolve,
  onCancel,
  onClaimItem,
}: {
  req: HelpRequest;
  myId: string | null;
  isAdmin: boolean;
  busy: boolean;
  onToggleOnWay: () => void;
  onResolve: () => void;
  onCancel: () => void;
  onClaimItem: (itemId: string, claim: boolean) => Promise<void>;
}) {
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const toggleItem = async (it: BringItem) => {
    if (claimingId) return;
    const mineItem = myId != null && it.claimedBy === myId;
    setClaimingId(it.id);
    try {
      await onClaimItem(it.id, !mineItem);
    } finally {
      setClaimingId(null);
    }
  };
  const mine = myId != null && req.userId === myId;
  const onWay = req.responses; // every response means "on my way"
  const iAmOnWay = myId != null && onWay.some((x) => x.userId === myId);
  const needed = Math.max(1, req.neededCount);
  const committed = onWay.length;
  const fulfilled = req.fulfilledAt != null || committed >= needed;
  const scheduled = new Date(req.neededAt).getTime() - new Date(req.createdAt).getTime() > 10 * 60_000;
  const expired = req.expiresAt != null && new Date(req.expiresAt).getTime() < Date.now();
  const type = helpType(req.category);
  const urgent = type?.key === "urgent";

  return (
    <div
      className={`space-y-3 rounded-2xl p-4 ring-1 ${
        fulfilled ? "bg-primary/[0.06] ring-primary/25" : urgent ? "bg-accent/[0.06] ring-accent/30" : "bg-card ring-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar name={req.name} url={req.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{req.name}</span>
            {type && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  urgent ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary"
                }`}
              >
                {type.emoji} {type.label}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-medium text-muted">
              needs {needed} {needed === 1 ? "person" : "people"}
            </span>
          </p>
          <p className="text-xs text-faint">
            {relTime(req.createdAt)}
            {scheduled && <> · ⏰ for {clockTime(req.neededAt)}</>}
            {expired && !fulfilled && <> · past time</>}
          </p>
        </div>
      </div>

      <p className="text-sm text-foreground/85">{req.description}</p>

      {(req.whereText || (req.lat != null && req.lng != null)) && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
          {req.whereText && <span>📍 {req.whereText}</span>}
          {req.lat != null && req.lng != null && (
            <a
              href={mapsUrl(req.lat, req.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="press font-semibold text-primary underline-offset-2 hover:underline"
            >
              Open map →
            </a>
          )}
        </p>
      )}

      {/* What to bring — helpers check off the items they're bringing */}
      {req.items.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-background px-3 py-2.5 ring-1 ring-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            What to bring · {req.items.filter((it) => it.claimedBy).length}/{req.items.length} covered
          </p>
          <ul className="space-y-1">
            {req.items.map((it) => {
              const mineItem = myId != null && it.claimedBy === myId;
              const takenByOther = it.claimedBy != null && !mineItem;
              const itemBusy = claimingId === it.id;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => toggleItem(it)}
                    disabled={takenByOther || itemBusy}
                    aria-pressed={Boolean(it.claimedBy)}
                    className={`press flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm disabled:opacity-100 ${
                      mineItem ? "bg-primary/10" : "bg-card"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs text-white ring-1 ${
                        it.claimedBy ? "bg-primary ring-primary" : "ring-border"
                      }`}
                    >
                      {it.claimedBy ? "✓" : ""}
                    </span>
                    <span className={`min-w-0 flex-1 ${it.claimedBy ? "text-foreground/70" : "text-foreground/85"}`}>
                      {it.label}
                    </span>
                    {it.claimedBy && (
                      <span className="shrink-0 text-xs font-medium text-faint">
                        {mineItem ? "You're bringing" : `${(it.claimedByName ?? "Someone").split(" ")[0]}'s bringing`}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Who's helping / progress */}
      <div className={`rounded-xl px-3 py-2 text-xs ring-1 ${fulfilled ? "bg-primary/10 text-primary ring-primary/20" : "bg-background text-foreground/70 ring-border"}`}>
        {fulfilled ? (
          <p className="font-semibold">
            ✅ Covered — {committed} on the way
            {committed > needed ? ` (${committed - needed} more than you asked — 🎉)` : ""}
          </p>
        ) : committed > 0 ? (
          <p>🚶 <span className="font-medium">{committed} of {needed}</span> on the way</p>
        ) : (
          <p className="text-faint">No one on the way yet — be the first.</p>
        )}
        {onWay.length > 0 && (
          <p className={`mt-0.5 ${fulfilled ? "text-primary/80" : "text-muted"}`}>{firstNames(onWay.map((x) => x.name))}</p>
        )}
      </div>

      {/* Actions */}
      {mine ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button onClick={onResolve} disabled={busy} className="press rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Mark resolved
          </button>
          <button onClick={onCancel} disabled={busy} className="press text-xs font-medium text-foreground/55">
            Cancel
          </button>
          <span className="ml-auto text-xs text-faint">Sent to {req.notifiedCount}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={onToggleOnWay}
            disabled={busy}
            className={`press rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              iAmOnWay ? "bg-primary text-white" : "bg-primary/10 text-primary ring-1 ring-primary/30"
            }`}
          >
            {iAmOnWay ? "🚶 On my way ✓" : "🚶 On my way"}
          </button>
          {iAmOnWay && (
            <button onClick={onToggleOnWay} disabled={busy} className="press text-xs font-medium text-faint">
              Can&rsquo;t make it
            </button>
          )}
          {isAdmin && (
            <button onClick={onResolve} disabled={busy} className="press ml-auto text-xs font-medium text-faint">
              Resolve
            </button>
          )}
        </div>
      )}
    </div>
  );
}
