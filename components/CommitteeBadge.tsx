import { committeesForName } from "@/lib/committees";

/**
 * A tiny emoji tag shown next to a person's name to indicate the committee(s)
 * they're on. Keyed off the static roster names (lib/data `COMMITTEES`), so it
 * lights up as people are linked to real accounts. Emoji-only to stay compact;
 * the committee name rides along as the accessible label / tooltip. Pure +
 * server-safe, so it can drop in next to any name render.
 */
export function CommitteeBadge({
  name,
  className = "",
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const tags = committeesForName(name);
  if (!tags.length) return null;
  return (
    <>
      {tags.map((t) => (
        <span
          key={t.slug}
          title={`${t.name} committee`}
          aria-label={`${t.name} committee`}
          className={`ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/10 align-middle text-[10px] leading-none ring-1 ring-border ${className}`}
        >
          <span aria-hidden>{t.emoji}</span>
        </span>
      ))}
    </>
  );
}
