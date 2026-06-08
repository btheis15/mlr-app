"use client";

import { useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus } from "@/lib/hooks";

/**
 * Self-serve email change, two steps mirroring sign-in: new email → code. We use
 * Supabase's secure email change (a code goes to the new address, with a heads-up
 * to the old one), verified in-app via `confirmEmailChange` so there's no browser
 * hop inside the installed PWA. On success `user.email` refreshes on its own.
 */
export function ChangeEmail() {
  const { user, startEmailChange, confirmEmailChange } = useIdentity();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const { pending, status, show, run } = useSaveStatus();

  const emailValid = /\S+@\S+\.\S+/.test(newEmail) &&
    newEmail.trim().toLowerCase() !== (user?.email ?? "").toLowerCase();

  const reset = () => {
    setOpen(false);
    setStep("email");
    setNewEmail("");
    setCode("");
    show(null);
  };

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
      reset();
      return "Email updated.";
    }, 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press text-xs font-medium text-primary"
      >
        Change email
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
      {step === "email" ? (
        <>
          <label className="text-xs font-medium text-foreground/70">New email address</label>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="you@email.com"
            type="email"
            autoComplete="email"
            className="w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-foreground/45">
            We&rsquo;ll email a code to the new address to confirm it&rsquo;s yours.
          </p>
        </>
      ) : (
        <>
          <label className="text-xs font-medium text-foreground/70">Enter the code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded-xl bg-background px-3 py-2.5 text-center text-lg tracking-widest ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </>
      )}

      {status && <p className="text-xs text-foreground/60">{status}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={reset}
          className="press rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground/60 ring-1 ring-border"
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
    </div>
  );
}
