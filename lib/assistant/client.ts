import { supabase } from "@/lib/supabase";
import { askAssistant } from "@/lib/assistant";
import type { Source } from "@/lib/assistant/types";

export interface StreamHandlers {
  /** Called once, before any text, with the citations + classified intent. */
  onSources?: (sources: Source[], intent: string) => void;
  /** Called repeatedly with each new chunk of answer text. */
  onDelta: (delta: string) => void;
}

/**
 * Drive the assistant with streaming output. Prefers the server route
 * (`POST /api/assistant`, which streams Server-Sent Events: token-auth + the
 * on-device model on the mini). Falls back to the in-browser pipeline — emitted
 * as a single delta — when there's no server (static Pages build), the route is
 * unreachable, or the response isn't a stream (e.g. a 401/403). The sign-in gate
 * and chats-excluded retrieval hold on both paths.
 */
export async function askAssistantStream(
  opts: { message: string; signedIn: boolean; userId?: string | null; now?: Date },
  handlers: StreamHandlers,
): Promise<void> {
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (token) {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: opts.message }),
      });
      const isStream = res.headers.get("content-type")?.includes("text/event-stream");
      if (res.ok && res.body && isStream) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const evt = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let event = "message";
            let data = "";
            for (const line of evt.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (event === "done") return;
            if (event === "error") throw new Error("stream error");
            if (event === "sources" && data) {
              const p = JSON.parse(data) as { sources?: Source[]; intent?: string };
              handlers.onSources?.(p.sources ?? [], p.intent ?? "unknown");
              continue;
            }
            if (data) {
              const p = JSON.parse(data) as { delta?: string };
              if (p.delta) handlers.onDelta(p.delta);
            }
          }
        }
        return;
      }
      // Non-stream response (404 on static Pages, or 401/403) → fall through.
    }
  } catch {
    /* network / no backend / mid-stream failure → in-browser fallback below */
  }
  // Fallback: run the pipeline in the browser and emit the answer in one go.
  const res = await askAssistant(opts);
  handlers.onSources?.(res.sources, res.intent);
  handlers.onDelta(res.answer);
}
