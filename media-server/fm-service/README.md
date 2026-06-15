# MLR Assistant — Foundation Models service

The Apple Intelligence service that answers "Ask MLR" questions. It runs **on the
Mac mini** because Apple's Foundation Models framework only runs on Apple devices
— it can't run on Vercel. The app does everything else (auth, intent, retrieval,
the allow-list); this service only turns the supplied system prompt + selected
context into a short answer.

> The app still works with this service **off** — it falls back to a deterministic
> grounded answer (`lib/assistant/generate.ts`). Point the app at this service by
> setting `ASSISTANT_FM_URL`.

## Models (macOS 27)

The service uses two first-party models — it improves answers when it can and
never hard-fails when it can't. At startup it **probes** whether PCC actually
works (a real tiny generation, because availability ≠ usability — see the warning
below) and routes to it only if so; otherwise it stays fully on-device. It also
falls back to on-device per request if a PCC call fails:

1. **Private Cloud Compute** (`PrivateCloudComputeLanguageModel`, new in macOS/iOS
   27) — the default. A much more capable model run in Apple's Private Cloud
   Compute (privacy-preserving: requests are processed statelessly and not
   retained), with a large (~32K-token) context window. This is what makes the
   answers noticeably better than the on-device model.
2. **On-device** (`SystemLanguageModel`) — the small Apple-Silicon model, used as
   the automatic fallback when PCC is off, the device is ineligible, the quota is
   reached, or a request fails/times out.

The blocking response includes which model answered (`{ "answer": …, "model":
"private-cloud-compute" | "on-device" }`); the stream reports it on the `done`
event. Set `FM_USE_PCC=0` to force on-device only (keeps every byte on the box).

> **⚠️ PCC inference is entitlement-gated and currently NOT attainable here.**
> A call to the PCC model fails fast with `FoundationModels.LanguageModelError -1`
> → `ModelManagerServices.ModelManagerError 1046`, and the service transparently
> falls back to on-device (`"model":"on-device"`). What we established (macOS 27.0
> beta, June 2026), in case the situation changes:
>
> - PCC reports `available` and exposes metadata (32K context, 23 languages)
>   even unsigned, but **generation** is gated. `modelmanagerd` enforces "an
>   internal entitlement that cannot be added by a 3rd party" for ineligible
>   callers.
> - The only third-party Foundation Models capability Apple exposes is
>   **`com.apple.developer.foundation-model-adapter`** ("Foundation Model
>   Adapter") — and it's **request-only** (submit
>   `developer.apple.com/contact/request/foundation-models-framework-adapter-entitlement`),
>   intended for *custom adapters*, not base PCC access.
> - A legitimate **development signature** (Apple Development cert + Xcode
>   automatic provisioning + `get-task-allow`, a real `.app`) does **not** bypass
>   the gate — still `1046`. (Apple-*internal* dev signatures are exempt; third-party
>   ones aren't.)
> - A **free Personal Team cannot get the capability at all** — Xcode's
>   provisioning service rejects it verbatim: *"Personal development teams … do
>   not support the Foundation Model Adapter capability."*
>
> So enabling PCC requires, at minimum: a **paid Apple Developer Program
> membership**, an **approved request** for the Foundation Models entitlement,
> and signing the service with it — and it's unconfirmed whether even that
> unlocks *base* PCC (vs. only custom adapters). Until then the bot runs
> on-device — fully functional, just less capable. The integration is already
> wired and probes at startup, so if PCC ever becomes reachable it switches over
> with no code change.

## Requirements

- **macOS 27 or later** on Apple Silicon (the M1 mini qualifies). The on-device
  path alone builds on macOS 26, but PCC + the model-selection API are 27+.
- **Apple Intelligence enabled** in System Settings, signed into a user session,
  and (for PCC) signed into an Apple Account. If no model is ready the service
  returns `503 model_unavailable`.
- **Swift 6 toolchain** (Xcode 27 or Command Line Tools) to build.
- **Headless note:** the models are only available inside a logged-in GUI session.
  Run this as a LaunchAgent for the logged-in user (not a system LaunchDaemon),
  or keep a user session active on the mini.

## Build & run

```bash
cd media-server/fm-service
swift build -c release
FM_HOST=127.0.0.1 FM_PORT=8788 .build/release/fm-service
```

> **Build workaround (this Command Line Tools beta).** `swift build` can abort
> with a dyld error — `Library not loaded: @rpath/BuildServerProtocol.framework`
> — because the CLT ships SwiftPM's SwiftBuild frameworks off the tool's rpath.
> Build by invoking `swift-build` directly (the `swift` driver is a restricted
> binary and strips `DYLD_*`, so it must be bypassed) with a fallback path to
> where those frameworks actually live:
>
> ```bash
> PM=/Library/Developer/CommandLineTools/usr/lib/swift/pm
> DYLD_FALLBACK_FRAMEWORK_PATH="$PM:$PM/SwiftBuild.framework/Versions/A/PlugIns/SWBBuildService.bundle/Contents/Frameworks" \
>   /Library/Developer/CommandLineTools/usr/bin/swift-build -c release
> ```
>
> This only affects the *build*; the resulting `fm-service` binary runs normally.
> Installing full Xcode 27, or a CLT update that fixes the rpath, removes the need.

Restart after a rebuild (it runs as a keep-alive LaunchAgent):

```bash
launchctl kickstart -k gui/$(id -u)/com.mlr.fm-service
```

Smoke test (include `X-FM-Token` if `FM_SHARED_SECRET` is set):

```bash
curl -s localhost:8788/assistant -H 'content-type: application/json' \
  -H "x-fm-token: $FM_SHARED_SECRET" \
  -d '{"system":"Answer only from context.","question":"Who leads the bonfire?","context":"[schedule:welcome-bonfire] Welcome bonfire lead: Baron Aldric of House Thornwood."}'
# → {"answer":"...","model":"private-cloud-compute"}
```

## Environment

| Var | Default | Purpose |
|---|---|---|
| `FM_HOST` / `FM_PORT` | `127.0.0.1` / `8788` | Bind address. |
| `FM_SHARED_SECRET` | _(unset)_ | When set, every request must send a matching `X-FM-Token` header. |
| `FM_USE_PCC` | `1` | `0`/`false`/`no`/`off` → on-device only (no Private Cloud Compute). |
| `FM_PCC_MAX_TOKENS` | `700` | Max response tokens on the PCC model. |
| `FM_MAX_TOKENS` | `256` | Max response tokens on the on-device model. |
| `FM_PCC_REASONING` | `light` | PCC reasoning effort: `light` \| `moderate` \| `deep`. |

## Concurrency

Requests run **in parallel**. The service creates a fresh `LanguageModelSession`
per request, so concurrent calls don't collide — a *single* session rejects
overlapping calls with `.concurrentRequests`, which is why a session is never
shared. On macOS 27 the on-device model overlaps generations (measured: 3
distinct requests finished in ≈1× single-request wall-clock, vs ≈3× if it
serialized — earlier OSes were effectively sequential). The PCC model, being
server-side, parallelizes too, bounded by its quota. There's no artificial
serialization in this service; if you ever need to cap simultaneous on-device
generations to protect memory, add a small semaphore around the `respond` call.

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
