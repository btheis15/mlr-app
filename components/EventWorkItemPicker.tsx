"use client";

import { useEffect, useState } from "react";
import type { House, WorkItem } from "@/lib/types";
import { fetchWorkItems, addWorkItemToEvent, urgencyMeta, workItemScopeLabel } from "@/lib/workItems";
import { fetchHouses } from "@/lib/houses";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";

// Attach EXISTING work-checklist items to an event, instead of only being able
// to create a brand-new one from the event sheet's "+ Add" button. Lists every
// open item the viewer can see (RLS already scopes MLR vs house) that isn't
// already linked, multi-select, "Add selected" links them all via the
// additive add_work_item_to_event RPC (never removes anything already linked).
// "+ Create a new item instead" hands off to the caller, which opens the full
// WorkItemComposer pre-linked to this event (the existing flow).

export function EventWorkItemPicker({
  eventId,
  alreadyLinkedIds,
  onClose,
  onLinked,
  onCreateNew,
}: {
  eventId: string;
  /** Items already attached to this event — excluded from the picker list. */
  alreadyLinkedIds: Set<string>;
  onClose: () => void;
  /** Called after successfully linking one or more items. */
  onLinked: () => void;
  /** Switch to creating a brand-new item pre-linked to this event. */
  onCreateNew: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchWorkItems(), fetchHouses()]).then(([all, hs]) => {
      setItems(all.filter((i) => i.status === "open" && !alreadyLinkedIds.has(i.id)));
      setHouses(hs);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0) return;
    setPending(true);
    setError(null);
    const results = await Promise.all([...selected].map((id) => addWorkItemToEvent(eventId, id)));
    setPending(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) { setError(failed.error); return; }
    onLinked();
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="event-work-item-picker-title"
      header={
        <h2 id="event-work-item-picker-title" className="text-lg font-bold">
          🔧 Add work items
        </h2>
      }
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={selected.size === 0 || pending}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Adding…" : selected.size > 0 ? `Add selected (${selected.size})` : "Add selected"}
        </button>
      }
    >
      <button
        type="button"
        onClick={onCreateNew}
        className="press flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 text-sm font-semibold text-primary ring-1 ring-border"
      >
        <span>＋ Create a new item instead</span>
        <span aria-hidden>›</span>
      </button>

      <div className="space-y-2">
        <SectionLabel>From the checklist</SectionLabel>
        {loading ? (
          <p className="py-2 text-center text-xs text-faint">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-faint">
            Nothing left to add — every open checklist item is already linked here, or the checklist is empty.
          </p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border">
            {items.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-background"
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{item.title}</span>
                  {item.category && <span className="block text-[10px] text-faint">{item.category}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {item.urgency && (() => {
                      const meta = urgencyMeta(item);
                      return meta ? (
                        <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${meta.chip}`}>
                          {meta.emoji} {meta.label}
                        </span>
                      ) : null;
                    })()}
                    <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
                      {workItemScopeLabel(item, houses)}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
    </Sheet>
  );
}
