# Sensitive content — Mac mini follow-ups

A take-on-later checklist for the parts of the content-moderation plan that
**cannot be done from a cloud session / this repo** and have to happen on the
Mac mini (or in your Apple / Supabase accounts). The app-side work (Tiers 0+1)
is already shipped — see [`content-moderation.md`](content-moderation.md) for the
full architecture. This file is just "what's left, and where to do it."

> **Why these can't be done remotely:** the moderation brain is Apple's
> `SensitiveContentAnalysis` + `FoundationModels`, which **only run on Apple
> hardware** (macOS, Apple Silicon, Apple Intelligence on). A Linux CI/cloud box
> can't compile Swift against those frameworks, can't run the models, and can't
> flip the OS settings they require. So this is hands-on-the-mini work.

---

## Already done (no mini needed) ✅

- Magic-byte upload guard, text length caps, admin blocklist, member reporting,
  status model + RLS, admin review queue, audit trail.
- Migration [`0040_content_moderation.sql`](../supabase/migrations/0040_content_moderation.sql)
  is written. **(Action: run it once in the Supabase SQL editor** — or ask me to
  apply it via the Supabase tools. Until it runs, the admin "Content review"
  panel shows a "run the migration" hint.)

---

## What only the Mac mini / your accounts can do

### 1. Turn on the Apple model stack
- [ ] On the mini, **System Settings → Apple Intelligence & Siri → on**, and make
      sure the on-device model has finished downloading.
- [ ] **System Settings → Screen Time → Communication Safety / Sensitive Content
      Warning → on.** `SCSensitivityAnalyzer` returns "not available" / refuses to
      analyze unless this is enabled — there's no API to force it.
- [ ] Confirm the mini runs a macOS version with the framework (Tahoe / 26+; the
      Golden Gate / 27 line adds the PCC + image-input wins below).

### 2. Check whether PCC is now reachable (big change as of WWDC 2026)
The original blocker — third-party PCC inference being entitlement-gated
(`ModelManagerError 1046`) — looks **lifted** by Apple's WWDC 2026 program:
**free Foundation Models on Private Cloud Compute for developers under 2M
first-time downloads** (MLR qualifies easily). Verify once on 27 betas:
- [ ] Confirm the app/service can call the **PCC-backed** Foundation Models model
      (far larger, ~32K context) and not just on-device. Re-run the probe in
      [`fm-service`](../media-server/fm-service/); update its README findings.
- [ ] Note: PCC needs network (a round-trip). Keep the on-device model as the
      offline fallback; keep the Postgres blocklist + human queue as the floor.

### 3. Build & run the moderation endpoints (Swift, mini-only)
Extend [`media-server/fm-service`](../media-server/fm-service/) — the code can be
drafted in the repo, but it can only be **compiled, run, and tested on the mini**:
- [ ] `POST /moderate/image { path }` → run `SCSensitivityAnalyzer` on the file;
      return `{ sensitive: bool }`. On 27, optionally also pass the image to
      Foundation Models (now **accepts image input**) to classify beyond nudity
      (violence / weapons / drugs / text-in-image).
- [ ] `POST /moderate/text { text }` → Foundation Models classification →
      `{ categories: [...], severity }`. (Apple's `NaturalLanguage` only does
      sentiment, so the LLM is the real path.)
- [ ] `swift build` needs the `DYLD_FALLBACK_FRAMEWORK_PATH` workaround noted in
      the fm-service README on current CLT betas.
- [ ] Run it under the existing LaunchAgent (GUI session, not a headless daemon —
      the models need a logged-in session), with `FM_SHARED_SECRET` set.

### 4. Wire video frame-sampling
- [ ] In [`media-server/transcode.js`](../media-server/transcode.js) (already runs
      `ffmpeg` per upload), extract keyframes every N seconds and run each through
      `/moderate/image`. SCA video analysis is frame-sampled either way; doing it
      via ffmpeg keeps cost/density under your control.

### 5. Enforce at the upload door + the text checkpoint
- [ ] In [`media-server/server.js`](../media-server/server.js) `/upload`: after the
      magic-byte guard, call `/moderate/image` (image) or the frame loop (video)
      **before** returning the URL; on a positive, signal the app to file the post
      as `pending` (held for review) rather than `visible`.
- [ ] Text goes client→Supabase directly, so to enforce the FM verdict add a
      **server checkpoint**: a Supabase Edge Function / RPC (or `pg_net` trigger)
      that calls the mini's `/moderate/text` before a held post flips back to
      `visible`. (The Tier-0 blocklist trigger needs none of this — it's the floor.)

### 6. Env / ops on the mini
- [ ] Set `FM_SHARED_SECRET` (app server ↔ fm-service) and any
      `ASSISTANT_FM_URL` / moderation URL the checkpoint calls.
- [ ] Make sure the fm-service is in the LaunchAgent set so it survives reboots,
      alongside uploads / push-sender / mailer.

---

## Honest limits to keep in mind
- **No third-party CSAM API exists.** None of the above detects CSAM by hash;
  Apple exposes nothing for it. Mitigation stays: nudity gate + private
  membership + report/remove + human review. Don't represent this as CSAM-safe.
- On-device/PCC models have false positives and misses — the **human review
  queue is the backstop**, not the model.

## References
- [`content-moderation.md`](content-moderation.md) — full layered architecture.
- [`../media-server/fm-service/README.md`](../media-server/fm-service/README.md) —
  the FM service, PCC findings, the `swift build` workaround.
- [`../supabase/migrations/0040_content_moderation.sql`](../supabase/migrations/0040_content_moderation.sql).
