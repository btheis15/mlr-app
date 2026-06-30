import { BackLink } from "@/components/BackLink";
import { CommitteeList } from "@/components/CommitteeList";

export default function CommitteesPage() {
  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/" label="Home" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Committees</h1>
        <p className="text-sm text-foreground/60">
          Volunteer groups that keep the resort running. Tap one to see who&rsquo;s on it.
        </p>
      </header>
      <CommitteeList />
    </div>
  );
}
