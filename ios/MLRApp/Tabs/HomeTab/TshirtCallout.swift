import SwiftUI

// MARK: - TshirtCallout
// A heraldic-wine "🗳️ Vote · New" home card shown only during the planning phase
// and before the vote deadline. Mirrors components/TshirtCallout.tsx.
//
// Swipe left/right (past ~140pt) or tap ✕ to dismiss. Dismissal is managed
// by HomeView via the onDismiss callback (session-scoped @State there).

struct TshirtCallout: View {
    var onDismiss: () -> Void = {}

    @State private var isAfterDeadline = TshirtCallout.deadlineHasPassed()
    @State private var season: FestSeason = .current()
    @State private var dragOffset: CGFloat = 0
    @State private var isHorizontalDrag: Bool? = nil
    @State private var wiggleAngle: CGFloat = 0

    @ViewBuilder
    var body: some View {
        if !isAfterDeadline {
            card
                .onAppear {
                    season = .current()
                    isAfterDeadline = TshirtCallout.deadlineHasPassed()
                    Task { await triggerWiggle() }
                }
        }
    }

    // MARK: - Card

    private var card: some View {
        NavigationLink(destination: ShirtVoteView(season: season)) {
            ZStack(alignment: .topTrailing) {
                cardContent
                dismissButton
            }
        }
        .buttonStyle(.plain)
        .offset(x: dragOffset)
        .rotationEffect(.degrees(dragOffset / 30))
        .rotationEffect(.degrees(wiggleAngle))
        .simultaneousGesture(
            DragGesture(minimumDistance: 10)
                .onChanged { value in
                    if isHorizontalDrag == nil {
                        isHorizontalDrag = abs(value.translation.width) > abs(value.translation.height)
                    }
                    if isHorizontalDrag == true {
                        dragOffset = value.translation.width
                    }
                }
                .onEnded { _ in
                    isHorizontalDrag = nil
                    if abs(dragOffset) > 140 {
                        flyOff()
                    } else {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            dragOffset = 0
                        }
                    }
                }
        )
    }

    private var cardContent: some View {
        VStack(alignment: .leading, spacing: 10) {
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
            }

            Text("T-Shirt Design Vote")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.mlrFest)

            Text("Pick your favorite design for this year's Family Fest shirt. Vote closes \(formattedDeadline).")
                .font(.subheadline)
                .foregroundStyle(Color.mlrFest.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

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
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.mlrFestParchment)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.mlrFest.opacity(0.25), lineWidth: 1)
        )
    }

    private var dismissButton: some View {
        Button {
            flyOff()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.mlrFest.opacity(0.6))
                .padding(6)
                .background(Color.mlrFest.opacity(0.08))
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(10)
    }

    // MARK: - Thumbnails

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

    // MARK: - Actions

    private func flyOff() {
        let direction: CGFloat = dragOffset >= 0 ? 1 : -1
        withAnimation(.easeIn(duration: 0.18)) {
            dragOffset = direction * 600
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            onDismiss()
        }
    }

    @MainActor
    private func triggerWiggle() async {
        try? await Task.sleep(for: .seconds(0.7))
        for _ in 0..<3 {
            withAnimation(.easeInOut(duration: 0.09)) { wiggleAngle = 2.5 }
            try? await Task.sleep(for: .seconds(0.09))
            withAnimation(.easeInOut(duration: 0.09)) { wiggleAngle = -2.5 }
            try? await Task.sleep(for: .seconds(0.09))
        }
        withAnimation(.easeInOut(duration: 0.09)) { wiggleAngle = 0 }
    }

    // MARK: - Helpers

    private var formattedDeadline: String {
        MLRFormat.shortDateISO(TshirtVoteConfig.deadline)
    }

    static func deadlineHasPassed() -> Bool {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone(identifier: "America/Chicago")
        guard let deadline = fmt.date(from: TshirtVoteConfig.deadline) else { return false }
        let dayAfter = Calendar.current.date(byAdding: .day, value: 1, to: deadline) ?? deadline
        return Date.now >= dayAfter
    }
}
