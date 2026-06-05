/**
 * The standard "this feature turns on once its migration is run" note. Admin
 * panels show it until their backing SQL function exists. `children` is the
 * lead-in ("To turn this on,"); the file name is rendered as code.
 */
export function MigrationHint({ file, children }: { file: string; children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-foreground/70">
      {children} run <code>supabase/migrations/{file}</code> in Supabase.
    </p>
  );
}
