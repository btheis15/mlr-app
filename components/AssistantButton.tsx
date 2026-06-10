"use client";

import { useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { AssistantChat } from "@/components/AssistantChat";

// The floating "Ask MLR" entry point, mounted globally in layout.tsx. Sits just
// above the TabBar. BETA-ONLY for now: only members with the Beta Tester role
// (profiles.beta_tester, assigned by an admin) see it, so the assistant can be
// trialed without exposing it to the whole resort. Beta implies a signed-in
// account, so no guest handling is needed; it's also hidden during an admin
// "view as" preview (isBetaTester is forced false there).

export function AssistantButton() {
  const { isBetaTester } = useIdentity();
  const [open, setOpen] = useState(false);

  if (!isBetaTester) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Ask MLR — AI assistant"
        onClick={() => setOpen(true)}
        className="press fixed right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-lg ring-1 ring-black/5"
        style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
      >
        <span aria-hidden>✨</span>
      </button>

      {open && <AssistantChat onClose={() => setOpen(false)} />}
    </>
  );
}
