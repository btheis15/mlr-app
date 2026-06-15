# Enabling Private Cloud Compute for the fm-service

A ready-to-go checklist for switching the assistant (and, later, the moderation
endpoints) from the small on-device model to Apple's far more capable **Private
Cloud Compute** model. Everything here is staged; the code already prefers PCC
and probes for it at startup (see `README.md` + `Sources/fm-service/main.swift`),
so this is purely *unblocking*, not rebuilding.

## Where things stand (re-confirmed 2026-06-15, macOS 27.0 build 26A5353q)

- The service runs **on-device**. PCC generation is blocked.
- This is **not just a third-party-entitlement problem**: Apple's own signed
  `fm` CLI also returns *"PCC inference is not available in this context"*
  (`fm respond --model pcc`). When even Apple's entitled binary can't reach PCC,
  the gate is the **OS beta seed**, not our signing.
- Two independent gates must BOTH open:
  1. **Account/signing gate** — the third-party path (`ModelManagerError 1046`)
     wants a real Developer identity + (for adapters) an approved entitlement.
  2. **OS-rollout gate** — PCC inference simply isn't switched on in this beta.
     Apple has said production PCC ships **with the iOS/macOS 27 GA release
     ("this fall")**; it may light up in a later beta seed first.

So: complete the account-side steps below now (paid membership is pending), run
`build-sign-restart.sh` once it's active, and then it's a `pcc-probe.sh` after
each OS update until PCC answers. No further code work is expected.

## Checklist

### A. Account side (do as soon as the paid membership activates)
- [ ] Confirm the **Apple Developer Program** membership is active
      (developer.apple.com/account — no "enrollment pending" banner).
- [ ] Enroll in the **App Store Small Business Program** — this is what makes
      Foundation Models on PCC **free** for apps under **2M first-time
      downloads** (MLR qualifies easily).
- [ ] *(Only if we ever ship a custom adapter — not needed for base PCC)* submit
      the request for the **Foundation Models adapter entitlement**:
      developer.apple.com/contact/request/foundation-models-framework-adapter-entitlement
      Once approved, uncomment `com.apple.developer.foundation-model-adapter`
      in `fm-service.entitlements`.

### B. Signing the service (on the mini, once the account is active)
- [ ] In **Xcode → Settings → Accounts**, sign in with the paid account so a
      real **Apple Development** cert is issued (replaces the current
      Personal-Team cert). Confirm with `security find-identity -v -p codesigning`.
- [ ] Run **`./scripts/build-sign-restart.sh`** — builds (with the CLT dyld
      workaround), code-signs the binary with that identity + the entitlements,
      and restarts the `com.mlr.fm-service` LaunchAgent.
      Override the identity if needed: `FM_SIGN_IDENTITY="Apple Development: … (TEAMID)"`.

### C. Verify
- [ ] Run **`./scripts/pcc-probe.sh`**.
      - `fm respond --model pcc` prints `ok`  → PCC inference is live OS-side.
      - the service reports `"model":"private-cloud-compute"` → the assistant is
        on PCC. (`{"model":"on-device"}` means it's still falling back.)
- [ ] Once PCC answers, optionally widen the context the app sends — raise
      `ASSISTANT_MODEL_MAX_RECORDS` / `ASSISTANT_MODEL_MAX_RECORD_CHARS` on Vercel
      (the PCC model has a ~32K-token window vs. the on-device model's ~4K). See
      `lib/assistant/generate.ts`.

### D. Re-test cadence until then
- [ ] After each macOS update: `./scripts/pcc-probe.sh`. Nothing else to change —
      the startup probe flips the service to PCC automatically the first time it
      succeeds.

## Files
- `fm-service.entitlements` — the entitlements (adapter key staged, commented).
- `scripts/build-sign-restart.sh` — build + sign + restart, one step.
- `scripts/pcc-probe.sh` — re-test PCC reachability (fm CLI + the live service).
- `README.md` — service contract, model selection, the `swift-build` workaround.
