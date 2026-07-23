import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminMediaServer } from "@/components/AdminMediaServer";

export default function AdminSystemPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-2">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Media server</h1>
          <p className="text-sm text-foreground/60">
            The mac mini that handles push notifications, email, uploads, and moderation.
          </p>
        </header>
        <AdminMediaServer />
      </div>
    </AdminGuard>
  );
}
