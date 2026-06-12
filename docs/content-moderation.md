# Content moderation — keeping the feed safe

Safeguards for the social surfaces (the **Posts** feed: posts, captions,
comments, and uploaded photos/videos) so sensitive, inappropriate, or illegal
content doesn't sit in front of the family. Built in **layers**, because no
single check is sufficient — a small on-device model has both false positives
and misses, so the dependable backbone is human review, with automated filters
catching the worst stuff up front.

The model: posts stay **post-moderated** (they still go live instantly — the
family "just post it" feel), but anything a filter trips is **held for an admin
to review** rather than left up. "Held" means hidden from everyone except its
author and admins; nothing is destroyed, and an admin can approve or remove it.

---

## What ships today (Tiers 0 + 1)

These are live in this repo and need no Mac mini — Tier 1 works even if the mini
is down.

### Tier 0 — deterministic guards (no AI)

| Guard | Where | Behavior |
|---|---|---|
| **File type** — must really be an image/video | `media-server/server.js` (`sniffMediaKind`) | Sniffs magic bytes (not the spoofable client MIME); a PDF/zip/script/disguised binary is **rejected (415) and deleted** before it's served or referenced. |
| **File size** | client `lib/moderation.ts` + the mini's `MAX_MB` | Over-cap files are refused. |
| **Text length** | `posts`/`post_comments` trigger (0040) + `lib/moderation.ts` | Posts ≤ 5000 chars, comments ≤ 2000 — hard-rejected server-side. |
| **Blocked words ("language" floor)** | `moderate_content_text` trigger (0040) | A caption/comment containing an admin-listed term is **auto-held** for review. Runs entirely in Postgres — no mini, no latency. Ships **empty**; admins add terms in Profile → Admin → Content review. |

### Tier 1 — human moderation (the real safety net)

- **Report** — any member can flag a post or comment (`ReportButton` →
  `report_content` RPC). Reports dedupe per member.
- **Auto-hold on reports** — once **2 distinct members** report an item it's
  held automatically (`apply_content_report` trigger).
- **Status model** — `posts.status` / `post_comments.status` ∈
  `visible | pending | hidden`. RLS only returns non-`visible` rows to the
  author and admins, so held/removed content drops out of the public feed.
  Members **cannot** change their own item's status (a `BEFORE UPDATE` guard
  pins it), so editing can't un-hide a held post.
- **Admin review queue** — `AdminModeration` (Profile → Admin → Content review)
  lists everything held or reported, with **Approve** / **Remove**
  (`set_content_status`). Every automated and manual action is written to
  `content_moderation_events` (audit trail).

Data model: migration
[`0040_content_moderation.sql`](../supabase/migrations/0040_content_moderation.sql).

---

## Tier 2 — on-device Apple checks on the Mac mini (planned)

The smarter, content-aware layer. **All on-device / private** — nothing leaves
the mini. This is a spec, not yet wired; the swap point is the existing
`media-server/fm-service` Swift service (it already keeps Apple's
`SensitiveContentAnalysis` assets resident — see `fm-service/Sources/.../main.swift`).

### Why not PCC?

Private Cloud Compute inference is **entitlement-gated and currently
unattainable** for this app (`ModelManagerError 1046`; a free Personal Team
can't get the adapter entitlement). See
[`media-server/fm-service/README.md`](../media-server/fm-service/README.md).
Everything below therefore runs **on-device** on the mini; the probe auto-switches
to PCC only if it ever becomes reachable.

### Images & videos — nudity (`SensitiveContentAnalysis`)

Apple's `SCSensitivityAnalyzer` (macOS 14+) is the on-device classifier behind
Communication Safety. It flags **nudity** in both stills and video, fully
locally.

- **Images:** analyze the saved file at upload; if sensitive, hold it for review
  (don't return it to the feed as `visible`).
- **Videos:** SCA has a video-analysis path, but it's frame-sampled. Since the
  mini already runs `ffmpeg` on every upload (`transcode.js`), the efficient fit
  is to **extract keyframes (every N seconds) and run image analysis on each** —
  cheaper and more controllable than handing it a long clip. Caveats to accept:
  it's sampled (a brief frame can slip through) and it only detects **nudity**,
  not violence/weapons/drugs. So video auto-filtering is the weakest layer — the
  **report → hold → review** backbone remains the dependable path for video.
- **Spoken audio (optional):** Apple's on-device `Speech` (`SFSpeechRecognizer`)
  can transcribe a clip locally; feed that transcript through the text classifier
  below.

> Note: SCA only runs when the mini has "Sensitive Content Warning" enabled in
> System Settings — fine on a dedicated device you control.

### Text — language (`FoundationModels`)

The on-device LLM (already scaffolded for "Ask MLR") can grade a caption/comment
into categories (profanity / hate / sexual / threats / self-harm / illegal) +
severity, catching what a static blocklist misses (context, leetspeak, sarcasm).
It also has built-in guardrails that refuse some content outright. Apple's
`NaturalLanguage` framework only does **sentiment**, not toxicity — so the LLM is
the real "understands the language" path; the blocklist trigger is the always-on
floor beneath it.

### Wiring sketch

- **Images/video** flow through the mini's `/upload`, so moderation runs
  **synchronously there** — extend the handler to call a local
  `POST /moderate/image` (SCA), and on a positive, return a soft signal the app
  records as `pending` (or refuse outright if you ever choose hard-block).
- **Text** goes client→Supabase directly (never through the mini), so enforcing
  the FM verdict needs a **server checkpoint**: a Supabase Edge Function / RPC
  that calls the mini's `/moderate/text` before flipping a held post back to
  `visible`, or a `pg_net` trigger. The Tier-0 blocklist trigger needs none of
  this, which is why it's the floor.

### Honest gaps

- **No CSAM API for third parties.** Apple shelved its CSAM program and exposes
  nothing to call; real CSAM detection needs PhotoDNA/NCMEC hash-matching, which
  is impractical here. Mitigation = the nudity gate + private membership +
  report/remove + hold-for-review, not an Apple API.
- On-device models are imperfect; **keep the human queue** as the backstop.
