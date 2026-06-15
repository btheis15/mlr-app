# AI Assistant ("Ask MLR")

A signed-in convenience bot that answers questions from app data the member can
already see — schedule, who's in charge, contacts, locations, and "where do I
find this?" navigation. It does **not** invent anything and it answers only from
a small, allow-listed slice of data the server hands the model.

## The two guarantees (the privacy bar)

1. **Signed-in only.** Guests never reach the model. The floating button is **off
   by default** and shows only for **Beta Testers who opt in** (Profile → Beta
   features → `AssistantToggle`, a per-device switch in `lib/assistantToggle.ts`);
   beta implies a signed-in account. `askAssistant` refuses when `signedIn` is
   false, and the future server route re-checks the Supabase token.
2. **Chats are never a source.** Resort chat and committee chat are deliberately
   absent from retrieval — there is no code path that reads them. **Posts** (which
   any signed-in member can already see) are the only sanctioned social source;
   they're allow-listed but not yet wired. See `SOURCE_ALLOWLIST` in
   `lib/assistant/retrieval.ts`.

Because every member can already see all posts + the resort info, "signed-in +
no chats" is the whole bar — it does not depend on the larger RLS-hardening work.

## Pipeline

```
question
  → sign-in gate           (lib/assistant/index.ts: askAssistant)
  → length cap (500 chars)
  → classify intent        (lib/assistant/intent.ts)
  → retrieve allow-listed   (lib/assistant/retrieval.ts)  ← chats excluded here
    context (≤12 records)
  → generate short answer   (lib/assistant/generate.ts)   ← the only model call
  → { answer, sources, intent }
```

Intents: `contact_lookup`, `schedule_lookup`, `role_lookup`, `assignment_lookup`,
`location_lookup`, `app_help`, `unknown`.

The orchestrator (`askAssistant`) is provider- and transport-agnostic: it runs
**client-side today** (the chat panel calls it directly; all v1 data is static
and already in the bundle, so this exposes nothing new and works on both the
Vercel and GitHub Pages builds) and drops into the server route unchanged in
Phase 1.

## Model seam

`generateAssistantAnswer()` in `lib/assistant/generate.ts` is the single place a
model is reached.

- **No model wired (today):** a deterministic *grounded stub* assembles the
  answer from the retrieved records — no invention, fully demoable, and the
  safety floor if a model call ever fails.
- **Apple Foundation Models:** set `ASSISTANT_FM_URL` to the Swift service on the
  mini (`media-server/fm-service/`). Apple's models only run on Apple devices, so
  the *generation step* lives on the mini even though orchestration lives on
  Vercel. On macOS 27 the service prefers Apple's **Private Cloud Compute** model
  (much more capable, ~32K-token context) and falls back to the small on-device
  model automatically. **PCC needs a code-signed, entitled build** — an ad-hoc
  `swift build` binary falls back to on-device (see
  `media-server/fm-service/README.md`). Contract:
  `POST {system, question, context} → {answer, model}` (`model` is informational;
  the app reads only `answer`).
- **Other providers:** expose the same contract (Ollama, a cloud proxy) and
  point `ASSISTANT_FM_URL` at it.

## Phasing

- **Phase 1 (done here, provider-agnostic):** intent + retrieval over static app
  data, the chat UI (button, panel, mic via Web Speech with graceful fallback,
  read-aloud via Speech Synthesis, loading/error states), the sign-in gate, and
  the chats-excluded allow-list. Grounded stub answers.
- **Phase 1.5 (server route, Vercel-only) — implemented:** orchestration runs
  behind `POST /api/assistant` (`app/api/assistant/route.ts`), which validates the
  Supabase token and rate-limits per user. The UI reaches it through
  `lib/assistant/client.ts`, which falls back to the in-browser pipeline on the
  static Pages build. Reading **posts** + the **member directory** as the signed-in
  user remains an optional extension.
- **Phase 2 — running on the mini:** the Swift Foundation Models service
  (`media-server/fm-service/`) runs as a LaunchAgent (`com.mlr.fm-service`, bound
  to `127.0.0.1:8788`). Set `ASSISTANT_FM_URL` to its tunnel URL to switch
  generation from the grounded stub to Apple Foundation Models — Private Cloud
  Compute when the build is signed/entitled, on-device otherwise.

## Server route (Vercel only)

Committed at `app/api/assistant/route.ts`. The GitHub Pages build uses
`output: "export"` (static), which can't host a POST route handler, so the deploy
workflow (`.github/workflows/pages.yml`) strips `app/api` before the static export
— the route ships on the **Vercel** deploy only, and Pages keeps the in-browser
grounded-stub assistant via the `client.ts` fallback. The handler:

```ts
// app/api/assistant/route.ts  (Vercel runtime only — breaks `output: export`)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { askAssistant } from "@/lib/assistant";
import type { AssistantRequest } from "@/lib/assistant/types";

export const runtime = "nodejs";

// Tiny in-memory limiter (swap for a shared store if you run >1 instance).
const hits = new Map<string, number[]>();
function rateLimited(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

export async function POST(req: Request) {
  // Guardrail 1 — verify the Supabase session token server-side.
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  if (rateLimited(user.id)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { message } = (await req.json()) as AssistantRequest;

  // askAssistant runs intent + the chats-excluded retrieval + generation.
  // To let it read posts / the member directory as this user, pass the
  // RLS-scoped `supabase` client into retrieval (a Phase-1.5 extension of
  // retrieveContext). Chats stay off the allow-list regardless.
  const res = await askAssistant({ message, signedIn: true, userId: user.id });
  return NextResponse.json(res);
}
```

This is wired: `components/AssistantChat.tsx` calls `askAssistantClient`
(`lib/assistant/client.ts`), which POSTs to `/api/assistant` with the Supabase
access token and falls back to the in-browser pipeline when there's no server.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `ASSISTANT_FM_URL` | app server (Vercel) | Foundation Models service URL on the mini. Unset → grounded stub. |
| `ASSISTANT_FM_TOKEN` | app server (Vercel) | Sent as `X-FM-Token`; must match the mini's `FM_SHARED_SECRET`. |
| `ASSISTANT_MODEL_MAX_RECORDS` | app server | Max context records sent to the model (default `8`; raise once PCC is enabled). |
| `ASSISTANT_MODEL_MAX_RECORD_CHARS` | app server | Per-record char cap (default `200`; raise once PCC is enabled). |
| `FM_HOST` / `FM_PORT` | mini | Bind address for the Swift service (default `127.0.0.1:8788`). |
| `FM_SHARED_SECRET` | mini | Require a matching `X-FM-Token` on every request. |
| `FM_USE_PCC` | mini | `0` → on-device only; otherwise prefer Private Cloud Compute (default). |
| `FM_PCC_MAX_TOKENS` / `FM_MAX_TOKENS` / `FM_PCC_REASONING` | mini | PCC/on-device token caps + PCC reasoning effort. See the service README. |

## Files

- `lib/assistant/types.ts` — shared types + the two-guarantee contract.
- `lib/assistant/intent.ts` — `classifyIntent`, `resolveDay` (pure).
- `lib/assistant/retrieval.ts` — the **allow-list** (chats excluded), static data.
- `lib/assistant/generate.ts` — the swappable model seam + system prompt + stub.
- `lib/assistant/index.ts` — `askAssistant` orchestrator (sign-in gate, caps).
- `components/AssistantButton.tsx` — floating entry point; shows only for beta testers who opted in.
- `components/AssistantToggle.tsx` — Profile → Beta features on/off switch (beta-only).
- `lib/assistantToggle.ts` — per-device enabled flag + `useAssistantEnabled()` (default off).
- `components/AssistantChat.tsx` — the chat panel (mic/TTS/states), on `Sheet`.
- `media-server/fm-service/` — the Phase-2 Swift Foundation Models service.
