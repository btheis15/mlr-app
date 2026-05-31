import { DinnerCrew } from "@/components/DinnerCrew";
import { DINNERS } from "@/lib/data";

export default function DinnersPage() {
  return (
    <div className="space-y-4 pt-1">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Dinners</h1>
        <p className="text-sm text-foreground/60">
          Each night a few houses team up. Tap a night for the menu, prep time, and who to call.
        </p>
      </header>
      <DinnerCrew dinners={DINNERS} />
    </div>
  );
}
