import { PostsView } from "@/components/PostsView";
import { SignInWall } from "@/components/Guard";
import { POSTS } from "@/lib/data";

// The shared feed — photos + notes, with share-to-Facebook. Replaces the
// separate Photos and Chat tabs. Members only: photos and posts of the family
// stay behind sign-in so they aren't public to strangers.
export default function PostsPage() {
  return (
    <SignInWall
      title="Posts"
      note="Family photos and posts are kept private. Add your name & email to see and share them."
    >
      <PostsView seed={POSTS} />
    </SignInWall>
  );
}
