import Link from "next/link";

/**
 * A tappable list row: leading emoji, a title + optional subtitle, trailing
 * chevron — the app's standard "go here" card. `tone` picks the surface:
 * "card" (default, ringed card) or "primary" (filled, for the loud CTA).
 */
export function RowLink({
  href,
  emoji,
  title,
  subtitle,
  tone = "card",
}: {
  href: string;
  emoji: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: "card" | "primary";
}) {
  const primary = tone === "primary";
  return (
    <Link
      href={href}
      className={`press flex items-center gap-3 rounded-2xl p-4 ${
        primary ? "bg-primary text-white shadow-sm" : "bg-card ring-1 ring-border"
      }`}
    >
      <span className="shrink-0 text-2xl">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle && <p className={`text-xs ${primary ? "text-white/80" : "text-foreground/60"}`}>{subtitle}</p>}
      </div>
      <span className={`shrink-0 ${primary ? "text-white/70" : "text-foreground/30"}`} aria-hidden>
        ›
      </span>
    </Link>
  );
}
