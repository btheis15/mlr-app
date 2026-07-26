import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AdminBroadcastComposer } from "@/components/AdminBroadcastComposer";
import { AdminCallouts } from "@/components/AdminCallouts";
import { AdminScheduledBroadcasts } from "@/components/AdminScheduledBroadcasts";
import { AdminTestNotification } from "@/components/AdminTestNotification";

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

        {/* One merged composer (banner / Activity tab / email are its three
            channel checkboxes) — replaces the old separate "Post an alert" +
            "Send a notification" forms. A one-off "fill it out, send it" form
            with nothing to browse (unlike Home callouts below, a real list),
            so it's collapsed by default. */}
        <CollapsibleSection
          title="Reach everyone"
          icon="📣"
          subtitle="Banner, Activity tab, and/or email — pick any combination."
        >
          <AdminBroadcastComposer />
        </CollapsibleSection>

        {/* At-will, single-member ping (migration 0156) — for checking one
            person's notification settings without alerting anyone else.
            Collapsed by default, same reasoning as "Reach everyone" above. */}
        <CollapsibleSection
          title="Test notifications"
          icon="🧪"
          subtitle="Ping one member to check their notification settings."
        >
          <AdminTestNotification />
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
