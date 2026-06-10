// Shared types for the AI Assistant feature (the "Ask MLR" convenience bot).
//
// The assistant answers questions ONLY from app data the current (signed-in)
// member is already allowed to see. Two hard rules shape everything here and are
// enforced in the layers below — see lib/assistant/index.ts and retrieval.ts:
//
//   1. SIGNED-IN ONLY — guests never reach the model; the UI gates on sign-in
//      and the (future) server route re-checks the Supabase token.
//   2. CHATS ARE NEVER A SOURCE — resort chat + committee chat are deliberately
//      excluded from retrieval. Posts (public to any signed-in member) are the
//      only sanctioned social source. See SOURCE_ALLOWLIST in retrieval.ts.
//
// The model layer is swapped behind generateAssistantAnswer() (generate.ts) so
// Apple Foundation Models (on the Mac mini), Ollama, or a cloud API can each
// slot in without touching the retrieval/intent code.

/** What the user is asking for — drives which records we pull. Mirrors the
 *  intent list in the feature spec; `unknown` falls back to app-help guidance. */
export type AssistantIntent =
  | "contact_lookup"
  | "schedule_lookup"
  | "role_lookup"
  | "assignment_lookup"
  | "location_lookup"
  | "app_help"
  | "unknown";

/** One record handed to the model as grounding. `kind` matches a Source.type so
 *  the model can cite it; `text` is a compact, already-redacted line (no fields
 *  beyond what a signed-in member sees in the app). */
export interface ContextRecord {
  kind: SourceType;
  /** Stable id of the underlying record (schedule id, committee slug, …). */
  id: string;
  /** Human label, e.g. "Friday schedule" or "Beautification committee". */
  label: string;
  /** The compact factual line(s) the model may quote from. */
  text: string;
}

export type SourceType =
  | "schedule"
  | "dinner"
  | "event"
  | "committee"
  | "activity"
  | "place"
  | "resort"
  | "post"
  | "app_help";

/** A citation returned to the UI alongside the answer (the spec's `sources`). */
export interface Source {
  type: SourceType;
  id: string;
  label: string;
}

/** Request body for the assistant (POST /api/assistant once the server route
 *  lands; the same shape the client passes to askAssistant today). */
export interface AssistantRequest {
  message: string;
  conversationId?: string;
}

/** Response body the UI renders (the spec's `{ answer, sources }`). */
export interface AssistantResponse {
  answer: string;
  sources: Source[];
  /** The classified intent — handy for the UI + debugging/logging. */
  intent: AssistantIntent;
}

/** The single seam every AI provider implements (generate.ts). The server
 *  controls everything passed in; the provider only sees this selected context,
 *  never the raw database. */
export interface GenerateAssistantAnswerArgs {
  userMessage: string;
  /** The signed-in member's id (for logging/personalization; never the model's
   *  to widen access — retrieval already scoped what it can see). */
  userId: string | null;
  /** Coarse capabilities of the caller (room to grow; e.g. isAdmin later). */
  permissions: { signedIn: boolean };
  /** The selected, allow-listed records — the ONLY data the model receives. */
  contextRecords: ContextRecord[];
}
