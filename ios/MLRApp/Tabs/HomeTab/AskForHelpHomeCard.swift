import SwiftUI

// MARK: - AskForHelpHomeCard
// Home card for the "Ask for Help" feature.
// Mirrors components/AskForHelpHomeCard.tsx.
//
// Includes:
//   • "Post a request" button → opens AskForHelpSheet
//   • "Willing to Help" inline toggle

struct AskForHelpHomeCard: View {
    let willingToHelp: Bool
    let onAsk: () -> Void
    let onToggleWilling: () async -> Void

    @State private var isTogglingWilling = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 6) {
                Text("🤝")
                    .font(.system(size: 18))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Ask for Help")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.mlrText)
                    Text("Need a hand at the resort?")
                        .font(.caption)
                        .foregroundStyle(Color.mlrTextMuted)
                }
            }

            // Post a request button
            Button(action: onAsk) {
                Label("Post a request", systemImage: "plus.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(Color.mlrPrimary)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            Divider()

            // Willing to Help toggle
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Willing to Help")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.mlrText)
                    Text("Get pinged when someone nearby needs a hand")
                        .font(.caption2)
                        .foregroundStyle(Color.mlrTextMuted)
                }

                Spacer()

                Toggle("", isOn: Binding(
                    get: { willingToHelp },
                    set: { _ in
                        guard !isTogglingWilling else { return }
                        Task {
                            isTogglingWilling = true
                            await onToggleWilling()
                            isTogglingWilling = false
                        }
                    }
                ))
                .tint(Color.mlrPrimary)
                .labelsHidden()
                .disabled(isTogglingWilling)
            }
        }
        .padding(14)
        .cardStyle()
    }
}

// AskForHelpSheet — the canonical compose sheet lives in
// HelpRequests/AskForHelpSheet.swift (presented by HomeView via `showAskSheet`).
// The "Post a request" button above calls `onAsk`, which HomeView wires to it.
