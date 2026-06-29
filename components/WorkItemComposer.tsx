"use client";

import { useState } from "react";
import type { WorkItem } from "@/lib/types";
import { createWorkItem, updateWorkItem, deleteWorkItem } from "@/lib/workItems";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";

// Add/edit sheet for a work checklist item. Any signed-in member can add items;
// admins get the extra status toggle + delete button when editing.

export function WorkItemComposer({
  item,
  onClose,
  onSaved,
}: {
  item?: WorkItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { isAdmin } = useIdentity();
  const editing = Boolean(item);
  const { closing, close } = useSheetDismiss(onClose);

  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [status, setStatus] = useState<"open" | "done">(item?.status ?? "open");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const { error: err } =
      editing && item
        ? await updateWorkItem(item.id, {
            title: title.trim(),
            notes: notes.trim() || undefined,
            category: category.trim() || undefined,
            status,
          })
        : await createWorkItem({
            title: title.trim(),
            notes: notes.trim() || undefined,
            category: category.trim() || undefined,
          });
    setPending(false);
    if (err) { setError(err); return; }
    onSaved();
    close();
  };

  const remove = async () => {
    if (!item) return;
    if (!window.confirm(`Remove "${item.title}" from the checklist?`)) return;
    setPending(true);
    const { error: err } = await deleteWorkItem(item.id);
    setPending(false);
    if (err) { setError(err); return; }
    onSaved();
    close();
  };

  const sel = FIELD;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="work-item-composer-title"
      header={
        <h2 id="work-item-composer-title" className="text-lg font-bold">
          {editing ? "✏️ Edit item" : "🔧 Add work item"}
        </h2>
      }
      footer={
        <div className="space-y-2">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Add to checklist"}
          </button>
          {editing && isAdmin && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="press w-full rounded-xl bg-accent/10 py-2.5 text-sm font-semibold text-accent ring-1 ring-accent/20 disabled:opacity-50"
            >
              Remove from checklist
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-2">
        <SectionLabel>Task</SectionLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Caulk windows on red & white cabin"'
          className={`${sel} w-full`}
          autoFocus
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (optional) — e.g. Cabin, Grounds, Road"
          className={`${sel} w-full`}
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={400}
          placeholder="Extra details (optional)"
          className={`${sel} w-full resize-none`}
        />
      </div>

      {/* Admins can flip the status when editing */}
      {editing && isAdmin && (
        <div className="space-y-2">
          <SectionLabel>Status</SectionLabel>
          <div className="flex gap-2">
            {(["open", "done"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`press flex-1 rounded-xl py-2.5 text-sm font-semibold ring-1 transition-colors ${
                  status === s
                    ? "bg-primary text-white ring-primary"
                    : "bg-card text-foreground/70 ring-border"
                }`}
              >
                {s === "open" ? "⬜ Open" : "✅ Done"}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
    </Sheet>
  );
}
