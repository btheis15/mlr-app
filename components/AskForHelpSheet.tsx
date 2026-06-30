"use client";

import { useEffect, useState } from "react";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { helpTargeting, requestHelp, mapsUrl, HELP_TYPES, DEFAULT_HELP_TYPE } from "@/lib/helpRequests";
import { fetchWorkItems } from "@/lib/workItems";
import type { ResortEvent, WorkItem } from "@/lib/types";

/** The "did this get done?" nudge fires at 9 PM resort-local today, or 8 AM the
 *  next morning if it's already past 6 PM. Returns an ISO timestamp. */
function followupAtISO(): string {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // Offset (ms) between Chicago wall-clock and true UTC right now.
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = asUTC - now.getTime();
  let y = +parts.year,
    mo = +parts.month,
    d = +parts.day,
    h = 21;
  if (+parts.hour >= 18) {
    h = 8;
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear();
    mo = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  const targetAsUTC = Date.UTC(y, mo - 1, d, h, 0, 0);
  return new Date(targetAsUTC - offsetMs).toISOString();
}

// The "Ask for Help" form (migration 0037). Opens only for someone who's at the
// resort (the page gates it). Pick a type, describe what you need, optionally a
// where + a precise pin + a time; on submit it notifies willing members who are
// also at the resort and lands in the shared log. The presence targeting snapshot
// is computed here from the merged event list and resolved server-side.

export function AskForHelpSheet({
  events,
  today,
  onClose,
  onSubmitted,
}: {
  events: ResortEvent[];
  /** Resort-local ISO date (YYYY-MM-DD). */
  today: string;
  onClose: () => void;
  /** Called after a successful post, with how many members it reached + which
   *  audience was targeted (for an honest confirmation message). */
  onSubmitted: (notified: number, audience: "present" | "all_willing") => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(DEFAULT_HELP_TYPE);
  const [neededCount, setNeededCount] = useState(1);
  // Optional "what to bring" lines (e.g. "2 long tables", "6 chairs"). Helpers
  // check these off as they commit to bringing them.
  const [items, setItems] = useState<string[]>([]);
  // Optional Work Checklist task this request is for. Linking one schedules a
  // "did it get done?" follow-up and lets the asker check it off later.
  const [openTasks, setOpenTasks] = useState<WorkItem[]>([]);
  const [workItemId, setWorkItemId] = useState<string | null>(null);
  const [whereText, setWhereText] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [neededLocal, setNeededLocal] = useState("");
  const [allWilling, setAllWilling] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = description.trim().length > 0 && !pending;

  useEffect(() => {
    let active = true;
    fetchWorkItems()
      .then((all) => {
        if (active) setOpenTasks(all.filter((w) => w.status === "open"));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const shareLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocError("Couldn't get your location — you can still describe where you are.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const { eligible, strict } = helpTargeting(events, today);
    // datetime-local has no timezone; new Date() reads it as local, which is what
    // we want (the requester's / resort's local clock).
    const neededAt = later && neededLocal ? new Date(neededLocal).toISOString() : null;
    const { notified, error: err } = await requestHelp({
      description: description.trim(),
      category,
      whereText: whereText.trim() || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      neededAt,
      neededCount,
      audience: allWilling ? "all_willing" : "present",
      eligible,
      strict,
      today,
      items: items.map((s) => s.trim()).filter(Boolean),
      workItemId,
      followupAt: workItemId ? followupAtISO() : null,
    });
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    onSubmitted(notified ?? 0, allWilling ? "all_willing" : "present");
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="help-sheet-title"
      header={
        <>
          <h2 id="help-sheet-title" className="text-lg font-bold">
            🙌 Ask for help
          </h2>
          <p className="text-sm text-foreground/60">
            Goes to members who are at the resort and willing to help.
          </p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send request"}
          </button>
          <p className="mt-2 text-center text-[11px] text-foreground/45">
            People nearby get a notification — they can say they&rsquo;re on the way.
          </p>
        </>
      }
    >
      {/* Type */}
      <div className="space-y-2">
        <SectionLabel>Type of help</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {HELP_TYPES.map((t) => {
            const on = category === t.key;
            const urgent = t.key === "urgent";
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setCategory(t.key)}
                aria-pressed={on}
                className={`press rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${
                  on
                    ? urgent
                      ? "bg-accent/15 text-accent ring-accent/40"
                      : "bg-primary/10 text-primary ring-primary/30"
                    : "bg-card text-foreground/70 ring-border"
                }`}
              >
                {t.emoji} {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Link a Work Checklist task (optional) — near the top so it's clear you
          can start from the list instead of describing the task by hand. */}
      {openTasks.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>
            Link a Work Checklist task{" "}
            <span className="font-normal normal-case text-foreground/40">(optional)</span>
          </SectionLabel>
          <select
            value={workItemId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setWorkItemId(id);
              // Prefill the request text with the task title if it's still empty.
              if (id && !description.trim()) {
                const t = openTasks.find((w) => w.id === id);
                if (t) setDescription(t.title);
              }
            }}
            className={`${FIELD} w-full`}
          >
            <option value="">No linked task</option>
            {openTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {workItemId && (
            <p className="px-0.5 text-[11px] text-foreground/45">
              Later today we&rsquo;ll ask if this got done — saying yes checks it off the list.
            </p>
          )}
        </div>
      )}

      {/* What */}
      <div className="space-y-2">
        <SectionLabel>What do you need?</SectionLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={400}
          placeholder="e.g. Need 2–3 people to move logs from the lot to the pavilion."
          className={`${FIELD} w-full resize-none`}
        />
      </div>

      {/* What to bring (optional checklist) */}
      <div className="space-y-2">
        <SectionLabel>
          Anything to bring? <span className="font-normal normal-case text-foreground/40">(optional)</span>
        </SectionLabel>
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={it}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  maxLength={80}
                  placeholder="e.g. 2 long tables"
                  className={`${FIELD} w-full`}
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                  className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-lg text-foreground/50 ring-1 ring-border"
                >
                  −
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, ""])}
          className="press flex w-full items-center justify-center gap-2 rounded-xl bg-card py-2.5 text-xs font-semibold text-foreground/75 ring-1 ring-border"
        >
          + Add something to bring
        </button>
        <p className="px-0.5 text-[11px] text-foreground/45">
          List what you need (tables, chairs, coolers…). Helpers check off the ones they&rsquo;re bringing.
        </p>
      </div>

      {/* How many */}
      <div className="space-y-2">
        <SectionLabel>How many people do you need?</SectionLabel>
        <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border">
          <span className="text-sm font-medium">People needed</span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer people"
              onClick={() => setNeededCount((n) => Math.max(1, n - 1))}
              disabled={neededCount <= 1}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-semibold tabular-nums">{neededCount}</span>
            <button
              type="button"
              aria-label="More people"
              onClick={() => setNeededCount((n) => Math.min(20, n + 1))}
              disabled={neededCount >= 20}
              className="press flex h-8 w-8 items-center justify-center rounded-full bg-background text-lg ring-1 ring-border disabled:opacity-40"
            >
              +
            </button>
          </span>
        </div>
        <p className="px-0.5 text-[11px] text-foreground/45">
          Everyone willing &amp; here gets pinged. Once {neededCount === 1 ? "someone&rsquo;s" : `${neededCount} are`} on the
          way, it shows as covered and they&rsquo;re told they&rsquo;re all set.
        </p>
      </div>

      {/* Where */}
      <div className="space-y-2">
        <SectionLabel>
          Where are you? <span className="font-normal normal-case text-foreground/40">(optional)</span>
        </SectionLabel>
        <input
          value={whereText}
          onChange={(e) => setWhereText(e.target.value)}
          maxLength={120}
          placeholder="Pavilion · Cabin 2 dock · north beach…"
          className={`${FIELD} w-full`}
        />
        {coords ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-xs ring-1 ring-primary/20">
            <a href={mapsUrl(coords.lat, coords.lng)} target="_blank" rel="noopener noreferrer" className="press font-medium text-primary underline-offset-2 hover:underline">
              📍 Location attached — preview map
            </a>
            <button type="button" onClick={() => setCoords(null)} className="press font-medium text-foreground/50">
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={shareLocation}
            disabled={locating}
            className="press flex w-full items-center justify-center gap-2 rounded-xl bg-card py-2.5 text-xs font-semibold text-foreground/75 ring-1 ring-border disabled:opacity-50"
          >
            {locating ? "Getting your location…" : "📍 Share my exact location"}
          </button>
        )}
        {locError && <p className="px-0.5 text-xs text-accent">{locError}</p>}
      </div>

      {/* When */}
      <div className="space-y-2">
        <SectionLabel>When</SectionLabel>
        <label className="flex items-center gap-3 rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border">
          <input
            type="checkbox"
            checked={later}
            onChange={(e) => setLater(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          <span className="text-foreground/80">
            I need help at a specific time
            <span className="block text-xs text-foreground/45">Off = right now.</span>
          </span>
        </label>
        {later && (
          <>
            <input
              type="datetime-local"
              value={neededLocal}
              onChange={(e) => setNeededLocal(e.target.value)}
              className={`${FIELD} w-full`}
            />
            <p className="px-0.5 text-[11px] text-foreground/45">
              It goes out now so people can sign up. 15 minutes before, everyone who said they&rsquo;re coming
              gets a reminder — and if you&rsquo;re still short, it asks people nearby again.
            </p>
          </>
        )}
      </div>

      {/* Reach */}
      <label className="flex items-center gap-3 rounded-xl bg-card px-3 py-3 text-sm ring-1 ring-border">
        <input
          type="checkbox"
          checked={allWilling}
          onChange={(e) => setAllWilling(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
        <span className="text-foreground/80">
          Notify everyone willing to help
          <span className="block text-xs text-foreground/45">
            Not just people here right now — use if it&rsquo;s quiet at the resort.
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
    </Sheet>
  );
}
