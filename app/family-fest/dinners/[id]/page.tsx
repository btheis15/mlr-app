import { DINNERS } from "@/lib/data";
import { FestDinnerDetail } from "@/components/FestDinnerDetail";

// Prerendered for every seed dinner id; a live (DB-only) dinner resolves at
// request time — the client component reads it from the shared content and
// uses the seed dinner passed below as the offline / pre-render fallback.
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
