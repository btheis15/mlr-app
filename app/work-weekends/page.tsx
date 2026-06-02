import Link from "next/link";
import { BackLink } from "@/components/BackLink";

export default function WorkWeekendsPage() {
  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">🛠️ Work Weekends</h1>
        <p className="text-sm text-foreground/60">
          Weekends when the family pitches in to get the resort ready for the season.
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-center">
        <p className="text-sm font-medium text-foreground/80">📅 Dates coming soon</p>
        <p className="mt-1 text-xs text-foreground/55">
          We&rsquo;ll post the work-weekend dates and what needs doing here. Organized
          with the Resort Maintenance committee.
        </p>
      </div>

      <Link
        href="/committees/resort-maintenance"
        className="press block rounded-2xl bg-card p-4 text-center text-sm font-semibold text-primary ring-1 ring-border"
      >
        🛠️ Resort Maintenance committee →
      </Link>
    </div>
  );
}
