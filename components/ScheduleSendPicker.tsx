"use client";

/**
 * Shared "Send now" vs "Schedule for later" control for the two broadcast
 * composers (AdminAlertComposer, AdminNotificationComposer) — see migration
 * 0097. `value` is an ISO timestamp once a future send time is picked, or
 * null for "send now". The actual queuing/sending happens in the caller.
 */
export function ScheduleSendPicker({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time, no
  // timezone suffix — new Date(iso) then trimming to minutes round-trips that
  // correctly in the browser's own zone (the resort's — no cross-timezone
  // scheduling need here).
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const minLocal = toLocalInput(new Date(Date.now() + 2 * 60_000).toISOString());
  const localValue = value ? toLocalInput(value) : minLocal;

  return (
    <div className="space-y-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={`press rounded-lg py-1.5 text-xs font-medium ring-1 ${value === null ? "bg-primary/10 text-primary ring-primary/30" : "bg-card text-foreground/70 ring-border"}`}
        >
          Send now
        </button>
        <button
          type="button"
          onClick={() => onChange(new Date(Date.now() + 60 * 60_000).toISOString())}
          aria-pressed={value !== null}
          className={`press rounded-lg py-1.5 text-xs font-medium ring-1 ${value !== null ? "bg-primary/10 text-primary ring-primary/30" : "bg-card text-foreground/70 ring-border"}`}
        >
          Schedule for later
        </button>
      </div>
      {value !== null && (
        <label className="flex flex-col gap-1">
          <span className="px-0.5 text-xs text-muted">Send at</span>
          <input
            type="datetime-local"
            value={localValue}
            min={minLocal}
            onChange={(e) => e.target.value && onChange(new Date(e.target.value).toISOString())}
            className="rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      )}
    </div>
  );
}
