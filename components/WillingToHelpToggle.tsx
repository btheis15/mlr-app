"use client";

import { useIdentity } from "@/components/IdentityProvider";

// The "Willing to Help" opt-in (profiles.willing_to_help, migration 0037), shown
// in Profile → Beta features. It's the real switch for RECEIVING "Ask for Help"
// pings — separate from the notif/push toggles, which only mute or route it. You
// still only get pinged while you're actually at the resort (see lib/helpRequests
// presence), and you always choose whether to respond.
export function WillingToHelpToggle() {
  const { user, updateUser } = useIdentity();
  if (!user) return null;

  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <span className="min-w-0">
        <span className="text-sm font-medium">🙋 Willing to help</span>
        <span className="block text-xs text-foreground/50">
          When you&rsquo;re at the resort, get a heads-up if someone nearby needs a hand. You decide
          whether to jump in — and you&rsquo;re only pinged while you&rsquo;re actually up there.
        </span>
      </span>
      <input
        type="checkbox"
        checked={user.willingToHelp}
        onChange={(e) => updateUser({ willingToHelp: e.target.checked })}
        className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
      />
    </label>
  );
}
