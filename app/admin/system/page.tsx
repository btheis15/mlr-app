"use client";

import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminMediaServer } from "@/components/AdminMediaServer";
import { useIdentity } from "@/components/IdentityProvider";
import { isOwner } from "@/lib/owner";

export default function AdminSystemPage() {
  const { user } = useIdentity();
  return (
    <AdminGuard>
      <div className="space-y-4 pt-2">
        <BackLink href="/admin" label="Admin" />
        {isOwner(user?.email) ? (
          <>
            <header className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Media server</h1>
              <p className="text-sm text-foreground/60">
                The mac mini that handles push notifications, email, uploads, and moderation.
              </p>
            </header>
            <AdminMediaServer />
          </>
        ) : (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-foreground/60 ring-1 ring-border">
            Not available.
          </p>
        )}
      </div>
    </AdminGuard>
  );
}
