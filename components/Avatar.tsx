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
  fallback = "initials",
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
  // What to show when there's no photo: name initials (the default, used in
  // lists where the name is the anchor) or a generic person silhouette — the
  // Facebook/X-style "blank profile" used for the top-bar profile button.
  fallback?: "initials" | "icon";
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
  if (fallback === "icon") {
    return (
      <span className={cls} style={style} aria-label={name || "Profile"}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[62%] w-[62%]">
          <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2.5c-4.42 0-8 2.46-8 5.5V22h16v-2c0-3.04-3.58-5.5-8-5.5Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className={cls} style={style} aria-label={name}>
      {initials(name)}
    </span>
  );
}
