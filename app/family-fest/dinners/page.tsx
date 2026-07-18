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
 * Dinners — the index the sub-nav's Dinners pill lands on. Reads like a
 * weekly menu: day, serving time, the menu itself, the head chef, and the
 * houses on crew — the family-facing essentials, all shown at once with no
 * tap-to-expand and no click-through. Deliberately leaves out the
 * crew-prep time/location (only the crew needs that logistics — it's still
 * editable here, just not displayed to every reader; the full detail
 * remains in FestWeek's accordion and the standalone dinners/[id] page for
 * anyone who does need it). Editing still works in place (the same
 * chef/crew self-edit + full admin-edit-in-place affordance as FestWeek's
 * DinnerRow, migration 0099) — it just opens from an always-visible Edit
 * button. Content comes from the shared DB via useFestContent (seed
 * fallback offline) — static-export safe, all client-side.
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
        <p className="text-sm text-foreground/60">This week&apos;s dinner menu, night by night.</p>
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
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
            {formatDateLong(dinner.day)}
          </p>
          <p className="mt-0.5 truncate text-lg font-semibold">
            {dinner.emoji} {dinner.title}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold text-accent">{formatTime(dinner.time)}</p>
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

      <p className="text-base leading-relaxed text-foreground/85">{dinner.menu}</p>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-border/60 pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-foreground/40">Head chef</p>
          <p className="mt-0.5 text-sm font-semibold">
            <PrivateName name={dinner.chef.name} />
          </p>
          <div className="mt-1.5">
            <CallTextButtons phone={dinner.chef.phone} />
          </div>
        </div>

        {dinner.houses.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-foreground/40">Crew</p>
            <div className="mt-1">
              <Protected label="Sign in to see who's cooking">
                <p className="text-sm font-medium text-accent">{dinner.houses.join(" · ")}</p>
              </Protected>
            </div>
          </div>
        )}
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
