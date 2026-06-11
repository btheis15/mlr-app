"use client";

import { useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { AssistantChat } from "@/components/AssistantChat";
import { useAssistantEnabled } from "@/lib/assistantToggle";

// The floating "Ask MLR" entry point, mounted globally in layout.tsx. Sits just
// above the TabBar. Hidden by default for EVERYONE. It appears only when (a) you
// have the Beta Tester role (profiles.beta_tester, admin-assigned) AND (b) you've
// turned it on in Profile → Beta features (a per-device toggle, default off —
// see lib/assistantToggle.ts). Beta implies a signed-in account, so no guest
// handling is needed; it's also hidden during an admin "view as" preview
// (isBetaTester is forced false there). The toggle only shows for beta testers,
// so non-beta members can't enable it.

export function AssistantButton() {
  const { isBetaTester } = useIdentity();
  const [assistantEnabled] = useAssistantEnabled();
  const [open, setOpen] = useState(false);

  if (!isBetaTester || !assistantEnabled) return null;

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
