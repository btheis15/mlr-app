"use client";

import { SignInWall } from "@/components/Guard";
import { FestPhotos } from "@/components/FestPhotos";

/**
 * Photos — the fest album view. Members-only (posts are members-only in the DB
 * since the 0081 RLS lockdown), so the whole screen sits behind the same
 * SignInWall as /posts; the header lives inside the wall so a guest sees one
 * clear sign-in card, not two headings. Static-export safe: all client-side,
 * data resolves in FestPhotos.
 */
export default function FestPhotosPage() {
  return (
    <div className="space-y-4 pt-1">
      <SignInWall
        title="Photos"
        note="Family photos are kept private to members. Add your name & email to see them — no password, just a code we email you."
      >
        <header className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Photos</h1>
          <p className="text-sm text-foreground/60">
            Everything the family posted around fest week — post yours from the Feed and
            it lands here.
          </p>
        </header>
        <FestPhotos />
      </SignInWall>
    </div>
  );
}
