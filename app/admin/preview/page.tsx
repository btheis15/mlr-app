import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { PreviewAs } from "@/components/PreviewAs";

export default function AdminPreviewPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">View as</h1>
          <p className="text-sm text-foreground/60">
            Preview the app as a member or guest — device-local, never touches
            your real session.
          </p>
        </header>
        <PreviewAs />
      </div>
    </AdminGuard>
  );
}
