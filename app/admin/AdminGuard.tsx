"use client";

import { useIdentity } from "@/components/IdentityProvider";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";

/**
 * Shared gate for every /admin/* page: while identity is still resolving
 * (`authReady` false) it shows a skeleton instead of flashing "Admins only";
 * once resolved, non-admins get a friendly card + a way back Home, and admins
 * see the real page. Keeps the isAdmin check + copy in one place instead of
 * repeating it on every sub-page (mirrors the useGuest()/Guard.tsx pattern).
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, authReady } = useIdentity();

  if (!authReady) {
    return (
      <div className="space-y-4 pt-6">
        <SkeletonList count={3} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4 pt-6">
        <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
            🛠️
          </div>
          <h1 className="text-xl font-bold">Admins only</h1>
          <p className="text-sm text-foreground/65">
            This area is for resort admins. If you think you should have
            access, ask an existing admin to promote you in Profile.
          </p>
        </div>
        <BackLink href="/" label="Home" />
      </div>
    );
  }

  return <>{children}</>;
}
