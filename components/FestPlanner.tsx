"use client";

// Family Fest Planner — the in-app, form-style editor for the shared fest
// content (migration 0053). Gated to can_edit_fest() (app admin OR a member of
// the family-fest committee). Mirrors the iOS FamilyFestPlannerView: list →
// add/edit (bottom sheet) → delete, for the Schedule, Dinners, Dues, Payees,
// Activities, and the fest Details (name/tagline/dates). Saves write straight
// to Supabase (RLS-gated) and both apps re-read, so web and iOS stay in
// lockstep. The Home call-out cards (migration 0083) used to live here too —
// moved to Admin → Alerts & Notifications (AdminCallouts), since a call-out
// isn't necessarily fest-specific.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { BackLink } from "@/components/BackLink";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { useSheetDismiss, useSaveStatus } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";
import { useFestContent } from "@/lib/useFestContent";
import { formatDate, formatDateLong, formatTime, toTimeInputValue } from "@/lib/format";
import {
  fetchAppImages,
  siteImageSrc,
  uploadSiteImage,
  saveAppImage,
  resetAppImage,
} from "@/lib/appImages";
import {
  canEditFest,
  fetchMemberOptions,
  fetchScheduleDrafts,
  fetchDinnerDrafts,
  fetchPayeeDrafts,
  fetchDuesDrafts,
  fetchActivityDrafts,
  saveScheduleItem,
  deleteScheduleItem,
  saveDinner,
  deleteDinner,
  savePayee,
  deletePayee,
  saveDuesTier,
  deleteDuesTier,
  saveActivity,
  deleteActivity,
  saveConfig,
  type FestMemberOption,
  type ScheduleDraft,
  type DinnerDraft,
  type PayeeDraft,
  type DuesDraft,
  type ActivityDraft,
} from "@/lib/festContent";

type Section = "schedule" | "dinners" | "dues" | "payees" | "activities" | "details" | "images";

const SECTIONS: { key: Section; label: string; icon: string }[] = [
  { key: "schedule", label: "Schedule", icon: "📅" },
  { key: "dinners", label: "Dinners", icon: "🍽️" },
  { key: "dues", label: "Dues", icon: "💵" },
  { key: "payees", label: "Payees", icon: "💸" },
  { key: "activities", label: "Anytime", icon: "🗺️" },
  { key: "images", label: "Images", icon: "🖼️" },
  { key: "details", label: "Details", icon: "⚙️" },
];

/** The fest's ISO days, derived from the config window (DST/TZ-safe). */
function festDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let d = startDate;
  for (let i = 0; d <= endDate && i < 366; i++) {
    out.push(d);
    const nx = new Date(`${d}T00:00:00`);
    nx.setDate(nx.getDate() + 1);
    d = nx.toISOString().slice(0, 10);
  }
  return out;
}

/** Trim a text field → null when empty (so updates blank the DB column). */
const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export function FestPlanner({ variant = "tabs" }: { variant?: "tabs" | "page" }) {
  const { user, promptSignIn } = useIdentity();
  const { config, reload: reloadContent } = useFestContent({ realtime: true });
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [section, setSection] = useState<Section>("schedule");
  // True while consuming an iOS → web session hand-off (tokens in the URL hash),
  // so we wait for the silent sign-in instead of flashing the sign-in prompt.
  const [handoff, setHandoff] = useState(false);

  // Silent session hand-off from the iOS app: it opens this page with the
  // member's Supabase tokens in the URL fragment so there's no second sign-in.
  // Read them once, establish the session, and strip them from the URL/history.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.includes("mlr_at=")) return;
    const p = new URLSearchParams(hash.slice(1));
    const at = p.get("mlr_at");
    const rt = p.get("mlr_rt");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (at && rt && supabase) {
      setHandoff(true);
      supabase.auth
        .setSession({ access_token: at, refresh_token: rt })
        .finally(() => setHandoff(false));
    }
  }, []);

  const [schedule, setSchedule] = useState<ScheduleDraft[]>([]);
  const [dinners, setDinners] = useState<DinnerDraft[]>([]);
  const [dues, setDues] = useState<DuesDraft[]>([]);
  const [payees, setPayees] = useState<PayeeDraft[]>([]);
  const [activities, setActivities] = useState<ActivityDraft[]>([]);

  const reloadDrafts = useCallback(async () => {
    const [s, d, du, p, a] = await Promise.all([
      fetchScheduleDrafts(),
      fetchDinnerDrafts(),
      fetchDuesDrafts(),
      fetchPayeeDrafts(),
      fetchActivityDrafts(),
    ]);
    setSchedule(s);
    setDinners(d);
    setDues(du);
    setPayees(p);
    setActivities(a);
    await reloadContent();
  }, [reloadContent]);

  useEffect(() => {
    let active = true;
    if (!user) {
      // Don't show "signed out" while a session hand-off is still resolving.
      if (!handoff) setAllowed(false);
      return;
    }
    canEditFest().then((ok) => {
      if (!active) return;
      setAllowed(ok);
      if (ok) {
        void reloadDrafts();
        fetchMemberOptions().then((m) => active && setMembers(m));
      }
    });
    return () => {
      active = false;
    };
  }, [user, handoff, reloadDrafts]);

  const days = festDays(config.startDate, config.endDate);

  if (allowed === null) {
    return <Frame variant={variant}><p className="py-12 text-center text-sm text-foreground/50">Checking access…</p></Frame>;
  }
  if (!allowed) {
    // Signed out (e.g. opened in Safari from the iOS app, which keeps a separate
    // login) → prompt to sign in here rather than implying they lack access.
    if (!user) {
      return (
        <Frame variant={variant}>
          <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
            <p className="text-3xl">🔑</p>
            <p className="mt-2 text-sm font-semibold">Sign in to edit Family Fest</p>
            <p className="mt-1 text-xs text-foreground/60">
              The website keeps its own sign-in, separate from the iOS app. Sign in here once
              (it&rsquo;ll stay signed in on this browser) to edit.
            </p>
            <button
              type="button"
              onClick={promptSignIn}
              className="press mt-4 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"
            >
              Sign in
            </button>
          </div>
        </Frame>
      );
    }
    return (
      <Frame variant={variant}>
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">🔒</p>
          <p className="mt-2 text-sm font-semibold">Editing is for fest organizers</p>
          <p className="mt-1 text-xs text-foreground/60">
            The Family Fest Planner is open to app admins and members of the Family Fest committee.
            Ask an admin to add you to the committee if you should have access.
          </p>
        </div>
      </Frame>
    );
  }

  // Master/desktop variant: every section stacked on one long page (no tabs),
  // each under a heading — the "edit one master sheet" feel.
  if (variant === "page") {
    return (
      <Frame variant="page">
        <PageSection icon="⚙️" title="Details">
          <DetailsEditor config={config} onChanged={reloadDrafts} />
        </PageSection>
        <PageSection icon="📅" title="Schedule & events">
          <ScheduleEditor items={schedule} days={days} members={members} onChanged={reloadDrafts} />
        </PageSection>
        <PageSection icon="🍽️" title="Dinners">
          <DinnerEditor items={dinners} days={days} members={members} onChanged={reloadDrafts} />
        </PageSection>
        <PageSection icon="💵" title="Dues">
          <DuesEditor items={dues} onChanged={reloadDrafts} />
        </PageSection>
        <PageSection icon="💸" title="Who to pay">
          <PayeeEditor items={payees} onChanged={reloadDrafts} />
        </PageSection>
        <PageSection icon="🗺️" title="Anytime activities">
          <ActivityEditor items={activities} members={members} onChanged={reloadDrafts} />
        </PageSection>
        <PageSection icon="🖼️" title="Images">
          <ImagesEditor />
        </PageSection>
      </Frame>
    );
  }

  return (
    <Frame variant={variant}>
      {/* Section nav */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`press shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                section === s.key
                  ? "bg-primary text-white ring-primary"
                  : "bg-primary/10 text-primary ring-primary/25"
              }`}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </div>

      {section === "schedule" && (
        <ScheduleEditor items={schedule} days={days} members={members} onChanged={reloadDrafts} />
      )}
      {section === "dinners" && (
        <DinnerEditor items={dinners} days={days} members={members} onChanged={reloadDrafts} />
      )}
      {section === "dues" && <DuesEditor items={dues} onChanged={reloadDrafts} />}
      {section === "payees" && <PayeeEditor items={payees} onChanged={reloadDrafts} />}
      {section === "activities" && <ActivityEditor items={activities} members={members} onChanged={reloadDrafts} />}
      {section === "images" && <ImagesEditor />}
      {section === "details" && <DetailsEditor config={config} onChanged={reloadDrafts} />}
    </Frame>
  );
}

function Frame({ children, variant = "tabs" }: { children: React.ReactNode; variant?: "tabs" | "page" }) {
  // Master/desktop variant: a full-window, document-style editor that breaks out
  // of the app's narrow phone column and tab bar — so it reads like editing one
  // master sheet, not navigating the app. Wide, centered, its own scroll.
  if (variant === "page") {
    return (
      // z-[50]: below the shared Sheet's z-[60] (Sheet.tsx) — this page is its
      // own full-viewport `fixed` overlay, so without a lower z-index here the
      // "＋ Add an event"/dinner/dues/activity sheets it opens would paint
      // behind this opaque background and look like the buttons do nothing.
      <div className="fixed inset-0 z-[50] overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
          <header className="mb-8 flex items-start justify-between gap-4 border-b border-border pb-5">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Family Fest — Master Editor</h1>
              <p className="text-sm text-foreground/60">
                Everything in one place. Edits save straight to the database and sync to the app and iOS instantly.
              </p>
            </div>
            <Link
              href="/family-fest"
              className="press shrink-0 rounded-full bg-card px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-border"
            >
              Done
            </Link>
          </header>
          <div className="space-y-12">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Family Fest Planner</h1>
        <p className="text-sm text-foreground/60">
          Edit what everyone sees — changes sync to the web app and iOS instantly.
        </p>
      </header>
      {children}
    </div>
  );
}

/** A titled block in the master/page editor. */
function PageSection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold tracking-tight">
        <span className="mr-2" aria-hidden>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── shared list scaffolding ───────────────────────────────────────────────────

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

/** Confirm + run a delete, then refresh. Kept tiny — window.confirm is fine for
 *  an admin-only destructive action. */
async function confirmDelete(label: string, run: () => Promise<{ error?: string }>, onChanged: () => void) {
  if (typeof window !== "undefined" && !window.confirm(`Delete ${label}? This can't be undone.`)) return;
  const { error } = await run();
  if (error) {
    window.alert(error);
    return;
  }
  onChanged();
}

// ── Schedule ──────────────────────────────────────────────────────────────────

function ScheduleEditor({
  items,
  days,
  members,
  onChanged,
}: {
  items: ScheduleDraft[];
  days: string[];
  members: FestMemberOption[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ScheduleDraft | "new" | null>(null);

  return (
    <div className="space-y-3">
      <AddButton label="Add an event" onClick={() => setEditing("new")} />
      {days.map((day) => {
        const dayItems = items.filter((i) => i.day === day);
        if (!dayItems.length) return null;
        return (
          <div key={day} className="space-y-2">
            <SectionLabel>{formatDateLong(day)}</SectionLabel>
            {dayItems.map((it) => (
              <RowCard
                key={it.id}
                title={`${it.emoji ?? ""} ${it.title}`.trim()}
                subtitle={[it.startTime ? formatTime(it.startTime) : "Time TBD", it.location || "Location TBD"].join(" · ")}
                onEdit={() => setEditing(it)}
                onDelete={() => confirmDelete(it.title, () => deleteScheduleItem(it.id), onChanged)}
              />
            ))}
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="rounded-2xl bg-card p-4 text-center text-xs text-foreground/55 ring-1 ring-border">
          No events yet — add the week&rsquo;s headline activities.
        </p>
      )}

      {editing && (
        <ScheduleSheet
          draft={editing === "new" ? null : editing}
          days={days}
          members={members}
          nextPosition={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Exported so FestWeek's admin/committee edit affordance can reuse the exact
 *  same full editor in place, instead of duplicating it — see migration 0099 /
 *  the chef-crew self-edit feature this sits alongside. */
export function ScheduleSheet({
  draft,
  days,
  members,
  nextPosition,
  onClose,
  onSaved,
}: {
  draft: ScheduleDraft | null;
  days: string[];
  members: FestMemberOption[];
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [day, setDay] = useState(draft?.day ?? days[0] ?? "");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [emoji, setEmoji] = useState(draft?.emoji ?? "");
  const [hasTime, setHasTime] = useState(Boolean(draft?.startTime));
  const [startTime, setStartTime] = useState(toTimeInputValue(draft?.startTime));
  const [endTime, setEndTime] = useState(toTimeInputValue(draft?.endTime));
  const [location, setLocation] = useState(draft?.location ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [bring, setBring] = useState(draft?.bring ?? "");
  const [isPrivate, setIsPrivate] = useState(draft?.isPrivate ?? false);
  const [leadUserId, setLeadUserId] = useState<string | null>(draft?.leadUserId ?? null);
  const [leadName, setLeadName] = useState(draft?.leadName ?? "");
  const [leadPhone, setLeadPhone] = useState(draft?.leadPhone ?? "");
  const [crewUserIds, setCrewUserIds] = useState<string[]>(draft?.crewUserIds ?? []);
  const [picking, setPicking] = useState(false);
  const [pickingCrew, setPickingCrew] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(draft?.imageUrl ?? null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState(draft?.linkUrl ?? "");
  const [linkLabel, setLinkLabel] = useState(draft?.linkLabel ?? "");
  const [signupEnabled, setSignupEnabled] = useState(draft?.signupEnabled ?? false);
  const [signupCapacity, setSignupCapacity] = useState(String(draft?.signupCapacity ?? 4));
  const [signupSlotMinutes, setSignupSlotMinutes] = useState(String(draft?.signupSlotMinutes ?? 60));
  const [signupStartTime, setSignupStartTime] = useState(toTimeInputValue(draft?.signupStartTime) || "12:00");
  const [signupEndTime, setSignupEndTime] = useState(toTimeInputValue(draft?.signupEndTime) || "16:00");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const signupValid =
    !signupEnabled ||
    (Number(signupCapacity) > 0 &&
      Number(signupSlotMinutes) > 0 &&
      signupStartTime.length > 0 &&
      signupEndTime.length > 0 &&
      signupStartTime < signupEndTime);
  const canSave = title.trim().length > 0 && day.length > 0 && signupValid && !save.pending;

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageBusy(true);
    setImageError(null);
    try {
      setImageUrl(await uploadSiteImage(file, `schedule/${draft?.id ?? crypto.randomUUID()}`));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setImageBusy(false);
    }
  };

  const submit = () =>
    save.run(async () => {
      const { error } = await saveScheduleItem({
        id: draft?.id,
        day,
        startTime: hasTime ? orNull(startTime) : null,
        endTime: hasTime ? orNull(endTime) : null,
        title: title.trim(),
        emoji: orNull(emoji),
        location: orNull(location),
        description: orNull(description),
        bring: orNull(bring),
        isPrivate,
        leadUserId,
        leadName: orNull(leadName),
        leadPhone: orNull(leadPhone),
        crewUserIds,
        position: draft?.position ?? nextPosition,
        imageUrl,
        linkUrl: orNull(linkUrl),
        linkLabel: orNull(linkLabel),
        signupEnabled,
        signupCapacity: signupEnabled ? Number(signupCapacity) : null,
        signupSlotMinutes: signupEnabled ? Number(signupSlotMinutes) : null,
        signupStartTime: signupEnabled ? signupStartTime : null,
        signupEndTime: signupEnabled ? signupEndTime : null,
      });
      if (error) return error;
      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="sched-sheet"
      header={<h2 id="sched-sheet" className="text-lg font-bold">{draft ? "✏️ Edit event" : "📅 New event"}</h2>}
      footer={<SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} />}
    >
      <Field label="Day">
        <select value={day} onChange={(e) => setDay(e.target.value)} className={`${FIELD} w-full`}>
          {days.map((d) => (
            <option key={d} value={d}>{formatDateLong(d)}</option>
          ))}
        </select>
      </Field>

      <Field label="Event">
        <div className="flex gap-2">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="🏅" aria-label="Emoji" className={`${FIELD} w-14 text-center`} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lake Day" className={`${FIELD} min-w-0 flex-1`} />
        </div>
      </Field>

      <Field label="Time">
        <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
          <span className="text-sm">Set a time</span>
          <input type="checkbox" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
        </label>
        {hasTime && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" className={FIELD} />
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time (optional)" className={FIELD} />
          </div>
        )}
      </Field>

      <Field label="Location">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where (leave blank for TBD)" className={`${FIELD} w-full`} />
      </Field>

      <LeadPicker
        title="Who's in charge"
        members={members}
        userId={leadUserId}
        name={leadName}
        phone={leadPhone}
        onPick={() => setPicking(true)}
        onClear={() => { setLeadUserId(null); setLeadName(""); }}
        onName={setLeadName}
        onPhone={setLeadPhone}
      />

      <Field label="Crew members (also get editing rights for this event)">
        {crewUserIds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {crewUserIds.map((id) => {
              const m = members.find((x) => x.id === id);
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary">
                  {m?.name ?? "Member"}
                  <button
                    type="button"
                    onClick={() => setCrewUserIds((prev) => prev.filter((x) => x !== id))}
                    aria-label={`Remove ${m?.name ?? "member"} from crew`}
                    className="press flex h-4 w-4 items-center justify-center rounded-full text-primary/70 hover:text-primary"
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setPickingCrew(true)}
          disabled={members.length === 0}
          className="press w-full rounded-xl bg-card px-3 py-2.5 text-left text-sm ring-1 ring-border disabled:opacity-50"
        >
          + Add a crew member…
        </button>
      </Field>

      <Field label="Details">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What it is, when to arrive…" className={`${FIELD} w-full resize-none`} />
      </Field>

      <Field label="What to bring (optional)">
        <input value={bring} onChange={(e) => setBring(e.target.value)} placeholder="e.g. swimsuit & towel" className={`${FIELD} w-full`} />
      </Field>

      <Field label="Photo (optional)">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="mb-2 max-h-40 w-full rounded-xl object-cover" />
        )}
        <input ref={imageInputRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={imageBusy}
            className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-primary ring-1 ring-border disabled:opacity-50"
          >
            {imageBusy ? "Uploading…" : imageUrl ? "Replace photo" : "Add a photo"}
          </button>
          {imageUrl && (
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-accent ring-1 ring-border"
            >
              Remove
            </button>
          )}
        </div>
        {imageError && <p className="mt-1 text-xs font-medium text-accent">{imageError}</p>}
      </Field>

      <Field label="Link (optional)">
        <p className="mb-1.5 text-xs text-foreground/50">
          A Google Doc/Sheet, sign-up form, or any web page for this event.
        </p>
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className={`${FIELD} mb-2 w-full`}
        />
        <input
          value={linkLabel}
          onChange={(e) => setLinkLabel(e.target.value)}
          placeholder="Button text, e.g. Sign up sheet"
          className={`${FIELD} w-full`}
        />
      </Field>

      <Field label="Limited sign-up">
        <label className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-sm">Take sign-ups for time slots</span>
            <span className="block text-xs text-foreground/50">e.g. 4 people per slot, every hour from noon to 4pm</span>
          </span>
          <input
            type="checkbox"
            checked={signupEnabled}
            onChange={(e) => setSignupEnabled(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
        {signupEnabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-foreground/50">People per slot</span>
                <input
                  type="number"
                  min={1}
                  value={signupCapacity}
                  onChange={(e) => setSignupCapacity(e.target.value)}
                  className={`${FIELD} w-full`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-foreground/50">Minutes per slot</span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={signupSlotMinutes}
                  onChange={(e) => setSignupSlotMinutes(e.target.value)}
                  className={`${FIELD} w-full`}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-foreground/50">First slot starts</span>
                <input
                  type="time"
                  value={signupStartTime}
                  onChange={(e) => setSignupStartTime(e.target.value)}
                  className={FIELD}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-foreground/50">Last slot ends by</span>
                <input
                  type="time"
                  value={signupEndTime}
                  onChange={(e) => setSignupEndTime(e.target.value)}
                  className={FIELD}
                />
              </label>
            </div>
            {!signupValid && (
              <p className="text-xs font-medium text-accent">End time must be after the start time.</p>
            )}
          </div>
        )}
      </Field>

      <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
        <span className="min-w-0">
          <span className="text-sm font-medium">Private</span>
          <span className="block text-xs text-foreground/50">Hide location/details from signed-out guests.</span>
        </span>
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
      </label>

      {picking && (
        <MemberPickerSheet
          members={members}
          onPick={(m) => { setLeadUserId(m.id); setLeadName(m.name); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
      {pickingCrew && (
        <CrewPickerSheet
          members={members}
          selected={new Set(crewUserIds)}
          onToggle={(id) => setCrewUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          onClose={() => setPickingCrew(false)}
        />
      )}
    </Sheet>
  );
}

// ── Dinners ───────────────────────────────────────────────────────────────────

function DinnerEditor({
  items,
  days,
  members,
  onChanged,
}: {
  items: DinnerDraft[];
  days: string[];
  members: FestMemberOption[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<DinnerDraft | "new" | null>(null);
  return (
    <div className="space-y-3">
      <AddButton label="Add a dinner" onClick={() => setEditing("new")} />
      {items.map((d) => (
        <RowCard
          key={d.id}
          title={`${d.emoji ?? "🍽️"} ${d.title}`.trim()}
          subtitle={`${formatDateLong(d.day)} · Chef: ${d.chefName || "TBD"}`}
          onEdit={() => setEditing(d)}
          onDelete={() => confirmDelete(d.title, () => deleteDinner(d.id), onChanged)}
        />
      ))}
      {items.length === 0 && (
        <p className="rounded-2xl bg-card p-4 text-center text-xs text-foreground/55 ring-1 ring-border">No dinners yet.</p>
      )}
      {editing && (
        <DinnerSheet
          draft={editing === "new" ? null : editing}
          days={days}
          members={members}
          nextPosition={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

/** Exported so FestWeek's admin/committee edit affordance can reuse the exact
 *  same full editor (day/title/chef/crew/houses/menu/served/prep) in place —
 *  see migration 0099. Chef/crew self-editors (not full fest access) instead
 *  get the narrower DinnerDetailsEditSheet there. */
export function DinnerSheet({
  draft,
  days,
  members,
  nextPosition,
  onClose,
  onSaved,
}: {
  draft: DinnerDraft | null;
  days: string[];
  members: FestMemberOption[];
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [day, setDay] = useState(draft?.day ?? days[0] ?? "");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [emoji, setEmoji] = useState(draft?.emoji ?? "🍽️");
  const [chefUserId, setChefUserId] = useState<string | null>(draft?.chefUserId ?? null);
  const [chefName, setChefName] = useState(draft?.chefName ?? "");
  const [chefPhone, setChefPhone] = useState(draft?.chefPhone ?? "");
  const [crewUserIds, setCrewUserIds] = useState<string[]>(draft?.crewUserIds ?? []);
  const [pickingCrew, setPickingCrew] = useState(false);
  const [houses, setHouses] = useState((draft?.houses ?? []).join(", "));
  const [menu, setMenu] = useState(draft?.menu ?? "");
  const [servedTime, setServedTime] = useState(toTimeInputValue(draft?.servedTime));
  const [servedLocation, setServedLocation] = useState(draft?.servedLocation ?? "");
  const [prepTime, setPrepTime] = useState(toTimeInputValue(draft?.prepTime));
  const [prepLocation, setPrepLocation] = useState(draft?.prepLocation ?? "");
  const [picking, setPicking] = useState(false);

  // Default the title to "{Day} Dinner" once a day is chosen and title is blank.
  useEffect(() => {
    if (!title.trim() && day) {
      const wd = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
      setTitle(`${wd} Dinner`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const canSave = title.trim().length > 0 && day.length > 0 && !save.pending;
  const submit = () =>
    save.run(async () => {
      const { error } = await saveDinner({
        id: draft?.id,
        day,
        title: title.trim(),
        emoji: orNull(emoji),
        chefUserId,
        chefName: orNull(chefName),
        chefPhone: orNull(chefPhone),
        crewUserIds,
        houses: houses.split(",").map((h) => h.trim()).filter(Boolean),
        menu: orNull(menu),
        servedTime: orNull(servedTime),
        servedLocation: orNull(servedLocation),
        prepTime: orNull(prepTime),
        prepLocation: orNull(prepLocation),
        position: draft?.position ?? nextPosition,
      });
      if (error) return error;
      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="dinner-sheet"
      header={<h2 id="dinner-sheet" className="text-lg font-bold">{draft ? "✏️ Edit dinner" : "🍽️ New dinner"}</h2>}
      footer={<SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} />}
    >
      <Field label="Day">
        <select value={day} onChange={(e) => setDay(e.target.value)} className={`${FIELD} w-full`}>
          {days.map((d) => <option key={d} value={d}>{formatDateLong(d)}</option>)}
        </select>
      </Field>
      <Field label="Title">
        <div className="flex gap-2">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} aria-label="Emoji" className={`${FIELD} w-14 text-center`} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
        </div>
      </Field>

      <LeadPicker
        title="Head chef"
        members={members}
        userId={chefUserId}
        name={chefName}
        phone={chefPhone}
        onPick={() => setPicking(true)}
        onClear={() => { setChefUserId(null); setChefName(""); }}
        onName={setChefName}
        onPhone={setChefPhone}
      />

      <Field label="Crew members (also get editing rights for this dinner)">
        {crewUserIds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {crewUserIds.map((id) => {
              const m = members.find((x) => x.id === id);
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary">
                  {m?.name ?? "Member"}
                  <button
                    type="button"
                    onClick={() => setCrewUserIds((prev) => prev.filter((x) => x !== id))}
                    aria-label={`Remove ${m?.name ?? "member"} from crew`}
                    className="press flex h-4 w-4 items-center justify-center rounded-full text-primary/70 hover:text-primary"
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setPickingCrew(true)}
          disabled={members.length === 0}
          className="press w-full rounded-xl bg-card px-3 py-2.5 text-left text-sm ring-1 ring-border disabled:opacity-50"
        >
          + Add a crew member…
        </button>
      </Field>
      <Field label="Houses on crew (comma-separated)">
        <input value={houses} onChange={(e) => setHouses(e.target.value)} placeholder="e.g. Theis, Birkholz" className={`${FIELD} w-full`} />
      </Field>
      <Field label="Menu">
        <textarea value={menu} onChange={(e) => setMenu(e.target.value)} rows={2} placeholder="What's cooking (blank = TBD)" className={`${FIELD} w-full resize-none`} />
      </Field>
      <Field label="Served">
        <div className="grid grid-cols-2 gap-2">
          <input type="time" value={servedTime} onChange={(e) => setServedTime(e.target.value)} aria-label="Served time" className={FIELD} />
          <input value={servedLocation} onChange={(e) => setServedLocation(e.target.value)} placeholder="Location" className={FIELD} />
        </div>
      </Field>
      <Field label="Prep">
        <div className="grid grid-cols-2 gap-2">
          <input type="time" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} aria-label="Prep time" className={FIELD} />
          <input value={prepLocation} onChange={(e) => setPrepLocation(e.target.value)} placeholder="Location" className={FIELD} />
        </div>
      </Field>

      {picking && (
        <MemberPickerSheet
          members={members}
          onPick={(m) => { setChefUserId(m.id); setChefName(m.name); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
      {pickingCrew && (
        <CrewPickerSheet
          members={members}
          selected={new Set(crewUserIds)}
          onToggle={(id) => setCrewUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          onClose={() => setPickingCrew(false)}
        />
      )}
    </Sheet>
  );
}

// ── Dues ──────────────────────────────────────────────────────────────────────

function DuesEditor({ items, onChanged }: { items: DuesDraft[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<DuesDraft | "new" | null>(null);
  return (
    <div className="space-y-3">
      <AddButton label="Add a dues tier" onClick={() => setEditing("new")} />
      {items.map((t) => (
        <RowCard
          key={t.id}
          title={t.label}
          subtitle={`${t.amount != null ? `$${t.amount}${t.perDay ? "/day" : ""}` : "TBD"}${t.note ? ` · ${t.note}` : ""}`}
          onEdit={() => setEditing(t)}
          onDelete={() => confirmDelete(t.label, () => deleteDuesTier(t.id), onChanged)}
        />
      ))}
      {editing && (
        <DuesSheet
          draft={editing === "new" ? null : editing}
          nextPosition={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function DuesSheet({
  draft,
  nextPosition,
  onClose,
  onSaved,
}: {
  draft: DuesDraft | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [label, setLabel] = useState(draft?.label ?? "");
  const [amount, setAmount] = useState(draft?.amount != null ? String(draft.amount) : "");
  const [note, setNote] = useState(draft?.note ?? "");
  const [perDay, setPerDay] = useState(draft?.perDay ?? false);

  const canSave = label.trim().length > 0 && !save.pending;
  const submit = () =>
    save.run(async () => {
      const parsed = amount.trim() ? parseInt(amount.replace(/[^0-9]/g, ""), 10) : null;
      const { error } = await saveDuesTier({
        id: draft?.id,
        label: label.trim(),
        amount: Number.isFinite(parsed as number) ? (parsed as number) : null,
        note: orNull(note),
        perDay,
        position: draft?.position ?? nextPosition,
      });
      if (error) return error;
      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="dues-sheet"
      header={<h2 id="dues-sheet" className="text-lg font-bold">{draft ? "✏️ Edit tier" : "💵 New tier"}</h2>}
      footer={<SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} />}
    >
      <Field label="Label">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Adult (high school & up)" className={`${FIELD} w-full`} />
      </Field>
      <Field label="Amount (leave blank for TBD)">
        <div className="flex items-center rounded-xl bg-card px-3 ring-1 ring-border focus-within:ring-2 focus-within:ring-primary">
          <span className="text-sm text-foreground/50">$</span>
          <input value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="TBD" className="w-full bg-transparent px-1 py-2.5 text-sm outline-none" />
        </div>
      </Field>
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. per person" className={`${FIELD} w-full`} />
      </Field>
      <label className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
        <span className="text-sm">Billed per day (multiply by days attending)</span>
        <input type="checkbox" checked={perDay} onChange={(e) => setPerDay(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
      </label>
    </Sheet>
  );
}

// ── Payees ────────────────────────────────────────────────────────────────────

function PayeeEditor({ items, onChanged }: { items: PayeeDraft[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<PayeeDraft | "new" | null>(null);
  return (
    <div className="space-y-3">
      <AddButton label="Add a payee" onClick={() => setEditing("new")} />
      {items.map((p) => (
        <RowCard
          key={p.id}
          title={p.name}
          subtitle={p.role || [p.venmo && "Venmo", p.zelle && "Zelle", p.applecash && "Apple Cash", p.paypal && "PayPal"].filter(Boolean).join(" · ")}
          onEdit={() => setEditing(p)}
          onDelete={() => confirmDelete(p.name, () => deletePayee(p.id), onChanged)}
        />
      ))}
      {editing && (
        <PayeeSheet
          draft={editing === "new" ? null : editing}
          nextPosition={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function PayeeSheet({
  draft,
  nextPosition,
  onClose,
  onSaved,
}: {
  draft: PayeeDraft | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [name, setName] = useState(draft?.name ?? "");
  const [role, setRole] = useState(draft?.role ?? "");
  const [venmo, setVenmo] = useState(draft?.venmo ?? "");
  const [zelle, setZelle] = useState(draft?.zelle ?? "");
  const [applecash, setApplecash] = useState(draft?.applecash ?? "");
  const [paypal, setPaypal] = useState(draft?.paypal ?? "");
  const [note, setNote] = useState(draft?.note ?? "");

  const canSave = name.trim().length > 0 && !save.pending;
  const submit = () =>
    save.run(async () => {
      const { error } = await savePayee({
        id: draft?.id,
        name: name.trim(),
        role: orNull(role),
        venmo: orNull(venmo),
        zelle: orNull(zelle),
        applecash: orNull(applecash),
        paypal: orNull(paypal),
        note: orNull(note),
        position: draft?.position ?? nextPosition,
      });
      if (error) return error;
      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="payee-sheet"
      header={<h2 id="payee-sheet" className="text-lg font-bold">{draft ? "✏️ Edit payee" : "💸 New payee"}</h2>}
      footer={<SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} />}
    >
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <Field label="Role / label"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Family Fest dues" className={`${FIELD} w-full`} /></Field>
      <Field label="Venmo (username, no @)"><input value={venmo} onChange={(e) => setVenmo(e.target.value)} placeholder="Cathy-Hofer-1" className={`${FIELD} w-full`} /></Field>
      <Field label="Zelle (phone or email)"><input value={zelle} onChange={(e) => setZelle(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <Field label="Apple Cash (phone or email)"><input value={applecash} onChange={(e) => setApplecash(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <Field label="PayPal (paypal.me handle or email)"><input value={paypal} onChange={(e) => setPaypal(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className={`${FIELD} w-full`} /></Field>
    </Sheet>
  );
}

// ── Activities ────────────────────────────────────────────────────────────────

function ActivityEditor({
  items,
  members,
  onChanged,
}: {
  items: ActivityDraft[];
  members: FestMemberOption[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ActivityDraft | "new" | null>(null);
  return (
    <div className="space-y-3">
      <AddButton label="Add an anytime activity" onClick={() => setEditing("new")} />
      {items.map((a) => (
        <RowCard
          key={a.id}
          title={`${a.emoji ?? ""} ${a.title}`.trim()}
          subtitle={a.blurb ?? undefined}
          onEdit={() => setEditing(a)}
          onDelete={() => confirmDelete(a.title, () => deleteActivity(a.id), onChanged)}
        />
      ))}
      {editing && (
        <ActivitySheet
          draft={editing === "new" ? null : editing}
          members={members}
          nextPosition={items.length}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

export function ActivitySheet({
  draft,
  members,
  nextPosition,
  onClose,
  onSaved,
}: {
  draft: ActivityDraft | null;
  members: FestMemberOption[];
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const save = useSaveStatus();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [emoji, setEmoji] = useState(draft?.emoji ?? "🗺️");
  const [blurb, setBlurb] = useState(draft?.blurb ?? "");
  const [details, setDetails] = useState(draft?.details ?? "");
  const [location, setLocation] = useState(draft?.location ?? "");
  const [leadUserId, setLeadUserId] = useState<string | null>(draft?.leadUserId ?? null);
  const [leadName, setLeadName] = useState(draft?.leadName ?? "");
  const [leadPhone, setLeadPhone] = useState(draft?.leadPhone ?? "");
  const [crewUserIds, setCrewUserIds] = useState<string[]>(draft?.crewUserIds ?? []);
  const [picking, setPicking] = useState(false);
  const [pickingCrew, setPickingCrew] = useState(false);

  const canSave = title.trim().length > 0 && !save.pending;
  const submit = () =>
    save.run(async () => {
      const { error } = await saveActivity({
        id: draft?.id,
        title: title.trim(),
        emoji: orNull(emoji),
        blurb: orNull(blurb),
        details: orNull(details),
        location: orNull(location),
        leadUserId,
        leadName: orNull(leadName),
        leadPhone: orNull(leadPhone),
        crewUserIds,
        position: draft?.position ?? nextPosition,
      });
      if (error) return error;
      onSaved();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="act-sheet"
      header={<h2 id="act-sheet" className="text-lg font-bold">{draft ? "✏️ Edit activity" : "🗺️ New activity"}</h2>}
      footer={<SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} />}
    >
      <Field label="Title">
        <div className="flex gap-2">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} aria-label="Emoji" className={`${FIELD} w-14 text-center`} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
        </div>
      </Field>
      <Field label="Blurb (one-liner)"><input value={blurb} onChange={(e) => setBlurb(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <Field label="Details (optional)"><textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} className={`${FIELD} w-full resize-none`} /></Field>
      <Field label="Where to start (optional)"><input value={location} onChange={(e) => setLocation(e.target.value)} className={`${FIELD} w-full`} /></Field>

      <LeadPicker
        title="Who's in charge"
        members={members}
        userId={leadUserId}
        name={leadName}
        phone={leadPhone}
        onPick={() => setPicking(true)}
        onClear={() => { setLeadUserId(null); setLeadName(""); }}
        onName={setLeadName}
        onPhone={setLeadPhone}
      />

      <Field label="Crew members (also get editing rights for this activity)">
        {crewUserIds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {crewUserIds.map((id) => {
              const m = members.find((x) => x.id === id);
              return (
                <span key={id} className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary">
                  {m?.name ?? "Member"}
                  <button
                    type="button"
                    onClick={() => setCrewUserIds((prev) => prev.filter((x) => x !== id))}
                    aria-label={`Remove ${m?.name ?? "member"} from crew`}
                    className="press flex h-4 w-4 items-center justify-center rounded-full text-primary/70 hover:text-primary"
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setPickingCrew(true)}
          disabled={members.length === 0}
          className="press w-full rounded-xl bg-card px-3 py-2.5 text-left text-sm ring-1 ring-border disabled:opacity-50"
        >
          + Add a crew member…
        </button>
      </Field>

      {picking && (
        <MemberPickerSheet
          members={members}
          onPick={(m) => { setLeadUserId(m.id); setLeadName(m.name); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
      {pickingCrew && (
        <CrewPickerSheet
          members={members}
          selected={new Set(crewUserIds)}
          onToggle={(id) => setCrewUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          onClose={() => setPickingCrew(false)}
        />
      )}
    </Sheet>
  );
}

// ── Images (logo, fest cover) ─────────────────────────────────────────────────

function ImagesEditor() {
  const [map, setMap] = useState<Record<string, string>>({});
  const reload = useCallback(async () => setMap(await fetchAppImages()), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const items = [
    { key: "home_logo", title: "Home logo", note: "Shown at the top of the Home screen.", wide: false },
    { key: "fest_cover", title: "Family Fest cover", note: "The banner across the Family Fest page.", wide: true },
  ];

  return (
    <div className="space-y-4">
      <p className="px-0.5 text-xs text-foreground/55">
        Replace a default image everywhere — web and iOS update together. Reset goes back to the built-in art.
      </p>
      {items.map((it) => (
        <ImageRow
          key={it.key}
          imageKey={it.key}
          title={it.title}
          note={it.note}
          wide={it.wide}
          src={siteImageSrc(map, it.key)}
          hasCustom={Boolean(map[it.key])}
          onChanged={reload}
        />
      ))}
    </div>
  );
}

function ImageRow({
  imageKey,
  title,
  note,
  wide,
  src,
  hasCustom,
  onChanged,
}: {
  imageKey: string;
  title: string;
  note: string;
  wide: boolean;
  src: string;
  hasCustom: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadSiteImage(file, imageKey);
      const { error: saveErr } = await saveAppImage(imageKey, url);
      if (saveErr) throw new Error(saveErr);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    const { error: resetErr } = await resetAppImage(imageKey);
    if (resetErr) setError(resetErr);
    else onChanged();
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <p className="text-sm font-semibold">{title}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={title}
        className={`w-full rounded-xl object-contain ${wide ? "max-h-48" : "max-h-28"}`}
      />
      <p className="text-xs text-foreground/55">{note}</p>
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="press rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Uploading…" : hasCustom ? "Replace photo" : "Change photo"}
        </button>
        {hasCustom && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-accent ring-1 ring-border disabled:opacity-50"
          >
            Reset
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Details (config) ──────────────────────────────────────────────────────────

function DetailsEditor({
  config,
  onChanged,
}: {
  config: { name: string; tagline: string; startDate: string; endDate: string };
  onChanged: () => void;
}) {
  const save = useSaveStatus();
  const [name, setName] = useState(config.name);
  const [tagline, setTagline] = useState(config.tagline);
  const [startDate, setStartDate] = useState(config.startDate);
  const [endDate, setEndDate] = useState(config.endDate);

  // Keep the form in sync if the live config arrives after first paint.
  useEffect(() => {
    setName(config.name);
    setTagline(config.tagline);
    setStartDate(config.startDate);
    setEndDate(config.endDate);
  }, [config.name, config.tagline, config.startDate, config.endDate]);

  const validRange = endDate >= startDate;
  const canSave = name.trim().length > 0 && startDate.length > 0 && endDate.length > 0 && validRange && !save.pending;
  const submit = () =>
    save.run(async () => {
      const { error } = await saveConfig({ name: name.trim(), tagline: orNull(tagline), startDate, endDate });
      if (error) return error;
      onChanged();
      return "Saved.";
    });

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <Field label="Fest name"><input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <Field label="Tagline"><input value={tagline} onChange={(e) => setTagline(e.target.value)} className={`${FIELD} w-full`} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${FIELD} w-full`} /></Field>
        <Field label="End"><input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={`${FIELD} w-full`} /></Field>
      </div>
      {!validRange && <p className="text-xs text-accent">End date must be on or after the start.</p>}
      <p className="text-xs text-foreground/50">Changing the dates reshapes the week — the day pickers and countdown follow these.</p>
      <SaveBar status={save.status} disabled={!canSave} pending={save.pending} onSave={submit} label="Save details" />
    </div>
  );
}

// ── small shared bits ─────────────────────────────────────────────────────────

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

/** The "who's in charge" / chef block: link a real member (tap-to-call from
 *  their card) OR type a name + phone for someone not in the app. */
function LeadPicker({
  title,
  members,
  userId,
  name,
  phone,
  onPick,
  onClear,
  onName,
  onPhone,
}: {
  title: string;
  members: FestMemberOption[];
  userId: string | null;
  name: string;
  phone: string;
  onPick: () => void;
  onClear: () => void;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
}) {
  const linked = userId ? members.find((m) => m.id === userId) : null;
  return (
    <Field label={title}>
      {userId ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2.5 ring-1 ring-primary/25">
          <span className="truncate text-sm font-medium text-primary">🔗 {linked?.name ?? (name || "Linked member")}</span>
          <button onClick={onClear} className="press text-xs font-semibold text-accent">Unlink</button>
        </div>
      ) : (
        <>
          <button onClick={onPick} disabled={members.length === 0} className="press w-full rounded-xl bg-card px-3 py-2.5 text-left text-sm ring-1 ring-border disabled:opacity-50">
            🔗 Link a member…
          </button>
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="…or type a name (not in the app)" className={`${FIELD} mt-2 w-full`} />
        </>
      )}
      <input value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="Phone (optional, for tap-to-call)" className={`${FIELD} mt-2 w-full`} />
    </Field>
  );
}

/** Exported so ScheduleSignupSlots can reuse it for "add a member to this
 *  slot" instead of duplicating a search-and-pick list. */
export function MemberPickerSheet({
  members,
  onPick,
  onClose,
}: {
  members: FestMemberOption[];
  onPick: (m: FestMemberOption) => void;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [q, setQ] = useState("");
  const filtered = q.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
    : members;
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="member-picker"
      header={<h2 id="member-picker" className="text-lg font-bold">Link a member</h2>}
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className={`${FIELD} w-full`} />
      <ul className="space-y-1">
        {filtered.map((m) => (
          <li key={m.id}>
            <button onClick={() => onPick(m)} className="press flex w-full items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-left ring-1 ring-border">
              <span className="text-sm font-medium">{m.name}</span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="py-6 text-center text-xs text-foreground/50">No members found.</li>}
      </ul>
    </Sheet>
  );
}

/** Multi-select variant of MemberPickerSheet — toggles rather than picking
 *  once-and-close, for the "Crew members" list (migration 0099): each one
 *  added also gets editing rights on this dinner, alongside the head chef. */
function CrewPickerSheet({
  members,
  selected,
  onToggle,
  onClose,
}: {
  members: FestMemberOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const [q, setQ] = useState("");
  const filtered = q.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
    : members;
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="crew-picker"
      header={<h2 id="crew-picker" className="text-lg font-bold">Add crew members</h2>}
      footer={
        <button onClick={close} className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white">
          Done
        </button>
      }
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className={`${FIELD} w-full`} />
      <ul className="space-y-1">
        {filtered.map((m) => {
          const on = selected.has(m.id);
          return (
            <li key={m.id}>
              <button
                onClick={() => onToggle(m.id)}
                aria-pressed={on}
                className={`press flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ${on ? "bg-primary/10 ring-primary/30" : "bg-card ring-border"}`}
              >
                <span className="text-sm font-medium">{m.name}</span>
                {on && <span aria-hidden>✓</span>}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="py-6 text-center text-xs text-foreground/50">No members found.</li>}
      </ul>
    </Sheet>
  );
}
