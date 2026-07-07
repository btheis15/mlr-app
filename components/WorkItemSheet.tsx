"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkItem, WorkItemComment } from "@/lib/types";
import { fetchWorkItemComments, addWorkItemComment, removeWorkItemComment, URGENCY_META } from "@/lib/workItems";
import { supabase } from "@/lib/supabase";
import { Sheet } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { MediaGrid } from "@/components/MediaGrid";

// Work-item detail + comment thread. Opens when any member taps a checklist row,
// so a task can hold a little Q&A (the requestor asks, others reply to help).
// Plain text comments + @mentions only. Admins get an Edit button that hands off
// to WorkItemComposer via the onEdit callback.

export interface WorkItemMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

function matchesName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const n = name.toLowerCase();
  return n.includes(q) || n.split(/\s+/).some((w) => w.startsWith(q));
}

export function WorkItemSheet({
  item,
  members,
  onClose,
  onChanged,
  onEdit,
}: {
  item: WorkItem;
  /** Mention candidates — the people who can see this item (caller scopes these). */
  members: WorkItemMember[];
  onClose: () => void;
  onChanged?: () => void;
  onEdit?: () => void;
}) {
  const { user, isAdmin, promptSignIn } = useIdentity();
  const { closing, close } = useSheetDismiss(onClose);
  const [uid, setUid] = useState<string | null>(null);
  const [comments, setComments] = useState<WorkItemComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  const load = async () => {
    const c = await fetchWorkItemComments(item.id);
    setComments(c);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item.id]);

  const del = async (c: WorkItemComment) => {
    if (!window.confirm("Delete this comment?")) return;
    const prev = comments;
    setComments((cs) => cs.filter((x) => x.id !== c.id));
    const { error } = await removeWorkItemComment(c.id);
    if (error) setComments(prev);
    else onChanged?.();
  };

  const add = async (text: string, mentionIds: string[]) => {
    if (!user) { promptSignIn(); return; }
    const { error } = await addWorkItemComment(item.id, text, mentionIds);
    if (!error) { await load(); onChanged?.(); }
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="work-item-sheet-title"
      header={
        // pr-10 keeps the Edit button clear of the sheet's absolute ✕ close.
        <div className="flex items-center gap-2 pr-10">
          <span aria-hidden>🔧</span>
          <h2 id="work-item-sheet-title" className="min-w-0 flex-1 truncate text-lg font-bold">{item.title}</h2>
          {isAdmin && onEdit && (
            <button
              type="button"
              onClick={() => { onEdit(); close(); }}
              className="press shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30"
            >
              Edit
            </button>
          )}
        </div>
      }
    >
      {item.notes && <p className="whitespace-pre-wrap text-sm text-foreground/70">{item.notes}</p>}
      <span className="flex flex-wrap items-center gap-1.5">
        {item.urgency && (
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${URGENCY_META[item.urgency].chip}`}>
            {URGENCY_META[item.urgency].emoji} {URGENCY_META[item.urgency].label}
          </span>
        )}
        {item.peopleNeeded != null && (
          <span className="inline-block rounded-md bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground/50 ring-1 ring-border">
            👥 {item.peopleNeeded} needed
          </span>
        )}
      </span>
      {item.media.length > 0 && <MediaGrid media={item.media} />}

      {/* Comments */}
      <div className="space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-foreground/50">
          Comments{comments.length ? ` · ${comments.length}` : ""}
        </p>
        {loading ? (
          <p className="py-2 text-center text-xs text-foreground/40">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="py-1 text-xs text-foreground/50">No comments yet. Ask a question or leave a note.</p>
        ) : (
          <ul className="space-y-2.5">
            {comments.map((c) => (
              <li key={c.id} className="flex items-start gap-2.5">
                <Avatar name={c.authorName} url={c.authorAvatarUrl} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-xs font-semibold text-foreground/70">
                    {c.authorName}
                    <span className="ml-1 font-normal text-foreground/40">{formatWhen(c.createdAt)}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    <MentionText text={c.text} mentions={c.mentions} members={members} />
                  </p>
                </div>
                {(c.authorId === uid || isAdmin) && (
                  <button
                    type="button"
                    onClick={() => del(c)}
                    aria-label="Delete comment"
                    className="press shrink-0 text-foreground/30 hover:text-accent"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <CommentBox members={members} uid={uid} signedIn={Boolean(user)} onPromptSignIn={promptSignIn} onAdd={add} />
      </div>
    </Sheet>
  );
}

// Render comment text with @mentions of known members highlighted.
function MentionText({ text, mentions, members }: { text: string; mentions: string[]; members: WorkItemMember[] }) {
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

// Plain-text comment composer with inline @mention autocomplete (no media).
function CommentBox({
  members,
  uid,
  signedIn,
  onPromptSignIn,
  onAdd,
}: {
  members: WorkItemMember[];
  uid: string | null;
  signedIn: boolean;
  onPromptSignIn: () => void;
  onAdd: (text: string, mentionIds: string[]) => void;
}) {
  const [v, setV] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const liveMentions = (val: string) =>
    mentionIds.filter((id) => {
      const n = members.find((m) => m.id === id)?.name;
      return n ? val.includes(`@${n}`) : false;
    });

  const onChange = (val: string) => {
    setV(val);
    if (mentionIds.length) setMentionIds(liveMentions(val));
  };

  const mentionQuery = (() => {
    const m = /(?:^|\s)@(\S*)$/.exec(v);
    return m ? m[1].toLowerCase() : null;
  })();
  const candidates = mentionQuery !== null
    ? members.filter((m) => m.id !== uid && matchesName(m.name, mentionQuery)).slice(0, 6)
    : [];
  const choose = (m: WorkItemMember) => {
    const at = v.lastIndexOf("@");
    setV(v.slice(0, at) + `@${m.name} `);
    setMentionIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id]));
    inputRef.current?.focus();
  };

  const submit = async () => {
    if (!signedIn) { onPromptSignIn(); return; }
    const t = v.trim();
    if (!t || pending) return;
    setPending(true);
    await onAdd(t, liveMentions(v));
    setV("");
    setMentionIds([]);
    setPending(false);
  };

  return (
    <div className="space-y-1">
      {candidates.length > 0 && (
        <div className="rounded-xl bg-card ring-1 ring-border">
          {candidates.map((m) => (
            <button key={m.id} type="button" onClick={() => choose(m)} className="press flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-background">
              <Avatar name={m.name} url={m.avatarUrl} size={22} />
              <span className="font-medium">{m.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={v}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          placeholder={signedIn ? "Add a comment… (@ to mention)" : "Sign in to comment"}
          className="min-h-10 flex-1 rounded-xl bg-background px-3 py-2 text-base ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || (signedIn && !v.trim())}
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40"
          aria-label="Post comment"
        >
          {pending ? "…" : "➤"}
        </button>
      </div>
    </div>
  );
}

function formatWhen(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
