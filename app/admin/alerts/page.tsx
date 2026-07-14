import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminAlertComposer } from "@/components/AdminAlertComposer";
import { AdminNotificationComposer } from "@/components/AdminNotificationComposer";
import { AdminCallouts } from "@/components/AdminCallouts";

export default function AdminAlertsPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Alerts & Notifications</h1>
          <p className="text-sm text-foreground/60">
            Reach everyone — a banner notice, or their Activity tab.
          </p>
        </header>

        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Post an alert
          </p>
          <p className="px-1 text-xs text-muted">
            Banner notice to everyone (+ email).
          </p>
          <AdminAlertComposer />
        </div>

        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Send a notification
          </p>
          <p className="px-1 text-xs text-muted">
            To everyone, beta testers, or admins · lands in their Activity tab.
          </p>
          <AdminNotificationComposer />
        </div>

        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Home callouts
          </p>
          <p className="px-1 text-xs text-muted">
            Swipeable cards stacked on Home above the Family Fest spotlight.
          </p>
          <AdminCallouts />
        </div>
      </div>
    </AdminGuard>
  );
}
