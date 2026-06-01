"use client";

import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/types";
import { FAMILY_FEST } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { timeAgo } from "@/lib/format";

interface FeedPost {
  id: string;
  author: string;
  ts: string;
  text?: string;
  /** Runtime image (object URL) for photos the user just added. */
  imageUrl?: string;
  /** The original File, so we can share the real image to Facebook etc. */
  file?: File;
  /** Seed-only gradient tile. */
  gradient?: string;
  emoji?: string;
}

/**
 * The shared feed — one place to post a photo and/or a note, like a small
 * Facebook feed. Each post (and the composer) can share out to the family
 * Facebook group via the phone's native share sheet. No backend yet, so posts
 * you add are device-local for the session; the swap to a shared feed (everyone
 * sees them, under one login) is a drop-in later.
 */
export function PostsView({ seed }: { seed: Post[] }) {
  const { user, promptSignIn } = useIdentity();
  const [added, setAdded] = useState<FeedPost[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [alsoFacebook, setAlsoFacebook] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createdUrls = useRef<string[]>([]);

  useEffect(
    () => () => createdUrls.current.forEach((u) => URL.revokeObjectURL(u)),
    [],
  );

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    createdUrls.current.push(url);
    setFile(f);
    setPreviewUrl(url);
    e.target.value = "";
  };

  /**
   * Share a post out via the OS share sheet (Facebook app, Messages, etc.).
   * Falls back to opening the family Facebook group where file sharing isn't
   * supported. (Auto-posting straight into a FB group needs Meta app review.)
   */
  const shareOut = async (p: { text?: string; file?: File }) => {
    const nav = navigator as Navigator & {
      canShare?: (d?: ShareData) => boolean;
    };
    const data: ShareData = {
      title: FAMILY_FEST.shortName,
      text: p.text || FAMILY_FEST.shortName,
    };
    if (p.file) data.files = [p.file];
    if (nav.share && nav.canShare?.(data)) {
      try {
        await nav.share(data);
        return;
      } catch {
        return; // cancelled
      }
    }
    // Fallback (e.g. desktop / no share sheet): copy the caption so it's ready
    // to paste, then open the group to post.
    if (p.text) {
      try {
        await navigator.clipboard.writeText(p.text);
      } catch {
        /* clipboard unavailable */
      }
    }
    window.open(FAMILY_FEST.facebookGroupUrl, "_blank", "noreferrer");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      promptSignIn();
      return;
    }
    if (!text.trim() && !file) return;
    const post: FeedPost = {
      id: `local-${Date.now()}`,
      author: user.name,
      ts: new Date().toISOString(),
      text: text.trim() || undefined,
      imageUrl: previewUrl ?? undefined,
      file: file ?? undefined,
    };
    setAdded((prev) => [post, ...prev]);
    if (alsoFacebook) await shareOut(post);
    setText("");
    setFile(null);
    setPreviewUrl(null);
    setAlsoFacebook(false);
  };

  const feed: FeedPost[] = [...added, ...seed];

  return (
    <div className="space-y-5 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Posts</h1>
        <p className="text-sm text-foreground/60">
          Share a photo or a note with everyone — and out to the family Facebook group.
        </p>
        <a
          href={FAMILY_FEST.facebookGroupUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs font-medium text-primary"
        >
          Open the family Facebook group ↗
        </a>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={user ? "Share something…" : "Add your name to post"}
          rows={2}
          className="w-full resize-none rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        {previewUrl && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="max-h-56 w-full rounded-xl object-cover" />
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPreviewUrl(null);
              }}
              className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-1 text-xs font-medium text-white"
            >
              Remove
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-background px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border"
          >
            📷 Photo
          </button>
          <input ref={inputRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
          <button
            type="submit"
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white"
          >
            Post
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground/70">
          <input
            type="checkbox"
            checked={alsoFacebook}
            onChange={(e) => setAlsoFacebook(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          Also share to the family Facebook group
        </label>
        <p className="text-[11px] text-foreground/40">
          Posts are saved on this device for now — a shared feed everyone sees arrives with sign-in.
        </p>
      </form>

      <ul className="space-y-3">
        {feed.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <div className="flex items-center gap-2 px-4 pt-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {initials(p.author)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{p.author}</p>
                <p className="text-[11px] text-foreground/40">{timeAgo(p.ts)}</p>
              </div>
            </div>
            {p.text && <p className="px-4 pt-2 text-sm text-foreground/80">{p.text}</p>}
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" className="mt-3 w-full object-cover" />
            ) : p.gradient ? (
              <div
                className={`mt-3 flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br text-5xl ${p.gradient}`}
              >
                {p.emoji}
              </div>
            ) : null}
            <div className="flex justify-end px-4 py-2">
              <button
                onClick={() => shareOut(p)}
                className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
              >
                Share to Facebook ↗
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
