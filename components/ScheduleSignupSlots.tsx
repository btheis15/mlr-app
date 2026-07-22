"use client";

// Limited sign-up time slots on a schedule event (migration 0135) — e.g. "4
// people per slot, every hour from noon to 4pm." Shown wherever an event's
// expanded details already render (FestWeek's EventRow, FestStatus's
// TodayEvent), right alongside the existing Edit affordance.

import { useCallback, useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { useIdentity } from "@/components/IdentityProvider";
import { PrivateName } from "@/components/Guard";
import { MemberPickerSheet } from "@/components/FestPlanner";
import {
  computeSlots,
  fetchScheduleSignups,
  signUpForSlot,
  removeScheduleSignup,
  type ScheduleSignup,
} from "@/lib/scheduleSignups";
import type { FestMemberOption } from "@/lib/festContent";
import type { ScheduleEvent } from "@/lib/types";

export function ScheduleSignupSlots({
  event,
  canManage,
  members,
}: {
  event: ScheduleEvent;
  /** Can act on ANY slot (add/remove other people) — the same predicate as
   *  the edit affordance: can_edit_fest() OR this event's lead/crew. */
  canManage: boolean;
  members: FestMemberOption[];
}) {
  const { userId, promptSignIn } = useIdentity();
  const [signups, setSignups] = useState<ScheduleSignup[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickingSlot, setPickingSlot] = useState<string | null>(null);
  const [namingSlot, setNamingSlot] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  const reload = useCallback(async () => setSignups(await fetchScheduleSignups(event.id)), [event.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const slots = computeSlots(event);
  if (!slots.length) return null;
  const capacity = event.signupCapacity ?? 0;

  const runAction = async (slot: string, action: () => Promise<{ error?: string }>) => {
    setBusySlot(slot);
    setError(null);
    const { error } = await action();
    if (error) setError(error);
    else await reload();
    setBusySlot(null);
  };

  const join = (slot: string) => {
    if (!userId) {
      promptSignIn();
      return;
    }
    void runAction(slot, () => signUpForSlot(event.id, slot));
  };
  const leave = (slot: string, signupId: string) => void runAction(slot, () => removeScheduleSignup(signupId));
  const addMember = (slot: string, m: FestMemberOption) => {
    setPickingSlot(null);
    void runAction(slot, () => signUpForSlot(event.id, slot, { forUserId: m.id }));
  };
  const addName = (slot: string) => {
    const name = nameInput.trim();
    if (!name) return;
    setNamingSlot(null);
    setNameInput("");
    void runAction(slot, () => signUpForSlot(event.id, slot, { name }));
  };

  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-border">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Sign up for a time slot</p>
      <div className="space-y-2">
        {slots.map((slot) => {
          const inSlot = signups.filter((s) => s.slotStart === slot);
          const full = inSlot.length >= capacity;
          const mine = userId ? inSlot.find((s) => s.userId === userId) : undefined;
          const busy = busySlot === slot;
          return (
            <div key={slot} className="rounded-xl bg-background p-2.5 ring-1 ring-border/60">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{formatTime(slot)}</p>
                <span className={`text-xs ${full ? "text-accent" : "text-foreground/50"}`}>
                  {inSlot.length}/{capacity} filled
                </span>
              </div>
              {inSlot.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {inSlot.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary"
                    >
                      <PrivateName name={s.name} />
                      {(s.userId === userId || canManage) && (
                        <button
                          type="button"
                          onClick={() => leave(slot, s.id)}
                          disabled={busy}
                          aria-label={`Remove ${s.name} from this slot`}
                          className="press flex h-4 w-4 items-center justify-center rounded-full text-primary/70 hover:text-primary"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {mine ? (
                  <p className="text-xs font-medium text-primary">You&rsquo;re signed up ✓</p>
                ) : (
                  !full && (
                    <button
                      type="button"
                      onClick={() => join(slot)}
                      disabled={busy}
                      className="press rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary disabled:opacity-50"
                    >
                      {userId ? "+ Join this slot" : "Sign in to join"}
                    </button>
                  )
                )}
                {canManage && !full && (
                  <>
                    {members.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPickingSlot(slot)}
                        disabled={busy}
                        className="press rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground/70 ring-1 ring-border disabled:opacity-50"
                      >
                        + Add a member
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setNamingSlot(slot)}
                      disabled={busy}
                      className="press rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground/70 ring-1 ring-border disabled:opacity-50"
                    >
                      + Add a name
                    </button>
                  </>
                )}
              </div>
              {namingSlot === slot && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Name"
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg bg-background px-2.5 py-1.5 text-sm ring-1 ring-border"
                  />
                  <button
                    type="button"
                    onClick={() => addName(slot)}
                    disabled={!nameInput.trim()}
                    className="press rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNamingSlot(null); setNameInput(""); }}
                    className="press rounded-lg px-2 text-xs font-medium text-foreground/50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">{error}</p>
      )}
      {pickingSlot && (
        <MemberPickerSheet
          members={members}
          onPick={(m) => addMember(pickingSlot, m)}
          onClose={() => setPickingSlot(null)}
        />
      )}
    </div>
  );
}
