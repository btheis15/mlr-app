# Finishing the "Ask MLR" Assistant — Setup Runbook

This is an **executable runbook** for finishing the AI assistant. It's written so
**Claude Code running on the Mac mini** can work through it. Phase 1 is already
merged and live; this covers **Phase 1.5** (server route on Vercel) and **Phase 2**
(Apple Foundation Models on the mini), plus config and verification.

## How to read this file

Every step is tagged:

- 🤖 **Claude Code does it** — write/edit files, run builds, run the Swift service, curl tests.
- 🧍 **Brian does it** — anything in a browser, System Settings, the Vercel/GitHub dashboards, or that needs an Apple ID / a logged-in GUI session.

Do the steps **in order**. Stop and tell Brian if a 🧍 step is blocking. Don't
regress the guardrails in the last section.

---

## 0. What already exists (context)

Phase 1 is merged to `main` (PR #140). Already in the repo:

- `lib/assistant/` — `index.ts` (`askAssistant` orchestrator: sign-in gate, 500-char cap), `intent.ts` (classify + date resolve), `retrieval.ts` (the **allow-list** over static `lib/data.ts`; **chats are never included**), `generate.ts` (the swappable `generateAssistantAnswer()` seam + system prompt).
- `components/AssistantButton.tsx` (floating ✨ button, sign-in gated) + `components/AssistantChat.tsx` (the chat panel: mic, read-aloud, states).
- `media-server/fm-service/` — the **Swift Foundation Models service scaffold** (this is what Phase 2 stands up).
- `docs/ai-assistant.md` — architecture reference.

**Today's behavior:** with no model wired, the bot answers via a deterministic
*grounded stub* — it stitches the retrieved records into an answer (accurate, never
invents). Phases below replace that with Apple's on-device model and move the call
server-side.

**Two guarantees that must never regress:** (1) signed-in only; (2) the bot never
reads chats (resort or committee) — posts are the only sanctioned social source.

---

## Phase 2 — Apple Foundation Models service on the Mac mini

Apple's on-device model only runs on Apple Silicon, so this lives on the mini.

### 2.1 — Confirm the platform 🧍🤖

🤖 Run and report:

```bash
sw_vers                 # ProductVersion must be 26.x (macOS Tahoe) or later
swift --version         # need Swift 6 (Xcode 26 toolchain)
uname -m                # arm64 (Apple Silicon — the M1 mini is fine)
```

🧍 Brian must confirm, because these can't be fully checked from the CLI:

- **macOS 26 (Tahoe) or later** is installed. If `sw_vers` shows 25 or lower → upgrade macOS first (System Settings → General → Software Update). **Blocker until done.**
- **Apple Intelligence is ON**: System Settings → Apple Intelligence & Siri → enable, and wait for the on-device model to finish downloading.
- The mini is **logged into a user GUI session** (not just SSH). The model is only available inside a logged-in session.
- **Xcode 26** (or its command-line tools) is installed: `xcode-select -p` should point at an Xcode 26 install. If not: install Xcode 26 from the App Store, then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

### 2.2 — Build the service 🤖

```bash
cd <repo>/media-server/fm-service
swift build -c release
```

Expected: a binary at `.build/release/fm-service`.

Troubleshooting:
- `no such module 'FoundationModels'` → the SDK is older than macOS 26 / Xcode 26. Revisit 2.1.
- Vapor fails to resolve → check network; rerun `swift package resolve`.

### 2.3 — Run and smoke-test 🤖

```bash
FM_HOST=127.0.0.1 FM_PORT=8788 .build/release/fm-service &
sleep 2
curl -s localhost:8788/assistant -H 'content-type: application/json' -d '{
  "system":"Answer only from the context. Be brief.",
  "question":"Who is leading the welcome bonfire?",
  "context":"[schedule:welcome-bonfire] Welcome bonfire lead: Baron Aldric of House Thornwood is leading the Welcome bonfire on Sun, Jul 27 at 7:30 PM (Lakeside fire pit)."
}'
```

- ✅ `{"answer":"..."}` with a sentence naming Baron Aldric → working.
- ⚠️ `503` / `model_unavailable` → Apple Intelligence isn't enabled or the model
  hasn't downloaded. Back to 2.1 (🧍).

Stop the test instance (`kill %1`) before 2.4.

### 2.4 — Keep it running (LaunchAgent) 🤖 + 🧍

Must be a **LaunchAgent** (runs in Brian's login session), **not** a system
LaunchDaemon — the model is unavailable to daemons. 🤖 write
`~/Library/LaunchAgents/com.mlr.fm-service.plist` (replace `<ABSOLUTE_REPO_PATH>`
and `<USERNAME>`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mlr.fm-service</string>
  <key>ProgramArguments</key>
  <array>
    <string><ABSOLUTE_REPO_PATH>/media-server/fm-service/.build/release/fm-service</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FM_HOST</key><string>127.0.0.1</string>
    <key>FM_PORT</key><string>8788</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/<USERNAME>/Library/Logs/mlr-fm-service.log</string>
  <key>StandardErrorPath</key><string>/Users/<USERNAME>/Library/Logs/mlr-fm-service.err.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl unload ~/Library/LaunchAgents/com.mlr.fm-service.plist 2>/dev/null || true
launchctl load  ~/Library/LaunchAgents/com.mlr.fm-service.plist
sleep 2 && curl -s localhost:8788/assistant -H 'content-type: application/json' \
  -d '{"system":"Be brief.","question":"ping","context":"[resort:resort] Muskellunge Lake Resort."}'
```

🧍 Note: the service only answers while Brian is logged in on the mini. If the mini
reboots to the login window and no one logs in, the model is unavailable.

### 2.5 — Expose it privately 🧍 + 🤖

The browser must **not** call the mini directly — the Vercel route (Phase 1.5) is
the broker. Keep the service bound to `127.0.0.1` and reach it from Vercel over the
**same tunnel the media server already uses** (Tailscale Funnel or a named Cloudflare
Tunnel). 🧍 Brian: add a route/hostname that maps a stable HTTPS URL → `127.0.0.1:8788`
(e.g. `https://mlr-fm.<your-tunnel-domain>/assistant`). 🤖 Record that full URL — it
becomes `ASSISTANT_FM_URL` in Phase 1.5.

> If Vercel can't reach the mini's tunnel, the Vercel route automatically falls back
> to the grounded stub (see `generate.ts`) — the chat never errors out.

---

## Phase 1.5 — Server route on Vercel (token auth + the model call)

This moves the model call server-side, validates the Supabase session, and is where
posts/member-directory reads can be added later. **It only ships on Vercel** — a POST
route handler can't exist in the GitHub Pages `output: export` build, so step 1.5.4
keeps Pages green.

### 1.5.1 — Add the route 🤖

Create `app/api/assistant/route.ts` (this is the wrapper documented in
`docs/ai-assistant.md`):

```ts
// app/api/assistant/route.ts — Vercel runtime only (excluded from the Pages export; see 1.5.4)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { askAssistant } from "@/lib/assistant";
import type { AssistantRequest } from "@/lib/assistant/types";

export const runtime = "nodejs";

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
  const res = await askAssistant({ message, signedIn: true, userId: user.id });
  return NextResponse.json(res);
}
```

`askAssistant` calls `generateAssistantAnswer`, which reads `ASSISTANT_FM_URL` and
POSTs to the mini's FM service (falling back to the grounded stub on any failure).

### 1.5.2 — Make the chat use the route, fall back to local 🤖

So both deploys work: on Vercel the panel calls the server route; on Pages (no
server) it falls back to the existing in-browser `askAssistant`. Create
`lib/assistant/client.ts`:

```ts
import { supabase } from "@/lib/supabase";
import { askAssistant } from "@/lib/assistant";
import type { AssistantResponse } from "@/lib/assistant/types";

/** Prefer the server route (token-auth + model on the mini). Fall back to the
 *  in-browser pipeline when there's no server (static Pages build) or the route
 *  is unreachable. The sign-in gate + chats-excluded retrieval hold on both paths. */
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
      // 404 (static build, no route) or other → fall through to local.
    }
  } catch {
    /* network/no-backend → local */
  }
  return askAssistant(opts);
}
```

Then in `components/AssistantChat.tsx`, swap the import/call from `askAssistant`
to `askAssistantClient` (same arguments). Run `npm run typecheck`.

### 1.5.3 — Set environment variables 🧍

In the **Vercel** project (Settings → Environment Variables, Production + Preview):

| Var | Value |
|---|---|
| `ASSISTANT_FM_URL` | the tunnel URL from step 2.5, e.g. `https://mlr-fm.<tunnel>/assistant` |

(`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are already
set for the app.) Redeploy after adding it.

### 1.5.4 — Keep the GitHub Pages build green 🤖

The Pages export can't compile a POST route. Edit `.github/workflows/pages.yml`:
add a step **before** "Build static export" that strips the API route from the
export build only:

```yaml
      - name: Drop server routes from the static export
        run: rm -rf app/api
      - name: Build static export
        env:
          PAGES_BASE_PATH: /mlr-app
          # ...existing env...
        run: npm run build
```

(The Pages site keeps the in-browser grounded-stub assistant via the 1.5.2
fallback; the real model lives on the Vercel deploy.)

### 1.5.5 — (Optional) Let the bot read posts / member contacts as the user 🤖

Only after the above works, and only if wanted. In `lib/assistant/retrieval.ts`,
extend `retrieveContext` to accept the RLS-scoped `supabase` client passed from the
route and, for `contact_lookup`, read the **member directory** (profiles), and add a
`post` source for post questions. **Keep chats off the allow-list** — never query
`committee_messages` or the chat store. Gate everything on the verified session.

---

## Verification (run after each phase) 🤖

```bash
npm run typecheck                          # clean
npm run build                              # Vercel build passes
PAGES_BASE_PATH=/mlr-app npm run build     # static export passes (after 1.5.4)
```

End-to-end (after deploy): sign in on the Vercel preview, open ✨, ask "who's in
charge of the bonfire?" and confirm a natural-language answer with source chips. Tail
the mini log to confirm the FM service was hit:

```bash
tail -f ~/Library/Logs/mlr-fm-service.log
```

---

## Guardrails — do not regress

- **Signed-in only.** The button gates on sign-in; `askAssistant` refuses guests; the route returns 401 without a valid token. All three must stay.
- **Chats are never a data source.** No retrieval path reads resort/committee chat. Posts are the only sanctioned social source.
- **Bounded + safe.** Keep the 500-char input cap, the ≤12-record context cap, the FM timeout, and the grounded-stub fallback. Never let the model see more than the allow-listed records.

## Rollback

Unset `ASSISTANT_FM_URL` in Vercel and redeploy → the assistant instantly reverts to
the grounded stub. Nothing else changes.

---

## Commit & PR

When a phase's changes are made and all three builds pass, commit on a feature
branch and open a **draft PR** (don't push to `main` directly). Keep `CLAUDE.md`,
`README.md`, and `docs/ai-assistant.md` updated in the same commit if behavior
changes.
