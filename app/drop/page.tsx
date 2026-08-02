"use client";

import { DropBoxes } from "@/components/DropBoxes";

// Drop Box (migration 0171) — a shared "dump the photos/videos here, everyone
// with the app can see them" folder; the account-free alternative to a Google
// Drive shared folder. One screen, switching between the list of folders and
// one open folder via a `?box=<id>` param (read client-side inside DropBoxes —
// no dynamic route segment needed, same idiom as /house's `?house=`). The
// shareable link is `/drop?box=<id>`. Members-only (DropBoxes wraps a
// SignInWall), so the whole thing is a client screen.
export default function DropPage() {
  return <DropBoxes />;
}
