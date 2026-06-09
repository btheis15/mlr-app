import { BackLink } from "@/components/BackLink";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { EmailMembersSection } from "@/components/EmailMembersSection";

export const metadata = {
  title: "People — Muskellunge Lake Resort",
};

/**
 * People — the member directory. Everyone with an account, sorted by first
 * name, searchable, each with a quick Text / Call / pay-preference bar and a
 * tap-through to their full profile. The list + actions live in
 * PeopleDirectory (client); this page is just the header and the back link.
 */
export default function PeoplePage() {
  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">👥 People</h1>
        <p className="text-sm text-foreground/60">
          Everyone at the resort — tap a name to see their full profile, or use
          the quick links to text, call, or pay them.
        </p>
      </header>

      {/* Email members — moved here from Profile settings; it reads more
          naturally alongside the directory. Hidden from guests; collapsed by
          default so the directory stays the focus. */}
      <EmailMembersSection />

      <PeopleDirectory />
    </div>
  );
}
