import { AdminGuard } from "@/app/admin/AdminGuard";
import { BackLink } from "@/components/BackLink";
import { AdminEventChats } from "@/components/AdminEventChats";

export default function AdminEventChatsPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <BackLink href="/admin" label="Admin" />
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Event chats</h1>
          <p className="text-sm text-foreground/60">
            Reopen an archived event chat for a day or a week.
          </p>
        </header>
        <AdminEventChats />
      </div>
    </AdminGuard>
  );
}
