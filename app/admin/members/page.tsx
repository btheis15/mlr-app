import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminMembers } from "@/components/AdminMembers";
import { AdminProfileOverride } from "@/components/AdminProfileOverride";
import { AdminRosterInvite } from "@/components/AdminRosterInvite";

export default function AdminMembersPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-sm text-foreground/60">
            Everyone signed in · make admins.
          </p>
        </header>
        <AdminMembers />

        <AdminRosterInvite />

        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Edit a member&rsquo;s information
          </p>
          <p className="px-1 text-xs text-muted">
            Two-admin unlock · a backup for members who can&rsquo;t change their own.
          </p>
          <AdminProfileOverride />
        </div>
      </div>
    </AdminGuard>
  );
}
