"use client";

import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/types";
import { FAMILY_FEST } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { dayKey, formatDayHeading, formatClock, toDatetimeLocal, groupByDay } from "@/lib/format";
import { uploadToMini, compressImage } from "@/lib/media";
import { useMediaPicker, useDebouncedCallback } from "@/lib/hooks";
import { toggleReaction, reactionCounts } from "@/lib/reactions";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { Lightbox } from "@/components/Lightbox";

type MediaType = "image" | "video";
interface Media {
  url: string;
  type: MediaType;
  path?: string; // raw post_media.storage_path — lets the editor remove this item (absent for legacy image_path)
}
interface Tag {
  id: string;
  name: string;
}
interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface FeedPost {
  id: string;
  author: string;
  authorId?: string;
  authorAvatar?: string | null;
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
  authorAvatar?: string | null;
  authorId: string;
  text: string;
  ts: string;
  mentions: string[]; // tagged user ids
}

interface PostRow {
  id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  occurred_at?: string | null;
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
interface CommentMentionRow {
  comment_id: string;
  mentioned_user_id: string;
}

const LS = { hidden: "posts-hidden" };
// Legacy Supabase Storage bucket — kept only to *display* any media saved
// there before the move to the mini. New uploads never write here. (New media
// goes to the Mac-mini media server via lib/media's uploadToMini.)
const BUCKET = "post-photos";
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

// Member tag search: an empty query matches everyone; otherwise a substring, or
// any word that starts with what's typed ("b" → all B names).
function matchesName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const n = name.toLowerCase();
  return n.includes(q) || n.split(/\s+/).some((w) => w.startsWith(q));
}

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
  // Whether the DB has the occurred_at column yet (migration 0005). Until then
  // we fall back to created_at and hide the backdate controls.
  const [hasOccurredAt, setHasOccurredAt] = useState(false);

  const [text, setText] = useState("");
  const { files, previews, add: pickFiles, removeAt: removePreview, reset: resetMedia } = useMediaPicker();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [filterTaggedMe, setFilterTaggedMe] = useState(false);
  // Composer is collapsed by default (just the "Share something…" box); the
  // photo/tag/date controls reveal once it's focused.
  const [composerOpen, setComposerOpen] = useState(false);
  // Tap a member's avatar/name → their contact/pay popup.
  const [memberSheet, setMemberSheet] = useState<{ id: string; name: string; avatar?: string | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Which reaction chip is expanded to show who reacted ({postId, emoji}).
  const [reactorsFor, setReactorsFor] = useState<{ postId: string; emoji: string } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Composer "when": default off = posts as now(); on = backdate to this moment.
  const [customWhen, setCustomWhen] = useState(false);
  const [whenValue, setWhenValue] = useState("");
  // Which post is open in the consolidated editor (author/admin).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Timeline jump filter: "" = whole feed, else a "YYYY-MM" month or "YYYY-MM-DD" day.
  const [jump, setJump] = useState("");
  // Full-screen photo viewer (tap a photo to see the whole, uncropped image).
  // The Lightbox owns its open/close animation; keying it by url remounts it
  // cleanly when you tap from one photo straight to another.
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Deep-link from the Notifications tab (/posts?post=<id>): once the feed has
  // loaded, scroll that post into view and flash a ring around it. Reads the
  // query off window.location in-effect (client-only) to avoid pulling in
  // useSearchParams, which would force a Suspense boundary under static export.
  const [flashId, setFlashId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const [scheduleRefetch, cancelRefetch] = useDebouncedCallback(120);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const focus = new URLSearchParams(window.location.search).get("post");
    if (!focus) return;
    const el = document.getElementById(`post-${focus}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(focus);
    const t = setTimeout(() => setFlashId(null), 2200);
    return () => clearTimeout(t);
  }, [loaded]);

  // ---- Shared feed from the database ----
  const refetch = async () => {
    const sb = supabase;
    if (!sb) return;
    const others = Promise.all([
      sb.from("post_media").select("post_id, storage_path, media_type, position").order("position", { ascending: true }),
      sb.from("post_comments").select("id, post_id, text, created_at, author_id").order("created_at", { ascending: true }),
      sb.from("post_reactions").select("post_id, user_id, emoji"),
      sb.from("post_tags").select("post_id, tagged_user_id"),
      sb.from("post_comment_mentions").select("comment_id, mentioned_user_id"),
      sb.from("profiles").select("id, display_name, avatar_url"),
    ]);
    // Prefer the timeline anchor (occurred_at). If the migration hasn't run yet,
    // the column is missing — fall back to created_at so the feed still loads.
    const withOcc = await sb
      .from("posts")
      .select("id, text, image_path, created_at, occurred_at, author_id")
      .order("occurred_at", { ascending: false });
    let postRowsRaw: PostRow[];
    if (withOcc.error) {
      const base = await sb
        .from("posts")
        .select("id, text, image_path, created_at, author_id")
        .order("created_at", { ascending: false });
      postRowsRaw = (base.data ?? []) as unknown as PostRow[];
      setHasOccurredAt(false);
    } else {
      postRowsRaw = (withOcc.data ?? []) as unknown as PostRow[];
      setHasOccurredAt(true);
    }
    const [mediaRes, commentsRes, reactionsRes, tagsRes, commentMentionsRes, profilesRes] = await others;

    const names = new Map<string, string>();
    const avatars = new Map<string, string | null>();
    const memberList: Member[] = [];
    for (const p of (profilesRes.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      const n = p.display_name?.trim() || "Member";
      names.set(p.id, n);
      avatars.set(p.id, p.avatar_url);
      memberList.push({ id: p.id, name: n, avatarUrl: p.avatar_url });
    }
    memberList.sort((a, b) => a.name.localeCompare(b.name));
    setMembers(memberList);
    const nameOf = (id: string) => names.get(id) || "Member";
    const avatarOf = (id: string) => avatars.get(id) ?? null;

    const mediaByPost: Record<string, Media[]> = {};
    for (const m of (mediaRes.data ?? []) as unknown as MediaRow[]) {
      (mediaByPost[m.post_id] ||= []).push({
        url: m.storage_path.startsWith("http")
          ? m.storage_path
          : sb.storage.from(BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
        type: m.media_type === "video" ? "video" : "image",
        path: m.storage_path,
      });
    }

    const tagsByPost: Record<string, Tag[]> = {};
    for (const t of (tagsRes.data ?? []) as unknown as TagRow[]) {
      (tagsByPost[t.post_id] ||= []).push({ id: t.tagged_user_id, name: nameOf(t.tagged_user_id) });
    }

    const postRows = postRowsRaw;
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
          authorAvatar: avatarOf(r.author_id),
          ts: r.occurred_at || r.created_at,
          text: r.text || undefined,
          media,
          tags: tagsByPost[r.id] ?? [],
        };
      }),
    );

    const mentionsByComment: Record<string, string[]> = {};
    for (const m of (commentMentionsRes.data ?? []) as unknown as CommentMentionRow[]) {
      (mentionsByComment[m.comment_id] ||= []).push(m.mentioned_user_id);
    }

    const byPost: Record<string, CommentItem[]> = {};
    for (const c of (commentsRes.data ?? []) as unknown as CommentRow[]) {
      (byPost[c.post_id] ||= []).push({ id: c.id, author: nameOf(c.author_id), authorAvatar: avatarOf(c.author_id), authorId: c.author_id, text: c.text, ts: c.created_at, mentions: mentionsByComment[c.id] ?? [] });
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
    // Coalesce bursts of row events into a single refetch (the feed pulls ~6
    // queries each time), so a flurry of posts/reactions can't storm the DB.
    const fire = () => scheduleRefetch(() => void refetch());
    const ch = sb
      .channel("posts-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_media" }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comment_mentions" }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_reactions" }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_tags" }, fire)
      .subscribe();
    return () => {
      cancelRefetch();
      sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(LS.hidden) || "[]"));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) { try { localStorage.setItem(LS.hidden, JSON.stringify(hidden)); } catch { /* ignore */ } }
  }, [hidden, loaded]);

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
      setPosting(true);
      try {
        // Upload everything FIRST, so a failure can never leave a half-finished
        // post. Photos are compressed to web JPEGs (smaller + faster, fixes
        // HDR/HEIC display); videos upload as-is. All media goes to the Mac-mini
        // media server (no size cap); storage_path holds the full mini URL.
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("Not signed in.");
        const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1;
        let doneBytes = 0;
        setProgress(0);
        const uploaded: { path: string; type: MediaType }[] = [];
        for (let i = 0; i < files.length; i++) {
          const raw = files[i];
          const isVideo = raw.type.startsWith("video");
          const f = isVideo ? raw : await compressImage(raw);
          const path = await uploadToMini(f, token, {
            onProgress: (loaded, total) => {
              const frac = total ? loaded / total : 0;
              setProgress(Math.min(99, Math.round(((doneBytes + frac * raw.size) / totalBytes) * 100)));
            },
          });
          doneBytes += raw.size;
          uploaded.push({ path, type: isVideo ? "video" : "image" });
        }
        setProgress(100);
        // Backdate when the author chose a different moment (and the DB supports
        // it). Otherwise the column default now() lands the post today.
        const occurredAt =
          hasOccurredAt && customWhen && whenValue ? new Date(whenValue).toISOString() : null;
        const { data: np, error: insErr } = await supabase
          .from("posts")
          .insert({ author_id: uid, text: caption || null, ...(occurredAt ? { occurred_at: occurredAt } : {}) })
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
        setText(""); resetMedia(); setTagIds([]); setTagPickerOpen(false);
        setCustomWhen(false); setWhenValue(""); setComposerOpen(false);
        setStatus("Posted — everyone can see it now ✓");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "please try again";
        const friendly = /max|size|large|exceed|413|payload/i.test(msg) ? "that file was too big to upload." : msg;
        setStatus(`Couldn't post: ${friendly}`);
      } finally {
        setPosting(false);
        setProgress(null);
        window.setTimeout(() => setStatus(null), 7000);
      }
      return;
    }

    // ---- local fallback (no backend) ----
    const post: FeedPost = {
      id: `local-${Date.now()}`,
      author: user.name,
      ts: customWhen && whenValue ? new Date(whenValue).toISOString() : new Date().toISOString(),
      text: caption || undefined,
      media: previews,
      tags: tagIds.map((t) => ({ id: t, name: members.find((m) => m.id === t)?.name || "Member" })),
    };
    setAdded((prev) => [post, ...prev]);
    setText(""); resetMedia(); setTagIds([]); setTagPickerOpen(false);
    setCustomWhen(false); setWhenValue(""); setComposerOpen(false);
    setStatus("Posted to the feed ✓");
    window.setTimeout(() => setStatus(null), 7000);
  };

  const nameById = (id: string) => (id === uid ? "You" : members.find((m) => m.id === id)?.name || "Member");
  const openMember = (id: string | undefined, name: string, avatar?: string | null) => {
    if (id) setMemberSheet({ id, name, avatar });
  };
  const toggleReactors = (postId: string, emoji: string) =>
    setReactorsFor((cur) => (cur && cur.postId === postId && cur.emoji === emoji ? null : { postId, emoji }));
  const myReaction = (postId: string) => dbReactions[postId]?.find((r) => r.user_id === uid)?.emoji ?? null;
  const reactionSummary = (postId: string) => reactionCounts(dbReactions[postId] ?? []);
  const react = async (postId: string, emoji: string) => {
    setPickerFor(null);
    if (!supabase || !uid) { promptSignIn(); return; }
    await toggleReaction({ table: "post_reactions", idColumn: "post_id", itemId: postId, userId: uid, emoji, current: myReaction(postId) });
    await refetch();
  };

  const addComment = async (postId: string, body: string, mentionIds: string[] = []) => {
    const t = body.trim();
    if (!t) return;
    if (!supabase || !uid) { promptSignIn(); return; }
    const { data, error } = await supabase.from("post_comments").insert({ post_id: postId, author_id: uid, text: t }).select("id").single();
    if (error) return;
    const commentId = (data as { id: string } | null)?.id;
    if (commentId && mentionIds.length) {
      await supabase.from("post_comment_mentions").insert(mentionIds.map((id) => ({ comment_id: commentId, mentioned_user_id: id })));
    }
    await refetch();
  };
  const removeComment = async (commentId: string) => {
    if (!supabase) return;
    await supabase.from("post_comments").delete().eq("id", commentId);
    await refetch();
  };

  const canEditPost = (p: FeedPost) => configured && (isAdmin || (!!uid && p.authorId === uid));

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

  const tagMembers = members.filter((m) => matchesName(m.name, tagQuery));

  // ---- Timeline: sort newest-first, filter by the jump selection, group by day ----
  const sortedFeed = [...feed].sort((a, b) => new Date(b.post.ts).getTime() - new Date(a.post.ts).getTime());
  const monthsPresent = Array.from(new Set(sortedFeed.map(({ post }) => dayKey(post.ts).slice(0, 7)))); // already desc
  const filteredFeed = jump ? sortedFeed.filter(({ post }) => dayKey(post.ts).startsWith(jump)) : sortedFeed;
  const dayGroups = groupByDay(filteredFeed, (item) => item.post.ts);
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-5 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Posts</h1>
        <p className="text-sm text-foreground/60">Share photos &amp; videos with everyone — and out to the family Facebook group.</p>
        <a href={FAMILY_FEST.facebookGroupUrl} target="_blank" rel="noreferrer" className="press inline-block text-xs font-medium text-primary">
          Open the family Facebook group ↗
        </a>
      </header>

      <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setComposerOpen(true)}
          placeholder={user ? "Share something…" : "Add your name to post"}
          rows={composerOpen ? 2 : 1}
          className="w-full resize-none rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        {composerOpen && (
        <>
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
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white"
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

        {(!configured || hasOccurredAt) && (
          <div className="rounded-xl bg-background px-3 py-2.5 text-xs ring-1 ring-border">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={customWhen}
                onChange={(e) => { setCustomWhen(e.target.checked); if (e.target.checked && !whenValue) setWhenValue(toDatetimeLocal(new Date())); }}
                className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              />
              <span className="text-foreground/70">
                <span className="font-semibold text-foreground">Set the date &amp; time</span> — posting late? Place it back to when it happened so it flows in with the rest (e.g. lake day at 2pm).
                <span className="block text-foreground/45">Leave off to post as right now.</span>
              </span>
            </label>
            {customWhen && (
              <input
                type="datetime-local"
                value={whenValue}
                onChange={(e) => setWhenValue(e.target.value)}
                className="mt-2 w-full rounded-lg bg-card px-2 py-1.5 ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </div>
        )}

        {(() => {
          const big = files.find((f) => f.type.startsWith("video") && f.size > 150 * 1024 * 1024);
          return big ? (
            <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-foreground/70">
              🎬 Big video (~{Math.round(big.size / 1048576)} MB). It&rsquo;ll post at full quality, but may take a few minutes on slower Wi-Fi — a 1080p clip uploads much faster.
            </p>
          ) : null;
        })()}

        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="press rounded-full bg-background px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border">
            📷 Photos / video
          </button>
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={pickFiles} className="hidden" />
          <button type="submit" disabled={posting} className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {posting ? (progress != null ? `Posting… ${progress}%` : "Posting…") : "Post"}
          </button>
        </div>

        {posting && progress != null && (
          <div className="h-2 overflow-hidden rounded-full bg-background ring-1 ring-border" role="progressbar" aria-valuenow={progress}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        </>
        )}

        {status && <p className="rounded-xl bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">{status}</p>}
      </form>

      {configured && user && (
        <div className="flex gap-2 text-xs">
          <button onClick={() => setFilterTaggedMe(false)} className={`press rounded-full px-3 py-1.5 font-medium ${!filterTaggedMe ? "bg-primary text-white" : "bg-card text-foreground/60 ring-1 ring-border"}`}>
            Everyone
          </button>
          <button onClick={() => setFilterTaggedMe(true)} className={`press rounded-full px-3 py-1.5 font-medium ${filterTaggedMe ? "bg-primary text-white" : "bg-card text-foreground/60 ring-1 ring-border"}`}>
            🏷️ Tagged me
          </button>
        </div>
      )}

      {configured && feedLoaded && feed.length === 0 && (
        <p className="rounded-2xl bg-card p-6 text-center text-sm text-foreground/60 ring-1 ring-border">
          {filterTaggedMe ? "No posts you're tagged in yet." : "No posts yet — share the first photo! 📸"}
        </p>
      )}

      {/* Timeline jump: browse back by month, or pick an exact day */}
      {feed.length > 0 && (monthsPresent.length > 1 || jump) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button onClick={() => setJump("")} className={`press shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${!jump ? "bg-primary text-white" : "bg-card text-foreground/60 ring-1 ring-border"}`}>All</button>
            {monthsPresent.map((m) => (
              <button key={m} onClick={() => setJump(jump === m ? "" : m)} className={`press shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${jump === m ? "bg-primary text-white" : "bg-card text-foreground/60 ring-1 ring-border"}`}>
                {monthLabel(m)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground/55">
            <span>Jump to a day</span>
            <input type="date" value={jump.length === 10 ? jump : ""} onChange={(e) => setJump(e.target.value)} className="rounded-lg bg-card px-2 py-1 ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
            {jump && <button onClick={() => setJump("")} className="press font-medium text-primary">Clear</button>}
          </label>
        </div>
      )}

      {feed.length > 0 && filteredFeed.length === 0 && (
        <p className="rounded-2xl bg-card p-5 text-center text-sm text-foreground/60 ring-1 ring-border">
          Nothing posted on that day. <button onClick={() => setJump("")} className="press font-medium text-primary">Show all</button>
        </p>
      )}

      <div className="space-y-6">
        {dayGroups.map((g) => (
        <section key={g.day} className="space-y-3">
          <h2 className="flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-foreground/45">
            <span className="h-px flex-1 bg-border" />
            {formatDayHeading(g.day)}
            <span className="h-px flex-1 bg-border" />
          </h2>
          <ul className="space-y-3">
        {g.items.map(({ post: p, isAdded }, i) => {
          const summary = reactionSummary(p.id);
          const mine = myReaction(p.id);
          const postComments = dbComments[p.id] ?? [];
          return (
            <li key={p.id} id={`post-${p.id}`} style={{ "--i": Math.min(i, 8) } as React.CSSProperties} className={`rise overflow-hidden rounded-2xl bg-card transition-shadow ${flashId === p.id ? "ring-2 ring-primary" : "ring-1 ring-border"}`}>
              <div className="flex items-center gap-2 px-4 pt-3">
                <button type="button" onClick={() => openMember(p.authorId, p.author, p.authorAvatar)} className="press flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Avatar name={p.author} url={p.authorAvatar} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.author}</p>
                    <p className="text-[11px] text-foreground/40">{formatClock(p.ts)}</p>
                  </div>
                </button>
                {canEditPost(p) ? (
                  <button onClick={() => setEditingId(editingId === p.id ? null : p.id)} className="press shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/40 hover:text-primary" aria-label="Edit post">
                    {editingId === p.id ? "Close" : "Edit"}
                  </button>
                ) : canDeletePost(p, isAdded) ? (
                  <button onClick={() => deletePost(p, isAdded)} className="press shrink-0 rounded-full px-2 py-1 text-xs text-foreground/40 hover:text-primary" aria-label="Delete post">Delete</button>
                ) : null}
              </div>

              {editingId === p.id && (
                <EditPostPanel
                  post={p}
                  members={members}
                  uid={uid}
                  hasOccurredAt={hasOccurredAt}
                  onClose={() => setEditingId(null)}
                  onDelete={() => deletePost(p, isAdded)}
                  onSaved={refetch}
                />
              )}

              {p.text && <p className="px-4 pt-2 text-sm text-foreground/80">{p.text}</p>}
              {p.tags.length > 0 && (
                <p className="px-4 pt-1 text-xs text-primary">🏷️ with {p.tags.map((t, i) => (
                  <span key={t.id}>{i > 0 ? ", " : ""}<button type="button" onClick={() => openMember(t.id, t.name, members.find((m) => m.id === t.id)?.avatarUrl)} className="press font-medium underline decoration-primary/30">{t.name}</button></span>
                ))}</p>
              )}

              {p.media.length > 0 ? (
                <MediaCarousel media={p.media} onOpenPhoto={setLightbox} />
              ) : p.gradient ? (
                <div className={`mt-3 flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br text-5xl ${p.gradient}`}>{p.emoji}</div>
              ) : null}

              {summary.length > 0 && (
                <div className="px-4 pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.map(([emoji, count]) => {
                      const open = reactorsFor?.postId === p.id && reactorsFor.emoji === emoji;
                      return (
                        <button
                          key={emoji}
                          onClick={() => toggleReactors(p.id, emoji)}
                          className={`press rounded-full px-2 py-0.5 text-xs ring-1 ${mine === emoji ? "bg-primary/10 text-primary ring-primary/30" : "bg-background text-foreground/60 ring-border"} ${open ? "ring-2 ring-primary/50" : ""}`}
                          aria-label={`See who reacted ${emoji}`}
                        >
                          {emoji} {count}
                        </button>
                      );
                    })}
                  </div>
                  {reactorsFor?.postId === p.id && (
                    <p className="mt-1.5 text-xs text-foreground/55">
                      <span className="mr-1">{reactorsFor.emoji}</span>
                      {(dbReactions[p.id] ?? [])
                        .filter((r) => r.emoji === reactorsFor.emoji)
                        .map((r) => nameById(r.user_id))
                        .join(", ")}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-2 flex items-center gap-1 border-t border-border px-2 py-1.5 text-xs">
                <button onClick={() => setPickerFor(pickerFor === p.id ? null : p.id)} className={`press rounded-full px-3 py-1.5 font-medium ${mine ? "text-primary" : "text-foreground/55"}`} aria-expanded={pickerFor === p.id}>
                  {mine ? `${mine} Reacted` : "🙂 React"}
                </button>
                <span className="rounded-full px-3 py-1.5 text-foreground/55">💬 {postComments.length > 0 ? postComments.length : "Comment"}</span>
                <button onClick={() => shareOut(p)} className="press ml-auto rounded-full px-3 py-1.5 font-medium text-primary">Share ↗</button>
              </div>

              {pickerFor === p.id && (
                <div className="flex gap-1 border-t border-border px-2 py-2">
                  {REACTIONS.map((emoji) => (
                    <button key={emoji} onClick={() => react(p.id, emoji)} className={`press flex-1 rounded-xl py-2 text-2xl ring-1 ring-border ${mine === emoji ? "bg-primary/15" : "bg-background"}`} aria-label={`React ${emoji}`}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {(postComments.length > 0 || user) && (
                <div className="space-y-2 border-t border-border px-4 py-3">
                  {postComments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs">
                      <button type="button" onClick={() => openMember(c.authorId, c.author, c.authorAvatar)} className="press flex shrink-0 items-center gap-1.5">
                        <Avatar name={c.author} url={c.authorAvatar} size={22} />
                        <span className="font-semibold">{c.author}</span>
                      </button>
                      <span className="min-w-0 flex-1 text-foreground/75"><MentionText text={c.text} mentions={c.mentions} members={members} /></span>
                      {(isAdmin || (!!uid && c.authorId === uid)) && (
                        <button onClick={() => removeComment(c.id)} className="press shrink-0 text-foreground/30 hover:text-primary" aria-label="Delete comment">✕</button>
                      )}
                    </div>
                  ))}
                  <CommentBox members={members} uid={uid} onAdd={(t, ids) => addComment(p.id, t, ids)} />
                </div>
              )}
            </li>
          );
        })}
          </ul>
        </section>
        ))}
      </div>

      {lightbox && <Lightbox key={lightbox} url={lightbox} onClose={() => setLightbox(null)} />}

      {memberSheet && (
        <MemberSheet key={memberSheet.id} id={memberSheet.id} name={memberSheet.name} avatarUrl={memberSheet.avatar} onClose={() => setMemberSheet(null)} />
      )}
    </div>
  );
}

// One subtle "Edit" opens this — change the text, add/remove photos & videos,
// add/remove tags, move the date, or delete — all in one place so the card
// itself stays clean. Saves as a diff (RLS lets the author update the post and
// insert/delete its media + tags).
function EditPostPanel({
  post,
  members,
  uid,
  hasOccurredAt,
  onClose,
  onDelete,
  onSaved,
}: {
  post: FeedPost;
  members: Member[];
  uid: string | null;
  hasOccurredAt: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [text, setText] = useState(post.text ?? "");
  const [tagIds, setTagIds] = useState<string[]>(post.tags.map((t) => t.id));
  const [removed, setRemoved] = useState<string[]>([]); // existing media storage_paths to drop
  const { files, previews, add: addFiles, removeAt: removePreview } = useMediaPicker();
  const [whenValue, setWhenValue] = useState(toDatetimeLocal(post.ts));
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const keptMedia = post.media.filter((m) => !(m.path && removed.includes(m.path)));
  const toggleTag = (id: string) => setTagIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const tagMembers = members.filter((m) => matchesName(m.name, tagQuery));

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    setErr(null);
    try {
      await supabase
        .from("posts")
        .update({ text: text.trim() || null, ...(hasOccurredAt && whenValue ? { occurred_at: new Date(whenValue).toISOString() } : {}) })
        .eq("id", post.id);
      for (const path of removed) {
        await supabase.from("post_media").delete().eq("post_id", post.id).eq("storage_path", path);
      }
      if (files.length) {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("Not signed in.");
        let pos = post.media.length;
        for (const raw of files) {
          const isVideo = raw.type.startsWith("video");
          const f = isVideo ? raw : await compressImage(raw);
          const url = await uploadToMini(f, token);
          await supabase.from("post_media").insert({ post_id: post.id, storage_path: url, media_type: isVideo ? "video" : "image", position: pos++ });
        }
      }
      const orig = post.tags.map((t) => t.id);
      const toAdd = tagIds.filter((id) => !orig.includes(id));
      const toRemove = orig.filter((id) => !tagIds.includes(id));
      if (toAdd.length) await supabase.from("post_tags").insert(toAdd.map((id) => ({ post_id: post.id, tagged_user_id: id })));
      for (const id of toRemove) await supabase.from("post_tags").delete().eq("post_id", post.id).eq("tagged_user_id", id);
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the changes.");
      setSaving(false);
    }
  };

  return (
    <div className="rise mx-4 mt-2 space-y-3 rounded-xl bg-background p-3 ring-1 ring-border">
      <p className="text-xs font-semibold text-foreground/70">Edit post</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Say something…" className="w-full resize-none rounded-lg bg-card px-2 py-1.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />

      {(keptMedia.length > 0 || previews.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {keptMedia.map((m, i) => (
            <div key={`k${i}`} className="relative aspect-square overflow-hidden rounded-lg bg-black/5 ring-1 ring-border">
              {m.type === "video" ? (
                <video src={m.url} className="h-full w-full object-cover" muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              )}
              {m.path && (
                <button type="button" onClick={() => setRemoved((r) => [...r, m.path!])} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white" aria-label="Remove">×</button>
              )}
            </div>
          ))}
          {previews.map((m, i) => (
            <div key={`n${i}`} className="relative aspect-square overflow-hidden rounded-lg bg-black/5 ring-1 ring-border">
              {m.type === "video" ? (
                <video src={m.url} className="h-full w-full object-cover" muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              )}
              <span className="absolute bottom-1 left-1 rounded bg-primary/80 px-1 py-0.5 text-[9px] font-medium text-white">new</span>
              <button type="button" onClick={() => removePreview(i)} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white" aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="press rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground/70 ring-1 ring-border">📷 Add photo / video</button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={addFiles} className="hidden" />
        <button type="button" onClick={() => setTagOpen((o) => !o)} className="press rounded-full bg-card px-3 py-1.5 text-xs font-medium text-primary ring-1 ring-border">🏷️ {tagIds.length ? `Tags (${tagIds.length})` : "Tag people"}</button>
      </div>

      {tagOpen && (
        <div className="space-y-2 rounded-lg bg-card p-2 ring-1 ring-border">
          <input value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="Search family…" className="w-full rounded-lg bg-background px-2 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {tagMembers.map((m) => {
              const on = tagIds.includes(m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggleTag(m.id)} className={`press flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs ${on ? "bg-primary/10 text-primary" : "text-foreground/70"}`}>
                  <span>{m.name}{m.id === uid ? " (you)" : ""}</span>
                  <span>{on ? "✓" : "+"}</span>
                </button>
              );
            })}
            {tagMembers.length === 0 && <p className="px-2 py-1 text-xs text-foreground/40">No matching members.</p>}
          </div>
        </div>
      )}

      {hasOccurredAt && (
        <label className="block text-xs text-foreground/60">
          <span className="font-medium text-foreground/70">Date &amp; time</span>
          <input type="datetime-local" value={whenValue} onChange={(e) => setWhenValue(e.target.value)} className="mt-1 w-full rounded-lg bg-card px-2 py-1.5 ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
        </label>
      )}

      {err && <p className="text-xs font-medium text-accent">{err}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={onDelete} className="press rounded-full px-2 py-1.5 text-xs font-medium text-foreground/45 hover:text-accent">Delete</button>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="press rounded-full px-3 py-1.5 text-xs font-medium text-foreground/55">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="press rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function MediaCarousel({ media, onOpenPhoto }: { media: Media[]; onOpenPhoto?: (url: string) => void }) {
  const [active, setActive] = useState(0);
  if (media.length === 1) return <div className="mt-3"><MediaItem m={media[0]} onOpen={onOpenPhoto} /></div>;
  return (
    <div className="relative mt-3">
      <div onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))} className="flex snap-x snap-mandatory overflow-x-auto">
        {media.map((m, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            <MediaItem m={m} onOpen={onOpenPhoto} />
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

function MediaItem({ m, onOpen }: { m: Media; onOpen?: (url: string) => void }) {
  // Uniform square frame so single posts and carousels line up cleanly. Photos
  // fill (cropped) but tap to see the whole image full-screen; videos fit on
  // black (never cropped) and play inline.
  if (m.type === "video") {
    return (
      <div className="aspect-square w-full bg-black">
        <video src={m.url} controls playsInline className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen?.(m.url)}
      className="press block aspect-square w-full cursor-zoom-in bg-black/5"
      aria-label="View full photo"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.url} alt="" className="h-full w-full object-cover" />
    </button>
  );
}

// Render comment text with @mentions of tagged members highlighted — mirrors
// CommitteeChat's MessageText so a tag reads the same in a comment as in chat.
function MentionText({ text, mentions, members }: { text: string; mentions: string[]; members: Member[] }) {
  const names = mentions.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => !!n);
  if (!names.length) return <>{text}</>;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(${names.sort((a, b) => b.length - a.length).map(esc).join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={key++} className="font-semibold text-primary">@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// Comment composer with inline @mention autocomplete — type "@" then a name to
// tag anyone in the family (same member list as post tagging). The chosen ids
// flow back through onAdd so addComment can write them to post_comment_mentions.
function CommentBox({ members, uid, onAdd }: { members: Member[]; uid: string | null; onAdd: (text: string, mentionIds: string[]) => void }) {
  const [v, setV] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);

  // Keep only mentions whose "@Name" is still present in the text.
  const liveMentions = (val: string) =>
    mentionIds.filter((id) => {
      const n = members.find((m) => m.id === id)?.name;
      return n ? val.includes(`@${n}`) : false;
    });

  const onChange = (val: string) => {
    setV(val);
    if (mentionIds.length) setMentionIds(liveMentions(val));
  };

  // A trailing "@token" opens the picker.
  const mentionQuery = (() => {
    const m = /(?:^|\s)@(\S*)$/.exec(v);
    return m ? m[1].toLowerCase() : null;
  })();
  const candidates = mentionQuery !== null
    ? members.filter((m) => m.id !== uid && matchesName(m.name, mentionQuery)).slice(0, 6)
    : [];
  const choose = (m: Member) => {
    const at = v.lastIndexOf("@");
    setV(v.slice(0, at) + `@${m.name} `);
    setMentionIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id]));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = v.trim();
    if (!text) return;
    onAdd(text, liveMentions(v));
    setV(""); setMentionIds([]);
  };

  return (
    <form onSubmit={submit} className="relative flex gap-2">
      {candidates.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-40 overflow-y-auto rounded-xl bg-card p-1 shadow-lg ring-1 ring-border">
          {candidates.map((m) => (
            <button key={m.id} type="button" onClick={() => choose(m)} className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-background">
              <Avatar name={m.name} url={m.avatarUrl} size={22} />
              <span className="font-medium">{m.name}</span>
            </button>
          ))}
        </div>
      )}
      <input value={v} onChange={(e) => onChange(e.target.value)} placeholder="Add a comment… (@ to tag)" className="flex-1 rounded-full bg-background px-3 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary" />
      <button type="submit" className="press rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">Send</button>
    </form>
  );
}
