import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { NotificationTestView } from "@/components/NotificationTestView";

export default function AdminNotificationTestPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Notification Test</h1>
          <p className="text-sm text-foreground/60">
            Ping one member to check their settings, then check them off once
            you've seen it land on their phone.
          </p>
        </header>
        <NotificationTestView />
      </div>
    </AdminGuard>
  );
}
