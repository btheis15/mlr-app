import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminMembers } from "@/components/AdminMembers";
import { AdminProfileOverride } from "@/components/AdminProfileOverride";

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
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-foreground/50">
            Edit a member&rsquo;s information
          </p>
          <p className="px-1 text-xs text-foreground/50">
            Two-admin unlock · a backup for members who can&rsquo;t change their own.
          </p>
          <AdminProfileOverride />
        </div>
      </div>
    </AdminGuard>
  );
}
