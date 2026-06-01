"use client";

import { useEffect, useRef, useState } from "react";
import type { Post, PostComment } from "@/lib/types";
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
  /** Seed baseline like count. */
  likes?: number;
}

const LS = {
  shareFb: "posts-share-fb",
  liked: "posts-liked",
  comments: "posts-comments",
  hidden: "posts-hidden",
};

/**
 * The shared feed — post a photo and/or note, like, comment, and (optionally)
 * share out to the family Facebook group. No backend yet, so what you add /
 * like / comment / hide is device-local; it becomes a real shared feed (one
 * login, everyone sees it, with moderation) when the backend lands.
 */
export function PostsView({ seed }: { seed: Post[] }) {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const [added, setAdded] = useState<FeedPost[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [alsoFacebook, setAlsoFacebook] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, PostComment[]>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const createdUrls = useRef<string[]>([]);

  useEffect(() => {
    try {
      setAlsoFacebook(localStorage.getItem(LS.shareFb) === "1");
      setLiked(JSON.parse(localStorage.getItem(LS.liked) || "{}"));
      setComments(JSON.parse(localStorage.getItem(LS.comments) || "{}"));
      setHidden(JSON.parse(localStorage.getItem(LS.hidden) || "[]"));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  const persist = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    if (loaded) persist(LS.liked, liked);
  }, [liked, loaded]);
  useEffect(() => {
    if (loaded) persist(LS.comments, comments);
  }, [comments, loaded]);
  useEffect(() => {
    if (loaded) persist(LS.hidden, hidden);
  }, [hidden, loaded]);

  useEffect(
    () => () => createdUrls.current.forEach((u) => URL.revokeObjectURL(u)),
    [],
  );

  const setShareFb = (v: boolean) => {
    setAlsoFacebook(v);
    try {
      localStorage.setItem(LS.shareFb, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    createdUrls.current.push(url);
    setFile(f);
    setPreviewUrl(url);
    e.target.value = "";
  };

  const shareOut = async (p: { text?: string; file?: File }) => {
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    const data: ShareData = { title: FAMILY_FEST.shortName, text: p.text || FAMILY_FEST.shortName };
    if (p.file) data.files = [p.file];
    if (nav.share && nav.canShare?.(data)) {
      try {
        await nav.share(data);
        return;
      } catch {
        return;
      }
    }
    if (p.text) {
      try {
        await navigator.clipboard.writeText(p.text);
      } catch {
        /* ignore */
      }
    }
    window.open(FAMILY_FEST.facebookGroupUrl, "_blank", "noreferrer");
  };

  const submit = (e: React.FormEvent) => {
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
    setText("");
    setFile(null);
    setPreviewUrl(null);
    setStatus(
      alsoFacebook
        ? post.text
          ? "Posted to the app ✓ — caption copied. In Facebook: tap the post box, paste, add your photo, then post."
          : "Posted to the app ✓ — opening our Facebook group. Add your photo and post."
        : "Posted to the feed ✓",
    );
    window.setTimeout(() => setStatus(null), 7000);
    if (alsoFacebook) {
      // FB blocks pre-filling a post and auto-posting to a group, so make it
      // one-paste: copy the caption (text only — the clipboard can't carry the
      // photo too) and open the group. The photo's already in their camera roll.
      if (post.text) navigator.clipboard.writeText(post.text).catch(() => {});
      window.open(FAMILY_FEST.facebookGroupUrl, "_blank", "noreferrer");
    }
  };

  const toggleLike = (id: string) => {
    if (!user) return promptSignIn();
    setLiked((p) => ({ ...p, [id]: !p[id] }));
  };
  const addComment = (id: string, body: string) => {
    if (!user) return promptSignIn();
    const t = body.trim();
    if (!t) return;
    const c: PostComment = { id: `c-${Date.now()}`, author: user.name, text: t, ts: new Date().toISOString() };
    setComments((p) => ({ ...p, [id]: [...(p[id] || []), c] }));
  };
  const removeComment = (postId: string, cid: string) =>
    setComments((p) => ({ ...p, [postId]: (p[postId] || []).filter((c) => c.id !== cid) }));

  const canDeletePost = (p: FeedPost, isAdded: boolean) =>
    isAdmin || (isAdded && !!user && p.author === user.name);
  const deletePost = (p: FeedPost, isAdded: boolean) => {
    if (!window.confirm("Delete this post?")) return;
    if (isAdded) setAdded((prev) => prev.filter((x) => x.id !== p.id));
    else setHidden((prev) => [...prev, p.id]);
  };

  const feed: { post: FeedPost; isAdded: boolean }[] = [
    ...added.map((p) => ({ post: p, isAdded: true })),
    ...seed.filter((s) => !hidden.includes(s.id)).map((p) => ({ post: p as FeedPost, isAdded: false })),
  ];

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

        <label className="flex items-start gap-2 rounded-xl bg-background px-3 py-2.5 text-xs ring-1 ring-border">
          <input
            type="checkbox"
            checked={alsoFacebook}
            onChange={(e) => setShareFb(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
          />
          <span className="text-foreground/70">
            <span className="font-semibold text-foreground">Also share to our Facebook group</span> — post in both places.
            <span className="block text-foreground/45">
              We&rsquo;ll copy your caption &amp; open the group — paste it, add your photo (it&rsquo;s already in your camera roll), and tap Post. (We remember your choice.)
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-background px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border"
          >
            📷 Photo
          </button>
          <input ref={inputRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
          <button type="submit" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white">
            {alsoFacebook ? "Post + Facebook" : "Post"}
          </button>
        </div>

        {status && (
          <p className="rounded-xl bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">
            {status}
          </p>
        )}
        <p className="text-[11px] text-foreground/40">
          Posts, likes &amp; comments are saved on this device for now — a shared feed everyone sees arrives with sign-in.
        </p>
      </form>

      <ul className="space-y-3">
        {feed.map(({ post: p, isAdded }) => {
          const likeCount = (p.likes ?? 0) + (liked[p.id] ? 1 : 0);
          const postComments = comments[p.id] ?? [];
          return (
            <li key={p.id} className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
              <div className="flex items-center gap-2 px-4 pt-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {initials(p.author)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.author}</p>
                  <p className="text-[11px] text-foreground/40">{timeAgo(p.ts)}</p>
                </div>
                {canDeletePost(p, isAdded) && (
                  <button
                    onClick={() => deletePost(p, isAdded)}
                    className="shrink-0 rounded-full px-2 py-1 text-xs text-foreground/40 hover:text-primary"
                    aria-label="Delete post"
                  >
                    Delete
                  </button>
                )}
              </div>

              {p.text && <p className="px-4 pt-2 text-sm text-foreground/80">{p.text}</p>}
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="mt-3 w-full object-cover" />
              ) : p.gradient ? (
                <div className={`mt-3 flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br text-5xl ${p.gradient}`}>
                  {p.emoji}
                </div>
              ) : null}

              {/* actions */}
              <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 text-xs">
                <button
                  onClick={() => toggleLike(p.id)}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 font-medium ${
                    liked[p.id] ? "text-primary" : "text-foreground/55"
                  }`}
                  aria-pressed={!!liked[p.id]}
                >
                  {liked[p.id] ? "❤️" : "🤍"} {likeCount > 0 ? likeCount : "Like"}
                </button>
                <span className="flex items-center gap-1 rounded-full px-3 py-1.5 text-foreground/55">
                  💬 {postComments.length > 0 ? postComments.length : "Comment"}
                </span>
                <button
                  onClick={() => shareOut(p)}
                  className="ml-auto rounded-full px-3 py-1.5 font-medium text-primary"
                >
                  Share ↗
                </button>
              </div>

              {/* comments */}
              {(postComments.length > 0 || user) && (
                <div className="space-y-2 border-t border-border px-4 py-3">
                  {postComments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs">
                      <span className="font-semibold">{c.author}</span>
                      <span className="min-w-0 flex-1 text-foreground/75">{c.text}</span>
                      {(isAdmin || (user && c.author === user.name)) && (
                        <button
                          onClick={() => removeComment(p.id, c.id)}
                          className="shrink-0 text-foreground/30 hover:text-primary"
                          aria-label="Delete comment"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <CommentBox onAdd={(t) => addComment(p.id, t)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CommentBox({ onAdd }: { onAdd: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(v);
        setV("");
      }}
      className="flex gap-2"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Add a comment…"
        className="flex-1 rounded-full bg-background px-3 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <button type="submit" className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
        Send
      </button>
    </form>
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
