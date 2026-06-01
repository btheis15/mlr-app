import { PostsView } from "@/components/PostsView";
import { POSTS } from "@/lib/data";

// The shared feed — photos + notes, with share-to-Facebook. Replaces the
// separate Photos and Chat tabs.
export default function PostsPage() {
  return <PostsView seed={POSTS} />;
}
