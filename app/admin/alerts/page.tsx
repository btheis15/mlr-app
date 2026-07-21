import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AdminAlertComposer } from "@/components/AdminAlertComposer";
import { AdminNotificationComposer } from "@/components/AdminNotificationComposer";
import { AdminCallouts } from "@/components/AdminCallouts";
import { AdminScheduledBroadcasts } from "@/components/AdminScheduledBroadcasts";

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
            Scheduled
          </p>
          <p className="px-1 text-xs text-muted">
            Alerts/notifications queued for a future send time.
          </p>
          <AdminScheduledBroadcasts />
        </div>

        {/* Both composers are one-off "fill it out, send it" forms with nothing
            to browse (unlike Home callouts below, a real list) — collapsed by
            default keeps the page from opening on two full forms at once. */}
        <CollapsibleSection
          title="Post an alert"
          icon="📣"
          subtitle="Banner notice to everyone (+ email)."
        >
          <AdminAlertComposer />
        </CollapsibleSection>

        <CollapsibleSection
          title="Send a notification"
          icon="🔔"
          subtitle="To everyone or admins · lands in their Activity tab."
        >
          <AdminNotificationComposer />
        </CollapsibleSection>

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
