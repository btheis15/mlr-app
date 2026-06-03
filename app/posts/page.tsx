import { PostsView } from "@/components/PostsView";
import { SignInWall } from "@/components/Guard";
import { POSTS } from "@/lib/data";

// The "Feed" tab — the shared resort feed (photos + notes). Members only.
// NOTE: the unified pills hub (Posts + committee chats in one tab) was rolled
// back to this proven-simple view after it failed to load on the installed iOS
// app; it's being rebuilt with a normal-flow layout. Committee chats remain
// available from each committee page's "Open chat".
export default function FeedPage() {
  return (
    <SignInWall
      title="Feed"
      note="Family posts are kept private. Add your name & email to see and share them."
    >
      <PostsView seed={POSTS} />
    </SignInWall>
  );
}
