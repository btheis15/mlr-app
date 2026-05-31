import { PhotosView } from "@/components/PhotosView";
import { MEMORIES } from "@/lib/data";

export default function PhotosPage() {
  return <PhotosView seed={MEMORIES} />;
}
