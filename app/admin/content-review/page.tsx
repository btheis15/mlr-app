import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminModeration } from "@/components/AdminModeration";

export default function AdminContentReviewPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Content review</h1>
          <p className="text-sm text-foreground/60">
            Held & reported posts · blocked words.
          </p>
        </header>
        <AdminModeration />
      </div>
    </AdminGuard>
  );
}
