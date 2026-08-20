"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { Lightbox } from "@/components/Lightbox";
import { StickerArt } from "@/components/Stickers";
import { mediaSrc } from "@/lib/mediaToken";
import { photoUrls, prepareImageForUpload, uploadErrorMessage, uploadToMini } from "@/lib/media";
import { reactionCounts, toggleReaction } from "@/lib/reactions";
import { formatClock, formatDayHeading, groupByDay } from "@/lib/format";
import { useDeepLinkFlash, useUrlParam } from "@/lib/hooks";
import { markEventChatRead } from "@/lib/eventChats";

/**
 * One event's chat room — the people going to a Work Weekend / holiday weekend
 * talking to each other, instead of to the whole Family Feed (migration 0216).
 *
 * Deliberately LEANER than CommitteeChat/HouseChat rather than a third near-copy
 * of them: text, photos/videos/files, replies, tapback reactions, @mentions,
 * optimistic send and realtime. It does NOT carry chat polls, meeting bars,
 * stickers or GIF search — an event room is a short-lived logistics thread, and
 * a third 1,200-line clone of the same component is a maintenance liability.
 * Those can be lifted in later if anyone asks for them.
 *
 * ⚠️ **Access is never decided here.** `is_event_chat_member` (0216) is the only
 * authority, and it has NO app-admin override — so an admin who isn't going
 * genuinely cannot read this, by design. This component resolves membership by
 * asking whether the room appears in the viewer's own list, so it can show a
 * clear lock instead of an unexplained empty thread.
 *
 * ⚠️ **Archived rooms are read-only**, enforced in RLS (the insert policy checks
 * `is_event_chat_archived`), not merely hidden here. A chat archives itself 7
 * days after its event ends.
 */

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

type Access = "loading" | "member" | "none";

interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
interface ChatMedia {
  url: string;
  type: "image" | "video" | "sticker" | "gif" | "file";
  name?: string | null;
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
interface Pending {
  file: File;
  url: string;
  type: ChatMedia["type"];
  name?: string;
}

export function EventChat({
  eventId,
  title,
  emoji,
  archived,
  when,
  onBack,
}: {
  eventId: string;
  title: string;
  emoji?: string | null;
  archived: boolean;
  when?: string | null;
  onBack: () => void;
}) {
  const { user, effectiveUserId, previewAsId } = useIdentity();
  const uid = effectiveUserId;
  const [access, setAccess] = useState<Access>("loading");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [trayFor, setTrayFor] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; photos: string[] } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const objectUrls = useRef<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Deep-link (&m=<id>) scroll-to + flash, same as every other room.
  const deepLinkMsg = useUrlParam("m");
  useDeepLinkFlash("eventmsg-", deepLinkMsg, messages.length > 0);

  // ⚠️ "View as" is read-only AND content-blind for event chats: an admin
  // previewing a member may confirm they HAVE the room, never read it. FeedView
  // blocks the tap, so reaching this component while previewing means something
  // routed around that — refuse rather than attempt a fetch RLS would deny
  // anyway (the admin isn't a member, so it would just look broken).
  const blockedByPreview = Boolean(previewAsId);

  useEffect(() => () => objectUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const load = useCallback(async () => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !uid || blockedByPreview) return;

    // Membership: is this room in my own list? Uses the same predicate the
    // policies do, so it can't disagree with what I can actually read.
    const { data: mine } = await sb.rpc("my_event_chats");
    const inRoom = ((mine ?? []) as { event_id: string }[]).some((r) => r.event_id === eventId);
    if (!inRoom) {
      setAccess("none");
      return;
    }
    setAccess("member");

    const msgRes = await sb
      .from("event_chat_messages")
      .select("id, author_id, text, reply_to_id, created_at, edited_at, deleted_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    const rows = (msgRes.data ?? []) as {
      id: string; author_id: string; text: string | null; reply_to_id: string | null;
      created_at: string; edited_at: string | null; deleted_at: string | null;
    }[];
    const ids = rows.map((r) => r.id);

    // Everyone going or maybe — the room's roster and the @mention candidates.
    // ⚠️ event_attendance has THREE FKs to profiles (user_id, sponsor_user_id,
    // added_by — 0196), so the embed MUST name the one it means or PostgREST
    // answers the whole select with PGRST201 "more than one relationship found"
    // and the roster silently comes back empty.
    const [mediaRes, reactRes, mentionRes, roster] = await Promise.all([
      ids.length
        ? sb.from("event_chat_message_media").select("message_id, storage_path, media_type, file_name, position").in("message_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? sb.from("event_chat_message_reactions").select("message_id, user_id, emoji").in("message_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? sb.from("event_chat_message_mentions").select("message_id, mentioned_user_id").in("message_id", ids)
        : Promise.resolve({ data: [] }),
      sb
        .from("event_attendance")
        .select("user_id, profiles!event_attendance_user_id_fkey(id, display_name, avatar_url)")
        .eq("event_id", eventId)
        .in("status", ["going", "maybe"])
        .not("user_id", "is", null),
    ]);

    // ⚠️ PostgREST types a named to-one embed as an ARRAY in the generated
    // types even though it yields at most one row, so accept both shapes rather
    // than casting one away and reading undefined at runtime.
    type RosterProfile = { id: string; display_name: string | null; avatar_url: string | null };
    type RosterRow = { user_id: string; profiles: RosterProfile | RosterProfile[] | null };
    const names = new Map<string, string>();
    const avatars = new Map<string, string | null>();
    const people: Member[] = [];
    for (const r of (roster.data ?? []) as unknown as RosterRow[]) {
      const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      if (!prof) continue;
      const name = prof.display_name?.trim() || "Member";
      names.set(prof.id, name);
      avatars.set(prof.id, prof.avatar_url);
      people.push({ id: prof.id, name, avatarUrl: prof.avatar_url });
    }
    people.sort((a, b) => a.name.localeCompare(b.name));
    setMembers(people);

    // An author may have since changed their RSVP and dropped off the roster —
    // their old messages must still show a name, so backfill any missing ones.
    const unknown = Array.from(new Set(rows.map((r) => r.author_id))).filter((id) => !names.has(id));
    if (unknown.length) {
      const { data: extra } = await sb.from("profiles").select("id, display_name, avatar_url").in("id", unknown);
      for (const p of (extra ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
        names.set(p.id, p.display_name?.trim() || "Member");
        avatars.set(p.id, p.avatar_url);
      }
    }

    const mediaBy: Record<string, ChatMedia[]> = {};
    for (const m of (mediaRes.data ?? []) as { message_id: string; storage_path: string; media_type: string; file_name: string | null }[]) {
      (mediaBy[m.message_id] ||= []).push({
        url: m.storage_path,
        type: (["image", "video", "sticker", "gif", "file"].includes(m.media_type) ? m.media_type : "image") as ChatMedia["type"],
        name: m.file_name,
      });
    }
    const reactBy: Record<string, { userId: string; emoji: string }[]> = {};
    for (const r of (reactRes.data ?? []) as { message_id: string; user_id: string; emoji: string }[]) {
      (reactBy[r.message_id] ||= []).push({ userId: r.user_id, emoji: r.emoji });
    }
    const mentionBy: Record<string, string[]> = {};
    for (const m of (mentionRes.data ?? []) as { message_id: string; mentioned_user_id: string }[]) {
      (mentionBy[m.message_id] ||= []).push(m.mentioned_user_id);
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
        deletedAt: r.deleted_at,
        replyToId: r.reply_to_id,
        media: mediaBy[r.id] ?? [],
        reactions: reactBy[r.id] ?? [],
        mentions: mentionBy[r.id] ?? [],
      })),
    );
  }, [eventId, uid, blockedByPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime — one channel per room, torn down on unmount.
  useEffect(() => {
    const sb = supabase;
    if (!sb || access !== "member") return;
    const ch = sb
      .channel(`event-chat-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_chat_messages", filter: `event_id=eq.${eventId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_chat_message_reactions" }, () => void load())
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [eventId, access, load]);

  // Mark read on open and whenever new messages land while it's open. Never
  // while previewing — a read receipt is a write on the member's behalf.
  useEffect(() => {
    if (access === "member" && !previewAsId) void markEventChatRead(eventId);
  }, [access, eventId, messages.length, previewAsId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const canSend = !archived && access === "member" && !previewAsId && (text.trim().length > 0 || pending.length > 0) && !sending;

  const mentionIds = useMemo(() => {
    // Resolve "@Name" fragments against the roster — longest name first so
    // "@Mary Beth" isn't matched as "@Mary".
    const found = new Set<string>();
    const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
    for (const m of byLength) if (text.includes(`@${m.name}`)) found.add(m.id);
    return Array.from(found);
  }, [text, members]);

  const pickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: Pending[] = [];
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      objectUrls.current.push(url);
      const type: ChatMedia["type"] = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file";
      next.push({ file: f, url, type, name: f.name });
    }
    setPending((p) => [...p, ...next]);
  };

  const send = async () => {
    const sb = supabase;
    if (!sb || !uid || !canSend) return;
    setSending(true);
    setStatus(null);

    const draftText = text.trim();
    const draftPending = pending;
    const draftMentions = mentionIds;
    const draftReply = replyTo;
    const me = members.find((m) => m.id === uid);
    const tempId = `temp-${Date.now()}`;

    // Optimistic: the bubble lands instantly, media uploads behind it, then the
    // reload reconciles. On failure we roll back and restore the composer, so a
    // send is never silently lost.
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        authorId: uid,
        author: me?.name || "You",
        authorAvatar: me?.avatarUrl ?? null,
        text: draftText || undefined,
        ts: new Date().toISOString(),
        replyToId: draftReply?.id ?? null,
        media: draftPending.map((p) => ({ url: p.url, type: p.type, name: p.name })),
        reactions: [],
        mentions: [],
      },
    ]);
    setText("");
    setPending([]);
    setReplyTo(null);

    const rollback = (msg: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(draftText);
      setPending(draftPending);
      setReplyTo(draftReply);
      setStatus(msg);
      window.setTimeout(() => setStatus(null), 6000);
    };

    try {
      const uploaded: { url: string; thumb: string | null; type: ChatMedia["type"]; name?: string }[] = [];
      if (draftPending.length) {
        const token = (await sb.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("your session expired — sign in again");
        for (const p of draftPending) {
          const f = p.type === "image" ? await prepareImageForUpload(p.file) : p.file;
          const res = await uploadToMini(f, token, { category: "chat", room: eventId });
          uploaded.push({ url: res.url, thumb: res.thumbnailUrl ?? null, type: p.type, name: p.type === "file" ? p.name : undefined });
        }
      }

      const { data: inserted, error } = await sb
        .from("event_chat_messages")
        .insert({ event_id: eventId, author_id: uid, text: draftText || null, reply_to_id: draftReply?.id ?? null })
        .select("id")
        .single();
      if (error) throw error;
      const newId = (inserted as { id: string }).id;

      if (uploaded.length) {
        await sb.from("event_chat_message_media").insert(
          uploaded.map((u, i) => ({
            message_id: newId,
            storage_path: u.url,
            media_type: u.type,
            file_name: u.name ?? null,
            thumbnail_url: u.thumb,
            position: i,
          })),
        );
      }
      if (draftMentions.length) {
        await sb.from("event_chat_message_mentions").insert(
          draftMentions.map((id) => ({ message_id: newId, mentioned_user_id: id })),
        );
      }
      await load();
    } catch (err) {
      // Carry the real reason up (the 0210 lesson: a generic "couldn't save"
      // made an app-wide outage look like one person's bad wifi).
      rollback(`Couldn't send: ${err instanceof Error ? err.message : uploadErrorMessage(err)}`);
    } finally {
      setSending(false);
    }
  };

  const react = async (messageId: string, emoji: string) => {
    if (!uid || previewAsId || archived) return;
    setTrayFor(null);
    const msg = messages.find((m) => m.id === messageId);
    // One reaction per member per message (the PK), so "current" is whatever
    // they already have on it — passing it is what makes a second tap remove.
    const current = msg?.reactions.find((r) => r.userId === uid)?.emoji ?? null;
    const mine = current === emoji;
    // Optimistic flip, then persist.
    setMessages((prev) =>
      prev.map((m) =>
        m.id !== messageId
          ? m
          : {
              ...m,
              reactions: mine
                ? m.reactions.filter((r) => !(r.userId === uid && r.emoji === emoji))
                : [...m.reactions.filter((r) => r.userId !== uid), { userId: uid, emoji }],
            },
      ),
    );
    await toggleReaction({
      table: "event_chat_message_reactions",
      idColumn: "message_id",
      itemId: messageId,
      userId: uid,
      emoji,
      current,
    });
  };

  const remove = async (id: string) => {
    if (!supabase) return;
    await supabase.from("event_chat_messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await load();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!user) {
    return <Locked onBack={onBack} title={title} body="Sign in to see this event's chat." />;
  }
  if (blockedByPreview) {
    return (
      <Locked
        onBack={onBack}
        title={title}
        body="You're viewing as someone else. You can see which chats they have, but not what's in them."
      />
    );
  }
  if (access === "loading") {
    return (
      <div className="space-y-3 pt-1">
        <Back onBack={onBack} />
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }
  if (access === "none") {
    return (
      <Locked
        onBack={onBack}
        title={title}
        body="This chat is for the people going to this event. RSVP “Going” or “Maybe” on the event and you'll be added — you'll be able to read everything said so far."
      />
    );
  }

  const days = groupByDay(messages, (m) => m.ts);

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-1">
      <div className="flex items-center gap-2 pb-2">
        <Back onBack={onBack} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">
            {emoji ? `${emoji} ` : ""}
            {title}
          </p>
          <p className="truncate text-xs text-muted">
            {archived ? "Archived · read-only" : when || "Everyone going"}
          </p>
        </div>
      </div>

      {/* Why this room exists, stated once at the top of an empty thread. */}
      {messages.length === 0 && (
        <div className="mb-3 rounded-2xl bg-primary/10 p-4 text-xs text-muted">
          <p className="font-semibold text-foreground">Just the people going</p>
          <p className="mt-1">
            Everyone who RSVP&apos;d Going or Maybe is here — anyone who RSVPs later joins
            automatically and can read the whole conversation. Use this for the details that
            only matter to the people coming, so the Family Feed stays for everyone.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3">
        {days.map(({ day, items }) => (
          <div key={day} className="space-y-2">
            <p className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-faint">
              {formatDayHeading(day)}
            </p>
            {items.map((m) => {
              const parent = m.replyToId ? messages.find((x) => x.id === m.replyToId) : null;
              const mine = m.authorId === uid;
              const counts = reactionCounts(m.reactions);
              const photos = photoUrls(m.media);
              return (
                <motion.div
                  key={m.id}
                  id={`eventmsg-${m.id}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}
                >
                  <Avatar name={m.author} url={m.authorAvatar ?? undefined} size={28} />
                  <div className={`min-w-0 max-w-[78%] ${mine ? "items-end text-right" : ""}`}>
                    {!mine && <p className="mb-0.5 text-[11px] font-semibold text-muted">{m.author}</p>}
                    {m.deletedAt ? (
                      <p className="rounded-2xl bg-card px-3 py-2 text-xs italic text-faint">message deleted</p>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onDoubleClick={() => !archived && setTrayFor(trayFor === m.id ? null : m.id)}
                        className={`rounded-2xl px-3 py-2 text-left text-sm ${mine ? "bg-primary text-white" : "bg-card"}`}
                      >
                        {parent && (
                          <p className={`mb-1 truncate border-l-2 pl-2 text-[11px] ${mine ? "border-white/40 text-white/70" : "border-border text-muted"}`}>
                            {parent.author}: {parent.text || "attachment"}
                          </p>
                        )}
                        {m.media.map((md) =>
                          md.type === "sticker" ? (
                            <StickerArt key={md.url} id={md.url} className="my-1 h-24 w-24" />
                          ) : md.type === "video" ? (
                            <video key={md.url} src={mediaSrc(md.url)} controls className="my-1 max-h-72 w-full rounded-xl" />
                          ) : md.type === "file" ? (
                            <a key={md.url} href={mediaSrc(md.url)} target="_blank" rel="noreferrer" className="my-1 block truncate rounded-xl bg-black/10 px-2 py-1 text-xs underline">
                              📎 {md.name || "File"}
                            </a>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={md.url}
                              src={mediaSrc(md.url)}
                              alt=""
                              onClick={() => setLightbox({ url: md.url, photos })}
                              className="my-1 max-h-72 w-full cursor-pointer rounded-xl object-cover"
                            />
                          ),
                        )}
                        {m.text && <MentionText text={m.text} mentions={m.mentions} members={members} />}
                        <p className={`mt-0.5 text-[10px] ${mine ? "text-white/60" : "text-faint"}`}>
                          {formatClock(m.ts)}
                          {m.editedAt ? " · edited" : ""}
                        </p>
                      </div>
                    )}
                    {counts.length > 0 && (
                      <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
                        {counts.map(([emoji, n]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => void react(m.id, emoji)}
                            className="press rounded-full bg-card px-1.5 text-[11px] ring-1 ring-border"
                          >
                            {emoji} {n}
                          </button>
                        ))}
                      </div>
                    )}
                    {trayFor === m.id && (
                      <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
                        {REACTIONS.map((e) => (
                          <button key={e} type="button" onClick={() => void react(m.id, e)} className="press rounded-full bg-card px-1.5 py-0.5 text-sm ring-1 ring-border">
                            {e}
                          </button>
                        ))}
                        <button type="button" onClick={() => { setReplyTo(m); setTrayFor(null); }} className="press rounded-full bg-card px-2 py-0.5 text-[11px] ring-1 ring-border">
                          Reply
                        </button>
                        {mine && !m.deletedAt && (
                          <button type="button" onClick={() => void remove(m.id)} className="press rounded-full bg-card px-2 py-0.5 text-[11px] text-accent ring-1 ring-border">
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {status && <p className="pb-2 text-xs text-accent">{status}</p>}

      {archived ? (
        <div className="rounded-2xl bg-card p-3 text-center text-xs text-muted">
          🗄️ This chat is archived — you can still read everything, but nobody can post.
        </div>
      ) : (
        <div className="space-y-2 pb-2">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-muted">
                Replying to {replyTo.author}: {replyTo.text || "attachment"}
              </span>
              <button type="button" onClick={() => setReplyTo(null)} className="press text-faint">✕</button>
            </div>
          )}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pending.map((p, i) => (
                <span key={p.url} className="relative">
                  {p.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-card text-xs">
                      {p.type === "video" ? "🎬" : "📎"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                    className="press absolute -right-1 -top-1 rounded-full bg-foreground/70 px-1 text-[10px] text-white"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {/* ⚠️ A plain, always-mounted input next to a plain button — NEVER
                behind a popup menu. See CLAUDE.md's installed-iOS-PWA incident:
                triggering a file input from inside a popup silently delivers
                nothing in a standalone PWA. */}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach" className="press shrink-0 rounded-full bg-card px-3 py-2 text-lg leading-none ring-1 ring-border">
              +
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={1}
              placeholder="Message everyone going…"
              className="min-h-[40px] flex-1 resize-none rounded-2xl bg-card px-3 py-2 text-sm outline-none ring-1 ring-border"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="press shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}

      {lightbox && <Lightbox url={lightbox.url} photos={lightbox.photos} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="press shrink-0 rounded-full bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-border">
      ‹ Feed
    </button>
  );
}

function Locked({ onBack, title, body }: { onBack: () => void; title: string; body: string }) {
  return (
    <div className="space-y-3 pt-1">
      <Back onBack={onBack} />
      <div className="rounded-2xl bg-card p-5 text-center">
        <p className="text-2xl">🔒</p>
        <p className="mt-2 text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted">{body}</p>
      </div>
    </div>
  );
}

/** @name highlighting. Local by convention — PostsView and WorkItemSheet each
 *  carry their own copy rather than sharing one. */
function MentionText({ text, mentions, members }: { text: string; mentions: string[]; members: Member[] }) {
  if (!mentions.length) return <span className="whitespace-pre-wrap break-words">{text}</span>;
  const names = members.filter((m) => mentions.includes(m.id)).map((m) => m.name).sort((a, b) => b.length - a.length);
  const parts: (string | { name: string })[] = [text];
  for (const name of names) {
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      if (typeof chunk !== "string") continue;
      const at = chunk.indexOf(`@${name}`);
      if (at < 0) continue;
      parts.splice(i, 1, chunk.slice(0, at), { name }, chunk.slice(at + name.length + 1));
    }
  }
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        typeof p === "string" ? p : <span key={i} className="font-semibold text-primary">@{p.name}</span>,
      )}
    </span>
  );
}
