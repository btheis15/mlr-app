"use client";

// Home call-out cards (migration 0083) — the swipe-away cards stacked above
// the Home spotlight (see CalloutStack/HomeSpotlight). Moved here from the
// Family Fest Planner (Admin → Alerts & Notifications is where an admin
// already reaches for "post something everyone sees" — a call-out doesn't
// need to be Family-Fest-specific, e.g. a work-weekend flyer). Gated by
// AdminGuard on the page that mounts this, same as everything else there;
// writes still go through the can_edit_fest()-gated saveCallout/deleteCallout
// (lib/festContent.ts), unchanged.

import { useCallback, useEffect, useRef, useState } from "react";
import { CalloutCard } from "@/components/CalloutCard";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useSaveStatus } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { uploadSiteImage } from "@/lib/appImages";
import { EventTargetPicker, type EventTarget } from "@/components/EventTargetPicker";
import { ReminderScheduler } from "@/components/ReminderScheduler";
import { toDatetimeLocal } from "@/lib/format";
import { postAnnouncement, sendActivityNotification } from "@/lib/broadcast";
import {
  fetchCallouts,
  saveCallout,
  deleteCallout,
  fetchFestContent,
  type HomeCallout,
  type CalloutLink,
} from "@/lib/festContent";
import type { ScheduleEvent } from "@/lib/types";
import { fetchDropBoxes, type DropBox } from "@/lib/dropBoxes";

/** "Jul 1 – Jul 15" / "through Jul 15" / "from Jul 1" / "always" — the show
 *  window, for the list row summary. */
function calloutWindow(c: HomeCallout): string {
  const day = (d: string) => formatDate(`${d}T00:00:00`);
  if (c.startsOn && c.endsOn) return `${day(c.startsOn)} – ${day(c.endsOn)}`;
  if (c.endsOn) return `through ${day(c.endsOn)}`;
  if (c.startsOn) return `from ${day(c.startsOn)}`;
  return "always";
}

/** "Fall Work Weekend!" → "fall-work-weekend" (for the suggested dismiss id). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Trim a text field → null when empty (so updates blank the DB column). */
const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

async function confirmDelete(label: string, run: () => Promise<{ error?: string }>, onChanged: () => void) {
  if (typeof window !== "undefined" && !window.confirm(`Delete ${label}? This can't be undone.`)) return;
  const { error } = await run();
  if (error) {
    window.alert(error);
    return;
  }
  onChanged();
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="press w-full rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-3 text-sm font-semibold text-primary"
    >
      ＋ {label}
    </button>
  );
}

function RowCard({
  title,
  subtitle,
  onEdit,
  onDelete,
}: {
  title: string;
  subtitle?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
      <button onClick={onEdit} className="press min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold">{title}</p>
        {subtitle && <p className="truncate text-xs text-foreground/55">{subtitle}</p>}
      </button>
      <button
        onClick={onEdit}
        className="press rounded-full bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary"
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        aria-label="Delete"
        className="press rounded-full bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent"
      >
        🗑
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

function SaveBar({
  status,
  disabled,
  pending,
  onSave,
  label,
}: {
  status: string | null;
  disabled: boolean;
  pending: boolean;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      {status && <p className="text-center text-xs font-medium text-primary">{status}</p>}
      <button
        onClick={onSave}
        disabled={disabled}
        className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : label ?? "Save"}
      </button>
    </div>
  );
}

export function AdminCallouts() {
  const [items, setItems] = useState<HomeCallout[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HomeCallout | "new" | null>(null);

  const reload = useCallback(async () => {
    setItems(await fetchCallouts());
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-3">
      <p className="px-0.5 text-xs text-foreground/55">
        Temporary cards stacked on the Home screen&rsquo;s Family Fest spotlight — people can
        swipe each one away. The flyer image, text, links, and dates are all optional.
      </p>
      <AddButton label="Add a Home callout" onClick={() => setEditing("new")} />
      {loading ? (
        <p className="rounded-2xl bg-card p-4 text-center text-xs text-foreground/55 ring-1 ring-border">Loading…</p>
      ) : (
        <>
          {items.map((c) => (
            <RowCard
              key={c.id}
              title={c.title?.trim() || c.links[0]?.label?.trim() || "Untitled callout"}
              subtitle={`${c.isActive ? "🟢 Active" : "⚪ Off"} · shows ${calloutWindow(c)}`}
              onEdit={() => setEditing(c)}
              onDelete={() =>
                confirmDelete(c.title?.trim() || "this callout", () => deleteCallout(c.id), reload)
              }
            />
          ))}
          {items.length === 0 && (
            <p className="rounded-2xl bg-card p-4 text-center text-xs text-foreground/55 ring-1 ring-border">
              No callouts yet — add one and it appears on Home for everyone.
            </p>
          )}
        </>
      )}
      {editing && (
        <CalloutSheet
          draft={editing === "new" ? null : editing}
          nextPosition={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function CalloutSheet({
  draft,
  nextPosition,
  onClose,
  onSaved,
}: {
  draft: HomeCallout | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(draft?.imageUrl ?? null);
  const [links, setLinks] = useState<{ href: string; label: string }[]>(
    draft?.links.length ? draft.links.map((l) => ({ href: l.href, label: l.label ?? "" })) : [],
  );
  const [startsOn, setStartsOn] = useState(draft?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(draft?.endsOn ?? "");
  const [deadlineAt, setDeadlineAt] = useState(draft?.deadlineAt ? toDatetimeLocal(draft.deadlineAt) : "");
  const [dismissId, setDismissId] = useState(draft?.dismissId ?? "");
  // Auto-suggest the dismiss id (slug + date) until the editor types their own.
  const [dismissTouched, setDismissTouched] = useState(Boolean(draft));
  const [active, setActive] = useState(draft?.isActive ?? true);
  const [position, setPosition] = useState(String(draft?.position ?? nextPosition));
  const [eventTarget, setEventTarget] = useState<EventTarget>({
    eventId: draft?.eventId ?? null,
    excludeNotAttending: draft?.excludeNotAttending ?? true,
  });
  // Link this callout to a Family Fest ACTIVITY — an individual agenda item
  // (a dinner, a concert, a scavenger hunt — a fest_schedule_items row), as
  // opposed to eventTarget above which links to a whole EVENT (the resort
  // calendar, e.g. the Family Fest week itself) purely for RSVP-based
  // show/hide targeting. Picking an activity here does two things: (1) pulls
  // its photo/details/links into this card as a starting point (tweak
  // anything afterward — re-picking a different activity re-pulls fresh
  // content, since that's the point of linking one), and (2) — unchanged from
  // migration 0137 — if that activity takes sign-ups, adds a "📝 Sign up"
  // button. Stored in the same `signupItemId` column; the column's original,
  // narrower name stuck since it still drives the Sign-up button, but the
  // picker itself is no longer limited to sign-up-enabled activities.
  const [signupItemId, setSignupItemId] = useState<string | null>(draft?.signupItemId ?? null);
  const [activityOptions, setActivityOptions] = useState<ScheduleEvent[]>([]);
  // Link this callout to a Drop Box folder (0172) → a "📸 Add & see photos"
  // button deep-linking /drop?box=<id> (e.g. the Family Fest album).
  const [dropBoxId, setDropBoxId] = useState<string | null>(draft?.dropBoxId ?? null);
  const [dropBoxOptions, setDropBoxOptions] = useState<DropBox[]>([]);
  useEffect(() => {
    let alive = true;
    fetchFestContent().then((c) => {
      if (alive) setActivityOptions(c.schedule);
    });
    // Non-archived folders, newest first (fetchDropBoxes already sorts).
    fetchDropBoxes(null, true).then((boxes) => {
      if (alive) setDropBoxOptions(boxes.filter((b) => !b.archivedAt));
    });
    return () => {
      alive = false;
    };
  }, []);
  const onPickActivity = (id: string) => {
    setSignupItemId(id || null);
    if (!id) return; // clearing the link shouldn't wipe content already on the card
    const picked = activityOptions.find((e) => e.id === id);
    if (!picked) return;
    setTitle(`${picked.emoji ?? ""} ${picked.title}`.trim());
    setBody(picked.description ?? "");
    setImageUrl(picked.imageUrl ?? null);
    setLinks(picked.links?.length ? picked.links.map((l) => ({ href: l.href, label: l.label ?? "" })) : []);
  };
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Optional one-time side actions, fired right after this save succeeds —
  // NOT persisted on the callout itself (so re-saving an edit never resends
  // by accident; both default off every time this sheet opens). "Also send a
  // notification" is its own short headline (this IS the notification's
  // title, deliberately no separate body — see CLAUDE.md "Home call-out
  // stack"); "Also email" defaults to the callout's own body/description
  // until touched, editable before sending, same auto-suggest idiom as the
  // dismiss id below.
  const [alsoNotify, setAlsoNotify] = useState(false);
  const [notifyText, setNotifyText] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const effectiveEmailText = emailTouched ? emailText : body;

  // A swiped card stays dismissed by id (see CalloutStack) — so the id carries
  // a date suffix, and re-versioning it resurfaces the card for everyone.
  const suggestedId = () =>
    `${slugify(title.trim() || links[0]?.label.trim() || "callout") || "callout"}-${
      endsOn || new Date().toISOString().slice(0, 10)
    }`;
  const effectiveDismissId = dismissTouched ? dismissId : suggestedId();

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      setImageUrl(await uploadSiteImage(file, "home_callout"));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const parsedPosition = (() => {
    const n = parseInt(position, 10);
    return Number.isFinite(n) ? n : draft?.position ?? nextPosition;
  })();

  const cleanLinks = (): CalloutLink[] =>
    links
      .filter((l) => l.href.trim())
      .map((l) => ({ href: l.href.trim(), label: orNull(l.label) }));

  const addLink = () => setLinks((prev) => [...prev, { href: "", label: "" }]);
  const updateLink = (i: number, patch: Partial<{ href: string; label: string }>) =>
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLink = (i: number) => setLinks((prev) => prev.filter((_, idx) => idx !== i));

  const preview: HomeCallout = {
    id: draft?.id ?? "preview",
    title: orNull(title),
    body: orNull(body),
    imageUrl,
    links: cleanLinks(),
    startsOn: startsOn || null,
    endsOn: endsOn || null,
    dismissId: effectiveDismissId,
    position: parsedPosition,
    isActive: active,
    eventId: eventTarget.eventId,
    excludeNotAttending: eventTarget.excludeNotAttending,
    deadlineAt: deadlineAt ? new Date(deadlineAt).toISOString() : null,
    signupItemId,
    dropBoxId,
  };

  const hasContent = Boolean(title.trim() || body.trim() || imageUrl || signupItemId || dropBoxId);
  const validRange = !startsOn || !endsOn || endsOn >= startsOn;
  const canSave =
    hasContent &&
    effectiveDismissId.trim().length > 0 &&
    validRange &&
    (!alsoNotify || notifyText.trim().length > 0) &&
    (!alsoEmail || effectiveEmailText.trim().length > 0) &&
    !save.pending &&
    !uploading;
  const submit = () =>
    save.run(async () => {
      const { error } = await saveCallout({
        id: draft?.id,
        title: orNull(title),
        body: orNull(body),
        imageUrl,
        links: cleanLinks(),
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        dismissId: effectiveDismissId.trim(),
        position: parsedPosition,
        isActive: active,
        eventId: eventTarget.eventId,
        excludeNotAttending: eventTarget.excludeNotAttending,
        deadlineAt: deadlineAt ? new Date(deadlineAt).toISOString() : null,
        signupItemId,
        dropBoxId,
      });
      if (error) return error;

      // One-time side actions — best-effort, AFTER the callout itself is
      // safely saved. A failure here is surfaced (and blocks the sheet from
      // closing) so the admin can retry just this part; the callout save
      // itself has already gone through either way.
      if (alsoNotify && notifyText.trim()) {
        const { error: notifyErr } = await sendActivityNotification({
          title: notifyText.trim(),
          url: "/",
          audience: "everyone",
          eventId: eventTarget.eventId,
          excludeNotAttending: eventTarget.excludeNotAttending,
        });
        if (notifyErr) return `Callout saved, but the notification failed: ${notifyErr}`;
      }
      if (alsoEmail && effectiveEmailText.trim()) {
        const { error: emailErr } = await postAnnouncement({
          title: title.trim() || "New at Muskellunge Lake Resort",
          body: effectiveEmailText.trim(),
          showBanner: false,
          notifyEmail: true,
          emailAudience: "all",
          expiryHours: 24,
          eventId: eventTarget.eventId,
          excludeNotAttending: eventTarget.excludeNotAttending,
        });
        if (emailErr) return `Callout saved, but the email failed: ${emailErr}`;
      }

      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="callout-sheet"
      header={<h2 id="callout-sheet" className="text-lg font-bold">{draft ? "✏️ Edit callout" : "📣 New callout"}</h2>}
      footer={<SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} />}
    >
      <div className="space-y-2 rounded-xl bg-background px-3 py-2.5 ring-1 ring-border">
        <p className="text-xs font-semibold text-foreground/70">🔗 Link this callout (optional)</p>
        <Field label="To a Family Fest activity">
          <select
            value={signupItemId ?? ""}
            onChange={(e) => onPickActivity(e.target.value)}
            className={`${FIELD} w-full`}
          >
            <option value="">No specific activity</option>
            {/* Keep the current pick selectable even if it's not in the list
                (e.g. a private event, or the schedule hasn't loaded yet). */}
            {signupItemId && !activityOptions.some((e) => e.id === signupItemId) && (
              <option value={signupItemId}>Linked activity</option>
            )}
            {activityOptions.map((e) => (
              <option key={e.id} value={e.id}>
                🎟 {e.emoji ? `${e.emoji} ` : ""}{e.title} — {e.anytime ? "Anytime" : formatDate(`${e.day}T00:00:00`)}
              </option>
            ))}
          </select>
          <p className="mt-1.5 px-0.5 text-xs text-foreground/50">
            A single item on the agenda — a dinner, a concert, a scavenger hunt. Picking one pulls
            its photo, details, and links into this card below (tweak anything after); if it's
            taking sign-ups, this also adds a &ldquo;📝 Sign up&rdquo; button.
          </p>
        </Field>
        <Field label="To a photo folder (Drop Box)">
          <select
            value={dropBoxId ?? ""}
            onChange={(e) => setDropBoxId(e.target.value || null)}
            className={`${FIELD} w-full`}
          >
            <option value="">No photo folder</option>
            {dropBoxId && !dropBoxOptions.some((b) => b.id === dropBoxId) && (
              <option value={dropBoxId}>Linked folder</option>
            )}
            {dropBoxOptions.map((b) => (
              <option key={b.id} value={b.id}>
                📸 {b.emoji ? `${b.emoji} ` : ""}{b.title}
              </option>
            ))}
          </select>
          <p className="mt-1.5 px-0.5 text-xs text-foreground/50">
            Adds a &ldquo;📸 Add &amp; see photos&rdquo; button that opens the shared folder — where
            everyone can dump and download the week&rsquo;s photos &amp; videos. (Make a folder from
            Home → Drop Box first.)
          </p>
        </Field>
        <EventTargetPicker value={eventTarget} onChange={setEventTarget} />
        <p className="px-0.5 text-xs text-foreground/50">
          The whole event on the resort calendar (e.g. Family Fest week itself, or Work Weekend) —
          this only controls who <em>sees</em> the callout (RSVP &ldquo;can&rsquo;t make it&rdquo; hides
          it), separate from the activity link above.
        </p>
      </div>
      <Field label="Title (optional)">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. T-shirt orders due soon" className={`${FIELD} w-full`} />
      </Field>
      <Field label="Body (optional)">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${FIELD} w-full resize-none`} />
      </Field>
      <Field label="Image (optional)">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Callout" className="max-h-40 w-full rounded-xl object-contain ring-1 ring-border" />
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
        <div className={`flex items-center gap-2 ${imageUrl ? "mt-2" : ""}`}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="press rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {uploading ? "Uploading…" : imageUrl ? "Replace photo" : "Add a photo"}
          </button>
          {imageUrl && (
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              disabled={uploading}
              className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-accent ring-1 ring-border disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        {uploadError && (
          <p className="mt-2 rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
            {uploadError}
          </p>
        )}
      </Field>
      <Field label="Button links (optional)">
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="space-y-1.5 rounded-xl bg-background p-2.5 ring-1 ring-border">
              <div className="flex items-center gap-2">
                <input
                  value={l.href}
                  onChange={(e) => updateLink(i, { href: e.target.value })}
                  placeholder="tel:7155550123"
                  className={`${FIELD} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  aria-label="Remove link"
                  className="press shrink-0 text-foreground/40 hover:text-accent"
                >
                  ✕
                </button>
              </div>
              <input
                value={l.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
                placeholder="Button label, e.g. 📞 Call Tricia to order"
                className={`${FIELD} w-full`}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLink}
          className="press mt-2 text-xs font-semibold text-primary"
        >
          + Add another link
        </button>
        <p className="mt-1.5 px-0.5 text-xs text-foreground/50">
          <code>tel:</code> (call), <code>mailto:</code> (email), and <code>https://</code> (website) links all work.
          Each link shows on its own line — add a second one for e.g. two separate order forms.
        </p>
      </Field>
      <Field label="Show from (optional)">
        <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={`${FIELD} w-full`} />
      </Field>
      <Field label="Show through (optional)">
        <input type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} className={`${FIELD} w-full`} />
      </Field>
      {!validRange && <p className="text-xs text-accent">&ldquo;Show through&rdquo; must be on or after &ldquo;show from&rdquo;.</p>}
      <Field label="Deadline (optional)">
        <input type="datetime-local" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} className={`${FIELD} w-full`} />
        <p className="mt-1.5 px-0.5 text-xs text-foreground/50">
          The actual due-by moment (e.g. "order by Friday 5pm") — separate from the show
          window above. Reminders below count down to this.
        </p>
      </Field>
      {draft && (
        <ReminderScheduler
          sourceType="callout"
          sourceId={draft.id}
          sourceLabel={title.trim() || draft.title?.trim() || "this callout"}
          anchor={deadlineAt ? { ms: new Date(deadlineAt).getTime(), hasTime: true } : null}
          defaultTitle={title.trim() ? `Reminder: ${title.trim()}` : undefined}
          eventId={eventTarget.eventId}
        />
      )}
      <Field label="Dismiss id">
        <input
          value={effectiveDismissId}
          onChange={(e) => { setDismissTouched(true); setDismissId(e.target.value); }}
          className={`${FIELD} w-full`}
        />
        <p className="mt-1.5 px-0.5 text-xs text-foreground/50">
          Swiping a card away hides it by this id for the rest of that person&rsquo;s session.
          Change it (a new date works) to bring an updated card back for everyone.
        </p>
      </Field>
      <Field label="Position (lower shows first)">
        <input
          value={position}
          inputMode="numeric"
          onChange={(e) => setPosition(e.target.value.replace(/[^0-9]/g, ""))}
          className={`${FIELD} w-full`}
        />
      </Field>
      <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
        <span className="text-sm">Active (shown on Home)</span>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
      </label>

      {/* One-time side actions, reviewed right here before saving — no
          separate trip to Alerts & Notifications needed. Both default off
          every time this sheet opens (not a property of the callout itself). */}
      <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={alsoNotify} onChange={(e) => setAlsoNotify(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
          <span className="font-medium">🔔 Also send a notification</span>
        </label>
        {alsoNotify && (
          <input
            value={notifyText}
            onChange={(e) => setNotifyText(e.target.value)}
            placeholder='Short headline, e.g. "T-shirt orders due Friday!"'
            className={`${FIELD} w-full`}
          />
        )}
      </div>
      <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={alsoEmail} onChange={(e) => setAlsoEmail(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
          <span className="font-medium">✉️ Also email everyone who opted in</span>
        </label>
        {alsoEmail && (
          <textarea
            value={effectiveEmailText}
            onChange={(e) => { setEmailTouched(true); setEmailText(e.target.value); }}
            rows={3}
            placeholder="Email message"
            className={`${FIELD} w-full resize-none`}
          />
        )}
      </div>

      {hasContent && (
        <Field label="Preview">
          <CalloutCard
            callout={preview}
            signupEnabled={signupItemId ? !!activityOptions.find((e) => e.id === signupItemId)?.signupEnabled : false}
          />
        </Field>
      )}
    </Sheet>
  );
}
