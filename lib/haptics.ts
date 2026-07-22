// Lightweight haptic feedback — a progressive enhancement, never a dependency.
//
// navigator.vibrate is Android/Chrome only; iOS Safari (incl. the installed PWA)
// has NO Vibration API, so this is a silent no-op there — the visual spring/press
// feedback carries the "tactile" feel on iOS. That's the same trade-off the
// sibling stock-game app makes (it ships zero haptics and still feels native).
// Calling this anywhere is safe: it never throws and does nothing when
// unsupported or when the OS is set to Reduce Motion.

export type HapticKind = "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8, // a tap tick (tab switch, button)
  medium: 16, // a more deliberate action (send, commit a swipe)
  success: [10, 40, 12], // a positive resolution (RSVP going, poll voted)
  warning: [22, 60, 22], // something held/blocked
};

export function haptic(kind: HapticKind = "light"): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    // Treat Reduce Motion as "keep it minimal" — skip the buzz too.
    const reduce =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    if (reduce) return;
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* never let feedback break an interaction */
  }
}
