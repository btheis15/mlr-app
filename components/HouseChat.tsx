"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { readPersisted, writePersisted } from "@/lib/swrCache";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { MeetingSection } from "@/components/MeetingSection";
import { StickerArt } from "@/components/Stickers";
import { uploadToMini, compressImage } from "@/lib/media";
import { useDebouncedCallback } from "@/lib/hooks";
import { toggleReaction, reactionCounts } from "@/lib/reactions";
import { Lightbox } from "@/components/Lightbox";
import { formatDayHeading, formatClock, groupByDay, plural } from "@/lib/format";

// House chat — a private room for one house's members (e.g. "MJT House"), mirroring
// CommitteeChat but for a SINGLE room (no area channels) and admin-assigned
// membership (no request-to-join: an admin puts you in a house). Access is gated
// in the DB by is_house_member() (migration 0065). Surfaced as a channel in the
// Feed tab (see FeedView).

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

type Access = "loading" | "coming-soon" | "guest" | "member" | "none" | "setup";

interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
interface ChatMedia {
  url: string;
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
  mentions: string[];
}

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const within24h = (ts: string) => Date.now() - new Date(ts).getTime() < EDIT_WINDOW_MS;

// A file staged in the composer, uploaded on send. Photos/videos preview
// inline; anything else (PDFs, docs, …) shows as a file chip.
interface Pending {
  file: File;
  url: string;
  type: "image" | "video" | "file";
  name: string;
}

// Stale-while-revalidate room snapshot, mirroring CommitteeChat's
// committeeChatCache: memory for in-session re-entries, plus a persisted
// tail-of-conversation copy (`houseChatRoom.<uid>.<slug>`, lib/swrCache) so a
// cold app open into the house chat paints the last-known messages instead of
// a spinner. Keyed per room+viewer (real identity — see CommitteeChat's key
// comment); memory writes happen only inside effects, never during SSR.
interface RoomSnapshot {
  access: Access;
  houseId: string | null;
  messages: Msg[];
  members: Member[];
}
const houseChatCache = new Map<string, RoomSnapshot>();
const CHAT_SNAPSHOT_MSGS = 30;

export function HouseChat({ slug, name, emoji, houseId: houseIdProp = null, embedded = false, knownMember = false }: { slug: string; name: string; emoji: string; houseId?: string | null; embedded?: boolean; knownMember?: boolean }) {
  const { user, userId, isAdmin, promptSignIn, previewAsId, previewMode } = useIdentity();
  const configured = isSupabaseConfigured;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const key = `${slug}|${user?.email ?? "guest"}|${previewAsId ?? "self"}`;
  const cached = houseChatCache.get(key);

  const [uid, setUid] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<string | null>(cached?.houseId ?? houseIdProp);
  const [access, setAccess] = useState<Access>(!configured ? "coming-soon" : cached?.access ?? (knownMember ? "member" : "loading"));

  const [messages, setMessages] = useState<Msg[]>(cached?.messages ?? []);
  const [members, setMembers] = useState<Member[]>(cached?.members ?? []);
  const [loaded, setLoaded] = useState(!!cached);

  // Write-through for the persisted snapshot — uid-scoped, trimmed to the
  // conversation tail, never while an admin previews, wiped on signOut.
  const persistRoom = (snap: RoomSnapshot) => {
    const u = userIdRef.current;
    if (previewAsId || !u) return;
    writePersisted(`houseChatRoom.${u}.${slug}`, {
      ...snap,
      messages: snap.messages.slice(-CHAT_SNAPSHOT_MSGS),
    });
  };

  // Cold-open seed (post-mount, hydration-safe): restore the persisted room
  // when memory is cold. loadAccess still re-derives (and can downgrade)
  // access; refetchMessages reconciles the list right behind this.
  const roomSeededRef = useRef(false);
  useEffect(() => {
    if (roomSeededRef.current || previewAsId || !userId || houseChatCache.has(key)) return;
    const snap = readPersisted<RoomSnapshot>(`houseChatRoom.${userId}.${slug}`);
    if (!snap) return;
    roomSeededRef.current = true;
    houseChatCache.set(key, snap);
    setHouseId(snap.houseId);
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

  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const objectUrls = useRef<string[]>([]);
  const [debounceRefetch, cancelRefetch] = useDebouncedCallback(120);
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;

  const isMember = access === "member";

  // ── Who am I + do I have access? ───────────────────────────────────────────
  const loadAccess = async (id?: string | null) => {
    const sb = supabase;
    if (!sb) return;
    const hid = id ?? houseId;
    if (!hid) return;
    // Set access AND write the cache/persisted copy, so re-entry paints right
    // away — including DOWNGRADING a stale "member", so revoked access never
    // sticks.
    const setAndCache = (a: Access) => {
      setAccess(a);
      const snap = { ...(houseChatCache.get(key) ?? { messages: [], members: [] }), access: a, houseId: hid };
      houseChatCache.set(key, snap);
      persistRoom(snap);
    };
    // Context uid (first tick, no network); local getSession as the fallback.
    const me = previewAsId ?? userIdRef.current ?? (await sb.auth.getSession()).data.session?.user.id ?? null;
    setUid(me);
    if (!me) { setAndCache("guest"); return; }
    if (isAdminRef.current) { setAndCache("member"); return; }
    const { data } = await sb.from("profiles").select("house_id").eq("id", me).maybeSingle();
    const myHouse = (data as { house_id: string | null } | null)?.house_id ?? null;
    setAndCache(myHouse === hid ? "member" : "none");
  };

  // Resolve the house id from its slug (unless the caller passed it), then load
  // access. Realtime keeps both access + messages live.
  useEffect(() => {
    const sb = supabase;
    if (!sb) { setAccess("coming-soon"); return; }
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    (async () => {
      let hid = houseIdProp;
      if (!hid) {
        const { data, error } = await sb.from("houses").select("id").eq("slug", slug).maybeSingle();
        if (cancelled) return;
        if (error || !data) { setAccess("setup"); return; }
        hid = (data as { id: string }).id;
      }
      setHouseId(hid);
      await loadAccess(hid);
      if (cancelled) return;

      const scheduleRefetch = () => debounceRefetch(() => void refetchMessages(hid!));
      channel = sb
        .channel(`house-chat-${slug}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "house_messages", filter: `house_id=eq.${hid}` }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "house_message_media" }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "house_message_reactions" }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "house_message_mentions" }, scheduleRefetch)
        .subscribe();
    })();
    return () => {
      cancelled = true;
      cancelRefetch();
      if (channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, previewAsId]);

  useEffect(() => {
    if (houseId && isAdmin) setAccess("member");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (isMember && houseId) void refetchMessages(houseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMember, houseId]);

  useEffect(() => () => objectUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const refetchMessages = async (hid: string) => {
    const sb = supabase;
    if (!sb) return;
    // Prefer the soft-delete column; fall back if the migration isn't applied yet.
    const withDel = await sb
      .from("house_messages")
      .select("id, author_id, text, reply_to_id, created_at, edited_at, deleted_at")
      .eq("house_id", hid)
      .order("created_at", { ascending: true });
    const msgRows = withDel.error
      ? (await sb.from("house_messages").select("id, author_id, text, reply_to_id, created_at, edited_at").eq("house_id", hid).order("created_at", { ascending: true })).data
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
      const withName = await sb.from("house_message_media").select("message_id, storage_path, media_type, width, height, file_name, position").in("message_id", ids);
      if (!withName.error) return withName;
      return await sb.from("house_message_media").select("message_id, storage_path, media_type, width, height, position").in("message_id", ids);
    };
    const [mediaRes, reactRes, mentionRes, profilesRes, rosterRes] = await Promise.all([
      fetchMedia(),
      ids.length ? sb.from("house_message_reactions").select("message_id, user_id, emoji").in("message_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("house_message_mentions").select("message_id, mentioned_user_id").in("message_id", ids) : Promise.resolve({ data: [] }),
      sb.from("profiles").select("id, display_name, avatar_url"),
      sb.from("profiles").select("id").eq("house_id", hid),
    ]);

    const names = new Map<string, string>();
    const avatars = new Map<string, string | null>();
    for (const p of (profilesRes.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      names.set(p.id, p.display_name?.trim() || "Member");
      avatars.set(p.id, p.avatar_url);
    }
    const roster: Member[] = ((rosterRes.data ?? []) as { id: string }[])
      .map((r) => ({ id: r.id, name: names.get(r.id) || "Member", avatarUrl: avatars.get(r.id) ?? null }))
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
    // Snapshot the fresh room so a re-entry (or cold open) paints instantly. A
    // successful member fetch means access is "member".
    const snap: RoomSnapshot = { access: "member", houseId: hid, messages: msgs, members: roster };
    houseChatCache.set(key, snap);
    persistRoom(snap);
    // Skip while "view as" preview is active — the real admin's read row must
    // not be stamped by whatever the previewed member/guest opens.
    if (previewMode === "off") {
      const me = userIdRef.current ?? (await sb.auth.getSession()).data.session?.user.id;
      if (me) await sb.rpc("mark_house_read", { hid });
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const repinIfAtBottom = () => {
    if (!atBottomRef.current) return;
    requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
  };

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => repinIfAtBottom();
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    repinIfAtBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, replyTo, editing]);

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
    if (mentionIds.length) {
      setMentionIds((ids) => ids.filter((id) => {
        const n = members.find((m) => m.id === id)?.name;
        return n ? v.includes(`@${n}`) : false;
      }));
    }
  };

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

  const canSend = editing
    ? (text.trim().length > 0 || editing.media.length > 0) && !sending && isMember
    : (text.trim().length > 0 || pending.length > 0) && !sending && isMember;

  const send = async () => {
    const sb = supabase;
    if (!sb || !houseId || !uid || !canSend) return;
    setSending(true);
    setStatus(null);
    try {
      if (editing) {
        const { error: updErr } = await sb
          .from("house_messages")
          .update({ text: text.trim() || null, edited_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (updErr) throw updErr;
        await sb.from("house_message_mentions").delete().eq("message_id", editing.id);
        if (mentionIds.length) {
          await sb.from("house_message_mentions").insert(mentionIds.map((id) => ({ message_id: editing.id, mentioned_user_id: id })));
        }
        setText(""); setMentionIds([]); setEditing(null);
        await refetchMessages(houseId);
        return;
      }

      const uploaded: ChatMedia[] = [];
      const token = (await sb.auth.getSession()).data.session?.access_token;
      for (const p of pending) {
        if (!token) throw new Error("Not signed in.");
        // Only photos are re-encoded; videos + files upload as-is.
        const f = p.type === "image" ? await compressImage(p.file) : p.file;
        const url = await uploadToMini(f, token, { category: "chat", room: slug });
        uploaded.push({ url, type: p.type, name: p.type === "file" ? p.name : undefined });
      }

      const { data: ins, error: insErr } = await sb
        .from("house_messages")
        .insert({ house_id: houseId, author_id: uid, text: text.trim() || null, reply_to_id: replyTo?.id ?? null })
        .select("id")
        .single();
      if (insErr) throw insErr;
      const mid = (ins as { id: string }).id;

      if (uploaded.length) {
        const rows = uploaded.map((m, i) => ({ message_id: mid, storage_path: m.url, media_type: m.type, width: m.width ?? null, height: m.height ?? null, file_name: m.name ?? null, position: i }));
        const insMedia = await sb.from("house_message_media").insert(rows);
        // Before migration 0073, file_name doesn't exist — retry without it so
        // photos/videos still attach (file-type sends need the migration).
        if (insMedia.error) await sb.from("house_message_media").insert(rows.map(({ file_name, ...r }) => r));
      }
      if (mentionIds.length) {
        await sb.from("house_message_mentions").insert(mentionIds.map((id) => ({ message_id: mid, mentioned_user_id: id })));
      }

      setText(""); setPending([]); setMentionIds([]); setReplyTo(null);
      await refetchMessages(houseId);
    } catch (err) {
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
    await toggleReaction({ table: "house_message_reactions", idColumn: "message_id", itemId: messageId, userId: uid, emoji, current: mine });
    if (houseId) await refetchMessages(houseId);
  };

  const deleteMessage = async (id: string) => {
    if (!supabase || !houseId) return;
    if (!window.confirm("Delete this message? It'll show as “message deleted”.")) return;
    if (editing?.id === id) cancelEdit();
    await supabase.from("house_messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await refetchMessages(houseId);
  };

  const startEdit = (m: Msg) => {
    setReactingId(null);
    setReplyTo(null);
    setPending([]);
    setEditing(m);
    setText(m.text ?? "");
    setMentionIds(m.mentions);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const cancelEdit = () => { setEditing(null); setText(""); setMentionIds([]); };

  const scrollToMessage = (id: string) => {
    document.getElementById(`hmsg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const focus = new URLSearchParams(window.location.search).get("m");
    if (!focus) return;
    const t = setTimeout(() => scrollToMessage(focus), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const startReply = (m: Msg) => {
    setReplyTo(m);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const wrap = (subtitle: string, body: React.ReactNode) =>
    embedded ? (
      <div className="flex h-full min-h-0 flex-col">{body}</div>
    ) : (
      <ChatShell name={name} emoji={emoji} subtitle={subtitle}>
        {body}
      </ChatShell>
    );

  if (access === "loading") {
    return wrap("House chat", (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" aria-label="Loading" />
      </div>
    ));
  }

  // ── Gates (non-member states) ───────────────────────────────────────────────
  if (access !== "member") {
    return wrap("House chat", (
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
              🔒
            </div>
            {access === "coming-soon" || access === "setup" ? (
              <>
                <h2 className="text-lg font-bold">House chat is coming soon</h2>
                <p className="text-sm text-foreground/60">A private room for {name} lands with the next update.</p>
              </>
            ) : access === "guest" ? (
              <>
                <h2 className="text-lg font-bold">{name} chat is for members</h2>
                <p className="text-sm text-foreground/65">Sign in — just your name &amp; email, no password — to see your house&rsquo;s chat.</p>
                <button onClick={promptSignIn} className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white">Sign in</button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">{name} chat is private</h2>
                <p className="text-sm text-foreground/60">This chat is just for {name} members. Ask an admin to add you to the house.</p>
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
      {/* Meeting scheduler — pinned above the messages so every house member
          sees an open proposal; admins can start one (houses have no leads). */}
      {houseId && (
        <MeetingSection scope={{ type: "house", houseId, slug }} members={members} />
      )}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const sc = e.currentTarget;
          atBottomRef.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3"
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
                <MessageRow
                  key={m.id}
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
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border bg-card" style={embedded ? undefined : { paddingBottom: "env(safe-area-inset-bottom)" }}>
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
          {!editing && (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-foreground/55" aria-label="Attach a photo, video, or file">📎</button>
              <input ref={fileRef} type="file" multiple onChange={pickFiles} className="hidden" />
            </>
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
            className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl bg-background px-3 py-2 text-base leading-snug ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <button onClick={() => void send()} disabled={!canSend} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40" aria-label={editing ? "Save edit" : "Send"}>
            {sending ? "…" : editing ? "✓" : "➤"}
          </button>
        </div>
      </div>

      {lightbox && <Lightbox key={lightbox} url={lightbox} onClose={() => setLightbox(null)} z="z-[55]" />}
      {memberSheet && (
        <MemberSheet key={memberSheet.id} id={memberSheet.id} name={memberSheet.name} avatarUrl={memberSheet.avatarUrl} onClose={() => setMemberSheet(null)} />
      )}
    </>
  ));
}

// Full-screen conversation shell (only used when not embedded). Houses live in the
// Feed tab (embedded), so this is a safety fallback that returns to the Feed.
function ChatShell({ name, emoji, subtitle, children }: { name: string; emoji: string; subtitle?: string; children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
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
        <Link href="/posts" className="press -ml-1 flex h-11 w-11 items-center justify-center rounded-full text-xl text-foreground/60" aria-label="Back to Feed">‹</Link>
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

  if (m.deletedAt) {
    return (
      <div id={`hmsg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
        {!mine && <div className="mr-1.5 w-7 shrink-0" aria-hidden />}
        <div className="max-w-[78%] rounded-2xl bg-card px-3 py-2 text-sm italic text-faint ring-1 ring-border">
          🚫 message deleted
        </div>
      </div>
    );
  }

  return (
    <div id={`hmsg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
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
          <div className={`absolute z-10 -top-9 flex gap-0.5 rounded-full bg-background px-1.5 py-1 shadow-lg ring-1 ring-border ${mine ? "right-0" : "left-0"}`}>
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => onReact(e)} className="press rounded-full px-1 text-lg">{e}</button>
            ))}
            <button onClick={onReply} className="press rounded-full px-1 text-base" aria-label="Reply">↩︎</button>
            {canEdit && <button onClick={onEdit} className="press rounded-full px-1 text-base" aria-label="Edit">✏️</button>}
            {canDelete && <button onClick={onDelete} className="press rounded-full px-1 text-base" aria-label="Delete">🗑️</button>}
          </div>
        )}
      </div>
    </div>
  );
}
