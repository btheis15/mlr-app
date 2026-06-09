"use client";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { EmailMembers } from "@/components/EmailMembers";
import { useGuest } from "@/components/Guard";

/**
 * The "Email members" tool wrapped in its collapsible section, for the People
 * page. Hidden entirely from guests so they don't see an empty section header
 * (EmailMembers itself renders nothing until signed in). Members get the
 * collapsed section; the directory below stays the focus.
 */
export function EmailMembersSection() {
  const { guest } = useGuest();
  if (guest) return null;
  return (
    <CollapsibleSection
      title="Email members"
      icon="✉️"
      subtitle="A custom list, your committees, or everyone"
    >
      <EmailMembers />
    </CollapsibleSection>
  );
}
