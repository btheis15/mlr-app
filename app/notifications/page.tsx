import { NotificationsView } from "@/components/NotificationsView";
import { SignInWall } from "@/components/Guard";

// The "Activity" tab — a durable, Facebook-style feed of everything that
// happened involving you (comments, @mentions, reactions, new posts,
// committee approvals, admin broadcasts). Personal, so members only.
export default function NotificationsPage() {
  return (
    <SignInWall
      title="Notifications"
      note="Your notifications are personal. Add your name & email to see what's happened involving you."
    >
      <NotificationsView />
    </SignInWall>
  );
}
