"use client";

import { useAssistantEnabled } from "@/lib/assistantToggle";

// Profile → Beta features control for the "Ask MLR" assistant button. Only
// rendered for beta testers (the caller gates on isBetaTester), and the button
// itself is double-gated on beta, so this is a beta-only switch. Per-device,
// default off — turning it on reveals the floating ✨ button immediately.
export function AssistantToggle() {
  const [enabled, setEnabled] = useAssistantEnabled();

  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <span className="min-w-0">
        <span className="text-sm font-medium">Ask MLR assistant ✨</span>
        <span className="block text-xs text-foreground/50">
          Show the floating AI helper that answers questions from app data.
          Beta preview — off by default, just on this device.
        </span>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
      />
    </label>
  );
}
