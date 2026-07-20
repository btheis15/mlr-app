import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminMembers } from "@/components/AdminMembers";
import { AdminProfileOverride } from "@/components/AdminProfileOverride";
import { AdminFamilyRoster } from "@/components/AdminFamilyRoster";

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

        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Family not on the app yet
          </p>
          <p className="px-1 text-xs text-muted">
            Set people up first — add them, assign a house — then invite when you&rsquo;re ready.
          </p>
          <AdminFamilyRoster />
        </div>

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
