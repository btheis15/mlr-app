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
import {
  fetchCallouts,
  saveCallout,
  deleteCallout,
  type HomeCallout,
  type CalloutLink,
} from "@/lib/festContent";

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
  const [dismissId, setDismissId] = useState(draft?.dismissId ?? "");
  // Auto-suggest the dismiss id (slug + date) until the editor types their own.
  const [dismissTouched, setDismissTouched] = useState(Boolean(draft));
  const [active, setActive] = useState(draft?.isActive ?? true);
  const [position, setPosition] = useState(String(draft?.position ?? nextPosition));
  const [eventTarget, setEventTarget] = useState<EventTarget>({
    eventId: draft?.eventId ?? null,
    excludeNotAttending: draft?.excludeNotAttending ?? true,
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  };

  const hasContent = Boolean(title.trim() || body.trim() || imageUrl);
  const validRange = !startsOn || !endsOn || endsOn >= startsOn;
  const canSave = hasContent && effectiveDismissId.trim().length > 0 && validRange && !save.pending && !uploading;
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
      });
      if (error) return error;
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
      <EventTargetPicker value={eventTarget} onChange={setEventTarget} />
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
      {hasContent && (
        <Field label="Preview">
          <CalloutCard callout={preview} />
        </Field>
      )}
    </Sheet>
  );
}
