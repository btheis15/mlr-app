"use client";

// Sign-up slots on a schedule event OR an "anytime" activity (migrations
// 0135/0136 for schedule events, 0138 for activities). Shown wherever the item's
// details render (FestWeek's EventRow/ActivityCard, FestStatus's TodayEvent, the
// schedule detail page). Two modes: derived interval slots, or the creator's own
// arbitrary list of slots. Each slot holds up to N people; each person is one
// row — a linked member or a typed name — plus a value for every custom column
// the creator defined. ANY signed-in member can add anyone, and add several.
// `kind` selects the schedule- vs activity-backed tables/RPCs (lib/scheduleSignups).

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { PrivateName } from "@/components/Guard";
import { Sheet } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { MemberPickerSheet } from "@/components/FestPlanner";
import { fetchMemberOptions, type FestMemberOption } from "@/lib/festContent";
import {
  resolveSlotViews,
  fetchScheduleSignups,
  fetchScheduleSlots,
  fetchScheduleSignupCounts,
  signUpForSlot,
  removeScheduleSignup,
  sendSlotReminderNow,
  type ScheduleSignup,
  type ScheduleSlot,
  type SlotView,
  type SignupTarget,
  type SignupKind,
} from "@/lib/scheduleSignups";
import type { SignupField } from "@/lib/types";

/** `capacity: null` (headcount mode with no cap set) ⇒ never full, shown as
 *  a plain count with no "/Y". */
function isFull(count: number, capacity: number | null): boolean {
  return capacity != null && count >= capacity;
}
function capacityLabel(count: number, capacity: number | null): string {
  return capacity != null ? `${count}/${capacity}` : String(count);
}

// The manual send deliberately has NO lead-time picker. It used to offer
// chips ("Starts in 15 min" / "30 min" / …) whose label became the
// notification's wording verbatim — so picking the wrong one told everyone a
// lead time that had nothing to do with the slot's real time (see migration
// 0165). A manual nudge now always just states the slot's actual day + time,
// resolved server-side from the stored value, so there's nothing to pick.

export function ScheduleSignupSlots({
  target,
  kind = "schedule",
  canManage,
  members,
}: {
  target: SignupTarget;
  /** Which flavor: a schedule event or an anytime activity. Defaults to schedule. */
  kind?: SignupKind;
  /** Can act on ANY row (remove other people's sign-ups) — the same predicate
   *  as the edit affordance: can_edit_fest() OR this item's lead/crew. */
  canManage: boolean;
  members: FestMemberOption[];
}) {
  const { userId, promptSignIn } = useIdentity();
  const [signups, setSignups] = useState<ScheduleSignup[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [memberOptions, setMemberOptions] = useState<FestMemberOption[]>(members);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);

  const fields: SignupField[] = target.signupFields ?? [];
  // Names hidden from THIS viewer (migration 0167) — a regular member never
  // sees anyone else's name (RLS blocks the row entirely; their own entry, if
  // any, still comes through). An organizer/crew member CAN see everyone —
  // RLS lets their fetch through — but defaults to hiding it from themselves
  // too, so running a "surprise" event doesn't spoil it for them until they
  // deliberately tap Show participants. `revealed` is per-mount only (not
  // persisted) so re-opening this card starts hidden again.
  const namesHidden = Boolean(target.signupHideNames) && !canManage;
  const canRevealNames = Boolean(target.signupHideNames) && canManage;
  const [revealed, setRevealed] = useState(false);
  const managerHiding = canRevealNames && !revealed;

  const reload = useCallback(async () => {
    const [s, sl, c] = await Promise.all([
      fetchScheduleSignups(kind, target.id),
      target.signupMode === "slots" ? fetchScheduleSlots(kind, target.id) : Promise.resolve([]),
      namesHidden ? fetchScheduleSignupCounts(kind, target.id) : Promise.resolve({}),
    ]);
    setSignups(s);
    setSlots(sl);
    setCounts(c);
  }, [kind, target.id, target.signupMode, namesHidden]);
  useEffect(() => {
    void reload();
  }, [reload]);
  // Keep the seed fresh if the editor's member list arrives after mount.
  useEffect(() => {
    if (members.length) setMemberOptions((prev) => (prev.length ? prev : members));
  }, [members]);

  const slotViews = resolveSlotViews(target, slots);
  if (!slotViews.length) return null;

  const runAction = async (key: string, action: () => Promise<{ error?: string }>) => {
    setBusyKey(key);
    setError(null);
    const { error } = await action();
    if (error) setError(error);
    else await reload();
    setBusyKey(null);
    return !error;
  };

  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
          {target.signupMode === "headcount" ? "Sign up" : "Sign up for a time slot"}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Organizer/crew chose to hide names from THEMSELVES too — this is
              the deliberate "I'm ready to peek" action (see canRevealNames above). */}
          {canRevealNames && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="press rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent"
            >
              {revealed ? "🙈 Hide again" : "👀 Show participants"}
            </button>
          )}
          {/* Organizer/crew get a consolidated view of every slot + row in one
              place — hidden until revealed, same as the inline names below. */}
          {canManage && !managerHiding && (
            <button
              type="button"
              onClick={() => setRosterOpen(true)}
              className="press rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
            >
              📋 View all
            </button>
          )}
        </div>
      </div>
      {target.signupInstructions?.trim() && (
        <p className="whitespace-pre-line rounded-xl bg-background px-3 py-2 text-xs leading-relaxed text-foreground/70 ring-1 ring-border/60">
          {target.signupInstructions.trim()}
        </p>
      )}
      {namesHidden && (
        <p className="rounded-xl bg-background px-3 py-2 text-xs text-foreground/60 ring-1 ring-border/60">
          🙈 Who&rsquo;s signed up is a surprise — you&rsquo;ll see the headcount and your own spot, not everyone&rsquo;s
          name.
        </p>
      )}
      {managerHiding && (
        <p className="rounded-xl bg-background px-3 py-2 text-xs text-foreground/60 ring-1 ring-border/60">
          🙈 You&rsquo;re keeping this one a surprise for yourself too — tap &ldquo;Show participants&rdquo; above when
          you&rsquo;re ready to see who&rsquo;s signed up.
        </p>
      )}
      <div className="space-y-2">
        {slotViews.map((view) => (
          <SlotCard
            key={view.key}
            view={view}
            signups={signups.filter((s) => view.matches(s))}
            displayCount={namesHidden ? counts[view.key] ?? 0 : undefined}
            suppressNames={managerHiding}
            fields={fields}
            teamSize={target.signupTeamSize && target.signupTeamSize > 1 ? target.signupTeamSize : 1}
            userId={userId}
            canManage={canManage}
            busy={busyKey === view.key}
            members={memberOptions}
            ensureMembers={async () => {
              if (memberOptions.length) return;
              const m = await fetchMemberOptions();
              setMemberOptions(m);
            }}
            onJoin={() =>
              userId
                ? void runAction(view.key, () =>
                    signUpForSlot(kind, target.id, { slotId: view.slotId, slotStart: view.slotId ? null : view.slotStart }),
                  )
                : promptSignIn()
            }
            onAdd={(payload) =>
              runAction(view.key, () =>
                signUpForSlot(kind, target.id, {
                  slotId: view.slotId,
                  slotStart: view.slotId ? null : view.slotStart,
                  forUserId: payload.forUserId,
                  name: payload.forUserId ? undefined : payload.name,
                  fields: payload.fields,
                }),
              )
            }
            onAddTeam={(payload) =>
              runAction(view.key, () =>
                signUpForSlot(kind, target.id, {
                  slotId: view.slotId,
                  slotStart: view.slotId ? null : view.slotStart,
                  teamMembers: payload.members,
                  teamName: payload.teamName,
                }),
              )
            }
            onRemove={(id) => void runAction(view.key, () => removeScheduleSignup(kind, id))}
            onNotify={
              canManage
                ? (minutes, email) =>
                    sendSlotReminderNow(kind, target.id, {
                      slotId: view.slotId,
                      slotStart: view.slotId ? null : view.slotStart,
                      minutes,
                      email,
                    })
                : undefined
            }
            requireSignIn={promptSignIn}
          />
        ))}
      </div>
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
      {rosterOpen && (
        <SignupRosterSheet slotViews={slotViews} signups={signups} fields={fields} onClose={() => setRosterOpen(false)} />
      )}
    </div>
  );
}

/** The organizer/crew's "everything in one place" view — every slot, every
 *  person, and every custom-column value, as a scannable table. */
function SignupRosterSheet({
  slotViews,
  signups,
  fields,
  onClose,
}: {
  slotViews: SlotView[];
  signups: ScheduleSignup[];
  fields: SignupField[];
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const total = signups.length;
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="signup-roster"
      header={
        <div id="signup-roster">
          <h2 className="text-lg font-bold">All sign-ups</h2>
          <p className="text-xs text-foreground/50">
            {total} {total === 1 ? "person" : "people"}
            {/* Headcount mode is one label-less bucket — no slots to count. */}
            {slotViews.some((v) => v.label)
              ? ` across ${slotViews.length} ${slotViews.length === 1 ? "slot" : "slots"}`
              : " signed up"}
          </p>
        </div>
      }
    >
      <div className="space-y-4">
        {slotViews.map((view) => {
          const rows = signups.filter((s) => view.matches(s));
          return (
            <div key={view.key} className="rounded-2xl bg-card ring-1 ring-border">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                <p className="text-sm font-semibold">{view.label || "Everyone signed up"}</p>
                <span className={`text-xs ${isFull(rows.length, view.capacity) ? "text-accent" : "text-foreground/50"}`}>
                  {capacityLabel(rows.length, view.capacity)}
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="px-3 py-2 text-xs text-foreground/45">No one yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-foreground/50">
                        <th className="px-3 py-1.5 font-medium">#</th>
                        <th className="px-3 py-1.5 font-medium">Name</th>
                        {rows.some((s) => s.teamId) && <th className="px-3 py-1.5 font-medium">Team</th>}
                        {fields.map((f) => (
                          <th key={f.id} className="px-3 py-1.5 font-medium">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s, i) => (
                        <tr key={s.id} className="border-t border-border/50 align-top">
                          <td className="px-3 py-1.5 text-foreground/40">{i + 1}</td>
                          <td className="px-3 py-1.5 font-medium">
                            <PrivateName name={s.name} />
                          </td>
                          {rows.some((r) => r.teamId) && (
                            <td className="px-3 py-1.5 text-foreground/70">
                              {s.teamId ? s.teamName?.trim() || "Team" : "—"}
                            </td>
                          )}
                          {fields.map((f) => (
                            <td key={f.id} className="px-3 py-1.5 text-foreground/70">
                              {s.fields?.[f.id]?.trim() || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Groups a slot's flat signup rows by team_id (migration 0143) — a solo
 *  sign-up is its own one-member "group" so the render below doesn't need a
 *  separate code path. */
interface SignupGroup {
  key: string;
  teamId: string | null;
  teamName: string | null;
  members: ScheduleSignup[];
}
function groupSignups(signups: ScheduleSignup[]): SignupGroup[] {
  const groups: SignupGroup[] = [];
  const indexByTeam = new Map<string, number>();
  for (const s of signups) {
    if (s.teamId) {
      const idx = indexByTeam.get(s.teamId);
      if (idx != null) {
        groups[idx].members.push(s);
        continue;
      }
      indexByTeam.set(s.teamId, groups.length);
      groups.push({ key: s.teamId, teamId: s.teamId, teamName: s.teamName, members: [s] });
    } else {
      groups.push({ key: s.id, teamId: null, teamName: null, members: [s] });
    }
  }
  return groups;
}

function SlotCard({
  view,
  signups,
  displayCount,
  suppressNames,
  fields,
  teamSize,
  userId,
  canManage,
  busy,
  members,
  ensureMembers,
  onJoin,
  onAdd,
  onAddTeam,
  onRemove,
  onNotify,
  requireSignIn,
}: {
  view: SlotView;
  /** RLS-visible rows only — when `namesHidden`, that's just the viewer's own
   *  entry (if any), never the full slot. */
  signups: ScheduleSignup[];
  /** The real headcount for this slot when `namesHidden` (from the counts
   *  RPC, which isn't row-limited by RLS) — falls back to `signups.length`
   *  when undefined. */
  displayCount?: number;
  /** The organizer chose to hide names, incl. from themselves, and hasn't
   *  tapped "Show participants" yet (migration 0167) — render the count only,
   *  never the roster below. */
  suppressNames?: boolean;
  fields: SignupField[];
  /** ≥2 ⇒ every sign-up here is a fixed-size team (migration 0143); 1 (or
   *  unset) ⇒ the original one-person-per-row behavior, unchanged. */
  teamSize: number;
  userId: string | null;
  canManage: boolean;
  busy: boolean;
  members: FestMemberOption[];
  ensureMembers: () => Promise<void>;
  onJoin: () => void;
  onAdd: (payload: { forUserId?: string; name: string; fields: Record<string, string> }) => Promise<boolean>;
  onAddTeam: (payload: { teamName: string; members: TeamMemberInput[] }) => Promise<boolean>;
  onRemove: (id: string) => void;
  /** Manual "your time is soon" send for this one slot (migration 0158/0159) —
   *  undefined when the viewer can't manage this item's sign-ups. */
  onNotify?: (minutes: number | null, email: boolean) => Promise<{ error?: string; count?: number }>;
  requireSignIn: () => void;
}) {
  // Headcount mode (migration 0143) has no time dimension at all — it's the
  // item's single "no slot" bucket, so "slot" wording is meaningless there and
  // the copy talks about the activity itself instead. Same predicate
  // resolveSlotViews() uses to build that bucket, so the two can't drift.
  const timed = Boolean(view.slotId || view.slotStart);
  const [adding, setAdding] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyResult, setNotifyResult] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(false);
  // The real count when names are hidden (from the counts RPC) — `signups`
  // itself is RLS-limited to just the viewer's own row(s) in that case, so it
  // can't be used for the badge/capacity math below.
  const count = displayCount ?? signups.length;
  const full = isFull(count, view.capacity);
  const spotsLeft = view.capacity != null ? view.capacity - count : Infinity;
  const roomForTeam = spotsLeft >= teamSize;
  const mine = userId ? signups.some((s) => s.userId === userId) : false;
  const hasFields = fields.length > 0;
  const groups = groupSignups(signups);
  // A manager hiding names from themselves still needs to know THEY signed
  // up (same guarantee a regular member already gets — RLS only ever hands
  // them their own row) — so their own entry always renders even while
  // suppressed; only everyone else's stays behind "Show participants."
  const groupsToRender = suppressNames ? groups.filter((g) => g.members.some((m) => m.userId === userId)) : groups;
  const hiddenGroupCount = suppressNames ? groups.length - groupsToRender.length : 0;

  return (
    <div className="rounded-xl bg-background p-2.5 ring-1 ring-border/60">
      {view.label && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{view.label}</p>
          <span className={`text-xs ${full ? "text-accent" : "text-foreground/50"}`}>
            {capacityLabel(count, view.capacity)} filled
          </span>
        </div>
      )}
      {!view.label && count > 0 && (
        <div className="flex items-center justify-end">
          <span className={`text-xs ${full ? "text-accent" : "text-foreground/50"}`}>
            {capacityLabel(count, view.capacity)} signed up
          </span>
        </div>
      )}

      {onNotify && groups.length > 0 && (
        <div className="mt-1.5">
          {!notifyOpen ? (
            <button
              type="button"
              onClick={() => {
                setNotifyOpen(true);
                setNotifyResult(null);
              }}
              className="press rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent"
            >
              {timed ? "🔔 Notify this slot" : "🔔 Notify everyone"}
            </button>
          ) : (
            <div className="rounded-lg bg-accent/5 p-2 ring-1 ring-accent/20">
              <p className="mb-1.5 text-[11px] font-medium text-foreground/60">
                {timed
                  ? `Remind everyone in this slot when it starts${view.label ? ` (${view.label})` : ""}.`
                  : "Remind everyone signed up that this is starting."}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={notifyBusy}
                  onClick={async () => {
                    setNotifyBusy(true);
                    setNotifyResult(null);
                    const { error, count } = await onNotify(null, notifyEmail);
                    setNotifyBusy(false);
                    setNotifyResult(error ? error : `✓ Sent to ${count} ${count === 1 ? "person" : "people"}`);
                    if (!error) setTimeout(() => setNotifyOpen(false), 1500);
                  }}
                  className="press rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50"
                >
                  {notifyBusy ? "Sending…" : "Send reminder"}
                </button>
                <button
                  type="button"
                  onClick={() => setNotifyOpen(false)}
                  className="press rounded-full px-2 py-1 text-[11px] font-medium text-foreground/50"
                >
                  Cancel
                </button>
              </div>
              <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-foreground/60">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border text-accent"
                />
                Also email anyone signed up with an account
              </label>
              {notifyResult && <p className="mt-1.5 text-[11px] font-medium text-accent">{notifyResult}</p>}
            </div>
          )}
        </div>
      )}

      {groupsToRender.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {groupsToRender.map((g) => (
            <li key={g.key} className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
              {g.teamId && (
                <p className="mb-1 font-semibold uppercase tracking-wide text-primary/70">
                  🤝 {g.teamName?.trim() || "Team"}
                </p>
              )}
              <div className="space-y-1">
                {g.members.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        <PrivateName name={s.name} />
                      </p>
                      {fields.length > 0 && (
                        <p className="mt-0.5 text-primary/70">
                          {fields.map((f) => `${f.label}: ${s.fields?.[f.id]?.trim() || "—"}`).join(" · ")}
                        </p>
                      )}
                    </div>
                    {(s.userId === userId || s.addedBy === userId || canManage) && (
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        disabled={busy}
                        aria-label={`Remove ${s.name}`}
                        className="press mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-primary/70 hover:text-primary"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hiddenGroupCount > 0 && (
        <p className="mt-1.5 text-xs italic text-foreground/45">
          {groupsToRender.length > 0 ? "+ " : ""}
          {hiddenGroupCount} more hidden until you tap &ldquo;Show participants.&rdquo;
        </p>
      )}

      {!full && roomForTeam && !adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Fast self-join only for an individual sign-up with no extra columns. */}
          {teamSize <= 1 && !mine && !hasFields && (
            <button
              type="button"
              onClick={onJoin}
              disabled={busy}
              className="press rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary disabled:opacity-50"
            >
              {!userId ? "Sign in to join" : timed ? "+ Join this slot" : "+ Join activity"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!userId) {
                requireSignIn();
                return;
              }
              setAdding(true);
            }}
            disabled={busy}
            className="press rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground/70 ring-1 ring-border disabled:opacity-50"
          >
            {teamSize > 1 ? `+ Sign up a team of ${teamSize}` : hasFields ? "+ Sign up" : "+ Add someone"}
          </button>
        </div>
      )}
      {!full && !roomForTeam && (
        <p className="mt-2 text-xs text-foreground/45">Not enough spots left for a full team.</p>
      )}

      {adding && teamSize > 1 && (
        <TeamSignupForm
          teamSize={teamSize}
          fields={fields}
          members={members}
          myUserId={userId}
          ensureMembers={ensureMembers}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (payload) => {
            const ok = await onAddTeam(payload);
            if (ok) setAdding(false);
          }}
        />
      )}
      {adding && teamSize <= 1 && (
        <AddSignupForm
          fields={fields}
          members={members}
          myUserId={userId}
          ensureMembers={ensureMembers}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (payload) => {
            const ok = await onAdd(payload);
            if (ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddSignupForm({
  fields,
  members,
  myUserId,
  ensureMembers,
  busy,
  onCancel,
  onSubmit,
}: {
  fields: SignupField[];
  members: FestMemberOption[];
  myUserId: string | null;
  ensureMembers: () => Promise<void>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: { forUserId?: string; name: string; fields: Record<string, string> }) => void;
}) {
  const [name, setName] = useState("");
  const [forUserId, setForUserId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);

  const setField = (id: string, v: string) => setValues((prev) => ({ ...prev, [id]: v }));
  const allFieldsFilled = fields.every((f) => (values[f.id] ?? "").trim());
  const canSubmit = name.trim().length > 0 && allFieldsFilled && !busy;

  const linkMember = (m: FestMemberOption) => {
    setForUserId(m.id);
    setName(m.name);
    setPicking(false);
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl bg-card p-2.5 ring-1 ring-border">
      <div>
        <span className="mb-1 block text-[11px] font-medium text-foreground/50">Who&rsquo;s signing up</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setForUserId(null); // typing over a linked pick unlinks it
          }}
          placeholder="Type a name"
          autoFocus
          className="w-full rounded-lg bg-background px-2.5 py-1.5 text-sm ring-1 ring-border"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {forUserId && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              🔗 linked account
            </span>
          )}
          <button
            type="button"
            onClick={async () => {
              await ensureMembers();
              setPicking(true);
            }}
            className="press rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-foreground/70 ring-1 ring-border"
          >
            Link a member
          </button>
          {myUserId && (
            <button
              type="button"
              onClick={() => {
                const me = members.find((m) => m.id === myUserId);
                setForUserId(myUserId);
                setName(me?.name ?? "Me");
              }}
              className="press rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-foreground/70 ring-1 ring-border"
            >
              It&rsquo;s me
            </button>
          )}
        </div>
      </div>

      {fields.map((f) => (
        <label key={f.id} className="block">
          <span className="mb-1 block text-[11px] font-medium text-foreground/50">{f.label}</span>
          <input
            value={values[f.id] ?? ""}
            onChange={(e) => setField(f.id, e.target.value)}
            placeholder={f.label}
            className="w-full rounded-lg bg-background px-2.5 py-1.5 text-sm ring-1 ring-border"
          />
        </label>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit({ forUserId: forUserId ?? undefined, name: name.trim(), fields: values })}
          disabled={!canSubmit}
          className="press rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Add to slot
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="press rounded-lg px-2 text-xs font-medium text-foreground/50"
        >
          Cancel
        </button>
      </div>

      {picking && (
        <MemberPickerSheet members={members} onPick={linkMember} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

interface TeamMemberInput {
  forUserId?: string;
  name: string;
  fields: Record<string, string>;
}

/** Commits a whole team (migration 0143) in one submission — one name/link
 *  picker per member, plus an optional team name, sharing one team_id server-
 *  side. Mirrors AddSignupForm's picker, repeated `teamSize` times. */
function TeamSignupForm({
  teamSize,
  fields,
  members,
  myUserId,
  ensureMembers,
  busy,
  onCancel,
  onSubmit,
}: {
  teamSize: number;
  fields: SignupField[];
  members: FestMemberOption[];
  myUserId: string | null;
  ensureMembers: () => Promise<void>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: { teamName: string; members: TeamMemberInput[] }) => void;
}) {
  const [teamName, setTeamName] = useState("");
  const [names, setNames] = useState<string[]>(() => Array(teamSize).fill(""));
  const [forUserIds, setForUserIds] = useState<(string | null)[]>(() => Array(teamSize).fill(null));
  const [values, setValues] = useState<Record<string, string>[]>(() => Array.from({ length: teamSize }, () => ({})));
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);

  const setField = (i: number, id: string, v: string) =>
    setValues((prev) => prev.map((row, j) => (j === i ? { ...row, [id]: v } : row)));
  const allFieldsFilled = values.every((row) => fields.every((f) => (row[f.id] ?? "").trim()));
  const canSubmit = names.every((n) => n.trim()) && allFieldsFilled && !busy;

  const linkMember = (i: number, m: FestMemberOption) => {
    setForUserIds((prev) => prev.map((id, j) => (j === i ? m.id : id)));
    setNames((prev) => prev.map((n, j) => (j === i ? m.name : n)));
    setPickingIndex(null);
  };

  return (
    <div className="mt-2 space-y-3 rounded-xl bg-card p-2.5 ring-1 ring-border">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-foreground/50">Team name (optional)</span>
        <input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="e.g. The Sharks"
          className="w-full rounded-lg bg-background px-2.5 py-1.5 text-sm ring-1 ring-border"
        />
      </label>

      {Array.from({ length: teamSize }, (_, i) => (
        <div key={i} className="space-y-2 rounded-lg bg-background p-2 ring-1 ring-border/60">
          <span className="mb-1 block text-[11px] font-medium text-foreground/50">Person {i + 1}</span>
          <input
            value={names[i]}
            onChange={(e) => {
              setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)));
              setForUserIds((prev) => prev.map((id, j) => (j === i ? null : id))); // typing over a link unlinks it
            }}
            placeholder="Type a name"
            className="w-full rounded-lg bg-card px-2.5 py-1.5 text-sm ring-1 ring-border"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {forUserIds[i] && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                🔗 linked account
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                await ensureMembers();
                setPickingIndex(i);
              }}
              className="press rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-foreground/70 ring-1 ring-border"
            >
              Link a member
            </button>
            {myUserId && !forUserIds.includes(myUserId) && (
              <button
                type="button"
                onClick={() => {
                  const me = members.find((m) => m.id === myUserId);
                  setForUserIds((prev) => prev.map((id, j) => (j === i ? myUserId : id)));
                  setNames((prev) => prev.map((n, j) => (j === i ? me?.name ?? "Me" : n)));
                }}
                className="press rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-foreground/70 ring-1 ring-border"
              >
                It&rsquo;s me
              </button>
            )}
          </div>
          {fields.map((f) => (
            <label key={f.id} className="block">
              <span className="mb-1 block text-[11px] font-medium text-foreground/50">{f.label}</span>
              <input
                value={values[i]?.[f.id] ?? ""}
                onChange={(e) => setField(i, f.id, e.target.value)}
                placeholder={f.label}
                className="w-full rounded-lg bg-card px-2.5 py-1.5 text-sm ring-1 ring-border"
              />
            </label>
          ))}
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            onSubmit({
              teamName: teamName.trim(),
              members: names.map((n, i) => ({ forUserId: forUserIds[i] ?? undefined, name: n.trim(), fields: values[i] ?? {} })),
            })
          }
          disabled={!canSubmit}
          className="press rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Sign up team
        </button>
        <button type="button" onClick={onCancel} className="press rounded-lg px-2 text-xs font-medium text-foreground/50">
          Cancel
        </button>
      </div>

      {pickingIndex != null && (
        <MemberPickerSheet
          members={members}
          onPick={(m) => linkMember(pickingIndex, m)}
          onClose={() => setPickingIndex(null)}
        />
      )}
    </div>
  );
}
