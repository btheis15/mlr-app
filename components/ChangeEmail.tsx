"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { Sheet, FIELD } from "@/components/Sheet";
import { SettingsRow } from "@/components/SettingsRow";

/**
 * Self-serve email change, two steps mirroring sign-in: new email → code. We use
 * Supabase's secure email change (a code goes to the new address, with a heads-up
 * to the old one), verified in-app via `confirmEmailChange` so there's no browser
 * hop inside the installed PWA. On success `user.email` refreshes on its own. A
 * settings row (current email as the subtitle) opens a sheet with the form.
 */
export function ChangeEmail() {
  const { user, previewMode } = useIdentity();
  const [open, setOpen] = useState(false);

  // Self-serve change is tied to the real session; meaningless/misleading while
  // previewing as someone else, so don't offer it then.
  if (previewMode !== "off") return null;

  return (
    <>
      <SettingsRow icon="✉️" title="Email" subtitle={user?.email} onClick={() => setOpen(true)} />
      {open && <ChangeEmailSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangeEmailSheet({ onClose }: { onClose: () => void }) {
  const { user, startEmailChange, confirmEmailChange } = useIdentity();
  const [step, setStep] = useState<"email" | "code">("email");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const { pending, status, run } = useSaveStatus();
  const { closing, close } = useSheetDismiss(onClose);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const currentEmail = (user?.email ?? "").trim().toLowerCase();
  // Require a real current email and a different new one.
  const emailValid = !!currentEmail &&
    /\S+@\S+\.\S+/.test(newEmail) &&
    newEmail.trim().toLowerCase() !== currentEmail;

  const sendCode = () =>
    run(async () => {
      const { error } = await startEmailChange(newEmail);
      if (error) return error;
      setStep("code");
      return `We emailed a code to ${newEmail.trim().toLowerCase()}.`;
    }, 0);

  const verify = () =>
    run(async () => {
      const { error } = await confirmEmailChange(newEmail, code);
      if (error) return error;
      // Keep the sheet up briefly so the confirmation is actually seen, then
      // auto-close (user.email refreshes on its own via onAuthStateChange).
      closeTimer.current = setTimeout(() => close(), 2500);
      return "Email updated.";
    }, 0);

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="change-email-title"
      header={
        <h2 id="change-email-title" className="text-lg font-bold">
          Change email
        </h2>
      }
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-foreground/60 ring-1 ring-border"
          >
            Cancel
          </button>
          {step === "email" ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={!emailValid || pending}
              className="press ml-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send code"}
            </button>
          ) : (
            <button
              type="button"
              onClick={verify}
              disabled={code.trim().length < 6 || pending}
              className="press ml-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Verifying…" : "Update email"}
            </button>
          )}
        </div>
      }
    >
      {step === "email" ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground/70">New email address</span>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="you@email.com"
            type="email"
            autoComplete="email"
            autoFocus
            className={`w-full ${FIELD}`}
          />
          <span className="block text-xs text-faint">
            We&rsquo;ll email a code to the new address to confirm it&rsquo;s yours.
          </span>
        </label>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground/70">Enter the code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className={`w-full text-center text-lg tracking-widest ${FIELD}`}
          />
        </label>
      )}

      {status && <p className="text-xs text-foreground/60">{status}</p>}
    </Sheet>
  );
}
