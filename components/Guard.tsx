"use client";

import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { firstName } from "@/lib/privacy";

/**
 * The privacy wall. Sensitive info — Posts, payments, contact details, last
 * names, and exact locations — is hidden from anyone who isn't signed in, so a
 * stranger (or scraper) browsing the app can't harvest it.
 *
 * NOTE: this is the UI layer. It keeps sensitive info off the screen for guests;
 * truly hardening it against a determined attacker also needs the database /
 * bundle lockdown (gated server reads, real data kept out of the client bundle)
 * — the planned next step. See NEXT-STEPS / the PR notes.
 *
 * Gating only kicks in when sign-in actually exists (`isSupabaseConfigured`).
 * With no backend the whole app stays open to browse, exactly as before — so we
 * never lock everyone out of an app that has no way to sign in.
 */
export function useGuest() {
  const { user, promptSignIn } = useIdentity();
  const guest = isSupabaseConfigured && !user;
  return { guest, signedIn: !guest, promptSignIn };
}

/** A person's name: full when signed in, first-name-only for guests. */
export function PrivateName({ name, className }: { name: string; className?: string }) {
  const { guest } = useGuest();
  return <span className={className}>{guest ? firstName(name) : name}</span>;
}

/**
 * Inline gate for a sensitive bit (a phone/email button, a location line). Shows
 * its children to members; guests get a small "🔒 Sign in" chip that opens the
 * sign-in sheet.
 */
export function Protected({
  children,
  label = "Sign in to see",
  className = "",
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const { guest, promptSignIn } = useGuest();
  if (!guest) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={promptSignIn}
      className={`press inline-flex items-center gap-1 rounded-lg bg-background px-2 py-1 text-xs font-medium text-foreground/45 ring-1 ring-border ${className}`}
    >
      🔒 {label}
    </button>
  );
}

/**
 * Full-section wall for member-only screens (Posts, Pay). Members see the real
 * content; guests get a friendly sign-in card instead. Render the protected
 * screen as the child.
 */
export function SignInWall({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  const { guest, promptSignIn } = useGuest();
  if (!guest) return <>{children}</>;
  return (
    <div className="space-y-4 pt-6">
      <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
          🔒
        </div>
        <h1 className="text-xl font-bold">{title} is for members</h1>
        <p className="text-sm text-foreground/65">
          {note ?? "Add your name & email to see this — no password, just a code we email you. The rest of the app stays open to browse."}
        </p>
        <button
          onClick={promptSignIn}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
        >
          Sign in to view
        </button>
      </div>
    </div>
  );
}
