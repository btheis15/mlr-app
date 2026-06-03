"use client";

import { useIdentity } from "@/components/IdentityProvider";

/**
 * Floating "you're previewing" banner, shown app-wide whenever an admin is in a
 * "view as" preview (see [`PreviewAs`](components/PreviewAs.tsx)). It sits above
 * the tab bar and is the way back, because the admin tools — including the
 * control that started the preview — are hidden while previewing. Renders
 * nothing in the normal (off) state.
 */
export function PreviewBanner() {
  const { previewMode, setPreviewMode } = useIdentity();
  if (previewMode === "off") return null;

  const label = previewMode === "guest" ? "a guest (signed out)" : "a member";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg ring-1 ring-black/10">
        <span>👁 Previewing as {label}</span>
        <button
          onClick={() => setPreviewMode("off")}
          className="press rounded-full bg-white/20 px-3 py-1 text-xs font-semibold"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
