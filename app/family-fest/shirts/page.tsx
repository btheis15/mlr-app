import { BackLink } from "@/components/BackLink";
import { ShirtVoteView } from "@/components/ShirtVoteView";

/**
 * /family-fest/shirts — the t-shirt design vote front door. Inherits the
 * parchment/Renaissance .ff-section theme from the Family Fest layout. The page
 * is a thin server shell; the interactive gallery (tap-to-zoom + the hand-off to
 * the family's real Google Form) lives in ShirtVoteView.
 */
export default function ShirtVotePage() {
  return (
    <div className="space-y-3 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />
      <ShirtVoteView />
    </div>
  );
}
