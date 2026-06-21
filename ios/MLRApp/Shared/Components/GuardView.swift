import SwiftUI

// MARK: - GuardView
// Mirrors the web app's components/Guard.tsx privacy-wall pattern.
// Three building blocks:
//   • SignInWall  — full-screen overlay, wraps sensitive content
//   • PrivateName — shows full or first name depending on sign-in state
//   • Protected   — inline 🔒 chip or actual content

// MARK: - SignInWall

/// Full-screen sign-in gate. Wraps sensitive content (Posts, Pay, etc.).
/// When the user is not signed in, shows a lock overlay with a sign-in prompt.
/// The app is still browsable — this only obscures the specific gated surface.
///
/// Usage:
///   SignInWall { PostsListView() }
struct SignInWall<Content: View>: View {
    @Environment(AppEnvironment.self) private var env
    @ViewBuilder let content: Content

    var body: some View {
        ZStack {
            // Always render content so layout is stable
            content
                .blur(radius: env.isSignedIn ? 0 : 4)
                .allowsHitTesting(env.isSignedIn)

            if !env.isSignedIn {
                signInOverlay
            }
        }
        .animation(.easeInOut(duration: 0.2), value: env.isSignedIn)
    }

    private var signInOverlay: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color.mlrPrimary)

            VStack(spacing: 6) {
                Text("Sign in to see this")
                    .font(.mlrHeadline)
                    .foregroundStyle(Color.mlrText)

                Text("Just your name & email — no password needed.")
                    .font(.mlrCaption)
                    .foregroundStyle(Color.mlrTextMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Button("Sign In") {
                env.authService.promptSignIn()
            }
            .primaryButton()
            .padding(.horizontal, 48)
        }
        .padding(28)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.mlrSurface)
                .shadow(color: .black.opacity(0.12), radius: 20, x: 0, y: 8)
        )
        .padding(.horizontal, 24)
    }
}

// MARK: - PrivateName

/// Shows the member's full name when signed in, first name only for guests.
/// Matches web app's `PrivateName` from `lib/privacy.ts`.
///
/// Usage:
///   PrivateName(profile: member)          // respects current session
///   PrivateName(fullName: "Leo Theis")    // convenience string overload
struct PrivateName: View {
    @Environment(AppEnvironment.self) private var env

    let fullName: String
    var font: Font = .mlrBody
    var color: Color = Color.mlrText

    init(profile: Profile, font: Font = .mlrBody, color: Color = Color.mlrText) {
        self.fullName = profile.name
        self.font = font
        self.color = color
    }

    init(fullName: String, font: Font = .mlrBody, color: Color = Color.mlrText) {
        self.fullName = fullName
        self.font = font
        self.color = color
    }

    var body: some View {
        Text(displayName)
            .font(font)
            .foregroundStyle(color)
    }

    private var displayName: String {
        if env.isSignedIn {
            return fullName
        }
        // First name only for guests
        return String(fullName.split(separator: " ").first ?? Substring(fullName))
    }
}

// MARK: - Protected

/// Inline privacy gate. Shows content when signed in, otherwise a 🔒 chip.
/// Use for phone numbers, emails, payment handles, locations.
///
/// Usage:
///   Protected { Text(member.phone ?? "") }
struct Protected<Content: View>: View {
    @Environment(AppEnvironment.self) private var env
    @ViewBuilder let content: Content

    var body: some View {
        if env.isSignedIn {
            content
        } else {
            SignInChip()
        }
    }
}

// MARK: - SignInChip

/// The inline 🔒 chip shown by `Protected` when the user is a guest.
struct SignInChip: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Button {
            env.authService.promptSignIn()
        } label: {
            Label("Sign in", systemImage: "lock.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.mlrPrimary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.mlrPrimaryLight)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - AuthService.promptSignIn
// `promptSignIn()` is a method on `AuthService` that sets `showSignIn = true`.
// It's defined in AuthService.swift alongside the stored `showSignIn` property
// so that `@Observable` tracking works correctly (stored properties cannot be
// added to an @Observable class via extensions).
// Bind `env.authService.showSignIn` in your root view to present `SignInView`.

// MARK: - Preview

#if DEBUG
// Minimal stub environment for previews
private final class GuestEnv: AppEnvironment {
    // isSignedIn returns false when currentProfile is nil (inherited behaviour)
}

struct GuardView_Previews: PreviewProvider {
    static var previews: some View {
        let env = AppEnvironment()

        VStack(spacing: 24) {
            SectionLabel(text: "PrivateName (guest)")
            PrivateName(fullName: "Dorothy Theis")

            SectionLabel(text: "Protected inline chip")
            HStack {
                Text("Phone:")
                    .foregroundStyle(Color.mlrTextMuted)
                Protected { Text("(715) 555-0100") }
            }

            SectionLabel(text: "SignInWall")
            SignInWall {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.mlrCard)
                    .frame(height: 120)
                    .overlay(Text("Sensitive content"))
            }
        }
        .padding(20)
        .environment(env)
        .previewDisplayName("GuardView")
    }
}
#endif
