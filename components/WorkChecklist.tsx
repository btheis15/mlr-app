"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkItem } from "@/lib/types";
import { fetchWorkItems, markWorkItemDone } from "@/lib/workItems";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { WorkItemComposer } from "@/components/WorkItemComposer";

// The work checklist card shown inside the "Around the resort" section on Home.
// Any signed-in member can add items and check them off. Admins can also edit,
// delete, and re-open items. Done items collapse into a "X done" count at the
// bottom so the card stays clean.

const PREVIEW = 5;

export function WorkChecklist() {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [checkingOff, setCheckingOff] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchWorkItems();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const signedIn = Boolean(user);
  const open = items.filter((i) => i.status === "open");
  const done = items.filter((i) => i.status === "done");
  const visible = showAll ? open : open.slice(0, PREVIEW);
  const hidden = open.length - PREVIEW;

  const handleAdd = () => {
    if (!signedIn) { promptSignIn(); return; }
    setComposing(true);
  };

  const handleCheck = async (item: WorkItem) => {
    if (!signedIn) { promptSignIn(); return; }
    setCheckingOff(item.id);
    // Optimistic: remove from open list immediately so the checkbox feels instant.
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "done" as const } : i)),
    );
    const { error } = await markWorkItemDone(item.id);
    if (error) {
      // Revert on failure.
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "open" as const } : i)),
      );
    }
    setCheckingOff(null);
  };

  const handleEdit = (item: WorkItem) => {
    if (!isAdmin) return;
    setEditing(item);
  };

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        {/* Card header */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="shrink-0 text-lg" aria-hidden>🔧</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-accent">Work Checklist</h3>
            <p className="text-xs text-foreground/50">
              {loading
                ? "Loading…"
                : open.length === 0 && done.length === 0
                  ? "Nothing on the list yet"
                  : open.length === 0
                    ? `All ${done.length} item${done.length !== 1 ? "s" : ""} done ✅`
                    : `${open.length} open${done.length > 0 ? ` · ${done.length} done` : ""}`}
            </p>
          </div>
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

        {/* Open items */}
        {!loading && open.length > 0 && (
          <div className="divide-y divide-border border-t border-border">
            {visible.map((item) => (
              <WorkItemRow
                key={item.id}
                item={item}
                checkingOff={checkingOff === item.id}
                onCheck={() => handleCheck(item)}
                onEdit={isAdmin ? () => handleEdit(item) : undefined}
              />
            ))}

            {!showAll && hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="press w-full px-4 py-2.5 text-left text-xs font-medium text-primary"
              >
                Show {hidden} more item{hidden !== 1 ? "s" : ""} ›
              </button>
            )}
            {showAll && hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="press w-full px-4 py-2.5 text-left text-xs font-medium text-foreground/40"
              >
                Show less
              </button>
            )}
          </div>
        )}

        {/* Done count footer — visible once at least one item is done */}
        {!loading && done.length > 0 && open.length > 0 && (
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-xs text-foreground/40">
              ✅ {done.length} item{done.length !== 1 ? "s" : ""} done
            </p>
          </div>
        )}
      </div>

      {/* Add sheet (any member) */}
      {composing && (
        <WorkItemComposer
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}

      {/* Edit sheet (admin only) */}
      {editing && (
        <WorkItemComposer
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function WorkItemRow({
  item,
  checkingOff,
  onCheck,
  onEdit,
}: {
  item: WorkItem;
  checkingOff: boolean;
  onCheck: () => void;
  onEdit?: () => void;
}) {
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

      {/* Title + category — tap to edit (admin only) */}
      <div
        className={`min-w-0 flex-1 ${onEdit ? "cursor-pointer" : ""}`}
        onClick={onEdit}
        role={onEdit ? "button" : undefined}
        tabIndex={onEdit ? 0 : undefined}
        onKeyDown={onEdit ? (e) => e.key === "Enter" && onEdit() : undefined}
      >
        <span className="block text-sm font-medium leading-snug">{item.title}</span>
        {item.notes && (
          <span className="mt-0.5 block text-xs text-foreground/50 leading-snug">{item.notes}</span>
        )}
        {item.peopleNeeded != null && (
          <span className="mt-1 flex flex-wrap gap-1">
            <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground/50 ring-1 ring-border">
              👥 {item.peopleNeeded} needed
            </span>
          </span>
        )}
      </div>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit "${item.title}"`}
          className="press shrink-0 self-center text-xs text-foreground/25 hover:text-foreground/60"
        >
          ›
        </button>
      )}
    </div>
  );
}
