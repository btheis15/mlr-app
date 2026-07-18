import { SCHEDULE } from "@/lib/data";
import { FestScheduleDetail } from "@/components/FestScheduleDetail";

// Prerendered for every seed event id; a live (DB-only) event resolves at
// request time — the client component reads it from the shared content and
// uses the seed event passed below as the offline / pre-render fallback.
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
