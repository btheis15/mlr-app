import SwiftUI

// MARK: - TshirtCallout
// A heraldic-wine "🗳️ Vote · New" home card shown only during the planning phase
// and before the vote deadline. Mirrors components/TshirtCallout.tsx.
//
// Taps through to ShirtVoteView (the gallery page). No in-app vote capture —
// the actual vote is cast in the Google Form opened from ShirtVoteView.

struct TshirtCallout: View {
    @State private var isAfterDeadline: Bool = false

    var body: some View {
        // Self-hide after deadline passes
        if isAfterDeadline { return AnyView(EmptyView()) }

        return AnyView(
            NavigationLink(destination: ShirtVoteView()) {
                VStack(alignment: .leading, spacing: 10) {
                    // Header row
                    HStack(spacing: 6) {
                        Text("🗳️")
                            .font(.system(size: 18))
                        Text("Vote · NEW")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.mlrFest)
                            .clipShape(Capsule())
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(Color.mlrFest.opacity(0.6))
                    }

                    Text("T-Shirt Design Vote")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.mlrFest)

                    Text("Pick your favorite design for this year's Family Fest shirt. Vote closes \(formattedDeadline).")
                        .font(.subheadline)
                        .foregroundStyle(Color.mlrFest.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)

                    // Thumbnail strip
                    if !TshirtVoteConfig.designs.isEmpty {
                        designThumbnails
                    }

                    Text("See the designs →")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Color.mlrFest)
                        .clipShape(Capsule())
                }
                .padding(16)
                .background(Color.mlrFestParchment)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(Color.mlrFest.opacity(0.25), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .onAppear { checkDeadline() }
        )
    }

    private var formattedDeadline: String {
        MLRFormat.shortDateISO(TshirtVoteConfig.deadline)
    }

    // Thumbnail row showing up to 4 design images
    private var designThumbnails: some View {
        HStack(spacing: 8) {
            ForEach(TshirtVoteConfig.designs.prefix(4)) { design in
                Image(design.imageName)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color.mlrFest.opacity(0.2), lineWidth: 1)
                    )
            }
        }
    }

    private func checkDeadline() {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone(identifier: "America/Chicago")
        guard let deadline = fmt.date(from: TshirtVoteConfig.deadline) else { return }
        // inclusive deadline — hide the day after
        let dayAfter = Calendar.current.date(byAdding: .day, value: 1, to: deadline) ?? deadline
        isAfterDeadline = Date.now >= dayAfter
    }
}
