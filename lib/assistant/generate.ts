// The single, swappable AI-provider seam for the assistant.
//
// generateAssistantAnswer() is the ONLY place that talks to a model. Everything
// upstream (auth, intent, retrieval/allow-list) has already decided what the
// model is allowed to see; this function just turns the selected context into a
// short answer. Swap the body to point at a provider without touching the rest:
//
//   • Apple Foundation Models — a small Swift service on the Mac mini (the only
//     place Apple's on-device model runs). Phase 2: POST to ASSISTANT_FM_URL.
//   • Ollama / llama.cpp — same shape, different URL.
//   • A cloud API (Claude, …) — call from the server route.
//
// Until a model is wired, the deterministic GROUNDED-STUB below assembles a
// faithful answer straight from the context records (no invention — it only
// quotes what retrieval handed it), so the whole feature is demoable today and
// upgrades to real generation by editing only this file.

import type { GenerateAssistantAnswerArgs, ContextRecord } from "@/lib/assistant/types";

/** The model's instructions. Used verbatim by whichever provider is wired in
 *  (passed to the FM service / cloud call). Kept here so prompt + transport
 *  live together. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the assistant inside the Muskellunge Lake Resort (MLR) private app. Help signed-in members quickly find information from the app's approved data context.

Rules:
- Answer ONLY using the context records provided to you. Do not guess or invent names, phone numbers, schedules, roles, assignments, or locations.
- If the answer is not in the context, say you couldn't find it in the app data and suggest asking about a specific person, date, role, or location.
- Keep answers short and practical (1–3 sentences).
- When useful, mention which record the answer came from.
- If several records match, ask one brief clarifying question.
- Never reveal anything outside the provided context. You cannot see private chats.`;

/** When set, generation is delegated to that HTTP endpoint (the Mac mini's Swift
 *  Foundation Models service, or any provider exposing the same contract). Unset
 *  in this phase → the grounded stub answers. */
const FM_URL = process.env.ASSISTANT_FM_URL || process.env.NEXT_PUBLIC_ASSISTANT_FM_URL;

/** Shared secret sent as the `X-FM-Token` header so the FM service (reached over
 *  a public tunnel) only answers calls from this server. Server-only — never
 *  NEXT_PUBLIC, or it would ship in the browser bundle. Unset → no header sent. */
const FM_TOKEN = process.env.ASSISTANT_FM_TOKEN;

/** Whole-response ceiling (blocking path) / overall guard (streaming). The
 *  on-device M1 model is ~5–12s and variable, so 12s was too tight — it dropped
 *  good answers to the stub. 30s leaves headroom; streaming surfaces tokens long
 *  before this fires. */
const FM_TIMEOUT_MS = 30_000;

const FALLBACK =
  "I couldn't find that in the app data. Try asking about a specific person, date, role, or location.";

export async function generateAssistantAnswer(args: GenerateAssistantAnswerArgs): Promise<string> {
  if (args.contextRecords.length === 0) return FALLBACK;

  if (FM_URL) {
    try {
      return await callModel(FM_URL, args);
    } catch {
      // Any model/transport failure degrades to the grounded stub rather than
      // erroring the chat — the records are right there, so we can still answer.
      return groundedStub(args);
    }
  }

  return groundedStub(args);
}

/**
 * Phase 2 transport. The Swift Foundation Models service on the mini accepts
 * { system, question, context } and returns { answer }. Same contract works for
 * Ollama or a cloud proxy — only the URL changes.
 */
async function callModel(url: string, args: GenerateAssistantAnswerArgs): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(FM_TOKEN ? { "x-fm-token": FM_TOKEN } : {}),
      },
      body: JSON.stringify({
        system: ASSISTANT_SYSTEM_PROMPT,
        question: args.userMessage,
        context: formatContext(args.contextRecords),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`FM service ${res.status}`);
    const data = (await res.json()) as { answer?: string };
    const answer = data.answer?.trim();
    if (!answer) throw new Error("empty answer");
    return answer;
  } finally {
    clearTimeout(timer);
  }
}

// Bound what the model sees. The on-device M1 model is prefill-bound, so a broad
// question that retrieves many verbose records (e.g. "what's the schedule" pulls
// the whole week) otherwise blows past the timeout. Cap the record count and trim
// each to its front-loaded facts. The grounded-stub fallback still uses the full
// records, so the displayed answer for list questions stays complete.
const MODEL_MAX_RECORDS = 8;
const MODEL_MAX_RECORD_CHARS = 200;
function formatContext(records: ContextRecord[]): string {
  return records
    .slice(0, MODEL_MAX_RECORDS)
    .map((r) => {
      const text =
        r.text.length > MODEL_MAX_RECORD_CHARS ? `${r.text.slice(0, MODEL_MAX_RECORD_CHARS)}…` : r.text;
      return `[${r.kind}:${r.id}] ${r.label}: ${text}`;
    })
    .join("\n");
}

/**
 * Streaming generation. Yields text deltas as the model produces them (the FM
 * service streams cumulative snapshots; we forward the new text). Falls back to
 * the grounded stub when no model is wired, or if the stream fails/times out
 * BEFORE any token — but keeps a partial answer if tokens already arrived.
 */
export async function* streamAssistantAnswer(
  args: GenerateAssistantAnswerArgs,
): AsyncGenerator<string> {
  if (args.contextRecords.length === 0) {
    yield FALLBACK;
    return;
  }
  if (FM_URL) {
    let yielded = false;
    try {
      for await (const delta of streamFromModel(FM_URL, args)) {
        yielded = true;
        yield delta;
      }
      return;
    } catch {
      if (yielded) return; // keep the partial answer rather than discarding it
    }
  }
  yield groundedStub(args);
}

/** Consume the FM service's SSE stream (`data: {"delta":"..."}` … `event: done`),
 *  yielding each text delta. Aborts the whole stream after FM_TIMEOUT_MS. */
async function* streamFromModel(
  url: string,
  args: GenerateAssistantAnswerArgs,
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FM_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(FM_TOKEN ? { "x-fm-token": FM_TOKEN } : {}),
      },
      body: JSON.stringify({
        system: ASSISTANT_SYSTEM_PROMPT,
        question: args.userMessage,
        context: formatContext(args.contextRecords),
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`FM stream ${res.status}`);
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
        if (event === "error") throw new Error("FM stream error");
        if (data) {
          const parsed = JSON.parse(data) as { delta?: string };
          if (parsed.delta) yield parsed.delta;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic, no-model answer. It NEVER invents anything — it just stitches
 * together the (already allow-listed, already-redacted) context lines. This is
 * the honest stand-in until a model is wired, and the safety floor if the model
 * call fails.
 */
function groundedStub(args: GenerateAssistantAnswerArgs): string {
  const top = args.contextRecords.slice(0, 3);
  if (top.length === 1) return top[0].text;
  const lines = top.map((r) => `• ${r.text}`).join("\n");
  return `Here's what I found in the app:\n${lines}${
    args.contextRecords.length > top.length ? "\n(Ask about a specific person, day, or place to narrow it down.)" : ""
  }`;
}
