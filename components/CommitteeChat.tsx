"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { readPersisted, writePersisted } from "@/lib/swrCache";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { MeetingSection } from "@/components/MeetingSection";
import { ChatPollSection } from "@/components/ChatPollSection";
import { ChatPollComposer } from "@/components/ChatPollComposer";
import { StickerArt } from "@/components/Stickers";
import { uploadToMini, compressImage } from "@/lib/media";
import { motion } from "framer-motion";
import { fetchJoinState } from "@/lib/roles";
import { useDebouncedCallback, useTypingChannel } from "@/lib/hooks";
import { TypingIndicator } from "@/components/TypingIndicator";
import { toggleReaction, reactionCounts } from "@/lib/reactions";
import { Lightbox } from "@/components/Lightbox";
import { formatDayHeading, formatClock, groupByDay, plural } from "@/lib/format";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

type Access = "loading" | "coming-soon" | "guest" | "member" | "pending" | "none" | "setup";

// Stale-while-revalidate cache for a committee chat, mirroring `useEvents`'
// `eventsCache` (see lib/hooks.ts). CommitteeChat remounts on every tab/room
// switch and re-entry; without this, access resets to "loading" (spinner, then a
// possible 🔒 flash before resolving to member) and the message list blanks until
// the refetch lands. Holding the last result in memory lets a returning room
// paint instantly from cache while loadAccess + refetchMessages run in the
// background and reconcile it. Keyed per room+channel+viewer so a preview-as or a
// different area can't read another view's snapshot. Memory-only (per session)
// and written ONLY inside effects after a client fetch — never during SSR/render
// — so a cold first render sees an empty map (the original default output) and
// can't cause a hydration mismatch. loadAccess still always runs and can DOWNGRADE
// a cached "member" to guest/pending/none, so a revoked permission never sticks.
interface RoomSnapshot {
  access: Access;
  committeeId: string | null;
  messages: Msg[];
  members: Member[];
}
const committeeChatCache = new Map<string, RoomSnapshot>();

// The persisted (cold-open) copy keeps only the tail of the conversation —
// what's on screen when a room opens — so a busy room can't blow the storage
// cap. The full history still loads from the server right behind it.
const CHAT_SNAPSHOT_MSGS = 30;

interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
interface ChatMedia {
  url: string; // mini URL (or, for old messages, a Tenor URL / sticker id)
  type: "image" | "video" | "sticker" | "gif" | "file";
  width?: number | null;
  height?: number | null;
  name?: string | null; // original filename, for "file" attachments
}
interface Msg {
  id: string;
  authorId: string;
  author: string;
  authorAvatar?: string | null;
  text?: string;
  ts: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyToId?: string | null;
  media: ChatMedia[];
  reactions: { userId: string; emoji: string }[];
  mentions: string[]; // user ids
}

// Authors can edit / delete their own message for this long after sending;
// admins are never limited (handled separately). Mirrors the DB policy in 0023.
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const within24h = (ts: string) => Date.now() - new Date(ts).getTime() < EDIT_WINDOW_MS;

// One pending attachment in the composer: a file uploaded on send. Photos and
// videos preview inline; anything else (PDFs, docs, …) shows as a file chip.
interface Pending {
  file: File;
  url: string; // object URL for the preview
  type: "image" | "video" | "file";
  name: string; // original filename
}

export function CommitteeChat({ slug, name, emoji, area = null, embedded = false, knownMember = false, readOnly = false }: { slug: string; name: string; emoji: string; area?: string | null; embedded?: boolean; knownMember?: boolean; readOnly?: boolean }) {
  const { user, userId, isAdmin, promptSignIn, previewAsId, previewMode } = useIdentity();
  const configured = isSupabaseConfigured;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Per-room+channel+VIEWER cache key. The viewer segment MUST include the real
  // signed-in identity (user?.email), not just previewAsId: this cache holds
  // private chat messages, and signOut() doesn't reload the page, so a key that
  // resolved to the same "self" for every account would let one member's cached
  // messages be served to the next person on a shared device. Empty map at
  // module-eval + null user/previewAsId during prerender ⇒ `cached` is undefined
  // on a cold first render, so the initializers below fall through to the exact
  // prior defaults and the server/first-paint HTML is unchanged.
  const key = `${slug}|${area ?? ""}|${user?.email ?? "guest"}|${previewAsId ?? "self"}`;
  const cached = committeeChatCache.get(key);

  const [uid, setUid] = useState<string | null>(null);
  const [committeeId, setCommitteeId] = useState<string | null>(cached?.committeeId ?? null);
  // When the caller already knows you're a member (the Feed only lists rooms you
  // belong to), open straight into the chat — no loading/lock flash on switch.
  // Prefer a warm cache (last-known access for this room) so a re-entry paints
  // immediately; still honor knownMember and the no-backend "coming-soon" case.
  // loadAccess still runs and self-corrects (incl. revoking a stale "member") in
  // the rare case it's wrong.
  const [access, setAccess] = useState<Access>(!configured ? "coming-soon" : cached?.access ?? (knownMember ? "member" : "loading"));
  const [requesting, setRequesting] = useState(false);

  const [messages, setMessages] = useState<Msg[]>(cached?.messages ?? []);
  const [members, setMembers] = useState<Member[]>(cached?.members ?? []);
  // Warm cache ⇒ already loaded, so the empty-state line + initial scroll behave.
  const [loaded, setLoaded] = useState(!!cached);

  // Write-through for the persisted room snapshot (`chatRoom.<uid>.<room>`,
  // lib/swrCache): last CHAT_SNAPSHOT_MSGS messages + access/roster, uid-scoped,
  // never while an admin previews. Wiped on signOut with the rest of the cache.
  const persistRoom = (snap: RoomSnapshot) => {
    const u = userIdRef.current;
    if (previewAsId || !u) return;
    writePersisted(`chatRoom.${u}.${slug}|${area ?? ""}`, {
      ...snap,
      messages: snap.messages.slice(-CHAT_SNAPSHOT_MSGS),
    });
  };

  // Cold-open seed (post-mount, hydration-safe): when the memory cache is cold,
  // restore the persisted snapshot so opening the app straight into a chat
  // paints the last-known conversation instead of a spinner. loadAccess still
  // re-derives access (and can DOWNGRADE it), and refetchMessages reconciles
  // the list right behind this.
  const roomSeededRef = useRef(false);
  useEffect(() => {
    if (roomSeededRef.current || previewAsId || !userId || committeeChatCache.has(key)) return;
    const snap = readPersisted<RoomSnapshot>(`chatRoom.${userId}.${slug}|${area ?? ""}`);
    if (!snap) return;
    roomSeededRef.current = true;
    committeeChatCache.set(key, snap);
    setCommitteeId(snap.committeeId);
    setAccess(snap.access);
    setMessages(snap.messages);
    setMembers(snap.members);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId, previewAsId]);

  // Composer
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [memberSheet, setMemberSheet] = useState<Member | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [pollComposing, setPollComposing] = useState(false);

  const libraryFileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const documentFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAttachMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachMenuOpen]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Whether the list is parked at the latest message. Tracked on scroll so the
  // re-pin logic below is timing-independent: it never has to measure *after* a
  // drawer/banner has already changed the layout (which would misread).
  const atBottomRef = useRef(true);
  const objectUrls = useRef<string[]>([]);
  const [debounceRefetch, cancelRefetch] = useDebouncedCallback(120);
  // Latest isAdmin, for the realtime callbacks below — they capture loadAccess
  // from an early render (when isAdmin was still resolving as false), so reading
  // the live ref prevents transiently downgrading an admin's access.
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;

  const isMember = access === "member";

  // Ephemeral "who's typing" on its OWN realtime channel (never touches the
  // message subscription); keyed per committee+area so each sub-channel is
  // separate. notifyTyping() is throttled inside the hook.
  const myName = members.find((m) => m.id === uid)?.name || "Someone";
  const { typers, notifyTyping } = useTypingChannel(uid && committeeId ? `committee:${slug}:${area ?? ""}` : null, uid, myName);

  // ── Who am I + do I have access? ───────────────────────────────────────────
  const loadAccess = async (id?: string | null) => {
    const sb = supabase;
    if (!sb) return;
    const cid = id ?? committeeId;
    if (!cid) return;
    // Set access AND write it to the cache so a re-entry paints this state right
    // away. This always overwrites the cached access — including DOWNGRADING a
    // stale "member" to guest/pending/none — so a revoked permission can't stick.
    const setAndCache = (a: Access) => {
      setAccess(a);
      const snap = { ...(committeeChatCache.get(key) ?? { messages: [], members: [] }), access: a, committeeId: cid };
      committeeChatCache.set(key, snap);
      persistRoom(snap);
    };
    // While previewing as a member, gate access as THEY would see it. The uid
    // comes from context (first-tick, no network); getSession is the local
    // fallback for the narrow window before the provider has stamped it.
    const me = previewAsId ?? userIdRef.current ?? (await sb.auth.getSession()).data.session?.user.id ?? null;
    setUid(me);
    if (!me) {
      setAndCache("guest");
      return;
    }
    if (isAdminRef.current) {
      setAndCache("member");
      return;
    }
    // "member" | "pending" | "none" are all valid Access states.
    setAndCache(await fetchJoinState(cid, me));
  };

  // Resolve the committee id from its slug, then load access. Realtime keeps
  // both access and messages live (e.g. an admin approving you flips you in).
  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setAccess("coming-soon");
      return;
    }
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      const { data, error } = await sb.from("committees").select("id").eq("slug", slug).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        // Table not migrated yet, or committee missing.
        setAccess("setup");
        return;
      }
      const cid = (data as { id: string }).id;
      setCommitteeId(cid);
      await loadAccess(cid);
      if (cancelled) return;

      const scheduleRefetch = () => debounceRefetch(() => void refetchMessages(cid));
      channel = sb
        .channel(`committee-chat-${slug}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_messages", filter: `committee_id=eq.${cid}` }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_message_media" }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_message_reactions" }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_message_mentions" }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_members", filter: `committee_id=eq.${cid}` }, () => loadAccess(cid))
        .on("postgres_changes", { event: "*", schema: "public", table: "committee_join_requests", filter: `committee_id=eq.${cid}` }, () => loadAccess(cid))
        .subscribe();
    })();
    return () => {
      cancelled = true;
      cancelRefetch();
      if (channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, previewAsId]);

  // Re-check access if admin status resolves after mount.
  useEffect(() => {
    if (committeeId && isAdmin) setAccess("member");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Load messages once we're a member.
  useEffect(() => {
    if (isMember && committeeId) void refetchMessages(committeeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMember, committeeId]);

  useEffect(() => () => objectUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const refetchMessages = async (cid: string) => {
    const sb = supabase;
    if (!sb) return;
    // Prefer the soft-delete column (migration 0023). If it isn't there yet the
    // select errors — fall back to the older columns so the chat still loads.
    // Scope to this channel: a role area, or the General channel (area IS NULL).
    const q1 = sb
      .from("committee_messages")
      .select("id, author_id, text, reply_to_id, created_at, edited_at, deleted_at")
      .eq("committee_id", cid);
    const withDel = await (area ? q1.eq("area", area) : q1.is("area", null)).order("created_at", { ascending: true });
    const q2 = sb
      .from("committee_messages")
      .select("id, author_id, text, reply_to_id, created_at, edited_at")
      .eq("committee_id", cid);
    const msgRows = withDel.error
      ? (await (area ? q2.eq("area", area) : q2.is("area", null)).order("created_at", { ascending: true })).data
      : withDel.data;
    const rows = (msgRows ?? []) as {
      id: string; author_id: string; text: string | null; reply_to_id: string | null; created_at: string; edited_at: string | null; deleted_at?: string | null;
    }[];
    const ids = rows.map((r) => r.id);

    // Media select prefers the file_name column (migration 0073). If that
    // migration isn't applied yet, selecting it errors — fall back to the older
    // columns so media still loads (never blank the chat on deploy ordering).
    const fetchMedia = async () => {
      if (!ids.length) return { data: [] as Record<string, unknown>[] };
      const withName = await sb.from("committee_message_media").select("message_id, storage_path, media_type, width, height, file_name, position").in("message_id", ids);
      if (!withName.error) return withName;
      return await sb.from("committee_message_media").select("message_id, storage_path, media_type, width, height, position").in("message_id", ids);
    };
    const [mediaRes, reactRes, mentionRes, profilesRes, rosterRes] = await Promise.all([
      fetchMedia(),
      ids.length ? sb.from("committee_message_reactions").select("message_id, user_id, emoji").in("message_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("committee_message_mentions").select("message_id, mentioned_user_id").in("message_id", ids) : Promise.resolve({ data: [] }),
      sb.from("profiles").select("id, display_name, avatar_url"),
      sb.from("committee_members").select("user_id, role").eq("committee_id", cid),
    ]);

    const names = new Map<string, string>();
    const avatars = new Map<string, string | null>();
    for (const p of (profilesRes.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      names.set(p.id, p.display_name?.trim() || "Member");
      avatars.set(p.id, p.avatar_url);
    }
    const roster: Member[] = ((rosterRes.data ?? []) as { user_id: string }[])
      .map((r) => ({ id: r.user_id, name: names.get(r.user_id) || "Member", avatarUrl: avatars.get(r.user_id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setMembers(roster);

    const mediaByMsg: Record<string, ChatMedia[]> = {};
    for (const m of (mediaRes.data ?? []) as { message_id: string; storage_path: string; media_type: string; width: number | null; height: number | null; file_name: string | null; position: number }[]) {
      (mediaByMsg[m.message_id] ||= []).push({
        url: m.storage_path,
        type: (["image", "video", "sticker", "gif", "file"].includes(m.media_type) ? m.media_type : "image") as ChatMedia["type"],
        width: m.width,
        height: m.height,
        name: m.file_name,
      });
    }
    const reactByMsg: Record<string, { userId: string; emoji: string }[]> = {};
    for (const r of (reactRes.data ?? []) as { message_id: string; user_id: string; emoji: string }[]) {
      (reactByMsg[r.message_id] ||= []).push({ userId: r.user_id, emoji: r.emoji });
    }
    const mentionByMsg: Record<string, string[]> = {};
    for (const m of (mentionRes.data ?? []) as { message_id: string; mentioned_user_id: string }[]) {
      (mentionByMsg[m.message_id] ||= []).push(m.mentioned_user_id);
    }

    const msgs: Msg[] = rows.map((r) => ({
      id: r.id,
      authorId: r.author_id,
      author: names.get(r.author_id) || "Member",
      authorAvatar: avatars.get(r.author_id) ?? null,
      text: r.text || undefined,
      ts: r.created_at,
      editedAt: r.edited_at,
      deletedAt: r.deleted_at,
      replyToId: r.reply_to_id,
      media: mediaByMsg[r.id] ?? [],
      reactions: reactByMsg[r.id] ?? [],
      mentions: mentionByMsg[r.id] ?? [],
    }));
    setMessages(msgs);
    setLoaded(true);
    // Persist this fresh snapshot so a re-entry paints the list instantly. Keep
    // the cached access (loadAccess owns it); reaching a successful member fetch
    // means access is "member", so record that too and stamp committeeId.
    const snap: RoomSnapshot = { access: "member", committeeId: cid, messages: msgs, members: roster };
    committeeChatCache.set(key, snap);
    persistRoom(snap);
    // Mark this channel read for me (per-area, migration 0063). Skip while
    // "view as" preview is active — the real admin's read row must not be
    // stamped by whatever the previewed member/guest opens.
    if (previewMode === "off") {
      const me = userIdRef.current ?? (await sb.auth.getSession()).data.session?.user.id;
      if (me) await sb.rpc("mark_area_read", { cid, p_area: area ?? null });
    }
  };

  // Smart auto-scroll: jump to the bottom on first load; SMOOTH-follow a new
  // message only when you're already at the bottom; if you've scrolled up to
  // read history, don't yank you — surface a tappable "new messages" pill.
  const [showJump, setShowJump] = useState(false);
  const prevLenRef = useRef(0);
  useEffect(() => {
    const prev = prevLenRef.current;
    prevLenRef.current = messages.length;
    if (messages.length === 0) return;
    if (prev === 0) {
      bottomRef.current?.scrollIntoView({ block: "end" }); // initial: jump
      return;
    }
    if (messages.length > prev) {
      if (atBottomRef.current) bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      else setShowJump(true);
    }
  }, [messages.length]);

  const jumpToBottom = () => {
    setShowJump(false);
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  // Spring-in for NEW messages only (see HouseChat for the rationale): the
  // initial batch mounts without animating (listReadyRef false through the first
  // render with messages), later arrivals mount with an entrance, and existing
  // rows keep their stable m.id key so a realtime refetch never re-animates.
  const listReadyRef = useRef(false);
  useEffect(() => {
    if (messages.length > 0) listReadyRef.current = true;
  }, [messages.length]);

  // Re-pin the list to the latest message — but only the inner scroller, never
  // the page (assigning scrollTop, not scrollIntoView, keeps the outer page
  // still). Called whenever something would otherwise push the bottom out of view.
  const repinIfAtBottom = () => {
    if (!atBottomRef.current) return;
    requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
  };

  // When the on-screen keyboard opens or closes the visual viewport resizes; if
  // we were already at the bottom, stay there so the latest message and what
  // you're typing never slide out of view behind the keyboard.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => repinIfAtBottom();
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening the reply banner, an attachment row, or the sticker/GIF drawer grows
  // the composer and shrinks the list. Re-pin so a drawer never hides the
  // message you were just reading (no-op if you'd scrolled up to an older one).
  useEffect(() => {
    repinIfAtBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, replyTo, editing]);

  // Grow the composer to fit what you type (one line up to a cap), so a line is
  // never clipped, and snap it back to one line after sending. Re-runs when the
  // chat first mounts so the empty box is sized right from the start.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isMember]);

  const msgById = useMemo(() => {
    const m = new Map<string, Msg>();
    for (const x of messages) m.set(x.id, x);
    return m;
  }, [messages]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const requestToJoin = async () => {
    if (!supabase || !committeeId) return;
    setRequesting(true);
    const note = `Hi! I'd like to join the ${name} committee.`;
    const { error } = await supabase.rpc("request_to_join", { cid: committeeId, msg: note });
    setRequesting(false);
    if (!error) setAccess("pending");
  };

  // Classify a File into how we preview + store it: photos/videos inline, and
  // anything else (PDFs, docs, …) as a generic "file".
  const pendingFromFile = (f: File): Pending => {
    const url = URL.createObjectURL(f);
    objectUrls.current.push(url);
    const type = f.type.startsWith("video") ? "video" : f.type.startsWith("image") ? "image" : "file";
    return { file: f, url, type, name: f.name || "file" };
  };
  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    setPending((p) => [...p, ...Array.from(list).map(pendingFromFile)]);
    e.target.value = "";
  };
  // Paste images/files straight from the clipboard, iMessage-style. Text pastes
  // fall through to the textarea. Not while editing (media isn't part of an edit).
  const onPasteComposer = (e: React.ClipboardEvent) => {
    if (editing) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    setPending((p) => [...p, ...files.map(pendingFromFile)]);
  };
  const removePending = (i: number) => setPending((p) => p.filter((_, idx) => idx !== i));

  const onComposerChange = (v: string) => {
    setText(v);
    if (v.trim()) notifyTyping();
    // Drop a mention id if its "@Name" was deleted from the text.
    if (mentionIds.length) {
      setMentionIds((ids) => ids.filter((id) => {
        const n = members.find((m) => m.id === id)?.name;
        return n ? v.includes(`@${n}`) : false;
      }));
    }
  };

  // Trailing "@token" → show the member picker.
  const mentionQuery = (() => {
    const m = /(?:^|\s)@(\S*)$/.exec(text);
    return m ? m[1].toLowerCase() : null;
  })();
  const mentionCandidates = mentionQuery !== null
    ? members.filter((m) => m.id !== uid && m.name.toLowerCase().includes(mentionQuery)).slice(0, 6)
    : [];
  const chooseMention = (m: Member) => {
    const at = text.lastIndexOf("@");
    setText(text.slice(0, at) + `@${m.name} `);
    setMentionIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id]));
  };

  // Editing changes text (+ its @mentions) only — media stays as it was — so a
  // non-empty text, or a message that still has its media, is enough to save.
  const canSend = editing
    ? (text.trim().length > 0 || editing.media.length > 0) && !sending && isMember
    : (text.trim().length > 0 || pending.length > 0) && !sending && isMember;

  const send = async () => {
    const sb = supabase;
    if (!sb || !committeeId || !uid || !canSend) return;
    setSending(true);
    setStatus(null);

    // ── Editing an existing message: update its text + @mentions in place. ──
    if (editing) {
      try {
        const { error: updErr } = await sb
          .from("committee_messages")
          .update({ text: text.trim() || null, edited_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (updErr) throw updErr;
        await sb.from("committee_message_mentions").delete().eq("message_id", editing.id);
        if (mentionIds.length) {
          await sb.from("committee_message_mentions").insert(mentionIds.map((id) => ({ message_id: editing.id, mentioned_user_id: id })));
        }
        setText(""); setMentionIds([]); setEditing(null);
        await refetchMessages(committeeId);
      } catch (err) {
        const m = err instanceof Error ? err.message : "please try again";
        setStatus(`Couldn't save the edit: ${m}`);
        window.setTimeout(() => setStatus(null), 6000);
      } finally {
        setSending(false);
      }
      return;
    }

    // ── New message — OPTIMISTIC. The bubble appears the instant you hit send
    // and the composer clears; the media (if any) uploads + inserts behind it,
    // then refetchMessages reconciles (the temp bubble is replaced by the real
    // row). On failure we roll the bubble back and restore the composer so a
    // send is never silently lost. (Moderation stays optimistic/async too — the
    // mini checks the media in the background and retroactively holds it via
    // migration 0128 if flagged.) ──
    const draftText = text.trim();
    const draftPending = pending;
    const draftMentions = mentionIds;
    const draftReply = replyTo;
    const me = members.find((mm) => mm.id === uid);
    const tempId = `temp-${Date.now()}`;
    const optimistic: Msg = {
      id: tempId,
      authorId: uid,
      author: me?.name || "You",
      authorAvatar: me?.avatarUrl ?? null,
      text: draftText || undefined,
      ts: new Date().toISOString(),
      replyToId: draftReply?.id ?? null,
      // Object-URL previews (revoked only on unmount) so photos show instantly too.
      media: draftPending.map((p) => ({ url: p.url, type: p.type, name: p.name })),
      reactions: [],
      mentions: [],
    };
    setMessages((prev) => [...prev, optimistic]);
    setText(""); setPending([]); setMentionIds([]); setReplyTo(null);
    atBottomRef.current = true; // follow the new bubble down

    try {
      const uploaded: ChatMedia[] = [];
      const token = (await sb.auth.getSession()).data.session?.access_token;
      for (const p of draftPending) {
        if (!token) throw new Error("Not signed in.");
        // Only photos are re-encoded; videos + files upload as-is.
        const f = p.type === "image" ? await compressImage(p.file) : p.file;
        const url = await uploadToMini(f, token, { category: "chat", room: slug });
        uploaded.push({ url, type: p.type, name: p.type === "file" ? p.name : undefined });
      }

      const { data: ins, error: insErr } = await sb
        .from("committee_messages")
        .insert({ committee_id: committeeId, author_id: uid, text: draftText || null, reply_to_id: draftReply?.id ?? null, area: area ?? null })
        .select("id")
        .single();
      if (insErr) throw insErr;
      const mid = (ins as { id: string }).id;

      if (uploaded.length) {
        const rows = uploaded.map((m, i) => ({ message_id: mid, storage_path: m.url, media_type: m.type, width: m.width ?? null, height: m.height ?? null, file_name: m.name ?? null, position: i }));
        const insMedia = await sb.from("committee_message_media").insert(rows);
        // Before migration 0073, file_name doesn't exist — retry without it so
        // photos/videos still attach (file-type sends need the migration).
        if (insMedia.error) await sb.from("committee_message_media").insert(rows.map(({ file_name, ...r }) => r));
      }
      if (draftMentions.length) {
        await sb.from("committee_message_mentions").insert(draftMentions.map((id) => ({ message_id: mid, mentioned_user_id: id })));
      }

      await refetchMessages(committeeId); // real row replaces the temp bubble
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(draftText); setPending(draftPending); setMentionIds(draftMentions); setReplyTo(draftReply);
      const m = err instanceof Error ? err.message : "please try again";
      setStatus(/max|size|large|exceed|413|payload/i.test(m) ? "That file was too big to send." : `Couldn't send: ${m}`);
      window.setTimeout(() => setStatus(null), 6000);
    } finally {
      setSending(false);
    }
  };

  const react = async (messageId: string, emoji: string) => {
    setReactingId(null);
    if (!supabase || !uid) return;
    const mine = messages.find((m) => m.id === messageId)?.reactions.find((r) => r.userId === uid)?.emoji ?? null;
    await toggleReaction({ table: "committee_message_reactions", idColumn: "message_id", itemId: messageId, userId: uid, emoji, current: mine });
    if (committeeId) await refetchMessages(committeeId);
  };

  // Soft delete: stamp deleted_at so the bubble becomes a "message deleted"
  // tombstone for everyone (the row stays so replies that quote it still resolve).
  // The DB policy (0023) enforces who may do this — author within 24h, admin
  // anytime. If you were editing this message, drop out of edit mode.
  const deleteMessage = async (id: string) => {
    if (!supabase || !committeeId) return;
    if (!window.confirm("Delete this message? It'll show as “message deleted”.")) return;
    if (editing?.id === id) cancelEdit();
    await supabase.from("committee_messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await refetchMessages(committeeId);
  };

  // Load a message into the composer to edit its text. Clears any reply/pending
  // so the composer is unambiguous, seeds the existing @mentions, and focuses.
  const startEdit = (m: Msg) => {
    setReactingId(null);
    setReplyTo(null);
    setPending([]);
    setEditing(m);
    setText(m.text ?? "");
    setMentionIds(m.mentions);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const cancelEdit = () => {
    setEditing(null);
    setText("");
    setMentionIds([]);
  };

  const scrollToMessage = (id: string) => {
    document.getElementById(`cmsg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Deep-link from the Notifications tab (…/chat?m=<id>): once messages have
  // loaded, jump to the mentioned message (slightly after the initial
  // scroll-to-bottom so this wins). Reads the query in-effect (client-only).
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const focus = new URLSearchParams(window.location.search).get("m");
    if (!focus) return;
    const t = setTimeout(() => scrollToMessage(focus), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Start a reply: show the reply banner and focus the composer so the keyboard
  // opens predictably. The banner-grow re-pin (above) keeps the latest message
  // in view if you were at the bottom, and leaves your position alone if you'd
  // scrolled up to reply to an older message.
  const startReply = (m: Msg) => {
    setReplyTo(m);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Wrap content in the full-screen ChatShell, or — when embedded in the Feed
  // tab — a plain inline column (the Feed's pills are the nav, so no header/back).
  const wrap = (subtitle: string, body: React.ReactNode) =>
    embedded ? (
      <div className="flex h-full min-h-0 flex-col">{body}</div>
    ) : (
      <ChatShell slug={slug} name={name} emoji={emoji} subtitle={subtitle}>
        {body}
      </ChatShell>
    );

  // While access is still resolving — including the brief moment after you flip
  // to another room — show a neutral spinner, never the lock card. (The gate
  // below uses a 🔒 for every non-member state, so falling through to it here
  // made a lock flash on every chat switch.)
  if (access === "loading") {
    return wrap("Committee chat", (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" aria-label="Loading" />
      </div>
    ));
  }

  // ── Gates (non-member states) ───────────────────────────────────────────────
  if (access !== "member") {
    return wrap("Committee chat", (
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
              {access === "pending" ? "⏳" : "🔒"}
            </div>
            {access === "coming-soon" || access === "setup" ? (
              <>
                <h2 className="text-lg font-bold">Committee chat is coming soon</h2>
                <p className="text-sm text-foreground/60">A private room for {name} members lands with the next update.</p>
              </>
            ) : access === "guest" ? (
              <>
                <h2 className="text-lg font-bold">{name} chat is for members</h2>
                <p className="text-sm text-foreground/65">Sign in — just your name &amp; email, no password — then ask to join this committee to see and post in its chat.</p>
                <button onClick={promptSignIn} className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white">Sign in</button>
              </>
            ) : access === "pending" ? (
              <>
                <h2 className="text-lg font-bold">Request sent ⏳</h2>
                <p className="text-sm text-foreground/60">An admin will approve you for the {name} chat. You&rsquo;ll drop right in once they do.</p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">Join {name} to chat</h2>
                <p className="text-sm text-foreground/60">This chat is private to {name} members. Ask to join — an admin will approve you.</p>
                <button onClick={requestToJoin} disabled={requesting} className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50">
                  {requesting ? "Sending…" : `📝 Request to join ${name}`}
                </button>
              </>
            )}
          </div>
        </div>
    ));
  }

  // ── The chat ─────────────────────────────────────────────────────────────────
  const dayGroups = groupByDay(messages, (m) => m.ts);

  return wrap(`${members.length} ${plural(members.length, "member")}`, (
    <>
      {/* Meeting scheduler — pinned above the messages so every member sees an
          open proposal; organizers (admin/lead) can start one. Only for a live
          (non-archived) room with a resolved committee id. */}
      {committeeId && !readOnly && (
        <>
          <MeetingSection scope={{ type: "committee", committeeId, slug, area }} members={members} />
          <ChatPollSection scope={{ type: "committee", committeeId, slug, area }} />
        </>
      )}
      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const sc = e.currentTarget;
          const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
          atBottomRef.current = atBottom;
          if (atBottom) setShowJump(false);
        }}
        className="h-full space-y-1 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {loaded && messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted">No messages yet — say hi to the {name} crew! 👋</p>
        )}
        {dayGroups.map((g) => (
          <div key={g.day} className="space-y-1">
            <div className="my-2 flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-faint">
              <span className="h-px flex-1 bg-border" />
              {formatDayHeading(g.day)}
              <span className="h-px flex-1 bg-border" />
            </div>
            {g.items.map((m, i) => {
              const prev = g.items[i - 1];
              const grouped = prev && prev.authorId === m.authorId && new Date(m.ts).getTime() - new Date(prev.ts).getTime() < 5 * 60 * 1000;
              return (
                <motion.div
                  key={m.id}
                  initial={listReadyRef.current ? { opacity: 0, y: 10 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                >
                  <MessageRow
                    m={m}
                    mine={m.authorId === uid}
                    grouped={!!grouped}
                    uid={uid}
                    canDelete={!m.deletedAt && ((m.authorId === uid && within24h(m.ts)) || isAdmin)}
                    canEdit={!m.deletedAt && m.authorId === uid && within24h(m.ts)}
                    reply={msgById.get(m.replyToId ?? "")}
                    members={members}
                    reacting={reactingId === m.id}
                    onOpenReact={() => setReactingId((cur) => (cur === m.id ? null : m.id))}
                    onReact={(e) => react(m.id, e)}
                    onReply={() => startReply(m)}
                    onEdit={() => startEdit(m)}
                    onDelete={() => deleteMessage(m.id)}
                    onOpenMember={(mm) => setMemberSheet(mm)}
                    onOpenPhoto={(u) => setLightbox(u)}
                    onJumpToReply={scrollToMessage}
                  />
                </motion.div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
        {showJump && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="press absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          >
            ↓ New messages
          </button>
        )}
      </div>

      {/* Composer — hidden for an archived (read-only) chat: the history stays
          readable, but a "deleted" committee/role can't take new messages
          (also enforced in RLS, migration 0112). */}
      {readOnly ? (
        <div className="shrink-0 border-t border-border bg-card px-4 py-3 text-center text-xs font-medium text-muted" style={embedded ? undefined : { paddingBottom: "env(safe-area-inset-bottom)" }}>
          🗄️ This chat is archived — you can read the history, but it&rsquo;s closed to new messages.
        </div>
      ) : (
      <div className="shrink-0 border-t border-border bg-card" style={embedded ? undefined : { paddingBottom: "env(safe-area-inset-bottom)" }}>
        <TypingIndicator names={typers} />
        {status && <p className="px-4 pt-2 text-center text-xs font-medium text-accent">{status}</p>}

        {editing && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <span className="h-8 w-0.5 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-primary">Editing message</p>
              <p className="truncate text-muted">{editing.text || replyPreview(editing)}</p>
            </div>
            <button onClick={cancelEdit} className="press shrink-0 text-foreground/40" aria-label="Cancel edit">✕</button>
          </div>
        )}

        {replyTo && !editing && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <span className="h-8 w-0.5 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-primary">Replying to {replyTo.authorId === uid ? "yourself" : replyTo.author}</p>
              <p className="truncate text-muted">{replyPreview(replyTo)}</p>
            </div>
            <button onClick={() => setReplyTo(null)} className="press shrink-0 text-foreground/40" aria-label="Cancel reply">✕</button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-2">
            {pending.map((p, i) => (
              <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-background ring-1 ring-border">
                {p.type === "video" && <video src={p.url} className="h-full w-full object-cover" muted playsInline />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.type === "image" && <img src={p.url} alt="" className="h-full w-full object-cover" />}
                {p.type === "file" && (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1">
                    <span className="text-xl leading-none">📄</span>
                    <span className="w-full truncate text-center text-[9px] text-foreground/60">{p.name}</span>
                  </div>
                )}
                <button onClick={() => removePending(i)} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white" aria-label="Remove">×</button>
              </div>
            ))}
          </div>
        )}

        {mentionCandidates.length > 0 && (
          <div className="border-b border-border px-2 py-1">
            {mentionCandidates.map((m) => (
              <button key={m.id} onClick={() => chooseMention(m)} className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background">
                <Avatar name={m.name} url={m.avatarUrl} size={24} />
                <span className="font-medium">{m.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5 px-2 py-2">
          {/* Editing changes text only — hide the attachment buttons so it's clear
              media isn't part of an edit (and to leave more room for the text). */}
          {!editing && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setAttachMenuOpen((o) => !o)}
                aria-label="Add a photo, video, document, or poll"
                aria-expanded={attachMenuOpen}
                className="press flex h-9 w-9 items-center justify-center rounded-full text-xl font-semibold leading-none text-foreground/55"
              >
                +
              </button>
              {attachMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAttachMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    style={{ transformOrigin: "bottom left" }}
                    className="absolute bottom-11 left-0 z-20 w-56 space-y-0.5 rounded-2xl bg-card p-1.5 shadow-lg ring-1 ring-border"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        libraryFileRef.current?.click();
                      }}
                      className="press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-background"
                    >
                      <span className="text-lg">🖼️</span> Photo &amp; Video Library
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        cameraFileRef.current?.click();
                      }}
                      className="press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-background"
                    >
                      <span className="text-lg">📷</span> Take Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        documentFileRef.current?.click();
                      }}
                      className="press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-background"
                    >
                      <span className="text-lg">📄</span> Document
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        setPollComposing(true);
                      }}
                      className="press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-background"
                    >
                      <span className="text-lg">🗳️</span> Poll
                    </button>
                  </motion.div>
                </>
              )}
              <input ref={libraryFileRef} type="file" multiple accept="image/*,video/*" onChange={pickFiles} className="hidden" />
              <input ref={cameraFileRef} type="file" accept="image/*" capture="environment" onChange={pickFiles} className="hidden" />
              <input ref={documentFileRef} type="file" multiple onChange={pickFiles} className="hidden" />
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onComposerChange(e.target.value)}
            onPaste={onPasteComposer}
            // Enter inserts a newline (too easy to send by accident otherwise) —
            // send with the button, or ⌘/Ctrl+Enter as a shortcut.
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
            placeholder={editing ? "Edit message…" : "Message…"}
            rows={1}
            enterKeyHint="enter"
            // text-base (≥16px) is required: iOS Safari auto-zooms any focused
            // input under 16px, which lurches the whole layout when you tap to type.
            // Height is auto-grown to fit the content (see the effect above) so a
            // line is never clipped; leading-snug keeps a single line tidy.
            className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl bg-background px-3 py-2 text-base leading-snug ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <button onClick={() => void send()} disabled={!canSend} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40" aria-label={editing ? "Save edit" : "Send"}>
            {sending ? "…" : editing ? "✓" : "➤"}
          </button>
        </div>
      </div>
      )}

      {lightbox && <Lightbox key={lightbox} url={lightbox} onClose={() => setLightbox(null)} z="z-[55]" />}
      {memberSheet && (
        <MemberSheet key={memberSheet.id} id={memberSheet.id} name={memberSheet.name} avatarUrl={memberSheet.avatarUrl} onClose={() => setMemberSheet(null)} />
      )}
      {pollComposing && committeeId && (
        <ChatPollComposer
          scope={{ type: "committee", committeeId, slug, area }}
          roomLabel={name}
          onClose={() => setPollComposing(false)}
          onCreated={() => setPollComposing(false)}
        />
      )}
    </>
  ));
}

// Full-screen conversation shell: a back button + committee header, then the
// children (message list + composer) fill the rest. Covers the page so the chat
// reads like opening a thread; the back link returns to the committee.
function ChatShell({ slug, name, emoji, subtitle, children }: { slug: string; name: string; emoji: string; subtitle?: string; children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // iOS Safari ignores `interactive-widget`, so the keyboard overlays the page
  // and a `position: fixed` composer ends up stranded behind it. Track the
  // visual viewport and size the shell to exactly the visible area (its height,
  // shifted by its offset) so the composer always rides just above the keyboard
  // — no page jumping. Falls back to the `h-[100dvh]` class before JS runs.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const el = rootRef.current;
    if (!vv || !el) return;
    const apply = () => {
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
  return (
    <div ref={rootRef} className="fixed inset-x-0 top-0 z-50 mx-auto flex h-[100dvh] max-w-md flex-col bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <Link href={`/committees/${slug}`} className="press -ml-1 flex h-11 w-11 items-center justify-center rounded-full text-xl text-foreground/60" aria-label="Back to committee">‹</Link>
        <span className="text-xl">{emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{name}</p>
          {subtitle && <p className="truncate text-xs text-faint">{subtitle}</p>}
        </div>
      </header>
      {children}
    </div>
  );
}

function replyPreview(m: Msg): string {
  if (m.deletedAt) return "message deleted";
  if (m.text) return m.text;
  const med = m.media[0];
  if (!med) return "Message";
  return med.type === "sticker" ? "Sticker" : med.type === "gif" ? "GIF" : med.type === "file" ? "📄 File" : med.type === "video" ? "🎬 Video" : "📷 Photo";
}

// Render message text with @mentions of known members highlighted.
function MessageText({ text, mentions, members }: { text: string; mentions: string[]; members: Member[] }) {
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

// One message: bubble + media + reactions, with swipe-right-to-reply and
// long-press-to-react (the iOS feel) handled by lightweight pointer gestures.
function MessageRow({
  m, mine, grouped, uid, canDelete, canEdit, reply, members, reacting,
  onOpenReact, onReact, onReply, onEdit, onDelete, onOpenMember, onOpenPhoto, onJumpToReply,
}: {
  m: Msg; mine: boolean; grouped: boolean; uid: string | null; canDelete: boolean; canEdit: boolean;
  reply?: Msg; members: Member[]; reacting: boolean;
  onOpenReact: () => void; onReact: (emoji: string) => void; onReply: () => void; onEdit: () => void; onDelete: () => void;
  onOpenMember: (m: Member) => void; onOpenPhoto: (url: string) => void; onJumpToReply: (id: string) => void;
}) {
  const [dx, setDx] = useState(0);
  // Which emoji's reactor list is expanded (tap a reaction pill to reveal who
  // reacted, mirroring the Posts feed). null = none shown.
  const [showReactors, setShowReactors] = useState<string | null>(null);
  const drag = useRef({ x0: 0, y0: 0, active: false, swiping: false });
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPress = () => { if (press.current) { clearTimeout(press.current); press.current = null; } };
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x0: e.clientX, y0: e.clientY, active: true, swiping: false };
    press.current = setTimeout(() => { onOpenReact(); clearPress(); }, 420);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const ddx = e.clientX - drag.current.x0;
    const ddy = e.clientY - drag.current.y0;
    if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) clearPress();
    if (Math.abs(ddx) > Math.abs(ddy) && ddx > 0) {
      drag.current.swiping = true;
      setDx(Math.min(80, ddx));
    }
  };
  const onUp = () => {
    clearPress();
    if (drag.current.swiping && dx > 52) onReply();
    drag.current.active = false;
    drag.current.swiping = false;
    setDx(0);
  };

  const counts = reactionCounts(m.reactions);
  const mineEmoji = m.reactions.find((r) => r.userId === uid)?.emoji ?? null;
  const onlySticker = m.media.length === 1 && (m.media[0].type === "sticker" || m.media[0].type === "gif") && !m.text;

  // Soft-deleted → a plain "message deleted" tombstone: no media, text,
  // reactions, or gestures, for everyone (the same whether an author or admin
  // removed it). The row stays so replies that quote it still resolve.
  if (m.deletedAt) {
    return (
      <div id={`cmsg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
        {!mine && <div className="mr-1.5 w-7 shrink-0" aria-hidden />}
        <div className="max-w-[78%] rounded-2xl bg-card px-3 py-2 text-sm italic text-faint ring-1 ring-border">
          🚫 message deleted
        </div>
      </div>
    );
  }

  return (
    <div id={`cmsg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
      {!mine && (
        <div className="mr-1.5 w-7 shrink-0 self-end">
          {!grouped && (
            <button onClick={() => onOpenMember({ id: m.authorId, name: m.author, avatarUrl: m.authorAvatar })} className="press">
              <Avatar name={m.author} url={m.authorAvatar} size={28} />
            </button>
          )}
        </div>
      )}

      <div
        className="relative max-w-[78%]"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform 200ms var(--ease-ios)" }}
      >
        {dx > 12 && <span className="absolute -left-7 top-1/2 -translate-y-1/2 text-primary" aria-hidden>↩︎</span>}

        {!mine && !grouped && <p className="mb-0.5 ml-1 inline-flex items-center text-xs font-semibold text-muted">{m.author}</p>}

        {reply && (
          <button onClick={() => onJumpToReply(reply.id)} className={`press mb-0.5 block w-full rounded-lg border-l-2 border-primary/60 px-2 py-1 text-left text-xs ${mine ? "bg-white/15" : "bg-background"}`}>
            <span className="font-semibold text-primary">{reply.authorId === uid ? "You" : reply.author}</span>
            <span className="ml-1 text-muted">{replyPreview(reply).slice(0, 60)}</span>
          </button>
        )}

        <div className={onlySticker ? "" : `rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-white" : "bg-card text-foreground ring-1 ring-border"}`}>
          {m.media.map((md, i) => (
            <div key={i} className={m.text || i > 0 ? "mb-1" : ""}>
              {md.type === "sticker" ? (
                <StickerArt id={md.url} size={128} />
              ) : md.type === "gif" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={md.url} alt="GIF" className="max-h-56 rounded-xl" />
              ) : md.type === "video" ? (
                <video src={md.url} controls playsInline className="max-h-60 rounded-xl" />
              ) : md.type === "file" ? (
                <a href={md.url} target="_blank" rel="noopener noreferrer" download={md.name ?? undefined} className={`press flex max-w-[15rem] items-center gap-2 rounded-xl px-3 py-2 ${mine ? "bg-white/15" : "bg-background ring-1 ring-border"}`}>
                  <span className="shrink-0 text-xl leading-none">📄</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{md.name || "File"}</span>
                  <span className={`shrink-0 text-xs ${mine ? "text-white/70" : "text-foreground/50"}`}>↓</span>
                </a>
              ) : (
                <button type="button" onClick={() => onOpenPhoto(md.url)} className="press block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={md.url} alt="" className="max-h-60 rounded-xl object-cover" />
                </button>
              )}
            </div>
          ))}
          {m.text && (
            <p className="whitespace-pre-wrap break-words">
              <MessageText text={m.text} mentions={m.mentions} members={members} />
            </p>
          )}
          <span className={`mt-0.5 block text-right text-[10px] ${mine ? "text-white/60" : "text-foreground/35"}`}>
            {formatClock(m.ts)}{m.editedAt ? " · edited" : ""}
          </span>
        </div>

        {counts.length > 0 && (() => {
          const reactors = showReactors ? m.reactions.filter((r) => r.emoji === showReactors) : [];
          const reactorName = (userId: string) => (userId === uid ? "You" : members.find((mm) => mm.id === userId)?.name || "Member");
          return (
            <>
              <div className={`mt-0.5 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
                {counts.map(([e, c]) => (
                  <button
                    key={e}
                    onClick={() => setShowReactors((cur) => (cur === e ? null : e))}
                    aria-label={`See who reacted ${e}`}
                    className={`rounded-full px-1.5 py-0.5 text-xs ring-1 ${mineEmoji === e ? "bg-primary/10 text-primary ring-primary/30" : "bg-background text-foreground/60 ring-border"} ${showReactors === e ? "ring-2 ring-primary/40" : ""}`}
                  >
                    {e} {c}
                  </button>
                ))}
              </div>
              {reactors.length > 0 && (
                <p className={`mt-1 text-xs leading-snug text-muted ${mine ? "text-right" : ""}`}>
                  <span className="mr-1">{showReactors}</span>
                  {reactors.map((r) => reactorName(r.userId)).join(", ")}
                </p>
              )}
            </>
          );
        })()}

        {reacting && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            style={{ transformOrigin: mine ? "bottom right" : "bottom left" }}
            className={`absolute z-10 -top-9 flex gap-0.5 rounded-full bg-background px-1.5 py-1 shadow-lg ring-1 ring-border ${mine ? "right-0" : "left-0"}`}
          >
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => onReact(e)} className="press rounded-full px-1 text-lg">{e}</button>
            ))}
            <button onClick={onReply} className="press rounded-full px-1 text-base" aria-label="Reply">↩︎</button>
            {canEdit && <button onClick={onEdit} className="press rounded-full px-1 text-base" aria-label="Edit">✏️</button>}
            {canDelete && <button onClick={onDelete} className="press rounded-full px-1 text-base" aria-label="Delete">🗑️</button>}
          </motion.div>
        )}
      </div>
    </div>
  );
}
