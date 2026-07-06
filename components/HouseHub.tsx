"use client";

import Link from "next/link";
import { useState } from "react";
import { setHouseRules } from "@/lib/houses";
import { useResolvedHouse, useHouseCalendar } from "@/lib/hooks";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { isStayPast, stayLabel, stayHeadCount } from "@/lib/houseCalendar";
import { formatDateRange, relativeDays, plural } from "@/lib/format";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { WorkChecklist } from "@/components/WorkChecklist";

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
          <p className="mt-1 text-sm text-foreground/60">
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
          <p className="mt-1 text-sm text-foreground/60">
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

  const calHref = `/house/calendar?house=${slug}`;
  const chatHref = `/posts?house=${slug}`;

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{houseEmoji}</span>
          {houseName}
        </h1>
        {description && <p className="text-sm text-foreground/60">{description}</p>}
      </header>

      {/* Calendar — the marquee card, with a "next up" line */}
      <HubCard
        href={calHref}
        emoji="📅"
        tile="bg-primary/12"
        title="House calendar"
        subtitle={calSubtitle}
      />

      {/* Chat */}
      <HubCard
        href={chatHref}
        emoji="💬"
        tile="bg-lake/12"
        title="House chat"
        subtitle="Talk with everyone in your house."
      />

      {/* House rules — a shared, editable open-text doc (any member). */}
      <HouseRulesCard houseId={houseId} initialRules={rules} />

      {/* Upcoming stays preview (so the hub has real content, not just links) */}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-bold">Who&rsquo;s staying</h2>
          {upcoming.slice(0, 3).map((s) => (
            <Link
              key={s.id}
              href={calHref}
              className="press block rounded-2xl bg-card p-3 ring-1 ring-border transition-shadow hover:shadow-sm"
            >
              <p className="truncate text-sm font-semibold">{stayLabel(s)}</p>
              <p className="truncate text-xs text-foreground/60">
                {formatDateRange(s.startDate, s.endDate)}
                {today && relativeDays(today, s.startDate) && (
                  <span className="text-foreground/45"> · {relativeDays(today, s.startDate)}</span>
                )}
                {stayHeadCount(s) > 1 && (
                  <span className="text-foreground/45"> · {plural(stayHeadCount(s), "person", "people")}</span>
                )}
              </p>
            </Link>
          ))}
          {upcoming.length > 3 && (
            <Link href={calHref} className="press block px-0.5 text-sm font-semibold text-primary">
              See all {upcoming.length} on the calendar →
            </Link>
          )}
        </section>
      )}

      {/* Work items — the house's to-do list (the checklist also shows MLR items). */}
      <section className="space-y-2">
        <h2 className="px-0.5 text-sm font-bold">To-do list</h2>
        <WorkChecklist />
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
              className="press rounded-full px-3 py-1 text-sm font-semibold text-foreground/60"
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

function HubCard({
  href,
  emoji,
  tile,
  title,
  subtitle,
}: {
  href: string;
  emoji: string;
  tile: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span aria-hidden className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${tile}`}>
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 truncate text-xs text-foreground/60">{subtitle}</p>
      </div>
      <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>
        ›
      </span>
    </Link>
  );
}
