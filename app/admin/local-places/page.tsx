import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminLocalPlaces } from "@/components/AdminLocalPlaces";

export default function AdminLocalPlacesPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Local Places</h1>
          <p className="text-sm text-foreground/60">
            The nearby golf, food and coffee spots on the Local Places page. Edit
            any detail, add a place, reorder, hide or delete.
          </p>
        </header>
        <AdminLocalPlaces />
      </div>
    </AdminGuard>
  );
}
