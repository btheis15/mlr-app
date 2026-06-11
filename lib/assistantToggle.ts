"use client";

import { useEffect, useState } from "react";

// Per-device on/off for the "Ask MLR" assistant button. Default OFF for
// everyone — the floating ✨ button only appears when a Beta Tester turns it on
// in Profile → Beta features. Stored per device in localStorage (like the text
// size), so it's instant and needs no backend. The button visibility is ALSO
// gated by `isBetaTester`, so flipping this on does nothing for non-beta users.
export const ASSISTANT_ENABLED_KEY = "mlr-assistant-enabled";
const CHANGE_EVENT = "mlr-assistant-enabled-change";

export function getAssistantEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ASSISTANT_ENABLED_KEY) === "1";
}

export function setAssistantEnabled(on: boolean): void {
  try {
    localStorage.setItem(ASSISTANT_ENABLED_KEY, on ? "1" : "0");
  } catch {
    /* private mode / storage disabled — the live change still applies */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

/**
 * Reactive accessor shared by the toggle (Profile) and the button (mounted
 * globally in layout), so flipping the switch shows/hides the button live —
 * no reload. Returns `false` during SSR/prerender (button hidden in static
 * HTML), then reads the saved value after mount.
 */
export function useAssistantEnabled(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(getAssistantEnabled());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync); // cross-tab
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [enabled, setAssistantEnabled];
}
