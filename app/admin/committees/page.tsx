import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminCommittees } from "@/components/AdminCommittees";

// AdminCommittees already mounts AdminJoinRequests per-committee (see
// components/AdminCommittees.tsx), so a single mount here covers both rosters
// and pending join requests.
export default function AdminCommitteesPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Committees & join requests</h1>
          <p className="text-sm text-foreground/60">
            Who&rsquo;s in each committee, plus the pending join-request queue.
          </p>
        </header>
        <AdminCommittees />
      </div>
    </AdminGuard>
  );
}
