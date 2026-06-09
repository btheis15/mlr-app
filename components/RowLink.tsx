import Link from "next/link";

/**
 * A tappable list row: leading emoji, a title + optional subtitle, trailing
 * chevron — the app's standard "go here" card. `tone` picks the surface:
 * "card" (default, ringed card) or "primary" (filled, for the loud CTA).
 * `tile` puts the emoji on a tinted icon tile (pass the tint, e.g.
 * "bg-lake/12") to match the home-grid card style.
 */
export function RowLink({
  href,
  emoji,
  title,
  subtitle,
  tone = "card",
  tile,
}: {
  href: string;
  emoji: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: "card" | "primary";
  tile?: string;
}) {
  const primary = tone === "primary";
  return (
    <Link
      href={href}
      className={`press flex items-center gap-3 rounded-2xl p-4 ${
        primary ? "bg-primary text-white shadow-sm" : "bg-card ring-1 ring-border transition-shadow hover:shadow-sm"
      }`}
    >
      {tile ? (
        <span aria-hidden className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${tile}`}>
          {emoji}
        </span>
      ) : (
        <span className="shrink-0 text-2xl">{emoji}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle && <p className={`mt-0.5 text-xs ${primary ? "text-white/80" : "text-foreground/60"}`}>{subtitle}</p>}
      </div>
      <span className={`shrink-0 text-lg leading-none ${primary ? "text-white/70" : "text-foreground/40"}`} aria-hidden>
        ›
      </span>
    </Link>
  );
}
