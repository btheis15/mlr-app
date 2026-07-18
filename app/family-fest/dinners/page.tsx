"use client";

import { useCallback, useEffect, useState } from "react";
import { useFestContent } from "@/lib/useFestContent";
import { formatDateLong, formatTime } from "@/lib/format";
import { eventDays } from "@/lib/events";
import { FAMILY_FEST } from "@/lib/data";
import { Protected, PrivateName } from "@/components/Guard";
import { CallTextButtons } from "@/components/CallTextButtons";
import { DinnerDetailsEditSheet } from "@/components/DinnerDetailsEditSheet";
import { DinnerSheet } from "@/components/FestPlanner";
import { DinnerTile } from "@/components/FestWeek";
import { useIdentity } from "@/components/IdentityProvider";
import { getCurrentUserId } from "@/lib/roles";
import {
  canEditFest,
  fetchMemberOptions,
  fetchDinnerDrafts,
  type FestMemberOption,
  type DinnerDraft,
} from "@/lib/festContent";
import type { Dinner } from "@/lib/types";

/**
 * Dinners — the index the sub-nav's Dinners pill lands on. Every night's
 * full details (menu, served/prep time+location, houses on crew, head chef)
 * are shown right on the card, all at once — no tap-to-expand step and no
 * click-through to a separate page, so scrolling the list is the only
 * gesture needed to see everything. Editing still works in place (the same
 * chef/crew self-edit + full admin-edit-in-place affordance as FestWeek's
 * DinnerRow, migration 0099) — it just opens from an always-visible Edit
 * button instead of behind a reveal. Content comes from the shared DB via
 * useFestContent (seed fallback offline) — static-export safe, all
 * client-side.
 */
export default function FestDinnersPage() {
  const { dinners, reload } = useFestContent({ realtime: true });
  const { user } = useIdentity();
  const [uid, setUid] = useState<string | null>(null);
  const [canEditAll, setCanEditAll] = useState(false);
  const [members, setMembers] = useState<FestMemberOption[]>([]);
  const [dinnerDrafts, setDinnerDrafts] = useState<DinnerDraft[]>([]);

  const reloadAdminData = useCallback(() => {
    fetchMemberOptions().then(setMembers);
    fetchDinnerDrafts().then(setDinnerDrafts);
  }, []);

  useEffect(() => {
    if (!user) {
      setUid(null);
      setCanEditAll(false);
      return;
    }
    let active = true;
    getCurrentUserId().then((id) => active && setUid(id));
    canEditFest().then((ok) => {
      if (!active) return;
      setCanEditAll(ok);
      if (ok) reloadAdminData();
    });
    return () => {
      active = false;
    };
  }, [user, reloadAdminData]);

  const onSaved = () => {
    reload();
    if (canEditAll) reloadAdminData();
  };

  const sorted = [...dinners].sort((a, b) => a.day.localeCompare(b.day));
  const festDayOptions = eventDays(FAMILY_FEST.startDate, FAMILY_FEST.endDate);

  return (
    <div className="space-y-4 pt-1">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Dinners</h1>
        <p className="text-sm text-foreground/60">
          Every night, menu, and crew — scroll to see it all.
        </p>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-sm text-foreground/60 ring-1 ring-border">
          No dinners on the books yet — check back soon.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((dinner, i) => (
            <DinnerCard
              key={dinner.id}
              index={i}
              dinner={dinner}
              uid={uid}
              canEditAll={canEditAll}
              draft={dinnerDrafts.find((d) => d.id === dinner.id) ?? null}
              days={festDayOptions}
              members={members}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DinnerCard({
  index,
  dinner,
  uid,
  canEditAll,
  draft,
  days,
  members,
  onSaved,
}: {
  index: number;
  dinner: Dinner;
  uid: string | null;
  canEditAll: boolean;
  draft: DinnerDraft | null;
  days: string[];
  members: FestMemberOption[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const canEditThis = canEditAll || Boolean(uid && (dinner.chefUserId === uid || dinner.crewUserIds.includes(uid)));
  const fullEdit = canEditAll && Boolean(draft);
  return (
    <div
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
      className="rise space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg" aria-hidden>
          {dinner.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{formatDateLong(dinner.day)}</p>
          <p className="truncate text-xs text-foreground/50">Dinner · {dinner.title}</p>
        </div>
      </div>

      {canEditThis && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="press rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
        >
          ✏️ Edit this dinner
        </button>
      )}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">On the menu</p>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground/80">{dinner.menu}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DinnerTile
          emoji="🍽️"
          label="Served"
          value={formatTime(dinner.time)}
          sub={<Protected label="Sign in for location">{dinner.location}</Protected>}
        />
        <DinnerTile
          emoji="⏱️"
          label="Crew preps"
          value={formatTime(dinner.prepTime)}
          sub={
            <Protected label="Sign in for location">{dinner.prepLocation ?? dinner.location}</Protected>
          }
        />
      </div>

      {dinner.houses.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Houses on crew</p>
          <div className="mt-1">
            <Protected label="Sign in to see which families are cooking">
              <div className="flex flex-wrap gap-1.5">
                {dinner.houses.map((house) => (
                  <span
                    key={house}
                    className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
                  >
                    {house}
                  </span>
                ))}
              </div>
            </Protected>
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] uppercase tracking-wide text-foreground/40">Head chef of the day</p>
        <p className="mt-0.5 text-sm font-semibold">
          <PrivateName name={dinner.chef.name} />
        </p>
        <div className="mt-2">
          <CallTextButtons phone={dinner.chef.phone} />
        </div>
      </div>

      {editing && fullEdit && draft && (
        <DinnerSheet
          draft={draft}
          days={days}
          members={members}
          nextPosition={draft.position}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
      {editing && !fullEdit && (
        <DinnerDetailsEditSheet dinner={dinner} onClose={() => setEditing(false)} onSaved={onSaved} />
      )}
    </div>
  );
}
