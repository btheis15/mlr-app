"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { useIdentity } from "@/components/IdentityProvider";
import { READ_ONLY } from "@/lib/features";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";

const STORAGE_KEY = "mlr-chat";

/**
 * Resort chat. Messages are tied to the signed-in guest's name + email. Today
 * they're stored per-device in localStorage (seed messages come from props), so
 * this is single-device until a shared backend lands — see the note rendered in
 * the view and CLAUDE.md. The composer + message shape are backend-ready.
 */
export function ChatView({ seed }: { seed: ChatMessage[] }) {
  const { user, promptSignIn } = useIdentity();
  const [posted, setPosted] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPosted(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(posted));
  }, [posted, loaded]);

  const messages = useMemo(
    () => [...seed, ...posted].sort((a, b) => a.ts.localeCompare(b.ts)),
    [seed, posted],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !user) return;
    setPosted((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        author: user.name,
        email: user.email,
        text: body,
        ts: new Date().toISOString(),
      },
    ]);
    setText("");
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col pt-6">
      <header className="space-y-1 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
        <p className="text-sm text-foreground/60">
          What&rsquo;s happening around the lake.
        </p>
      </header>

      {!READ_ONLY && (
        <p className="mb-3 rounded-xl bg-card px-3 py-2 text-xs text-foreground/60 ring-1 ring-border">
          Messages are stored on this device for now — a shared room across
          everyone&rsquo;s phones is the next step.
        </p>
      )}

      <div className="flex-1 space-y-3">
        {messages.map((m) => {
          const mine = user?.email === m.email;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 ring-1 ${
                  mine
                    ? "bg-primary/15 ring-primary/30"
                    : "bg-card ring-border"
                }`}
              >
                {!mine && (
                  <p className="text-xs font-semibold text-accent">{m.author}</p>
                )}
                <p className="text-sm">{m.text}</p>
                <p className="mt-0.5 text-right text-[10px] text-foreground/40">
                  {timeAgo(m.ts)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {READ_ONLY ? (
        <div className="sticky bottom-20 mt-3">
          <ComingSoonCTA
            icon="💬"
            title="Posting opens soon"
            note="Sign in to join the conversation is on the way — read along for now."
          />
        </div>
      ) : user ? (
        <form
          onSubmit={send}
          className="sticky bottom-20 mt-3 flex gap-2 bg-background/80 py-2 backdrop-blur"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message as ${user.name}…`}
            className="flex-1 rounded-full bg-card px-4 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : (
        <button
          onClick={promptSignIn}
          className="sticky bottom-20 mt-3 w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-white"
        >
          Add your name &amp; email to join the chat
        </button>
      )}
    </div>
  );
}
