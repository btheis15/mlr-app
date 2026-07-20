import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminHouses } from "@/components/AdminHouses";

export default function AdminHousesPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Houses</h1>
          <p className="text-sm text-foreground/60">
            Create houses & assign members.
          </p>
        </header>
        <AdminHouses />
      </div>
    </AdminGuard>
  );
}
