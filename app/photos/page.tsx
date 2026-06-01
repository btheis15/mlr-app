import { PhotosView } from "@/components/PhotosView";
import { MEMORIES } from "@/lib/data";

// Top-level Photos tab — the shared album, reached from the bottom bar.
export default function PhotosPage() {
  return <PhotosView seed={MEMORIES} />;
}
