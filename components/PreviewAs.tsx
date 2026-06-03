"use client";

import { useIdentity, type PreviewMode } from "@/components/IdentityProvider";

/**
 * Admin-only "view as" control. Lets an admin preview the app as a regular
 * member or as a signed-out guest, to check what each actually sees (the
 * privacy wall, hidden contact info, first-name-only, etc.).
 *
 * It's device-local and UI-only — it never changes your real Supabase session,
 * so your data and permissions are untouched; it only changes what's rendered.
 * Once you're previewing, admin tools hide (you're "not an admin" in that view),
 * so you exit from the floating banner ([`PreviewBanner`](components/PreviewBanner.tsx)).
 */
export function PreviewAs() {
  const { previewMode, setPreviewMode } = useIdentity();

  const option = (mode: PreviewMode, label: string, desc: string) => {
    const active = previewMode === mode;
    return (
      <button
        key={mode}
        onClick={() => setPreviewMode(mode)}
        className={`press flex-1 rounded-xl px-3 py-2.5 text-left ring-1 ${
          active ? "bg-primary text-white ring-primary" : "bg-background ring-border"
        }`}
      >
        <span className="block text-sm font-semibold">{label}</span>
        <span className={`block text-[11px] ${active ? "text-white/80" : "text-foreground/45"}`}>{desc}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">View as</h2>
      </div>
      <p className="text-xs text-foreground/60">
        Preview the app the way others see it. Admin tools hide while you preview — exit anytime from
        the banner that appears. Only changes what you see on this device.
      </p>
      <div className="flex gap-2">
        {option("off", "You", "Admin (normal)")}
        {option("member", "A member", "Signed-in, no admin")}
        {option("guest", "A guest", "Signed-out visitor")}
      </div>
    </div>
  );
}
