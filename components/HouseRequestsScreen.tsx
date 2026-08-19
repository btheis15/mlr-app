"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  KIND_META,
  KIND_ORDER,
  fetchHouseAdmins,
  isSettled,
  requestGroup,
  summarize,
  type HouseAdmin,
  type HouseRequest,
} from "@/lib/houseRequests";
import { useDeepLinkFlash, useHouseRequests, useResolvedHouse, useUrlParam } from "@/lib/hooks";
import { useCachedResource } from "@/lib/swrCache";
import { isSupabaseConfigured } from "@/lib/supabase";
import { formatMoney, plural } from "@/lib/format";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { MigrationHint } from "@/components/MigrationHint";
import { SignInWall } from "@/components/Guard";
import { Avatar } from "@/components/Avatar";
import { HouseRequestCard, ProgressActions, ReviewActions } from "@/components/HouseRequestCard";
import { HouseRequestSheet } from "@/components/HouseRequestSheet";
import { HouseRequestComposer } from "@/components/HouseRequestComposer";
import { HouseDeliveryNudge } from "@/components/HouseDeliveryNudge";
import { useIdentity } from "@/components/IdentityProvider";

/**
 * `/house/requests` — a house's Requests board (migrations 0194–0195): ideas,
 * purchase requests and reimbursements, with a House Admin's decision on each.
 *
 * Resolves the viewer's own house, or a `?house=<slug>` deep-link (admins can
 * open any), exactly like /house and /house/lists. A `?request=<id>` param
 * scrolls to and flashes one row, so a notification lands on the right card.
 */
export function HouseRequestsScreen({ slug }: { slug?: string | null }) {
  const { house, isMember, loading } = useResolvedHouse(slug);

  if (loading) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/house" label="House" />
        <SkeletonList />
      </div>
    );
  }

  if (!house || !isMember) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/house" label="House" />
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">🧾</p>
          <h1 className="mt-2 text-lg font-bold">{house ? house.name : "You're not in a house yet"}</h1>
          <p className="mt-1 text-sm text-muted">
            {house
              ? "This is a private house. Ask an admin to add you to see its requests."
              : "Requests are a house thing — ask an admin to add you to yours."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <SignInWall title="Requests" note="Sign in to see what your house has asked for.">
      <Board houseId={house.id} houseName={house.name} />
    </SignInWall>
  );
}

/**
 * What the three kinds mean, permanently on the board.
 *
 * ⚠️ Deliberately NOT a dismissible tip and NOT collapsed by default. The
 * distinction is the thing people got wrong, this board is visited a handful of
 * times a year, and a legend somebody dismissed in March is no help in August.
 * It's three short lines — cheap enough to simply always be true.
 */
function KindLegend() {
  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
      {KIND_ORDER.map((k) => {
        const meta = KIND_META[k];
        return (
          <div key={k} className={`flex items-start gap-2.5 border-l-4 pl-2.5 ${meta.edge}`}>
            <span aria-hidden className="text-base leading-tight">
              {meta.emoji}
            </span>
            <p className="min-w-0 flex-1 text-xs leading-snug">
              <span className={`font-bold ${meta.text}`}>{meta.label}</span>{" "}
              <span className="text-muted">— {meta.deal}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

type Filter = "open" | "done" | "mine" | "all";

function Board({ houseId, houseName }: { houseId: string; houseName: string }) {
  const { requests, loading, canReview, ready, reload } = useHouseRequests(houseId);
  const { previewAsId } = useIdentity();
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<HouseRequest | null>(null);
  const [composing, setComposing] = useState(false);
  // A NEW purchase request seeded from an agreed idea — never an edit of it.
  const [promoting, setPromoting] = useState<HouseRequest | null>(null);

  const deepLinkId = useUrlParam("request");
  const flashId = useDeepLinkFlash("request-", deepLinkId, !loading);

  // Who to ask. Cached because it's a second query on a screen that already has
  // one, and it never changes mid-session in practice.
  const { data: admins } = useCachedResource<HouseAdmin[]>(
    isSupabaseConfigured ? `houseAdmins.${houseId}` : null,
    [],
    () => fetchHouseAdmins(houseId),
    { persist: "local" },
  );

  const summary = useMemo(() => summarize(requests), [requests]);

  const shown = useMemo(() => {
    switch (filter) {
      case "open":
        return requests.filter((r) => !isSettled(r));
      case "done":
        return requests.filter(isSettled);
      case "mine":
        return requests.filter((r) => r.mine);
      case "all":
        return requests;
    }
  }, [requests, filter]);

  const open = openId ? requests.find((r) => r.id === openId) ?? null : null;

  // The one grouping that matters on the board: what's waiting on a decision vs.
  // everything else. There is no separate admin queue — deciding is a House Admin
  // thing and House Admins are members of the house, so this screen IS the queue
  // (migration 0202 removed the cross-house admin surface, which could only ever
  // have shown the viewer's own house anyway).
  const waiting = shown.filter((r) => requestGroup(r) === "waiting");
  // ⚠️ Approved-but-not-done gets its OWN section rather than being buried in
  // "everything else". This is the exact gap the feature exists to expose — a
  // request that was said yes to and then quietly never happened — and it was
  // sitting in the same undifferentiated pile as finished history.
  const toDo = shown.filter((r) => requestGroup(r) === "toDo");
  const rest = shown.filter((r) => requestGroup(r) !== "waiting" && requestGroup(r) !== "toDo");

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/house" label="House" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">🧾 Requests</h1>
        <p className="text-sm text-muted">
          Three different asks for {houseName} — an idea, something for the house to buy, or money back for something
          you paid for. A House Admin decides, and does the buying.
        </p>
      </header>

      {/* ⚠️ THE LEGEND IS PERMANENT, not a first-run tip. Somebody reads this
          board a few times a year, so "they'll learn it once" is wrong — the
          whole reason a purchase request was mistaken for "he's buying it
          himself" is that nothing on screen ever said otherwise. Three lines,
          each naming whose money and who shops. */}
      <KindLegend />

      {/* "People are coming and nobody's ordered this yet." Reviewers only — it's
          a call to action for whoever actually places the orders, and a member
          can't act on it. Self-hides unless both halves are true. */}
      {canReview && <HouseDeliveryNudge houseId={houseId} houseName={houseName} requests={requests} />}

      {/* The at-a-glance numbers — what a MEMBER cares about: is anything waiting,
          and has anything been approved that nobody has actually done. The second
          tile splits by kind, because "order it" and "pay them" are different
          chores that fall to different follow-through. */}
      {!loading && requests.length > 0 && (
        <div className="flex gap-3">
          <div className="flex-1 rounded-2xl bg-card p-3 ring-1 ring-border">
            <p className="text-lg font-bold tabular-nums">{summary.waiting}</p>
            <p className="text-xs text-muted">
              waiting on a decision
              {summary.waitingCost > 0 ? ` · ${formatMoney(summary.waitingCost)}` : ""}
            </p>
          </div>
          <div className="flex-1 rounded-2xl bg-card p-3 ring-1 ring-border">
            <p className="text-lg font-bold tabular-nums">{summary.notOrdered + summary.unpaid}</p>
            <p className="text-xs text-muted">
              {summary.unpaid === 0
                ? "approved, nobody's ordered it"
                : summary.notOrdered === 0
                  ? `approved, nobody's been paid · ${formatMoney(summary.unpaidCost)}`
                  : `${summary.notOrdered} to order · ${summary.unpaid} to pay out`}
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setComposing(true)}
        disabled={!!previewAsId}
        className="press w-full rounded-2xl bg-primary p-4 text-left text-white shadow-sm disabled:opacity-50"
      >
        <p className="text-sm font-semibold">＋ Ask for something</p>
        <p className="mt-0.5 text-xs text-white/80">We&rsquo;ll ask which of the three it is first</p>
      </button>

      {loading ? (
        <SkeletonList count={3} />
      ) : requests.length === 0 ? (
        <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">💡</p>
          <h2 className="text-base font-bold">Nothing here yet</h2>
          <p className="text-sm text-muted">
            This is where an idea stops being just an idea. Add the thing you keep meaning to mention — a House Admin
            will approve it, deny it, or change it, and you&rsquo;ll see what happened.
          </p>
          {/* Only when the table genuinely isn't there — an empty board is a
              perfectly healthy state and must not nag about a migration. */}
          {!ready && <MigrationHint file="0195_house_requests.sql">To turn requests on,</MigrationHint>}
        </div>
      ) : (
        <>
          <SegmentedControl<Filter>
            segments={[
              { value: "open", label: "Open" },
              { value: "done", label: "Done" },
              { value: "mine", label: "Mine" },
              { value: "all", label: "All" },
            ]}
            value={filter}
            onChange={setFilter}
            size="sm"
          />

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">Nothing in this list.</p>
          ) : (
            <div className="space-y-4">
              {waiting.length > 0 && (
                <section className="space-y-2">
                  <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">
                    Waiting on a House Admin
                  </h2>
                  <div className="space-y-2">
                    {waiting.map((r) => (
                      <div
                        key={r.id}
                        className={`space-y-2 rounded-2xl ${flashId === r.id ? "ring-2 ring-primary" : ""}`}
                      >
                        <HouseRequestCard request={r} onOpen={() => setOpenId(r.id)} />
                        {/* A House Admin can decide right here — no drill-in. */}
                        {canReview && (
                          <ReviewActions request={r} onDone={reload} onModify={() => setEditing(r)} />
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {toDo.length > 0 && (
                <section className="space-y-2">
                  <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">
                    Said yes — but nobody&rsquo;s done it yet
                  </h2>
                  <div className="space-y-2">
                    {toDo.map((r) => (
                      <div
                        key={r.id}
                        className={`space-y-2 rounded-2xl ${flashId === r.id ? "ring-2 ring-primary" : ""}`}
                      >
                        <HouseRequestCard request={r} onOpen={() => setOpenId(r.id)} />
                        {canReview && <ProgressActions request={r} onDone={reload} />}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {rest.length > 0 && (
                <section className="space-y-2">
                  {(waiting.length > 0 || toDo.length > 0) && (
                    <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Done &amp; history</h2>
                  )}
                  <div className="space-y-2">
                    {rest.map((r) => (
                      <div
                        key={r.id}
                        className={`space-y-2 rounded-2xl ${flashId === r.id ? "ring-2 ring-primary" : ""}`}
                      >
                        <HouseRequestCard request={r} onOpen={() => setOpenId(r.id)} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {/* Who to ask — so "who decides this?" is never a mystery. */}
      {admins.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">
            {plural(admins.length, "House Admin")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {admins.map((a) => (
              <span key={a.id} className="flex items-center gap-2 rounded-full bg-card py-1 pl-1 pr-3 ring-1 ring-border">
                <Avatar name={a.name} url={a.avatarUrl} size={24} />
                <span className="text-xs font-medium">{a.name}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="pb-2 text-xs text-faint">
        Something <span className="font-semibold">broken</span> or a job that needs doing? That belongs on the{" "}
        <Link href="/house" className="font-semibold text-primary underline">
          house to-do list
        </Link>
        , not here.
      </p>

      {open && (
        <HouseRequestSheet
          request={open}
          canReview={canReview}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onEdit={() => {
            setEditing(open);
            setOpenId(null);
          }}
          onPromote={() => {
            setPromoting(open);
            setOpenId(null);
          }}
        />
      )}

      {(composing || editing || promoting) && (
        <HouseRequestComposer
          houseId={houseId}
          houseName={houseName}
          request={editing}
          prefill={
            promoting
              ? {
                  kind: "purchase",
                  title: promoting.title,
                  // Carry the idea's own words across — retyping the reasoning is
                  // exactly the friction that stops an agreed idea being acted on.
                  reason: promoting.reason,
                  links: promoting.links,
                }
              : null
          }
          canTest={canReview}
          onClose={() => {
            setComposing(false);
            setEditing(null);
            setPromoting(null);
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}
