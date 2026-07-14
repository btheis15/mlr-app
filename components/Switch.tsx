"use client";

/**
 * Shared iOS-style on/off switch — the one toggle control used across every
 * settings row (Profile, Push categories, Ask for Help, Contact & payment),
 * replacing the native `<input type="checkbox">` that used to look different
 * row to row.
 */
export function Switch({
  on,
  busy,
  onClick,
  label,
}: {
  on: boolean;
  busy?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-foreground/20"}`}
    >
      <span
        aria-hidden
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}
