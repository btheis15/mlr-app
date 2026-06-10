// Orchestrator for the AI Assistant — the one call the UI (and, later, the
// server route) makes. Enforces the guardrails in order, then runs the pipeline:
//
//   sign-in gate → length guard → classify intent → retrieve allow-listed
//   context → generate a short answer → return { answer, sources, intent }.
//
// The same function backs the client today and the POST /api/assistant route in
// Phase 1 (see docs/ai-assistant.md). It is provider-agnostic: the model is
// reached only through generateAssistantAnswer (generate.ts).

import { classifyIntent } from "@/lib/assistant/intent";
import { retrieveContext } from "@/lib/assistant/retrieval";
import { generateAssistantAnswer, streamAssistantAnswer } from "@/lib/assistant/generate";
import type { AssistantResponse, AssistantIntent, Source } from "@/lib/assistant/types";

/** Max characters accepted from the user (spec: cap input length). */
export const MAX_MESSAGE_LENGTH = 500;

const SIGN_IN_REQUIRED =
  "Please sign in to use the assistant — it answers from your resort info once you're signed in.";

export async function askAssistant(opts: {
  message: string;
  /** Must be true. The bot is signed-in-only; guests never reach the model. */
  signedIn: boolean;
  /** The signed-in member's id (logging/personalization only). */
  userId?: string | null;
  /** Effective "today" (real or demo clock) for resolving "Friday"/"tonight". */
  now?: Date;
}): Promise<AssistantResponse> {
  const { signedIn, userId = null } = opts;

  // Guardrail 1 — signed-in only.
  if (!signedIn) {
    return { answer: SIGN_IN_REQUIRED, sources: [], intent: "unknown" };
  }

  const message = opts.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!message) {
    return {
      answer: "Ask me about the schedule, who's in charge, a contact, a location, or where to find something in the app.",
      sources: [],
      intent: "unknown",
    };
  }

  const now = opts.now ?? new Date();
  const intent = classifyIntent(message);
  const { records, sources } = retrieveContext(intent, message, now);

  const answer = await generateAssistantAnswer({
    userMessage: message,
    userId,
    permissions: { signedIn },
    contextRecords: records,
  });

  return { answer, sources, intent };
}

/** Streaming sibling of askAssistant: same sign-in gate + intent + chats-excluded
 *  retrieval, but returns the sources up front plus an async stream of answer
 *  deltas (the model's output as it generates). The server route forwards this to
 *  the browser as SSE; the in-browser fallback collects it into one answer. */
export async function streamAssistant(opts: {
  message: string;
  signedIn: boolean;
  userId?: string | null;
  now?: Date;
}): Promise<{ intent: AssistantIntent; sources: Source[]; stream: AsyncGenerator<string> }> {
  if (!opts.signedIn) {
    return { intent: "unknown", sources: [], stream: once(SIGN_IN_REQUIRED) };
  }
  const message = opts.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!message) {
    return {
      intent: "unknown",
      sources: [],
      stream: once("Ask me about the schedule, who's in charge, a contact, a location, or where to find something in the app."),
    };
  }
  const now = opts.now ?? new Date();
  const intent = classifyIntent(message);
  const { records, sources } = retrieveContext(intent, message, now);
  const stream = streamAssistantAnswer({
    userMessage: message,
    userId: opts.userId ?? null,
    permissions: { signedIn: true },
    contextRecords: records,
  });
  return { intent, sources, stream };
}

async function* once(text: string): AsyncGenerator<string> {
  yield text;
}

export type { AssistantResponse, Source, AssistantIntent };
