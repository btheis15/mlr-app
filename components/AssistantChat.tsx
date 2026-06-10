"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useIdentity } from "@/components/IdentityProvider";
import { MAX_MESSAGE_LENGTH } from "@/lib/assistant";
import { askAssistantStream } from "@/lib/assistant/client";
import type { Source } from "@/lib/assistant";

// The "Ask MLR" chat panel. Mobile-first, on the shared Sheet. It answers from
// app data only (never private chats). Designed to be obvious to use:
//  • streams the answer in as it's generated (no long blank wait),
//  • speaks answers aloud by default (tap 🔊 to mute) AND shows them written,
//  • a mic with an unmistakable "Listening…" state + live transcript that
//    auto-sends when you stop talking,
//  • example prompts on the empty state so you know what to ask.

type Msg = {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  error?: boolean;
  streaming?: boolean;
};

const EXAMPLE_PROMPTS = [
  "Who's leading the welcome bonfire?",
  "What's for dinner on Friday?",
  "Who's the head chef Saturday?",
  "Where can I get pizza nearby?",
  "How do I RSVP to an event?",
];

const SPEAK_KEY = "mlr-assistant-speak";

// Minimal shape for the Web Speech API (not in lib.dom across all targets).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function AssistantChat({ onClose }: { onClose: () => void }) {
  const { closing, close } = useSheetDismiss(onClose);
  const { now } = useDemoDate();
  const { user } = useIdentity();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speak, setSpeak] = useState(true);

  const bodyRef = useRef<HTMLDivElement>(null);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const speechSupported = getSpeechRecognition() != null;
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const empty = messages.length === 0;

  // Restore the speak preference (default ON — voice-first, per the product ask).
  useEffect(() => {
    try {
      const v = localStorage.getItem(SPEAK_KEY);
      if (v != null) setSpeak(v === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Keep the latest message / live transcript in view.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, interim]);

  // Stop recognition + speech when the panel unmounts.
  useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function toggleSpeak() {
    setSpeak((s) => {
      const next = !s;
      try {
        localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next && ttsSupported) window.speechSynthesis.cancel();
      return next;
    });
  }

  // iOS only lets speechSynthesis fire after a user gesture; calling a silent
  // utterance inside the send/tap unlocks it so the later async answer can speak.
  function primeTts() {
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }
  function speakText(text: string) {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch {
      /* ignore */
    }
  }

  // Update the most recent assistant message in place (for streaming + sources).
  function patchLastAssistant(list: Msg[], fn: (m: Msg) => Msg): Msg[] {
    const out = [...list];
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === "assistant") {
        out[i] = fn(out[i]);
        break;
      }
    }
    return out;
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setInterim("");
    if (speak && ttsSupported) primeTts();
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "", streaming: true }]);
    setBusy(true);
    let acc = "";
    try {
      await askAssistantStream(
        { message: q, signedIn: Boolean(user), userId: user ? user.email : null, now: now ?? new Date() },
        {
          onSources: (sources) => setMessages((m) => patchLastAssistant(m, (msg) => ({ ...msg, sources }))),
          onDelta: (delta) => {
            acc += delta;
            setMessages((m) => patchLastAssistant(m, (msg) => ({ ...msg, text: acc })));
          },
        },
      );
      setMessages((m) => patchLastAssistant(m, (msg) => ({ ...msg, streaming: false })));
      if (speak && ttsSupported && acc.trim()) speakText(acc);
    } catch {
      setMessages((m) =>
        patchLastAssistant(m, (msg) => ({
          ...msg,
          text: acc || "Something went wrong. Please try again in a moment.",
          error: !acc,
          streaming: false,
        })),
      );
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    const Recognition = getSpeechRecognition();
    if (!Recognition || busy) return;
    if (ttsSupported) window.speechSynthesis.cancel(); // don't talk over the user
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    transcriptRef.current = "";
    rec.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0]?.transcript ?? "";
      transcriptRef.current = txt;
      setInterim(txt);
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    rec.onend = () => {
      setListening(false);
      const t = transcriptRef.current.trim();
      transcriptRef.current = "";
      setInterim("");
      if (t) void send(t);
    };
    recognizerRef.current = rec;
    setListening(true);
    rec.start();
  }
  function stopListening() {
    recognizerRef.current?.stop();
  }

  const lastAssistant = messages[messages.length - 1];
  const thinking = lastAssistant?.role === "assistant" && lastAssistant.streaming && !lastAssistant.text;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="assistant-title"
      header={
        <div className="flex items-start justify-between gap-2 pr-8">
          <div>
            <h2 id="assistant-title" className="flex items-center gap-1.5 text-lg font-bold">
              <span aria-hidden>✨</span> Ask MLR
            </h2>
            <p className="text-xs text-foreground/50">Answers from your resort info — never private chats.</p>
          </div>
          {ttsSupported && (
            <button
              type="button"
              onClick={toggleSpeak}
              aria-pressed={speak}
              aria-label={speak ? "Mute spoken answers" : "Speak answers aloud"}
              title={speak ? "Spoken answers on" : "Spoken answers off"}
              className={`press mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ring-1 ${
                speak ? "bg-primary/15 text-primary ring-primary/30" : "bg-card text-foreground/50 ring-border"
              }`}
            >
              <span aria-hidden>{speak ? "🔊" : "🔇"}</span>
            </button>
          )}
        </div>
      }
      footer={
        listening ? (
          <div className="flex items-center gap-3 rounded-2xl bg-primary/10 px-3 py-3 ring-1 ring-primary/30">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
              <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
                🎙
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary">Listening…</p>
              <p className="truncate text-xs text-foreground/60">{interim || "Say your question, then pause."}</p>
            </div>
            <button
              type="button"
              onClick={stopListening}
              className="press shrink-0 rounded-full bg-card px-4 py-2 text-sm font-semibold text-foreground ring-1 ring-border"
            >
              Stop
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2"
          >
            {speechSupported && (
              <button
                type="button"
                onClick={startListening}
                disabled={busy}
                aria-label="Speak your question"
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-lg text-foreground/70 ring-1 ring-border disabled:opacity-40"
              >
                🎙
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Ask a question…"
              enterKeyHint="send"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="press flex h-11 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
        )
      }
    >
      <div ref={bodyRef} className="flex flex-col gap-3">
        {empty ? (
          <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl" aria-hidden>
              ✨
            </div>
            <div>
              <p className="text-base font-semibold">Hi! How can I help?</p>
              <p className="mt-1 text-sm text-foreground/60">
                Ask about the schedule, who&rsquo;s in charge, a contact, a place, or where to find something in the
                app. Tap the mic to ask by voice.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void send(p)}
                  className="press rounded-xl bg-card px-3 py-2.5 text-left text-sm text-foreground ring-1 ring-border hover:ring-primary/40"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end" : "self-start"} style={{ maxWidth: "85%" }}>
              <div
                className={`whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-white"
                    : m.error
                      ? "bg-card text-foreground ring-1 ring-accent/40"
                      : "bg-card text-foreground ring-1 ring-border"
                }`}
              >
                {m.role === "assistant" && m.streaming && !m.text ? (
                  <span className="inline-flex gap-1 text-foreground/40" aria-label="Thinking">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse [animation-delay:150ms]">●</span>
                    <span className="animate-pulse [animation-delay:300ms]">●</span>
                  </span>
                ) : (
                  <>
                    {m.text}
                    {m.streaming && <span className="ml-0.5 inline-block animate-pulse">▌</span>}
                  </>
                )}
              </div>
              {m.sources && m.sources.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 px-1">
                  {m.sources.slice(0, 4).map((s) => (
                    <span
                      key={`${s.type}:${s.id}`}
                      className="rounded-full bg-background px-2 py-0.5 text-[11px] text-foreground/50 ring-1 ring-border"
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/* The live transcript also shows as a pending user bubble while talking. */}
        {listening && interim && (
          <div className="self-end opacity-70" style={{ maxWidth: "85%" }}>
            <div className="rounded-2xl bg-primary/70 px-3.5 py-2.5 text-sm text-white">{interim}</div>
          </div>
        )}

        {!empty && thinking && (
          <p className="self-start px-1 text-[11px] text-foreground/40">Thinking on-device…</p>
        )}
      </div>
    </Sheet>
  );
}
