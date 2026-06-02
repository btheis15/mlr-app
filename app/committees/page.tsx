import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { COMMITTEES } from "@/lib/data";

export default function CommitteesPage() {
  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Committees</h1>
        <p className="text-sm text-foreground/60">
          Volunteer groups that keep the resort running. Tap one to see who&rsquo;s on it.
        </p>
      </header>
      <ul className="space-y-2">
        {COMMITTEES.map((c, i) => (
          <li
            key={c.slug}
            className="rise"
            style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
          >
            <Link
              href={`/committees/${c.slug}`}
              className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
            >
              <span className="text-2xl">{c.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="truncate text-xs text-foreground/60">{c.description}</p>
                <p className="mt-0.5 text-[11px] text-foreground/40">
                  {c.members.length} members
                </p>
              </div>
              <span className="text-foreground/30" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-center text-xs text-foreground/40">
        Members shown are placeholders — real names coming soon.
      </p>
    </div>
  );
}
