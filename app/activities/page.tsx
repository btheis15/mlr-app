import { ACTIVITIES } from "@/lib/data";
import type { ActivityCategory } from "@/lib/types";

const ORDER: ActivityCategory[] = ["On the water", "On land", "For kids", "Evening"];

export default function ActivitiesPage() {
  return (
    <div className="space-y-6 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Activities</h1>
        <p className="text-sm text-foreground/60">
          Everything to do around the lake.
        </p>
      </header>

      {ORDER.map((category) => {
        const items = ACTIVITIES.filter((a) => a.category === category);
        if (items.length === 0) return null;
        return (
          <section key={category} className="space-y-2">
            <h2 className="text-sm font-semibold text-accent">{category}</h2>
            <ul className="space-y-2">
              {items.map((a) => (
                <li
                  key={a.id}
                  className="flex gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
                >
                  <div className="text-2xl">{a.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold">{a.name}</h3>
                      <span className="shrink-0 text-xs font-medium text-primary">
                        {a.price}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/50">
                      {a.hours} · {a.location}
                    </p>
                    <p className="mt-1 text-xs text-foreground/70">{a.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
