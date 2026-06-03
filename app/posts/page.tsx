import { FeedView } from "@/components/FeedView";
import { SignInWall } from "@/components/Guard";

// The "Feed" tab — the resort-wide Posts feed PLUS a live chat for each
// committee you're in, switchable by pills at the top (each with an unread
// badge). Members only: posts, photos, and committee chats stay behind sign-in.
export default function FeedPage() {
  return (
    <SignInWall
      title="Feed"
      note="Family posts and your committee chats are kept private. Add your name & email to see them."
    >
      <FeedView />
    </SignInWall>
  );
}
