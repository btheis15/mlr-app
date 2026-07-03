"use client";

import { useEffect, useState } from "react";
import type { House, ResortEvent, WorkItem, WorkItemMedia, WorkItemUrgency } from "@/lib/types";
import {
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  addWorkItemToEvent,
  addWorkItemMedia,
  removeWorkItemMedia,
  URGENCY_META,
} from "@/lib/workItems";
import { fetchEvents, upcomingEvents } from "@/lib/events";
import { uploadToMini, compressImage } from "@/lib/media";
import { supabase } from "@/lib/supabase";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useMediaPicker } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";

// Add/edit sheet for a work checklist item. Any signed-in member can add items;
// admins get the extra status toggle + delete button when editing. Items can be
// scoped MLR (everyone) or to a house, and can carry photo/video attachments.

export function WorkItemComposer({
  item,
  houses,
  myHouseId,
  onClose,
  onSaved,
  preLinkedEventId,
}: {
  item?: WorkItem | null;
  /** Houses the adder may choose from (all houses for admins; caller decides). */
  houses?: House[];
  /** The adder's own house, so a non-admin member can post to it. */
  myHouseId?: string | null;
  onClose: () => void;
  onSaved: () => void;
  /** When set, the new item is auto-linked to this event and the picker is hidden. */
  preLinkedEventId?: string;
}) {
  const { isAdmin } = useIdentity();
  const editing = Boolean(item);
  const { closing, close } = useSheetDismiss(onClose);
  const media = useMediaPicker();

  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [peopleNeeded, setPeopleNeeded] = useState<number>(item?.peopleNeeded ?? 0);
  const [status, setStatus] = useState<"open" | "done">(item?.status ?? "open");
  const [urgency, setUrgency] = useState<WorkItemUrgency>(item?.urgency ?? "this_year");
  const [houseId, setHouseId] = useState<string | null>(item?.houseId ?? null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(preLinkedEventId ?? null);
  const [events, setEvents] = useState<ResortEvent[]>([]);
  const [existingMedia, setExistingMedia] = useState<WorkItemMedia[]>(item?.media ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which houses the current user may target. Admins can pick any house; a member
  // can only post to their own. MLR (null) is always available.
  const houseOptions = (houses ?? []).filter((h) => isAdmin || h.id === myHouseId);
  const showScope = houseOptions.length > 0 || (editing && item?.houseId != null);

  // Load upcoming events for the "link to event" picker (add mode only, not when pre-linked).
  useEffect(() => {
    if (editing || preLinkedEventId) return;
    const today = new Date().toISOString().slice(0, 10);
    fetchEvents().then((all) => setEvents(upcomingEvents(all, today)));
  }, [editing, preLinkedEventId]);

  const canSubmit = title.trim().length > 0 && !pending;

  // Upload the freshly-picked files to the mini + attach them to a work item.
  const uploadPickedMedia = async (workItemId: string) => {
    if (!media.files.length || !supabase) return;
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Not signed in.");
    for (let i = 0; i < media.files.length; i++) {
      const raw = media.files[i];
      const isVideo = raw.type.startsWith("video");
      const f = isVideo ? raw : await compressImage(raw);
      const url = await uploadToMini(f, token, { category: "work" });
      const { error: mErr } = await addWorkItemMedia(
        workItemId,
        url,
        isVideo ? "video" : "image",
        existingMedia.length + i,
      );
      if (mErr) throw new Error(mErr);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const parsed = peopleNeeded > 0 ? peopleNeeded : null;

    try {
      if (editing && item) {
        const { error: err } = await updateWorkItem(item.id, {
          title: title.trim(),
          notes: notes.trim() || undefined,
          status,
          peopleNeeded: parsed,
          urgency,
          houseId,
        });
        if (err) throw new Error(err);
        // Removed existing attachments.
        for (const m of item.media) {
          if (!existingMedia.some((e) => e.id === m.id)) await removeWorkItemMedia(m.id);
        }
        await uploadPickedMedia(item.id);
      } else {
        const { error: err, id: newId } = await createWorkItem({
          title: title.trim(),
          notes: notes.trim() || undefined,
          peopleNeeded: parsed,
          urgency,
          houseId,
        });
        if (err) throw new Error(err);
        if (newId) {
          if (selectedEventId) await addWorkItemToEvent(selectedEventId, newId);
          await uploadPickedMedia(newId);
        }
      }
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return;
    }

    setPending(false);
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
      {/* Task */}
      <div className="space-y-2">
        <SectionLabel>Task</SectionLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Caulk windows on red & white cabin"'
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

      {/* Urgency */}
      <div className="space-y-2">
        <SectionLabel>How urgent?</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(URGENCY_META) as WorkItemUrgency[]).map((u) => (
            <ScopeChip
              key={u}
              label={`${URGENCY_META[u].emoji} ${URGENCY_META[u].label}`}
              active={urgency === u}
              onClick={() => setUrgency(u)}
            />
          ))}
        </div>
      </div>

      {/* Scope: MLR (everyone) or a house */}
      {showScope && (
        <div className="space-y-2">
          <SectionLabel>Who's this for?</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <ScopeChip label="🌲 Around the Resort (everyone)" active={houseId === null} onClick={() => setHouseId(null)} />
            {houseOptions.map((h) => (
              <ScopeChip
                key={h.id}
                label={`${h.emoji} ${h.name}`}
                active={houseId === h.id}
                onClick={() => setHouseId(h.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Photos / video */}
      <div className="space-y-2">
        <SectionLabel>Photos / video (optional)</SectionLabel>
        {(existingMedia.length > 0 || media.previews.length > 0) && (
          <div className="grid grid-cols-3 gap-2">
            {existingMedia.map((m) => (
              <div key={m.id} className="relative aspect-square overflow-hidden rounded-xl bg-black/5 ring-1 ring-border">
                {m.type === "video" ? (
                  <video src={m.url} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => setExistingMedia((prev) => prev.filter((e) => e.id !== m.id))}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {media.previews.map((m, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-xl bg-black/5 ring-1 ring-border">
                {m.type === "video" ? (
                  <video src={m.url} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                )}
                {m.type === "video" && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">▶ Video</span>
                )}
                <button
                  type="button"
                  onClick={() => media.removeAt(i)}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="press flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-card py-2.5 text-sm font-medium text-primary ring-1 ring-border">
          📷 Add photos / video
          <input type="file" accept="image/*,video/*" multiple onChange={media.add} className="hidden" />
        </label>
      </div>

      {/* People needed — +/- stepper, 0 = not set */}
      <div className="space-y-2">
        <SectionLabel>How many people needed? (optional)</SectionLabel>
        <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border">
          <span className="text-sm font-medium text-foreground/70">People needed</span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer people"
              onClick={() => setPeopleNeeded((n) => Math.max(0, n - 1))}
              disabled={peopleNeeded <= 0}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {peopleNeeded === 0 ? "Any" : peopleNeeded}
            </span>
            <button
              type="button"
              aria-label="More people"
              onClick={() => setPeopleNeeded((n) => Math.min(20, n + 1))}
              disabled={peopleNeeded >= 20}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              +
            </button>
          </span>
        </div>
      </div>

      {/* Link to an event (add mode only, when upcoming events exist, not when pre-linked) */}
      {!editing && !preLinkedEventId && events.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>Link to an event (optional)</SectionLabel>
          <div className="space-y-1">
            {events.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => setSelectedEventId(selectedEventId === ev.id ? null : ev.id)}
                className={`press flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
                  selectedEventId === ev.id
                    ? "bg-primary/10 ring-primary/30"
                    : "bg-card ring-border"
                }`}
              >
                <span aria-hidden className="shrink-0">{ev.emoji ?? "📅"}</span>
                <span className={`flex-1 text-sm leading-snug ${selectedEventId === ev.id ? "font-medium text-primary" : "text-foreground/70"}`}>
                  {ev.title}
                </span>
                {selectedEventId === ev.id && (
                  <span className="shrink-0 text-xs font-semibold text-primary">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

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

function ScopeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
        active ? "bg-primary text-white ring-primary" : "bg-card text-foreground/70 ring-border"
      }`}
    >
      {label}
    </button>
  );
}
