"use client";

import { useState } from "react";
import type { ResortEvent, WorkItem } from "@/lib/types";
import { formatDateRange } from "@/lib/format";
import {
  sendEventMessage,
  suggestEventNote,
  fetchEventMessagePreview,
  type EventMessagePreview,
} from "@/lib/eventMessages";
import {
  buildEventEmail,
  type EventEmailItem,
  type EventEmailHouseGroup,
} from "@/media-server/event-email-template";
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
  // "compose" → "preview" → sent. Nothing sends from the compose step: the
  // preview is the last thing between the sender and everyone's inbox, so it
  // shows the REAL rendered email (built by the mini's own template) for every
  // version that will go out.
  const [preview, setPreview] = useState<EventMessagePreview | null>(null);
  const [variantIdx, setVariantIdx] = useState(0);

  const mlrCount = workItems.filter((i) => i.houseId === null).length;
  const houseCount = workItems.filter((i) => i.houseId !== null).length + hiddenHouseItemCount;

  const openPreview = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const { preview: p, error: err } = await fetchEventMessagePreview({
      eventId: event.id,
      eventTitle: event.title,
      eventWhen: formatDateRange(event.startDate, event.endDate),
      includeWorkItems,
      excludeNotAttending,
      includeRoster,
    });
    setPending(false);
    // Pre-migration the preview RPC doesn't exist yet — don't strand the
    // feature, just let them send as before.
    if (err === "unavailable") { void submit(); return; }
    if (err) { setError(err); return; }
    setVariantIdx(0);
    setPreview(p ?? null);
  };

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

  // ── Preview step ───────────────────────────────────────────────────────────
  // Renders each version through buildEventEmail() — the SAME function the mac
  // mini calls — inside an iframe, so what's on screen is byte-for-byte what
  // sends, and the email's own table styles can't leak into the app.
  if (preview) {
    const variants = [
      ...preview.houseGroups.map((h) => ({
        label: `${h.emoji ?? "🏠"} ${h.name ?? "House"}`,
        note: `Goes to ${h.recipients} ${h.recipients === 1 ? "person" : "people"} in ${
          h.name ?? "this house"
        } — the resort tasks plus their own.`,
        bucket: h,
        recipients: h.recipients,
      })),
      {
        label: "🌲 Everyone else",
        note: `Goes to ${preview.generalRecipients} ${
          preview.generalRecipients === 1 ? "person" : "people"
        } — the resort-wide tasks only.`,
        bucket: null,
        recipients: preview.generalRecipients,
      },
    ].filter((v) => v.recipients > 0 || v.bucket === null);

    const active = variants[Math.min(variantIdx, variants.length - 1)];
    // buildEventEmail() reads the RPC's snake_case row shape, so map back to it
    // explicitly — spreading the camelCase preview object would silently render
    // an email with no date, place or description.
    const built = buildEventEmail(
      {
        subject: subject.trim() || null,
        body: body.trim() || null,
        sender_name: preview.senderName,
        sender_email: preview.senderEmail,
        event_id: preview.eventId,
        event_title: preview.eventTitle,
        event_when: preview.eventWhen,
        event_start_date: preview.eventStartDate,
        event_end_date: preview.eventEndDate,
        event_emoji: preview.eventEmoji,
        event_location: preview.eventLocation,
        event_description: preview.eventDescription,
        mlr_items: (preview.mlrItems ?? []) as EventEmailItem[],
        house_groups: preview.houseGroups as unknown as EventEmailHouseGroup[],
      },
      typeof window === "undefined" ? "" : window.location.origin,
      active ? (active.bucket as unknown as EventEmailHouseGroup | null) : null,
    );

    return (
      <Sheet
        closing={closing}
        onDismiss={close}
        labelledBy="event-message-preview-title"
        header={
          <>
            <h2 id="event-message-preview-title" className="text-lg font-bold">
              Check it over
            </h2>
            <p className="text-sm text-foreground/60">
              Exactly what people will get. Nothing has been sent yet.
            </p>
          </>
        }
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={pending}
              className="press rounded-xl bg-card px-4 py-3 text-sm font-semibold ring-1 ring-border disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="press flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Sending…" : "Looks right — send it"}
            </button>
          </div>
        }
      >
        {variants.length > 1 && (
          <div className="space-y-2">
            <SectionLabel>
              {variants.length} versions go out
            </SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {variants.map((v, i) => (
                <button
                  key={v.label}
                  type="button"
                  onClick={() => setVariantIdx(i)}
                  className={`press rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ${
                    i === variantIdx
                      ? "bg-primary text-white ring-primary"
                      : "bg-card text-foreground/70 ring-border"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <p className="px-0.5 text-xs text-muted">
              A house&rsquo;s tasks are private to that house, so each one gets its own copy. Everybody
              lands in exactly one — nobody is emailed twice.
            </p>
          </div>
        )}

        {active && <p className="text-xs text-muted">{active.note}</p>}

        <div className="space-y-1.5">
          <SectionLabel>Subject</SectionLabel>
          <p className="rounded-xl bg-card px-3 py-2.5 text-sm font-medium ring-1 ring-border">
            {built.subject}
          </p>
        </div>

        <div className="space-y-1.5">
          <SectionLabel>The email</SectionLabel>
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-border">
            <iframe
              key={active?.label}
              title="Email preview"
              srcDoc={`<!doctype html><body style="margin:0;padding:14px;background:#fff">${built.html}</body>`}
              className="block h-[420px] w-full border-0"
            />
          </div>
          <p className="px-0.5 text-xs text-faint">
            Scroll inside the box to read it all. Sent from the resort&rsquo;s address with your name on
            it, and replies come back to you.
          </p>
        </div>

        {error && (
          <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
            {error}
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
          onClick={openPreview}
          disabled={pending}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Getting it ready…" : "Preview the email →"}
        </button>
      }
    >
      <p className="text-sm text-foreground/70">
        You&rsquo;ll see the finished email before anything sends. It lays out this event&rsquo;s date, place, description
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
        <div className="flex items-end justify-between gap-3">
          <SectionLabel>
            A note to include <span className="font-normal normal-case text-faint">(optional)</span>
          </SectionLabel>
          <button
            type="button"
            onClick={() =>
              setBody(
                suggestEventNote({
                  title: event.title,
                  when: formatDateRange(event.startDate, event.endDate),
                  location: event.location,
                  description: event.description,
                }),
              )
            }
            className="press shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
          >
            {body.trim() ? "Start over" : "Write one for me"}
          </button>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Anything you want to say up front — what to bring, when to show up, who to find when you get there…"
          className={`${FIELD} w-full resize-none`}
        />
        <p className="px-0.5 text-xs text-faint">
          A draft is only ever built from this event&rsquo;s own name, dates and place &mdash; edit it
          freely. The email always asks people to RSVP, so you don&rsquo;t need to.
        </p>
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
