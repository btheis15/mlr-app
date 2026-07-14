import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminCabinBookings } from "@/components/AdminCabinBookings";
import { AdminCabinDetails } from "@/components/AdminCabinDetails";

export default function AdminCabinsPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Cabin requests</h1>
          <p className="text-sm text-foreground/60">
            Approve room stay requests, and edit the cabins themselves.
          </p>
        </header>
        <AdminCabinDetails />
        <AdminCabinBookings />
      </div>
    </AdminGuard>
  );
}
