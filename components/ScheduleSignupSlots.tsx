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
  signUpForSlot,
  removeScheduleSignup,
  type ScheduleSignup,
  type ScheduleSlot,
  type SlotView,
  type SignupTarget,
  type SignupKind,
} from "@/lib/scheduleSignups";
import type { SignupField } from "@/lib/types";

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
  const [memberOptions, setMemberOptions] = useState<FestMemberOption[]>(members);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);

  const fields: SignupField[] = target.signupFields ?? [];

  const reload = useCallback(async () => {
    const [s, sl] = await Promise.all([
      fetchScheduleSignups(kind, target.id),
      target.signupMode === "slots" ? fetchScheduleSlots(kind, target.id) : Promise.resolve([]),
    ]);
    setSignups(s);
    setSlots(sl);
  }, [kind, target.id, target.signupMode]);
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
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Sign up for a time slot</p>
        {/* Organizer/crew get a consolidated view of every slot + row in one place. */}
        {canManage && (
          <button
            type="button"
            onClick={() => setRosterOpen(true)}
            className="press shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
          >
            📋 View all
          </button>
        )}
      </div>
      {target.signupInstructions?.trim() && (
        <p className="whitespace-pre-line rounded-xl bg-background px-3 py-2 text-xs leading-relaxed text-foreground/70 ring-1 ring-border/60">
          {target.signupInstructions.trim()}
        </p>
      )}
      <div className="space-y-2">
        {slotViews.map((view) => (
          <SlotCard
            key={view.key}
            view={view}
            signups={signups.filter((s) => view.matches(s))}
            fields={fields}
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
            onRemove={(id) => void runAction(view.key, () => removeScheduleSignup(kind, id))}
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
            {total} {total === 1 ? "person" : "people"} across {slotViews.length}{" "}
            {slotViews.length === 1 ? "slot" : "slots"}
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
                <p className="text-sm font-semibold">{view.label}</p>
                <span className={`text-xs ${rows.length >= view.capacity ? "text-accent" : "text-foreground/50"}`}>
                  {rows.length}/{view.capacity}
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

function SlotCard({
  view,
  signups,
  fields,
  userId,
  canManage,
  busy,
  members,
  ensureMembers,
  onJoin,
  onAdd,
  onRemove,
  requireSignIn,
}: {
  view: SlotView;
  signups: ScheduleSignup[];
  fields: SignupField[];
  userId: string | null;
  canManage: boolean;
  busy: boolean;
  members: FestMemberOption[];
  ensureMembers: () => Promise<void>;
  onJoin: () => void;
  onAdd: (payload: { forUserId?: string; name: string; fields: Record<string, string> }) => Promise<boolean>;
  onRemove: (id: string) => void;
  requireSignIn: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const full = signups.length >= view.capacity;
  const mine = userId ? signups.some((s) => s.userId === userId) : false;
  const hasFields = fields.length > 0;

  return (
    <div className="rounded-xl bg-background p-2.5 ring-1 ring-border/60">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{view.label}</p>
        <span className={`text-xs ${full ? "text-accent" : "text-foreground/50"}`}>
          {signups.length}/{view.capacity} filled
        </span>
      </div>

      {signups.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {signups.map((s) => (
            <li
              key={s.id}
              className="flex items-start justify-between gap-2 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  <PrivateName name={s.name} />
                </p>
                {fields.length > 0 && (
                  <p className="mt-0.5 text-primary/70">
                    {fields
                      .map((f) => `${f.label}: ${s.fields?.[f.id]?.trim() || "—"}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {(s.userId === userId || s.addedBy === userId || canManage) && (
                <button
                  type="button"
                  onClick={() => onRemove(s.id)}
                  disabled={busy}
                  aria-label={`Remove ${s.name} from this slot`}
                  className="press mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-primary/70 hover:text-primary"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!full && !adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Fast self-join only when there are no extra columns to fill. */}
          {!mine && !hasFields && (
            <button
              type="button"
              onClick={onJoin}
              disabled={busy}
              className="press rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary disabled:opacity-50"
            >
              {userId ? "+ Join this slot" : "Sign in to join"}
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
            {hasFields ? "+ Sign up" : "+ Add someone"}
          </button>
        </div>
      )}

      {adding && (
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
