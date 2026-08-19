"use client";

import Link from "next/link";
import { useState } from "react";
import { setHouseRules } from "@/lib/houses";
import { useResolvedHouse, useHouseCalendar, useHouseLists, useHouseRequests } from "@/lib/hooks";
import { listSummary } from "@/lib/houseLists";
import { summarize as summarizeRequests } from "@/lib/houseRequests";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { isStayPast, stayLabel } from "@/lib/houseCalendar";
import { formatDateRange } from "@/lib/format";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { WorkChecklist } from "@/components/WorkChecklist";
import { MjtHouseDuesCard } from "@/components/MjtHouseDuesCard";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchHouseRecipients } from "@/lib/emailBlast";

/**
 * The House Hub — one place for everything about a member's house: its calendar
 * (who's staying and when), its chat, and its work-item to-do list. Since a
 * member belongs to exactly one house, this resolves "your house" by default; a
 * `?house=<slug>` deep-link (e.g. from a notification) opens a specific one, gated
 * on membership (admins can view any). Guests / members with no house get a
 * gentle explainer instead of a dead end.
 */
export function HouseHub({ slug }: { slug?: string | null }) {
  const { house, isMember, loading } = useResolvedHouse(slug);

  if (loading) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/" label="Home" />
        <SkeletonList />
      </div>
    );
  }

  // Not in a house (and none named) → explain, don't dead-end.
  if (!house) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/" label="Home" />
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">🏠</p>
          <h1 className="mt-2 text-lg font-bold">You&rsquo;re not in a house yet</h1>
          <p className="mt-1 text-sm text-muted">
            Houses are small groups within the resort (like the MJT House) with their own calendar, chat, and to-do
            list. Ask an admin to add you to yours.
          </p>
        </div>
      </div>
    );
  }

  // A named house you can't see.
  if (!isMember) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/" label="Home" />
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">{house.emoji}</p>
          <h1 className="mt-2 text-lg font-bold">{house.name}</h1>
          <p className="mt-1 text-sm text-muted">
            This is a private house. Ask an admin to add you to see its calendar, chat, and to-do list.
          </p>
        </div>
      </div>
    );
  }

  return <HouseHubBody houseId={house.id} houseName={house.name} houseEmoji={house.emoji} slug={house.slug} description={house.description} rules={house.rules} />;
}

function HouseHubBody({
  houseId,
  houseName,
  houseEmoji,
  slug,
  description,
  rules,
}: {
  houseId: string;
  houseName: string;
  houseEmoji: string;
  slug: string;
  description: string;
  rules: string;
}) {
  const { today } = useDemoDate();
  const { stays, loading } = useHouseCalendar(houseId);

  const upcoming = today ? stays.filter((s) => !isStayPast(s, today)) : stays;
  const next = upcoming[0] ?? null;
  const calSubtitle = loading
    ? "Loading…"
    : next
      ? `Next up: ${stayLabel(next)} · ${formatDateRange(next.startDate, next.endDate)}`
      : "No stays yet — add when you're going up.";

  // The Lists row's live subtitle: the most recently touched list and its
  // progress, so the Hub answers "is there anything on the grocery list?"
  // without a tap. Lists come back newest-first (create_house_list sorts to
  // the top), so `lists[0]` is the one a house most likely cares about.
  const { lists, loading: listsLoading } = useHouseLists(houseId);
  const topList = lists[0] ?? null;
  const listsSubtitle = listsLoading
    ? "Loading…"
    : topList
      ? `${topList.emoji} ${topList.title} · ${listSummary(topList)}${lists.length > 1 ? ` · +${lists.length - 1} more` : ""}`
      : "Shopping lists, checklists — start one for the house.";

  // The Requests row's live subtitle — leads with whatever needs a human:
  // something waiting on a decision first, then something approved that nobody
  // has actually bought yet (the gap the feature exists to expose).
  const { requests, loading: requestsLoading } = useHouseRequests(houseId);
  const reqSummary = summarizeRequests(requests);
  // ⚠️ "Approved, not bought" and "approved, not PAID" are separate chores now
  // (summarize() splits them by kind) — an unpaid reimbursement means somebody in
  // the family is personally out of pocket, which reads very differently from an
  // unordered purchase and shouldn't be flattened into one count.
  const requestsSubtitle = requestsLoading
    ? "Loading…"
    : reqSummary.waiting > 0
      ? `${reqSummary.waiting} waiting on a decision${reqSummary.notOrdered > 0 ? ` · ${reqSummary.notOrdered} to order` : ""}${reqSummary.unpaid > 0 ? ` · ${reqSummary.unpaid} to pay out` : ""}`
      : reqSummary.notOrdered > 0
        ? `${reqSummary.notOrdered} approved — nobody's ordered ${reqSummary.notOrdered === 1 ? "it" : "them"} yet`
        : reqSummary.unpaid > 0
          ? `${reqSummary.unpaid} approved — nobody's been paid back yet`
          : "Ideas, things for the house to buy, money to pay back.";

  const calHref = `/house/calendar?house=${slug}`;
  const listsHref = `/house/lists?house=${slug}`;
  const requestsHref = `/house/requests?house=${slug}`;
  const chatHref = `/posts?house=${slug}`;
  const [emailOpen, setEmailOpen] = useState(false);

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{houseEmoji}</span>
          {houseName}
        </h1>
        {description && <p className="text-sm text-muted">{description}</p>}
      </header>

      {/* MJT House's own Family Fest dues reminder — self-hides for every other
          house and outside its active window (see MjtHouseDuesCard). */}
      <MjtHouseDuesCard slug={slug} />

      {/* Communication — the two ways to reach the whole house, as tiles. Email
          opens its composer inline right below the grid. */}
      <section className="space-y-2">
        <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Communication</h2>
        <div className="grid grid-cols-2 gap-3">
          <HubTile href={chatHref} emoji="💬" tile="bg-lake/12" title="House chat" subtitle="Talk with your house." />
          <button
            type="button"
            onClick={() => setEmailOpen((o) => !o)}
            aria-expanded={emailOpen}
            className="press flex flex-col gap-2 rounded-2xl bg-card p-4 text-left ring-1 ring-border transition-shadow hover:shadow-sm"
          >
            <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-2xl">✉️</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Email the house</p>
              <p className="mt-0.5 text-xs text-foreground/60">Everyone — even folks not on the app</p>
            </div>
          </button>
        </div>
        {emailOpen && (
          <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
            <EmailMembersComposer
              sourceKey={`house:${houseId}`}
              load={() => fetchHouseRecipients(houseId)}
              groupNoun={`the ${houseName}`}
              migrationFile="0123_family_roster.sql"
            />
          </div>
        )}
      </section>

      {/* Calendar — its own section, full-width so the live "next up" line breathes. */}
      <section className="space-y-2">
        <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Calendar</h2>
        <Link
          href={calHref}
          className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
        >
          <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-2xl">📅</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">House calendar</p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">{calSubtitle}</p>
          </div>
          <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>›</span>
        </Link>
      </section>

      {/* Lists — the house's shared lists (groceries, checklists, packing). */}
      <section className="space-y-2">
        <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Lists</h2>
        <Link
          href={listsHref}
          className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
        >
          <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-2xl">📝</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">House lists</p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">{listsSubtitle}</p>
          </div>
          <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>›</span>
        </Link>
      </section>

      {/* House rules — a self-titled card, effectively its own section. */}
      <HouseRulesCard houseId={houseId} initialRules={rules} />

      {/* Work items — the house's to-do list (the checklist also shows MLR items).
          Kept ABOVE Requests and left with its own full-width card + urgency
          chips: these are the things that NEED doing, and they must not read as
          the same weight as the "should we?" board below. */}
      <section className="space-y-2">
        <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">To-do list</h2>
        <WorkChecklist />
      </section>

      {/* Requests — deliberately a separate, lighter section than the to-do list
          above: ideas and purchases to DECIDE on, not jobs to do. */}
      <section className="space-y-2">
        <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-faint">Requests &amp; ideas</h2>
        <Link
          href={requestsHref}
          className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
        >
          <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sun/12 text-2xl">🧾</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Requests</p>
            <p className="mt-0.5 truncate text-xs text-foreground/60">{requestsSubtitle}</p>
          </div>
          {reqSummary.waiting > 0 && (
            <span className="shrink-0 rounded-full bg-sun/20 px-2 py-0.5 text-[11px] font-bold tabular-nums">
              {reqSummary.waiting}
            </span>
          )}
          <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>›</span>
        </Link>
      </section>
    </div>
  );
}

/** A shared, editable open-text "house rules" doc. Any house member can edit it
 *  (RPC-gated server-side); last write wins. */
function HouseRulesCard({ houseId, initialRules }: { houseId: string; initialRules: string }) {
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialRules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { error: err } = await setHouseRules(houseId, draft);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setRules(draft);
    setEditing(false);
  }

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">
          <span className="mr-1" aria-hidden>
            📋
          </span>
          House rules
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(rules);
              setEditing(true);
            }}
            className="press text-sm font-semibold text-primary"
          >
            {rules.trim() ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            placeholder="Add your house rules — quiet hours, who feeds the dog, cabin close-up checklist…"
            className="w-full rounded-xl bg-background p-3 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="press rounded-full px-3 py-1 text-sm font-semibold text-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="press rounded-full bg-primary px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/70">
          {rules.trim() ? rules : "No house rules yet — tap Add to write them."}
        </p>
      )}
    </section>
  );
}

/** A vertical tile (icon chip on top, then title + subtitle) for the primary
 *  House Hub destinations, laid out 2-up. `clamp` keeps a long subtitle (the
 *  calendar's "next up" line) to two lines so both tiles stay the same height. */
function HubTile({
  href,
  emoji,
  tile,
  title,
  subtitle,
  clamp = false,
}: {
  href: string;
  emoji: string;
  tile: string;
  title: string;
  subtitle: string;
  clamp?: boolean;
}) {
  return (
    <Link
      href={href}
      className="press flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span aria-hidden className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${tile}`}>
        {emoji}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className={`mt-0.5 text-xs text-foreground/60 ${clamp ? "line-clamp-2" : ""}`}>{subtitle}</p>
      </div>
    </Link>
  );
}
