import { FestPlanner } from "@/components/FestPlanner";

/**
 * Family Fest Master Editor — the desktop, edit-everything-on-one-page view.
 * Same DB-backed content as the tabbed Planner, but rendered as a single
 * full-window document (FestPlanner's "page" variant) so bulk editing on a big
 * screen feels like working one master sheet. Access is enforced inside
 * FestPlanner (and by RLS server-side). This is what the iOS "full editor on the
 * web" link opens.
 */
export default function FamilyFestMasterEditorPage() {
  return <FestPlanner variant="page" />;
}
