"use client";

import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/types";
import { FAMILY_FEST } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { timeAgo } from "@/lib/format";

interface FeedPost {
  id: string;
  author: string;
  authorId?: string; // DB posts — for author/admin delete
  ts: string;
  text?: string;
  imageUrl?: string; // public URL (DB) or object URL (local fallback)
  file?: File; // local fallback only (for the share sheet)
  gradient?: string; // seed only
  emoji?: string; // seed only
}

interface CommentItem {
  id: string;
  author: string;
  authorId: string;
  text: string;
  ts: string;
}

interface PostRow {
  id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  author_id: string;
  profiles: { display_name: string | null } | null;
}
interface CommentRow {
  id: string;
  post_id: string;
  text: string;
  created_at: string;
  author_id: string;
  profiles: { display_name: string | null } | null;
}
interface ReactionRow {
  post_id: string;
  user_id: string;
  emoji: string;
}

const LS = { shareFb: "posts-share-fb", hidden: "posts-hidden" };
const BUCKET = "post-photos";
/** Tappable reactions — Unicode, so each phone renders its own native emoji. */
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

/**
 * The shared feed. With the backend configured it's fully cross-device: posts,
 * photos (Storage), comments, and emoji reactions all live server-side with a
 * realtime subscription, so everyone with the link sees the same feed live.
 * Falls back to the original device-local posts when there's no backend.
 */
export function PostsView({ seed }: { seed: Post[] }) {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const configured = isSupabaseConfigured;

  const [uid, setUid] = useState<string | null>(null);
  const [dbPosts, setDbPosts] = useState<FeedPost[]>([]);
  const [dbComments, setDbComments] = useState<Record<string, CommentItem[]>>({});
  const [dbReactions, setDbReactions] = useState<Record<string, ReactionRow[]>>({});
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [added, setAdded] = useState<FeedPost[]>([]); // local fallback only

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [alsoFacebook, setAlsoFacebook] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const createdUrls = useRef<string[]>([]);

  // ---- Shared feed (posts + comments + reactions) from the database ----
  const refetch = async () => {
    const sb = supabase;
    if (!sb) return;
    const [postsRes, commentsRes, reactionsRes] = await Promise.all([
      sb
        .from("posts")
        .select("id, text, image_path, created_at, author_id, profiles(display_name)")
        .order("created_at", { ascending: false }),
      sb
        .from("post_comments")
        .select("id, post_id, text, created_at, author_id, profiles(display_name)")
        .order("created_at", { ascending: true }),
      sb.from("post_reactions").select("post_id, user_id, emoji"),
    ]);

    const postRows = (postsRes.data ?? []) as unknown as PostRow[];
    setDbPosts(
      postRows.map((r) => ({
        id: r.id,
        author: r.profiles?.display_name?.trim() || "Member",
        authorId: r.author_id,
        ts: r.created_at,
        text: r.text || undefined,
        imageUrl: r.image_path
          ? sb.storage.from(BUCKET).getPublicUrl(r.image_path).data.publicUrl
          : undefined,
      })),
    );

    const commentRows = (commentsRes.data ?? []) as unknown as CommentRow[];
    const byPost: Record<string, CommentItem[]> = {};
    for (const c of commentRows) {
      (byPost[c.post_id] ||= []).push({
        id: c.id,
        author: c.profiles?.display_name?.trim() || "Member",
        authorId: c.author_id,
        text: c.text,
        ts: c.created_at,
      });
    }
    setDbComments(byPost);

    const reactionRows = (reactionsRes.data ?? []) as unknown as ReactionRow[];
    const reByPost: Record<string, ReactionRow[]> = {};
    for (const r of reactionRows) (reByPost[r.post_id] ||= []).push(r);
    setDbReactions(reByPost);

    setFeedLoaded(true);
  };

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setFeedLoaded(true);
      return;
    }
    sb.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
    refetch();
    const ch = sb
      .channel("posts-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_reactions" }, () => refetch())
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- device-local bits: FB preference + hidden seed posts (fallback) ----
  useEffect(() => {
    try {
      setAlsoFacebook(localStorage.getItem(LS.shareFb) === "1");
      setHidden(JSON.parse(localStorage.getItem(LS.hidden) || "[]"));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) {
      try { localStorage.setItem(LS.hidden, JSON.stringify(hidden)); } catch { /* ignore */ }
    }
  }, [hidden, loaded]);
  useEffect(() => () => createdUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const setShareFb = (v: boolean) => {
    setAlsoFacebook(v);
    try { localStorage.setItem(LS.shareFb, v ? "1" : "0"); } catch { /* ignore */ }
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

  const openFacebook = (caption?: string) => {
    if (caption) navigator.clipboard.writeText(caption).catch(() => {});
    window.open(FAMILY_FEST.facebookGroupUrl, "_blank", "noreferrer");
  };

  const shareOut = async (p: { text?: string; file?: File }) => {
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    const data: ShareData = { title: FAMILY_FEST.shortName, text: p.text || FAMILY_FEST.shortName };
    if (p.file) data.files = [p.file];
    if (nav.share && nav.canShare?.(data)) {
      try { await nav.share(data); return; } catch { return; }
    }
    openFacebook(p.text);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { promptSignIn(); return; }
    if (!text.trim() && !file) return;
    const caption = text.trim();

    if (configured && supabase) {
      if (!uid) { setStatus("One sec — finishing sign-in. Try again."); return; }
      setPosting(true);
      try {
        let imagePath: string | null = null;
        if (file) {
          const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
          const path = `${uid}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
          if (upErr) throw upErr;
          imagePath = path;
        }
        const { error: insErr } = await supabase
          .from("posts")
          .insert({ author_id: uid, text: caption || null, image_path: imagePath });
        if (insErr) throw insErr;
        await refetch();
        setText(""); setFile(null); setPreviewUrl(null);
        if (alsoFacebook) openFacebook(caption);
        setStatus(
          alsoFacebook
            ? caption
              ? "Posted ✓ — caption copied. In Facebook: paste it, add your photo, post."
              : "Posted ✓ — opening our Facebook group. Add your photo and post."
            : "Posted — everyone can see it now ✓",
        );
      } catch (err) {
        setStatus(`Couldn't post: ${err instanceof Error ? err.message : "please try again"}`);
      } finally {
        setPosting(false);
        window.setTimeout(() => setStatus(null), 7000);
      }
      return;
    }

    // ---- local fallback (no backend) ----
    const post: FeedPost = {
      id: `local-${Date.now()}`,
      author: user.name,
      ts: new Date().toISOString(),
      text: caption || undefined,
      imageUrl: previewUrl ?? undefined,
      file: file ?? undefined,
    };
    setAdded((prev) => [post, ...prev]);
    setText(""); setFile(null); setPreviewUrl(null);
    if (alsoFacebook) openFacebook(caption);
    setStatus(alsoFacebook ? "Posted ✓ — caption copied for Facebook." : "Posted to the feed ✓");
    window.setTimeout(() => setStatus(null), 7000);
  };

  // ---- reactions (DB) ----
  const myReaction = (postId: string) =>
    dbReactions[postId]?.find((r) => r.user_id === uid)?.emoji ?? null;
  const reactionSummary = (postId: string) => {
    const counts: Record<string, number> = {};
    for (const r of dbReactions[postId] ?? []) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };
  const react = async (postId: string, emoji: string) => {
    setPickerFor(null);
    if (!supabase || !uid) { promptSignIn(); return; }
    if (myReaction(postId) === emoji) {
      await supabase.from("post_reactions").delete().eq("post_id", postId).eq("user_id", uid);
    } else {
      await supabase
        .from("post_reactions")
        .upsert({ post_id: postId, user_id: uid, emoji }, { onConflict: "post_id,user_id" });
    }
    await refetch();
  };

  // ---- comments (DB) ----
  const addComment = async (postId: string, body: string) => {
    const t = body.trim();
    if (!t) return;
    if (!supabase || !uid) { promptSignIn(); return; }
    await supabase.from("post_comments").insert({ post_id: postId, author_id: uid, text: t });
    await refetch();
  };
  const removeComment = async (commentId: string) => {
    if (!supabase) return;
    await supabase.from("post_comments").delete().eq("id", commentId);
    await refetch();
  };

  const canDeletePost = (p: FeedPost, isAdded: boolean) =>
    configured
      ? isAdmin || (!!uid && p.authorId === uid)
      : isAdmin || (isAdded && !!user && p.author === user.name);

  const deletePost = async (p: FeedPost, isAdded: boolean) => {
    if (!window.confirm("Delete this post?")) return;
    if (configured && supabase) {
      await supabase.from("posts").delete().eq("id", p.id);
      await refetch();
      return;
    }
    if (isAdded) setAdded((prev) => prev.filter((x) => x.id !== p.id));
    else setHidden((prev) => [...prev, p.id]);
  };

  const feed: { post: FeedPost; isAdded: boolean }[] = configured
    ? dbPosts.map((p) => ({ post: p, isAdded: false }))
    : [
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
          <button
            type="submit"
            disabled={posting}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {posting ? "Posting…" : alsoFacebook ? "Post + Facebook" : "Post"}
          </button>
        </div>

        {status && (
          <p className="rounded-xl bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">
            {status}
          </p>
        )}
        <p className="text-[11px] text-foreground/40">
          {configured
            ? "Photos, notes, reactions & comments are all shared with everyone, live."
            : "Posts are saved on this device for now — a shared feed everyone sees arrives with sign-in."}
        </p>
      </form>

      {configured && feedLoaded && feed.length === 0 && (
        <p className="rounded-2xl bg-card p-6 text-center text-sm text-foreground/60 ring-1 ring-border">
          No posts yet — share the first photo! 📸
        </p>
      )}

      <ul className="space-y-3">
        {feed.map(({ post: p, isAdded }) => {
          const summary = reactionSummary(p.id);
          const mine = myReaction(p.id);
          const postComments = dbComments[p.id] ?? [];
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

              {/* reaction summary */}
              {summary.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
                  {summary.map(([emoji, count]) => (
                    <span
                      key={emoji}
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                        mine === emoji
                          ? "bg-primary/10 text-primary ring-primary/30"
                          : "bg-background text-foreground/60 ring-border"
                      }`}
                    >
                      {emoji} {count}
                    </span>
                  ))}
                </div>
              )}

              {/* actions */}
              <div className="mt-2 flex items-center gap-1 border-t border-border px-2 py-1.5 text-xs">
                <button
                  onClick={() => setPickerFor(pickerFor === p.id ? null : p.id)}
                  className={`rounded-full px-3 py-1.5 font-medium ${mine ? "text-primary" : "text-foreground/55"}`}
                  aria-expanded={pickerFor === p.id}
                >
                  {mine ? `${mine} Reacted` : "🙂 React"}
                </button>
                <span className="rounded-full px-3 py-1.5 text-foreground/55">
                  💬 {postComments.length > 0 ? postComments.length : "Comment"}
                </span>
                <button
                  onClick={() => shareOut(p)}
                  className="ml-auto rounded-full px-3 py-1.5 font-medium text-primary"
                >
                  Share ↗
                </button>
              </div>

              {/* emoji picker */}
              {pickerFor === p.id && (
                <div className="flex gap-1 border-t border-border px-2 py-2">
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => react(p.id, emoji)}
                      className={`flex-1 rounded-xl py-2 text-2xl ring-1 ring-border ${
                        mine === emoji ? "bg-primary/15" : "bg-background"
                      }`}
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* comments */}
              {(postComments.length > 0 || user) && (
                <div className="space-y-2 border-t border-border px-4 py-3">
                  {postComments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs">
                      <span className="font-semibold">{c.author}</span>
                      <span className="min-w-0 flex-1 text-foreground/75">{c.text}</span>
                      {(isAdmin || (!!uid && c.authorId === uid)) && (
                        <button
                          onClick={() => removeComment(c.id)}
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
