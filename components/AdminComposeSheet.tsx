"use client";

import { Sheet } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { AdminAlertComposer } from "@/components/AdminAlertComposer";
import { AdminNotificationComposer } from "@/components/AdminNotificationComposer";
import { AdminCallouts } from "@/components/AdminCallouts";

/**
 * The admin broadcast tools, opened as a pop-up straight from the desktop
 * SideNav's "Admin" group — so an admin composes an alert / notification / Home
 * callout in place, without navigating away to /admin/alerts. Each tool is the
 * exact same self-contained component the Alerts page mounts (they carry their
 * own title + card + admin guard), just hosted in a Sheet (which is a centered
 * modal on desktop). Desktop-only in practice — the SideNav that opens it is
 * `hidden lg:flex`.
 */
export type AdminTool = "alert" | "notification" | "callouts";

const TITLES: Record<AdminTool, string> = {
  alert: "Post an alert",
  notification: "Send a notification",
  callouts: "Home callouts",
};

export function AdminComposeSheet({
  tool,
  onClose,
}: {
  tool: AdminTool;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="admin-compose-title"
      // The composers render their own visible titles (📣 / 🔔 / Home callouts),
      // so the sheet's own heading is screen-reader-only to avoid a duplicate —
      // the ✕ still sits in the header zone.
      header={
        <h2 id="admin-compose-title" className="sr-only">
          {TITLES[tool]}
        </h2>
      }
    >
      {tool === "alert" && <AdminAlertComposer />}
      {tool === "notification" && <AdminNotificationComposer />}
      {tool === "callouts" && <AdminCallouts />}
    </Sheet>
  );
}
