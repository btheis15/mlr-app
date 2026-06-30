import { DINNERS } from "@/lib/data";
import { FestDinnerDetail } from "@/components/FestDinnerDetail";

// Static export (GitHub Pages) needs every dynamic route enumerated up front;
// the seed ids cover that. Live (DB-only) dinners resolve at request time on
// Vercel — the client component reads them from the shared content and uses the
// seed dinner passed below as the offline / pre-render fallback.
export function generateStaticParams() {
  return DINNERS.map((d) => ({ id: d.id }));
}

export default async function DinnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fallback = DINNERS.find((d) => d.id === id) ?? null;
  return <FestDinnerDetail id={id} fallback={fallback} />;
}
