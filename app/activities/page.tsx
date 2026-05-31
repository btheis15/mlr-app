import { ACTIVITIES } from "@/lib/data";
import type { ActivityCategory } from "@/lib/types";

// Each category gets a Northwoods tone (header + icon chip + price). Literal
// classes so Tailwind generates them.
const CATEGORIES: {
  name: ActivityCategory;
  head: string;
  chip: string;
  price: string;
}[] = [
  { name: "On the water", head: "text-lake", chip: "bg-lake/12", price: "text-lake" },
  { name: "On land", head: "text-primary", chip: "bg-primary/12", price: "text-primary" },
  { name: "For kids", head: "text-sun", chip: "bg-sun/12", price: "text-sun" },
  { name: "Evening", head: "text-dusk", chip: "bg-dusk/12", price: "text-dusk" },
];

export default function ActivitiesPage() {
  return (
    <div className="space-y-6 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Activities</h1>
        <p className="text-sm text-foreground/60">
          Everything to do around the lake.
        </p>
      </header>

      {CATEGORIES.map((cat) => {
        const items = ACTIVITIES.filter((a) => a.category === cat.name);
        if (items.length === 0) return null;
        return (
          <section key={cat.name} className="space-y-2">
            <h2 className={`text-sm font-semibold ${cat.head}`}>{cat.name}</h2>
            <ul className="space-y-2">
              {items.map((a) => (
                <li
                  key={a.id}
                  className="flex gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
                >
                  <div
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${cat.chip}`}
                  >
                    {a.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold">{a.name}</h3>
                      <span className={`shrink-0 text-xs font-semibold ${cat.price}`}>
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
