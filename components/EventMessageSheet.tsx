"use client";

import { useState } from "react";
import type { ResortEvent, WorkItem } from "@/lib/types";
import { formatDateRange } from "@/lib/format";
import { sendEventMessage } from "@/lib/eventMessages";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";

// "Email everyone about this event" (migration 0190) — opened from EventSheet by
// the event's creator or an admin. Collects an optional subject + note; the email
// itself is composed on the mac mini (alert-mailer.js), which lays out the event
// details plus every work item planned for it, each with its own title + details.
//
// The two checkboxes mirror rules that already exist elsewhere in the app: the
// work-item list (0189's scope split — resort-wide items in full, a count line
// per house, since one BCC'd email can't be scoped per recipient) and the
// event-targeting rule from 0096 (skip anyone who said they can't make it).

export function EventMessageSheet({
  event,
  workItems,
  hiddenHouseItemCount,
  onClose,
}: {
  event: ResortEvent;
  /** The event's work items the VIEWER can see — drives the preview copy only. */
  workItems: WorkItem[];
  /** Items in houses the viewer isn't in — folded into the preview's count. */
  hiddenHouseItemCount: number;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [includeWorkItems, setIncludeWorkItems] = useState(true);
  const [excludeNotAttending, setExcludeNotAttending] = useState(true);
  const [includeRoster, setIncludeRoster] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const mlrCount = workItems.filter((i) => i.houseId === null).length;
  const houseCount = workItems.filter((i) => i.houseId !== null).length + hiddenHouseItemCount;

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const { count, error: err } = await sendEventMessage({
      eventId: event.id,
      eventTitle: event.title,
      eventWhen: formatDateRange(event.startDate, event.endDate),
      subject,
      body,
      includeWorkItems,
      excludeNotAttending,
      includeRoster,
    });
    setPending(false);
    if (err) { setError(err); return; }
    setSentCount(count ?? 0);
  };

  // Sent — hold the sheet open on a confirmation rather than closing silently,
  // so the sender knows it actually went (and to how many people).
  if (sentCount !== null) {
    return (
      <Sheet
        closing={closing}
        onDismiss={close}
        labelledBy="event-message-sent-title"
        header={
          <h2 id="event-message-sent-title" className="text-lg font-bold">
            ✅ Email on its way
          </h2>
        }
        footer={
          <button
            type="button"
            onClick={close}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
          >
            Done
          </button>
        }
      >
        <p className="text-sm text-foreground/70">
          {sentCount === 0
            ? "There was nobody to email — no one has an email address on file with alerts on. The event is still in the app for everyone."
            : `Sending to ${sentCount} ${sentCount === 1 ? "person" : "people"}${
                includeRoster ? ", including family on the roster who aren't on the app yet" : ""
              }${excludeNotAttending ? ", skipping anyone who said they can't make it" : ""}.`}
        </p>
        {sentCount > 0 && (
          <p className="text-xs text-muted">
            You&rsquo;ll get a copy yourself so you can see exactly how it looked. Emails go out from the
            resort&rsquo;s mail server — usually within a minute.
          </p>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="event-message-title"
      header={
        <>
          <h2 id="event-message-title" className="text-lg font-bold">
            📣 Email everyone
          </h2>
          <p className="text-sm text-foreground/60">
            {event.emoji ?? "📅"} {event.title}
          </p>
        </>
      }
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send the email"}
        </button>
      }
    >
      <p className="text-sm text-foreground/70">
        Sends a laid-out email with this event&rsquo;s date, place, description
        {includeWorkItems ? ", and the tasks assigned to it" : ""} — plus a button to RSVP in the app.
      </p>
      {includeWorkItems && houseCount > 0 && (
        <p className="rounded-xl bg-primary/5 px-3 py-2.5 text-xs text-foreground/70 ring-1 ring-primary/15">
          Because a house&rsquo;s tasks are private to that house, people in a house get their own version of
          the email — the resort-wide tasks <em>plus</em> their house&rsquo;s. Everyone else gets the
          resort-wide tasks only. All sent blind, so nobody sees who else got it.
        </p>
      )}

      <div className="space-y-2">
        <SectionLabel>
          Subject <span className="font-normal normal-case text-faint">(optional)</span>
        </SectionLabel>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder={`${event.title} — ${formatDateRange(event.startDate, event.endDate)}`}
          className={`${FIELD} w-full`}
        />
        <p className="px-0.5 text-xs text-faint">Left blank, it uses the event&rsquo;s name and dates.</p>
      </div>

      <div className="space-y-2">
        <SectionLabel>
          A note to include <span className="font-normal normal-case text-faint">(optional)</span>
        </SectionLabel>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Anything you want to say up front — what to bring, when to show up, who to find when you get there…"
          className={`${FIELD} w-full resize-none`}
        />
      </div>

      <div className="space-y-2">
        <SectionLabel>Who gets it</SectionLabel>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-sm font-medium">Include family who aren&rsquo;t on the app yet</span>
            <span className="block text-xs text-muted">
              Anyone added to the family or a committee roster with an email address, even without an
              account. Turn this off to email only people who use the app.
            </span>
          </span>
          <input
            type="checkbox"
            checked={includeRoster}
            onChange={(e) => setIncludeRoster(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-sm font-medium">Skip anyone who said they can&rsquo;t make it</span>
            <span className="block text-xs text-muted">
              Everyone else gets it, even if they haven&rsquo;t RSVP&rsquo;d yet.
            </span>
          </span>
          <input
            type="checkbox"
            checked={excludeNotAttending}
            onChange={(e) => setExcludeNotAttending(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
        <p className="px-0.5 text-xs text-faint">
          App members who turned email alerts off in their own profile are always skipped.
        </p>
      </div>

      <div className="space-y-2">
        <SectionLabel>What goes in it</SectionLabel>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-sm font-medium">Include the tasks assigned</span>
            <span className="block text-xs text-muted">
              {mlrCount > 0
                ? `${mlrCount} resort-wide task${mlrCount === 1 ? "" : "s"}, each with its details.`
                : "No resort-wide tasks on this event yet."}
              {houseCount > 0
                ? ` A house's ${houseCount} task${houseCount === 1 ? "" : "s"} only go to that house's own people.`
                : ""}
              {" Completed tasks are left out."}
            </span>
          </span>
          <input
            type="checkbox"
            checked={includeWorkItems}
            onChange={(e) => setIncludeWorkItems(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
    </Sheet>
  );
}
