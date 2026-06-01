"use client";

import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/types";
import { FAMILY_FEST } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { timeAgo } from "@/lib/format";

type MediaType = "image" | "video";
interface Media {
  url: string;
  type: MediaType;
}
interface Tag {
  id: string;
  name: string;
}
interface Member {
  id: string;
  name: string;
}

interface FeedPost {
  id: string;
  author: string;
  authorId?: string;
  ts: string;
  text?: string;
  media: Media[];
  tags: Tag[];
  gradient?: string; // seed only (local fallback)
  emoji?: string;
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
}
interface CommentRow {
  id: string;
  post_id: string;
  text: string;
  created_at: string;
  author_id: string;
}
interface MediaRow {
  post_id: string;
  storage_path: string;
  media_type: string;
  position: number;
}
interface ReactionRow {
  post_id: string;
  user_id: string;
  emoji: string;
}
interface TagRow {
  post_id: string;
  tagged_user_id: string;
}

const LS = { shareFb: "posts-share-fb", hidden: "posts-hidden" };
const BUCKET = "post-photos";
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

/**
 * The shared feed — a little family social space. Posts carry multiple photos
 * and videos (swipeable carousel), tagged members, shared comments, and emoji
 * reactions, all live via Supabase. Names/tags resolve from a separate profiles
 * query (no PostgREST embed) so an ambiguous relationship can't blank the feed.
 */
export function PostsView({ seed }: { seed: Post[] }) {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const configured = isSupabaseConfigured;

  const [uid, setUid] = useState<string | null>(null);
  const [dbPosts, setDbPosts] = useState<FeedPost[]>([]);
  const [dbComments, setDbComments] = useState<Record<string, CommentItem[]>>({});
  const [dbReactions, setDbReactions] = useState<Record<string, ReactionRow[]>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [added, setAdded] = useState<FeedPost[]>([]); // local fallback only

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Media[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [filterTaggedMe, setFilterTaggedMe] = useState(false);
  const [alsoFacebook, setAlsoFacebook] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const createdUrls = useRef<string[]>([]);

  // ---- Shared feed from the database ----
  const refetch = async () => {
    const sb = supabase;
    if (!sb) return;
    const [postsRes, mediaRes, commentsRes, reactionsRes, tagsRes, profilesRes] = await Promise.all([
      sb.from("posts").select("id, text, image_path, created_at, author_id").order("created_at", { ascending: false }),
      sb.from("post_media").select("post_id, storage_path, media_type, position").order("position", { ascending: true }),
      sb.from("post_comments").select("id, post_id, text, created_at, author_id").order("created_at", { ascending: true }),
      sb.from("post_reactions").select("post_id, user_id, emoji"),
      sb.from("post_tags").select("post_id, tagged_user_id"),
      sb.from("profiles").select("id, display_name"),
    ]);

    const names = new Map<string, string>();
    const memberList: Member[] = [];
    for (const p of (profilesRes.data ?? []) as { id: string; display_name: string | null }[]) {
      const n = p.display_name?.trim() || "Member";
      names.set(p.id, n);
      memberList.push({ id: p.id, name: n });
    }
    memberList.sort((a, b) => a.name.localeCompare(b.name));
    setMembers(memberList);
    const nameOf = (id: string) => names.get(id) || "Member";

    const mediaByPost: Record<string, Media[]> = {};
    for (const m of (mediaRes.data ?? []) as unknown as MediaRow[]) {
      (mediaByPost[m.post_id] ||= []).push({
        url: sb.storage.from(BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
        type: m.media_type === "video" ? "video" : "image",
      });
    }

    const tagsByPost: Record<string, Tag[]> = {};
    for (const t of (tagsRes.data ?? []) as unknown as TagRow[]) {
      (tagsByPost[t.post_id] ||= []).push({ id: t.tagged_user_id, name: nameOf(t.tagged_user_id) });
    }

    const postRows = (postsRes.data ?? []) as unknown as PostRow[];
    setDbPosts(
      postRows.map((r) => {
        const media = mediaByPost[r.id]?.length
          ? mediaByPost[r.id]
          : r.image_path
            ? [{ url: sb.storage.from(BUCKET).getPublicUrl(r.image_path).data.publicUrl, type: "image" as const }]
            : [];
        return {
          id: r.id,
          author: nameOf(r.author_id),
          authorId: r.author_id,
          ts: r.created_at,
          text: r.text || undefined,
          media,
          tags: tagsByPost[r.id] ?? [],
        };
      }),
    );

    const byPost: Record<string, CommentItem[]> = {};
    for (const c of (commentsRes.data ?? []) as unknown as CommentRow[]) {
      (byPost[c.post_id] ||= []).push({ id: c.id, author: nameOf(c.author_id), authorId: c.author_id, text: c.text, ts: c.created_at });
    }
    setDbComments(byPost);

    const reByPost: Record<string, ReactionRow[]> = {};
    for (const r of (reactionsRes.data ?? []) as unknown as ReactionRow[]) (reByPost[r.post_id] ||= []).push(r);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "post_media" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_reactions" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_tags" }, () => refetch())
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (loaded) { try { localStorage.setItem(LS.hidden, JSON.stringify(hidden)); } catch { /* ignore */ } }
  }, [hidden, loaded]);
  useEffect(() => () => createdUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const setShareFb = (v: boolean) => {
    setAlsoFacebook(v);
    try { localStorage.setItem(LS.shareFb, v ? "1" : "0"); } catch { /* ignore */ }
  };

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const nf = [...files];
    const np = [...previews];
    for (const f of Array.from(list)) {
      const url = URL.createObjectURL(f);
      createdUrls.current.push(url);
      nf.push(f);
      np.push({ url, type: f.type.startsWith("video") ? "video" : "image" });
    }
    setFiles(nf);
    setPreviews(np);
    e.target.value = "";
  };
  const removePreview = (i: number) => {
    setFiles(files.filter((_, idx) => idx !== i));
    setPreviews(previews.filter((_, idx) => idx !== i));
  };
  const toggleTag = (id: string) => setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openFacebook = (caption?: string) => {
    if (caption) navigator.clipboard.writeText(caption).catch(() => {});
    window.open(FAMILY_FEST.facebookGroupUrl, "_blank", "noreferrer");
  };
  const shareOut = async (p: FeedPost) => {
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    const data: ShareData = { title: FAMILY_FEST.shortName, text: p.text || FAMILY_FEST.shortName };
    if (nav.share && nav.canShare?.(data)) {
      try { await nav.share(data); return; } catch { return; }
    }
    openFacebook(p.text);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { promptSignIn(); return; }
    if (!text.trim() && files.length === 0) return;
    const caption = text.trim();

    if (configured && supabase) {
      if (!uid) { setStatus("One sec — finishing sign-in. Try again."); return; }
      const MAX = 50 * 1024 * 1024; // Supabase free-tier per-file cap (~50 MB)
      const bigVideos = files.filter((f) => f.type.startsWith("video") && f.size > MAX);
      if (bigVideos.length) {
        setStatus(`Video too big (~50 MB max on our current plan): ${bigVideos.map((f) => f.name).join(", ")}. Trim it shorter for now — we're sorting out longer videos.`);
        window.setTimeout(() => setStatus(null), 9000);
        return;
      }
      setPosting(true);
      try {
        // Upload everything FIRST, so a failure can never leave a half-finished
        // post. Photos are compressed to web-friendly JPEGs (smaller + faster,
        // and fixes HDR/HEIC display).
        const uploaded: { path: string; type: MediaType }[] = [];
        for (let i = 0; i < files.length; i++) {
          const raw = files[i];
          const isVideo = raw.type.startsWith("video");
          const f = isVideo ? raw : await compressImage(raw);
          const ext = isVideo ? ((raw.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4") : "jpg";
          const path = `${uid}/${Date.now()}-${i}.${ext}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f);
          if (upErr) throw upErr;
          uploaded.push({ path, type: isVideo ? "video" : "image" });
        }
        const { data: np, error: insErr } = await supabase
          .from("posts")
          .insert({ author_id: uid, text: caption || null })
          .select("id")
          .single();
        if (insErr) throw insErr;
        const postId = (np as { id: string } | null)?.id;
        if (!postId) throw new Error("Could not create the post.");
        for (let i = 0; i < uploaded.length; i++) {
          const { error: medErr } = await supabase
            .from("post_media")
            .insert({ post_id: postId, storage_path: uploaded[i].path, media_type: uploaded[i].type, position: i });
          if (medErr) throw medErr;
        }
        if (tagIds.length) {
          const { error: tagErr } = await supabase
            .from("post_tags")
            .insert(tagIds.map((t) => ({ post_id: postId, tagged_user_id: t })));
          if (tagErr) throw tagErr;
        }
        await refetch();
        setText(""); setFiles([]); setPreviews([]); setTagIds([]); setTagPickerOpen(false);
        if (alsoFacebook) openFacebook(caption);
        setStatus(
          alsoFacebook
            ? caption
              ? "Posted ✓ — caption copied. In Facebook: paste it, add your photo, post."
              : "Posted ✓ — opening our Facebook group. Add your photo and post."
            : "Posted — everyone can see it now ✓",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "please try again";
        const friendly = /max|size|large|exceed|413|payload/i.test(msg) ? "a file was too big to upload (~50 MB max on our current plan)." : msg;
        setStatus(`Couldn't post: ${friendly}`);
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
      media: previews,
      tags: tagIds.map((t) => ({ id: t, name: members.find((m) => m.id === t)?.name || "Member" })),
    };
    setAdded((prev) => [post, ...prev]);
    setText(""); setFiles([]); setPreviews([]); setTagIds([]); setTagPickerOpen(false);
    if (alsoFacebook) openFacebook(caption);
    setStatus(alsoFacebook ? "Posted ✓ — caption copied for Facebook." : "Posted to the feed ✓");
    window.setTimeout(() => setStatus(null), 7000);
  };

  const myReaction = (postId: string) => dbReactions[postId]?.find((r) => r.user_id === uid)?.emoji ?? null;
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
      await supabase.from("post_reactions").upsert({ post_id: postId, user_id: uid, emoji }, { onConflict: "post_id,user_id" });
    }
    await refetch();
  };

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
    configured ? isAdmin || (!!uid && p.authorId === uid) : isAdmin || (isAdded && !!user && p.author === user.name);
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

  const shownPosts = configured && filterTaggedMe && uid ? dbPosts.filter((p) => p.tags.some((t) => t.id === uid)) : dbPosts;
  const feed: { post: FeedPost; isAdded: boolean }[] = configured
    ? shownPosts.map((p) => ({ post: p, isAdded: false }))
    : [
        ...added.map((p) => ({ post: p, isAdded: true })),
        ...seed
          .filter((s) => !hidden.includes(s.id))
          .map((s) => ({ post: { id: s.id, author: s.author, ts: s.ts, text: s.text, media: [], tags: [], gradient: s.gradient, emoji: s.emoji } as FeedPost, isAdded: false })),
      ];

  // Friendly search: empty shows everyone (including you); otherwise match a
  // substring or any word that starts with what you've typed ("b" → all B names).
  const tagMembers = members.filter((m) => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return true;
    const n = m.name.toLowerCase();
    return n.includes(q) || n.split(/\s+/).some((w) => w.startsWith(q));
  });

  return (
    <div className="space-y-5 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Posts</h1>
        <p className="text-sm text-foreground/60">Share photos &amp; videos with everyone — and out to the family Facebook group.</p>
        <a href={FAMILY_FEST.facebookGroupUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-primary">
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
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {previews.map((m, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-xl bg-black/5 ring-1 ring-border">
                {m.type === "video" ? (
                  <video src={m.url} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                )}
                {m.type === "video" && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">▶ Video</span>
                )}
                <button
                  type="button"
                  onClick={() => removePreview(i)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-base leading-none text-white"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tag people */}
        {configured && (
          <div className="space-y-2">
            {tagIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tagIds.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {members.find((m) => m.id === t)?.name || "Member"}
                    <button type="button" onClick={() => toggleTag(t)} aria-label="Remove tag" className="text-primary/60">×</button>
                  </span>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setTagPickerOpen((o) => !o)} className="text-xs font-medium text-primary">
              🏷️ {tagIds.length ? "Edit tags" : "Tag people"}
            </button>
            {tagPickerOpen && (
              <div className="space-y-2 rounded-xl bg-background p-2 ring-1 ring-border">
                <input
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  placeholder="Search family…"
                  className="w-full rounded-lg bg-card px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {tagMembers.map((m) => {
                    const on = tagIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleTag(m.id)}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs ${on ? "bg-primary/10 text-primary" : "text-foreground/70"}`}
                      >
                        <span>{m.name}{m.id === uid ? " (you)" : ""}</span>
                        <span>{on ? "✓" : "+"}</span>
                      </button>
                    );
                  })}
                  {tagMembers.length === 0 && <p className="px-2 py-1 text-xs text-foreground/40">No matching members.</p>}
                </div>
              </div>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 rounded-xl bg-background px-3 py-2.5 text-xs ring-1 ring-border">
          <input type="checkbox" checked={alsoFacebook} onChange={(e) => setShareFb(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]" />
          <span className="text-foreground/70">
            <span className="font-semibold text-foreground">Also share to our Facebook group</span> — post in both places.
            <span className="block text-foreground/45">We&rsquo;ll copy your caption &amp; open the group — paste it, add your photo (it&rsquo;s already in your camera roll), and tap Post.</span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full bg-background px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border">
            📷 Photos / video
          </button>
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={pickFiles} className="hidden" />
          <button type="submit" disabled={posting} className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {posting ? "Posting…" : alsoFacebook ? "Post + Facebook" : "Post"}
          </button>
        </div>

        {status && <p className="rounded-xl bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">{status}</p>}
      </form>

      {configured && user && (
        <div className="flex gap-2 text-xs">
          <button onClick={() => setFilterTaggedMe(false)} className={`rounded-full px-3 py-1.5 font-medium ${!filterTaggedMe ? "bg-primary text-white" : "bg-card text-foreground/60 ring-1 ring-border"}`}>
            Everyone
          </button>
          <button onClick={() => setFilterTaggedMe(true)} className={`rounded-full px-3 py-1.5 font-medium ${filterTaggedMe ? "bg-primary text-white" : "bg-card text-foreground/60 ring-1 ring-border"}`}>
            📸 Photos of me
          </button>
        </div>
      )}

      {configured && feedLoaded && feed.length === 0 && (
        <p className="rounded-2xl bg-card p-6 text-center text-sm text-foreground/60 ring-1 ring-border">
          {filterTaggedMe ? "No posts you're tagged in yet." : "No posts yet — share the first photo! 📸"}
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
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{initials(p.author)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.author}</p>
                  <p className="text-[11px] text-foreground/40">{timeAgo(p.ts)}</p>
                </div>
                {canDeletePost(p, isAdded) && (
                  <button onClick={() => deletePost(p, isAdded)} className="shrink-0 rounded-full px-2 py-1 text-xs text-foreground/40 hover:text-primary" aria-label="Delete post">Delete</button>
                )}
              </div>

              {p.text && <p className="px-4 pt-2 text-sm text-foreground/80">{p.text}</p>}
              {p.tags.length > 0 && (
                <p className="px-4 pt-1 text-xs text-primary">🏷️ with {p.tags.map((t) => t.name).join(", ")}</p>
              )}

              {p.media.length > 0 ? (
                <MediaCarousel media={p.media} />
              ) : p.gradient ? (
                <div className={`mt-3 flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br text-5xl ${p.gradient}`}>{p.emoji}</div>
              ) : null}

              {summary.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
                  {summary.map(([emoji, count]) => (
                    <span key={emoji} className={`rounded-full px-2 py-0.5 text-xs ring-1 ${mine === emoji ? "bg-primary/10 text-primary ring-primary/30" : "bg-background text-foreground/60 ring-border"}`}>
                      {emoji} {count}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-2 flex items-center gap-1 border-t border-border px-2 py-1.5 text-xs">
                <button onClick={() => setPickerFor(pickerFor === p.id ? null : p.id)} className={`rounded-full px-3 py-1.5 font-medium ${mine ? "text-primary" : "text-foreground/55"}`} aria-expanded={pickerFor === p.id}>
                  {mine ? `${mine} Reacted` : "🙂 React"}
                </button>
                <span className="rounded-full px-3 py-1.5 text-foreground/55">💬 {postComments.length > 0 ? postComments.length : "Comment"}</span>
                <button onClick={() => shareOut(p)} className="ml-auto rounded-full px-3 py-1.5 font-medium text-primary">Share ↗</button>
              </div>

              {pickerFor === p.id && (
                <div className="flex gap-1 border-t border-border px-2 py-2">
                  {REACTIONS.map((emoji) => (
                    <button key={emoji} onClick={() => react(p.id, emoji)} className={`flex-1 rounded-xl py-2 text-2xl ring-1 ring-border ${mine === emoji ? "bg-primary/15" : "bg-background"}`} aria-label={`React ${emoji}`}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {(postComments.length > 0 || user) && (
                <div className="space-y-2 border-t border-border px-4 py-3">
                  {postComments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs">
                      <span className="font-semibold">{c.author}</span>
                      <span className="min-w-0 flex-1 text-foreground/75">{c.text}</span>
                      {(isAdmin || (!!uid && c.authorId === uid)) && (
                        <button onClick={() => removeComment(c.id)} className="shrink-0 text-foreground/30 hover:text-primary" aria-label="Delete comment">✕</button>
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

function MediaCarousel({ media }: { media: Media[] }) {
  const [active, setActive] = useState(0);
  if (media.length === 1) return <div className="mt-3"><MediaItem m={media[0]} /></div>;
  return (
    <div className="relative mt-3">
      <div onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))} className="flex snap-x snap-mandatory overflow-x-auto">
        {media.map((m, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            <MediaItem m={m} />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        {media.map((_, i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ring-1 ring-black/10 ${i === active ? "bg-white" : "bg-white/50"}`} />
        ))}
      </div>
      <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">{active + 1}/{media.length}</div>
    </div>
  );
}

function MediaItem({ m }: { m: Media }) {
  // Uniform square frame so single posts and carousels line up cleanly. Photos
  // fill (cropped); videos fit on black (never cropped).
  if (m.type === "video") {
    return (
      <div className="aspect-square w-full bg-black">
        <video src={m.url} controls playsInline className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className="aspect-square w-full bg-black/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.url} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

function CommentBox({ onAdd }: { onAdd: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onAdd(v); setV(""); }} className="flex gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a comment…" className="flex-1 rounded-full bg-background px-3 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      <button type="submit" className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">Send</button>
    </form>
  );
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // never block posting on a compression hiccup
  }
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}
