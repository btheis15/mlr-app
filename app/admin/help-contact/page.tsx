import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminHelpContact } from "@/components/AdminHelpContact";

export default function AdminHelpContactPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Help contact</h1>
          <p className="text-sm text-foreground/60">
            The real person the Help page tells people to text, call, or email
            when they&rsquo;re stuck.
          </p>
        </header>
        <AdminHelpContact />
      </div>
    </AdminGuard>
  );
}
