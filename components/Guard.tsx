"use client";

import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { firstName } from "@/lib/privacy";
import { SkeletonList } from "@/components/Skeleton";

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
  const { user, verified, authReady, promptSignIn } = useIdentity();
  // ⭐ An UNVERIFIED member counts as a guest.
  //
  // Anyone can sign up with any email address, so a confirmed login proves nothing
  // on its own. Until an admin verifies them they see exactly what a signed-out
  // visitor sees. The database enforces this independently (migration 0183 keys
  // every members-only read on is_approved_member()); this makes the UI agree with
  // it, so an unverified person gets a coherent screen instead of a member layout
  // full of empty lists.
  const awaitingVerification = isSupabaseConfigured && !!user && !verified;
  const guest = isSupabaseConfigured && (!user || !verified);
  // Auth is still settling and we don't know yet. A returning member's
  // identity snapshot restores `user` on the first client tick, so in practice
  // this only covers the very first open on a device (and genuinely slow
  // auth) — but without it, SignInWall would flash the sign-in card at a
  // signed-in member on every cold open of a members-only route.
  const resolving = isSupabaseConfigured && !authReady && !user;
  return { guest, signedIn: !guest, resolving, awaitingVerification, promptSignIn };
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
  const { guest, awaitingVerification, promptSignIn } = useGuest();
  if (!guest) return <>{children}</>;
  // Already signed in, just not verified yet — "Sign in to see" would be wrong and
  // tapping it does nothing useful, so show a non-interactive note instead.
  if (awaitingVerification) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-lg bg-background px-2 py-1 text-xs font-medium text-faint ring-1 ring-border ${className}`}
        title="An admin needs to approve your account first"
      >
        🔒 Waiting to be approved
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={promptSignIn}
      className={`press inline-flex items-center gap-1 rounded-lg bg-background px-2 py-1 text-xs font-medium text-faint ring-1 ring-border ${className}`}
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
  const { guest, resolving, awaitingVerification, promptSignIn } = useGuest();
  // While auth settles, hold a neutral skeleton instead of flashing the wall
  // (the AdminGuard precedent) — prerendered HTML ships this too, and it swaps
  // to the wall (guest) or the content (member) as soon as authReady flips.
  if (resolving) {
    return (
      <div className="space-y-4 pt-6">
        <SkeletonList count={3} />
      </div>
    );
  }
  // Signed in and email-confirmed, but an admin hasn't verified them yet. Telling
  // them to "sign in" would be actively wrong and they'd keep retrying a thing
  // that already worked — so this state gets its own message explaining what's
  // actually happening and that it needs a person, not another attempt.
  if (awaitingVerification) {
    return (
      <div className="space-y-4 pt-6">
        <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-3xl">
            👋
          </div>
          <h1 className="text-xl font-bold">You&rsquo;re signed in — almost there</h1>
          <p className="text-sm text-foreground/65">
            One of the family admins just needs to okay your account before {title.toLowerCase()} opens up. It&rsquo;s a
            quick check that everyone here is family.
          </p>
          <p className="text-xs text-muted">
            Nothing more to do on your end — you&rsquo;ll see everything next time you open the app once you&rsquo;re
            approved.
          </p>
        </div>
      </div>
    );
  }
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
