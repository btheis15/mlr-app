import { FeedView } from "@/components/FeedView";
import { SignInWall } from "@/components/Guard";

// The "Feed" tab — the resort-wide Posts feed plus a live chat for each
// committee you're in, switchable by pills (v2: normal-flow layout, no overlay,
// no duplicate realtime banner — see FeedView). Members only.
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
