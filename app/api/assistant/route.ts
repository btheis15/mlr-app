// app/api/assistant/route.ts — Vercel runtime only.
//
// The server broker for "Ask MLR": it validates the Supabase session token,
// rate-limits per user, then runs the same `askAssistant` pipeline (intent +
// chats-excluded retrieval + generation). Generation delegates to the Mac mini's
// Foundation Models service when ASSISTANT_FM_URL is set (see lib/assistant/
// generate.ts), falling back to the grounded stub otherwise.
//
// This route is EXCLUDED from the GitHub Pages static export — `output: export`
// can't host a POST handler — by the "Drop server routes" step in
// .github/workflows/pages.yml. The Pages site keeps the in-browser assistant via
// the lib/assistant/client.ts fallback.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { streamAssistant } from "@/lib/assistant";
import type { AssistantRequest } from "@/lib/assistant/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tiny in-memory limiter (swap for a shared store if you ever run >1 instance).
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  // Beta-only while the assistant is being trialed. The UI hides the button for
  // non-beta members; this enforces it server-side too. is_beta_tester() checks
  // the caller's profiles.beta_tester (migration 0029) via auth.uid().
  const { data: isBeta } = await supabase.rpc("is_beta_tester");
  if (!isBeta) return NextResponse.json({ error: "beta_only" }, { status: 403 });

  if (rateLimited(user.id)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { message } = (await req.json()) as AssistantRequest;
  const { intent, sources, stream } = await streamAssistant({ message, signedIn: true, userId: user.id });

  // Stream Server-Sent Events: sources up front, then answer deltas as the
  // on-device model generates them, then `done`. streamAssistant owns its own
  // grounded-stub fallback, so this always yields a usable answer.
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        send(`event: sources\ndata: ${JSON.stringify({ sources, intent })}\n\n`);
        for await (const delta of stream) {
          send(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        send(`event: done\ndata: {}\n\n`);
      } catch {
        send(`event: error\ndata: {}\n\n`);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
