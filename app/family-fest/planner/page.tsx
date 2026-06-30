import { FestPlanner } from "@/components/FestPlanner";

/**
 * Family Fest Planner — the admin/committee editor for the shared fest content.
 * Access is enforced inside FestPlanner (and by RLS server-side); this route is
 * just the entry point, themed by the /family-fest layout (parchment + Cinzel).
 */
export default function FamilyFestPlannerPage() {
  return <FestPlanner />;
}
