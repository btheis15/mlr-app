// A round profile photo with an initials fallback — used everywhere a member's
// name appears (posts, comments, the member popup, profile). Pass a px `size`.
function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function Avatar({
  name,
  url,
  size = 32,
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 font-bold text-primary ${className}`;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (url) {
    return (
      <span className={cls} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span className={cls} style={style} aria-label={name}>
      {initials(name)}
    </span>
  );
}
