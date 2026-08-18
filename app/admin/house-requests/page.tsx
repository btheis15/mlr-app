"use client";

import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminHouseRequests } from "@/components/AdminHouseRequests";

// Admin → House requests. The cross-house reviewer queue (migration 0195).
//
// A House Admin who ISN'T an app admin can't reach /admin/* at all (AdminGuard),
// so they review their own house's requests on /house/requests instead — the
// same split as a non-admin cabin approver, who works the queue on
// /request-stay rather than /admin/cabins (migration 0114).
export default function AdminHouseRequestsPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-2">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">🧾 House requests</h1>
          <p className="text-sm text-foreground/60">
            Ideas, things to buy, and reimbursements from every house. Approve, change, or deny — then mark what
            actually got ordered.
          </p>
        </header>
        <AdminHouseRequests />
      </div>
    </AdminGuard>
  );
}
