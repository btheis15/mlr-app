import { SCHEDULE } from "@/lib/data";
import { FestScheduleDetail } from "@/components/FestScheduleDetail";

// Static export (GitHub Pages) needs every dynamic route enumerated up front;
// the seed ids cover that. Live (DB-only) events resolve at request time on
// Vercel — the client component reads them from the shared content and uses the
// seed event passed below as the offline / pre-render fallback.
export function generateStaticParams() {
  return SCHEDULE.map((e) => ({ id: e.id }));
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fallback = SCHEDULE.find((e) => e.id === id) ?? null;
  return <FestScheduleDetail id={id} fallback={fallback} />;
}
