import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminSignins } from "@/components/AdminSignins";

export default function AdminSigninsPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Sign-ins</h1>
          <p className="text-sm text-foreground/60">
            Who joined & recent sign-ins.
          </p>
        </header>
        <AdminSignins />
      </div>
    </AdminGuard>
  );
}
