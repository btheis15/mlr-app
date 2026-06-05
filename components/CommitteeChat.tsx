"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { GifPicker, type PickedGif } from "@/components/GifPicker";
import { STICKERS, StickerArt } from "@/components/Stickers";
import { uploadToMini, compressImage } from "@/lib/media";
import { fetchJoinState } from "@/lib/roles";
import { formatDayHeading, formatClock, groupByDay, plural } from "@/lib/format";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

type Access = "loading" | "coming-soon" | "guest" | "member" | "pending" | "none" | "setup";

interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
interface ChatMedia {
  url: string; // mini URL, Tenor URL, or a sticker id
  type: "image" | "video" | "sticker" | "gif";
  width?: number | null;
  height?: number | null;
}
interface Msg {
  id: string;
  authorId: string;
  author: string;
  authorAvatar?: string | null;
  text?: string;
  ts: string;
  editedAt?: string | null;
  replyToId?: string | null;
  media: ChatMedia[];
  reactions: { userId: string; emoji: string }[];
  mentions: string[]; // user ids
}

// One pending attachment in the composer: an uploaded-on-send file, a sticker
// id, or a hotlinked GIF. Only one "special" (sticker/gif) at a time.
type Pending =
  | { kind: "file"; file: File; url: string; type: "image" | "video" }
  | { kind: "sticker"; id: string }
  | { kind: "gif"; gif: PickedGif };

export function CommitteeChat({ slug, name, emoji, embedded = false, knownMember = false }: { slug: string; name: string; emoji: string; embedded?: boolean; knownMember?: boolean }) {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const configured = isSupabaseConfigured;

  const [uid, setUid] = useState<string | null>(null);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  // When the caller already knows you're a member (the Feed only lists rooms you
  // belong to), open straight into the chat — no loading/lock flash on switch.
  // loadAccess still runs and self-corrects in the rare case it's wrong.
  const [access, setAccess] = useState<Access>(configured ? (knownMember ? "member" : "loading") : "coming-soon");
  const [requesting, setRequesting] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Composer
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [showGif, setShowGif] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [memberSheet, setMemberSheet] = useState<Member | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Whether the list is parked at the latest message. Tracked on scroll so the
  // re-pin logic below is timing-independent: it never has to measure *after* a
  // drawer/banner has already changed the layout (which would misread).
  const atBottomRef = useRef(true);
  const objectUrls = useRef<string[]>([]);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest isAdmin, for the realtime callbacks below — they capture loadAccess
  // from an early render (when isAdmin was still resolving as false), so reading
  // the live ref prevents transiently downgrading an admin's access.
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;

  const isMember = access === "member";

  // ── Who am I + do I have access? ───────────────────────────────────────────
  const loadAccess = async (id?: string | null) => {
    const sb = supabase;
    if (!sb) return;
    const cid = id ?? committeeId;
    if (!cid) return;
    const me = (await sb.auth.getUser()).data.user?.id ?? null;
    setUid(me);
    if (!me) {
      setAccess("guest");
      return;
    }
    if (isAdminRef.current) {
      setAccess("member");
      return;
    }
    // "member" | "pending" | "none" are all valid Access states.
    setAccess(await fetchJoinState(cid, me));
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

      const scheduleRefetch = () => {
        if (refetchTimer.current) clearTimeout(refetchTimer.current);
        refetchTimer.current = setTimeout(() => void refetchMessages(cid), 120);
      };
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
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      if (channel) sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

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
    const { data: msgRows } = await sb
      .from("committee_messages")
      .select("id, author_id, text, reply_to_id, created_at, edited_at")
      .eq("committee_id", cid)
      .order("created_at", { ascending: true });
    const rows = (msgRows ?? []) as {
      id: string; author_id: string; text: string | null; reply_to_id: string | null; created_at: string; edited_at: string | null;
    }[];
    const ids = rows.map((r) => r.id);

    const [mediaRes, reactRes, mentionRes, profilesRes, rosterRes] = await Promise.all([
      ids.length ? sb.from("committee_message_media").select("message_id, storage_path, media_type, width, height, position").in("message_id", ids) : Promise.resolve({ data: [] }),
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
    for (const m of (mediaRes.data ?? []) as { message_id: string; storage_path: string; media_type: string; width: number | null; height: number | null; position: number }[]) {
      (mediaByMsg[m.message_id] ||= []).push({
        url: m.storage_path,
        type: (["image", "video", "sticker", "gif"].includes(m.media_type) ? m.media_type : "image") as ChatMedia["type"],
        width: m.width,
        height: m.height,
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

    setMessages(
      rows.map((r) => ({
        id: r.id,
        authorId: r.author_id,
        author: names.get(r.author_id) || "Member",
        authorAvatar: avatars.get(r.author_id) ?? null,
        text: r.text || undefined,
        ts: r.created_at,
        editedAt: r.edited_at,
        replyToId: r.reply_to_id,
        media: mediaByMsg[r.id] ?? [],
        reactions: reactByMsg[r.id] ?? [],
        mentions: mentionByMsg[r.id] ?? [],
      })),
    );
    setLoaded(true);
    // Mark the room read for me.
    const me = (await sb.auth.getUser()).data.user?.id;
    if (me) await sb.from("committee_reads").upsert({ committee_id: cid, user_id: me, last_read_at: new Date().toISOString() }, { onConflict: "committee_id,user_id" });
  };

  // Keep pinned to the latest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
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
  }, [pending.length, showStickers, showGif, replyTo]);

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

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const next: Pending[] = [];
    for (const f of Array.from(list)) {
      const url = URL.createObjectURL(f);
      objectUrls.current.push(url);
      next.push({ kind: "file", file: f, url, type: f.type.startsWith("video") ? "video" : "image" });
    }
    setPending((p) => [...p.filter((x) => x.kind === "file"), ...next]);
    e.target.value = "";
  };
  const addSticker = (id: string) => {
    setPending([{ kind: "sticker", id }]);
    setShowStickers(false);
  };
  const addGif = (gif: PickedGif) => {
    setPending([{ kind: "gif", gif }]);
    setShowGif(false);
  };
  const removePending = (i: number) => setPending((p) => p.filter((_, idx) => idx !== i));

  const onComposerChange = (v: string) => {
    setText(v);
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

  const canSend = (text.trim().length > 0 || pending.length > 0) && !sending && isMember;

  const send = async () => {
    const sb = supabase;
    if (!sb || !committeeId || !uid || !canSend) return;
    setSending(true);
    setStatus(null);
    try {
      // Upload any photo/video files first so a failure never leaves an empty
      // message.
      const uploaded: ChatMedia[] = [];
      const token = (await sb.auth.getSession()).data.session?.access_token;
      for (const p of pending) {
        if (p.kind === "file") {
          if (!token) throw new Error("Not signed in.");
          const f = p.type === "video" ? p.file : await compressImage(p.file);
          const url = await uploadToMini(f, token, { category: "chat", room: slug });
          uploaded.push({ url, type: p.type });
        } else if (p.kind === "sticker") {
          uploaded.push({ url: p.id, type: "sticker" });
        } else {
          uploaded.push({ url: p.gif.url, type: "gif", width: p.gif.width, height: p.gif.height });
        }
      }

      const { data: ins, error: insErr } = await sb
        .from("committee_messages")
        .insert({ committee_id: committeeId, author_id: uid, text: text.trim() || null, reply_to_id: replyTo?.id ?? null })
        .select("id")
        .single();
      if (insErr) throw insErr;
      const mid = (ins as { id: string }).id;

      if (uploaded.length) {
        await sb.from("committee_message_media").insert(
          uploaded.map((m, i) => ({ message_id: mid, storage_path: m.url, media_type: m.type, width: m.width ?? null, height: m.height ?? null, position: i })),
        );
      }
      if (mentionIds.length) {
        await sb.from("committee_message_mentions").insert(mentionIds.map((id) => ({ message_id: mid, mentioned_user_id: id })));
      }

      setText(""); setPending([]); setMentionIds([]); setReplyTo(null);
      await refetchMessages(committeeId);
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
    const sb = supabase;
    if (!sb || !uid) return;
    const mine = messages.find((m) => m.id === messageId)?.reactions.find((r) => r.userId === uid)?.emoji ?? null;
    if (mine === emoji) {
      await sb.from("committee_message_reactions").delete().eq("message_id", messageId).eq("user_id", uid);
    } else {
      await sb.from("committee_message_reactions").upsert({ message_id: messageId, user_id: uid, emoji }, { onConflict: "message_id,user_id" });
    }
    if (committeeId) await refetchMessages(committeeId);
  };

  const deleteMessage = async (id: string) => {
    if (!supabase || !committeeId) return;
    if (!window.confirm("Delete this message?")) return;
    await supabase.from("committee_messages").delete().eq("id", id);
    await refetchMessages(committeeId);
  };

  const scrollToMessage = (id: string) => {
    document.getElementById(`cmsg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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
                <p className="text-sm text-foreground/60">Sign in, then ask to join this committee to see and post in its chat.</p>
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
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const sc = e.currentTarget;
          atBottomRef.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {loaded && messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-foreground/50">No messages yet — say hi to the {name} crew! 👋</p>
        )}
        {dayGroups.map((g) => (
          <div key={g.day} className="space-y-1">
            <div className="my-2 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-foreground/40">
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
                  canDelete={m.authorId === uid || isAdmin}
                  reply={msgById.get(m.replyToId ?? "")}
                  members={members}
                  reacting={reactingId === m.id}
                  onOpenReact={() => setReactingId((cur) => (cur === m.id ? null : m.id))}
                  onReact={(e) => react(m.id, e)}
                  onReply={() => startReply(m)}
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

        {replyTo && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <span className="h-8 w-0.5 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-primary">Replying to {replyTo.authorId === uid ? "yourself" : replyTo.author}</p>
              <p className="truncate text-foreground/55">{replyPreview(replyTo)}</p>
            </div>
            <button onClick={() => setReplyTo(null)} className="press shrink-0 text-foreground/40" aria-label="Cancel reply">✕</button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-2">
            {pending.map((p, i) => (
              <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-background ring-1 ring-border">
                {p.kind === "file" && p.type === "video" && <video src={p.url} className="h-full w-full object-cover" muted playsInline />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.kind === "file" && p.type === "image" && <img src={p.url} alt="" className="h-full w-full object-cover" />}
                {p.kind === "gif" && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.gif.url} alt="" className="h-full w-full object-cover" />}
                {p.kind === "sticker" && <StickerArt id={p.id} size={64} />}
                <button onClick={() => removePending(i)} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white" aria-label="Remove">×</button>
              </div>
            ))}
          </div>
        )}

        {showStickers && (
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center justify-between pb-1">
              <p className="text-xs font-semibold text-foreground/60">Stickers</p>
              <button onClick={() => setShowStickers(false)} className="press text-xs font-medium text-foreground/50">Close</button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {STICKERS.map((s) => (
                <button key={s.id} onClick={() => addSticker(s.id)} className="press overflow-hidden rounded-xl" aria-label={s.label}>
                  <StickerArt id={s.id} size={72} className="h-full w-full" />
                </button>
              ))}
            </div>
          </div>
        )}
        {showGif && (
          <div className="border-b border-border px-3 py-2">
            <GifPicker onSelect={addGif} onClose={() => setShowGif(false)} />
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
          <button type="button" onClick={() => fileRef.current?.click()} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg" aria-label="Add photo or video">📷</button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={pickFiles} className="hidden" />
          <button type="button" onClick={() => { setShowStickers((s) => !s); setShowGif(false); }} className={`press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${showStickers ? "bg-primary/10" : ""}`} aria-label="Stickers">🦦</button>
          <button type="button" onClick={() => { setShowGif((s) => !s); setShowStickers(false); }} className={`press flex h-9 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold ${showGif ? "bg-primary/10 text-primary" : "text-foreground/55"}`} aria-label="GIFs">GIF</button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Message…"
            rows={1}
            enterKeyHint="send"
            // text-base (≥16px) is required: iOS Safari auto-zooms any focused
            // input under 16px, which lurches the whole layout when you tap to type.
            // Height is auto-grown to fit the content (see the effect above) so a
            // line is never clipped; leading-snug keeps a single line tidy.
            className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl bg-background px-3 py-2 text-base leading-snug ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <button onClick={() => void send()} disabled={!canSend} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40" aria-label="Send">
            {sending ? "…" : "➤"}
          </button>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/90 p-4 scrim-in" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full object-contain pop-panel" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      {memberSheet && (
        <MemberSheet key={memberSheet.id} id={memberSheet.id} name={memberSheet.name} avatarUrl={memberSheet.avatarUrl} onClose={() => setMemberSheet(null)} />
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
        <Link href={`/committees/${slug}`} className="press -ml-1 flex h-9 w-9 items-center justify-center rounded-full text-xl text-foreground/60" aria-label="Back to committee">‹</Link>
        <span className="text-xl">{emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{name}</p>
          {subtitle && <p className="truncate text-[11px] text-foreground/45">{subtitle}</p>}
        </div>
      </header>
      {children}
    </div>
  );
}

function replyPreview(m: Msg): string {
  if (m.text) return m.text;
  const med = m.media[0];
  if (!med) return "Message";
  return med.type === "sticker" ? "Sticker" : med.type === "gif" ? "GIF" : med.type === "video" ? "🎬 Video" : "📷 Photo";
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
  m, mine, grouped, uid, canDelete, reply, members, reacting,
  onOpenReact, onReact, onReply, onDelete, onOpenMember, onOpenPhoto, onJumpToReply,
}: {
  m: Msg; mine: boolean; grouped: boolean; uid: string | null; canDelete: boolean;
  reply?: Msg; members: Member[]; reacting: boolean;
  onOpenReact: () => void; onReact: (emoji: string) => void; onReply: () => void; onDelete: () => void;
  onOpenMember: (m: Member) => void; onOpenPhoto: (url: string) => void; onJumpToReply: (id: string) => void;
}) {
  const [dx, setDx] = useState(0);
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

  const counts: Record<string, number> = {};
  for (const r of m.reactions) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
  const mineEmoji = m.reactions.find((r) => r.userId === uid)?.emoji ?? null;
  const onlySticker = m.media.length === 1 && (m.media[0].type === "sticker" || m.media[0].type === "gif") && !m.text;

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

        {!mine && !grouped && <p className="mb-0.5 ml-1 text-[11px] font-semibold text-foreground/55">{m.author}</p>}

        {reply && (
          <button onClick={() => onJumpToReply(reply.id)} className={`press mb-0.5 block w-full rounded-lg border-l-2 border-primary/60 px-2 py-1 text-left text-[11px] ${mine ? "bg-white/15" : "bg-background"}`}>
            <span className="font-semibold text-primary">{reply.authorId === uid ? "You" : reply.author}</span>
            <span className="ml-1 text-foreground/55">{replyPreview(reply).slice(0, 60)}</span>
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

        {Object.keys(counts).length > 0 && (
          <div className={`mt-0.5 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
            {Object.entries(counts).map(([e, c]) => (
              <button key={e} onClick={() => onReact(e)} className={`rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${mineEmoji === e ? "bg-primary/10 text-primary ring-primary/30" : "bg-background text-foreground/60 ring-border"}`}>
                {e} {c}
              </button>
            ))}
          </div>
        )}

        {reacting && (
          <div className={`absolute z-10 -top-9 flex gap-0.5 rounded-full bg-background px-1.5 py-1 shadow-lg ring-1 ring-border ${mine ? "right-0" : "left-0"}`}>
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => onReact(e)} className="press rounded-full px-1 text-lg">{e}</button>
            ))}
            <button onClick={onReply} className="press rounded-full px-1 text-base" aria-label="Reply">↩︎</button>
            {canDelete && <button onClick={onDelete} className="press rounded-full px-1 text-base" aria-label="Delete">🗑️</button>}
          </div>
        )}
      </div>
    </div>
  );
}
