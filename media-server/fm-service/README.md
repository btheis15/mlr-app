# MLR Assistant — Foundation Models service (scaffold)

The on-device AI that answers "Ask MLR" questions. It runs **on the Mac mini**
because Apple's Foundation Models framework only runs on Apple Silicon — it can't
run on Vercel. The app does everything else (auth, intent, retrieval, the
allow-list); this service only turns the supplied system prompt + selected
context into a short answer.

> **Status: scaffold.** This is the Phase-2 piece. Today the app answers with a
> deterministic grounded fallback (`lib/assistant/generate.ts`), so the feature
> works with this service **off**. Point the app at it by setting
> `ASSISTANT_FM_URL` once it's running.

## Requirements

- **macOS 26 (Tahoe) or later** on Apple Silicon (the M1 mini qualifies).
- **Apple Intelligence enabled** in System Settings, signed into a user session.
  Foundation Models reports *unavailable* if Apple Intelligence is off, the
  device is ineligible, or the model hasn't finished downloading — the service
  returns `503 model_unavailable` in that case.
- **Xcode 26 / Swift 6** to build.
- **Headless note:** the model is only available inside a logged-in GUI session.
  Run this as a LaunchAgent for the logged-in user (not a system LaunchDaemon),
  or keep a user session active on the mini.

## Build & run

```bash
cd media-server/fm-service
swift build -c release
FM_HOST=127.0.0.1 FM_PORT=8788 .build/release/fm-service
```

Smoke test:

```bash
curl -s localhost:8788/assistant -H 'content-type: application/json' \
  -d '{"system":"Answer only from context.","question":"Who leads the bonfire?","context":"[schedule:welcome-bonfire] Welcome bonfire lead: Baron Aldric of House Thornwood."}'
# → {"answer":"..."}
```

## Wire it to the app

Set `ASSISTANT_FM_URL` (server-side) to this service's URL, reached over the
same private tunnel the media server uses (Tailscale Funnel / named Cloudflare
Tunnel) or loopback if co-located. Keep it **private** — bind to `127.0.0.1` and
front it with the tunnel, never a public bind. The app falls back to the
grounded stub automatically if the call fails or times out.

## Swap providers

The contract (`POST /assistant {system, question, context} → {answer}`) is
provider-agnostic. To use Ollama or a cloud API instead, expose the same shape
and point `ASSISTANT_FM_URL` at it — no app changes.
