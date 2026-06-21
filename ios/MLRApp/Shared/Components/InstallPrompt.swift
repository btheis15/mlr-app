import SwiftUI

// MARK: - InstallPrompt
//
// This component is web-only.
//
// On the web (PWA), `InstallHint` / `InstallButton` guide the user through
// "Add to Home Screen" on iOS Safari and the native `beforeinstallprompt`
// on Android/Chrome — because a web app isn't pre-installed.
//
// On native iOS, the user already has the app installed by definition —
// there is nothing to prompt. This file is intentionally a no-op placeholder
// so import references or cross-platform references compile cleanly.
//
// If you add an "Share / Add to Home Screen" nudge for the *web companion*
// from within the native app (e.g. a deep-link or QR code to the PWA),
// implement it here.

// No types exported. File intentionally empty of runtime code.
