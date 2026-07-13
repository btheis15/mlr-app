import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminInviteEmails } from "@/components/AdminInviteEmails";

export default function AdminInvitePage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Invite people</h1>
          <p className="text-sm text-foreground/60">
            A nice-looking welcome email that signs someone straight in — no
            code to type.
          </p>
        </header>
        <AdminInviteEmails />
      </div>
    </AdminGuard>
  );
}
