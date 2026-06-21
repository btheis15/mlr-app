import Foundation
import Supabase

// MARK: - AuthService

@Observable
@MainActor
final class AuthService {
    var isSignedIn: Bool = false
    var isLoading: Bool = false
    var error: String? = nil

    // MARK: - Computed

    /// The current user's UUID, or nil when signed out.
    var userId: UUID? {
        get async {
            try? await supabase.auth.session.user.id
        }
    }

    // MARK: - Session restore

    /// Call once on app launch to re-hydrate an existing Supabase session.
    func restoreSession() async {
        isLoading = true
        defer { isLoading = false }
        do {
            _ = try await supabase.auth.session
            isSignedIn = true
        } catch {
            // No valid session on disk — stay signed out, not an error.
            isSignedIn = false
        }
    }

    // MARK: - OTP flow

    /// Step 1 — send a magic/OTP code to `email`.
    func sendOTP(email: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            try await supabase.auth.signInWithOTP(
                email: email,
                shouldCreateUser: true
            )
        } catch {
            self.error = friendlyAuthError(error)
        }
    }

    /// Step 2 — verify the 6-digit code the user received.
    /// Sets `isSignedIn = true` on success.
    func verifyOTP(email: String, token: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            try await supabase.auth.verifyOTP(
                email: email,
                token: token,
                type: .email
            )
            isSignedIn = true
        } catch {
            self.error = friendlyAuthError(error)
        }
    }

    // MARK: - Sign out

    func signOut() async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await supabase.auth.signOut()
        } catch {
            // Log but don't surface — always clear local state.
            print("[AuthService] signOut error: \(error)")
        }
        isSignedIn = false
        self.error = nil
    }

    // MARK: - Error mapping

    private func friendlyAuthError(_ error: Error) -> String {
        let raw = error.localizedDescription.lowercased()

        if raw.contains("invalid_otp") || raw.contains("invalid otp") || raw.contains("otp invalid") {
            return "That code didn't match. Double-check and try again."
        }
        if raw.contains("otp_expired") || raw.contains("otp expired") || raw.contains("token has expired") {
            return "Code expired — tap Resend to get a new one."
        }
        if raw.contains("rate") || raw.contains("too many") || raw.contains("429") {
            return "Too many attempts. Please wait a minute and try again."
        }
        if raw.contains("email not confirmed") || raw.contains("signup") {
            return "We couldn't find an account for that email. Check the address and try again."
        }
        if raw.contains("network") || raw.contains("internet") || raw.contains("offline") {
            return "No internet connection. Check your signal and try again."
        }
        return "Something went wrong. Please try again."
    }
}
