"use client";

import { useCallback, useEffect, useState } from "react";
import { useFestContent } from "@/lib/useFestContent";
import { formatDateLong } from "@/lib/format";
import { eventDays } from "@/lib/events";
import { FAMILY_FEST } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { getCurrentUserId } from "@/lib/roles";
import { DinnerRow } from "@/components/FestWeek";
import {
  canEditFest,
  fetchMemberOptions,
  fetchDinnerDrafts,
  type FestMemberOption,
  type DinnerDraft,
} from "@/lib/festContent";

/**
 * Dinners — the index the sub-nav's Dinners pill lands on. Every night is
 * listed and expands IN PLACE (menu, crew houses, head chef) — no drilling
 * into a separate page and back for each one — with the same chef/crew
 * self-edit + full admin-edit-in-place affordance as FestWeek's DinnerRow
 * (migration 0099). Content comes from the shared DB via useFestContent
 * (seed fallback offline) — static-export safe, all client-side.
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
          Tap a night to see the menu, chef, and crew — and edit it if it&apos;s yours.
        </p>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-sm text-foreground/60 ring-1 ring-border">
          No dinners on the books yet — check back soon.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((dinner, i) => (
            <div
              key={dinner.id}
              style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
              className="rise overflow-hidden rounded-2xl bg-card ring-1 ring-border"
            >
              <div className="border-b border-border/60 px-4 py-2.5">
                <p className="text-sm font-semibold">{formatDateLong(dinner.day)}</p>
              </div>
              <ul>
                <DinnerRow
                  dinner={dinner}
                  uid={uid}
                  canEditAll={canEditAll}
                  draft={dinnerDrafts.find((d) => d.id === dinner.id) ?? null}
                  days={festDayOptions}
                  members={members}
                  onSaved={onSaved}
                />
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
