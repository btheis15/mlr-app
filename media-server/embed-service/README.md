# embed-service

On-device text embeddings for MLR's **semantic conversation search**. A tiny
Swift/Vapor HTTP service that runs on the Mac mini and turns text into 512-d
vectors using Apple's **NaturalLanguage** framework (`NLContextualEmbedding`) —
fully on-device, private, no network, no quota, no per-request cost.

It only turns strings into numbers. It never touches the database and never sees
who is searching — the RLS-scoped retrieval happens in Postgres (the
`search_conversations` RPC, migration `0129`). See the repo `CLAUDE.md` →
"Conversation search" for the whole picture.

## Why a separate service (not part of `fm-service`)

- Apple's **Foundation Models** LLM (what `fm serve` exposes) has **no
  embeddings endpoint** — it only generates text. `NLContextualEmbedding` is the
  correct on-device embedding tool, and it's a **different framework**.
- On this macOS 27 beta, FoundationModels **generation SIGTRAPs**. By importing
  *only* NaturalLanguage (no FoundationModels), this service is immune — search
  can't be taken down by that bug, and this can't disturb `fm-service` / the PCC
  enablement work.

## API

- `GET /health` → `{ ok, model, dim }` (no auth).
- `POST /embed` `{ "texts": ["…", …] }` (or `{ "text": "…" }`) →
  `{ model, dim, vectors: [[Float], …] }`.
  - Vectors are **mean-pooled over token vectors, then L2-normalized** (so cosine
    == dot product), length = `dim` (512). Long inputs are chunked on sentence
    boundaries and averaged (the model truncates at 256 tokens).
  - An un-embeddable input (empty / all punctuation) comes back as an **empty
    array** in that slot — callers skip it (never store a zero vector).
  - `401` when `EMBED_SHARED_SECRET` is set and `X-EMBED-TOKEN` doesn't match.

## Config (env, via the LaunchAgent + `media-server/.env`)

| var | default | notes |
|---|---|---|
| `EMBED_HOST` | `127.0.0.1` | loopback only — media-server is the sole caller |
| `EMBED_PORT` | `8786` | (8787 Innjoy, 8788 fm-service, 8790 media-server, 8799 fm serve) |
| `EMBED_SHARED_SECRET` | — | shared with media-server's `.env`; gates `/embed` |

## Build & deploy (on the mini)

```bash
cd media-server/embed-service
./scripts/build-restart.sh          # swift build -c release + launchctl kickstart
```

First-time LaunchAgent install:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mlr.embed-service.plist
```

No code-signing / entitlements needed (NaturalLanguage requires none — unlike
`fm-service`, which signs only to gate PCC). Logs:
`~/Library/Logs/mlr-embed-service.{log,err.log}`. Health check:

```bash
curl -s localhost:8786/health
```
