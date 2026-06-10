import { supabase } from "@/lib/supabase";
import { askAssistant } from "@/lib/assistant";
import type { AssistantResponse } from "@/lib/assistant/types";

/**
 * The UI's entry point to the assistant. Prefers the server route
 * (`POST /api/assistant` — token-auth + the model on the mini); falls back to
 * the in-browser pipeline when there's no server (the static GitHub Pages build)
 * or the route is unreachable.
 *
 * Both paths uphold the two guarantees: the sign-in gate and the chats-excluded
 * retrieval live in `askAssistant`, and the server route re-verifies the token.
 */
export async function askAssistantClient(opts: {
  message: string;
  signedIn: boolean;
  userId?: string | null;
  now?: Date;
}): Promise<AssistantResponse> {
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (token) {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: opts.message }),
      });
      if (res.ok) return (await res.json()) as AssistantResponse;
      // 404 (static build, no route) or other status → fall through to local.
    }
  } catch {
    /* network / no backend → local pipeline */
  }
  return askAssistant(opts);
}
