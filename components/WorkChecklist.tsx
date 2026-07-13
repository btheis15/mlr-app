"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { House, WorkItem } from "@/lib/types";
import { fetchWorkItems, markWorkItemDone, URGENCY_META, urgencyRank } from "@/lib/workItems";
import { fetchHouses, fetchMyHouse } from "@/lib/houses";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { useGuest } from "@/components/Guard";
import { WorkItemComposer } from "@/components/WorkItemComposer";
import { WorkItemSheet, type WorkItemMember } from "@/components/WorkItemSheet";

interface MemberRow extends WorkItemMember {
  houseId: string | null;
  isAdmin: boolean;
}

// The work checklist — its own collapsed-by-default expandable card on Home.
// Any signed-in member can add items and check them off. Admins can also edit,
// delete, and re-open items. Items are scoped: MLR (resort-wide, everyone) plus
// any house the viewer belongs to — the list groups them into sections so a house
// member sees an "MLR" section and their house's section together. Done items
// collapse into a "X done" count so each section stays clean.

const PREVIEW = 5;

interface Section {
  key: string;
  title: string;
  emoji: string;
  items: WorkItem[];
}

// Stale-while-revalidate cache for the work checklist (mirrors `eventsCache` in
// lib/hooks.ts). This component remounts on every Home visit; without this it
// resets to empty + `loading`, so the header flips to "Loading…" and the
// open/ASAP summary + collapsed list blank out and pop back in. Holding the last
// result lets a returning Home paint instantly from cache while a background
// refetch keeps it current. Keyed by the viewer's email because item visibility
// is RLS-gated on house membership (an MLR item is public, a house item only
// shows to that house's members), so two viewers can resolve different lists.
// Memory-only (per session) and written ONLY after a successful client fetch —
// never during SSR/render — so a cold load starts empty (the original default
// behavior) and the first paint matches the server-rendered HTML: no hydration
// mismatch. `user` is null during prerender, so the key is "" there.
const workChecklistCache = new Map<string, { items: WorkItem[]; houses: House[]; myHouseId: string | null }>();

export function WorkChecklist() {
  const { user, isAdmin, promptSignIn, previewAsId } = useIdentity();
  // The checklist is members-only under the RLS lockdown (0081) — even the MLR
  // section. Guests keep the card but get a quiet sign-in line instead of an
  // empty "Nothing on the list yet".
  const { guest } = useGuest();
  const key = user?.email ?? "";
  // The signed-in account's own id, so a member can edit the item THEY created
  // (author-or-admin edit). `user` (localStorage identity) doesn't carry the
  // auth uid, so read it from Supabase; honor an admin's "view as" preview.
  const [uid, setUid] = useState<string | null>(previewAsId ?? null);
  useEffect(() => {
    if (previewAsId) { setUid(previewAsId); return; }
    supabase?.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, [previewAsId]);
  const cached = workChecklistCache.get(key);
  const [items, setItems] = useState<WorkItem[]>(cached?.items ?? []);
  const [houses, setHouses] = useState<House[]>(cached?.houses ?? []);
  const [myHouseId, setMyHouseId] = useState<string | null>(cached?.myHouseId ?? null);
  // Warm cache ⇒ paint immediately (no "Loading…"); the effect below still
  // refetches in the background so the cached view is brought up to date.
  const [loading, setLoading] = useState(!cached);
  const [cardOpen, setCardOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [viewing, setViewing] = useState<WorkItem | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [checkingOff, setCheckingOff] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [data, hs, mine] = await Promise.all([fetchWorkItems(), fetchHouses(), fetchMyHouse()]);
    setItems(data);
    setHouses(hs);
    setMyHouseId(mine?.id ?? null);
    workChecklistCache.set(key, { items: data, houses: hs, myHouseId: mine?.id ?? null });
    setLoading(false);
  }, [key]);

  useEffect(() => { load(); }, [load]);

  // Mention candidates for the comment threads (all members; scoped per-item
  // below). Guests can't comment (and can't read profiles) — skip the fetch.
  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || guest) return;
    sb.from("profiles").select("id, display_name, avatar_url, house_id, is_admin").then(({ data }) => {
      setMembers(((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null; house_id: string | null; is_admin: boolean }[]).map((p) => ({
        id: p.id,
        name: p.display_name?.trim() || "Member",
        avatarUrl: p.avatar_url,
        houseId: p.house_id,
        isAdmin: p.is_admin,
      })));
    });
  }, [guest]);

  // Deep-link from a comment notification: /?work=<id> opens that item's thread.
  // Keyed on `items`, not `loading`: with the warm cache `loading` starts false,
  // so a lone `[loading]` effect would fire once against the cached snapshot and
  // miss an item created since the cache was populated (load() finishing is
  // false→false, no re-fire). Re-running on `items` catches the freshly-fetched
  // item; the ref makes it fire at most once so it can't re-open after the user
  // closes the sheet.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || typeof window === "undefined") return;
    const want = new URLSearchParams(window.location.search).get("work");
    if (!want) return;
    const found = items.find((i) => i.id === want);
    if (found) {
      setViewing(found);
      deepLinkHandled.current = true;
    }
  }, [items]);

  // Candidates who can see a given item (MLR → everyone; house → its members + admins).
  const candidatesFor = (item: WorkItem): WorkItemMember[] =>
    (item.houseId
      ? members.filter((m) => m.houseId === item.houseId || m.isAdmin)
      : members
    ).map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }));

  const signedIn = Boolean(user);

  // Build sections: MLR (house_id null) first, then each house that has items,
  // ordered by the house's position. Empty sections are dropped.
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const sections: Section[] = [];
  const mlr = items.filter((i) => i.houseId === null);
  if (mlr.length) sections.push({ key: "mlr", title: "Around the Resort", emoji: "🌲", items: mlr });
  for (const h of houses) {
    const hi = items.filter((i) => i.houseId === h.id);
    if (hi.length) sections.push({ key: h.id, title: h.name, emoji: h.emoji, items: hi });
  }
  // Fallback: items whose house isn't in the fetched list (shouldn't normally happen).
  const orphans = items.filter((i) => i.houseId !== null && !houseById.has(i.houseId));
  if (orphans.length) sections.push({ key: "other", title: "Other", emoji: "🔧", items: orphans });

  const totalOpen = items.filter((i) => i.status === "open").length;
  const totalDone = items.filter((i) => i.status === "done").length;
  const asapCount = items.filter((i) => i.status === "open" && i.urgency === "asap").length;
  const showHeaders = sections.length > 1;

  const handleAdd = () => {
    if (!signedIn) { promptSignIn(); return; }
    setComposing(true);
  };

  const handleCheck = async (item: WorkItem) => {
    if (!signedIn) { promptSignIn(); return; }
    setCheckingOff(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "done" as const } : i)));
    const { error } = await markWorkItemDone(item.id);
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "open" as const } : i)));
    }
    setCheckingOff(null);
  };

  // Who may edit an item: an admin (any item) or the person who created it (their
  // own). Everyone else can view + comment + check off, but not edit the fields.
  const canEdit = (item: WorkItem) => isAdmin || (!!uid && item.createdBy === uid);

  const handleEdit = (item: WorkItem) => {
    if (!canEdit(item)) return;
    setEditing(item);
  };

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        {/* Card header — the whole bar toggles the card open/closed so the list
            stays tucked away until you want it. */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            type="button"
            onClick={() => (guest ? promptSignIn() : setCardOpen((o) => !o))}
            aria-expanded={cardOpen}
            className="press flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span className="shrink-0 text-lg" aria-hidden>🔧</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-accent">Work Checklist</h3>
              <p className="text-xs text-muted" role="status" aria-live="polite">
                {guest
                  ? "🔒 Sign in to see the resort to-do list"
                  : loading
                    ? "Loading…"
                    : totalOpen === 0 && totalDone === 0
                      ? "All caught up — nothing on the list yet 🌲"
                      : totalOpen === 0
                        ? `All ${totalDone} item${totalDone !== 1 ? "s" : ""} done ✅`
                        : `${totalOpen} open${totalDone > 0 ? ` · ${totalDone} done` : ""}${asapCount > 0 ? ` · 🔴 ${asapCount} ASAP` : ""}`}
              </p>
            </div>
            <span
              className={`shrink-0 text-faint transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${cardOpen ? "rotate-90" : ""}`}
              aria-hidden
            >
              ›
            </span>
          </button>
          {isSupabaseConfigured && (
            <button
              type="button"
              onClick={handleAdd}
              aria-label="Add work item"
              className="press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-bold text-primary"
            >
              +
            </button>
          )}
        </div>

        {/* Progress bar (done / total) — iOS-style linear gauge. */}
        {!guest && cardOpen && !loading && totalOpen + totalDone > 0 && (
          <div className="flex items-center gap-2 px-4 pb-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background ring-1 ring-border">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-tap)]"
                style={{ width: `${Math.round((totalDone / (totalOpen + totalDone)) * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
              {totalDone}/{totalOpen + totalDone}
            </span>
          </div>
        )}

        {/* Sections — revealed when the card is expanded (members only). */}
        {!guest && cardOpen && !loading && sections.map((section) => {
          // Always sorted by importance: ASAP → This year → Nice to have →
          // unrated, keeping the newest-first order within each urgency.
          const open = section.items
            .filter((i) => i.status === "open")
            .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency));
          const done = section.items.filter((i) => i.status === "done");
          const isExpanded = expanded.has(section.key);
          const visible = isExpanded ? open : open.slice(0, PREVIEW);
          const hidden = open.length - PREVIEW;
          return (
            <div key={section.key} className="border-t border-border">
              {showHeaders && (
                <div className="flex items-center gap-2 bg-background/50 px-4 py-2">
                  <span aria-hidden>{section.emoji}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</span>
                </div>
              )}
              {open.length > 0 && (
                <div className="divide-y divide-border">
                  {visible.map((item) => (
                    <WorkItemRow
                      key={item.id}
                      item={item}
                      checkingOff={checkingOff === item.id}
                      onCheck={() => handleCheck(item)}
                      onOpen={() => setViewing(item)}
                    />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(section.key)}
                      className="press w-full px-4 py-2.5 text-left text-xs font-medium text-primary"
                    >
                      {isExpanded ? "Show less" : `Show ${hidden} more item${hidden !== 1 ? "s" : ""} ›`}
                    </button>
                  )}
                </div>
              )}
              {done.length > 0 && (
                <div className="px-4 py-2.5">
                  <p className="text-xs text-faint">
                    ✅ {done.length} item{done.length !== 1 ? "s" : ""} done
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add sheet (any member) */}
      {composing && (
        <WorkItemComposer
          houses={houses}
          myHouseId={myHouseId}
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}

      {/* Edit sheet (admin — any item; author — their own) */}
      {editing && (
        <WorkItemComposer
          item={editing}
          houses={houses}
          myHouseId={myHouseId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {/* Detail + comments sheet (any member) */}
      {viewing && (
        <WorkItemSheet
          item={viewing}
          members={candidatesFor(viewing)}
          onClose={() => setViewing(null)}
          onChanged={load}
          onEdit={canEdit(viewing) ? () => handleEdit(viewing) : undefined}
        />
      )}
    </>
  );
}

function WorkItemRow({
  item,
  checkingOff,
  onCheck,
  onOpen,
}: {
  item: WorkItem;
  checkingOff: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const thumb = item.media[0];
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/* Checkbox tap target */}
      <button
        type="button"
        onClick={onCheck}
        disabled={checkingOff}
        aria-label={`Mark "${item.title}" done`}
        className="press mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border transition-colors hover:border-primary disabled:opacity-40"
      >
        {checkingOff && (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        )}
      </button>

      {/* Title + details — tap to open the item (details + comments). */}
      <div
        className="min-w-0 flex-1 cursor-pointer"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
      >
        <span className="block text-sm font-medium leading-snug">{item.title}</span>
        {item.notes && (
          <span className="mt-0.5 block text-xs text-muted leading-snug line-clamp-2">{item.notes}</span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {item.urgency && (
            <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${URGENCY_META[item.urgency].chip}`}>
              {URGENCY_META[item.urgency].emoji} {URGENCY_META[item.urgency].label}
            </span>
          )}
          {item.peopleNeeded != null && (
            <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
              👥 {item.peopleNeeded} needed
            </span>
          )}
          {item.commentCount > 0 && (
            <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
              💬 {item.commentCount}
            </span>
          )}
        </span>
      </div>

      {/* Compact inline thumbnail (iOS-style) instead of a full-width grid. */}
      {thumb && (
        thumb.type === "video" ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open "${item.title}"`}
            className="press flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-lg bg-background text-primary ring-1 ring-border"
          >
            ▶
          </button>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb.url}
            alt=""
            onClick={onOpen}
            className="h-10 w-10 shrink-0 cursor-pointer self-center rounded-lg object-cover ring-1 ring-border"
          />
        )
      )}

      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open "${item.title}"`}
        className="press shrink-0 self-center text-xs text-foreground/25 hover:text-foreground/60"
      >
        ›
      </button>
    </div>
  );
}
