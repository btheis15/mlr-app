import SwiftUI

// MARK: - WelcomeCard
// Shown once per device on Home for new (non-signed-in) users.
// Mirrors web app's components/WelcomeCard.tsx.
// Explains browse-first, no-password sign-in, and how to get started.
// Dismissed state stored in UserDefaults under "welcome_card_seen".

private let kWelcomeCardSeenKey = "welcome_card_seen"

// MARK: - WelcomeCard

struct WelcomeCard: View {
    @Environment(AppEnvironment.self) private var env
    @State private var isSeen: Bool = UserDefaults.standard.bool(forKey: kWelcomeCardSeenKey)
    @State private var isExpanded = true

    var body: some View {
        if shouldShow {
            card
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private var shouldShow: Bool {
        !isSeen && !env.isSignedIn
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header row
            HStack(alignment: .top) {
                // Resort logo / icon accent
                ZStack {
                    Circle()
                        .fill(Color.mlrPrimaryLight)
                        .frame(width: 44, height: 44)
                    Image(systemName: "house.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.mlrPrimary)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("Welcome to MLR")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.mlrPrimary)

                    Text("Muskellunge Lake Resort — Est. 1987")
                        .font(.mlrCaption)
                        .foregroundStyle(Color.mlrTextMuted)
                }
                .padding(.leading, 4)

                Spacer()

                // Dismiss
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.mlrTextMuted)
                        .padding(8)
                }
                .buttonStyle(.plain)
            }

            // Bullet points
            VStack(alignment: .leading, spacing: 10) {
                WelcomeBullet(
                    icon: "eye.fill",
                    text: "Browse freely — no account needed to explore."
                )
                WelcomeBullet(
                    icon: "envelope.fill",
                    text: "Sign in with just your email — no password, ever."
                )
                WelcomeBullet(
                    icon: "hand.tap.fill",
                    text: "Tap anything to get started. RSVP, chat, and more."
                )
            }

            // CTA row
            HStack(spacing: 10) {
                Button("Sign In") {
                    env.authService.promptSignIn()
                    dismiss()
                }
                .primaryButton()

                Button("Maybe Later") {
                    dismiss()
                }
                .secondaryButton()
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.mlrSurface)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.mlrPrimaryLight, lineWidth: 1.5)
                )
                .shadow(color: Color.mlrPrimary.opacity(0.08), radius: 12, x: 0, y: 4)
        )
    }

    private func dismiss() {
        withAnimation(.easeInOut(duration: 0.25)) {
            isSeen = true
        }
        UserDefaults.standard.set(true, forKey: kWelcomeCardSeenKey)
    }
}

// MARK: - Bullet row

private struct WelcomeBullet: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(Color.mlrPrimary)
                .frame(width: 20)
                .padding(.top, 1)

            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Color.mlrText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Preview

#if DEBUG
struct WelcomeCard_Previews: PreviewProvider {
    static var previews: some View {
        // Reset seen state for preview
        let _ = UserDefaults.standard.removeObject(forKey: kWelcomeCardSeenKey)

        ScrollView {
            VStack(spacing: 16) {
                WelcomeCard()
                    .environment(AppEnvironment())

                // Show card even after dismiss for layout inspection
                WelcomeCard()
                    .environment(AppEnvironment())
            }
            .padding(.vertical, 24)
        }
        .background(Color(.systemGroupedBackground))
        .previewDisplayName("WelcomeCard")
    }
}
#endif
