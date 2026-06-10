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
import { generateAssistantAnswer } from "@/lib/assistant/generate";
import type { AssistantResponse } from "@/lib/assistant/types";

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

export type { AssistantResponse, Source, AssistantIntent } from "@/lib/assistant/types";
