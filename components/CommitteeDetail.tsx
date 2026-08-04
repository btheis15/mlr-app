"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { ChatEntryButton } from "@/components/ChatEntryButton";
import { CommitteeRoster, type RosterMailLinks } from "@/components/CommitteeRoster";
import { MyCommitteeCard } from "@/components/MyCommitteeCard";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { MeetingSection } from "@/components/MeetingSection";
import { MeetingComposer } from "@/components/MeetingComposer";
import { COMMITTEES } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeBySlug, fetchLiveAreaNames, type CommitteeRow } from "@/lib/committeeAdmin";
import { fetchCommitteeRoster } from "@/lib/committeeRoster";
import { fetchCanOrganize, type MeetingScope } from "@/lib/meetings";
import type { Committee } from "@/lib/types";

/**
 * One tile in the committee page's action grid. Either wraps a ready-made node
 * (the chat button, which owns its own unread badge) or renders an
 * emoji + label tile that links (`href`) or fires a handler (`onClick`).
 */
type ActionTileProps = {
  /** Stable list id — deliberately not named `key`, so spreading these props
   *  onto <ActionTile> can't shadow React's own key. */
  id: string;
} & (
  | {
      node: React.ReactNode;
      emoji?: never;
      label?: never;
      href?: never;
      internal?: never;
      onClick?: never;
      tone?: never;
    }
  | {
      node?: never;
      emoji: string;
      label: string;
      href?: string;
      /** Internal app route → render a next/link for a client transition;
       *  external `mailto:` links stay a plain `<a>`. */
      internal?: boolean;
      onClick?: () => void;
      /** `"primary"` is the filled green treatment (a chat destination). */
      tone?: "primary";
    }
);

function ActionTile(props: ActionTileProps) {
  if (props.node) return <>{props.node}</>;
  const { emoji, label, href, internal, onClick, tone } = props;
  // Deliberately generous (72px) and identical for every action: these all live
  // inside a collapsible now, so the height costs nothing at rest and buys a
  // target nobody has to aim for. `items-start` + h-full keeps every tile the
  // same size even when a label wraps to two lines.
  const cls = `press flex h-full min-h-[72px] flex-col justify-between gap-1 rounded-2xl p-3 text-left ${
    tone === "primary" ? "bg-primary text-white shadow-sm" : "bg-card ring-1 ring-border text-foreground"
  }`;
  const inner = (
    <>
      <span aria-hidden className="text-lg leading-none">{emoji}</span>
      <span className={`text-sm font-semibold leading-tight ${tone === "primary" ? "" : "text-primary"}`}>{label}</span>
    </>
  );
  return href ? (
    internal ? (
      <Link href={href} className={cls}>{inner}</Link>
    ) : (
      <a href={href} className={cls}>{inner}</a>
    )
  ) : (
    <button type="button" onClick={onClick} className={cls}>{inner}</button>
  );
}

/**
 * A committee's page — roster + chat entry. DB-driven (migration 0112) so a
 * committee an admin creates renders correctly, and its name/emoji/description
 * reflect edits. Falls back to the in-code seed for the first paint / offline
 * (and so the statically-exported page has content immediately). Client-side so
 * the same static route works for any committee without per-slug prerender of
 * live data.
 */
export function CommitteeDetail({ slug }: { slug: string }) {
  const { userId, isAdmin } = useIdentity();
  const seed = COMMITTEES.find((c) => c.slug === slug) ?? null;
  const [row, setRow] = useState<CommitteeRow | null>(
    seed ? { id: seed.slug, slug: seed.slug, name: seed.name, emoji: seed.emoji, description: seed.description, position: 0, archivedAt: null } : null,
  );
  const [resolved, setResolved] = useState(false);
  // Committee-wide meeting scheduling (migration 0116) — mirrored from the chat,
  // scoped to the committee's General channel (area = null). Needs the REAL DB
  // committee id (the seed fallback uses the slug as a placeholder id).
  const [canOrganize, setCanOrganize] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; avatarUrl?: string | null }[]>([]);
  const [composeMeeting, setComposeMeeting] = useState(false);
  // "Who's this for?" options for the composer: the whole committee, plus the
  // roles the viewer can aim a meeting at (admin → all roles; a lead → their own).
  const [areaOptions, setAreaOptions] = useState<{ value: string | null; label: string }[]>([]);
  // Is the viewer actually ON this committee? Chat is the one thing membership
  // buys — everything else on this page (description, roles, who's on them) is
  // public by design, so a non-member browses freely and simply gets no chat
  // affordance. `null` = not resolved yet, so the button never flashes in and
  // back out. Mirrors the server rule in can_access_committee_area (0063):
  // roster-linked to this committee, or an app admin.
  const [onCommittee, setOnCommittee] = useState<boolean | null>(null);
  // Reported up from the two children that own the underlying data, so the
  // action grid can render their entry points as tiles: whether the viewer
  // leads this committee (MyCommitteeCard) and the committee-wide mailto:
  // links (CommitteeRoster, which resolves every member's email).
  const [amLead, setAmLead] = useState(false);
  const [mail, setMail] = useState<RosterMailLinks>({ everyone: null, leads: null, leadCount: 0 });

  useEffect(() => {
    let alive = true;
    fetchCommitteeBySlug(slug).then((c) => {
      if (!alive) return;
      if (c) setRow(c);
      setResolved(true);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    // Real uuid only (seed row uses id === slug); skip until the DB row resolves.
    const cid = row && row.id !== row.slug ? row.id : null;
    if (!cid) return;
    let cancelled = false;
    const cname = row?.name ?? "the committee";
    const scope: MeetingScope = { type: "committee", committeeId: cid, slug, area: null };
    void fetchCanOrganize(scope).then((v) => {
      if (!cancelled) setCanOrganize(v);
    });
    void Promise.all([fetchCommitteeRoster(slug), fetchLiveAreaNames(slug)]).then(([entries, areas]) => {
      if (cancelled) return;
      setMembers(
        entries
          .filter((e) => e.linkedUserId)
          .map((e) => ({ id: e.linkedUserId as string, name: e.linkedName || e.name, avatarUrl: e.linkedAvatarUrl })),
      );
      // Roles the viewer may target: all of them for an admin, else the ones
      // they lead ("<area> · Lead" in their roster roles). The server re-checks.
      const mine = entries.find((e) => e.linkedUserId && e.linkedUserId === userId);
      setOnCommittee(isAdmin || !!mine);
      const myRoles = mine?.roles ?? [];
      const allowed = isAdmin ? areas : areas.filter((a) => myRoles.includes(`${a} · Lead`));
      setAreaOptions([{ value: null, label: `Everyone on ${cname}` }, ...allowed.map((a) => ({ value: a, label: a }))]);
    });
    return () => {
      cancelled = true;
    };
  }, [row, slug, userId, isAdmin]);

  if (!row) {
    // Nothing in the seed and nothing in the DB (once resolved) → not a committee.
    if (!resolved) {
      return <div className="flex h-[40dvh] items-center justify-center text-sm text-foreground/40">Loading…</div>;
    }
    return (
      <div className="space-y-4 pt-2">
        <BackLink href="/committees" label="Committees" />
        <p className="rounded-2xl bg-card p-4 text-sm text-muted ring-1 ring-border">This committee doesn&rsquo;t exist.</p>
      </div>
    );
  }

  const committee: Committee = {
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    members: seed?.members ?? [],
  };
  // Real DB committee id (the seed fallback uses the slug as a placeholder id).
  const committeeId = row.id !== row.slug ? row.id : null;
  const live = !row.archivedAt;

  // "Reach the group" splits into two visual weights inside ONE card, rather
  // than N equal-weight tiles: the chat rooms are the destinations people come
  // here for (big tiles), while email/scheduling are occasional one-off actions
  // (a quiet row of small links underneath). Each still self-hides on exactly
  // the condition its original full-width bar did.
  const chatTiles: ActionTileProps[] = [
    ...(live && onCommittee === true
      ? [{ id: "chat", node: <ChatEntryButton slug={committee.slug} name={committee.name} variant="tile" /> }]
      : []),
    // Leads get a private side-chat (the reserved 'Leads' channel, 0172).
    //
    // Both chat tiles route through the FEED (`/posts?c=&area=`), not the
    // standalone /committees/<slug>/chat routes. Those routes render
    // CommitteeChat un-embedded, i.e. inside ChatShell's `fixed inset-0`
    // full-screen overlay — and in the INSTALLED PWA navigating to them fails
    // with WebKit's own "This page couldn't load" page, before React ever runs.
    // Opening the same room from the Feed works, because the Feed renders it
    // `embedded` (a plain inline column, no overlay). Two attempts to keep the
    // standalone routes failed on-device (a ?area= query param, then a
    // dedicated /leads path), so the routes are no longer linked from here.
    // The Feed's own deep-link resolution now holds a spinner instead of
    // flashing the chats list, which was the only real drawback of this path.
    ...(live && amLead
      ? [{
          id: "leads",
          emoji: "🔑",
          label: "Leads chat",
          href: `/posts?c=${committee.slug}&area=Leads&from=${committee.slug}`,
          internal: true,
          tone: "primary" as const,
        }]
      : []),
  ];
  // The secondary actions — same tile shape as the chats, just untinted, so
  // every target in the grid is the same size and nothing is easy to mis-hit.
  const otherActions: ActionTileProps[] = [
    ...(committeeId && live && canOrganize
      ? [{ id: "meet", emoji: "📅", label: "Schedule a meeting", onClick: () => setComposeMeeting(true) }]
      : []),
    ...(mail.everyone ? [{ id: "mail-all", emoji: "✉️", label: "Email everyone", href: mail.everyone }] : []),
    ...(mail.leads
      ? [{
          id: "mail-leads",
          emoji: "✉️",
          label: mail.leadCount > 1 ? `Email the ${mail.leadCount} leads` : "Email the leads",
          href: mail.leads,
        }]
      : []),
  ];
  const reachActions = [...chatTiles, ...otherActions];
  const hasReach = reachActions.length > 0;
  // Names what's inside while it's shut, so the collapse doesn't hide the fact
  // that chat/email/scheduling live here.
  const reachSubtitle = [
    chatTiles.length > 0 ? "Chat" : null,
    mail.everyone || mail.leads ? "email" : null,
    committeeId && live && canOrganize ? "schedule a meeting" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/committees" label="Committees" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{committee.emoji}</span>
          {committee.name}
        </h1>
        <p className="text-sm text-foreground/60">{committee.description}</p>
        {row.archivedAt && (
          <p className="mt-1 inline-block rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-muted">
            Archived — chat is read-only.{" "}
            <Link href="/admin/committees" className="font-semibold text-primary">Manage</Link>
          </p>
        )}
      </header>

      {/* The viewer's own spot on this committee, right up top — their roles at
          a glance, plus self-service (behind its ⋯ Manage toggle) to change
          their areas or leave. Self-hides for guests, non-members, and
          seed-only committees. */}
      <MyCommitteeCard committee={committee} committeeId={committeeId} onLeadChange={setAmLead} />

      {/* One "Reach the group" card holding every way to contact this committee,
          instead of a column (or even a grid) of equal-weight action bars — that
          stack was most of a screen of chrome before the roster (the thing
          people actually come here for) came into view. */}
      {hasReach && (
        // Collapsed by default: five ways to contact a committee are worth
        // having but not worth a permanent block above the roster. Everything
        // inside is ONE even 2-up grid of same-size tiles — the old mix of two
        // big tiles plus a ragged wrap of three differently-sized pills across
        // two rows was both the "clunky" look and a mis-hit risk, since a pill's
        // width came from its label length. Now every target is identical and
        // full-height, which a collapsible can afford.
        <CollapsibleSection
          title="Reach the group"
          icon="💬"
          subtitle={reachSubtitle}
        >
          <div className="grid grid-cols-2 gap-2">
            {reachActions.map((a, i) => (
              // An odd count would leave a lone half-width tile on the last
              // row; stretch it across both columns so the grid stays even.
              <div
                key={a.id}
                className={i === reachActions.length - 1 && reachActions.length % 2 === 1 ? "col-span-2" : undefined}
              >
                <ActionTile {...a} />
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* A live/upcoming meeting still gets its own full-width bar — it's live
          state to read, not an action to tap. Renders nothing when none is. */}
      {committeeId && !row.archivedAt && (
        <MeetingSection
          surface="card"
          scope={{ type: "committee", committeeId, slug: committee.slug, area: null }}
          members={members}
        />
      )}

      {/* The roster is the single membership list (migration 0057): it shows
          everyone + their roles, lets app admins add/remove/assign roles, and
          emails the committee or a single role. */}
      <CommitteeRoster committee={committee} onMailLinks={setMail} />

      {composeMeeting && committeeId && (
        <MeetingComposer
          scope={{ type: "committee", committeeId, slug: committee.slug, area: null }}
          roomLabel={committee.name}
          areaOptions={areaOptions}
          onClose={() => setComposeMeeting(false)}
          onCreated={() => {}}
        />
      )}
    </div>
  );
}
