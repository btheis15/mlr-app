// Install-to-home-screen trigger — the bridge between any "Add to Home Screen"
// button (Profile, Help, Home) and the single install authority, `InstallHint`.
//
// We don't decide *how* to install here; the button just asks. `InstallHint`
// owns the platform logic: on Android / desktop Chrome it fires the captured
// native `beforeinstallprompt`; on iOS (which has no such event) it opens the
// step-by-step Safari walkthrough. Keeping that knowledge in one place means a
// button is a one-liner and can't drift out of sync with the detection.

/** Event `InstallHint` listens for to start the install flow on demand. */
export const INSTALL_EVENT = "mlr:request-install";

/** Ask to install the app. Safe to call anywhere on the client. */
export function requestInstall(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INSTALL_EVENT));
  }
}
