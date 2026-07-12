import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminResortConfig } from "@/components/AdminResortConfig";

export default function AdminResortInfoPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Resort info</h1>
          <p className="text-sm text-foreground/60">
            The Help page&rsquo;s human contact, plus basic public resort info.
          </p>
        </header>
        <AdminResortConfig />
      </div>
    </AdminGuard>
  );
}
