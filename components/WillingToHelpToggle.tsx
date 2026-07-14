"use client";

import { useIdentity } from "@/components/IdentityProvider";
import { SettingsToggleRow } from "@/components/SettingsRow";

// The "Willing to Help" opt-in (profiles.willing_to_help, migration 0037), shown
// in Profile → Ask for Help. It's the real switch for RECEIVING "Ask for Help"
// pings — separate from the notif/push toggles, which only mute or route it. You
// still only get pinged while you're actually at the resort (see lib/helpRequests
// presence), and you always choose whether to respond.
export function WillingToHelpToggle() {
  const { user, updateUser } = useIdentity();
  if (!user) return null;

  return (
    <SettingsToggleRow
      icon="🙋"
      title="Willing to help"
      subtitle="When you're at the resort, get a heads-up if someone nearby needs a hand. You decide whether to jump in — and you're only pinged while you're actually up there."
      on={user.willingToHelp}
      onToggle={() => updateUser({ willingToHelp: !user.willingToHelp })}
    />
  );
}
