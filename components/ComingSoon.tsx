export function ComingSoon({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="text-5xl">{emoji}</div>
      <h1 className="mt-3 text-xl font-bold">{title}</h1>
      <p className="mt-1 max-w-xs text-sm text-foreground/60">
        Placeholder tab — nothing wired up here yet.
      </p>
    </div>
  );
}
