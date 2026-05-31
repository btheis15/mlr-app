/**
 * A calm, intentional "this opens later" affordance used in read-only mode
 * wherever an interactive action (post, RSVP, upload) is deferred to the
 * Supabase phase. Styled to read as a finished feature preview, not a dead end.
 */
export function ComingSoonCTA({
  icon = "🔒",
  title,
  note,
}: {
  icon?: string;
  title: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-3 text-center">
      <p className="text-sm font-medium text-foreground/80">
        {icon} {title}
      </p>
      {note && <p className="mt-0.5 text-xs text-foreground/50">{note}</p>}
    </div>
  );
}
