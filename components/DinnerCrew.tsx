import Link from "next/link";
import type { Dinner } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PrivateName } from "@/components/Guard";

/**
 * High-level list of the week's dinners — what each night's meal is and who's
 * the head chef in charge. The crew-only detail (prep time/place, the houses
 * helping, chef call/text) lives on the click-through detail page
 * (app/family-fest/dinners/[id]/page.tsx).
 */
export function DinnerCrew({ dinners }: { dinners: Dinner[] }) {
  return (
    <ul className="space-y-2">
      {dinners.map((d, i) => (
        <li
          key={d.id}
          style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
          className="rise"
        >
          <Link
            href={`/family-fest/dinners/${d.id}`}
            className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
          >
            <span className="text-2xl">{d.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-foreground/50">{formatDate(d.day)}</p>
              <p className="truncate text-sm font-semibold">{d.title}</p>
              <p className="truncate text-xs text-foreground/60">
                Head chef: <PrivateName name={d.chef.name} />
              </p>
            </div>
            <span className="shrink-0 text-foreground/30" aria-hidden>
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
