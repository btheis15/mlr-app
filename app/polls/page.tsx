import { BackLink } from "@/components/BackLink";
import { PollsView } from "@/components/PollsView";

export const metadata = {
  title: "Polls — Muskellunge Lake Resort",
};

// The /polls screen — the family's voting booth (migration 0084). PollsView
// already wraps itself in a SignInWall (members-only, matches its RLS), so
// this page just supplies the drill-in chrome (back link + title) that
// PollsView doesn't carry on its own.
export default function PollsPage() {
  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />
      <h1 className="text-2xl font-bold tracking-tight">🗳️ Polls</h1>
      <PollsView />
    </div>
  );
}
