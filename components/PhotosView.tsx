"use client";

import { useEffect, useRef, useState } from "react";
import type { Memory } from "@/lib/types";
import { FAMILY_FEST } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { READ_ONLY } from "@/lib/features";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";

interface AddedPhoto {
  id: string;
  url: string;
  caption: string;
  /** Kept so we can share the actual image file via the native share sheet. */
  file: File;
}

/**
 * Shared album. Seed tiles are gradient placeholders (no image binaries in the
 * repo); photos the user adds are held as in-memory object URLs for this
 * session. There's no backend yet, so added photos are device- and
 * session-local — the upload button is wired so the real share/upload is a
 * drop-in later.
 */
export function PhotosView({ seed }: { seed: Memory[] }) {
  const { user, promptSignIn } = useIdentity();
  const [added, setAdded] = useState<AddedPhoto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track every object URL we create so we can revoke them once — on unmount.
  const createdUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => createdUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const next = files.map((file) => {
      const url = URL.createObjectURL(file);
      createdUrls.current.push(url);
      return { id: `local-${Date.now()}-${file.name}`, url, caption: "Just added", file };
    });
    setAdded((prev) => [...next, ...prev]);
    e.target.value = "";
  };

  /**
   * Share a photo out via the OS share sheet (Web Share API) — Instagram, the
   * Facebook app, Messages, etc. Where file sharing isn't supported, fall back
   * to opening the Facebook group.
   */
  const share = async (photo: AddedPhoto) => {
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    const data: ShareData = {
      files: [photo.file],
      title: FAMILY_FEST.shortName,
      text: `${FAMILY_FEST.shortName} 🎉`,
    };
    if (nav.share && nav.canShare?.(data)) {
      try {
        await nav.share(data);
        return;
      } catch {
        return; // user cancelled
      }
    }
    window.open(FAMILY_FEST.facebookGroupUrl, "_blank", "noreferrer");
  };

  return (
    <div className="space-y-6 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Photos</h1>
        <p className="text-sm text-foreground/60">
          One shared album for the whole fest.
        </p>
      </header>

      {READ_ONLY ? (
        <ComingSoonCTA
          icon="📷"
          title="Shared album is almost here"
          note="Soon everyone can add photos to one album. For now, here's a taste of the week."
        />
      ) : (
        <>
          <button
            onClick={() => (user ? inputRef.current?.click() : promptSignIn())}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
          >
            {user ? "📷 Add photos" : "Add your name & email to post photos"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPick}
            className="hidden"
          />
        </>
      )}

      {added.length > 0 && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-foreground/70">
          Added photos stay on this device for now — a shared upload is coming.
          Tap <span className="font-medium">Share ↗</span> to post one to
          Instagram, Facebook, or the family group.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {added.map((p) => (
          <figure
            key={p.id}
            className="overflow-hidden rounded-2xl ring-1 ring-border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.caption} className="aspect-square w-full object-cover" />
            <figcaption className="flex items-center justify-between gap-2 bg-card px-2 py-1.5 text-xs text-foreground/70">
              <span className="truncate">{p.caption}</span>
              <button
                onClick={() => share(p)}
                className="shrink-0 rounded-full bg-primary/10 px-2 py-1 font-medium text-primary"
              >
                Share ↗
              </button>
            </figcaption>
          </figure>
        ))}

        {seed.map((m) => (
          <figure
            key={m.id}
            className="overflow-hidden rounded-2xl ring-1 ring-border"
          >
            <div
              className={`flex aspect-square w-full items-center justify-center bg-gradient-to-br text-4xl ${m.gradient}`}
            >
              {m.emoji}
            </div>
            <figcaption className="bg-card px-2 py-1.5 text-xs text-foreground/70">
              {m.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
