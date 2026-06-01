import { BackLink } from "@/components/BackLink";
import { PayView } from "@/components/PayView";
import { FAMILY_FEST, PAYEES } from "@/lib/data";

export default function PayPage() {
  return (
    <div className="space-y-3 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />

      {/* Dues at a glance */}
      <div className="rounded-2xl bg-primary/10 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Family Fest dues
        </p>
        <p className="mt-1 text-2xl font-bold text-primary">
          {FAMILY_FEST.dues.perAdult}
          <span className="text-sm font-medium text-foreground/60"> / adult {FAMILY_FEST.dues.per}</span>
        </p>
        <p className="text-xs text-foreground/60">Kids&rsquo; cost {FAMILY_FEST.dues.perKid}</p>
      </div>

      <PayView payees={PAYEES} />
    </div>
  );
}
