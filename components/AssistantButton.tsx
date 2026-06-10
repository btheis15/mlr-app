"use client";

import { useState } from "react";
import { useGuest } from "@/components/Guard";
import { AssistantChat } from "@/components/AssistantChat";

// The floating "Ask MLR" entry point, mounted globally in layout.tsx. Sits just
// above the TabBar. Signed-in only: guests get the sign-in sheet instead of the
// chat (the bot answers from member data, so it stays behind the wall). With no
// backend configured, useGuest reports signed-in, matching the app's "never lock
// everyone out of an app that can't sign in" rule.

export function AssistantButton() {
  const { guest, promptSignIn } = useGuest();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Ask MLR — AI assistant"
        onClick={() => (guest ? promptSignIn() : setOpen(true))}
        className="press fixed right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-lg ring-1 ring-black/5"
        style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
      >
        <span aria-hidden>✨</span>
      </button>

      {open && <AssistantChat onClose={() => setOpen(false)} />}
    </>
  );
}
