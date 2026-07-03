"use client";

import { useCallback, useEffect, useState } from "react";
import type { House, WorkItem } from "@/lib/types";
import { fetchWorkItems, markWorkItemDone, URGENCY_META, urgencyRank } from "@/lib/workItems";
import { fetchHouses, fetchMyHouse } from "@/lib/houses";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { WorkItemComposer } from "@/components/WorkItemComposer";
import { WorkItemSheet, type WorkItemMember } from "@/components/WorkItemSheet";
import { MediaGrid } from "@/components/MediaGrid";

interface MemberRow extends WorkItemMember {
  houseId: string | null;
  isAdmin: boolean;
}

// The work checklist card shown inside the "Around the resort" section on Home.
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

export function WorkChecklist() {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [myHouseId, setMyHouseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Mention candidates for the comment threads (all members; scoped per-item below).
  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    sb.from("profiles").select("id, display_name, avatar_url, house_id, is_admin").then(({ data }) => {
      setMembers(((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null; house_id: string | null; is_admin: boolean }[]).map((p) => ({
        id: p.id,
        name: p.display_name?.trim() || "Member",
        avatarUrl: p.avatar_url,
        houseId: p.house_id,
        isAdmin: p.is_admin,
      })));
    });
  }, []);

  // Deep-link from a comment notification: /?work=<id> opens that item's thread.
  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const want = new URLSearchParams(window.location.search).get("work");
    if (!want) return;
    const found = items.find((i) => i.id === want);
    if (found) setViewing(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
  if (mlr.length) sections.push({ key: "mlr", title: "MLR", emoji: "🌲", items: mlr });
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

  const handleEdit = (item: WorkItem) => {
    if (!isAdmin) return;
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
            onClick={() => setCardOpen((o) => !o)}
            aria-expanded={cardOpen}
            className="press flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span className="shrink-0 text-lg" aria-hidden>🔧</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-accent">Work Checklist</h3>
              <p className="text-xs text-foreground/50">
                {loading
                  ? "Loading…"
                  : totalOpen === 0 && totalDone === 0
                    ? "Nothing on the list yet"
                    : totalOpen === 0
                      ? `All ${totalDone} item${totalDone !== 1 ? "s" : ""} done ✅`
                      : `${totalOpen} open${totalDone > 0 ? ` · ${totalDone} done` : ""}${asapCount > 0 ? ` · 🔴 ${asapCount} ASAP` : ""}`}
              </p>
            </div>
            <span
              className={`shrink-0 text-foreground/40 transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${cardOpen ? "rotate-90" : ""}`}
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
              className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-bold text-primary"
            >
              +
            </button>
          )}
        </div>

        {/* Sections — revealed when the card is expanded. */}
        {cardOpen && !loading && sections.map((section) => {
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
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{section.title}</span>
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
                  <p className="text-xs text-foreground/40">
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

      {/* Edit sheet (admin only) */}
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
          onEdit={isAdmin ? () => handleEdit(viewing) : undefined}
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
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
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
            <span className="mt-0.5 block text-xs text-foreground/50 leading-snug">{item.notes}</span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {item.urgency && (
              <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${URGENCY_META[item.urgency].chip}`}>
                {URGENCY_META[item.urgency].emoji} {URGENCY_META[item.urgency].label}
              </span>
            )}
            {item.peopleNeeded != null && (
              <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground/50 ring-1 ring-border">
                👥 {item.peopleNeeded} needed
              </span>
            )}
            <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground/50 ring-1 ring-border">
              💬 {item.commentCount > 0 ? item.commentCount : "Comment"}
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open "${item.title}"`}
          className="press shrink-0 self-center text-xs text-foreground/25 hover:text-foreground/60"
        >
          ›
        </button>
      </div>

      {/* Attachments */}
      {item.media.length > 0 && (
        <div className="pl-8">
          <MediaGrid media={item.media} />
        </div>
      )}
    </div>
  );
}
