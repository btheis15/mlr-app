"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, FIELD } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useIdentity } from "@/components/IdentityProvider";
import { MAX_MESSAGE_LENGTH } from "@/lib/assistant";
import { askAssistantClient } from "@/lib/assistant/client";
import type { Source } from "@/lib/assistant";

// The "Ask MLR" chat panel. Mobile-first, built on the shared Sheet. Text input
// + send, a mic button (browser Speech Recognition, hidden where unsupported),
// an optional read-aloud toggle (Speech Synthesis), loading + error states.
// Signed-in only — the button that opens this already gates on sign-in.

type Msg = {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  error?: boolean;
};

// Minimal shapes for the Web Speech API (not in lib.dom across all targets).
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

  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi! Ask me about the schedule, who's in charge on a given day, a contact, a location, or where to find something in the app.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = getSpeechRecognition() != null;
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Stop any in-flight recognition/speech when the panel unmounts.
  useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await askAssistantClient({
        message: q,
        signedIn: Boolean(user),
        userId: user ? user.email : null,
        now: now ?? new Date(),
      });
      setMessages((m) => [...m, { role: "assistant", text: res.answer, sources: res.sources }]);
      if (speak && ttsSupported) {
        const u = new SpeechSynthesisUtterance(res.answer);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Something went wrong. Please try again in a moment.", error: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((cur) => (cur ? `${cur} ${transcript}` : transcript));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognizerRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="assistant-title"
      header={
        <div className="pr-8">
          <h2 id="assistant-title" className="text-lg font-bold">
            Ask MLR
          </h2>
          <p className="text-xs text-foreground/50">Answers from your resort info — never private chats.</p>
        </div>
      }
      footer={
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
              onClick={toggleMic}
              aria-label={listening ? "Stop listening" : "Speak your question"}
              aria-pressed={listening}
              className={`press flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-border ${
                listening ? "bg-primary text-white" : "bg-card text-foreground/70"
              }`}
            >
              {listening ? "■" : "🎙"}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={listening ? "Listening…" : "Ask a question…"}
            enterKeyHint="send"
            className={`${FIELD} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="press flex h-10 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      }
    >
      <div ref={bodyRef} className="flex flex-col gap-3">
        {messages.map((m, i) => (
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
              {m.text}
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
        ))}

        {busy && (
          <div className="self-start rounded-2xl bg-card px-3.5 py-2.5 text-sm text-foreground/40 ring-1 ring-border">
            <span className="inline-flex gap-1">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse [animation-delay:150ms]">●</span>
              <span className="animate-pulse [animation-delay:300ms]">●</span>
            </span>
          </div>
        )}

        {ttsSupported && (
          <label className="mt-1 flex items-center gap-2 self-start px-1 text-xs text-foreground/50">
            <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />
            Read answers aloud
          </label>
        )}
      </div>
    </Sheet>
  );
}
